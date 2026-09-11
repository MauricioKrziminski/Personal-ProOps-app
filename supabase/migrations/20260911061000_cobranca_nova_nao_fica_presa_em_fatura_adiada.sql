-- Lançamento que cai numa fatura JÁ ADIADA seguia para a fatura seguinte — no banco de verdade
-- e, a partir daqui, aqui também.
--
-- Achado pelo teste de três ciclos seguidos (`roll_invoice.sql`, asserção 10), e é o pior tipo
-- de defeito: **dinheiro sumindo em silêncio**. A fatura adiada sai da projeção (o saldo dela
-- mudou de fatura); qualquer cobrança que chegue nela DEPOIS disso — os juros e o IOF reais que
-- vêm na importação do extrato, datados dentro daquele ciclo — saía junto, sem erro e sem
-- aviso. A pessoa importaria a fatura e o app ficaria otimista pelo valor dos encargos.
--
-- O emissor faz exatamente o que esta correção faz: fechada a fatura e mandado o saldo para o
-- rotativo, o que vem depois é cobrado na PRÓXIMA. A regra continua num lugar só — o trigger
-- que já resolvia a fatura pela data — e ganhou um passo: se a fatura resolvida foi adiada,
-- segue a corrente até uma que não foi.
--
-- O `for` com teto de 12 é guarda de laço, não regra de negócio: `rolled_into_invoice_id` é uma
-- corrente e um ciclo nela (por dado corrompido) travaria o INSERT de qualquer lançamento no
-- cartão. Doze é mais ciclos de rotativo seguidos do que o Banco Central permite existir.
create or replace function public.tg_transactions_set_invoice()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  card record;
  win record;
  inv_id uuid;
  seguinte uuid;
  old_due date;
begin
  if tg_op = 'UPDATE' and old.invoice_id is not null then
    select due_date into old_due from public.card_invoices where id = old.invoice_id;
  end if;
  select a.type, a.closing_day, a.due_day, a.workspace_id, a.user_id into card
    from public.accounts a where a.id = new.account_id;
  if new.account_id is not null then
    if card.workspace_id is distinct from new.workspace_id then
      raise exception 'Conta precisa pertencer ao workspace do lançamento';
    end if;
  end if;
  if new.account_id is null or card.type is distinct from 'credit_card'
     or card.closing_day is null or card.due_day is null then
    new.invoice_id := null;
    if tg_op = 'UPDATE' and old.invoice_id is not null
       and new.due_at is not distinct from old.due_at and old.due_at = old_due then
      new.due_at := null;
    end if;
    return new;
  end if;
  select * into win from private.invoice_window(card.closing_day, card.due_day, new.occurred_at);
  insert into public.card_invoices
    (workspace_id, user_id, account_id, reference_month, closing_date, due_date)
  values (card.workspace_id, coalesce(new.user_id, card.user_id), new.account_id,
          win.reference_month, win.closing_date, win.due_date)
  on conflict (account_id, reference_month) do nothing;
  select ci.id into inv_id from public.card_invoices ci
    where ci.account_id = new.account_id and ci.reference_month = win.reference_month;

  -- NOVO: fatura adiada não recebe cobrança nova. Segue para onde o saldo dela foi.
  for _i in 1..12 loop
    select ci.rolled_into_invoice_id into seguinte
      from public.card_invoices ci where ci.id = inv_id and ci.status = 'rolled';
    exit when seguinte is null;
    inv_id := seguinte;
    seguinte := null;
  end loop;

  new.invoice_id := inv_id;
  select ci.due_date into new.due_at from public.card_invoices ci where ci.id = inv_id;
  return new;
end;
$$;
