-- Pagar a fatura dá baixa nas compras dela.
--
-- `pay_invoice` cria a transferência e marca a fatura como paga, mas nunca tocou em
-- `transactions.status`. Era inofensivo enquanto `_promote_due_transactions` promovia por data
-- QUALQUER linha com `installment_plan_id not null` — cláusula que a `20260908153143` removeu,
-- de propósito (histórico de parcelas passou a ser explícito).
--
-- Desde então, parcela dentro de fatura PAGA fica `pending` para sempre. Já aparece fora de
-- qualquer tela nova: `nextPendingInstallment` (`src/lib/installment-progress.ts`) tira a próxima
-- parcela do `min(installment_no) where status='pending'`, então quem paga a fatura pela RPC lê
-- "parcela 1 de 10" pelo resto do plano.
--
-- Os totais não mudam — nenhum agregado filtra `status`, e linha de cartão não entra em
-- `cash_total` (que exclui `credit_card`). O que estava errado é o estado de cada linha, que é
-- justamente o que uma visão de mês mostra ao lado do valor.
--
-- A baixa é a MESMA que `settle_invoice` já faz (`0046`), e pelo mesmo motivo de lá: atualizar
-- só `status` e `paid_at` não dispara o trigger de remanejamento de fatura, que só olha
-- `account_id` e `occurred_at`.
create or replace function public.pay_invoice(p_invoice_id uuid, p_account_id uuid, p_paid_at date default current_date)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  inv record;
  total_cents bigint;
  tx_id uuid;
begin
  select ci.*, a.name as card_name into inv
  from public.card_invoices ci
  join public.accounts a on a.id = ci.account_id
  where ci.id = p_invoice_id;
  if inv.id is null then
    raise exception 'fatura % nao encontrada', p_invoice_id;
  end if;
  if inv.status = 'paid' then
    raise exception 'fatura ja paga em %', inv.paid_at;
  end if;
  if p_account_id = inv.account_id then
    raise exception 'a conta pagadora nao pode ser o proprio cartao';
  end if;

  select coalesce(sum(t.amount_cents), 0) into total_cents
  from public.transactions t
  where t.invoice_id = p_invoice_id and t.kind = 'expense';

  if total_cents = 0 then
    raise exception 'fatura sem lancamentos';
  end if;

  insert into public.transactions
    (workspace_id, user_id, kind, amount_cents, description,
     account_id, counterparty_account_id, occurred_at, source, status)
  values (inv.workspace_id, coalesce((select auth.uid()), inv.user_id), 'transfer',
          total_cents, 'Pagamento da fatura ' || inv.card_name,
          p_account_id, inv.account_id, p_paid_at, 'app', 'cleared')
  returning id into tx_id;

  -- a baixa que faltava
  update public.transactions
     set status = 'cleared', paid_at = p_paid_at
   where invoice_id = p_invoice_id and status = 'pending';

  update public.card_invoices
  set status = 'paid', paid_at = p_paid_at, payment_transaction_id = tx_id
  where id = p_invoice_id;

  return tx_id;
end;
$$;
