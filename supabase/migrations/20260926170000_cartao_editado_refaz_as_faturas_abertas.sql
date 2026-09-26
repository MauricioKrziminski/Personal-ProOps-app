-- Editar a conta e o cartão (26/09/2026, *"tudo que se cria se edita"*).
--
-- 1. FECHAMENTO, VENCIMENTO e "compra no dia do fechamento" do cartão mudavam só para compras
--    NOVAS — a tela avisava isso só num dos três campos. Quem edita esses dias está, quase sempre,
--    CORRIGINDO um dia digitado errado, e a fatura aberta continuava na régua errada. Agora as
--    faturas ABERTAS e sem pagamento nenhum ganham as datas novas do mês de referência delas, as
--    compras em aberto dessas faturas passam de novo pelo `set_invoice` (a régua nova), e a fatura
--    aberta que ficou vazia sai. Fatura fechada, paga, paga em parte ou adiada fica como está: ela
--    já foi cobrada — mexer nela contradiria o que o banco mandou.
--
-- 2. O TIPO muda livre entre conta corrente, poupança, dinheiro e investimento; entre CARTÃO e
--    conta, só sem lançamento. Com lançamento, o cartão tem faturas e a conta não: a troca deixaria
--    as compras sem fatura (ou faturas sem cartão). O motivo vai na frase — antes, o app trocava
--    sem aviso nenhum e as faturas ficavam órfãs.
-- Teste: `supabase/tests/cartao_editado.sql`.

create or replace function public.tg_accounts_tipo()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (old.type = 'credit_card') <> (new.type = 'credit_card') and exists (
    select 1 from public.transactions t
     where t.account_id = old.id or t.counterparty_account_id = old.id
  ) then
    raise exception 'Esta conta tem lançamentos: cartão não vira conta, nem o contrário — as compras do cartão moram em faturas. Crie a outra e transfira o saldo.';
  end if;
  return new;
end;
$$;
revoke execute on function public.tg_accounts_tipo() from public, anon, authenticated;
drop trigger if exists validate_account_type on public.accounts;
create trigger validate_account_type before update of type on public.accounts
  for each row execute function public.tg_accounts_tipo();

create or replace function public.tg_accounts_refaz_faturas()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.type <> 'credit_card' or new.closing_day is null or new.due_day is null
     or (new.closing_day is not distinct from old.closing_day
         and new.due_day is not distinct from old.due_day
         and new.closing_day_inclusive is not distinct from old.closing_day_inclusive) then
    return new;
  end if;

  -- as faturas abertas, sem pagamento, ganham as datas novas do mês de referência delas
  update public.card_invoices ci set
    closing_date = private.day_in_month(ci.reference_month, new.closing_day),
    due_date = case when new.due_day > new.closing_day
                    then private.day_in_month(ci.reference_month, new.due_day)
                    else private.day_in_month(private.add_months(ci.reference_month, 1), new.due_day) end
   where ci.account_id = new.id and ci.status = 'open' and ci.paid_cents = 0;

  -- as compras delas passam de novo pela régua (o `set_invoice` recalcula com a chave). O critério
  -- é a FATURA aberta sem pagamento, não o status da linha: a compra à vista no cartão nasce
  -- `cleared` por padrão, e quem diz se ela foi paga é a fatura.
  perform set_config('proops.refazer_fatura', 'on', true);
  update public.transactions t set occurred_at = t.occurred_at
   where t.account_id = new.id
     and t.invoice_id in (select ci.id from public.card_invoices ci
                           where ci.account_id = new.id and ci.status = 'open' and ci.paid_cents = 0);
  perform set_config('proops.refazer_fatura', '', true);

  -- a fatura aberta que ficou vazia sai — sem pagamento e sem ninguém apontando para ela
  delete from public.card_invoices ci
   where ci.account_id = new.id and ci.status = 'open' and ci.paid_cents = 0
     and not exists (select 1 from public.transactions t where t.invoice_id = ci.id)
     and not exists (select 1 from public.transactions t where t.rollover_of_invoice_id = ci.id)
     and not exists (select 1 from public.card_invoices o where o.rolled_into_invoice_id = ci.id);
  return new;
end;
$$;
revoke execute on function public.tg_accounts_refaz_faturas() from public, anon, authenticated;
drop trigger if exists refaz_faturas_abertas on public.accounts;
create trigger refaz_faturas_abertas after update of closing_day, due_day, closing_day_inclusive on public.accounts
  for each row execute function public.tg_accounts_refaz_faturas();
