-- A compra feita NO dia do fechamento: fatura que fecha hoje, ou a seguinte?
--
-- A `20260909050000` trocou `<=` por `<` — "a compra DO dia do fechamento já é da próxima
-- fatura" — e a prova era boa: duas faturas reais do Nubank, nos dois sentidos (a de 10/09 com
-- período "03 AGO a 03 SET" contendo as compras de 03 AGO, e o OFX da de outubro com
-- `DTSTART 20260903` contendo as de 03 SET). O erro não foi a conclusão, foi a GENERALIZAÇÃO:
-- um emissor virou regra do sistema inteiro.
--
-- Pesquisado em 11/09/2026, e as fontes se contradizem:
--
--   Mobills  — "toda compra feita A PARTIR do dia de fechamento entrará na fatura seguinte"
--   Serasa   — "compras realizadas antes ou NO DIA EXATO do fechamento entram na fatura do mês
--               atual", e o resultado "depende do horário da compra e do sistema da instituição"
--
-- Não havendo padrão, a decisão não é nossa: vira campo do cartão (pedido explícito do dono do
-- produto — *"se realmente for inconsistente isso entre os bancos, deixe um campo na hora de
-- criar o cartão perguntando ao usuário"*). O default é `false`, que é o comportamento medido no
-- Nubank e o que já valia: nenhum cartão existente muda de ideia sozinho.
--
-- ⚠️ **Trocar a chave NÃO reescreve o passado.** O trigger só roda em insert/update da
-- transação, então as compras já classificadas mantêm o `invoice_id` que têm. É deliberado:
-- remanejar retroativamente mexeria em fatura já paga e em mês fechado. O campo diz isso ao
-- usuário ("Só vale para compras novas").

alter table public.accounts
  add column if not exists closing_day_inclusive boolean not null default false;

comment on column public.accounts.closing_day_inclusive is
  'Compra feita NO dia do fechamento entra na fatura que fecha nesse dia (true) ou já na '
  'seguinte (false). Varia por emissor; false é o medido no Nubank e o padrão histórico. '
  'Só afeta lançamentos novos — o trigger set_invoice não reclassifica o que já existe.';

-- A 3-arg SAI: com as duas vivas, `invoice_window(a,b,c)` ficaria ambígua e o Postgres recusaria
-- a chamada. A nova tem default, então todo chamador de três argumentos continua compilando.
drop function if exists private.invoice_window(int, int, date);

create or replace function private.invoice_window(
  p_closing_day int, p_due_day int, p_occurred date, p_inclusive boolean default false
)
returns table(reference_month date, closing_date date, due_date date)
language sql immutable set search_path = public
as $$
  with ref as (
    select case
      -- `<` contra a borda: a compra DO dia do fechamento já é da próxima fatura. Com
      -- `p_inclusive` a borda anda um dia para a frente, que é o mesmo que trocar por `<=` —
      -- uma expressão só, em vez de dois ramos que podem divergir.
      when p_occurred < private.day_in_month(p_occurred, p_closing_day)
                        + (case when p_inclusive then 1 else 0 end)
        then date_trunc('month', p_occurred)::date
      else (date_trunc('month', p_occurred) + interval '1 month')::date
    end as ref_month
  )
  select r.ref_month,
         private.day_in_month(r.ref_month, p_closing_day),
         case when p_due_day > p_closing_day
              then private.day_in_month(r.ref_month, p_due_day)
              else private.day_in_month(private.add_months(r.ref_month, 1), p_due_day)
         end
  from ref r;
$$;

-- O trigger passa a ler a chave do cartão. O resto do corpo é o da `20260911061000`, intacto
-- (inclusive a corrente de faturas adiadas).
create or replace function private.set_invoice()
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
  select * into win from private.invoice_window(
    card.closing_day, card.due_day, new.occurred_at, coalesce(card.closing_day_inclusive, false));
  insert into public.card_invoices
    (workspace_id, user_id, account_id, reference_month, closing_date, due_date)
  values (card.workspace_id, coalesce(new.user_id, card.user_id), new.account_id,
          win.reference_month, win.closing_date, win.due_date)
  on conflict (account_id, reference_month) do nothing;
  select ci.id into inv_id from public.card_invoices ci
    where ci.account_id = new.account_id and ci.reference_month = win.reference_month;

  -- Fatura adiada não recebe cobrança nova. Segue para onde o saldo dela foi.
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
