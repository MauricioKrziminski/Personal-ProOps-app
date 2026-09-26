-- Tudo que se cria se edita (26/09/2026).
--
-- Regra do dono do produto, depois de "o modo da dívida não muda" e "parcelas já pagas só na
-- criação" terem sido listados como de propósito: *"como assim o banco não deixa? … ele deve
-- poder alterar tudo, do mesmo jeito que cria ele deve poder alterar"*. Uma trava no banco é
-- decisão nossa, não lei: onde a edição faz sentido, a trava sai e o banco recalcula.
--
-- 1. DÍVIDA: o modo (parcela fixa ↔ com juros ao mês) muda. O trigger só dizia "cadastre outro
--    financiamento"; a aritmética de cada modo continua presa pelo `check`
--    (`debts_fixed_installments_check`), e o app manda os campos do modo novo calculados a partir
--    do estado atual. Os pagamentos já lançados ficam como histórico — o mesmo custo aceito na
--    `20260923160000` para o contrato de parcela fixa editado com pagamento.
--
-- 2. COMPRA PARCELADA (`update_installment_plan`), com parcela já paga:
--    - o NÚMERO de parcelas muda: as pagas ficam como estão e o que falta do total se reparte
--      entre as em aberto — só não fica abaixo da última paga;
--    - a DATA da 1ª e a CONTA mudam, desde que nenhuma parcela esteja numa FATURA de cartão paga,
--      adiada ou paga em parte: mudar a tiraria da fatura em que ela foi paga (o motivo lógico que
--      fica, e a frase diz);
--    - "à vista" continua recusado: à vista é um pagamento só, e uma parte já foi paga separada.
--    E ganha `p_paid_installments` — as PARCELAS JÁ PAGAS, que até aqui só existiam na criação
--    (`create_installment_plan_with_history`). Aumentar dá baixa nas primeiras e quita a fatura
--    vencida que só tem parcelas pagas desta compra; diminuir reabre, e reabre junto a fatura que
--    o app quitou à mão por causa delas. Fatura paga de verdade (com pagamento lançado), adiada ou
--    paga em parte não reabre por aqui: a parcela continua paga, e a frase diz como desfazer.
--    Tudo numa transação só — a tela manda uma chamada.
--
-- A assinatura ganhou um argumento com default: a de 8 argumentos SAI (uma versão só; chamada
-- com 8 argumentos, como a do agente, cai na nova). Teste: `supabase/tests/reparcelar_a_compra.sql`
-- e `supabase/tests/editar_como_criar.sql`.

-- ── 1. dívida ────────────────────────────────────────────────────────────────────────────────
drop trigger if exists validate_debt_calculation_mode on public.debts;
drop function if exists public.tg_debts_calculation_mode();

-- ── 2. compra parcelada ──────────────────────────────────────────────────────────────────────

-- O par do `quitar_faturas_do_historico` para a EDIÇÃO: a fatura já existe (nasceu com as
-- parcelas), então não dá para exigir que tenha sido criada nesta transação. O que continua
-- exigido: vencida (a que vai vencer continua devida) e SÓ com linhas pagas desta compra.
create or replace function private.quitar_faturas_do_plano(p_plan_id uuid)
returns integer
language plpgsql
set search_path = public
set timezone to 'America/Sao_Paulo'
as $$
declare
  n int;
begin
  update public.card_invoices ci
     set status = 'paid', paid_at = ci.due_date, settled_manually = true
   where ci.id in (select t.invoice_id from public.transactions t
                    where t.installment_plan_id = p_plan_id and t.status = 'cleared'
                      and t.invoice_id is not null)
     and ci.status = 'open'
     and ci.paid_cents = 0
     and ci.due_date < current_date
     and not exists (select 1 from public.transactions o
                      where o.invoice_id = ci.id
                        and (o.status <> 'cleared' or o.installment_plan_id is distinct from p_plan_id));
  get diagnostics n = row_count;

  update public.transactions t
     set paid_at = ci.due_date
    from public.card_invoices ci
   where t.invoice_id = ci.id and t.installment_plan_id = p_plan_id
     and ci.status = 'paid' and ci.settled_manually and t.paid_at is null;
  return n;
end;
$$;
revoke execute on function private.quitar_faturas_do_plano(uuid) from public, anon, authenticated;

drop function if exists public.update_installment_plan(uuid, bigint, integer, date, text, text, text, uuid);

create or replace function public.update_installment_plan(
  p_plan_id uuid,
  p_total_cents bigint,
  p_installments integer,
  p_first_occurred_at date,
  p_description text default null,
  p_category text default null,
  p_merchant text default null,
  p_account_id uuid default null,
  p_paid_installments integer default null
)
returns integer
language plpgsql
security invoker
set search_path = public
set timezone to 'America/Sao_Paulo'
as $$
declare
  plano record;
  acc record;
  travadas int;
  travado_cents bigint;
  na_fatura int;
  ultima_travada int;
  travadas_antes uuid[];
  reabrir record;
  restante bigint;
  abertas int;
  nome text;
  i int;
  ordem int;
  soma bigint;
  parcela record;
  sobrevivente uuid;
  muda_data boolean;
  muda_conta boolean;
begin
  select p.* into plano from public.installment_plans p where p.id = p_plan_id for update;
  if plano.id is null then
    raise exception 'Não achei essa compra parcelada.';
  end if;

  -- O lock que importa é nas PARCELAS: um `pay_invoice` concorrente escreve nelas e nunca no
  -- plano (ver a `20260915210000`). `for update` não vale com agregado, daí o `perform`.
  perform 1 from public.transactions t
   where t.installment_plan_id = p_plan_id and t.workspace_id = plano.workspace_id
   for update;

  if p_installments is null or p_installments < 1 or p_installments > 72 then
    raise exception 'O número de parcelas precisa ficar entre 1 e 72.';
  end if;
  if p_total_cents is null or p_total_cents < p_installments then
    raise exception 'total precisa permitir pelo menos um centavo por parcela';
  end if;
  if p_first_occurred_at is null then
    raise exception 'Informe a data da primeira parcela';
  end if;
  if p_paid_installments is not null and (p_paid_installments < 0 or p_paid_installments > p_installments) then
    raise exception 'As parcelas já pagas precisam ficar entre 0 e %.', p_installments;
  end if;

  -- ── reabrir as que deixaram de ser "já pagas" — ANTES de medir as travas ────────────────
  if p_paid_installments is not null then
    for reabrir in
      select t.id, t.installment_no, t.invoice_id, ci.status as fatura_status, ci.paid_cents,
             ci.settled_manually,
             exists (select 1 from public.transactions o
                      where o.invoice_id = t.invoice_id
                        and o.installment_plan_id is distinct from p_plan_id) as fatura_mista
      from public.transactions t
      left join public.card_invoices ci on ci.id = t.invoice_id
      where t.installment_plan_id = p_plan_id and t.workspace_id = plano.workspace_id
        and t.status = 'cleared' and t.installment_no > p_paid_installments
      order by t.installment_no
    loop
      if reabrir.invoice_id is not null and (
           reabrir.fatura_status = 'rolled' or reabrir.paid_cents > 0
           or (reabrir.fatura_status = 'paid' and (not reabrir.settled_manually or reabrir.fatura_mista))) then
        raise exception 'A parcela % foi paga junto com a fatura do cartão: ela continua paga. Para reabrir, desfaça o pagamento da fatura.',
          reabrir.installment_no;
      end if;
      -- a fatura que o app quitou à mão SÓ por causa desta compra reabre junto (o inverso do quitar)
      if reabrir.invoice_id is not null and reabrir.fatura_status = 'paid' then
        update public.card_invoices ci
           set status = 'open', paid_at = null, settled_manually = false
         where ci.id = reabrir.invoice_id;
      end if;
      update public.transactions t set status = 'pending', paid_at = null where t.id = reabrir.id;
    end loop;
  end if;

  select count(*) filter (where x.travada),
         coalesce(sum(x.amount_cents) filter (where x.travada), 0),
         count(*) filter (where x.travada and x.invoice_id is not null),
         max(x.installment_no) filter (where x.travada),
         coalesce(array_agg(x.id) filter (where x.travada), '{}')
    into travadas, travado_cents, na_fatura, ultima_travada, travadas_antes
  from (
    select t.id, t.amount_cents, t.installment_no, t.invoice_id,
           private.parcela_travada(t.status, t.invoice_id) as travada
    from public.transactions t
    where t.installment_plan_id = p_plan_id and t.workspace_id = plano.workspace_id
  ) x;

  muda_data := p_first_occurred_at is distinct from plano.first_occurred_at;
  muda_conta := p_account_id is distinct from plano.account_id;

  if travadas > 0 then
    if p_installments = 1 then
      raise exception 'Esta compra já tem parcela paga: à vista seria um pagamento só, e uma parte já foi paga.';
    end if;
    if p_installments < ultima_travada then
      raise exception 'A parcela % já está paga: o número de parcelas não fica abaixo dela.', ultima_travada;
    end if;
    if na_fatura > 0 and muda_data then
      raise exception 'Esta compra tem parcela paga na fatura do cartão: a data da primeira não muda, senão ela sairia da fatura em que foi paga.';
    end if;
    if na_fatura > 0 and muda_conta then
      raise exception 'Esta compra tem parcela paga na fatura do cartão: o cartão não muda, senão ela sairia da fatura em que foi paga.';
    end if;
    if p_installments = travadas then
      if p_total_cents <> travado_cents then
        raise exception 'Todas as parcelas já foram pagas: o total é a soma delas.';
      end if;
    elsif p_total_cents - travado_cents < p_installments - travadas then
      raise exception
        'O total precisa cobrir as % parcela(s) já paga(s) e sobrar pelo menos um centavo para cada parcela em aberto',
        travadas;
    end if;
  end if;

  -- Omitir a conta não pode ZERAR a conta: sem ela `set_invoice` apaga o `invoice_id` das
  -- parcelas e a compra de cartão vira despesa solta, em silêncio.
  if p_account_id is null and plano.account_id is not null then
    raise exception 'Informe a conta desta compra.';
  end if;
  if p_account_id is not null then
    select a.id, a.workspace_id into acc
    from public.accounts a where a.id = p_account_id and not a.archived;
    if acc.id is null or acc.workspace_id <> plano.workspace_id then
      raise exception 'Escolha uma conta ativa.';
    end if;
  end if;

  nome := coalesce(p_description, p_merchant, 'Compra parcelada');

  -- ── 1x: a compra deixa de ser parcelada (só sem parcela travada — o guarda acima) ────────
  -- A ORDEM impede apagar o dado (`installment_plan_id` é `on delete cascade`): solta o
  -- sobrevivente (a parcela 1, mesmo id) → apaga os irmãos → apaga o plano.
  if p_installments = 1 then
    select t.id into sobrevivente
    from public.transactions t
    where t.installment_plan_id = p_plan_id and t.workspace_id = plano.workspace_id
    order by t.installment_no
    limit 1;
    if sobrevivente is null then
      raise exception 'Essa compra não tem parcela nenhuma para virar lançamento.';
    end if;

    update public.transactions t set
      installment_plan_id = null,
      installment_no      = null,
      amount_cents        = p_total_cents,
      occurred_at         = p_first_occurred_at,
      description         = nome,
      merchant            = p_merchant,
      category            = p_category,
      account_id          = p_account_id
    where t.id = sobrevivente and t.workspace_id = plano.workspace_id;

    delete from public.transactions t
     where t.installment_plan_id = p_plan_id and t.workspace_id = plano.workspace_id
       and t.id <> sobrevivente;
    delete from public.installment_plans p
     where p.id = p_plan_id and p.workspace_id = plano.workspace_id;

    if (select private.parcela_travada('pending', t.invoice_id)
        from public.transactions t where t.id = sobrevivente) then
      raise exception 'Essa data (ou essa conta) joga o lançamento dentro de uma fatura já fechada. Escolha outra.';
    end if;

    -- "já paga": o lançamento que sobra nasce pago
    if p_paid_installments = 1 then
      update public.transactions t set status = 'cleared' where t.id = sobrevivente;
    end if;
    return 1;
  end if;

  update public.installment_plans p set
    description       = p_description,
    merchant          = p_merchant,
    category          = p_category,
    account_id        = p_account_id,
    total_cents       = p_total_cents,
    installments      = p_installments,
    first_occurred_at = p_first_occurred_at,
    updated_at        = now()
  where p.id = p_plan_id and p.workspace_id = plano.workspace_id;

  -- Acima do N novo só há parcela em aberto (o guarda da última paga garante).
  delete from public.transactions t
   where t.installment_plan_id = p_plan_id and t.workspace_id = plano.workspace_id
     and (t.installment_no is null or t.installment_no > p_installments);

  -- Nome, estabelecimento e categoria são da COMPRA: valem para todas, inclusive as pagas.
  update public.transactions t set
    description = nome || ' (' || t.installment_no || '/' || p_installments || ')',
    merchant    = p_merchant,
    category    = p_category
  where t.installment_plan_id = p_plan_id and t.workspace_id = plano.workspace_id;

  -- Data e conta: nada pago → todas seguem a compra (o calendário é refeito); com parcela paga,
  -- só quando mudaram — e, mudando, a paga FORA do cartão acompanha (ela é o registro da pessoa;
  -- a de fatura já foi recusada acima). Mencionar a coluna dispara `set_invoice`: por isso a
  -- parcela travada só entra aqui quando é para mudar.
  if travadas = 0 or muda_data or muda_conta then
    update public.transactions t set
      occurred_at = case when travadas = 0 or muda_data
                         then private.add_months(p_first_occurred_at, t.installment_no - 1)
                         else t.occurred_at end,
      account_id  = case when travadas = 0 or muda_conta then p_account_id else t.account_id end
    where t.installment_plan_id = p_plan_id and t.workspace_id = plano.workspace_id;
  end if;

  -- As que faltam até o N novo nascem em aberto, no calendário da compra.
  for i in 1..p_installments loop
    if not exists (select 1 from public.transactions t
                    where t.installment_plan_id = p_plan_id and t.workspace_id = plano.workspace_id
                      and t.installment_no = i) then
      insert into public.transactions
        (workspace_id, user_id, kind, amount_cents, category, description, merchant,
         account_id, occurred_at, source, status, installment_plan_id, installment_no)
      values (plano.workspace_id, coalesce((select auth.uid()), plano.user_id), 'expense', 1,
              p_category, nome || ' (' || i || '/' || p_installments || ')',
              p_merchant, p_account_id,
              private.add_months(p_first_occurred_at, i - 1),
              'app', 'pending', p_plan_id, i);
    end if;
  end loop;

  -- O que falta do total se reparte entre as em aberto, o resto da divisão na última.
  restante := p_total_cents - travado_cents;
  abertas := p_installments - travadas;
  ordem := 0;
  for parcela in
    select t.id from public.transactions t
    where t.installment_plan_id = p_plan_id and t.workspace_id = plano.workspace_id
      and not (t.id = any(travadas_antes))
    order by t.installment_no
  loop
    ordem := ordem + 1;
    update public.transactions t
       set amount_cents = private.valor_da_parcela(restante, abertas, ordem)
     where t.id = parcela.id;
  end loop;

  -- Data ou conta novas não podem jogar uma parcela em aberto numa fatura já fechada.
  if exists (
    select 1 from public.transactions t
    where t.installment_plan_id = p_plan_id and t.workspace_id = plano.workspace_id
      and not (t.id = any(travadas_antes))
      and private.parcela_travada(t.status, t.invoice_id)
  ) then
    raise exception 'Essa data (ou essa conta) joga uma parcela dentro de uma fatura já fechada. Escolha outra.';
  end if;

  -- ── dar baixa nas que passaram a ser "já pagas", e quitar a fatura vencida que é só delas ──
  if p_paid_installments is not null then
    update public.transactions t set status = 'cleared'
     where t.installment_plan_id = p_plan_id and t.workspace_id = plano.workspace_id
       and t.installment_no <= p_paid_installments and t.status = 'pending';
  end if;
  -- Também quando a conta ou a data mudaram: a parcela paga fora do cartão que passou para um
  -- cartão caiu numa fatura vencida que só tem ela — a mesma regra da criação com histórico.
  if p_paid_installments is not null or muda_conta or muda_data then
    perform private.quitar_faturas_do_plano(p_plan_id);
  end if;

  select coalesce(sum(t.amount_cents), 0) into soma
  from public.transactions t
  where t.installment_plan_id = p_plan_id and t.workspace_id = plano.workspace_id;
  if soma <> p_total_cents then
    raise exception 'a soma das parcelas (%) não fecha com o total (%)', soma, p_total_cents;
  end if;

  return p_installments;
end;
$$;

revoke execute on function public.update_installment_plan(uuid, bigint, integer, date, text, text, text, uuid, integer) from public, anon;
grant execute on function public.update_installment_plan(uuid, bigint, integer, date, text, text, text, uuid, integer) to authenticated;
