-- Pagar a fatura exige a conta de onde o dinheiro sai.
--
-- ## O que estava errado
--
-- `pay_invoice` aceitava `p_account_id = NULL` e seguia em frente. A guarda que
-- existia — `if p_account_id = inv.account_id` — não dispara com NULL, porque em
-- SQL `NULL = x` é NULL, não TRUE. O INSERT criava um `transfer` com
-- `account_id` nulo e a fatura virava `paid`.
--
-- Medido no staging em 11/09/2026, com rollback:
--
--     fatura virou status  : paid
--     transferencia criada : origem=None
--     saldo da corrente    : 500000 -> 500000  (delta 0)
--
-- Uma fatura de R$ 1.000,00 quitada com R$ 0,00 saindo da conta. Não dá erro em
-- lugar nenhum: a tela mostra a fatura paga e o saldo cheio, e os dois números
-- concordam entre si enquanto os dois estão errados.
--
-- Quem chamava assim era o agente ("paguei a fatura do nubank" não cita conta
-- nenhuma, e `resolve_account` devolve NULL para nome vazio). Isso foi corrigido
-- em Python na mesma leva — a cadeia agora é conta citada →
-- `accounts.payment_account_id` → conta padrão do workspace → pergunta.
--
-- ⚠️ Esta migration é a OUTRA metade, e é a que não depende de quem chama.
-- Corrigir só o agente deixaria a porta aberta para o app, para um script e para
-- o próximo chamador. `settle_invoice` não precisa da guarda: ela marca a fatura
-- como paga SEM mover dinheiro, de propósito, e não recebe conta nenhuma.

CREATE OR REPLACE FUNCTION public.pay_invoice(p_invoice_id uuid, p_account_id uuid, p_paid_at date DEFAULT CURRENT_DATE, p_amount_cents bigint DEFAULT NULL::bigint)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  inv    record;
  aberto bigint;
  valor  bigint;
  tx_id  uuid;
begin
  select ci.*, a.name as card_name into inv
  from public.card_invoices ci
  join public.accounts a on a.id = ci.account_id
  where ci.id = p_invoice_id;
  if inv.id is null then
    raise exception 'fatura não encontrada';
  end if;
  if inv.status in ('paid','rolled') then
    raise exception 'fatura já paga em %', inv.paid_at;
  end if;
  if p_account_id is null then
    raise exception 'pagar a fatura exige a conta de onde o dinheiro sai';
  end if;
  if p_account_id = inv.account_id then
    raise exception 'a conta pagadora não pode ser o próprio cartão';
  end if;

  aberto := private.invoice_open_cents(p_invoice_id);
  if aberto <= 0 then
    raise exception 'fatura sem lançamentos';
  end if;

  -- sem valor, paga o que falta: pagar tudo continua sendo um toque
  valor := coalesce(p_amount_cents, aberto);
  if valor <= 0 then
    raise exception 'o valor do pagamento precisa ser maior que zero';
  end if;
  if valor > aberto then
    raise exception 'o pagamento é maior que o valor em aberto';
  end if;

  insert into public.transactions
    (workspace_id, user_id, kind, amount_cents, description,
     account_id, counterparty_account_id, occurred_at, source, status)
  values (inv.workspace_id, coalesce((select auth.uid()), inv.user_id), 'transfer',
          valor, 'Pagamento da fatura ' || inv.card_name,
          p_account_id, inv.account_id, p_paid_at, 'app', 'cleared')
  returning id into tx_id;

  update public.card_invoices set paid_cents = paid_cents + valor where id = p_invoice_id;

  -- Quitou. Enquanto não quitar, a fatura continua em aberto e as compras continuam previstas —
  -- que é a verdade: elas ainda não foram pagas.
  if valor = aberto then
    -- a baixa das linhas, pelo mesmo motivo da 20260909031000
    update public.transactions
       set status = 'cleared', paid_at = p_paid_at
     where invoice_id = p_invoice_id and status = 'pending';

    update public.card_invoices
       set status = 'paid', paid_at = p_paid_at, payment_transaction_id = tx_id
     where id = p_invoice_id;
  end if;

  return tx_id;
end;
$function$;
