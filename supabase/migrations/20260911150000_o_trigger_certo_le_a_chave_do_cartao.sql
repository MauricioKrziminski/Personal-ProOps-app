-- A `20260911140000` acrescentou `accounts.closing_day_inclusive` e reescreveu o trigger —
-- só que reescreveu um trigger que NÃO EXISTE.
--
-- O nome real é `public.tg_transactions_set_invoice()`; eu escrevi `private.set_invoice()`,
-- que é como o trigger se chama na tabela (`create trigger set_invoice ... execute function
-- public.tg_transactions_set_invoice()`). O resultado foi uma função órfã em `private`, nunca
-- chamada por ninguém, e a coluna nova sem efeito nenhum: a compra do dia do fechamento seguia
-- caindo na próxima fatura mesmo com o cartão marcado como inclusivo.
--
-- ⚠️ **Isto não dava erro em lugar nenhum.** `create or replace function` com nome novo CRIA a
-- função; não há aviso, não há linter que reclame, e a migration aplicou limpa nos dois
-- ambientes. Quem pegou foi `supabase/tests/regua_e_dia_do_fechamento.sql`, seção 2, que insere
-- a compra e confere o VENCIMENTO da fatura em que ela caiu — o caminho real, não a função pura.
-- A seção 1 (que testa `invoice_window` direto) passava com o defeito de pé: é a diferença entre
-- testar a aritmética e testar que ela está ligada em alguma coisa.

drop function if exists private.set_invoice();

create or replace function public.tg_transactions_set_invoice()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  card record;
  win record;
  inv_id uuid;
  _i int;
  seguinte uuid;
  old_due date;
begin
  if tg_op = 'UPDATE' and old.invoice_id is not null then
    select due_date into old_due from public.card_invoices where id = old.invoice_id;
  end if;
  select a.type, a.closing_day, a.due_day, a.workspace_id, a.user_id, a.closing_day_inclusive
    into card
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
  -- A ÚNICA linha que muda em relação à `20260911061000`: a borda do dia do fechamento agora é
  -- do cartão. `coalesce` porque a coluna é `not null default false`, mas o record vem de um
  -- `select into` que devolve tudo null quando a conta não existe.
  select * into win from private.invoice_window(
    card.closing_day, card.due_day, new.occurred_at, coalesce(card.closing_day_inclusive, false));
  insert into public.card_invoices
    (workspace_id, user_id, account_id, reference_month, closing_date, due_date)
  values (card.workspace_id, coalesce(new.user_id, card.user_id), new.account_id,
          win.reference_month, win.closing_date, win.due_date)
  on conflict (account_id, reference_month) do nothing;
  select ci.id into inv_id from public.card_invoices ci
    where ci.account_id = new.account_id and ci.reference_month = win.reference_month;

  -- fatura adiada não recebe cobrança nova. Segue para onde o saldo dela foi.
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

revoke execute on function public.tg_transactions_set_invoice() from public, anon, authenticated;
