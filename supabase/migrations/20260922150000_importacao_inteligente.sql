-- Importação inteligente de extrato/fatura (22/09/2026).
-- Plano: `docs/superpowers/plans/2026-09-22-importacao-inteligente.md`.
--
-- ⚠️ **A conciliação saiu do SQL e foi para o agente** (`agent/app/domain/reconcile.py`, puro e
-- testado): são sete camadas em cascata, semelhança de nome e reserva 1-para-1 — lógica que só se
-- confia com teste rápido, e o banco não tem `pg_trgm`. O que fica aqui é o que PRECISA ser
-- atômico: gravar o que a pessoa marcou, criar a compra parcelada inteira e descartar o resto.
-- Por isso `_prepare_import_batch` passa a só aplicar as regras do usuário; ela não marca mais
-- duplicata (duas réguas de "já está no app" divergiriam, e divergir aqui é duplicar dinheiro).
--
-- Colunas novas em `import_items`, todas preenchidas pelo agente:
--   external_id      o id que o BANCO dá à linha (FITID / "Identificador"); reimportar casa por ele
--   installment_no / installments   "Parcela k/N", estrutural
--   nature           o que a IA acha que a linha é — só muda a PRÉ-SELEÇÃO, nunca escreve
--   match_layer / match_note        a camada que achou o par no app, e a frase para a tela
--   adopt_ids        parcelas ANTERIORES que já existem soltas no app: adotadas, não duplicadas
--
-- ⚠️ **Fatura que só existe por causa do histórico nasce QUITADA.** "Parcela 2/12" traz a 1ª como
-- paga, datada um mês antes — e o `set_invoice` cria a fatura daquele mês se ela não existir. Sem
-- dono, ela nascia `open`, vencida, e a projeção a jogava em "Atrasado": R$ 780,96 de dívida que
-- nunca existiu. O mesmo defeito já morava no "já pagas" do formulário de parcelado
-- (`create_installment_plan_with_history`), que por isso também passa a chamar a regra. Só vale
-- para fatura CRIADA nesta transação (`created_at = now()`, o início da transação) e que só tem
-- linha paga: fatura que já existia é da pessoa, e o app não a toca.

alter table public.import_items
  add column if not exists external_id text,
  add column if not exists installment_no int,
  add column if not exists installments int,
  add column if not exists nature text,
  add column if not exists match_layer text,
  add column if not exists match_note text,
  add column if not exists adopt_ids uuid[];

alter table public.import_items drop constraint if exists import_items_status_check;
alter table public.import_items add constraint import_items_status_check
  check (status in ('pending', 'approved', 'discarded', 'duplicate', 'near_match', 'uncertain'));

alter table public.import_items drop constraint if exists import_items_parcela_check;
alter table public.import_items add constraint import_items_parcela_check
  check ((installments is null and installment_no is null)
      or (installments between 2 and 72 and installment_no between 1 and installments));

-- a camada `arquivo` pergunta "este FITID já entrou?" em todo import
create index if not exists import_items_external_idx
  on public.import_items (workspace_id, external_id)
  where external_id is not null and status = 'approved';

-- --------------------------------------------------------------------------
-- regras do usuário, e só elas
-- --------------------------------------------------------------------------
create or replace function public._prepare_import_batch(p_batch_id uuid)
returns table (total integer, categorizados integer, duplicados integer)
language plpgsql security definer set search_path = public
as $function$
declare
  ws_id uuid;
begin
  select b.workspace_id into ws_id from public.import_batches b where b.id = p_batch_id;
  if ws_id is null then
    raise exception 'lote % não encontrado', p_batch_id;
  end if;

  update public.import_items i
  set suggested_category = m.category,
      suggested_account_id = coalesce(i.suggested_account_id, m.account_id)
  from (
    select it.id, r.category, r.account_id
    from public.import_items it
    cross join lateral public._match_rule(ws_id, it.description) r
    where it.batch_id = p_batch_id and it.suggested_category is null
  ) m
  where i.id = m.id and m.category is not null;

  return query
  select count(*)::int,
         count(*) filter (where i.suggested_category is not null)::int,
         -- continua contando só o casamento EXATO (`20260914160000`): três leitores o leem assim
         count(*) filter (where i.status = 'duplicate')::int
  from public.import_items i
  where i.batch_id = p_batch_id;
end;
$function$;

-- --------------------------------------------------------------------------
-- a fatura que o histórico criou nasce quitada
-- --------------------------------------------------------------------------
create or replace function private.quitar_faturas_do_historico(p_plan_id uuid)
returns int
language plpgsql security invoker
set search_path = public
set timezone to 'America/Sao_Paulo'
as $$
declare
  n int;
begin
  -- Mesma semântica de `settle_invoice` (paga fora do app, sem transferência), restrita a fatura:
  --   - criada NESTA transação (`now()` é o início dela) — a que já existia é da pessoa;
  --   - JÁ VENCIDA — a que ainda vai vencer continua devida, e quitá-la a tiraria da projeção;
  --   - só com linha paga DESTE plano — uma compra à vista do mesmo extrato que caiu ali antes
  --     não pode ser quitada junto (revisão da migration, 22/09/2026).
  update public.card_invoices ci
     set status = 'paid', paid_at = ci.due_date, settled_manually = true
   where ci.id in (select t.invoice_id from public.transactions t
                    where t.installment_plan_id = p_plan_id and t.status = 'cleared'
                      and t.invoice_id is not null)
     and ci.created_at = now()
     and ci.status = 'open'
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
revoke execute on function private.quitar_faturas_do_historico(uuid) from public, anon;
grant execute on function private.quitar_faturas_do_historico(uuid) to authenticated, service_role;

create or replace function public.create_installment_plan_with_history(
  p_account_id uuid,
  p_total_cents bigint,
  p_installments int,
  p_occurred_at date,
  p_paid_installments int,
  p_description text default null,
  p_category text default null,
  p_merchant text default null
)
returns uuid
language plpgsql security invoker
set search_path = public
as $$
declare
  acc record;
  plan_id uuid;
  base_cents bigint;
  parcela_cents bigint;
  data_parcela date;
  i int;
begin
  if p_installments is null or p_installments < 2 or p_installments > 72 then
    raise exception 'parcelas fora do intervalo 2..72: %', p_installments;
  end if;
  if p_total_cents is null or p_total_cents < p_installments then
    raise exception 'total precisa permitir pelo menos um centavo por parcela';
  end if;
  if p_occurred_at is null then raise exception 'Informe a data da primeira parcela'; end if;
  if p_paid_installments is null or p_paid_installments < 0 or p_paid_installments > p_installments then
    raise exception 'Informe quantas parcelas iniciais já foram pagas, entre 0 e %', p_installments;
  end if;

  select a.id, a.workspace_id, a.user_id into acc
  from public.accounts a where a.id = p_account_id and not a.archived;
  if acc.id is null then
    raise exception 'conta % não encontrada', p_account_id;
  end if;

  insert into public.installment_plans
    (workspace_id, user_id, account_id, description, merchant, category,
     total_cents, installments, first_occurred_at)
  values (acc.workspace_id, coalesce((select auth.uid()), acc.user_id), p_account_id,
          p_description, p_merchant, p_category, p_total_cents, p_installments, p_occurred_at)
  returning id into plan_id;

  base_cents := p_total_cents / p_installments;  -- divisão inteira: nunca float
  for i in 1..p_installments loop
    parcela_cents := case when i = p_installments
      then p_total_cents - base_cents * (p_installments - 1)
      else base_cents end;
    data_parcela := private.add_months(p_occurred_at, i - 1);

    insert into public.transactions
      (workspace_id, user_id, kind, amount_cents, category, description, merchant,
       account_id, occurred_at, source, status, installment_plan_id, installment_no)
    values (acc.workspace_id, coalesce((select auth.uid()), acc.user_id), 'expense',
            parcela_cents, p_category,
            -- ⚠️ `p_merchant` no meio do coalesce é a correção de 15/09/2026. Quem informou
            -- só o estabelecimento tinha a compra gravada como "Compra parcelada (1/2)", e
            -- o nome ficava numa coluna que a tela da fatura não lê.
            coalesce(p_description, p_merchant, 'Compra parcelada')
              || ' (' || i || '/' || p_installments || ')',
            p_merchant, p_account_id, data_parcela, 'app',
            case when i <= p_paid_installments then 'cleared' else 'pending' end,
            plan_id, i);
  end loop;

  -- ⚠️ As "já pagas" com data passada podiam criar a fatura daquele mês ABERTA e vencida.
  perform private.quitar_faturas_do_historico(plan_id);

  return plan_id;
end;
$$;

-- --------------------------------------------------------------------------
-- a compra parcelada que o extrato trouxe, inteira
-- --------------------------------------------------------------------------
create or replace function private.importar_parcelado(p_item_id uuid, p_account_id uuid)
returns uuid
language plpgsql security invoker
set search_path = public
set timezone to 'America/Sao_Paulo'
as $$
declare
  it record;
  plano uuid;
  primeira date;
  nome text;
  i int;
  alvo uuid;
  adotado uuid;
  tx_k uuid;
  tx_i uuid;
  soma bigint;
begin
  select * into it from public.import_items where id = p_item_id;
  if it.installments is null or it.installment_no is null then
    raise exception 'item % não é parcela', p_item_id;
  end if;
  if it.status in ('approved', 'discarded') then
    raise exception 'item % já foi decidido', p_item_id;
  end if;

  -- O extrato diz o valor de UMA parcela; o total é estimativa (a última pode diferir centavos).
  primeira := private.add_months(it.occurred_at, -(it.installment_no - 1));
  nome := coalesce(nullif(it.merchant, ''), nullif(it.description, ''), 'Compra parcelada');

  insert into public.installment_plans
    (workspace_id, user_id, account_id, description, merchant, category,
     total_cents, installments, first_occurred_at)
  values (it.workspace_id, coalesce((select auth.uid()),
          (select b.user_id from public.import_batches b where b.id = it.batch_id)),
          p_account_id, nome, nome, it.suggested_category,
          it.amount_cents * it.installments, it.installments, primeira)
  returning id into plano;

  for i in 1..it.installments loop
    adotado := null;
    if i < it.installment_no and it.adopt_ids is not null and array_length(it.adopt_ids, 1) >= i then
      alvo := it.adopt_ids[i];
      -- ADOTA a linha solta que já está no app (id preservado), só se ela ainda é um gasto solto
      -- deste workspace: entre a prévia e o "Importar" ela pode ter sido apagada ou parcelada.
      update public.transactions t set
        installment_plan_id = plano,
        installment_no      = i,
        amount_cents        = it.amount_cents,
        description         = nome || ' (' || i || '/' || it.installments || ')',
        merchant            = nome,
        account_id          = p_account_id,
        category            = coalesce(it.suggested_category, t.category),
        status              = 'cleared'
      where t.id = alvo and t.workspace_id = it.workspace_id
        and t.installment_plan_id is null and t.kind = 'expense'
        -- as travas de `convert_transaction_to_installments`: linha de outro contrato, saldo
        -- adiado, ou dentro de fatura paga/adiada/paga em parte não é adotada — vira linha nova
        and t.recurring_id is null and t.debt_id is null and t.rollover_of_invoice_id is null
        and not private.parcela_travada('pending', t.invoice_id)
      returning t.id into adotado;
    end if;

    if adotado is null then
      insert into public.transactions
        (workspace_id, user_id, kind, amount_cents, category, description, merchant,
         account_id, occurred_at, source, status, installment_plan_id, installment_no)
      values (it.workspace_id, coalesce((select auth.uid()),
              (select b.user_id from public.import_batches b where b.id = it.batch_id)),
              'expense', it.amount_cents, it.suggested_category,
              nome || ' (' || i || '/' || it.installments || ')', nome, p_account_id,
              -- a parcela do ARQUIVO fica no dia do arquivo; as outras, de mês em mês
              case when i = it.installment_no then it.occurred_at
                   else private.add_months(primeira, i - 1) end,
              'import',
              -- antes da do arquivo: já pagas. A do arquivo e as futuras: a fatura baixa.
              case when i < it.installment_no then 'cleared' else 'pending' end,
              plano, i)
      returning id into tx_i;
    else
      tx_i := adotado;
    end if;
    if i = it.installment_no then tx_k := tx_i; end if;
  end loop;

  -- "Anterior como paga" só vale se a fatura dela JÁ VENCEU: a parcela 1 de uma "2/12" pode cair
  -- na fatura que fechou e ainda vai vencer — ali ela é devida, não paga.
  update public.transactions t
     set status = 'pending', paid_at = null
    from public.card_invoices ci
   where t.invoice_id = ci.id and t.installment_plan_id = plano
     and t.installment_no < it.installment_no and t.status = 'cleared'
     and ci.status not in ('paid', 'rolled') and ci.due_date >= current_date;

  -- E o espelho: parcela que caiu numa fatura que o app JÁ tem como paga foi paga junto com ela.
  -- `pending` ali sumiria de toda leitura de caixa (elas filtram fatura paga), sem ser baixa.
  update public.transactions t
     set status = 'cleared', paid_at = coalesce(ci.paid_at, ci.due_date)
    from public.card_invoices ci
   where t.invoice_id = ci.id and t.installment_plan_id = plano
     and t.status = 'pending' and ci.status = 'paid';

  select coalesce(sum(t.amount_cents), 0) into soma
  from public.transactions t where t.installment_plan_id = plano;
  if soma <> it.amount_cents * it.installments then
    raise exception 'a soma das parcelas (%) não fecha com o total (%)', soma, it.amount_cents * it.installments;
  end if;

  perform private.quitar_faturas_do_historico(plano);
  return tx_k;
end;
$$;
revoke execute on function private.importar_parcelado(uuid, uuid) from public, anon;
grant execute on function private.importar_parcelado(uuid, uuid) to authenticated, service_role;

-- --------------------------------------------------------------------------
-- "Importar N": grava o que a pessoa marcou e descarta o resto, numa transação só
-- --------------------------------------------------------------------------
create or replace function public.finish_import_batch(p_batch_id uuid, p_item_ids uuid[])
returns int
language plpgsql security invoker
set search_path = public
as $$
declare
  lote record;
  conta record;
  item record;
  tx_id uuid;
  criadas int := 0;
begin
  -- `for update`: dois toques em "Importar" (ou a rede que cai e o app que tenta de novo) não
  -- gravam o lote duas vezes — o segundo espera o primeiro e encontra `done`.
  select b.* into lote from public.import_batches b where b.id = p_batch_id for update;
  if lote.id is null then
    raise exception 'lote não encontrado';
  end if;
  if lote.status = 'done' then
    return 0;
  end if;
  if lote.status <> 'review' then
    raise exception 'esse lote não está em revisão';
  end if;
  select a.id, a.type into conta from public.accounts a where a.id = lote.account_id;

  for item in
    select i.* from public.import_items i
    where i.batch_id = p_batch_id and i.id = any(p_item_ids)
      and i.status in ('pending', 'duplicate', 'near_match', 'uncertain')
    order by i.occurred_at, i.created_at
  loop
    if item.installments is not null and item.kind = 'expense'
       and conta.type = 'credit_card' then
      tx_id := private.importar_parcelado(item.id, conta.id);
    else
      insert into public.transactions
        (workspace_id, user_id, kind, amount_cents, category, description, merchant,
         account_id, occurred_at, source, status)
      values (item.workspace_id, coalesce((select auth.uid()), lote.user_id),
              item.kind, item.amount_cents, item.suggested_category, item.description,
              nullif(item.merchant, ''),
              coalesce(item.suggested_account_id, lote.account_id),
              item.occurred_at, 'import', 'cleared')
      returning id into tx_id;
    end if;

    update public.import_items set status = 'approved', transaction_id = tx_id where id = item.id;
    criadas := criadas + 1;
  end loop;

  -- O que ficou desmarcado não entra — e não fica pendurado esperando decisão.
  update public.import_items
     set status = 'discarded'
   where batch_id = p_batch_id
     and status in ('pending', 'duplicate', 'near_match', 'uncertain');

  update public.import_batches set status = 'done' where id = p_batch_id;
  return criadas;
end;
$$;
revoke execute on function public.finish_import_batch(uuid, uuid[]) from public, anon;
grant execute on function public.finish_import_batch(uuid, uuid[]) to authenticated, service_role;

comment on function public.finish_import_batch(uuid, uuid[]) is
  'Fecha um lote de importação: grava os itens marcados (compra parcelada inteira, adotando parcelas antigas soltas), descarta o resto e marca o lote done. Chamar de novo num lote done devolve 0.';
