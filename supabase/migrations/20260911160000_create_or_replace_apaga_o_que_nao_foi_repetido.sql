-- `CREATE OR REPLACE FUNCTION` preserva dono e permissões — e SÓ isso.
--
-- A doc é literal: *"the ownership and permissions of the function do not change. **All other
-- function properties are assigned the values specified or implied in the command.**"* Ou seja,
-- toda cláusula que a definição nova não REPETE é APAGADA. As duas migrations de 11/09/2026
-- caíram nisso, cada uma de um jeito, e nenhuma das duas deu erro:
--
--   `20260911150000` — recriou `tg_transactions_set_invoice` sem `security definer`. O trigger
--                      INSERE em `card_invoices` a partir do insert do usuário; como invoker ele
--                      passa a depender da RLS de `card_invoices` para o role de quem lançou.
--   `20260911130000` — recriou `cycle_now` sem o `set timezone` que a `20260911030000` tinha
--                      pendurado por `alter function`. Sem ele o `current_date` de dentro dela
--                      volta a ser o dia do UTC, e das 21h à meia-noite o ciclo vira um dia
--                      cedo — exatamente o defeito que aquela migration existiu para matar, e no
--                      lugar mais visível (o painel da Hoje e o `diasAteOFim` da Projeção).
--
-- ⚠️ **Por isso o fuso entra no CABEÇALHO, não por `alter function` depois.** Pendurado por
-- `alter`, ele morre no próximo `create or replace` — que foi o que aconteceu aqui. No cabeçalho
-- ele viaja junto com o corpo. É o padrão que a `20260911040000` já usa.

-- 1. O trigger volta a ser `security definer` -------------------------------------------------
create or replace function public.tg_transactions_set_invoice()
returns trigger
language plpgsql
security definer
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
  -- a borda do dia do fechamento é do CARTÃO (`20260911140000`)
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

-- 2. `cycle_now` volta a enxergar o dia do BRASIL ---------------------------------------------
create or replace function public.cycle_now()
returns jsonb
language sql stable
set search_path = public
set timezone to 'America/Sao_Paulo'
as $$
  with ws as (select array(select private.my_workspace_ids()) as ids),
  cru as (
    -- `in (select ...)` e não `any((select ids from ws))`: aquele compara uuid com uuid[] e o
    -- Postgres recusa com 42883 — a CTE devolve UMA LINHA cujo valor é o array, não um conjunto.
    select w.cycle_close_day as dia, w.cycle_view as modo
    from public.workspaces w
    where w.id in (select private.my_workspace_ids()) order by w.id limit 1
  ),
  cfg as (select private.cycle_close_day((select ids from ws)) as dia),
  atual as (
    select private.cycle_month_of((select dia from cfg), current_date) as mes
  ),
  b as (
    select * from private.cycle_bounds((select dia from cfg), (select mes from atual))
  )
  select jsonb_build_object(
    'closeDay', (select dia from cru),
    'view', coalesce((select modo from cru), 'cycle'),
    'mes', to_char((select mes from atual), 'YYYY-MM'),
    'de', (select ini from b),
    'ate', (select fim from b),
    -- piso 1: no ÚLTIMO dia do ciclo a projeção ainda precisa de uma janela para existir, e
    -- pedir 0 dias devolveria a série vazia e um painel sem número.
    'diasAteOFim', greatest(1, (select fim from b) - current_date)
  );
$$;

-- 3. A sobra de assinatura de `month_group` ----------------------------------------------------
-- A `20260911001500` criou `month_group(jsonb)`; a `20260911021000` criou
-- `month_group(jsonb, int default null)` sem dropar a primeira. As duas vivas, uma chamada de UM
-- argumento é ambígua e o Postgres recusa. Ninguém chama assim hoje — é a armadilha esperando.
drop function if exists private.month_group(jsonb);

-- 4. `workspaces` entra no Realtime ------------------------------------------------------------
-- `useCycle`/`useCycleRange` já chamam `useRealtimeInvalidate('workspaces', ...)` desde a
-- `20260911020000`, e a tabela nunca esteve na publicação: trocar a régua num aparelho não
-- chegava no outro. Funcionava por acidente, porque quem troca também invalida localmente.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'workspaces'
  ) then
    alter publication supabase_realtime add table public.workspaces;
  end if;
end $$;
