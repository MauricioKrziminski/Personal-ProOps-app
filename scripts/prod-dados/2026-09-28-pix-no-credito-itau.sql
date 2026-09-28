-- PRODUÇÃO — o Pix no crédito de 23/09/2026 (cartão Nubank → Itaú), pedido do Gabriel.
--
-- A linha estava como GASTO de R$ 356,99 no cartão: os R$ 340 contavam duas vezes como gasto
-- (aqui e na Parcela Carro que saiu do Itaú) e o Itaú mostrava −R$ 335 em vez de +R$ 5. Vira
-- transferência de R$ 340,00 do cartão para o Itaú + R$ 16,99 de juros no cartão.
--
-- Rodar SÓ depois de `20260928230000_pix_no_credito_na_fatura` estar em produção (sem ela a
-- fatura ficaria R$ 340 menor — o script confere e recusa). Quem roda é o Gabriel, no SQL Editor
-- do projeto de produção ou por psql. Tudo numa transação: qualquer conferência que falhe
-- desfaz tudo, e o `commit` do fim vira rollback.
--
-- Depois: acertar no app o SALDO INICIAL real do Itaú (a conta foi criada com 0).

begin;

do $$
declare
  usr    constant uuid := '214e77c6-af74-432c-be76-0309d82a9e48';
  ws     constant uuid := '2dc0cbb7-acaa-462c-9f25-ef9f7bc86822';
  cartao constant uuid := 'aaf81b01-6d9b-4d0a-a5a7-e70ba498c15e';
  itau   constant uuid := '147d52ae-1f96-4eed-9fb1-926c33866d0e';
  conta  constant uuid := '66a14e33-d522-44fb-bbea-079206d2bc86';
  fatura constant uuid := 'b840015e-b7be-4e78-8c05-1c93a6a449c4';
  linha  constant uuid := 'abd9ea5b-f019-4f38-ad6b-242927e1ea69';
  l record;
  v bigint;
begin
  if not exists (select 1 from supabase_migrations.schema_migrations where version = '20260928230000') then
    raise exception 'a migration 20260928230000 ainda não está neste banco — suba ela antes';
  end if;

  select * into l from public.transactions where id = linha for update;
  if l.id is null or l.workspace_id <> ws or l.account_id <> cartao or l.kind <> 'expense'
     or l.amount_cents <> 35699 or l.invoice_id is distinct from fatura then
    raise exception 'a linha não está como esperado: kind %, conta %, valor %, fatura % — nada foi mudado',
      l.kind, l.account_id, l.amount_cents, l.invoice_id;
  end if;

  update public.transactions
     set kind = 'transfer', amount_cents = 34000, counterparty_account_id = itau,
         category = null, merchant = null, description = 'Pix no crédito para o Itaú',
         status = 'cleared', paid_at = l.occurred_at
   where id = linha;

  insert into public.transactions
    (workspace_id, user_id, account_id, kind, amount_cents, currency, category, description,
     occurred_at, status, source)
  values (ws, l.user_id, cartao, 'expense', 1699, 'BRL', 'juros', 'Juros do Pix no crédito',
          l.occurred_at, l.status, 'app');

  -- as três conferências combinadas: a fatura continua a do Nubank, e os saldos batem com o banco
  select invoice_total_cents into v from public._card_summary(usr) where account_id = cartao;
  if v is distinct from 445475 then
    raise exception 'fatura do Nubank = %, esperado 445475 — desfeito', v;
  end if;
  select cleared_cents into v from public._account_balances(usr) where account_id = conta;
  if v is distinct from 32251 then
    raise exception 'Nubank Conta paga = %, esperado 32251 — desfeito', v;
  end if;
  select cleared_cents into v from public._account_balances(usr) where account_id = itau;
  if v is distinct from 500 then
    raise exception 'Itaú pago = %, esperado 500 — desfeito', v;
  end if;

  raise notice 'ok: fatura 4.454,75 · Nubank Conta 322,51 · Itaú 5,00';
end $$;

commit;
