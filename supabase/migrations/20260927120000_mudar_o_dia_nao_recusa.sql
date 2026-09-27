-- Mudar o DIA de uma série não é mais recusado, e a parcela paga fica no dia dela (27/09/2026).
--
-- 1. `update_recurring_series`: "todo dia 4" → "todo dia 31" com setembro pago era recusado ("A de
--    04/09/2026 já está paga: o próximo vencimento vem depois dela") — o app abria "Esta e as
--    próximas" pela ocorrência paga e a data dela era 04/09. A pessoa queria mudar o dia da série
--    INTEIRA. Agora o calendário novo começa no primeiro período depois do que FICA (paga,
--    atrasada, compra de cartão já feita), no dia da regra: 30/09 vira 31/10. O que fica não se
--    move, e a em aberto seguinte muda de data com o MESMO id, como antes. A conta do passo usa
--    `private.day_in_month` (a régua do sistema) sobre as formas que o app monta — não é um segundo
--    expansor: é um passo do calendário, o resto continua com o agendador.
-- 2. `update_installment_plan`: data da primeira nova, com parcela paga fora do cartão, levava a
--    PAGA junto (a de 04/09 ia para 30/09, paga e no futuro). A data nova vale para as em aberto;
--    a paga fica — `finance.md`, regra 1 do reparcelamento. A conta continua acompanhando.
-- Assinaturas iguais (o app e o agente relêem `next_run_at` para dizer onde a série caiu).
-- Testes: `supabase/tests/serie_recorrente_edita_tudo.sql`, `supabase/tests/editar_como_criar.sql`.

create or replace function public.update_recurring_series(
  p_recurring_id uuid,
  p_patch jsonb,
  p_propagate boolean default true
)
returns bigint
language plpgsql
security invoker
set search_path = public
set timezone to 'America/Sao_Paulo'
as $$
declare
  serie   record;
  changed bigint := 0;
  proxima timestamptz;
  fica    record;
  periodo text;
  movida  uuid;
  dia     int;
  passo   int;
begin
  if p_patch is null or p_patch = '{}'::jsonb then
    raise exception 'Nada para alterar';
  end if;
  if exists (
    select 1 from unnest(array(select jsonb_object_keys(p_patch))) k
    where k not in ('amount_cents', 'category', 'description', 'account_id',
                    'auto_confirm', 'end_date', 'kind', 'merchant', 'rrule', 'next_run_at')
  ) then
    raise exception 'Campo não permitido nesta alteração';
  end if;
  if p_patch ? 'amount_cents'
     and coalesce((p_patch->>'amount_cents')::bigint, 0) <= 0 then
    raise exception 'O valor precisa ser maior que zero';
  end if;
  if p_patch ? 'kind' and coalesce(p_patch->>'kind', '') not in ('expense', 'income') then
    raise exception 'A série é de saída ou de entrada';
  end if;
  if (p_patch ? 'rrule') <> (p_patch ? 'next_run_at') then
    raise exception 'A repetição e o próximo vencimento mudam juntos';
  end if;
  if p_patch ? 'rrule' then
    if coalesce(p_patch->>'rrule', '') !~ '^FREQ=(MONTHLY(;INTERVAL=([2-9]|[1-9][0-9]))?;BYMONTHDAY=(-1|[1-9]|[12][0-9]|3[01])|WEEKLY;BYDAY=(SU|MO|TU|WE|TH|FR|SA)|YEARLY;BYMONTH=([1-9]|1[0-2]);BYMONTHDAY=([1-9]|[12][0-9]|3[01]))$' then
      raise exception 'Repetição inválida: use mensal, semanal ou anual';
    end if;
    proxima := (p_patch->>'next_run_at')::timestamptz;
    if proxima is null or proxima::date < current_date then
      raise exception 'O próximo vencimento não pode ser antes de hoje';
    end if;
  end if;

  select r.id, r.workspace_id into serie
  from public.recurring_transactions r where r.id = p_recurring_id
  for update;
  if serie.id is null then
    raise exception 'Recorrência não encontrada';
  end if;

  if p_patch ? 'rrule' then
    periodo := case when p_patch->>'rrule' like 'FREQ=WEEKLY%' then 'week'
                    when p_patch->>'rrule' like 'FREQ=YEARLY%' then 'year' else 'month' end;
    -- A mais recente das que FICAM (tudo menos a em aberto que ainda não venceu). O dia dela é o
    -- vencimento fora do cartão; no cartão, a data da compra.
    select x.dia, x.status into fica
    from (
      select case when t.invoice_id is null then coalesce(t.due_at, t.occurred_at) else t.occurred_at end as dia,
             t.status
      from public.transactions t
      where t.recurring_id = serie.id and t.workspace_id = serie.workspace_id
        and not (t.status = 'pending'
                 and (t.occurred_at >= current_date or (t.invoice_id is null and t.due_at >= current_date)))
    ) x
    order by x.dia desc
    limit 1;
    -- O período dela já tem a sua cobrança: o calendário novo começa no primeiro período DEPOIS
    -- dela, no dia da regra — nunca recusa (27/09/2026: dia 4 → dia 31 com setembro pago dava
    -- erro, e o que a pessoa queria era mudar o dia da série inteira). A que fica não se move.
    dia := case when p_patch->>'rrule' like '%BYMONTHDAY=-1%' then 31
                else ((regexp_match(p_patch->>'rrule', 'BYMONTHDAY=([0-9]+)'))[1])::int end;
    passo := coalesce(((regexp_match(p_patch->>'rrule', 'INTERVAL=([0-9]+)'))[1])::int, 1);
    while fica.dia is not null and date_trunc(periodo, proxima::date) <= date_trunc(periodo, fica.dia) loop
      proxima := ((case periodo
                     when 'week' then proxima::date + 7
                     when 'year' then private.day_in_month((date_trunc('month', proxima::date) + interval '1 year')::date, dia)
                     else private.day_in_month((date_trunc('month', proxima::date) + make_interval(months => passo))::date, dia)
                   end) + proxima::time)::timestamptz;
    end loop;
  end if;

  if p_patch ? 'account_id' and p_patch->>'account_id' is not null and not exists (
    select 1 from public.accounts a
    where a.id = (p_patch->>'account_id')::uuid and a.workspace_id = serie.workspace_id
  ) then
    raise exception 'Conta precisa ser do mesmo workspace da série';
  end if;

  update public.recurring_transactions r set
    amount_cents = coalesce((p_patch->>'amount_cents')::bigint, r.amount_cents),
    category     = case when p_patch ? 'category'     then p_patch->>'category'     else r.category end,
    description  = case when p_patch ? 'description'  then p_patch->>'description'  else r.description end,
    merchant     = case when p_patch ? 'merchant'     then nullif(p_patch->>'merchant', '') else r.merchant end,
    kind         = case when p_patch ? 'kind'         then p_patch->>'kind'         else r.kind end,
    account_id   = case when p_patch ? 'account_id'   then (p_patch->>'account_id')::uuid else r.account_id end,
    auto_confirm = case when p_patch ? 'auto_confirm' then (p_patch->>'auto_confirm')::boolean else r.auto_confirm end,
    end_date     = case when p_patch ? 'end_date'     then (p_patch->>'end_date')::date else r.end_date end,
    rrule        = case when p_patch ? 'rrule'        then p_patch->>'rrule'        else r.rrule end,
    dtstart      = case when p_patch ? 'rrule'        then proxima                  else r.dtstart end,
    next_run_at  = case when p_patch ? 'rrule'        then proxima                  else r.next_run_at end,
    materialized_until = case when p_patch ? 'rrule'  then null                     else r.materialized_until end
  where r.id = serie.id;

  if p_patch ? 'rrule' then
    -- O calendário mudou. A PRIMEIRA em aberto do período do próximo vencimento em diante muda de
    -- data e fica com o MESMO id — "as em aberto são atualizadas, não recriadas" (finance.md): é
    -- o lançamento aberto na tela, o `last_write_id` do agente, um pendente de confirmação. As
    -- outras saem e o agendador as gera pela regra nova; a movida ele pula pelo unique
    -- `(recurring_id, occurred_at)`, porque ela já está na data da primeira ocorrência nova.
    select t.id into movida
    from public.transactions t
    where t.recurring_id = serie.id
      and t.workspace_id = serie.workspace_id
      and t.status = 'pending'
      and (t.occurred_at >= current_date or (t.invoice_id is null and t.due_at >= current_date))
      and date_trunc(periodo, case when t.invoice_id is null then coalesce(t.due_at, t.occurred_at) else t.occurred_at end)
          >= date_trunc(periodo, proxima::date)
    order by case when t.invoice_id is null then coalesce(t.due_at, t.occurred_at) else t.occurred_at end
    limit 1;

    -- Antes de mover: uma delas pode já estar na data nova, e o unique recusaria a movida.
    delete from public.transactions t
    where t.recurring_id = serie.id
      and t.workspace_id = serie.workspace_id
      and t.status = 'pending'
      and (t.occurred_at >= current_date or (t.invoice_id is null and t.due_at >= current_date))
      and date_trunc(periodo, case when t.invoice_id is null then coalesce(t.due_at, t.occurred_at) else t.occurred_at end)
          >= date_trunc(periodo, proxima::date)
      and t.id is distinct from movida;

    if movida is not null then
      update public.transactions t
         set occurred_at = proxima::date,
             due_at = case when t.invoice_id is null then proxima::date else t.due_at end
       where t.id = movida;
    end if;
  end if;

  if p_patch ? 'end_date' and p_patch->>'end_date' is not null then
    -- Fim mais cedo: o que passou dele não vai mais acontecer.
    delete from public.transactions t
    where t.recurring_id = serie.id
      and t.workspace_id = serie.workspace_id
      and t.status = 'pending'
      and (t.occurred_at >= current_date or (t.invoice_id is null and t.due_at >= current_date))
      and t.occurred_at > (p_patch->>'end_date')::date;
  end if;

  if p_propagate then
    -- Mesmo cuidado da irmã: `account_id` só entra no `set` quando foi pedido, senão
    -- `set_invoice` recalcula a fatura de ocorrências que ninguém mandou mover.
    update public.transactions t set
      amount_cents = coalesce((p_patch->>'amount_cents')::bigint, t.amount_cents),
      category     = case when p_patch ? 'category'    then p_patch->>'category'    else t.category end,
      description  = case when p_patch ? 'description' then p_patch->>'description' else t.description end,
      merchant     = case when p_patch ? 'merchant'    then nullif(p_patch->>'merchant', '') else t.merchant end,
      kind         = case when p_patch ? 'kind'        then p_patch->>'kind'        else t.kind end
    where t.recurring_id = serie.id
      and t.workspace_id = serie.workspace_id
      and t.status = 'pending'
      and (t.occurred_at >= current_date or (t.invoice_id is null and t.due_at >= current_date));
    get diagnostics changed = row_count;

    if p_patch ? 'account_id' then
      update public.transactions t
         set account_id = (p_patch->>'account_id')::uuid
       where t.recurring_id = serie.id
         and t.workspace_id = serie.workspace_id
         and t.status = 'pending'
         and (t.occurred_at >= current_date or (t.invoice_id is null and t.due_at >= current_date));
    end if;
  end if;

  return changed;
end;
$$;

revoke execute on function public.update_recurring_series(uuid, jsonb, boolean) from public, anon;
grant execute on function public.update_recurring_series(uuid, jsonb, boolean) to authenticated;

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
           set status = case when ci.closing_date < current_date then 'closed' else 'open' end,
               paid_at = null, settled_manually = false
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
  -- só quando mudaram. A DATA nova vale para as em aberto: a paga fica no dia em que venceu
  -- (27/09/2026, a mesma régua da série recorrente — mudar o dia 4 para o 30 não põe a parcela de
  -- 04/09, já paga, em 30/09). A CONTA da paga fora do cartão acompanha (ela é o registro da
  -- pessoa; a de fatura já foi recusada acima). Mencionar a coluna dispara `set_invoice`: por
  -- isso a parcela travada só entra aqui quando é para mudar.
  if travadas = 0 or muda_data or muda_conta then
    update public.transactions t set
      occurred_at = case when (travadas = 0 or muda_data) and not (t.id = any(travadas_antes))
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
