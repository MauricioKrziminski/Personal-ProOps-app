# Pausar com prazo e carência — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pausar uma recorrente ou um lembrete que repete por um período (início + dias/meses/até
uma data, ou sem prazo), e dar carência a um financiamento (empurra o cronograma; com juros,
capitaliza e recalcula a parcela), com prévia antes de confirmar.

**Architecture:** A pausa é um PERÍODO gravado na série (`paused_from`, `paused_until`, fim
exclusivo); quem expande datas (projeção da regra, previstas, agendador Python, cron de lembretes)
pula o período por UM predicado de cada lado (`private.em_pausa` no SQL, `em_pausa` no Python,
`emPausa` no app). "Sem prazo" continua sendo `active = false` (o toggle de hoje). A carência é
uma linha em `public.debt_pauses`; `private.debt_schedule_for` desloca as datas pela soma dos meses
(`private.debt_pause_shift`) e, com juros, a escrita capitaliza `remaining_cents` e recalcula a
parcela no ato, guardando o "antes" para desfazer.

**Tech Stack:** Supabase Postgres (migrations, testes `supabase/tests/*.sql` via
`scripts/sql-test.py`), agente Python 3.12 (`agent/`, pytest), app Expo SDK 57 + TanStack Query
(`src/`, `node --test`).

**Spec:** `docs/superpowers/specs/2026-10-07-pausar-e-carencia-design.md`

## Global Constraints

- Tudo no **STAGING** (`utkqoiigimqzeenxkxdl`). Produção (`kwriuifcwyvdrxtspjiz`) **fora deste plano** — só com pedido do Gabriel, ordem migrations → agente → app.
- `scripts/supabase-target.sh </dev/null` antes de todo `db push`; push com `npx supabase db push --yes </dev/null`.
- Migrations deste plano usam timestamp **`20261009…`** (o plano "apagar com alcance" usa `20261008…`). Antes de criar, `ls supabase/migrations | tail -1`: se existir timestamp maior, renomeie para depois dele.
- `create or replace` APAGA toda cláusula não repetida (security definer, search_path, TimeZone, grants). Ao redefinir `private.debt_schedule_for`, `private.recurring_projection_all_for` ou `public.expected_recurring_occurrences`, copie o corpo **VIGENTE inteiro** (`grep -il "function <nome>" supabase/migrations/* | sort | tail -1`; confira no staging com `pg_get_functiondef`) e mude só o necessário. Rode a **suíte SQL inteira** depois.
- Dinheiro sempre `amount_cents`/`*_cents` inteiro; juros em centavos com `ceil` por mês (a régua de `debt_schedule_for`).
- Função nova com `current_date`: `set timezone to 'America/Sao_Paulo'` NO CABEÇALHO. `security definer` nova: `set search_path = ''`, nomes qualificados, `revoke execute ... from public, anon`; função `public` nova entra em `supabase/tests/anon_sem_execute.sql`.
- Escritas compostas: wrapper `invoker` + comando `definer` em `private`, recibo selado em `private.*_receipts` com `(user_id, request_id)`, mesma chave + payload diferente = `22023`. Molde: `private.end_recurring_series` (`20261005160000:174-320`).
- O período de pausa é `[paused_from, paused_until)` — **fim exclusivo**, em todos os lados.
- Commits: uma linha, conventional, **sem** `Co-Authored-By`.
- App: `useQuery` de `@/lib/consulta-em-foco`; quantidade é `QuantityField`, data é `Calendar`/`DatePickerField`; toda rolagem com `keyboardShouldPersistTaps="handled"`; sem `Platform.OS` em `src/app`.

## Review Focus

1. **Retomar no meio da pausa não pode recriar como "já aconteceu" as datas que passaram pausadas** — `resume_recurring` encerra a pausa HOJE (`paused_until = current_date`) em vez de apagar o período; teste em Task 1.
2. **Pausa que começa no futuro** (de 05/11 a 05/01) não esconde nada antes de 05/11 nem muda o estado "Ativa" hoje — teste em Task 1 (projeção) e Task 4 (`estadoDaRecorrencia`).
3. **Ocorrência em fatura paga/adiada/paga em parte dentro do período não some** (`private.parcela_travada`) e a atrasada (antes de hoje) também não — teste em Task 1.
4. **Lembrete pausado não aparece no "Seu dia" da Hoje nem toca** — teste em Task 3 (cron) e Task 6 (`useTodayReminders` filtra).
5. **Carência com juros desfeita volta EXATAMENTE** ao saldo, parcela e datas de antes; e desfazer é recusado depois de um pagamento — teste em Task 2.

---

### Task 1: Banco — pausa da recorrente (período, projeção, previstas, RPC)

**Files:**
- Create: `supabase/migrations/20261009120000_pausa_da_serie.sql`
- Create: `supabase/tests/pausa_da_serie.sql`
- Modify: `supabase/tests/anon_sem_execute.sql` (lista do `authenticated`)

**Interfaces:**
- Produces:
  - colunas `public.recurring_transactions.paused_from date`, `paused_until date` e `public.reminders.paused_from date`, `paused_until date`, com `check ((paused_from is null) = (paused_until is null) and (paused_until is null or paused_until > paused_from))`
  - `private.em_pausa(p_dia date, p_de date, p_ate date) returns boolean` — `p_de is not null and p_dia >= p_de and p_dia < p_ate`
  - `public.pause_recurring(p_recurring_id uuid, p_from date, p_until date, p_request_id uuid) returns jsonb`
  - `public.pause_recurring_preview(p_recurring_id uuid, p_from date, p_until date) returns jsonb` → `{"dates": ["2026-11-05", ...], "removed_count": int, "cents": int, "until": "2027-01-05"}`
  - `public.resume_recurring(p_recurring_id uuid, p_request_id uuid) returns jsonb`

- [ ] **Step 1: Linha de base da suíte SQL inteira (antes de qualquer migration)**

```bash
for f in supabase/tests/*.sql; do
  agent/.venv/bin/python scripts/sql-test.py "$f" </dev/null >/dev/null 2>&1 && echo "ok   $f" || echo "FAIL $f"
done | tee /tmp/sql-base-pausa.txt | grep FAIL
```
Expected: anote os que já falham (hoje: `finance_write_preview`, `preview_counted_debt_payments`, `subcategory_financial_preview`; `income_pending` depende do banco vazio). São a linha de base das Tasks 1 e 2.

- [ ] **Step 2: Escrever o teste SQL que falha** — `supabase/tests/pausa_da_serie.sql`. Fixture no molde de `supabase/tests/debt_historical_due_dates.sql` (auth.users, profiles, workspaces, workspace_members; `perform set_config('request.jwt.claim.sub', u::text, true)` antes das RPCs). Datas calculadas a partir de `current_date` em BRT (`set timezone to 'America/Sao_Paulo'` na primeira linha, como `scoped_transaction_edit.sql`).

```sql
set timezone to 'America/Sao_Paulo';
begin;
do $$
declare
  u uuid := '00000000-0000-0000-0000-0000000a5e01';
  w uuid := '00000000-0000-0000-0000-0000000a5e02';
  outro uuid := '00000000-0000-0000-0000-0000000a5e03';
  conta uuid := gen_random_uuid();
  r uuid := gen_random_uuid();
  hoje date := current_date;
  m1 date := (date_trunc('month', current_date) + interval '1 month')::date + 4;  -- dia 5 do mês que vem
  m2 date := (date_trunc('month', current_date) + interval '2 month')::date + 4;
  m3 date := (date_trunc('month', current_date) + interval '3 month')::date + 4;
  prev jsonb; res jsonb; req uuid := gen_random_uuid(); n int;
begin
  insert into auth.users(id,email) values (u,'pausa@example.invalid'),(outro,'pausa-outro@example.invalid');
  insert into public.profiles(id) values (u),(outro) on conflict do nothing;
  insert into public.workspaces(id,owner_id,name) values (w,u,'Pausa');
  insert into public.workspace_members(workspace_id,user_id,role) values (w,u,'owner');
  insert into public.accounts(id,workspace_id,user_id,name,type) values (conta,w,u,'Conta','checking');
  -- série mensal dia 5, começando no dia 5 do mês passado
  insert into public.recurring_transactions(id,workspace_id,user_id,kind,amount_cents,description,
    category,account_id,rrule,dtstart,next_run_at,active)
  values (r,w,u,'expense',12000,'Academia','saude',conta,'FREQ=MONTHLY;BYMONTHDAY=5',
    ((date_trunc('month',hoje) - interval '1 month')::date + 4)::timestamptz,
    m1::timestamptz, true);
  -- ocorrências já gravadas: m1, m2 e m3 em aberto (o agendador as teria gravado)
  insert into public.transactions(workspace_id,user_id,kind,amount_cents,description,category,
    account_id,occurred_at,due_at,status,source,recurring_id)
  select w,u,'expense',12000,'Academia','saude',conta,d,d,'pending','recurring',r
  from unnest(array[m1,m2,m3]) d;
  update public.recurring_transactions set materialized_until = (m3 + 1)::timestamptz where id = r;

  perform set_config('request.jwt.claim.sub', u::text, true);

  -- 1) prévia = o que a escrita faz (m1 e m2 saem; m3 fica; volta em m3)
  prev := public.pause_recurring_preview(r, m1, m3);
  assert (prev->>'removed_count')::int = 2, 'prévia conta as duas em aberto do período: '||prev;
  assert (prev->>'cents')::bigint = 24000, 'prévia soma 2 × 120,00: '||prev;
  assert prev->'dates' = to_jsonb(array[m1::text, m2::text]), 'prévia lista as datas: '||prev;

  res := public.pause_recurring(r, m1, m3, req);
  assert res = prev, 'escrita devolve o mesmo que a prévia';
  assert (select count(*) from public.transactions where recurring_id=r) = 1, 'só m3 sobra';
  assert public.pause_recurring(r, m1, m3, req) = res, 'repetir com a mesma chave é inofensivo';
  begin
    perform public.pause_recurring(r, m1, m2, req);
    assert false, 'mesma chave com payload diferente deveria falhar';
  exception when sqlstate '22023' then null; end;

  -- 2) a data apagada pela pausa NÃO vira "apagada não volta"
  assert not exists(select 1 from private.recurring_moved_occurrences where recurring_id=r and original_date in (m1,m2)),
    'pausa não marca as datas como apagadas';

  -- 3) projeção da regra pula o período (zera materialized para a regra expandir tudo)
  update public.recurring_transactions set materialized_until = null where id = r;
  assert not exists(select 1 from private.recurring_projection_all_for(array[w], hoje, m3 + 40)
    where recurring_id=r and due_date in (m1,m2)), 'projeção pula m1 e m2';
  assert exists(select 1 from private.recurring_projection_all_for(array[w], hoje, m3 + 40)
    where recurring_id=r and due_date = (date_trunc('month', m3) + interval '1 month')::date + 4),
    'depois do período a projeção volta';

  -- 4) previstas pulam o período
  assert not exists(select 1 from public.expected_recurring_occurrences(hoje, m3 + 40, r)
    where due_date in (m1, m2)), 'previstas pulam o período';

  -- 5) retomar no meio encerra a pausa HOJE (não apaga o período): datas antes de hoje continuam puladas
  res := public.resume_recurring(r, gen_random_uuid());
  assert (select paused_until from public.recurring_transactions where id=r) is null
      or (select paused_until from public.recurring_transactions where id=r) <= hoje + 0,
    'retomar encerra a pausa até hoje';
  assert (select materialized_until from public.recurring_transactions where id=r) is null,
    'retomar zera materialized_until';

  -- 6) pausa no futuro não esconde nada antes dela
  perform public.pause_recurring(r, m2, m3, gen_random_uuid());
  assert exists(select 1 from private.recurring_projection_all_for(array[w], hoje, m3 + 40)
    where recurring_id=r and due_date = m1), 'm1 (antes da pausa) segue na projeção';

  -- 7) paga e fatura travada ficam; atrasada fica
  -- (o implementador acrescenta: uma ocorrência cleared em m2 e uma pending numa fatura 'paid'
  --  dentro do período → pause_recurring não as apaga; uma pending com due_at < hoje → fica)

  -- 8) outro espaço não pausa
  perform set_config('request.jwt.claim.sub', outro::text, true);
  begin
    perform public.pause_recurring(r, m1, m3, gen_random_uuid());
    assert false, 'outro espaço não deveria pausar';
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'Recorrência não encontrada', sqlerrm;
  end;

  -- 9) período inválido
  perform set_config('request.jwt.claim.sub', u::text, true);
  begin
    perform public.pause_recurring(r, m2, m1, gen_random_uuid());
    assert false, 'fim antes do início deveria falhar';
  exception when sqlstate '22023' then null; end;

  -- 10) fuso no cabeçalho das funções novas
  assert exists(select 1 from pg_proc where proname='pause_recurring' and pronamespace='private'::regnamespace
    and 'TimeZone=America/Sao_Paulo' = any(proconfig)), 'fuso no cabeçalho';
end $$;
rollback;
```
Escreva o bloco 7 com dados reais (crie `card_invoices` com `status='paid'` e uma linha pendente nela — veja o molde em `supabase/tests/ciclo_fechado.sql` ou `roll_invoice.sql`), não deixe o comentário.

- [ ] **Step 3: Rodar e ver falhar**

Run: `cat supabase/tests/pausa_da_serie.sql > /tmp/ps.sql && agent/.venv/bin/python scripts/sql-test.py /tmp/ps.sql </dev/null`
Expected: FAIL — `function public.pause_recurring_preview(...) does not exist` (ou coluna `paused_from` inexistente).

- [ ] **Step 4: Escrever a migration** — `supabase/migrations/20261009120000_pausa_da_serie.sql`:

```sql
-- Pausar com prazo (spec 2026-10-07-pausar-e-carencia-design.md §1). O período é [de, até).
alter table public.recurring_transactions
  add column if not exists paused_from date,
  add column if not exists paused_until date,
  add constraint recurring_pause_window check (
    (paused_from is null) = (paused_until is null)
    and (paused_until is null or paused_until > paused_from));
alter table public.reminders
  add column if not exists paused_from date,
  add column if not exists paused_until date,
  add constraint reminders_pause_window check (
    (paused_from is null) = (paused_until is null)
    and (paused_until is null or paused_until > paused_from));

-- UM predicado para "esta data está pausada". O agente (agent/app/domain/recurrence.py `em_pausa`)
-- e o app (src/lib/pausa.ts `emPausa`) repetem a MESMA régua: fim exclusivo.
create or replace function private.em_pausa(p_dia date, p_de date, p_ate date)
returns boolean language sql immutable set search_path = '' as $$
  select p_de is not null and p_dia >= p_de and p_dia < p_ate
$$;
revoke execute on function private.em_pausa(date, date, date) from public, anon;
grant execute on function private.em_pausa(date, date, date) to authenticated, service_role;
```

Depois, **redefina** `private.recurring_projection_all_for` copiando a definição vigente
(`20261005160000_recurring_transfers_and_end.sql`, ~L829-850) e acrescentando UMA linha no `where`:

```sql
    and not private.em_pausa(d.due_date, r.paused_from, r.paused_until)
```

E **redefina** `public.expected_recurring_occurrences` copiando a vigente
(`20260928210060_prevista_do_periodo_antes_das_exclusoes.sql`, ~L9-60, com cabeçalho, revoke e
grant) e acrescentando, junto do `and r.active` (~L45):

```sql
        and not private.em_pausa(d.due_date, r.paused_from, r.paused_until)
```
⚠️ Antes de copiar, confira se alguma migration posterior redefiniu essas duas (`grep -il
"function private.recurring_projection_all_for\|function public.expected_recurring_occurrences"
supabase/migrations/* | sort | tail -2`) e copie a mais recente.

Recibo e comando (molde `private.end_recurring_series`, `20261005160000:174-320`):

```sql
create table if not exists private.recurring_pause_receipts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, request_id)
);
alter table private.recurring_pause_receipts enable row level security;
revoke all on private.recurring_pause_receipts from public, anon, authenticated, service_role;

-- UMA conta para a prévia e o comando. p_op: 'pause' | 'resume'.
create or replace function private.pause_recurring(
  p_op text, p_recurring_id uuid, p_from date, p_until date, p_request_id uuid, p_apply boolean
) returns jsonb
language plpgsql security definer
set search_path = ''
set timezone to 'America/Sao_Paulo'
as $$
declare
  uid uuid := auth.uid();
  r public.recurring_transactions%rowtype;
  sealed private.recurring_pause_receipts%rowtype;
  intent jsonb;
  tz text;
  ids uuid[];
  datas date[];
  removidos bigint;
  previstos bigint;
  result jsonb;
begin
  if uid is null then
    raise exception using errcode = '42501', message = 'Autenticação obrigatória';
  end if;
  if p_op = 'pause' and (p_from is null or p_until is null or p_until <= p_from) then
    raise exception using errcode = '22023', message = 'O fim da pausa precisa ser depois do início';
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
    intent := jsonb_build_object('operation', p_op, 'recurring_id', p_recurring_id,
                                 'from', p_from, 'until', p_until);
    perform pg_advisory_xact_lock(hashtextextended('recurring-pause:' || r.workspace_id::text, 0));
    select * into sealed from private.recurring_pause_receipts
      where user_id = uid and request_id = p_request_id;
    if sealed.request_id is not null then
      if sealed.payload is distinct from intent then
        raise exception using errcode = '22023', message = 'Identificador reutilizado com dados diferentes';
      end if;
      return sealed.result;
    end if;
    select * into r from public.recurring_transactions x where x.id = p_recurring_id for update;
    perform 1 from public.transactions t where t.recurring_id = r.id and t.workspace_id = r.workspace_id order by t.id for update;
  end if;

  if p_op = 'resume' then
    if not p_apply then return '{}'::jsonb; end if;
    -- Retomar encerra a pausa HOJE: o que passou pausado não volta como "já aconteceu".
    update public.recurring_transactions x set
      paused_from = case when x.paused_from >= current_date then null else x.paused_from end,
      paused_until = case when x.paused_from >= current_date then null
                          else greatest(current_date, x.paused_from + 1) end,
      materialized_until = null
    where x.id = r.id;
    result := jsonb_build_object('resumed', true);
  else
    select coalesce(p.timezone, 'America/Sao_Paulo') into tz from public.profiles p where p.id = r.user_id;
    -- Datas que somem: as da regra no período (a partir de hoje) — o que o agendador ainda não gravou
    -- e o que já gravou.
    select array_agg(d.due_date order by d.due_date) into datas
    from private.recurring_dates_for(r.rrule,
      (coalesce(r.dtstart, r.next_run_at) at time zone tz)::date,
      greatest(p_from, current_date), p_until - 1) d
    where r.end_date is null or d.due_date <= r.end_date;
    -- As gravadas que saem: em aberto, a vencer (atrasada fica), fora de fatura travada.
    select array_agg(t.id), coalesce(sum(t.amount_cents), 0) into ids, removidos
    from public.transactions t
    where t.recurring_id = r.id and t.workspace_id = r.workspace_id and t.status = 'pending'
      and not private.parcela_travada(t.status, t.invoice_id)
      and (case when t.invoice_id is null then coalesce(t.due_at, t.occurred_at) else t.occurred_at end)
          >= greatest(p_from, current_date)
      and (case when t.invoice_id is null then coalesce(t.due_at, t.occurred_at) else t.occurred_at end)
          < p_until;
    -- As da regra que ainda não viraram linha entram pelo valor da série.
    select count(*) * r.amount_cents into previstos
    from unnest(coalesce(datas, '{}')) dd
    where not exists (select 1 from public.transactions t
                      where t.recurring_id = r.id and t.occurred_at = dd);
    result := jsonb_build_object(
      'dates', coalesce(to_jsonb(datas::text[]), '[]'::jsonb),
      'removed_count', coalesce(array_length(ids, 1), 0),
      'cents', removidos + coalesce(previstos, 0),
      'until', p_until);
    if not p_apply then return result; end if;
    -- O UPDATE vem antes do DELETE (`marca_serie_editada`): a linha apagada pela pausa não entra
    -- em "apagada não volta" — ela tem que voltar se a pausa for encurtada.
    update public.recurring_transactions x
      set paused_from = p_from, paused_until = p_until
    where x.id = r.id;
    if ids is not null then
      delete from public.transactions t where t.id = any(ids) and t.workspace_id = r.workspace_id
        and t.status = 'pending' and not private.parcela_travada(t.status, t.invoice_id);
    end if;
  end if;
  insert into private.recurring_pause_receipts(user_id, request_id, workspace_id, payload, result)
    values (uid, p_request_id, r.workspace_id, intent, result);
  return result;
end $$;
revoke execute on function private.pause_recurring(text, uuid, date, date, uuid, boolean) from public, anon;
grant execute on function private.pause_recurring(text, uuid, date, date, uuid, boolean) to authenticated;

create or replace function public.pause_recurring(p_recurring_id uuid, p_from date, p_until date, p_request_id uuid)
returns jsonb language sql security invoker set search_path = '' set timezone to 'America/Sao_Paulo' as $$
  select private.pause_recurring('pause', p_recurring_id, p_from, p_until, p_request_id, true)
$$;
create or replace function public.pause_recurring_preview(p_recurring_id uuid, p_from date, p_until date)
returns jsonb language sql security invoker set search_path = '' set timezone to 'America/Sao_Paulo' as $$
  select private.pause_recurring('pause', p_recurring_id, p_from, p_until, null, false)
$$;
create or replace function public.resume_recurring(p_recurring_id uuid, p_request_id uuid)
returns jsonb language sql security invoker set search_path = '' set timezone to 'America/Sao_Paulo' as $$
  select private.pause_recurring('resume', p_recurring_id, null, null, p_request_id, true)
$$;
revoke execute on function public.pause_recurring(uuid, date, date, uuid) from public, anon;
revoke execute on function public.pause_recurring_preview(uuid, date, date) from public, anon;
revoke execute on function public.resume_recurring(uuid, uuid) from public, anon;
grant execute on function public.pause_recurring(uuid, date, date, uuid) to authenticated;
grant execute on function public.pause_recurring_preview(uuid, date, date) to authenticated;
grant execute on function public.resume_recurring(uuid, uuid) to authenticated;
```
⚠️ Confira o nome real do gatilho/GUC citado (`marca_serie_editada` / `proops.series_editadas`,
`20260928210000:200`) e que o `update` acima o dispara (ele olha `update of` quais colunas?). Se o
gatilho só marcar a série editada em update de colunas do calendário, inclua `paused_from` e
`paused_until` nessa condição na mesma migration (copiando o corpo vigente do gatilho inteiro) —
senão o DELETE grava as datas em `recurring_moved_occurrences` e o bloco 2 do teste falha.

Adicione os três `public.*` novos à lista do `authenticated` em `supabase/tests/anon_sem_execute.sql`
(em ordem alfabética, como as vizinhas).

- [ ] **Step 5: Rodar e ver passar**

Run: `cat supabase/migrations/20261009120000_pausa_da_serie.sql supabase/tests/pausa_da_serie.sql > /tmp/ps.sql && agent/.venv/bin/python scripts/sql-test.py /tmp/ps.sql </dev/null`
Expected: PASS (sem `ERROR`). E `cat supabase/migrations/20261009120000_pausa_da_serie.sql supabase/tests/anon_sem_execute.sql > /tmp/anon.sql && agent/.venv/bin/python scripts/sql-test.py /tmp/anon.sql </dev/null` → PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261009120000_pausa_da_serie.sql supabase/tests/pausa_da_serie.sql supabase/tests/anon_sem_execute.sql
git commit -m "feat(db): pausar recorrente com prazo"
```

---

### Task 2: Banco — carência no financiamento; push para o staging

**Files:**
- Create: `supabase/migrations/20261009120100_carencia_da_divida.sql`
- Create: `supabase/tests/carencia_da_divida.sql`
- Modify: `supabase/tests/anon_sem_execute.sql`
- Modify: `src/lib/database.types.ts` (regenerado)
- Modify: `docs/HISTORICO-DE-MIGRATIONS.md`

**Interfaces:**
- Consumes: nada da Task 1 além da ordem das migrations.
- Produces:
  - tabela `public.debt_pauses(id uuid pk, workspace_id uuid, debt_id uuid references public.debts on delete cascade, from_installment_no int, months int check (months between 1 and 24), balance_before_cents bigint, installment_before_cents bigint, installments_paid_at int, created_by uuid, created_at timestamptz)` — RLS de membro só leitura (escrita só pela RPC)
  - `private.debt_pause_shift(p_debt_id uuid, p_installment_no int) returns int` — soma dos `months` das carências com `from_installment_no <= p_installment_no`
  - `public.debt_pause(p_debt_id uuid, p_from_installment_no int, p_months int, p_request_id uuid) returns jsonb`
  - `public.debt_pause_preview(p_debt_id uuid, p_from_installment_no int, p_months int) returns jsonb` → `{"next_before":"2026-11-23","next_after":"2027-02-23","installment_before":148500,"installment_after":156240,"balance_before":3850000,"balance_after":4013000,"end_before":"2029-09-23","end_after":"2029-12-23","with_interest":true}`
  - `public.undo_debt_pause(p_pause_id uuid, p_request_id uuid) returns jsonb`

- [ ] **Step 1: Escrever o teste SQL que falha** — `supabase/tests/carencia_da_divida.sql`, fixture no molde de `debt_historical_due_dates.sql` (colunas obrigatórias de `debts`: `workspace_id,user_id,name,kind,calculation_mode,principal_cents,remaining_cents,interest_rate_monthly,installments,installments_paid,installment_cents,due_day,first_due_date` — confira no tipo `debts` de `src/lib/database.types.ts`).

```sql
set timezone to 'America/Sao_Paulo';
begin;
do $$
declare
  u uuid := '00000000-0000-0000-0000-0000000ca001';
  w uuid := '00000000-0000-0000-0000-0000000ca002';
  fixa uuid := gen_random_uuid();
  juros uuid := gen_random_uuid();
  prox date := (date_trunc('month', current_date) + interval '1 month')::date + 22; -- dia 23 do mês que vem
  antes date[]; depois date[];
  prev jsonb; res jsonb; pid uuid; saldo0 bigint; parcela0 bigint; esperado bigint;
begin
  insert into auth.users(id,email) values (u,'carencia@example.invalid');
  insert into public.profiles(id) values (u) on conflict do nothing;
  insert into public.workspaces(id,owner_id,name) values (w,u,'Carência');
  insert into public.workspace_members(workspace_id,user_id,role) values (w,u,'owner');
  -- parcela fixa: 10 parcelas de 100,00, 2 pagas, a 3ª vence no dia 23 do mês que vem
  insert into public.debts(id,workspace_id,user_id,name,kind,calculation_mode,principal_cents,
    remaining_cents,interest_rate_monthly,installments,installments_paid,installment_cents,due_day,first_due_date)
  values (fixa,w,u,'Fixa','financing','fixed_installments',100000,80000,0,10,2,10000,23,
    (prox - interval '2 month')::date);
  -- com juros: 2% a.m., saldo 10.000,00, 12 restantes, a próxima no dia 23 do mês que vem
  insert into public.debts(id,workspace_id,user_id,name,kind,calculation_mode,principal_cents,
    remaining_cents,interest_rate_monthly,installments,installments_paid,installment_cents,due_day,first_due_date)
  values (juros,w,u,'Juros','financing','amortized',1000000,1000000,0.02,12,0,
    private.price_installment(1000000,0.02,12),23,prox);
  perform set_config('request.jwt.claim.sub', u::text, true);

  -- 1) parcela fixa: anda 3 meses, valor e total iguais
  select array_agg(due_date order by installment_no) into antes from public.debt_schedule(fixa);
  prev := public.debt_pause_preview(fixa, 3, 3);
  res := public.debt_pause(fixa, 3, 3, gen_random_uuid());
  assert res - 'pause_id' = prev, 'escrita = prévia (fora o id)';
  select array_agg(due_date order by installment_no) into depois from public.debt_schedule(fixa);
  assert depois[1] = private.add_months(antes[1], 3), 'a 3ª anda 3 meses';
  assert array_length(depois,1) = array_length(antes,1), 'mesmo número de parcelas';
  assert (select sum(payment_cents) from public.debt_schedule(fixa)) = 80000, 'total igual';
  assert (prev->>'with_interest')::boolean = false;

  -- 2) com juros: saldo capitaliza mês a mês (ceil), parcela pela Price com as mesmas 12
  select remaining_cents, installment_cents into saldo0, parcela0 from public.debts where id=juros;
  esperado := saldo0;
  for i in 1..2 loop esperado := esperado + ceil(esperado::numeric * 0.02)::bigint; end loop;
  res := public.debt_pause(juros, 1, 2, gen_random_uuid());
  pid := (res->>'pause_id')::uuid;
  assert (select remaining_cents from public.debts where id=juros) = esperado, 'saldo capitalizado';
  assert (select installment_cents from public.debts where id=juros) = private.price_installment(esperado,0.02,12),
    'parcela recalculada com as mesmas 12';
  assert (select min(due_date) from public.debt_schedule(juros)) = private.add_months(prox, 2), 'próxima anda 2 meses';

  -- 3) desfazer volta EXATAMENTE
  perform public.undo_debt_pause(pid, gen_random_uuid());
  assert (select remaining_cents from public.debts where id=juros) = saldo0, 'saldo volta';
  assert (select installment_cents from public.debts where id=juros) = parcela0, 'parcela volta';
  assert (select min(due_date) from public.debt_schedule(juros)) = prox, 'data volta';
  assert not exists(select 1 from public.debt_pauses where id=pid), 'carência some';

  -- 4) recusas com a frase
  begin perform public.debt_pause(fixa, 2, 1, gen_random_uuid()); assert false;
  exception when sqlstate 'P0001' then
    assert sqlerrm like '%já paga%', sqlerrm; end;          -- começa numa parcela paga
  begin perform public.debt_pause(fixa, 4, 1, gen_random_uuid()); assert false;
  exception when sqlstate 'P0001' then
    assert sqlerrm like '%outra carência%', sqlerrm; end;   -- sobreposta à da etapa 1 (3ª a 5ª)
  begin perform public.debt_pause(juros, 3, 1, gen_random_uuid()); assert false;
  exception when sqlstate 'P0001' then
    assert sqlerrm like '%próxima parcela%', sqlerrm; end;  -- com juros só a partir da próxima

  -- 5) desfazer recusado depois de um pagamento
  res := public.debt_pause(juros, 1, 1, gen_random_uuid());
  pid := (res->>'pause_id')::uuid;
  update public.debts set installments_paid = installments_paid + 1 where id = juros; -- simula um pagamento
  begin perform public.undo_debt_pause(pid, gen_random_uuid()); assert false;
  exception when sqlstate 'P0001' then
    assert sqlerrm like '%pagamento%', sqlerrm; end;

  -- 6) a projeção e o "O que vence" leem a data nova (mesmo cronograma)
  assert not exists(select 1 from public._upcoming_bills(u, 120) where kind='debt' and ref_id=fixa and due_date = antes[1]),
    'upcoming não mostra mais a data antiga';

  -- 7) fuso e definer
  assert exists(select 1 from pg_proc where proname='debt_pause' and pronamespace='private'::regnamespace
    and prosecdef and 'TimeZone=America/Sao_Paulo' = any(proconfig)), 'cabeçalho';
end $$;
rollback;
```
⚠️ O passo 5 simula pagamento mexendo em `installments_paid` direto; se um gatilho em `debts`
recusar isso, troque por `public.pay_debt_installment(...)` (assinatura em `0023_debts.sql` e
redefinições posteriores) — o teste continua exigindo a recusa do desfazer.

- [ ] **Step 2: Rodar e ver falhar**

Run: `cat supabase/migrations/20261009120000_pausa_da_serie.sql supabase/tests/carencia_da_divida.sql > /tmp/cd.sql && agent/.venv/bin/python scripts/sql-test.py /tmp/cd.sql </dev/null`
Expected: FAIL — `function public.debt_pause_preview(...) does not exist`.

- [ ] **Step 3: Escrever a migration** — `supabase/migrations/20261009120100_carencia_da_divida.sql`:

```sql
-- Carência (spec 2026-10-07-pausar-e-carencia-design.md §2).
create table if not exists public.debt_pauses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  debt_id uuid not null references public.debts(id) on delete cascade,
  from_installment_no int not null check (from_installment_no >= 1),
  months int not null check (months between 1 and 24),
  balance_before_cents bigint not null,
  installment_before_cents bigint,
  installments_paid_at int not null,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists debt_pauses_debt_idx on public.debt_pauses(debt_id);
alter table public.debt_pauses enable row level security;
revoke all on public.debt_pauses from public, anon, authenticated;
grant select on public.debt_pauses to authenticated;
create policy debt_pauses_member_read on public.debt_pauses for select
  using (workspace_id in (select private.my_workspace_ids()));
alter publication supabase_realtime add table public.debt_pauses;

create or replace function private.debt_pause_shift(p_debt_id uuid, p_installment_no int)
returns int language sql stable set search_path = '' as $$
  select coalesce(sum(p.months), 0)::int from public.debt_pauses p
  where p.debt_id = p_debt_id and p.from_installment_no <= p_installment_no
$$;
revoke execute on function private.debt_pause_shift(uuid, int) from public, anon;
grant execute on function private.debt_pause_shift(uuid, int) to authenticated, service_role;
```

**Redefina `private.debt_schedule_for`** copiando o corpo VIGENTE inteiro
(`20261005190000_debt_overdue_installment.sql`; confira com `grep -il "function private.debt_schedule_for"
supabase/migrations/* | sort | tail -1`) e mudando SÓ a expressão da data no `select` final:

```sql
         coalesce(e.due_date, private.day_in_month(
           private.add_months((select primeiro from parametros),
             a.installment_no - 1
             + private.debt_pause_shift(p_debt_id, a.installment_no + coalesce((select pagas from parametros), 0))),
           (select venc from parametros)
         )) as due_date,
```
(a parcela editada à mão em `debt_installment_edits` mantém a data que a pessoa escreveu.)

⚠️ Antes de fechar a task: `grep -n "add_months(.*first_due_date" supabase/migrations/*.sql | sort -t: -k1,1 | tail -20`
e liste no relatório toda função VIGENTE que calcula a data de uma parcela FUTURA sem passar por
`debt_schedule_for`. Para cada uma, ou ela já lê `debt_schedule_for` (nada a fazer), ou trata só
parcelas passadas/pagas (nada a fazer, a carência começa na próxima em aberto), ou precisa somar
`private.debt_pause_shift` — nesse caso redefina-a copiando o corpo vigente inteiro.

Recibo e comandos:

```sql
create table if not exists private.debt_pause_receipts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, request_id)
);
alter table private.debt_pause_receipts enable row level security;
revoke all on private.debt_pause_receipts from public, anon, authenticated, service_role;

create or replace function private.debt_pause(
  p_debt_id uuid, p_from_installment_no int, p_months int, p_request_id uuid, p_apply boolean
) returns jsonb
language plpgsql security definer
set search_path = ''
set timezone to 'America/Sao_Paulo'
as $$
declare
  uid uuid := auth.uid();
  d public.debts%rowtype;
  sealed private.debt_pause_receipts%rowtype;
  intent jsonb;
  com_juros boolean;
  saldo bigint;
  nova_parcela bigint;
  restantes int;
  antes jsonb;
  depois jsonb;
  novo_id uuid := gen_random_uuid();
  result jsonb;
begin
  if uid is null then
    raise exception using errcode = '42501', message = 'Autenticação obrigatória';
  end if;
  if p_months is null or p_months < 1 or p_months > 24 then
    raise exception using errcode = '22023', message = 'A carência vai de 1 a 24 meses';
  end if;
  if p_apply and p_request_id is null then
    raise exception using errcode = '22023', message = 'Identificador da tentativa obrigatório';
  end if;
  select * into d from public.debts x where x.id = p_debt_id;
  if d.id is null or not exists (select 1 from public.workspace_members m
                                 where m.workspace_id = d.workspace_id and m.user_id = uid) then
    raise exception using errcode = 'P0001', message = 'Dívida não encontrada';
  end if;
  if p_apply then
    intent := jsonb_build_object('operation', 'debt_pause', 'debt_id', p_debt_id,
                                 'from', p_from_installment_no, 'months', p_months);
    perform pg_advisory_xact_lock(hashtextextended('debt-pause:' || d.id::text, 0));
    select * into sealed from private.debt_pause_receipts where user_id = uid and request_id = p_request_id;
    if sealed.request_id is not null then
      if sealed.payload is distinct from intent then
        raise exception using errcode = '22023', message = 'Identificador reutilizado com dados diferentes';
      end if;
      return sealed.result;
    end if;
    select * into d from public.debts x where x.id = p_debt_id for update;
  end if;
  if d.archived or d.remaining_cents <= 0 then
    raise exception using errcode = 'P0001', message = 'Esta dívida já está quitada ou arquivada';
  end if;
  if p_from_installment_no <= d.installments_paid then
    raise exception using errcode = 'P0001',
      message = 'A ' || p_from_installment_no || 'ª parcela já paga não entra em carência: comece pela próxima';
  end if;
  if exists (select 1 from public.debt_pauses p where p.debt_id = d.id
             and p_from_installment_no < p.from_installment_no + p.months
             and p.from_installment_no < p_from_installment_no + p_months) then
    raise exception using errcode = 'P0001', message = 'Já existe outra carência nesse período: desfaça-a antes';
  end if;
  com_juros := d.calculation_mode = 'amortized' and coalesce(d.interest_rate_monthly, 0) > 0;
  if com_juros and p_from_installment_no <> d.installments_paid + 1 then
    raise exception using errcode = 'P0001',
      message = 'Com juros, a carência começa na próxima parcela em aberto (a ' || (d.installments_paid + 1) || 'ª)';
  end if;

  select jsonb_build_object('next', min(s.due_date), 'end', max(s.due_date),
           'installment', (array_agg(s.payment_cents order by s.installment_no))[1])
    into antes from private.debt_schedule_for(d.id) s;

  -- A escrita REAL roda num bloco que volta na prévia (as variáveis sobrevivem ao rollback do bloco).
  begin
    saldo := d.remaining_cents;
    nova_parcela := d.installment_cents;
    if com_juros then
      for i in 1..p_months loop
        saldo := saldo + ceil(saldo::numeric * d.interest_rate_monthly)::bigint;
      end loop;
      restantes := coalesce(d.installments, 0) - d.installments_paid;
      if d.installment_cents is not null then
        nova_parcela := private.price_installment(saldo, d.interest_rate_monthly, restantes);
      end if;
      update public.debts x set remaining_cents = saldo, installment_cents = nova_parcela where x.id = d.id;
    end if;
    insert into public.debt_pauses(id, workspace_id, debt_id, from_installment_no, months,
      balance_before_cents, installment_before_cents, installments_paid_at, created_by)
    values (novo_id, d.workspace_id, d.id, p_from_installment_no, p_months,
      d.remaining_cents, d.installment_cents, d.installments_paid, uid);
    select jsonb_build_object('next', min(s.due_date), 'end', max(s.due_date),
             'installment', (array_agg(s.payment_cents order by s.installment_no))[1])
      into depois from private.debt_schedule_for(d.id) s;
    if not p_apply then
      raise exception using errcode = 'P0099', message = 'previa';
    end if;
  exception when sqlstate 'P0099' then
    null;
  end;

  result := jsonb_build_object(
    'next_before', antes->>'next', 'next_after', depois->>'next',
    'installment_before', (antes->>'installment')::bigint, 'installment_after', (depois->>'installment')::bigint,
    'balance_before', d.remaining_cents, 'balance_after', saldo,
    'end_before', antes->>'end', 'end_after', depois->>'end',
    'with_interest', com_juros);
  if not p_apply then return result; end if;
  insert into private.debt_pause_receipts(user_id, request_id, workspace_id, payload, result)
    values (uid, p_request_id, d.workspace_id, intent, result || jsonb_build_object('pause_id', novo_id));
  return result || jsonb_build_object('pause_id', novo_id);
end $$;
revoke execute on function private.debt_pause(uuid, int, int, uuid, boolean) from public, anon;
grant execute on function private.debt_pause(uuid, int, int, uuid, boolean) to authenticated;

create or replace function private.undo_debt_pause(p_pause_id uuid, p_request_id uuid)
returns jsonb language plpgsql security definer
set search_path = ''
set timezone to 'America/Sao_Paulo'
as $$
declare
  uid uuid := auth.uid();
  p public.debt_pauses%rowtype;
  d public.debts%rowtype;
begin
  if uid is null then
    raise exception using errcode = '42501', message = 'Autenticação obrigatória';
  end if;
  select * into p from public.debt_pauses x where x.id = p_pause_id;
  if p.id is null then
    -- idempotente: a carência já foi desfeita
    return jsonb_build_object('undone', true);
  end if;
  if not exists (select 1 from public.workspace_members m where m.workspace_id = p.workspace_id and m.user_id = uid) then
    raise exception using errcode = 'P0001', message = 'Carência não encontrada';
  end if;
  select * into d from public.debts x where x.id = p.debt_id for update;
  if d.installments_paid <> p.installments_paid_at then
    raise exception using errcode = 'P0001',
      message = 'Já houve pagamento depois da carência: desfaça o pagamento antes';
  end if;
  update public.debts x set remaining_cents = p.balance_before_cents,
    installment_cents = p.installment_before_cents where x.id = d.id
    and (d.calculation_mode = 'amortized' and coalesce(d.interest_rate_monthly, 0) > 0);
  delete from public.debt_pauses x where x.id = p.id;
  return jsonb_build_object('undone', true);
end $$;
revoke execute on function private.undo_debt_pause(uuid, uuid) from public, anon;
grant execute on function private.undo_debt_pause(uuid, uuid) to authenticated;

create or replace function public.debt_pause(p_debt_id uuid, p_from_installment_no int, p_months int, p_request_id uuid)
returns jsonb language sql security invoker set search_path = '' set timezone to 'America/Sao_Paulo' as $$
  select private.debt_pause(p_debt_id, p_from_installment_no, p_months, p_request_id, true)
$$;
create or replace function public.debt_pause_preview(p_debt_id uuid, p_from_installment_no int, p_months int)
returns jsonb language sql security invoker set search_path = '' set timezone to 'America/Sao_Paulo' as $$
  select private.debt_pause(p_debt_id, p_from_installment_no, p_months, null, false)
$$;
create or replace function public.undo_debt_pause(p_pause_id uuid, p_request_id uuid)
returns jsonb language sql security invoker set search_path = '' set timezone to 'America/Sao_Paulo' as $$
  select private.undo_debt_pause(p_pause_id, p_request_id)
$$;
revoke execute on function public.debt_pause(uuid, int, int, uuid) from public, anon;
revoke execute on function public.debt_pause_preview(uuid, int, int) from public, anon;
revoke execute on function public.undo_debt_pause(uuid, uuid) from public, anon;
grant execute on function public.debt_pause(uuid, int, int, uuid) to authenticated;
grant execute on function public.debt_pause_preview(uuid, int, int) to authenticated;
grant execute on function public.undo_debt_pause(uuid, uuid) to authenticated;
```
⚠️ Se `public.debts` tiver gatilho que exige `edit_revision` ou recusa `update` de
`remaining_cents` fora do caminho de pagamento, siga o que `public.update_debt_contract_scoped`
faz (molde em `20260927230010_debt_contract_scoped.sql` e redefinições) e registre no relatório.
Acrescente os três `public.*` em `supabase/tests/anon_sem_execute.sql`.

- [ ] **Step 4: Rodar e ver passar**

Run: `cat supabase/migrations/20261009120000_pausa_da_serie.sql supabase/migrations/20261009120100_carencia_da_divida.sql supabase/tests/carencia_da_divida.sql > /tmp/cd.sql && agent/.venv/bin/python scripts/sql-test.py /tmp/cd.sql </dev/null`
Expected: PASS.

- [ ] **Step 5: Push no staging, tipos, suíte inteira contra a linha de base**

```bash
scripts/supabase-target.sh </dev/null   # tem que dizer utkqoiigimqzeenxkxdl
npx supabase db push --yes </dev/null
npx supabase gen types typescript --project-id utkqoiigimqzeenxkxdl --schema public > src/lib/database.types.ts
for f in supabase/tests/*.sql; do
  agent/.venv/bin/python scripts/sql-test.py "$f" </dev/null >/dev/null 2>&1 && echo "ok   $f" || echo "FAIL $f"
done | grep FAIL
```
Expected: só os FAIL da linha de base (`/tmp/sql-base-pausa.txt`). Qualquer FAIL novo é desta tarefa ou da Task 1. Confira que `npx tsc --noEmit` continua limpo depois de regenerar os tipos (se o `gen types` acrescentar um bloco `graphql_public` que não existia, mantenha como a Task 2 do plano do lembrete de conta fez).
Acrescente as duas migrations em `docs/HISTORICO-DE-MIGRATIONS.md` (só staging), no formato das linhas de `20261007120000`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261009120100_carencia_da_divida.sql supabase/tests/carencia_da_divida.sql supabase/tests/anon_sem_execute.sql src/lib/database.types.ts docs/HISTORICO-DE-MIGRATIONS.md
git commit -m "feat(db): carencia no financiamento"
```

---

### Task 3: Agente — agendador e cron de lembretes pulam a pausa

**Files:**
- Modify: `agent/app/domain/recurrence.py` (+ `em_pausa`)
- Modify: `agent/app/jobs/scheduler.py` (`materialize_horizon`: select + pular)
- Modify: `agent/app/jobs/reminders.py` (`run`: select + pular)
- Test: `agent/tests/test_pausa.py`

**Interfaces:**
- Consumes: colunas `paused_from`, `paused_until` (Task 1) — `date` ou `None`.
- Produces: `em_pausa(dia: str | date, de: date | None, ate: date | None) -> bool` (fim exclusivo; `dia` em ISO `YYYY-MM-DD` ou `date`).

- [ ] **Step 1: Teste que falha** — `agent/tests/test_pausa.py`:

```python
from datetime import date

from app.domain.recurrence import em_pausa


def test_em_pausa_fim_exclusivo():
    de, ate = date(2026, 11, 5), date(2027, 1, 5)
    assert em_pausa("2026-11-05", de, ate)
    assert em_pausa(date(2026, 12, 5), de, ate)
    assert not em_pausa("2027-01-05", de, ate)
    assert not em_pausa("2026-11-04", de, ate)


def test_sem_pausa():
    assert not em_pausa("2026-11-05", None, None)
```
Acrescente um teste do agendador e um do cron no estilo dos testes vizinhos (`agent/tests/test_scheduler*.py` e `agent/tests/test_reminder_channels.py`): (a) série com `paused_from/paused_until` cobrindo a 1ª data → `_materialize_occurrence` NÃO é chamado para essa data e o cursor avança; (b) lembrete com `next_run_at` dentro do período → `_entregar` NÃO é chamado e `finish_reminder_occurrence` é chamado (avança como o `skip_run_at`).

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd agent && .venv/bin/pytest tests/test_pausa.py -q`
Expected: FAIL — `ImportError: cannot import name 'em_pausa'`.

- [ ] **Step 3: Implementar**

Em `agent/app/domain/recurrence.py`:

```python
def em_pausa(dia, de, ate) -> bool:
    """A mesma régua de `private.em_pausa` (SQL) e `emPausa` (app): período [de, até)."""
    if de is None or ate is None:
        return False
    d = dia if isinstance(dia, date) else date.fromisoformat(dia)
    return de <= d < ate
```
(o módulo hoje faz `from datetime import datetime`: troque por `from datetime import date, datetime`.)

Em `scheduler.materialize_horizon`: acrescente `r.paused_from, r.paused_until` ao `select` e, dentro
do laço, logo depois do `if dia in suprimidas:` (mesmo formato):

```python
                if em_pausa(dia, rec["paused_from"], rec["paused_until"]):
                    cursor = occ
                    ultima = occ
                    geradas += 1
                    continue
```

Em `reminders.run`: acrescente `r.paused_from, r.paused_until` ao `select` e troque o cálculo de
`skipped` por:

```python
                skipped = (
                    lembrete["skip_run_at"] is not None
                    and lembrete["skip_run_at"] == lembrete["next_run_at"]
                ) or em_pausa(
                    local_iso_date(fuso, lembrete["next_run_at"]),
                    lembrete["paused_from"],
                    lembrete["paused_until"],
                )
```
(`local_iso_date(timezone_name, instant)` mora em `app.domain.dates`, o mesmo que o `scheduler` importa: `from app.domain.dates import local_iso_date`; e `from app.domain.recurrence import em_pausa`.)

- [ ] **Step 4: Rodar e ver passar**

Run: `cd agent && .venv/bin/pytest tests/test_pausa.py -q && .venv/bin/ruff check app --select F,E9 && .venv/bin/pytest -q`
Expected: tudo PASS.

- [ ] **Step 5: Commit**

```bash
git add agent/app/domain/recurrence.py agent/app/jobs/scheduler.py agent/app/jobs/reminders.py agent/tests/test_pausa.py
git commit -m "feat(agent): agendador e lembretes pulam a pausa"
```

---

### Task 4: App — regras puras da pausa

**Files:**
- Create: `src/lib/pausa.ts`, `src/lib/pausa.test.ts`
- Modify: `src/lib/recurring-state.ts` (+ teste em `src/lib/recurring-state.test.ts`)

**Interfaces:**
- Produces:
  - `emPausa(dia: string, de: string | null, ate: string | null): boolean` — ISO, fim exclusivo
  - `type ModoDaPausa = 'dias' | 'meses' | 'ate' | 'sem_prazo'`
  - `fimDaPausa(inicio: string, modo: ModoDaPausa, n: number, ate: string | null): string | null` — `null` em `sem_prazo`; `dias` → `somaDias(inicio, n)`; `meses` → `addMonthsISO(inicio, n)`; `ate` → o dia SEGUINTE à data escolhida (a data escolhida é o último dia pausado)
  - `rotuloDaPausa(s: { active: boolean; paused_from: string | null; paused_until: string | null }, hoje?: string): string | null` → `"Pausada até 04/01/2027"` (dentro do período; mostra o último dia pausado = `paused_until − 1`), `"Pausa de 05/11 a 04/01"` (futura), `null` (sem pausa ou já passou)
  - `estadoDaRecorrencia` passa a aceitar `paused_from`/`paused_until` opcionais e devolve `'pausada'` também quando `emPausa(hoje, …)`.

- [ ] **Step 1: Teste que falha** — `src/lib/pausa.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { emPausa, fimDaPausa, rotuloDaPausa } from './pausa.ts';

test('emPausa: fim exclusivo', () => {
  assert.equal(emPausa('2026-11-05', '2026-11-05', '2027-01-05'), true);
  assert.equal(emPausa('2027-01-05', '2026-11-05', '2027-01-05'), false);
  assert.equal(emPausa('2026-11-05', null, null), false);
});

test('fimDaPausa: dias, meses, até e sem prazo', () => {
  assert.equal(fimDaPausa('2026-11-05', 'dias', 10, null), '2026-11-15');
  assert.equal(fimDaPausa('2026-01-31', 'meses', 1, null), '2026-02-28');
  assert.equal(fimDaPausa('2026-11-05', 'ate', 0, '2027-01-04'), '2027-01-05');
  assert.equal(fimDaPausa('2026-11-05', 'sem_prazo', 0, null), null);
});

test('rotuloDaPausa: dentro, futura e sem pausa', () => {
  const s = { active: true, paused_from: '2026-11-05', paused_until: '2027-01-05' };
  assert.equal(rotuloDaPausa(s, '2026-12-01'), 'Pausada até 04/01/2027');
  assert.equal(rotuloDaPausa(s, '2026-10-01'), 'Pausa de 05/11 a 04/01');
  assert.equal(rotuloDaPausa(s, '2027-02-01'), null);
  assert.equal(rotuloDaPausa({ active: true, paused_from: null, paused_until: null }, '2026-12-01'), null);
});
```
E em `src/lib/recurring-state.test.ts` um caso: série `active: true` com `paused_from <= hoje < paused_until` → `'pausada'`; com a pausa no futuro → `'ativa'`.

- [ ] **Step 2: Rodar e ver falhar** — `node --test src/lib/pausa.test.ts` → FAIL (módulo inexistente).

- [ ] **Step 3: Implementar** `src/lib/pausa.ts` com `somaDias`, `formatDateBR`/`isoToBR` de `./dates.ts` e `addMonthsISO` de `./debt-history.ts` (`addMonthsISO` já faz o clamp de fim de mês). Em `recurring-state.ts`, `Serie` ganha `paused_from?: string | null; paused_until?: string | null` e o retorno final vira `serie.active && !emPausa(hoje, serie.paused_from ?? null, serie.paused_until ?? null) ? 'ativa' : 'pausada'`.

- [ ] **Step 4: Rodar e ver passar** — `npm test; echo exit=$?` → `exit=0`; `npx tsc --noEmit` limpo.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pausa.ts src/lib/pausa.test.ts src/lib/recurring-state.ts src/lib/recurring-state.test.ts
git commit -m "feat(app): regras puras da pausa"
```

---

### Task 5: App — hooks da pausa e da carência

**Files:**
- Create: `src/hooks/use-pausas.ts`

**Interfaces:**
- Consumes: RPCs das Tasks 1-2 (tipos regenerados), `newClientMessageId` (o mesmo que `useEndRecurring` usa em `use-finance.ts`), `useInvalidateFinance`.
- Produces:
  - `usePauseRecurringPreview(id: string | null, from: string | null, until: string | null)` → `useQuery` (staleTime 0, gcTime 0, como `useEndRecurringPreview`) de `{ dates: string[]; removed_count: number; cents: number; until: string }`
  - `usePauseRecurring()` → mutation `{ id, from, until }` com chave de tentativa estável por `[id, from, until]` (molde `useEndRecurring`)
  - `useResumeRecurring()` → mutation `{ id }`
  - `usePauseReminder()` → mutation `{ id, from: string | null, until: string | null }` — update direto em `reminders` (RLS own-rows), invalida `['reminders']`
  - `useDebtPausePreview(debtId, fromNo, months)` → `useQuery` de `PreviaDaCarencia` (os campos de `debt_pause_preview`)
  - `useDebtPause()` → mutation `{ debtId, fromNo, months }`
  - `useUndoDebtPause()` → mutation `{ pauseId }`
  - `useDebtPauses(debtId)` → `useQuery` em `debt_pauses` (`select('id, from_installment_no, months, created_at')`, ordenado), com `useRealtimeInvalidate('debt_pauses', …)`

- [ ] **Step 1: Implementar** seguindo literalmente `useEndRecurringPreview`/`useEndRecurring` (`src/hooks/use-finance.ts` ~L3962-4010): `useQuery` de `@/lib/consulta-em-foco`; erros com `throw error`; invalidações com `useInvalidateFinance()` (recorrência e dívida mexem em projeção, ciclo e "O que vence").
- [ ] **Step 2: Verificar** — `npx tsc --noEmit && npx expo lint && npm test; echo exit=$?` → `exit=0` (o `consulta-em-foco.test.ts` prende o import).
- [ ] **Step 3: Commit** — `git add src/hooks/use-pausas.ts && git commit -m "feat(app): hooks da pausa e da carencia"`

---

### Task 6: App — folha "Pausar…" na recorrente, na ocorrência e no lembrete

**Files:**
- Create: `src/components/finance/pausa-sheet.tsx`
- Modify: `src/app/finance/recurring.tsx` (`acoesDaSerie` ~L241; rótulo da pausa na linha)
- Modify: `src/app/finance/[txId].tsx` (menu do `HeaderActions`, só quando `tx.recurring_id`)
- Modify: `src/app/reminders.tsx` (ações do lembrete ~L96; rótulo)
- Modify: `src/hooks/use-items.ts` (`useTodayReminders` ~L254: selecionar `paused_from, paused_until` e filtrar `emPausa`)
- Test: `src/lib/simple-finance-ui.test.ts`

**Interfaces:**
- Consumes: `fimDaPausa`, `rotuloDaPausa`, `emPausa` (Task 4); hooks da Task 5; `useToggleRecurring`/`useToggleReminder` (sem prazo = `active = false`, o caminho de hoje).
- Produces: `PausaSheet({ visivel, onClose, alvo: { tipo: 'recurring' | 'reminder'; id: string; titulo: string }, inicioPadrao: string })`.

- [ ] **Step 1: Testes de tela que falham** (no estilo dos vizinhos em `simple-finance-ui.test.ts`, com o harness de lá — `ui.nodes()`/`ui.interact`, dublês dos hooks):
  1. Recorrentes → menu da série tem "Pausar…"; a folha abre com "A partir de" = `next_run_at` local da série; escolher "Meses" e 2 → a frase da prévia mostra as datas e o valor vindos de `usePauseRecurringPreview`; "Pausar" chama `usePauseRecurring` com `{ id, from, until: fimDaPausa(from,'meses',2,null) }`.
  2. "Sem prazo" chama `useToggleRecurring` com `active: false` e NÃO chama `usePauseRecurring`.
  3. Série dentro do período mostra "Pausada até DD/MM/AAAA" e a ação "Retomar agora" chama `useResumeRecurring`.
  4. `[txId]` de uma ocorrência (`recurring_id` setado) tem "Pausar…" com início = a data dela; lançamento avulso não tem.
  5. Lembretes: "Pausar…" no lembrete que repete chama `usePauseReminder` com o período; lembrete sem repetição mantém só "Pausar"/"Retomar" de hoje.
  6. `useTodayReminders`: lembrete com `next_run_at` hoje e `paused_from <= hoje < paused_until` não aparece (teste unitário do filtro, extraindo-o para uma função pura em `src/lib/pausa.ts` se precisar: `foraDaPausa(r, hoje)`).

- [ ] **Step 2: Rodar e ver falhar** — `npm test; echo exit=$?` → falhas nos testes novos.

- [ ] **Step 3: Implementar** `PausaSheet` com os primitivos do app: `Sheet` + `SheetScroll` (último filho), `TaskHeader` com o botão "Pausar", `DatePickerField` para "A partir de", `Segmented` para `Dias | Meses | Até uma data | Sem prazo`, `QuantityField` (min 1, max 365 em dias / 24 em meses) e `Calendar`/`DatePickerField` para "até". A frase do efeito vem da prévia e some enquanto a prévia recarrega (sem `placeholderData`). Erro do banco aparece com `financeErrorMessage`. Nas três telas, a ação entra no `ItemAction[]` existente (sem `Platform.OS`). O rótulo de `rotuloDaPausa` entra no subtítulo da linha.
- [ ] **Step 4: Rodar e ver passar** — `npx tsc --noEmit && npx expo lint && npm test; echo exit=$?` → `exit=0`.
- [ ] **Step 5: Commit** — `git add src/components/finance/pausa-sheet.tsx src/app/finance/recurring.tsx "src/app/finance/[txId].tsx" src/app/reminders.tsx src/hooks/use-items.ts src/lib/pausa.ts src/lib/simple-finance-ui.test.ts && git commit -m "feat(app): pausar recorrente e lembrete com prazo"`

---

### Task 7: App — carência na ficha da dívida

**Files:**
- Create: `src/components/finance/carencia-sheet.tsx`
- Modify: `src/app/finance/debts.tsx` (`listaDaDivida` ~L374: "Pausar pagamentos…"; na ficha, a linha da carência ativa com "Desfazer")
- Test: `src/lib/simple-finance-ui.test.ts`

**Interfaces:**
- Consumes: `useDebtPausePreview`, `useDebtPause`, `useUndoDebtPause`, `useDebtPauses` (Task 5).
- Produces: `CarenciaSheet({ visivel, onClose, divida: Debt })`.

- [ ] **Step 1: Testes de tela que falham**:
  1. Ficha da dívida → menu tem "Pausar pagamentos…" (não aparece em dívida quitada/arquivada).
  2. A folha abre com "A partir da parcela" = `installments_paid + 1` e "Meses" = 1; mostra o antes/depois de `useDebtPausePreview` — *"Próxima parcela: 23/11 → 23/02/2027 · Parcela: R$ 1.485,00 → R$ 1.562,40 · Saldo: … · Termina em 09/2029 → 12/2029"* (com `formatBRL` e `formatDateBR`); em parcela fixa as linhas de parcela e saldo não aparecem.
  3. "Confirmar" chama `useDebtPause` com `{ debtId, fromNo, months }`.
  4. Com carência registrada, a ficha mostra "Carência de N meses a partir da Xª" com "Desfazer", que chama `useUndoDebtPause`; a frase de recusa do banco ("Já houve pagamento…") aparece como erro.
- [ ] **Step 2: Rodar e ver falhar** — `npm test; echo exit=$?`.
- [ ] **Step 3: Implementar** `CarenciaSheet` (mesmos primitivos da Task 6; `QuantityField` para a parcela, min `installments_paid + 1`, e para os meses, 1..24). Com juros, "A partir da parcela" fica fixo na próxima em aberto (o banco recusa outra) — a tela diz isso em uma linha. A linha da carência ativa fica dentro de `<Section>` (regra de design: `Row` solta fora de `Section` é defeito).
- [ ] **Step 4: Rodar e ver passar** — `npx tsc --noEmit && npx expo lint && npm test; echo exit=$?` → `exit=0`.
- [ ] **Step 5: Commit** — `git add src/components/finance/carencia-sheet.tsx src/app/finance/debts.tsx src/lib/simple-finance-ui.test.ts && git commit -m "feat(app): carencia no financiamento"`

---

### Task 8: Paridade, portão completo e verificação no staging

**Files:**
- Modify: `docs/AGENTE-PARIDADE-COM-O-APP.md`

- [ ] **Step 1: Linha de paridade** (perto da do lembrete de conta):

```markdown
**Pausar com prazo e carência** (`pause_recurring`, `resume_recurring`, `debt_pause`, 07/10/2026).
No app: "Pausar…" na recorrente (período [de, até), as ocorrências em aberto do período saem e
voltam no fim), no lembrete que repete (`paused_from/paused_until`) e "Pausar pagamentos…" no
financiamento (empurra o cronograma; com juros, capitaliza e recalcula a parcela). O agente NÃO
pausa com prazo nem dá carência — lacuna declarada; "pausa a academia" continua sendo a pausa sem
prazo (`active = false`).
```
Commit: `git add docs/AGENTE-PARIDADE-COM-O-APP.md && git commit -m "docs: paridade da pausa e da carencia"`

- [ ] **Step 2: Portão completo**

```bash
npx tsc --noEmit && npx expo lint && npm test; echo "app exit=$?"
cd agent && .venv/bin/ruff check app --select F,E9 && .venv/bin/pytest -q; echo "agent exit=$?"
```
Expected: os dois `exit=0`.

- [ ] **Step 3: Staging pelo app no simulador (conta `dev@`, botão "Entrar como teste (dev)")**
  1. Numa recorrente de teste criada para isto (anote o id): "Pausar…" → Meses 2 → conferir a frase → Pausar. A série mostra "Pausada até …"; na Projeção as duas datas somem. "Retomar agora" → as datas futuras voltam (o cron de 1 min do staging NÃO roda — memória `scheduler-nao-roda-no-staging`: para conferir a rematerialização, rode `scheduler.materialize_horizon(agora, so_novas=True)` dentro do container do agente, como a Task 10 do plano do lembrete de conta fez com `bill_reminders.run()`).
  2. Num financiamento de teste (anote o id): "Pausar pagamentos…" → 3 meses → conferir antes/depois → Confirmar; a ficha mostra as datas novas; "Desfazer" volta.
  3. Telas que não foram tocadas: Hoje, Financeiro, Lembretes, uma fatura — nada mudou além das ações novas.
  4. **Limpeza pelos ids anotados** (memória `limpeza-so-pelo-que-eu-criei`): apagar a série, a dívida e o que eles geraram; nunca por filtro de texto.

## Fora deste plano

- **Produção**: migrations `20261009120000` e `20261009120100` → deploy do agente → release do app (MINOR). Só com pedido explícito do Gabriel; registrar em `docs/HISTORICO-DE-MIGRATIONS.md`.
- Agente pausando com prazo / dando carência; pausar meta; pausar compra parcelada.
