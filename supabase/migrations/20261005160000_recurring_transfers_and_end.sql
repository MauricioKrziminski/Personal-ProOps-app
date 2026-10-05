-- F18: transferência recorrente entre contas próprias + encerrar uma série (assinatura cancelada).
--
-- A. `end_recurring_series`: define o fim e tira, na mesma transação, as cobranças futuras ainda
--    em aberto depois dele. Pagas, atrasadas e as de fatura paga/adiada/paga em parte ficam (as
--    últimas são contadas). Idempotente por chave de requisição (recibo selado, como F11/F12).
-- B. `recurring_transactions.counterparty_account_id`: a série de transferência tem origem
--    (`account_id`) e destino. A ocorrência é uma `transactions kind='transfer'` normal.
--
-- Reabrir uma série = editar o fim: o gatilho `zy_recurring_end_bounds` zera `materialized_until`
-- (o agendador gera de novo o trecho que o encerramento tirou) e reativa a série que o próprio
-- fim esgotou. O UPDATE da série sempre vem ANTES do DELETE das ocorrências: `marca_serie_editada`
-- evita que cada data apagada vire "pulada" em `recurring_moved_occurrences` (senão reabrir nunca
-- traria as datas de volta).
-- Testes: `supabase/tests/recurring_transfers_and_end.sql`.

-- ── B1. coluna, versões e checks ────────────────────────────────────────────
alter table public.recurring_transactions
  add column if not exists counterparty_account_id uuid references public.accounts(id) on delete set null;
create index if not exists recurring_transactions_counterparty_idx
  on public.recurring_transactions(counterparty_account_id) where counterparty_account_id is not null;
alter table private.recurring_history_versions
  add column if not exists counterparty_account_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.recurring_transactions'::regclass
                 and conname = 'recurring_transactions_transfer_accounts_check') then
    alter table public.recurring_transactions add constraint recurring_transactions_transfer_accounts_check
      check (kind <> 'transfer' or (account_id is not null and counterparty_account_id is not null
                                    and account_id <> counterparty_account_id)) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.recurring_transactions'::regclass
                 and conname = 'recurring_transactions_counterparty_kind_check') then
    alter table public.recurring_transactions add constraint recurring_transactions_counterparty_kind_check
      check (kind = 'transfer' or counterparty_account_id is null) not valid;
  end if;
  -- ponytail: transferência antiga SEM contraparte (o app a gravava como despesa, então não deve
  -- haver) mantém o check `not valid`; qualquer UPDATE nela exige escolher o destino primeiro.
  if not exists (select 1 from public.recurring_transactions
                 where kind = 'transfer' and (account_id is null or counterparty_account_id is null
                       or account_id = counterparty_account_id))
     and not exists (select 1 from public.recurring_transactions
                     where kind <> 'transfer' and counterparty_account_id is not null) then
    alter table public.recurring_transactions validate constraint recurring_transactions_transfer_accounts_check;
    alter table public.recurring_transactions validate constraint recurring_transactions_counterparty_kind_check;
  end if;
end $$;

-- Escopo: as duas contas são do espaço da série, o destino nunca é cartão.
create or replace function private.recurring_transfer_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind <> 'transfer' then
    if new.counterparty_account_id is not null then
      raise exception using errcode = 'P0001', message = 'Só a transferência tem conta de destino.';
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' and old.kind = 'transfer' and old.account_id is not distinct from new.account_id
     and old.counterparty_account_id is not distinct from new.counterparty_account_id then
    return new;
  end if;
  if new.account_id is null or new.counterparty_account_id is null then
    raise exception using errcode = 'P0001', message = 'Escolha de qual conta sai e para qual conta vai.';
  end if;
  if new.account_id = new.counterparty_account_id then
    raise exception using errcode = 'P0001', message = 'A conta de origem e a de destino precisam ser diferentes.';
  end if;
  if not exists (select 1 from public.accounts a where a.id = new.account_id
                 and a.workspace_id = new.workspace_id)
     or not exists (select 1 from public.accounts a where a.id = new.counterparty_account_id
                    and a.workspace_id = new.workspace_id) then
    raise exception using errcode = 'P0001', message = 'As duas contas precisam ser deste espaço.';
  end if;
  if exists (select 1 from public.accounts a where a.id in (new.account_id, new.counterparty_account_id)
             and a.archived) then
    raise exception using errcode = 'P0001', message = 'Conta arquivada não pode ser origem nem destino da transferência.';
  end if;
  if exists (select 1 from public.accounts a where a.id = new.counterparty_account_id
             and a.type = 'credit_card') then
    raise exception using errcode = 'P0001', message = 'O destino da transferência não pode ser um cartão.';
  end if;
  return new;
end $$;
revoke execute on function private.recurring_transfer_scope() from public, anon, authenticated;
drop trigger if exists recurring_transfer_scope on public.recurring_transactions;
create trigger recurring_transfer_scope before insert or update on public.recurring_transactions
  for each row execute function private.recurring_transfer_scope();

-- O histórico de versões guarda a contraparte (a versão aberta acompanha a série).
create or replace function private.sync_recurring_counterparty_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.recurring_history_versions v
     set counterparty_account_id = new.counterparty_account_id
   where v.recurring_id = new.id
     and v.counterparty_account_id is distinct from new.counterparty_account_id
     and (v.valid_through is null or v.counterparty_account_id is null);
  return null;
end $$;
revoke execute on function private.sync_recurring_counterparty_history() from public, anon, authenticated;
drop trigger if exists zz_sync_recurring_counterparty_history on public.recurring_transactions;
create trigger zz_sync_recurring_counterparty_history after insert or update on public.recurring_transactions
  for each row execute function private.sync_recurring_counterparty_history();
update private.recurring_history_versions v set counterparty_account_id = r.counterparty_account_id
  from public.recurring_transactions r
 where r.id = v.recurring_id and r.counterparty_account_id is not null
   and v.counterparty_account_id is null and v.valid_through is null;

-- A contraparte vigente numa data (a versão; senão a série).
create or replace function private.recurring_counterparty_at(p_recurring uuid, p_date date)
returns uuid language sql stable security invoker set search_path = '' as $$
  select coalesce(
    (select v.counterparty_account_id from private.recurring_history_versions v
      where v.recurring_id = p_recurring and v.valid_from <= p_date
        and (v.valid_through is null or v.valid_through >= p_date)
      order by v.valid_from desc limit 1),
    (select r.counterparty_account_id from public.recurring_transactions r where r.id = p_recurring))
$$;
revoke execute on function private.recurring_counterparty_at(uuid, date) from public, anon;
grant execute on function private.recurring_counterparty_at(uuid, date) to authenticated, service_role;

-- ── A1. o fim mexe no que o agendador já gerou ──────────────────────────────
-- Fim mais cedo: o que passou dele não conta como gerado. Fim removido/adiado (reabrir): gera de
-- novo desde o começo (as datas que existem batem no unique), e a série que o próprio fim
-- esgotou (inativa, sem erro, fim antes do próximo vencimento ou já passado) volta a ficar ativa.
create or replace function private.recurring_end_bounds()
returns trigger
language plpgsql
set search_path = ''
as $$
declare tz text := 'America/Sao_Paulo'; proximo date;
begin
  if new.end_date is not distinct from old.end_date then return new; end if;
  if old.end_date is not null and (new.end_date is null or new.end_date > old.end_date) then
    -- O encerramento deixa `next_run_at` parado. Reabrindo com ele no passado, o agendador
    -- recomeçaria dali e gravaria as datas que já passaram como pagas: vai para a próxima FUTURA,
    -- no mesmo horário.
    if new.next_run_at < now() then
      select min(d.due_date) into proximo
        from private.recurring_dates_for(new.rrule,
          (coalesce(new.dtstart, new.next_run_at) at time zone tz)::date,
          (now() at time zone tz)::date, (now() at time zone tz)::date + 400) d;
      if proximo is not null then
        new.next_run_at := (proximo + (new.next_run_at at time zone tz)::time) at time zone tz;
      end if;
    end if;
    if not old.active and old.last_error is null
       and (old.end_date < (now() at time zone tz)::date
            or old.end_date < (old.next_run_at at time zone tz)::date) then
      new.active := true;
    end if;
    new.materialized_until := null;
  elsif new.end_date is not null and new.materialized_until is not null
        and (new.materialized_until at time zone tz)::date > new.end_date then
    new.materialized_until := null;
  end if;
  return new;
end $$;
revoke execute on function private.recurring_end_bounds() from public, anon, authenticated;
drop trigger if exists zy_recurring_end_bounds on public.recurring_transactions;
create trigger zy_recurring_end_bounds before update of end_date on public.recurring_transactions
  for each row execute function private.recurring_end_bounds();

-- ── A2. encerrar uma série ──────────────────────────────────────────────────
create table if not exists private.recurring_end_receipts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, request_id)
);
create index if not exists recurring_end_receipts_workspace_idx on private.recurring_end_receipts(workspace_id);
alter table private.recurring_end_receipts enable row level security;
revoke all on private.recurring_end_receipts from public, anon, authenticated, service_role;

-- As cobranças que um fim em `p_last` tira: pendentes ainda por vir (vencimento fora do cartão, data
-- da compra no cartão) depois dele. `locked` = fatura paga, adiada ou paga em parte: essas ficam.
-- UMA régua para o "Encerrar" e para o fim editado no formulário da série.
create or replace function private.series_end_scope(p_series uuid, p_workspace uuid, p_last date)
returns table(id uuid, amount_cents bigint, locked boolean)
language sql stable set search_path = public
as $$
  select s.id, s.amount_cents, private.parcela_travada(s.status, s.invoice_id)
  from (
    select t.id, t.amount_cents, t.status, t.invoice_id,
      case when t.invoice_id is null then coalesce(t.due_at, t.occurred_at) else t.occurred_at end as dia
    from public.transactions t
    where t.recurring_id = p_series and t.workspace_id = p_workspace and t.status = 'pending'
      and (t.occurred_at >= current_date or (t.invoice_id is null and t.due_at >= current_date))
  ) s
  where s.dia > p_last
$$;
revoke execute on function private.series_end_scope(uuid, uuid, date) from public, anon;
grant execute on function private.series_end_scope(uuid, uuid, date) to authenticated, service_role;

-- UMA conta para a prévia e o comando: a confirmação e a escrita não podem discordar.
create or replace function private.end_recurring_series(
  p_recurring_id uuid, p_last_date date, p_request_id uuid, p_apply boolean
) returns jsonb
language plpgsql
security definer
set search_path = ''
set timezone to 'America/Sao_Paulo'
as $$
declare
  uid uuid := auth.uid();
  r public.recurring_transactions%rowtype;
  sealed private.recurring_end_receipts%rowtype;
  intent jsonb;
  tz text;
  start_day date;
  ids uuid[];
  result jsonb;
begin
  if uid is null then
    raise exception using errcode = '42501', message = 'Autenticação obrigatória';
  end if;
  if p_recurring_id is null or p_last_date is null then
    raise exception using errcode = '22023', message = 'Informe a série e a última cobrança';
  end if;
  if p_apply and p_request_id is null then
    raise exception using errcode = '22023', message = 'Identificador da tentativa obrigatório';
  end if;
  select * into r from public.recurring_transactions x where x.id = p_recurring_id;
  if r.id is null or not exists (select 1 from public.workspace_members m
                                 where m.workspace_id = r.workspace_id and m.user_id = uid) then
    raise exception using errcode = 'P0001', message = 'Recorrência não encontrada';
  end if;
  if p_apply then
    intent := jsonb_build_object('operation', 'end_recurring_series',
                                 'recurring_id', p_recurring_id, 'last_date', p_last_date);
    perform pg_advisory_xact_lock(hashtextextended('recurring-end:' || r.workspace_id::text, 0));
    select * into sealed from private.recurring_end_receipts
      where user_id = uid and request_id = p_request_id;
    if sealed.request_id is not null then
      if sealed.payload is distinct from intent then
        raise exception using errcode = '22023', message = 'Identificador reutilizado com dados diferentes';
      end if;
      return sealed.result;
    end if;
    select * into r from public.recurring_transactions x where x.id = p_recurring_id for update;
    -- Um "Paguei" ou o pagamento parcial de fatura concorrente não pode perder a linha para o DELETE.
    perform 1 from public.transactions t where t.recurring_id = r.id and t.workspace_id = r.workspace_id order by t.id for update;
  end if;

  select coalesce(p.timezone, 'America/Sao_Paulo') into tz from public.profiles p where p.id = r.user_id;
  -- O início original: `dtstart` é reescrito a cada edição de calendário, então vale o menor entre
  -- ele, a primeira versão da regra e a primeira ocorrência.
  start_day := least(
    (coalesce(r.dtstart, r.next_run_at) at time zone coalesce(tz, 'America/Sao_Paulo'))::date,
    (select min(v.valid_from) from private.recurring_history_versions v where v.recurring_id = r.id),
    (select min(t.occurred_at) from public.transactions t where t.recurring_id = r.id and t.workspace_id = r.workspace_id));
  if p_last_date < start_day then
    raise exception using errcode = 'P0001',
      message = 'A última cobrança não pode ser antes do início da série (' || to_char(start_day, 'DD/MM/YYYY') || ').';
  end if;

  -- A mesma régua de "futura em aberto" do editor de série: vencimento fora do cartão, data da
  -- compra no cartão. Atrasada (já venceu) e paga ficam.
  with s as (
    select t.id, t.status, t.amount_cents, t.invoice_id,
           case when t.invoice_id is null then coalesce(t.due_at, t.occurred_at) else t.occurred_at end as dia,
           (t.status = 'pending' and (t.occurred_at >= current_date
              or (t.invoice_id is null and t.due_at >= current_date))) as futura
    from public.transactions t
    where t.recurring_id = r.id and t.workspace_id = r.workspace_id
  ), e as (select * from private.series_end_scope(r.id, r.workspace_id, p_last_date))
  select jsonb_build_object(
      'removed_count', (select count(*) from e where not e.locked),
      'removed_cents', (select coalesce(sum(e.amount_cents), 0) from e where not e.locked),
      'kept_locked_count', (select count(*) from e where e.locked),
      'kept_paid_count', count(*) filter (where s.status = 'cleared'),
      'kept_overdue_count', count(*) filter (where s.status = 'pending' and not s.futura),
      'kept_upcoming_count', count(*) filter (where s.futura and s.dia <= p_last_date),
      'end_date', p_last_date),
    (select array_agg(e.id) from e where not e.locked)
  into result, ids from s;
  -- `removed_cents` sai como número JSON (centavos inteiros): o app lê com Number().
  if not p_apply then return result; end if;

  -- O UPDATE vem antes do DELETE: ver o cabeçalho (`marca_serie_editada`).
  update public.recurring_transactions x set end_date = p_last_date where x.id = r.id;
  if ids is not null then
    -- Reconferido na hora de apagar: só sai o que continua em aberto e fora de fatura travada.
    delete from public.transactions t where t.id = any(ids) and t.workspace_id = r.workspace_id
      and t.status = 'pending' and not private.parcela_travada(t.status, t.invoice_id);
  end if;
  insert into private.recurring_end_receipts(user_id, request_id, workspace_id, payload, result)
    values (uid, p_request_id, r.workspace_id, intent, result);
  return result;
end $$;
revoke execute on function private.end_recurring_series(uuid, date, uuid, boolean) from public, anon;
grant execute on function private.end_recurring_series(uuid, date, uuid, boolean) to authenticated;

create or replace function public.end_recurring_series(p_recurring_id uuid, p_last_date date, p_request_id uuid)
returns jsonb language sql security invoker set search_path = '' set timezone to 'America/Sao_Paulo' as $$
  select private.end_recurring_series(p_recurring_id, p_last_date, p_request_id, true)
$$;
create or replace function public.end_recurring_series_preview(p_recurring_id uuid, p_last_date date)
returns jsonb language sql security invoker set search_path = '' set timezone to 'America/Sao_Paulo' as $$
  select private.end_recurring_series(p_recurring_id, p_last_date, null, false)
$$;
revoke execute on function public.end_recurring_series(uuid, date, uuid) from public, anon;
revoke execute on function public.end_recurring_series_preview(uuid, date) from public, anon;
grant execute on function public.end_recurring_series(uuid, date, uuid) to authenticated;
grant execute on function public.end_recurring_series_preview(uuid, date) to authenticated;

-- ── B2. editar a série: o destino entra nas listas permitidas ──────────────────
-- Cópia da definição vigente (20260930163000) com `counterparty_account_id` acrescentado.
create or replace function private.update_recurring_series_context(
  p_recurring_id uuid,
  p_patch jsonb,
  p_propagate boolean default true,
  p_transaction_id uuid default null,
  p_line_patch jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security invoker
set search_path = public
set timezone to 'America/Sao_Paulo'
as $$
declare
  serie   record;
  changed bigint := 0;
  proxima timestamptz;
  fica    record;
  periodo text;
  movida  uuid;
  dia     int;
  passo   int;
  anchor public.transactions%rowtype;
  original_date date;
  from_occurrence boolean := false;
  targets uuid[];
  line_changed bigint := 0;
  acc_new uuid;
  cp_new uuid;
begin
  p_patch := coalesce(p_patch, '{}'::jsonb);
  p_line_patch := coalesce(p_line_patch, '{}'::jsonb);
  if jsonb_typeof(p_patch) <> 'object' or jsonb_typeof(p_line_patch) <> 'object' then
    raise exception 'Alteracoes precisam ser objetos';
  end if;
  -- O destino da transferência é do contrato: vindo no patch da ocorrência, vale como o da série
  -- (a propagação abaixo já o leva só às ocorrências do alcance).
  if p_line_patch ? 'counterparty_account_id' then
    if p_patch ? 'counterparty_account_id'
       and p_patch->'counterparty_account_id' is distinct from p_line_patch->'counterparty_account_id' then
      raise exception using errcode = 'P0001', message = 'O destino da ocorrência e o da regra precisam coincidir';
    end if;
    p_patch := p_patch || jsonb_build_object('counterparty_account_id', p_line_patch->'counterparty_account_id');
    p_line_patch := p_line_patch - 'counterparty_account_id';
  end if;
  if p_patch = '{}'::jsonb and p_line_patch = '{}'::jsonb then
    raise exception 'Nada para alterar';
  end if;
  if exists (
    select 1 from unnest(array(select jsonb_object_keys(p_patch))) k
    where k not in ('amount_cents', 'category', 'description', 'account_id',
                    'auto_confirm', 'end_date', 'kind', 'merchant', 'rrule', 'next_run_at',
                    'counterparty_account_id')
  ) then
    raise exception 'Campo não permitido nesta alteração';
  end if;
  if p_patch ? 'amount_cents'
     and coalesce((p_patch->>'amount_cents')::bigint, 0) <= 0 then
    raise exception 'O valor precisa ser maior que zero';
  end if;
  if p_patch ? 'kind' and p_patch->>'kind' = 'transfer' then
    raise exception using errcode = 'P0001', message = 'Para trocar o tipo da série, converta o registro.';
  end if;
  if p_patch ? 'kind' and coalesce(p_patch->>'kind', '') not in ('expense', 'income') then
    raise exception 'A série é de saída ou de entrada';
  end if;
  if (p_patch ? 'rrule') <> (p_patch ? 'next_run_at') then
    raise exception 'A repetição e o próximo vencimento mudam juntos';
  end if;
  if p_patch ? 'rrule' then
    if coalesce(p_patch->>'rrule', '') !~ '^FREQ=(MONTHLY(;INTERVAL=([2-9]|[1-9][0-9]))?;BYMONTHDAY=(-1|[1-9]|[12][0-9]|3[01])|WEEKLY;BYDAY=(SU|MO|TU|WE|TH|FR|SA)|YEARLY;BYMONTH=([1-9]|1[0-2]);BYMONTHDAY=([1-9]|[12][0-9]|3[01]))$' then
      raise exception 'Repetição inválida: use mensal, semanal ou anual';
    end if;
    proxima := (p_patch->>'next_run_at')::timestamptz;
    if proxima is null or proxima::date < current_date then
      raise exception 'O próximo vencimento não pode ser antes de hoje';
    end if;
  end if;

  select r.id, r.workspace_id, r.kind, r.account_id, r.counterparty_account_id into serie
  from public.recurring_transactions r where r.id = p_recurring_id
  for update;
  if serie.id is null then
    raise exception 'Recorrência não encontrada';
  end if;

  -- Transferência: origem e destino existem e diferem; trocar o tipo é conversão, não patch.
  if serie.kind = 'transfer' then
    if p_patch ? 'kind' then
      raise exception using errcode = 'P0001', message = 'Para trocar o tipo da série, converta o registro.';
    end if;
    acc_new := case when p_patch ? 'account_id' then nullif(p_patch->>'account_id', '')::uuid else serie.account_id end;
    cp_new := case when p_patch ? 'counterparty_account_id'
                   then nullif(p_patch->>'counterparty_account_id', '')::uuid else serie.counterparty_account_id end;
    if acc_new is null or cp_new is null then
      raise exception using errcode = 'P0001', message = 'Escolha de qual conta sai e para qual conta vai.';
    end if;
    if acc_new = cp_new then
      raise exception using errcode = 'P0001', message = 'A conta de origem e a de destino precisam ser diferentes.';
    end if;
    if not exists (select 1 from public.accounts a where a.id = cp_new
                   and a.workspace_id = serie.workspace_id and a.type <> 'credit_card') then
      raise exception using errcode = 'P0001', message = 'Escolha uma conta do espaço que não seja cartão para o destino.';
    end if;
  elsif p_patch ? 'counterparty_account_id' and p_patch->>'counterparty_account_id' is not null then
    raise exception using errcode = 'P0001', message = 'Só a transferência tem conta de destino.';
  end if;

  -- Capture the selected occurrence before metadata/account edits can change
  -- its due date or invoice. All selectors below reuse this original context.
  if p_transaction_id is not null then
    select * into anchor from public.transactions where id=p_transaction_id for update;
    if anchor.id is null or anchor.recurring_id is distinct from serie.id
       or anchor.workspace_id is distinct from serie.workspace_id then
      raise exception 'Ocorrencia e serie precisam pertencer ao mesmo registro';
    end if;
    original_date := case when anchor.invoice_id is null
      then coalesce(anchor.due_at,anchor.occurred_at) else anchor.occurred_at end;
    from_occurrence := anchor.status='pending' and original_date>=current_date;
    if from_occurrence then
      if p_patch ? 'rrule' and private.parcela_travada(anchor.status,anchor.invoice_id) then
        raise exception 'Ocorrência em fatura paga, adiada ou paga em parte: a data não muda';
      end if;
      perform 1 from public.transactions t where t.recurring_id=serie.id
        and t.workspace_id=serie.workspace_id order by t.id for update;
      select array_agg(t.id) into targets from public.transactions t
        where t.recurring_id=serie.id and t.workspace_id=serie.workspace_id
          and t.status='pending'
          and case when t.invoice_id is null then coalesce(t.due_at,t.occurred_at)
            else t.occurred_at end >= original_date;
    end if;
  elsif p_line_patch <> '{}'::jsonb then
    raise exception 'Uma alteração de ocorrência precisa da ocorrência de referência';
  end if;

  if p_line_patch <> '{}'::jsonb then
    if not from_occurrence then
      -- Paid/overdue anchors keep the existing metadata scope and calendar slide.
      line_changed := public.update_transaction_scoped(p_transaction_id,'future',p_line_patch);
    else
      if exists(select 1 from jsonb_object_keys(p_line_patch) k where k not in
        ('amount_cents','category','description','merchant','account_id')) then
        raise exception 'Campo não permitido nesta alteração';
      end if;
      if p_line_patch ? 'amount_cents' and coalesce((p_line_patch->>'amount_cents')::bigint,0)<=0 then
        raise exception 'O valor precisa ser maior que zero';
      end if;
      if p_line_patch ? 'account_id' and p_line_patch->>'account_id' is not null
        and not exists(select 1 from public.accounts a where a.id=(p_line_patch->>'account_id')::uuid
          and a.workspace_id=serie.workspace_id) then
        raise exception 'Conta precisa ser do mesmo workspace do lançamento';
      end if;
      if p_line_patch ? 'account_id' and exists(select 1 from public.transactions t
        where t.id=any(targets) and private.parcela_travada(t.status,t.invoice_id)
          and t.account_id is distinct from (p_line_patch->>'account_id')::uuid) then
        raise exception 'Ocorrência em fatura paga, adiada ou paga em parte: a conta não muda';
      end if;
      update public.transactions t set
        amount_cents=coalesce((p_line_patch->>'amount_cents')::bigint,t.amount_cents),
        category=case when p_line_patch ? 'category' then p_line_patch->>'category' else t.category end,
        description=case when p_line_patch ? 'description' then p_line_patch->>'description' else t.description end,
        merchant=case when p_line_patch ? 'merchant' then p_line_patch->>'merchant' else t.merchant end
      where t.id=any(targets);
      get diagnostics line_changed=row_count;
      if p_line_patch ? 'account_id' then
        update public.transactions t set account_id=(p_line_patch->>'account_id')::uuid where t.id=any(targets);
      end if;
      update public.recurring_transactions r set
        amount_cents=coalesce((p_line_patch->>'amount_cents')::bigint,r.amount_cents),
        category=case when p_line_patch ? 'category' then p_line_patch->>'category' else r.category end,
        description=case when p_line_patch ? 'description' then p_line_patch->>'description' else r.description end,
        merchant=case when p_line_patch ? 'merchant' then nullif(p_line_patch->>'merchant','') else r.merchant end,
        account_id=case when p_line_patch ? 'account_id' then (p_line_patch->>'account_id')::uuid else r.account_id end
      where r.id=serie.id;
    end if;
  end if;
  if p_patch = '{}'::jsonb then return line_changed; end if;

  if p_patch ? 'rrule' then
    periodo := case when p_patch->>'rrule' like 'FREQ=WEEKLY%' then 'week'
                    when p_patch->>'rrule' like 'FREQ=YEARLY%' then 'year' else 'month' end;
    -- A mais recente das que FICAM (tudo menos a em aberto que ainda não venceu). O dia dela é o
    -- vencimento fora do cartão; no cartão, a data da compra.
    select x.dia, x.status into fica
    from (
      select case when t.invoice_id is null then coalesce(t.due_at, t.occurred_at) else t.occurred_at end as dia,
             t.status
      from public.transactions t
      where t.recurring_id = serie.id and t.workspace_id = serie.workspace_id
        and not (t.status = 'pending'
                 and (t.occurred_at >= current_date or (t.invoice_id is null and t.due_at >= current_date))
                 and (not from_occurrence or not private.parcela_travada(t.status,t.invoice_id)))
    ) x
    order by x.dia desc
    limit 1;
    -- O período dela já tem a sua cobrança: o calendário novo começa no primeiro período DEPOIS
    -- dela, no dia da regra — nunca recusa (27/09/2026: dia 4 → dia 31 com setembro pago dava
    -- erro, e o que a pessoa queria era mudar o dia da série inteira). A que fica não se move.
    dia := case when p_patch->>'rrule' like '%BYMONTHDAY=-1%' then 31
                else ((regexp_match(p_patch->>'rrule', 'BYMONTHDAY=([0-9]+)'))[1])::int end;
    passo := coalesce(((regexp_match(p_patch->>'rrule', 'INTERVAL=([0-9]+)'))[1])::int, 1);
    while fica.dia is not null and date_trunc(periodo, proxima::date) <= date_trunc(periodo, fica.dia) loop
      proxima := ((case periodo
                     when 'week' then proxima::date + 7
                     when 'year' then private.day_in_month((date_trunc('month', proxima::date) + interval '1 year')::date, dia)
                     else private.day_in_month((date_trunc('month', proxima::date) + make_interval(months => passo))::date, dia)
                   end) + proxima::time)::timestamptz;
    end loop;
  end if;

  if p_patch ? 'account_id' and p_patch->>'account_id' is not null and not exists (
    select 1 from public.accounts a
    where a.id = (p_patch->>'account_id')::uuid and a.workspace_id = serie.workspace_id
  ) then
    raise exception 'Conta precisa ser do mesmo workspace da série';
  end if;

  update public.recurring_transactions r set
    amount_cents = coalesce((p_patch->>'amount_cents')::bigint, r.amount_cents),
    category     = case when p_patch ? 'category'     then p_patch->>'category'     else r.category end,
    description  = case when p_patch ? 'description'  then p_patch->>'description'  else r.description end,
    merchant     = case when p_patch ? 'merchant'     then nullif(p_patch->>'merchant', '') else r.merchant end,
    kind         = case when p_patch ? 'kind'         then p_patch->>'kind'         else r.kind end,
    account_id   = case when p_patch ? 'account_id'   then (p_patch->>'account_id')::uuid else r.account_id end,
    counterparty_account_id = case when p_patch ? 'counterparty_account_id'
                                   then nullif(p_patch->>'counterparty_account_id', '')::uuid
                                   else r.counterparty_account_id end,
    auto_confirm = case when p_patch ? 'auto_confirm' then (p_patch->>'auto_confirm')::boolean else r.auto_confirm end,
    end_date     = case when p_patch ? 'end_date'     then (p_patch->>'end_date')::date else r.end_date end,
    rrule        = case when p_patch ? 'rrule'        then p_patch->>'rrule'        else r.rrule end,
    dtstart      = case when p_patch ? 'rrule'        then proxima                  else r.dtstart end,
    next_run_at  = case when p_patch ? 'rrule'        then proxima                  else r.next_run_at end,
    materialized_until = case when p_patch ? 'rrule'  then null                     else r.materialized_until end
  where r.id = serie.id;

  if from_occurrence and p_patch ? 'rrule' then
    perform private.close_recurring_history_at_scope(serie.id,original_date);
  end if;

  if p_patch ? 'rrule' then
    -- With occurrence context, move the selected id and rebuild only the target
    -- ids captured against its original cutoff. Direct/all and paid/overdue
    -- contexts keep the first open occurrence in the requested calendar period.
    if from_occurrence then
      movida := anchor.id;
    else
      select t.id into movida
      from public.transactions t
      where t.recurring_id = serie.id
        and t.workspace_id = serie.workspace_id
        and t.status = 'pending'
        and (t.occurred_at >= current_date or (t.invoice_id is null and t.due_at >= current_date))
        and date_trunc(periodo, case when t.invoice_id is null then coalesce(t.due_at, t.occurred_at) else t.occurred_at end)
            >= date_trunc(periodo, proxima::date)
      order by case when t.invoice_id is null then coalesce(t.due_at, t.occurred_at) else t.occurred_at end
      limit 1;
    end if;

    -- Antes de mover: uma delas pode já estar na data nova, e o unique recusaria a movida.
    delete from public.transactions t
    where t.recurring_id = serie.id
      and t.workspace_id = serie.workspace_id
      and t.status = 'pending'
      and (t.occurred_at >= current_date or (t.invoice_id is null and t.due_at >= current_date))
      and ((from_occurrence and t.id=any(targets) and not private.parcela_travada(t.status,t.invoice_id))
        or (not from_occurrence and date_trunc(periodo,
          case when t.invoice_id is null then coalesce(t.due_at,t.occurred_at) else t.occurred_at end)
          >= date_trunc(periodo,proxima::date)))
      and t.id is distinct from movida;

    if movida is not null then
      if from_occurrence and exists(select 1 from public.transactions t where t.id=movida
        and private.parcela_travada(t.status,t.invoice_id)) then
        raise exception 'Ocorrência em fatura paga, adiada ou paga em parte: a data não muda';
      end if;
      update public.transactions t
         set occurred_at = proxima::date,
             due_at = case when t.invoice_id is null then proxima::date else t.due_at end
       where t.id = movida;
    end if;
  end if;

  if p_patch ? 'end_date' and p_patch->>'end_date' is not null then
    -- Fim mais cedo: o que passou dele não vai mais acontecer.
    -- A mesma régua do "Encerrar" (`private.series_end_scope`): vencimento fora do cartão e fatura
    -- paga/adiada/paga em parte fica.
    delete from public.transactions t
    where t.recurring_id = serie.id
      and t.workspace_id = serie.workspace_id
      and t.id in (select e.id from private.series_end_scope(serie.id, serie.workspace_id,
                     (p_patch->>'end_date')::date) e where not e.locked)
      and (not from_occurrence or t.id = any(targets));
  end if;

  if p_propagate then
    -- Mesmo cuidado da irmã: `account_id` só entra no `set` quando foi pedido, senão
    -- `set_invoice` recalcula a fatura de ocorrências que ninguém mandou mover.
    update public.transactions t set
      amount_cents = coalesce((p_patch->>'amount_cents')::bigint, t.amount_cents),
      category     = case when p_patch ? 'category'    then p_patch->>'category'    else t.category end,
      description  = case when p_patch ? 'description' then p_patch->>'description' else t.description end,
      merchant     = case when p_patch ? 'merchant'    then nullif(p_patch->>'merchant', '') else t.merchant end,
      kind         = case when p_patch ? 'kind'        then p_patch->>'kind'        else t.kind end
    where t.recurring_id = serie.id
      and t.workspace_id = serie.workspace_id
      and t.status = 'pending'
      and (t.occurred_at >= current_date or (t.invoice_id is null and t.due_at >= current_date))
      and (not from_occurrence or t.id=any(targets));
    get diagnostics changed = row_count;

    -- Origem e destino juntos numa só instrução: trocados entre si, um por vez violariam o check
    -- `account_id <> counterparty_account_id` da própria linha no meio do caminho.
    if p_patch ? 'account_id' and p_patch ? 'counterparty_account_id' then
      update public.transactions t
         set account_id = (p_patch->>'account_id')::uuid,
             counterparty_account_id = nullif(p_patch->>'counterparty_account_id', '')::uuid
       where t.recurring_id = serie.id
         and t.workspace_id = serie.workspace_id
         and t.status = 'pending'
         and (t.occurred_at >= current_date or (t.invoice_id is null and t.due_at >= current_date))
         and (not from_occurrence or t.id=any(targets));
    elsif p_patch ? 'account_id' then
      update public.transactions t
         set account_id = (p_patch->>'account_id')::uuid
       where t.recurring_id = serie.id
         and t.workspace_id = serie.workspace_id
         and t.status = 'pending'
         and (t.occurred_at >= current_date or (t.invoice_id is null and t.due_at >= current_date))
         and (not from_occurrence or t.id=any(targets));
    elsif p_patch ? 'counterparty_account_id' then
      update public.transactions t
         set counterparty_account_id = nullif(p_patch->>'counterparty_account_id', '')::uuid
       where t.recurring_id = serie.id
         and t.workspace_id = serie.workspace_id
         and t.status = 'pending'
         and (t.occurred_at >= current_date or (t.invoice_id is null and t.due_at >= current_date))
         and (not from_occurrence or t.id=any(targets));
    end if;
  end if;

  return greatest(changed,line_changed);
end;
$$;

revoke execute on function private.update_recurring_series_context(uuid,jsonb,boolean,uuid,jsonb) from public,anon;
grant execute on function private.update_recurring_series_context(uuid,jsonb,boolean,uuid,jsonb) to authenticated;

-- `update_recurring_all` tem uma lista própria (e longa) de campos da regra. Em vez de copiá-la,
-- uma camada aceita só o destino; o resto segue pela definição vigente, renomeada uma única vez.
do $$
begin
  if to_regprocedure('private.update_recurring_all_counterparty_core(uuid,jsonb,jsonb,bigint,uuid)') is null then
    alter function public.update_recurring_all(uuid,jsonb,jsonb,bigint,uuid) set schema private;
    alter function private.update_recurring_all(uuid,jsonb,jsonb,bigint,uuid)
      rename to update_recurring_all_counterparty_core;
  end if;
end $$;
revoke execute on function private.update_recurring_all_counterparty_core(uuid,jsonb,jsonb,bigint,uuid) from public, anon;
grant execute on function private.update_recurring_all_counterparty_core(uuid,jsonb,jsonb,bigint,uuid) to authenticated;

create or replace function public.update_recurring_all(
  p_recurring_id uuid, p_line_patch jsonb, p_series_patch jsonb, p_expected_revision bigint, p_request_id uuid
) returns bigint
language plpgsql security invoker set search_path = public set timezone to 'America/Sao_Paulo'
as $$
declare
  r public.recurring_transactions%rowtype;
  new_cp uuid;
  changed bigint;
  moved bigint := 0;
begin
  if p_series_patch is null or jsonb_typeof(p_series_patch) <> 'object' or not (p_series_patch ? 'counterparty_account_id') then
    return private.update_recurring_all_counterparty_core(p_recurring_id, p_line_patch, p_series_patch,
                                                          p_expected_revision, p_request_id);
  end if;
  new_cp := nullif(p_series_patch->>'counterparty_account_id', '')::uuid;
  select * into r from public.recurring_transactions x where x.id = p_recurring_id for update;
  if r.id is null or r.workspace_id not in (select private.my_workspace_ids()) then
    raise exception using errcode = 'P0001', message = 'Recorrência não encontrada';
  end if;
  if r.kind <> 'transfer' then
    raise exception using errcode = 'P0001', message = 'Só a transferência tem conta de destino.';
  end if;
  if new_cp is null then
    raise exception using errcode = 'P0001', message = 'Escolha para qual conta vai.';
  end if;
  -- Reenvio da mesma requisição: o destino já é o pedido e o miolo devolve o resultado guardado.
  if new_cp is distinct from r.counterparty_account_id
     and r.edit_revision is distinct from p_expected_revision then
    raise exception using errcode = 'P0001', message = 'A recorrência mudou enquanto você editava. Abra de novo antes de salvar.';
  end if;
  changed := private.update_recurring_all_counterparty_core(p_recurring_id, p_line_patch,
    p_series_patch - 'counterparty_account_id', p_expected_revision, p_request_id);
  select * into r from public.recurring_transactions x where x.id = p_recurring_id for update;
  if new_cp is distinct from r.counterparty_account_id then
    if new_cp = r.account_id then
      raise exception using errcode = 'P0001', message = 'A conta de origem e a de destino precisam ser diferentes.';
    end if;
    if not exists (select 1 from public.accounts a where a.id = new_cp
                   and a.workspace_id = r.workspace_id and a.type <> 'credit_card') then
      raise exception using errcode = 'P0001', message = 'Escolha uma conta do espaço que não seja cartão para o destino.';
    end if;
    update public.recurring_transactions x set counterparty_account_id = new_cp where x.id = r.id;
    update public.transactions t set counterparty_account_id = new_cp
     where t.recurring_id = r.id and t.workspace_id = r.workspace_id and t.kind = 'transfer';
    get diagnostics moved = row_count;
  end if;
  return greatest(changed, moved);
end $$;
comment on function public.update_recurring_all(uuid,jsonb,jsonb,bigint,uuid) is
  'Camada F18: aceita counterparty_account_id e delega o resto a private.update_recurring_all_counterparty_core. Um create or replace futuro DEVE preservar essa camada (ou o destino some em silencio).';
revoke execute on function public.update_recurring_all(uuid,jsonb,jsonb,bigint,uuid) from public, anon;
grant execute on function public.update_recurring_all(uuid,jsonb,jsonb,bigint,uuid) to authenticated;

-- Tocar na prevista: a transferência nasce com o destino (e a gêmea solta só casa com o mesmo destino).
create or replace function public.materialize_recurring_occurrence(
  p_recurring_id uuid, p_date date
) returns uuid
language plpgsql volatile security invoker
set search_path = public
set timezone to 'America/Sao_Paulo'
as $$
declare
  achado uuid;
  prevista record;
  serie public.recurring_transactions%rowtype;
  cp uuid;
begin
  if p_recurring_id is null or p_date is null then
    raise exception 'Informe a recorrente e o dia';
  end if;
  select * into serie from public.recurring_transactions r where r.id = p_recurring_id for share;
  if serie.id is null then
    raise exception 'Essa ocorrência não existe mais na recorrente.' using errcode = 'P0001';
  end if;

  select t.id into achado from public.transactions t
   where t.recurring_id = p_recurring_id and t.occurred_at = p_date;
  if achado is not null then
    return achado;
  end if;

  select * into prevista
    from public.expected_recurring_occurrences(p_date, p_date, p_recurring_id) e
   where e.due_date = p_date
   limit 1;
  if not found then
    raise exception 'Essa ocorrência não existe mais na recorrente.' using errcode = 'P0001';
  end if;
  if prevista.inferred_start then
    raise exception 'Essa data é uma estimativa da recorrente: não vira lançamento.' using errcode = 'P0001';
  end if;
  if prevista.kind = 'transfer' then
    cp := private.recurring_counterparty_at(serie.id, p_date);
    if cp is null then
      raise exception 'Escolha para qual conta vai antes de gravar essa transferência.' using errcode = 'P0001';
    end if;
  end if;

  if p_date <= current_date then
    update public.transactions t set recurring_id = serie.id, subcategory_snapshot_set=true
     where t.id = (
       select g.id from public.transactions g
        where g.workspace_id = serie.workspace_id and g.recurring_id is null
          and g.kind = prevista.kind and g.amount_cents = prevista.amount_cents
          and g.account_id is not distinct from prevista.account_id and g.occurred_at = p_date
          and g.counterparty_account_id is not distinct from cp
          and extensions.unaccent(lower(coalesce(g.description, '')))
            = extensions.unaccent(lower(coalesce(serie.description, '')))
        order by g.created_at
        limit 1)
    returning t.id into achado;
    if achado is not null then
      return achado;
    end if;
  end if;

  insert into public.transactions
    (user_id, workspace_id, kind, amount_cents, currency, category, description, merchant,
     account_id, counterparty_account_id, occurred_at, due_at, source, status, recurring_id, auto_confirm)
  values
    (serie.user_id, serie.workspace_id, prevista.kind, prevista.amount_cents, serie.currency,
     -- a leitura preenche o vazio ('outros', 'Recorrente'); a linha guarda o que a série guarda
     case when prevista.category = coalesce(serie.category, 'outros') then serie.category
          else prevista.category end,
     case when prevista.description = coalesce(nullif(serie.description, ''), serie.category, 'Recorrente')
          then serie.description else prevista.description end,
     serie.merchant, prevista.account_id, cp, p_date, p_date, 'recurring',
     case when p_date <= current_date and serie.auto_confirm then 'cleared' else 'pending' end,
     serie.id, serie.auto_confirm)
  on conflict (recurring_id, occurred_at) where recurring_id is not null do nothing
  returning id into achado;

  if achado is null then
    select t.id into achado from public.transactions t
     where t.recurring_id = p_recurring_id and t.occurred_at = p_date;
  end if;
  if achado is null then
    raise exception 'Não consegui abrir essa ocorrência.';
  end if;
  return achado;
end;
$$;

-- A projeção da regra tem DUAS portas. `recurring_projection_all_for` é a definição vigente
-- (20260928200010) intacta, com todos os tipos. `recurring_projection_for` continua sendo a que os
-- ~20 leitores de lista/ciclo/mês chamam, e ela NÃO devolve transferência: lá a conta é por
-- receita/despesa, e a transferência virava uma linha "R$ 0,00" fantasma. Só `eventos_de_caixa`
-- (as duas pernas por conta) lê a porta com tudo.
create or replace function private.recurring_projection_all_for(
  ws_ids uuid[], from_date date, to_date date
) returns table(recurring_id uuid,kind text,amount_cents bigint,category text,
  description text,account_id uuid,due_date date)
language sql stable set search_path = public
as $$
  select r.id,r.kind,r.amount_cents,coalesce(r.category,'outros'),
    coalesce(nullif(r.description,''),r.category,'Recorrente'),r.account_id,d.due_date
  from public.recurring_transactions r
  left join public.profiles p on p.id=r.user_id
  cross join lateral private.recurring_dates_for(r.rrule,
    (coalesce(r.dtstart,r.next_run_at) at time zone
      coalesce(p.timezone,'America/Sao_Paulo'))::date,from_date,to_date) d
  where r.workspace_id=any(ws_ids) and r.active
    and d.due_date >= (now() at time zone coalesce(p.timezone,'America/Sao_Paulo'))::date
    and d.due_date > coalesce((r.materialized_until at time zone
      coalesce(p.timezone,'America/Sao_Paulo'))::date,date '1900-01-01')
    and (r.end_date is null or d.due_date<=r.end_date)
    and not exists (select 1 from public.transactions t
      where t.workspace_id=r.workspace_id and t.recurring_id=r.id
        and t.occurred_at=d.due_date);
$$;
revoke execute on function private.recurring_projection_all_for(uuid[],date,date) from public,anon;
grant execute on function private.recurring_projection_all_for(uuid[],date,date) to authenticated,service_role;
create or replace function private.recurring_projection_for(
  ws_ids uuid[], from_date date, to_date date
) returns table(recurring_id uuid,kind text,amount_cents bigint,category text,
  description text,account_id uuid,due_date date)
language sql stable set search_path = public
as $$
  select p.recurring_id,p.kind,p.amount_cents,p.category,p.description,p.account_id,p.due_date
  from private.recurring_projection_all_for(ws_ids,from_date,to_date) p
  where p.kind <> 'transfer'
$$;
revoke execute on function private.recurring_projection_for(uuid[],date,date) from public,anon;
grant execute on function private.recurring_projection_for(uuid[],date,date) to authenticated,service_role;

-- Eventos de caixa: cópia da definição vigente (20261003002625) + as duas pernas da transferência prevista.
create or replace function private.eventos_de_caixa(ws_ids uuid[],ate date)
returns table(account_id uuid,day date,in_cents bigint,out_cents bigint)
language sql stable
set search_path = public
set timezone = 'America/Sao_Paulo'
as $$
  -- A recorrência é expandida UMA vez; as duas pernas da transferência leem a mesma CTE.
  with tr as materialized (
    select p.account_id as origem, r.counterparty_account_id as destino, p.due_date, p.amount_cents
    from private.recurring_projection_all_for(ws_ids,current_date,ate) p
    join public.recurring_transactions r on r.id=p.recurring_id
    join public.accounts o on o.id=p.account_id and o.type<>'credit_card'
    join public.accounts d on d.id=r.counterparty_account_id and d.type<>'credit_card'
    where p.kind='transfer'
  )
  select c.payment_account_id,greatest(ci.due_date,current_date),0::bigint,private.invoice_open_cents(ci.id)
  from public.card_invoices ci join public.accounts c on c.id=ci.account_id
  where ci.workspace_id=any(ws_ids) and ci.status not in('paid','rolled')
    and exists(select 1 from public.transactions t where t.invoice_id=ci.id and private.conta_na_fatura(t.kind))
    and greatest(ci.due_date,current_date)<=ate
  union all
  select t.account_id,greatest(coalesce(t.due_at,t.occurred_at),current_date),
    case when t.kind='income' then t.amount_cents else 0 end::bigint,
    case when t.kind='expense' then t.amount_cents else 0 end::bigint
  from public.transactions t
  where t.workspace_id=any(ws_ids) and t.status='pending' and t.invoice_id is null
    and t.kind<>'transfer'
    and (t.kind<>'income' or coalesce(t.due_at,t.occurred_at)>=current_date-3)
    and greatest(coalesce(t.due_at,t.occurred_at),current_date)<=ate
  union all
  select t.account_id,greatest(coalesce(t.due_at,t.occurred_at),current_date),0::bigint,t.amount_cents
  from public.transactions t
  join public.accounts o on o.id=t.account_id and o.type<>'credit_card'
  join public.accounts d on d.id=t.counterparty_account_id and d.type<>'credit_card'
  where t.workspace_id=any(ws_ids) and t.status='pending' and t.kind='transfer'
    and greatest(coalesce(t.due_at,t.occurred_at),current_date)<=ate
  union all
  select t.counterparty_account_id,greatest(coalesce(t.due_at,t.occurred_at),current_date),t.amount_cents,0::bigint
  from public.transactions t
  join public.accounts o on o.id=t.account_id and o.type<>'credit_card'
  join public.accounts d on d.id=t.counterparty_account_id and d.type<>'credit_card'
  where t.workspace_id=any(ws_ids) and t.status='pending' and t.kind='transfer'
    and greatest(coalesce(t.due_at,t.occurred_at),current_date)<=ate
  union all
  select d.account_id,greatest(s.due_date,current_date),0::bigint,s.payment_cents
  from public.debts d cross join lateral private.debt_schedule_for(d.id) s
  where d.workspace_id=any(ws_ids) and not d.archived and d.remaining_cents>0 and s.due_date<=ate
  union all
  -- Transferência recorrente prevista (da regra): sai de uma conta e entra na outra, mesmo dia.
  select tr.origem,tr.due_date,0::bigint,tr.amount_cents from tr
  union all
  select tr.destino,tr.due_date,tr.amount_cents,0::bigint from tr
  union all
  -- Bank/null origins keep their occurrence dates. Card expense reaches bank cash
  -- only at its resolved invoice due date; no payer is the existing "Sem conta" bucket.
  -- Legacy card income and absent card calendars cannot invent spendable bank cash.
  select case when a.type='credit_card' then a.payment_account_id else p.account_id end,
    case when a.type='credit_card' then greatest(target.due_date,current_date) else p.due_date end,
    case when p.kind='income' then p.amount_cents else 0 end::bigint,
    case when p.kind='expense' then p.amount_cents else 0 end::bigint
  from private.recurring_projection_for(ws_ids,current_date,ate) p
  left join public.accounts a on a.id=p.account_id
  left join lateral private.invoice_target_for(p.account_id,p.due_date) target on a.type='credit_card'
  where a.type is distinct from 'credit_card'
    or (p.kind='expense' and target.due_date is not null and greatest(target.due_date,current_date)<=ate);
$$;
revoke execute on function private.eventos_de_caixa(uuid[],date) from public,anon;
grant execute on function private.eventos_de_caixa(uuid[],date) to authenticated,service_role;

-- Criar a série (create_recurring_payment e converter_registro passam por aqui): aceita o destino.
create or replace function private.inserir_da_hipotese(p_tabela text,p_linha jsonb,p_permitidas text[])
returns uuid language plpgsql security invoker set search_path=public as $$
declare id uuid;r record;p jsonb:=private.financial_metadata_patch(p_linha);parent text;
begin
  if p_tabela is null or p_tabela not in('transactions','recurring_transactions','debts') then raise exception 'Origem inválida';end if;
  if p_linha?'subcategory_snapshot_set' then raise exception 'Snapshot do detalhe é interno';end if;
  parent:=case when p_tabela='debts' then p_linha->>'payment_category' else p_linha->>'category' end;
  if p?'subcategory_id' then perform private.validate_subcategory_reference(public.my_default_workspace(),parent,(p->>'subcategory_id')::uuid);end if;
  p_permitidas:=p_permitidas||array['payment_method','expense_pattern','expense_pattern_source','expense_necessity','expense_necessity_source','subcategory_id'];
  if p_tabela='debts' then p_permitidas:=p_permitidas||array['payment_category'];end if;
  if p_tabela='recurring_transactions' then p_permitidas:=p_permitidas||array['counterparty_account_id'];end if;
  if p_tabela='transactions' and p?'subcategory_id' then
    p_linha:=p_linha||'{"subcategory_snapshot_set":true}'::jsonb;p_permitidas:=p_permitidas||array['subcategory_snapshot_set'];
  end if;
  id:=private.inserir_da_hipotese_payment_core(p_tabela,p_linha,p_permitidas);
  execute format('select payment_method,account_id,workspace_id from public.%I where id=$1',p_tabela) into r using id;
  perform private.validate_payment_method(r.payment_method,r.account_id,r.workspace_id);
  return id;
end $$;

-- ── B5. as previstas da lista dizem o destino da transferência ─────────────
-- Leitura nova por cima da `detailed` (as anteriores mantêm a forma): o app filtra por conta
-- olhando origem E destino, como já faz com a transferência gravada.
create or replace function public.ledger_expected_lines_transfer(p_from date, p_to date, p_recurring_id uuid default null)
returns table(origin text, ref_id uuid, due_date date, amount_cents bigint, kind text, description text, category text,
  account_id uuid, installment_no integer, installments_total integer, inferred_start boolean, status text,
  payment_method text, expense_pattern text, expense_pattern_source text, expense_necessity text,
  expense_necessity_source text, subcategory_id uuid, subcategory_name text, workspace_id uuid,
  counterparty_account_id uuid)
language sql stable security invoker set search_path = '' as $$
  select d.origin, d.ref_id, d.due_date, d.amount_cents, d.kind, d.description, d.category,
    d.account_id, d.installment_no, d.installments_total, d.inferred_start, d.status,
    d.payment_method, d.expense_pattern, d.expense_pattern_source, d.expense_necessity,
    d.expense_necessity_source, d.subcategory_id, d.subcategory_name, d.workspace_id,
    case when d.kind = 'transfer' and d.origin = 'recurring'
         then private.recurring_counterparty_at(d.ref_id, d.due_date) end
  from public.ledger_expected_lines_detailed(p_from, p_to, p_recurring_id) d
$$;
revoke execute on function public.ledger_expected_lines_transfer(date, date, uuid) from public, anon;
grant execute on function public.ledger_expected_lines_transfer(date, date, uuid) to authenticated;
