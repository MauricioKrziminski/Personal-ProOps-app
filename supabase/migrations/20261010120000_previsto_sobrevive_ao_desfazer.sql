-- O previsto guardado na baixa sobrevive ao "desfazer" e morre quando a pessoa muda o previsto
-- (revisão de 07/10/2026 sobre a `20261010100000`).
--
-- Antes: desfazer a baixa, mudar o valor do previsto e pagar de novo mantinha o previsto ANTIGO,
-- porque o gatilho e `confirm_payment_scoped` davam preferência ao que já estava guardado.
-- A régua agora:
--   * mudar o valor de uma linha EM ABERTO é dizer um previsto novo: o guardado sai;
--   * desfazer a baixa (cleared → pending) não mexe no valor: o guardado fica, e pagar de novo
--     com outro valor continua mostrando o previsto original;
--   * `confirm_payment_scoped` corrige o valor (uma mudança em aberto) antes de dar baixa, então
--     lê o previsto da linha ANTES da correção.

create or replace function private.expected_amount_on_settle()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status = 'pending' and new.status = 'pending' and new.amount_cents <> old.amount_cents then
    new.expected_amount_cents := null;
  elsif old.status = 'pending' and new.status = 'cleared' and new.amount_cents <> old.amount_cents then
    new.expected_amount_cents := coalesce(old.expected_amount_cents, old.amount_cents);
  end if;
  return new;
end;
$$;
revoke execute on function private.expected_amount_on_settle() from public, anon;

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
         t.workspace_id, t.occurred_at, t.installment_plan_id, t.recurring_id,
         t.expected_amount_cents
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
    -- O previsto lido ANTES da correção: a correção é uma mudança de valor em aberto, e o gatilho
    -- a trata como previsto novo (limpa o guardado). Depois de desfazer uma baixa, o guardado é o
    -- previsto ORIGINAL e é ele que fica (`20261010120000`).
    update public.transactions t
       set expected_amount_cents = coalesce(anchor.expected_amount_cents, anchor.amount_cents)
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
