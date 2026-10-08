-- Pago × previsto (07/10/2026, pedido do dono do produto: *"nos lançamentos que eu paguei mais
-- barato, tem que mostrar o valor que eu paguei de fato… mostrando os dois valores"*).
--
-- O "Paguei" com outro valor REESCREVE `amount_cents` (`confirm_payment_scoped` no app; no agente,
-- `mark_paid` numa conta prevista e a baixa de parcela de compra), e o previsto se perdia: a linha
-- paga não tinha como dizer "previsto R$ 120,00". Dívida não precisa disto — o pagamento já guarda
-- a parcela do contrato em `debt_principal_cents` e a diferença em `debt_interest_cents`.
--
-- `expected_amount_cents` guarda o valor que estava previsto ANTES da baixa trocar o valor; null é
-- "pago no previsto" ou "não se sabe". Ele é escrito UMA vez (`coalesce`): corrigir o valor da linha
-- paga depois não apaga o previsto original, e repetir a baixa não muda nada.
--
-- Dois caminhos gravam, e entre os dois cobrem toda baixa com valor diferente:
--   1. o gatilho `expected_amount_on_settle`: a MESMA escrita que tira de `pending` para `cleared`
--      e troca o valor (os dois caminhos do agente fazem isso numa instrução só);
--   2. `confirm_payment_scoped`, que corrige e dá baixa em duas escritas e por isso grava ele mesmo.

alter table public.transactions add column if not exists expected_amount_cents bigint;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'transactions_expected_amount_positive') then
    alter table public.transactions add constraint transactions_expected_amount_positive
      check (expected_amount_cents is null or expected_amount_cents > 0);
  end if;
end $$;
comment on column public.transactions.expected_amount_cents is
  'O valor previsto antes de a baixa trocar o valor ("Paguei" com outro valor). Null = pago no previsto, ou desconhecido.';

create or replace function private.expected_amount_on_settle()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status = 'pending' and new.status = 'cleared' and new.amount_cents <> old.amount_cents then
    new.expected_amount_cents := coalesce(old.expected_amount_cents, old.amount_cents);
  end if;
  return new;
end;
$$;
revoke execute on function private.expected_amount_on_settle() from public, anon;

drop trigger if exists expected_amount_on_settle on public.transactions;
create trigger expected_amount_on_settle
  before update of status, amount_cents on public.transactions
  for each row execute function private.expected_amount_on_settle();

create or replace function public.confirm_payment_scoped(
  p_transaction_id uuid,
  p_paid_at date,
  p_amount_cents bigint,
  p_scope text
)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  anchor record;
  changed bigint := 1;
  paid_id uuid;
begin
  if p_scope is null or p_scope not in ('one', 'future') then
    raise exception 'Escopo inválido: use "só esta" ou "esta e as futuras"';
  end if;
  if p_paid_at is null then
    raise exception 'Informe a data do pagamento';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'O valor precisa ser maior que zero';
  end if;

  -- Lock before checking status so a concurrent/repeated confirmation observes the result.
  -- SECURITY INVOKER keeps the transaction and related rows under the caller's RLS.
  select t.id, t.status, t.amount_cents, t.paid_at, t.debt_id, t.invoice_id,
         t.workspace_id, t.occurred_at, t.installment_plan_id, t.recurring_id
    into anchor
  from public.transactions t
  where t.id = p_transaction_id
  for update;
  if anchor.id is null then
    raise exception 'Lançamento não encontrado';
  end if;
  if anchor.status = 'cleared' then
    if anchor.amount_cents = p_amount_cents and anchor.paid_at = p_paid_at then
      return 0;
    end if;
    raise exception 'Esse lançamento já foi pago com outros dados';
  end if;
  if anchor.status <> 'pending' then
    raise exception 'Esse lançamento não está pendente';
  end if;
  if p_scope = 'future' and anchor.installment_plan_id is null
     and anchor.recurring_id is null then
    raise exception 'Esse lançamento não faz parte de uma série';
  end if;
  if anchor.invoice_id is not null
     and private.parcela_travada(anchor.status, anchor.invoice_id) then
    raise exception 'Essa fatura já foi paga, adiada ou paga em parte';
  end if;
  if anchor.amount_cents <> p_amount_cents and p_scope = 'future' and exists (
    select 1 from public.transactions t
    where t.workspace_id = anchor.workspace_id and t.id <> anchor.id
      and t.status = 'pending' and t.occurred_at >= anchor.occurred_at
      and ((anchor.installment_plan_id is not null
             and t.installment_plan_id = anchor.installment_plan_id)
        or (anchor.recurring_id is not null and t.recurring_id = anchor.recurring_id))
      and t.invoice_id is not null
      and private.parcela_travada(t.status, t.invoice_id)
  ) then
    raise exception 'Uma das próximas parcelas está numa fatura paga, adiada ou paga em parte';
  end if;
  -- Debt payments have their own ledger/contract correction path. The generic scoped edit
  -- must never silently change the debt payment amount or project it to future payments.
  if anchor.debt_id is not null and anchor.amount_cents <> p_amount_cents then
    raise exception 'Pagamento de dívida: corrija o valor pela edição da dívida';
  end if;

  if anchor.amount_cents <> p_amount_cents then
    changed := public.update_transaction_scoped(
      p_transaction_id, p_scope, jsonb_build_object('amount_cents', p_amount_cents));
    if changed < 1 then
      raise exception 'Lançamento não encontrado para corrigir';
    end if;
    -- 07/10/2026: o valor que estava previsto fica guardado na linha paga. A correção e a baixa
    -- são DUAS escritas aqui (o escopo `future` corrige as próximas pela mesma RPC), então o
    -- gatilho `expected_amount_on_settle` não vê as duas juntas — quem grava é esta função. Só a
    -- ÂNCORA: as próximas continuam em aberto e passam a ter o valor novo como previsto.
    update public.transactions t
       set expected_amount_cents = coalesce(t.expected_amount_cents, anchor.amount_cents)
     where t.id = p_transaction_id;
  end if;

  update public.transactions t
     set status = 'cleared', paid_at = p_paid_at
   where t.id = p_transaction_id and t.status = 'pending'
   returning t.id into paid_id;
  if paid_id is distinct from p_transaction_id then
    raise exception 'Lançamento não encontrado para dar baixa';
  end if;
  return changed;
end;
$$;

revoke execute on function public.confirm_payment_scoped(uuid, date, bigint, text)
  from public, anon;
grant execute on function public.confirm_payment_scoped(uuid, date, bigint, text)
  to authenticated, service_role;

-- Ocorrências de recorrente pagas com valor diferente do da regra vigente na data. Só desde
-- 28/09/2026: o histórico de versões (`private.recurring_history_versions`, `20260928200010`)
-- nasceu ali com UMA versão por série, o valor DAQUELE dia valendo para trás — antes disso o valor
-- da série naquele mês não é conhecido, e um "previsto" errado é pior que nenhum. Parcela de compra
-- antiga fica sem: o valor dela já foi reescrito e não há onde lê-lo.
update public.transactions t
   set expected_amount_cents = v.amount_cents
  from public.transactions o
  cross join lateral (
    select h.amount_cents from private.recurring_history_versions h
     where h.recurring_id = o.recurring_id and h.workspace_id = o.workspace_id
       and h.valid_from <= o.occurred_at
       and (h.valid_through is null or o.occurred_at <= h.valid_through)
     order by h.valid_from desc
     limit 1
  ) v
 where t.id = o.id
   and o.recurring_id is not null
   and o.status = 'cleared'
   and o.expected_amount_cents is null
   and o.occurred_at >= date '2026-09-28'
   and v.amount_cents > 0
   and v.amount_cents <> o.amount_cents;
