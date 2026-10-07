# Lembrete de conta — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pôr um lembrete num registro financeiro (lançamento, parcela, ocorrência, compra, financiamento, fatura) que avisa por push/WhatsApp N dias antes do vencimento, numa hora escolhida, e substitui o aviso automático daquele registro.

**Architecture:** Guarda-se só a INTENÇÃO (`public.bill_reminders`, uma linha por aviso). Uma função do banco expande cada lembrete nos vencimentos ATUAIS (mesmas fontes de `_upcoming_bills`) e o cron de 1 minuto pergunta "o que toca agora", reserva em `private.bill_reminder_sends` e entrega. Nada de data de disparo gravada: pagar, apagar ou mudar o vencimento muda o resultado no minuto seguinte.

**Tech Stack:** Supabase Postgres (migrations SQL, testes `supabase/tests/*.sql` via `scripts/sql-test.py`), agente Python 3.12/FastAPI (`agent/`, pytest), app Expo SDK 57 + TanStack Query (`src/`, `node --test`).

**Spec:** `docs/superpowers/specs/2026-10-07-lembrete-de-conta-design.md`

## Global Constraints

- Tudo no **STAGING** (`utkqoiigimqzeenxkxdl`). Produção (`kwriuifcwyvdrxtspjiz`) **fora deste plano** — só com pedido do Gabriel, na ordem migrations → agente → app.
- `scripts/supabase-target.sh </dev/null` antes de todo `db push`; push com `npx supabase db push --yes </dev/null`.
- Dinheiro sempre `amount_cents` inteiro; texto de valor por `cents_to_brl` (agente) / `formatBRL` (app).
- Função nova que usa `current_date`/`localtime`: `set "TimeZone" to 'America/Sao_Paulo'` NO CABEÇALHO (nunca `alter function` depois).
- Função `security definer` nova: `set search_path = ''` e nomes qualificados; `revoke execute ... from public, anon` (e de `authenticated` nas internas `_x`).
- `days_before` entre 0 e 30; `channel in ('push','whatsapp','both')`.
- WhatsApp só com `profiles.alerts_whatsapp_enabled`; template = `settings.wa_reminder_template` (o existente).
- Commits: uma linha, conventional, **sem** `Co-Authored-By`.
- `useQuery` vem de `@/lib/consulta-em-foco`, nunca do pacote. "Dias antes" é `QuantityField`, nunca chips.
- Toda rolagem nova declara `keyboardShouldPersistTaps="handled"`.

## Review Focus

1. **Entre 21h e meia-noite de Brasília** (UTC já é amanhã) um aviso "1 dia antes às 9h" não pode tocar um dia antes da hora — teste em Task 1 confere `proconfig` com TimeZone nas funções novas e calcula as datas do teste em BRT.
2. **Dois avisos do mesmo registro no MESMO dia** (8h e 18h) tocam cada um uma vez — teste em Task 1 (`_bill_reminders_due` devolve os dois só quando as duas horas passaram; reserva de um não bloqueia o outro).
3. **Membro do espaço que não é o dono** cria o lembrete: quem recebe é QUEM CRIOU (`user_id = auth.uid()`), e alvo de OUTRO espaço é recusado — teste em Task 1.
4. **Fatura paga entre o 3-dias-antes e o no-dia** não toca o segundo — teste em Task 1 (status `paid` some de `_bill_reminders_due`).
5. **Sem token de push e WhatsApp desligado**: falha registrada, `attempts` sobe, e após 5 a entrega para (sem template pago em loop) — teste em Task 3.

---

### Task 1: Banco — tabela, expansão dos vencimentos, leitura e escrita

**Files:**
- Create: `supabase/tests/lembrete_de_conta.sql`
- Create: `supabase/migrations/20261007120000_lembrete_de_conta.sql` (⚠️ antes, `ls supabase/migrations | tail -1`: se houver uma migration com timestamp MAIOR, renomeie esta para depois dela)
- Modify: `supabase/tests/anon_sem_execute.sql` (lista do `authenticated`)

**Interfaces:**
- Produces (SQL):
  - `public.bill_reminders(id, workspace_id, user_id, transaction_id, recurring_id, installment_plan_id, debt_id, debt_installment_no, invoice_id, days_before, at_time, channel, created_at)`
  - `private.bill_reminder_sends(bill_reminder_id uuid, due_date date, attempts int, sent_at timestamptz, last_error text, primary key (bill_reminder_id, due_date))`
  - `private.bill_reminder_dues(p_ws uuid[]) returns table(bill_reminder_id uuid, due_date date, title text, amount_cents bigint, target text, ref uuid)` — `target in ('transaction','invoice','debt')`
  - `public._bill_reminders_due() returns table(bill_reminder_id uuid, user_id uuid, workspace_id uuid, due_date date, days_before int, title text, amount_cents bigint, target text, ref uuid, channel text, phone text, expo_push_token text, alerts_whatsapp_enabled boolean, attempts int)` — só o agente (revoke de `authenticated`)
  - `public.save_bill_reminder(p_alvo jsonb, p_avisos jsonb, p_channel text) returns integer` (nº de avisos gravados; `[]` remove)
  - `public.bill_reminders_overview() returns table(alvo jsonb, title text, channel text, avisos jsonb, next_due date)` — para a tela
  - `p_alvo` = um de: `{"transaction_id":uuid}`, `{"recurring_id":uuid}`, `{"installment_plan_id":uuid}`, `{"debt_id":uuid}`, `{"debt_id":uuid,"debt_installment_no":int}`, `{"invoice_id":uuid}`
  - `p_avisos` = `[{"days_before":int,"at_time":"HH:MM"}, ...]`

- [ ] **Step 1: Linha de base da suíte SQL inteira (antes de qualquer migration)**

```bash
for f in supabase/tests/*.sql; do
  agent/.venv/bin/python scripts/sql-test.py "$f" </dev/null >/dev/null 2>&1 && echo "ok   $f" || echo "FAIL $f"
done | tee /tmp/sql-base.txt | grep FAIL
```
Expected: anote os que já falham (ex.: `expected_recurring_occurrences`, `draft_scenario`, `income_pending` por data/banco). Eles são a linha de base para a Task 2.

- [ ] **Step 2: Escrever o teste SQL que falha**

`supabase/tests/lembrete_de_conta.sql` — mesmo padrão de `alert_channels.sql` (usuário sintético em `auth.users`, o gatilho cria perfil e espaço):

```sql
-- Lembrete de conta (07/10/2026): a intenção é gravada, o disparo é derivado do vencimento ATUAL.
begin;
set local timezone to 'America/Sao_Paulo';

insert into auth.users (id, instance_id, aud, role, phone, raw_user_meta_data, raw_app_meta_data)
values
  ('00000000-0000-0000-0000-0000000b1001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '+5511999991001', '{}', '{}'),
  ('00000000-0000-0000-0000-0000000b1002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '+5511999991002', '{}', '{}');

update public.profiles set expo_push_token = 'ExponentPushToken[bill]'
where id = '00000000-0000-0000-0000-0000000b1001';

do $$
declare
  u constant uuid := '00000000-0000-0000-0000-0000000b1001';
  outro constant uuid := '00000000-0000-0000-0000-0000000b1002';
  ws uuid; ws_outro uuid;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  agora time := (now() at time zone 'America/Sao_Paulo')::time;
  conta uuid; cartao uuid; fatura uuid; tx uuid; tx2 uuid; serie uuid; divida uuid; tx_outro uuid;
  n int; cfg text[];
begin
  select id into ws from public.workspaces where owner_id = u;
  select id into ws_outro from public.workspaces where owner_id = outro;

  -- as funções novas fixam o fuso no cabeçalho (o bug das 21h)
  for cfg in select p.proconfig from pg_proc p join pg_namespace s on s.oid = p.pronamespace
             where p.proname in ('bill_reminder_dues', '_bill_reminders_due', 'bill_reminders_overview') loop
    assert array_to_string(cfg, ',') like '%TimeZone=America/Sao_Paulo%', 'função sem fuso no cabeçalho';
  end loop;

  insert into public.accounts (workspace_id, user_id, name, type) values (ws, u, 'Conta BL', 'checking') returning id into conta;

  -- 1) lançamento avulso que vence AMANHÃ, aviso 1 dia antes às 00:00 → toca hoje
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id)
  values (ws, u, 'expense', 150000, 'Aluguel BL', hoje + 1, 'pending', conta) returning id into tx;

  perform set_config('request.jwt.claim.sub', u::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  n := public.save_bill_reminder(jsonb_build_object('transaction_id', tx),
         '[{"days_before":1,"at_time":"00:00"},{"days_before":0,"at_time":"09:00"}]', 'push');
  assert n = 2, 'devia gravar 2 avisos';
  -- salvar de novo SUBSTITUI o conjunto (não duplica)
  n := public.save_bill_reminder(jsonb_build_object('transaction_id', tx),
         '[{"days_before":1,"at_time":"00:00"},{"days_before":0,"at_time":"09:00"}]', 'push');
  select count(*) into n from public.bill_reminders where transaction_id = tx;
  assert n = 2, 'salvar duas vezes não pode duplicar';

  -- alvo de OUTRO espaço é recusado
  reset role;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status)
  values (ws_outro, outro, 'expense', 100, 'Alheio', hoje + 1, 'pending') returning id into tx_outro;
  set local role authenticated;
  begin
    perform public.save_bill_reminder(jsonb_build_object('transaction_id', tx_outro), '[{"days_before":0,"at_time":"09:00"}]', 'push');
    assert false, 'alvo de outro espaço devia ser recusado';
  exception when others then
    assert sqlerrm not like 'alvo de outro espaço devia%', sqlerrm;
  end;
  -- dias fora de 0..30 é recusado
  begin
    perform public.save_bill_reminder(jsonb_build_object('transaction_id', tx), '[{"days_before":31,"at_time":"09:00"}]', 'push');
    assert false, 'days_before 31 devia ser recusado';
  exception when others then
    assert sqlerrm not like 'days_before 31 devia%', sqlerrm;
  end;
  reset role;

  -- quem recebe é quem criou
  assert (select bool_and(user_id = u) from public.bill_reminders where transaction_id = tx), 'user_id devia ser o autor';

  -- toca hoje o "1 dia antes às 00:00"; o "no dia às 09:00" não (é amanhã)
  select count(*) into n from public._bill_reminders_due() d
  where d.ref = tx and d.due_date = hoje + 1 and d.days_before = 1 and d.target = 'transaction';
  assert n = 1, format('aviso de 1 dia antes devia tocar hoje, veio %s', n);
  select count(*) into n from public._bill_reminders_due() d where d.ref = tx and d.days_before = 0;
  assert n = 0, 'aviso do dia não pode tocar na véspera';

  -- reservado e enviado = não toca de novo
  insert into private.bill_reminder_sends (bill_reminder_id, due_date, sent_at)
  select id, hoje + 1, now() from public.bill_reminders where transaction_id = tx and days_before = 1;
  select count(*) into n from public._bill_reminders_due() d where d.ref = tx;
  assert n = 0, 'enviado não pode tocar de novo';

  -- vencimento que MUDA gera chave nova: amanhã → depois de amanhã, aviso 2 dias antes
  delete from private.bill_reminder_sends;
  update public.bill_reminders set days_before = 2 where transaction_id = tx and days_before = 1;
  update public.transactions set occurred_at = hoje + 2 where id = tx;
  select count(*) into n from public._bill_reminders_due() d where d.ref = tx and d.due_date = hoje + 2;
  assert n = 1, 'aviso devia seguir o vencimento novo';

  -- conta paga não toca
  update public.transactions set status = 'cleared', paid_at = hoje where id = tx;
  select count(*) into n from public._bill_reminders_due() d where d.ref = tx;
  assert n = 0, 'conta paga não pode tocar';

  -- 2) hora ainda não chegou: aviso hoje às 23:59 só toca se já for 23:59
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id)
  values (ws, u, 'expense', 2000, 'Luz BL', hoje, 'pending', conta) returning id into tx2;
  insert into public.bill_reminders (workspace_id, user_id, transaction_id, days_before, at_time, channel)
  values (ws, u, tx2, 0, '23:59', 'push'), (ws, u, tx2, 0, '00:00', 'push');
  select count(*) into n from public._bill_reminders_due() d where d.ref = tx2;
  assert n = case when agora >= '23:59' then 2 else 1 end, format('dois avisos no mesmo dia: veio %s', n);

  -- 3) série: "todas" toca cada ocorrência, "só esta" não toca as irmãs
  insert into public.recurring_transactions (workspace_id, user_id, kind, amount_cents, description, rrule, dtstart, next_run_at, account_id)
  values (ws, u, 'expense', 5000, 'Academia BL', 'FREQ=MONTHLY', hoje, hoje, conta) returning id into serie;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, recurring_id, source)
  values (ws, u, 'expense', 5000, 'Academia BL', hoje, 'pending', conta, serie, 'recurring'),
         (ws, u, 'expense', 5000, 'Academia BL', hoje + 30, 'pending', conta, serie, 'recurring');
  insert into public.bill_reminders (workspace_id, user_id, recurring_id, days_before, at_time, channel)
  values (ws, u, serie, 0, '00:00', 'push');
  select count(*) into n from private.bill_reminder_dues(array[ws]) d
    join public.bill_reminders b on b.id = d.bill_reminder_id where b.recurring_id = serie;
  assert n = 2, format('"todas" devia expandir 2 ocorrências, veio %s', n);

  -- 4) cartão: várias compras na mesma fatura = UM vencimento (a fatura); fatura paga não toca
  insert into public.accounts (workspace_id, user_id, name, type, closing_day, due_day)
  values (ws, u, 'Cartão BL', 'credit_card', 1, 10) returning id into cartao;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, recurring_id, source)
  values (ws, u, 'expense', 3000, 'Streaming BL', hoje, 'pending', cartao, serie, 'recurring');
  select invoice_id into fatura from public.transactions where account_id = cartao limit 1;
  assert fatura is not null, 'set_invoice devia pendurar a compra numa fatura';
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, recurring_id, source)
  values (ws, u, 'expense', 3000, 'Streaming BL 2', hoje, 'pending', cartao, serie, 'recurring');
  select count(*) into n from private.bill_reminder_dues(array[ws]) d where d.target = 'invoice' and d.ref = fatura;
  assert n = 1, format('fatura devia aparecer UMA vez, veio %s', n);
  update public.card_invoices set status = 'paid' where id = fatura;
  select count(*) into n from private.bill_reminder_dues(array[ws]) d where d.ref = fatura;
  assert n = 0, 'fatura paga não toca';

  -- 5) financiamento: "todas" expande o cronograma; "só a nº N" só ela
  insert into public.debts (workspace_id, user_id, name, kind, principal_cents, remaining_cents, installments, installment_cents, due_day, account_id)
  values (ws, u, 'Carro BL', 'financing', 480000, 480000, 48, 10000, extract(day from hoje)::int, conta) returning id into divida;
  insert into public.bill_reminders (workspace_id, user_id, debt_id, days_before, at_time, channel)
  values (ws, u, divida, 0, '00:00', 'push');
  select count(*) into n from private.bill_reminder_dues(array[ws]) d where d.target = 'debt' and d.ref = divida;
  assert n > 1, format('financiamento "todas" devia expandir o cronograma, veio %s', n);
  delete from public.bill_reminders where debt_id = divida;
  insert into public.bill_reminders (workspace_id, user_id, debt_id, debt_installment_no, days_before, at_time, channel)
  values (ws, u, divida, 2, 0, '00:00', 'push');
  select count(*) into n from private.bill_reminder_dues(array[ws]) d where d.ref = divida;
  assert n = 1, format('"só a 2ª" devia dar 1 vencimento, veio %s', n);

  -- 6) apagar o registro apaga o lembrete
  delete from public.transactions where id = tx2;
  select count(*) into n from public.bill_reminders where transaction_id = tx2;
  assert n = 0, 'apagar o registro devia apagar o lembrete';

  -- 7) RLS: o outro usuário não lê
  perform set_config('request.jwt.claim.sub', outro::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', outro, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.bill_reminders;
  assert n = 0, 'outro espaço não pode ler';
  reset role;
end $$;

rollback;
```

⚠️ Antes de rodar, confira com `\d`/`database.types.ts` os `not null` reais de `accounts`, `recurring_transactions` e `debts` (ex.: `debts.kind` aceita `'financing'`?, `recurring_transactions` exige `currency`?) e ajuste os INSERTs — a asserção é o que importa, não o formato do fixture.

- [ ] **Step 3: Rodar e ver falhar**

Run: `agent/.venv/bin/python scripts/sql-test.py supabase/tests/lembrete_de_conta.sql </dev/null`
Expected: FAIL (`function public.save_bill_reminder ... does not exist` ou `relation public.bill_reminders does not exist`).

- [ ] **Step 4: Escrever a migration**

`supabase/migrations/20261007120000_lembrete_de_conta.sql`:

```sql
-- Lembrete de conta (spec 2026-10-07-lembrete-de-conta-design.md).
-- A INTENÇÃO é gravada (qual registro, dias antes, hora, canal); o disparo é DERIVADO do
-- vencimento atual. Uma data de disparo gravada seria a segunda cópia do vencimento, e ele muda
-- por ~10 caminhos (editar série, reparcelar, mudar o dia da dívida, adiar fatura, pagar...).

create table if not exists public.bill_reminders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.my_default_workspace() references public.workspaces (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  transaction_id uuid references public.transactions (id) on delete cascade,
  recurring_id uuid references public.recurring_transactions (id) on delete cascade,
  installment_plan_id uuid references public.installment_plans (id) on delete cascade,
  debt_id uuid references public.debts (id) on delete cascade,
  debt_installment_no int,
  invoice_id uuid references public.card_invoices (id) on delete cascade,
  days_before int not null check (days_before between 0 and 30),
  at_time time not null,
  channel text not null default 'push' check (channel in ('push', 'whatsapp', 'both')),
  created_at timestamptz not null default now(),
  constraint bill_reminders_um_alvo check (
    num_nonnulls(transaction_id, recurring_id, installment_plan_id, debt_id, invoice_id) = 1),
  constraint bill_reminders_parcela_da_divida check (debt_installment_no is null or debt_id is not null)
);

create index if not exists bill_reminders_ws_idx on public.bill_reminders (workspace_id);
create index if not exists bill_reminders_tx_idx on public.bill_reminders (transaction_id) where transaction_id is not null;
create index if not exists bill_reminders_rec_idx on public.bill_reminders (recurring_id) where recurring_id is not null;
create index if not exists bill_reminders_plan_idx on public.bill_reminders (installment_plan_id) where installment_plan_id is not null;
create index if not exists bill_reminders_debt_idx on public.bill_reminders (debt_id) where debt_id is not null;
create index if not exists bill_reminders_inv_idx on public.bill_reminders (invoice_id) where invoice_id is not null;

-- RLS: o membro LÊ; escrever é só pela RPC, que confere o espaço do ALVO. Sem policy de escrita,
-- um insert direto pelo PostgREST apontando para um registro de outro espaço não passa.
alter table public.bill_reminders enable row level security;
drop policy if exists "workspace read" on public.bill_reminders;
create policy "workspace read" on public.bill_reminders
  for select using (workspace_id in (select private.my_workspace_ids()));
revoke all on public.bill_reminders from public, anon, authenticated;
grant select on public.bill_reminders to authenticated;
grant all on public.bill_reminders to service_role;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                 and schemaname = 'public' and tablename = 'bill_reminders') then
    alter publication supabase_realtime add table public.bill_reminders;
  end if;
end $$;

-- Reserva por (aviso, vencimento), ANTES do envio: WhatsApp é template pago.
create table if not exists private.bill_reminder_sends (
  bill_reminder_id uuid not null references public.bill_reminders (id) on delete cascade,
  due_date date not null,
  attempts int not null default 0,
  sent_at timestamptz,
  last_error text,
  primary key (bill_reminder_id, due_date)
);
revoke all on private.bill_reminder_sends from public, anon, authenticated;

-- Os vencimentos EM ABERTO de cada lembrete, das mesmas fontes de `_upcoming_bills`:
-- fora do cartão = a linha pendente; no cartão = a FATURA não paga/adiada (uma por fatura);
-- financiamento = o cronograma do contrato (`debt_schedule_for`).
create or replace function private.bill_reminder_dues(p_ws uuid[])
returns table (bill_reminder_id uuid, due_date date, title text, amount_cents bigint, target text, ref uuid)
language sql stable security definer
set search_path = ''
set "TimeZone" to 'America/Sao_Paulo'
as $$
  with r as (select * from public.bill_reminders b where b.workspace_id = any (p_ws)),
  linhas as (
    select r.id as rid, t.*
    from r join public.transactions t
      on t.workspace_id = r.workspace_id
     and (t.id = r.transaction_id or t.recurring_id = r.recurring_id or t.installment_plan_id = r.installment_plan_id)
    where t.kind <> 'transfer'
  )
  select l.rid, coalesce(l.due_at, l.occurred_at),
         coalesce(l.description, l.merchant, l.category, 'Lançamento'), l.amount_cents, 'transaction', l.id
  from linhas l
  where l.invoice_id is null and l.status = 'pending'
  union
  select l.rid, ci.due_date, 'Fatura ' || a.name, private.invoice_open_cents(ci.id), 'invoice', ci.id
  from linhas l
  join public.card_invoices ci on ci.id = l.invoice_id and ci.status not in ('paid', 'rolled')
  join public.accounts a on a.id = ci.account_id
  union
  select r.id, ci.due_date, 'Fatura ' || a.name, private.invoice_open_cents(ci.id), 'invoice', ci.id
  from r
  join public.card_invoices ci on ci.id = r.invoice_id and ci.status not in ('paid', 'rolled')
  join public.accounts a on a.id = ci.account_id
  union
  select r.id, s.due_date,
         coalesce(d.payment_description, 'Parcela ' || d.name) || ' (' || s.installment_no || '/' || d.installments || ')',
         s.payment_cents, 'debt', d.id
  from r
  join public.debts d on d.id = r.debt_id and not d.archived and d.remaining_cents > 0
  cross join lateral private.debt_schedule_for(d.id) s
  where r.debt_installment_no is null or s.installment_no = r.debt_installment_no;
$$;
revoke execute on function private.bill_reminder_dues(uuid[]) from public, anon, authenticated;

-- O que toca AGORA (cron de 1 min). Hoje = vencimento − dias antes, e a hora já passou; cron fora do
-- ar entrega atrasado no MESMO dia, nunca no seguinte. Enviado ou 5 tentativas = não volta.
create or replace function public._bill_reminders_due()
returns table (bill_reminder_id uuid, user_id uuid, workspace_id uuid, due_date date, days_before int,
               title text, amount_cents bigint, target text, ref uuid, channel text,
               phone text, expo_push_token text, alerts_whatsapp_enabled boolean, attempts int)
language sql stable security definer
set search_path = ''
set "TimeZone" to 'America/Sao_Paulo'
as $$
  select b.id, b.user_id, b.workspace_id, d.due_date, b.days_before, d.title, d.amount_cents, d.target, d.ref,
         b.channel, p.phone, p.expo_push_token, p.alerts_whatsapp_enabled, coalesce(s.attempts, 0)
  from private.bill_reminder_dues((select array_agg(w.id) from public.workspaces w)) d
  join public.bill_reminders b on b.id = d.bill_reminder_id
  join public.profiles p on p.id = b.user_id
  left join private.bill_reminder_sends s on s.bill_reminder_id = b.id and s.due_date = d.due_date
  where d.due_date - b.days_before = current_date
    and localtime >= b.at_time
    and s.sent_at is null
    and coalesce(s.attempts, 0) < 5;
$$;
revoke execute on function public._bill_reminders_due() from public, anon, authenticated;
grant execute on function public._bill_reminders_due() to service_role;

-- Escrita: substitui ATOMICAMENTE o conjunto de avisos daquele alvo. `[]` remove.
create or replace function private.save_bill_reminder(p_alvo jsonb, p_avisos jsonb, p_channel text)
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_ws uuid;
  v_tx uuid := nullif(p_alvo ->> 'transaction_id', '')::uuid;
  v_rec uuid := nullif(p_alvo ->> 'recurring_id', '')::uuid;
  v_plan uuid := nullif(p_alvo ->> 'installment_plan_id', '')::uuid;
  v_debt uuid := nullif(p_alvo ->> 'debt_id', '')::uuid;
  v_no int := nullif(p_alvo ->> 'debt_installment_no', '')::int;
  v_inv uuid := nullif(p_alvo ->> 'invoice_id', '')::uuid;
  v_n int := 0;
  a jsonb;
begin
  if auth.uid() is null then raise exception 'Sem sessão' using errcode = '42501'; end if;
  if num_nonnulls(v_tx, v_rec, v_plan, v_debt, v_inv) <> 1 then
    raise exception 'Escolha um registro para lembrar' using errcode = '22023';
  end if;
  if p_channel not in ('push', 'whatsapp', 'both') then
    raise exception 'Canal inválido' using errcode = '22023';
  end if;

  v_ws := coalesce(
    (select workspace_id from public.transactions where id = v_tx),
    (select workspace_id from public.recurring_transactions where id = v_rec),
    (select workspace_id from public.installment_plans where id = v_plan),
    (select workspace_id from public.debts where id = v_debt),
    (select workspace_id from public.card_invoices where id = v_inv));
  if v_ws is null or v_ws not in (select private.my_workspace_ids()) then
    raise exception 'Esse registro não existe mais' using errcode = 'P0001';
  end if;

  delete from public.bill_reminders b
  where b.workspace_id = v_ws
    and b.transaction_id is not distinct from v_tx and b.recurring_id is not distinct from v_rec
    and b.installment_plan_id is not distinct from v_plan and b.debt_id is not distinct from v_debt
    and b.debt_installment_no is not distinct from v_no and b.invoice_id is not distinct from v_inv;

  for a in select * from jsonb_array_elements(coalesce(p_avisos, '[]'::jsonb)) loop
    insert into public.bill_reminders (workspace_id, user_id, transaction_id, recurring_id, installment_plan_id,
                                       debt_id, debt_installment_no, invoice_id, days_before, at_time, channel)
    values (v_ws, auth.uid(), v_tx, v_rec, v_plan, v_debt, v_no, v_inv,
            (a ->> 'days_before')::int, (a ->> 'at_time')::time, p_channel);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke execute on function private.save_bill_reminder(jsonb, jsonb, text) from public, anon;
grant execute on function private.save_bill_reminder(jsonb, jsonb, text) to authenticated;

create or replace function public.save_bill_reminder(p_alvo jsonb, p_avisos jsonb, p_channel text)
returns integer language sql security invoker set search_path = ''
as $$ select private.save_bill_reminder(p_alvo, p_avisos, p_channel); $$;
revoke execute on function public.save_bill_reminder(jsonb, jsonb, text) from public, anon;
grant execute on function public.save_bill_reminder(jsonb, jsonb, text) to authenticated;

-- Leitura da tela: um item por ALVO, com os avisos e o próximo vencimento (null = sem próximo).
create or replace function private.bill_reminders_overview()
returns table (alvo jsonb, title text, channel text, avisos jsonb, next_due date)
language sql stable security definer
set search_path = ''
set "TimeZone" to 'America/Sao_Paulo'
as $$
  with mine as (select array_agg(id) as ws from private.my_workspace_ids() id),
  b as (select * from public.bill_reminders where workspace_id = any ((select ws from mine))),
  prox as (
    select d.bill_reminder_id, min(d.due_date) as due
    from private.bill_reminder_dues((select ws from mine)) d where d.due_date >= current_date
    group by 1
  )
  select jsonb_strip_nulls(jsonb_build_object(
           'transaction_id', b.transaction_id, 'recurring_id', b.recurring_id,
           'installment_plan_id', b.installment_plan_id, 'debt_id', b.debt_id,
           'debt_installment_no', b.debt_installment_no, 'invoice_id', b.invoice_id)) as alvo,
         coalesce(
           (select coalesce(t.description, t.merchant, t.category, 'Lançamento') from public.transactions t where t.id = b.transaction_id),
           (select coalesce(r.description, 'Recorrente') from public.recurring_transactions r where r.id = b.recurring_id),
           (select coalesce(p.description, p.merchant, 'Compra parcelada') from public.installment_plans p where p.id = b.installment_plan_id),
           (select d.name from public.debts d where d.id = b.debt_id),
           (select 'Fatura ' || a.name from public.card_invoices ci join public.accounts a on a.id = ci.account_id where ci.id = b.invoice_id)
         ) as title,
         min(b.channel),
         jsonb_agg(jsonb_build_object('days_before', b.days_before, 'at_time', to_char(b.at_time, 'HH24:MI'))
                   order by b.days_before desc, b.at_time),
         min(prox.due)
  from b left join prox on prox.bill_reminder_id = b.id
  group by 1, 2;
$$;
revoke execute on function private.bill_reminders_overview() from public, anon;
grant execute on function private.bill_reminders_overview() to authenticated;

create or replace function public.bill_reminders_overview()
returns table (alvo jsonb, title text, channel text, avisos jsonb, next_due date)
language sql stable security invoker set search_path = ''
set "TimeZone" to 'America/Sao_Paulo'
as $$ select * from private.bill_reminders_overview(); $$;
revoke execute on function public.bill_reminders_overview() from public, anon;
grant execute on function public.bill_reminders_overview() to authenticated;
```

Nota: `private.bill_reminder_dues` é `definer` porque `debt_schedule_for` e `invoice_open_cents` vivem em `private`; ele só é chamado com o array de espaços já resolvido (`_bill_reminders_due` = todos, só o agente; `bill_reminders_overview` = `my_workspace_ids()`).

- [ ] **Step 5: Rodar o teste com a migration prefixada (rollback, nada grava)**

```bash
cat supabase/migrations/20261007120000_lembrete_de_conta.sql supabase/tests/lembrete_de_conta.sql > /tmp/lc.sql
agent/.venv/bin/python scripts/sql-test.py /tmp/lc.sql </dev/null
```
Expected: PASS. Se uma asserção falhar, corrija a migration (não a asserção) — exceto fixture de INSERT com coluna obrigatória faltando.

- [ ] **Step 6: `anon_sem_execute.sql` — o app precisa executar as duas públicas**

Em `supabase/tests/anon_sem_execute.sql`, na lista `unnest(array[...])` do `authenticated`, acrescente em ordem alfabética `'bill_reminders_overview'` e `'save_bill_reminder'`.

Run: `cat supabase/migrations/20261007120000_lembrete_de_conta.sql supabase/tests/anon_sem_execute.sql > /tmp/anon.sql && agent/.venv/bin/python scripts/sql-test.py /tmp/anon.sql </dev/null`
Expected: PASS.

- [ ] **Step 7: Commit (ainda sem push)**

```bash
git add supabase/migrations/20261007120000_lembrete_de_conta.sql supabase/tests/lembrete_de_conta.sql supabase/tests/anon_sem_execute.sql
git commit -m "feat(db): lembrete de conta derivado do vencimento"
```

---

### Task 2: Banco — o lembrete próprio substitui o aviso automático; push para o staging

**Files:**
- Create: `supabase/migrations/20261007120100_lembrete_substitui_aviso.sql`
- Modify: `supabase/tests/lembrete_de_conta.sql` (bloco novo antes do `end $$;`)
- Modify: `src/lib/database.types.ts` (regenerado)

**Interfaces:**
- Consumes: `public.bill_reminders` (Task 1).
- Produces: `private.tx_tem_lembrete(p_tx public.transactions) returns boolean`; `public._alerts_to_send()` com a mesma assinatura, sem `bill_due`/`invoice_due` para o coberto.

- [ ] **Step 1: Teste que falha** — acrescente ao `do $$` de `lembrete_de_conta.sql`, antes do bloco 7 (RLS):

```sql
  -- 8) o aviso automático deixa de mandar o que tem lembrete próprio
  update public.profiles set alerts_push_enabled = true where id = u;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id)
  values (ws, u, 'expense', 7000, 'Água BL', hoje, 'pending', conta) returning id into tx2;
  select count(*) into n from public._alerts_to_send() a where a.kind = 'bill_due' and a.ref = tx2::text;
  assert n = 1, 'sem lembrete, o automático avisa';
  insert into public.bill_reminders (workspace_id, user_id, transaction_id, days_before, at_time, channel)
  values (ws, u, tx2, 0, '09:00', 'push');
  select count(*) into n from public._alerts_to_send() a where a.kind = 'bill_due' and a.ref = tx2::text;
  assert n = 0, 'com lembrete próprio, o automático cala';
  -- fatura: coberta por uma ocorrência dentro dela (a série do bloco 4 tem lembrete "todas")
  update public.card_invoices set status = 'open' where id = fatura;
  update public.card_invoices set due_date = hoje + 2 where id = fatura;
  select count(*) into n from public._alerts_to_send() a where a.kind = 'invoice_due' and a.ref = fatura::text;
  assert n = 0, 'fatura com compra coberta não recebe o automático';
```

Run (só a migration da Task 1 prefixada): `cat supabase/migrations/20261007120000_lembrete_de_conta.sql supabase/tests/lembrete_de_conta.sql > /tmp/lc.sql && agent/.venv/bin/python scripts/sql-test.py /tmp/lc.sql </dev/null`
Expected: FAIL em "com lembrete próprio, o automático cala".

- [ ] **Step 2: Copiar o corpo VIGENTE de `_alerts_to_send` do staging**

```bash
agent/.venv/bin/python - <<'EOF' > /tmp/alerts_def.sql
import psycopg, re, pathlib
url = [l.split('=',1)[1].strip().strip('"') for l in pathlib.Path('agent/.env').read_text().splitlines() if l.startswith('DATABASE_URL=')][0]
assert 'utkqoiigimqzeenxkxdl' in url
con = psycopg.connect(url)
try:
    print(con.execute("select pg_get_functiondef('public._alerts_to_send()'::regprocedure)").fetchone()[0])
finally:
    con.rollback(); con.close()
EOF
diff <(sed -n '/CREATE OR REPLACE FUNCTION public._alerts_to_send/,/^\$function\$;/p' supabase/migrations/20260928230000_pix_no_credito_na_fatura.sql) /tmp/alerts_def.sql && echo IGUAL
```
Expected: `IGUAL` (ou diferença só de espaço). Se divergir, a base é `/tmp/alerts_def.sql` (o que está no banco), nunca a migration.

- [ ] **Step 3: Escrever a migration**

`supabase/migrations/20261007120100_lembrete_substitui_aviso.sql` = cabeçalho + helper + o corpo copiado com DUAS linhas a mais + os grants de antes:

```sql
-- O lembrete de conta SUBSTITUI o aviso automático daquele registro (spec §5): sem mensagem
-- dobrada, nem template pago dobrado. Os outros tipos de aviso não mudam.
-- ⚠️ Corpo copiado de `pg_get_functiondef` do staging em 07/10/2026; só as duas condições
-- `not private.tx_tem_lembrete(...)` / `not exists (... invoice_id = ci.id)` são novas.

create or replace function private.tx_tem_lembrete(p_tx public.transactions)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.bill_reminders b
    where b.transaction_id = p_tx.id
       or b.recurring_id = p_tx.recurring_id
       or b.installment_plan_id = p_tx.installment_plan_id);
$$;
revoke execute on function private.tx_tem_lembrete(public.transactions) from public, anon, authenticated;

-- <<< colar aqui /tmp/alerts_def.sql INTEIRO >>>, com estas duas edições:
--   CTE `fatura`, no WHERE (depois de `where ci.due_date <= current_date + 3`):
--       and not exists (select 1 from public.bill_reminders b where b.invoice_id = ci.id)
--       and not exists (select 1 from public.transactions tc
--                       where tc.invoice_id = ci.id and private.tx_tem_lembrete(tc))
--   CTE `conta`, no WHERE (depois do `between current_date and current_date + 1`):
--       and not private.tx_tem_lembrete(t)

revoke execute on function public._alerts_to_send() from public, anon, authenticated;
grant execute on function public._alerts_to_send() to service_role;
```

(O "colar aqui" é o PASSO, não um placeholder no arquivo final: o arquivo commitado contém o `CREATE OR REPLACE FUNCTION public._alerts_to_send()` completo.)

- [ ] **Step 4: Teste da feature com as duas migrations**

```bash
cat supabase/migrations/20261007120000_lembrete_de_conta.sql supabase/migrations/20261007120100_lembrete_substitui_aviso.sql supabase/tests/lembrete_de_conta.sql > /tmp/lc.sql
agent/.venv/bin/python scripts/sql-test.py /tmp/lc.sql </dev/null
```
Expected: PASS.

- [ ] **Step 5: Suíte SQL INTEIRA com as duas migrations prefixadas, comparada com a linha de base**

```bash
for f in supabase/tests/*.sql; do
  cat supabase/migrations/20261007120000_lembrete_de_conta.sql supabase/migrations/20261007120100_lembrete_substitui_aviso.sql "$f" > /tmp/suite.sql
  agent/.venv/bin/python scripts/sql-test.py /tmp/suite.sql </dev/null >/dev/null 2>&1 && echo "ok   $f" || echo "FAIL $f"
done > /tmp/sql-depois.txt
diff <(grep FAIL /tmp/sql-base.txt) <(grep FAIL /tmp/sql-depois.txt) && echo "SEM REGRESSÃO"
```
Expected: `SEM REGRESSÃO` (`alert_channels.sql` em especial tem que continuar ok).

- [ ] **Step 6: Aplicar no STAGING e regenerar os tipos**

```bash
scripts/supabase-target.sh </dev/null
npx supabase db push --yes </dev/null
npx supabase gen types typescript --project-id utkqoiigimqzeenxkxdl > src/lib/database.types.ts
agent/.venv/bin/python scripts/sql-test.py supabase/tests/lembrete_de_conta.sql </dev/null
```
Expected: alvo = staging; push aplica as duas; o teste passa sem prefixo. `npx tsc --noEmit` limpo.

- [ ] **Step 7: Registrar e commitar**

Em `docs/HISTORICO-DE-MIGRATIONS.md`, linha das duas migrations como "staging 07/10/2026, produção pendente".

```bash
git add supabase/migrations/20261007120100_lembrete_substitui_aviso.sql supabase/tests/lembrete_de_conta.sql src/lib/database.types.ts docs/HISTORICO-DE-MIGRATIONS.md
git commit -m "feat(db): lembrete de conta substitui o aviso automatico"
```

---

### Task 3: Agente — o passo do cron que entrega o lembrete de conta

**Files:**
- Create: `agent/app/jobs/bill_reminders.py`
- Create: `agent/tests/test_bill_reminders.py`
- Modify: `agent/app/jobs/reminders.py` (`_entregar` ganha título/alvo/ref opcionais)
- Modify: `agent/app/routes/cron.py:85` (chamar o passo novo)

**Interfaces:**
- Consumes: `public._bill_reminders_due()`, `private.bill_reminder_sends` (Task 1).
- Produces: `bill_reminders.texto(nome: str, cents: int, vence: date, hoje: date) -> str`; `bill_reminders.run() -> dict` (`{"due", "sent", "failed"}`); `reminders._entregar(lembrete, titulo="⏰ Lembrete", alvo="reminders", ref=None)`.

- [ ] **Step 1: Testes que falham** — `agent/tests/test_bill_reminders.py`:

```python
"""Lembrete de conta: texto, canais e tentativas. Banco e canais são dublês (`agent.md`)."""

from __future__ import annotations

from datetime import date

import pytest

from app.jobs import bill_reminders, reminders

HOJE = date(2026, 10, 7)


def test_texto_no_dia_amanha_e_em_n_dias():
    assert bill_reminders.texto("Fatura Nubank", 375122, HOJE, HOJE) == "Fatura Nubank vence hoje · R$ 3.751,22"
    assert bill_reminders.texto("Aluguel", 150000, date(2026, 10, 8), HOJE) == "Aluguel vence amanhã · R$ 1.500,00"
    assert (bill_reminders.texto("Parcela Carro (9/48)", 148500, date(2026, 10, 10), HOJE)
            == "Parcela Carro (9/48) vence em 3 dias, 10/10 · R$ 1.485,00")


class _Banco:
    def __init__(self, linhas):
        self.linhas = linhas
        self.execs: list[tuple] = []

    async def fetch(self, sql, *args):
        return self.linhas if "_bill_reminders_due" in sql else []

    async def fetch_one(self, sql, *args):
        return {"sent_at": None, "attempts": 0}

    async def execute(self, sql, *args):
        self.execs.append((" ".join(sql.split()), args))


def _linha(**alt):
    base = {"bill_reminder_id": "b1", "due_date": date(2026, 10, 8), "days_before": 1,
            "title": "Aluguel", "amount_cents": 150000, "target": "transaction",
            "ref": "11111111-1111-1111-1111-111111111111", "channel": "push",
            "phone": "5511999990000", "expo_push_token": "ExponentPushToken[x]",
            "alerts_whatsapp_enabled": False, "attempts": 0}
    return {**base, **alt}


@pytest.fixture
def ambiente(monkeypatch):
    enviados: dict[str, list] = {"push": [], "whatsapp": []}

    async def push_fake(token, titulo, corpo, alvo="today", ref=None):  # noqa: ANN001
        enviados["push"].append((titulo, corpo, alvo, ref))

    async def wa_fake(telefone, template, params):  # noqa: ANN001
        enviados["whatsapp"].append(params[0])

    class _Trava:
        def __init__(self, chave): ...
        async def __aenter__(self): return True
        async def __aexit__(self, *a): return False

    monkeypatch.setattr(reminders.push, "send", push_fake)
    monkeypatch.setattr(reminders.whatsapp, "send_template", wa_fake)
    monkeypatch.setattr(bill_reminders.db, "trava_de_sessao", _Trava)
    monkeypatch.setattr(bill_reminders, "hoje_local", lambda: HOJE)
    return enviados


@pytest.mark.asyncio
async def test_push_abre_o_registro_e_marca_enviado(monkeypatch, ambiente):
    banco = _Banco([_linha()])
    for nome in ("fetch", "fetch_one", "execute"):
        monkeypatch.setattr(bill_reminders.db, nome, getattr(banco, nome))
    out = await bill_reminders.run()
    assert out == {"due": 1, "sent": 1, "failed": 0}
    assert ambiente["push"] == [("⏰ Lembrete", "Aluguel vence amanhã · R$ 1.500,00", "transaction",
                                 "11111111-1111-1111-1111-111111111111")]
    assert any("set sent_at = now()" in sql for sql, _ in banco.execs)


@pytest.mark.asyncio
async def test_sem_token_e_whatsapp_desligado_conta_tentativa_e_nao_manda_nada(monkeypatch, ambiente):
    banco = _Banco([_linha(expo_push_token=None)])
    for nome in ("fetch", "fetch_one", "execute"):
        monkeypatch.setattr(bill_reminders.db, nome, getattr(banco, nome))
    out = await bill_reminders.run()
    assert out == {"due": 1, "sent": 0, "failed": 1}
    assert ambiente["whatsapp"] == []
    assert any("attempts = attempts + 1" in sql for sql, _ in banco.execs)


@pytest.mark.asyncio
async def test_divida_vai_com_alvo_debt(monkeypatch, ambiente):
    banco = _Banco([_linha(target="debt", title="Parcela Carro (9/48)")])
    for nome in ("fetch", "fetch_one", "execute"):
        monkeypatch.setattr(bill_reminders.db, nome, getattr(banco, nome))
    await bill_reminders.run()
    assert ambiente["push"][0][2] == "debt"
```

Run: `cd agent && .venv/bin/pytest tests/test_bill_reminders.py -q`
Expected: FAIL (`ModuleNotFoundError: app.jobs.bill_reminders`).

- [ ] **Step 2: `_entregar` aceita título/alvo/ref** — em `agent/app/jobs/reminders.py`, troque a assinatura e a chamada do push (o resto do corpo não muda; os dublês antigos com 4 argumentos continuam valendo porque `ref` só vai quando existe):

```python
async def _entregar(
    lembrete: dict, titulo: str = "⏰ Lembrete", alvo: str = "reminders", ref: str | None = None
) -> list[str]:
    ...
    if quer_push and lembrete["expo_push_token"]:
        try:
            if ref:
                await push.send(lembrete["expo_push_token"], titulo, lembrete["title"], alvo, ref=ref)
            else:
                await push.send(lembrete["expo_push_token"], titulo, lembrete["title"], alvo)
            delivered_channels.append("push")
```

- [ ] **Step 3: O passo novo** — `agent/app/jobs/bill_reminders.py`:

```python
"""Lembrete de conta (cron de 1 minuto): quem decide o que toca é `_bill_reminders_due()`.

A reserva em `private.bill_reminder_sends` acontece ANTES do envio, sob trava de sessão (o mesmo
at-least-once dos lembretes). Falha soma `attempts`; com 5 a função do banco deixa de devolver o
aviso — template pago não entra em loop. Canais e portão do WhatsApp são os do lembrete comum.
"""

from __future__ import annotations

import logging
from datetime import date

from app import db
from app.domain.dates import now_utc, tz
from app.domain.money import cents_to_brl
from app.jobs import reminders

log = logging.getLogger(__name__)


def hoje_local() -> date:
    return now_utc().astimezone(tz("America/Sao_Paulo")).date()


def texto(nome: str, cents: int, vence: date, hoje: date) -> str:
    dias = (vence - hoje).days
    quando = ("vence hoje" if dias <= 0 else "vence amanhã" if dias == 1
              else f"vence em {dias} dias, {vence:%d/%m}")
    return f"{nome} {quando} · {cents_to_brl(cents)}"


async def run() -> dict:
    linhas = await db.fetch("select * from public._bill_reminders_due()")
    hoje = hoje_local()
    enviados = falhas = 0
    for linha in linhas:
        chave = f"conta:{linha['bill_reminder_id']}:{linha['due_date']}"
        async with db.trava_de_sessao(chave) as livre:
            if not livre:
                continue
            await db.execute(
                "insert into private.bill_reminder_sends (bill_reminder_id, due_date)"
                " values (%s, %s) on conflict do nothing",
                linha["bill_reminder_id"], linha["due_date"],
            )
            estado = await db.fetch_one(
                "select sent_at, attempts from private.bill_reminder_sends"
                " where bill_reminder_id = %s and due_date = %s",
                linha["bill_reminder_id"], linha["due_date"],
            )
            if not estado or estado["sent_at"] is not None or estado["attempts"] >= reminders.MAX_SEND_ATTEMPTS:
                continue
            corpo = texto(linha["title"], linha["amount_cents"], linha["due_date"], hoje)
            try:
                await reminders._entregar({**linha, "title": corpo}, alvo=linha["target"], ref=str(linha["ref"]))
                await db.execute(
                    "update private.bill_reminder_sends set sent_at = now(), last_error = null"
                    " where bill_reminder_id = %s and due_date = %s",
                    linha["bill_reminder_id"], linha["due_date"],
                )
                enviados += 1
            except Exception as err:  # noqa: BLE001
                await db.execute(
                    "update private.bill_reminder_sends set attempts = attempts + 1, last_error = %s"
                    " where bill_reminder_id = %s and due_date = %s",
                    repr(err)[:2000], linha["bill_reminder_id"], linha["due_date"],
                )
                falhas += 1
                log.warning("lembrete de conta %s: %s", linha["bill_reminder_id"], err)
    return {"due": len(linhas), "sent": enviados, "failed": falhas}
```

⚠️ Confira em `agent/app/domain/dates.py` que `now_utc` e `tz` existem com esses nomes (são os que `reminders.py` importa).

- [ ] **Step 4: Ligar no cron** — `agent/app/routes/cron.py`, logo depois de `lembretes = await reminders.run()`:

```python
    # Lembrete de conta: falha aqui não derruba os lembretes nem o sweep.
    try:
        contas = await bill_reminders.run()
    except Exception:  # noqa: BLE001
        contas = {"error": "lembretes de conta falharam"}
```
e acrescente `"contas": contas,` no dicionário devolvido; importe `bill_reminders` junto de `reminders` no topo do arquivo.

- [ ] **Step 5: Rodar**

```bash
cd agent && .venv/bin/ruff check app --select F,E9 && .venv/bin/pytest -q
```
Expected: ruff limpo; pytest todo verde (inclusive `test_reminder_channels.py`, que usa a assinatura antiga do push).

- [ ] **Step 6: Commit**

```bash
git add agent/app/jobs/bill_reminders.py agent/tests/test_bill_reminders.py agent/app/jobs/reminders.py agent/app/routes/cron.py
git commit -m "feat(agent): cron entrega o lembrete de conta"
```

---

### Task 4: Contrato de push — alvo `debt` nos dois lados

**Files:**
- Modify: `agent/app/services/push.py` (`TARGETS`, `_ITEM_FALLBACK`)
- Modify: `src/lib/push-routes.ts` (`ALLOWED`, `LISTA_DO_ITEM`, `PushRoute`, `routeFor`)
- Modify: `src/lib/push-routes.test.ts` (ou o arquivo de teste de `routeFor` que já existir — `grep -l routeFor src/lib/*.test.ts`)
- Test: `src/lib/push-targets-contract.test.ts` (já existe; tem que continuar verde)
- Test: `agent/tests/test_push.py`

**Interfaces:**
- Produces: `routeFor({target:'debt', ref:<uuid>})` → `{ pathname: '/finance/debts', params: { id: ref } }`; sem uuid → `{ pathname: '/finance/debts' }`.

- [ ] **Step 1: Testes que falham**

Em `agent/tests/test_push.py`:
```python
def test_debt_eh_alvo_de_item():
    assert "debt" in push.TARGETS
    assert push._ITEM_FALLBACK["debt"] == "today"
```
No teste de `routeFor`:
```ts
test('push de dívida abre a ficha; ref que não é uuid cai na lista', () => {
  const id = '11111111-1111-1111-1111-111111111111';
  assert.deepEqual(routeFor({ target: 'debt', ref: id }), { pathname: '/finance/debts', params: { id } });
  assert.deepEqual(routeFor({ target: 'debt', ref: 'x' }), { pathname: '/finance/debts' });
});
```
Run: `cd agent && .venv/bin/pytest tests/test_push.py -q; cd .. && npm test 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: FAIL nos dois.

- [ ] **Step 2: Servidor** — `push.py`:
```python
TARGETS = ("today", "reminders", "budgets", "cards", "forecast", "cycle", "invoice", "transaction", "debt")
_ITEM_FALLBACK = {"invoice": "cards", "transaction": "today", "debt": "today"}
```

- [ ] **Step 3: App** — `push-routes.ts`:
```ts
export const ALLOWED = {
  reminders: '/reminders',
  today: '/',
  forecast: '/finance/forecast',
  cards: '/finance/cards',
  budgets: '/finance/budgets',
  cycle: '/finance/cycle',
  invoice: '/finance/invoice/[id]',
  transaction: '/finance/[txId]',
  debt: '/finance/debts',
} as const;

const LISTA_DO_ITEM = { invoice: '/finance/cards', transaction: '/', debt: '/finance/debts' } as const;

export type PushRoute =
  | { pathname: Exclude<AllowedHref, '/finance/invoice/[id]' | '/finance/[txId]' | '/finance/debts'>; params?: { month: string } }
  | { pathname: '/finance/invoice/[id]'; params: { id: string } }
  | { pathname: '/finance/[txId]'; params: { txId: string } }
  | { pathname: '/finance/debts'; params?: { id: string } };
```
e em `routeFor`, troque o ramo de item:
```ts
  if (target === 'invoice' || target === 'transaction' || target === 'debt') {
    if (typeof ref !== 'string' || !UUID.test(ref)) return { pathname: LISTA_DO_ITEM[target] };
    if (target === 'invoice') return { pathname: '/finance/invoice/[id]', params: { id: ref } };
    if (target === 'debt') return { pathname: '/finance/debts', params: { id: ref } };
    return { pathname: '/finance/[txId]', params: { txId: ref } };
  }
  const pathname = ALLOWED[target as Exclude<Target, 'invoice' | 'transaction' | 'debt'>];
```

- [ ] **Step 4: Rodar** — `cd agent && .venv/bin/pytest tests/test_push.py -q && cd .. && npx tsc --noEmit && npm test`
Expected: tudo verde, incluindo `push-targets-contract.test.ts`.

- [ ] **Step 5: Commit**
```bash
git add agent/app/services/push.py agent/tests/test_push.py src/lib/push-routes.ts src/lib/push-routes.test.ts
git commit -m "feat(push): alvo debt abre a ficha da divida"
```

---

### Task 5: App — regras puras do lembrete de conta

**Files:**
- Create: `src/lib/lembrete-de-conta.ts`
- Create: `src/lib/lembrete-de-conta.test.ts`

**Interfaces:**
- Produces:
  - `type Alvo = { transaction_id: string } | { recurring_id: string } | { installment_plan_id: string } | { debt_id: string; debt_installment_no?: number } | { invoice_id: string }`
  - `type Aviso = { days_before: number; at_time: string }` (`at_time` = `HH:MM`)
  - `type Aberto = { tipo: 'lancamento'; tx: { id: string; recurring_id: string | null; installment_plan_id: string | null; invoice_id: string | null; status: string } } | { tipo: 'divida'; debtId: string; parcela?: number } | { tipo: 'fatura'; invoiceId: string } | { tipo: 'serie'; recurringId: string } | { tipo: 'compra'; planId: string }`
  - `alvosDoAberto(a: Aberto): { so: Alvo; todas: Alvo | null }` — `todas` null = não pergunta
  - `rotuloDoAviso(a: Aviso): string` — `"no dia às 9h"`, `"1 dia antes às 9h"`, `"3 dias antes às 8h30"`
  - `resumoDosAvisos(avisos: Aviso[]): string` — junta com `" · "`
  - `alvoComoParam(a: Alvo): string` / `alvoDoParam(s: string): Alvo | null` — `"transaction_id:<uuid>"`, `"debt_id:<uuid>:<n>"`
  - `AVISO_PADRAO: Aviso = { days_before: 0, at_time: '09:00' }`

- [ ] **Step 1: Testes que falham** — `src/lib/lembrete-de-conta.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alvoComoParam, alvoDoParam, alvosDoAberto, resumoDosAvisos, rotuloDoAviso } from './lembrete-de-conta';

const tx = (o: Partial<{ recurring_id: string; installment_plan_id: string; invoice_id: string }> = {}) =>
  ({ id: 't1', recurring_id: null, installment_plan_id: null, invoice_id: null, status: 'pending', ...o });

test('o que se abriu decide onde o lembrete fica pendurado', () => {
  assert.deepEqual(alvosDoAberto({ tipo: 'lancamento', tx: tx() }), { so: { transaction_id: 't1' }, todas: null });
  assert.deepEqual(alvosDoAberto({ tipo: 'lancamento', tx: tx({ recurring_id: 'r1' }) }),
    { so: { transaction_id: 't1' }, todas: { recurring_id: 'r1' } });
  assert.deepEqual(alvosDoAberto({ tipo: 'lancamento', tx: tx({ installment_plan_id: 'p1' }) }),
    { so: { transaction_id: 't1' }, todas: { installment_plan_id: 'p1' } });
  // compra à vista no cartão: quem vence é a fatura
  assert.deepEqual(alvosDoAberto({ tipo: 'lancamento', tx: tx({ invoice_id: 'f1' }) }), { so: { invoice_id: 'f1' }, todas: null });
  assert.deepEqual(alvosDoAberto({ tipo: 'divida', debtId: 'd1', parcela: 9 }),
    { so: { debt_id: 'd1', debt_installment_no: 9 }, todas: { debt_id: 'd1' } });
  assert.deepEqual(alvosDoAberto({ tipo: 'divida', debtId: 'd1' }), { so: { debt_id: 'd1' }, todas: null });
  assert.deepEqual(alvosDoAberto({ tipo: 'serie', recurringId: 'r1' }), { so: { recurring_id: 'r1' }, todas: null });
  assert.deepEqual(alvosDoAberto({ tipo: 'fatura', invoiceId: 'f1' }), { so: { invoice_id: 'f1' }, todas: null });
});

test('o aviso se lê como a pessoa fala', () => {
  assert.equal(rotuloDoAviso({ days_before: 0, at_time: '09:00' }), 'no dia às 9h');
  assert.equal(rotuloDoAviso({ days_before: 1, at_time: '09:00' }), '1 dia antes às 9h');
  assert.equal(rotuloDoAviso({ days_before: 3, at_time: '08:30' }), '3 dias antes às 8h30');
  assert.equal(resumoDosAvisos([{ days_before: 1, at_time: '09:00' }, { days_before: 0, at_time: '08:00' }]),
    '1 dia antes às 9h · no dia às 8h');
});

test('o alvo vai e volta pela rota, e lixo não vira alvo', () => {
  const id = '11111111-1111-1111-1111-111111111111';
  for (const a of [{ transaction_id: id }, { debt_id: id, debt_installment_no: 9 }, { invoice_id: id }] as const) {
    assert.deepEqual(alvoDoParam(alvoComoParam(a)), a);
  }
  assert.equal(alvoDoParam('transaction_id:nao-uuid'), null);
  assert.equal(alvoDoParam('user_id:' + id), null);
});
```
Run: `node --test src/lib/lembrete-de-conta.test.ts` → FAIL (módulo não existe).

- [ ] **Step 2: Implementar** — `src/lib/lembrete-de-conta.ts`:

```ts
/**
 * Lembrete de conta: em que registro ele fica pendurado e como se lê. A regra de QUANDO toca mora
 * no banco (`private.bill_reminder_dues`); aqui não se calcula vencimento nenhum.
 */

export type Alvo =
  | { transaction_id: string }
  | { recurring_id: string }
  | { installment_plan_id: string }
  | { debt_id: string; debt_installment_no?: number }
  | { invoice_id: string };

export type Aviso = { days_before: number; at_time: string };

export type Aberto =
  | { tipo: 'lancamento'; tx: { id: string; recurring_id: string | null; installment_plan_id: string | null; invoice_id: string | null; status: string } }
  | { tipo: 'divida'; debtId: string; parcela?: number }
  | { tipo: 'fatura'; invoiceId: string }
  | { tipo: 'serie'; recurringId: string }
  | { tipo: 'compra'; planId: string };

export const AVISO_PADRAO: Aviso = { days_before: 0, at_time: '09:00' };

/** "Só esta" e "Todas as próximas"; `todas: null` = não há série, a tela não pergunta. */
export function alvosDoAberto(a: Aberto): { so: Alvo; todas: Alvo | null } {
  switch (a.tipo) {
    case 'lancamento': {
      const { tx } = a;
      if (tx.recurring_id) return { so: { transaction_id: tx.id }, todas: { recurring_id: tx.recurring_id } };
      if (tx.installment_plan_id) return { so: { transaction_id: tx.id }, todas: { installment_plan_id: tx.installment_plan_id } };
      // Compra à vista no cartão não vence sozinha: quem vence é a fatura.
      if (tx.invoice_id) return { so: { invoice_id: tx.invoice_id }, todas: null };
      return { so: { transaction_id: tx.id }, todas: null };
    }
    case 'divida':
      return a.parcela
        ? { so: { debt_id: a.debtId, debt_installment_no: a.parcela }, todas: { debt_id: a.debtId } }
        : { so: { debt_id: a.debtId }, todas: null };
    case 'fatura':
      return { so: { invoice_id: a.invoiceId }, todas: null };
    case 'serie':
      return { so: { recurring_id: a.recurringId }, todas: null };
    case 'compra':
      return { so: { installment_plan_id: a.planId }, todas: null };
  }
}

const hora = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
};

export function rotuloDoAviso(a: Aviso): string {
  const quando = a.days_before === 0 ? 'no dia' : a.days_before === 1 ? '1 dia antes' : `${a.days_before} dias antes`;
  return `${quando} às ${hora(a.at_time)}`;
}

export const resumoDosAvisos = (avisos: Aviso[]) => avisos.map(rotuloDoAviso).join(' · ');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHAVES = ['transaction_id', 'recurring_id', 'installment_plan_id', 'debt_id', 'invoice_id'] as const;

export function alvoComoParam(a: Alvo): string {
  const [chave, id] = Object.entries(a)[0] as [string, string];
  return 'debt_installment_no' in a && a.debt_installment_no ? `${chave}:${id}:${a.debt_installment_no}` : `${chave}:${id}`;
}

/** O parâmetro vem da rota: só chave conhecida e uuid viram alvo. */
export function alvoDoParam(s: string): Alvo | null {
  const [chave, id, n] = s.split(':');
  if (!(CHAVES as readonly string[]).includes(chave) || !UUID.test(id ?? '')) return null;
  if (chave === 'debt_id' && n) return Number.isInteger(Number(n)) && Number(n) > 0 ? { debt_id: id, debt_installment_no: Number(n) } : null;
  return { [chave]: id } as Alvo;
}

/** Mesma chave do alvo dos dois lados (overview do banco × o que a tela abriu). */
export const mesmoAlvo = (a: Alvo, b: Alvo) => alvoComoParam(a) === alvoComoParam(b);
```

- [ ] **Step 3: Rodar** — `node --test src/lib/lembrete-de-conta.test.ts && npx tsc --noEmit` → PASS.

- [ ] **Step 4: Commit**
```bash
git add src/lib/lembrete-de-conta.ts src/lib/lembrete-de-conta.test.ts
git commit -m "feat(app): regras puras do lembrete de conta"
```

---

### Task 6: App — hooks de leitura e escrita

**Files:**
- Create: `src/hooks/use-bill-reminders.ts`

**Interfaces:**
- Consumes: `public.bill_reminders_overview()`, `public.save_bill_reminder(p_alvo, p_avisos, p_channel)` (Tasks 1–2); `Alvo`, `Aviso`, `mesmoAlvo` (Task 5).
- Produces:
  - `type LembreteDeConta = { alvo: Alvo; title: string; channel: 'push' | 'whatsapp' | 'both'; avisos: Aviso[]; next_due: string | null }`
  - `useBillReminders()` → consulta `['bill-reminders']`
  - `useBillReminderFor(alvo: Alvo | null)` → `LembreteDeConta | undefined` (deriva do `useBillReminders`)
  - `useSaveBillReminder()` → mutation `{ alvo, avisos, channel }`

- [ ] **Step 1: Implementar** (hook fino, sem lógica a testar além do contrato; o teste de tela da Task 7 o dubla):

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useRealtimeInvalidate } from '@/hooks/use-items';
import { useQuery } from '@/lib/consulta-em-foco';
import { mesmoAlvo, type Alvo, type Aviso } from '@/lib/lembrete-de-conta';
import { supabase } from '@/lib/supabase';

export type LembreteDeConta = {
  alvo: Alvo;
  title: string;
  channel: 'push' | 'whatsapp' | 'both';
  avisos: Aviso[];
  next_due: string | null;
};

const CHAVE = ['bill-reminders'];

export function useBillReminders() {
  useRealtimeInvalidate('bill_reminders', CHAVE);
  return useQuery({
    queryKey: CHAVE,
    queryFn: async (): Promise<LembreteDeConta[]> => {
      const { data, error } = await supabase.rpc('bill_reminders_overview');
      if (error) throw error;
      return (data ?? []) as unknown as LembreteDeConta[];
    },
  });
}

export function useBillReminderFor(alvo: Alvo | null) {
  const lista = useBillReminders();
  return alvo ? lista.data?.find((l) => mesmoAlvo(l.alvo, alvo)) : undefined;
}

export function useSaveBillReminder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { alvo: Alvo; avisos: Aviso[]; channel: LembreteDeConta['channel'] }) => {
      const { error } = await supabase.rpc('save_bill_reminder', {
        p_alvo: input.alvo, p_avisos: input.avisos, p_channel: input.channel,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CHAVE }),
  });
}
```

⚠️ Confira que `useRealtimeInvalidate` é exportado de `@/hooks/use-items` (é, linha ~45) e que os tipos regenerados (Task 2) aceitam `p_alvo: Json`.

- [ ] **Step 2: Rodar** — `npx tsc --noEmit && npx expo lint` → limpos. (`consulta-em-foco.test.ts` prende o import do `useQuery`.)

- [ ] **Step 3: Commit**
```bash
git add src/hooks/use-bill-reminders.ts
git commit -m "feat(app): hooks do lembrete de conta"
```

---

### Task 7: App — o formulário no modo conta (`reminder-form?conta=…`)

**Files:**
- Create: `src/components/reminders/bill-reminder-form.tsx`
- Modify: `src/app/reminder-form.tsx` (ramo no topo de `ReminderFormScreen`)
- Modify: `src/lib/simple-finance-ui.test.ts` (dublê do hook + 3 testes)

**Interfaces:**
- Consumes: Tasks 5 e 6.
- Produces: rota `/reminder-form` com params `{ conta: string /* alvoComoParam(so) */; todas?: string /* alvoComoParam(todas) */; nome: string }`.

- [ ] **Step 1: Testes de tela que falham** — em `simple-finance-ui.test.ts`, no `screen()` (bloco de `if (name === ...)`), acrescente o dublê:

```ts
      if (name === '@/hooks/use-bill-reminders') return {
        useBillReminders: () => ({ data: options.billReminders ?? [], isPending: false, isError: false, refetch() {} }),
        useBillReminderFor: () => (options.billReminders ?? [])[0],
        useSaveBillReminder: () => mutation('saveBillReminder'),
      };
```
(e `billReminders?: any[]` no tipo de `options`). Depois os testes, no estilo dos vizinhos (use `ui.press('<rótulo>')`/`ui.find` como os testes de dívida fazem — copie os helpers do teste mais próximo que aperta "Salvar"):

```ts
const lembreteFile = 'src/app/reminder-form.tsx';
const ID = '11111111-1111-1111-1111-111111111111';

test('Lembrete de conta: salva os avisos no alvo escolhido, com o padrão no dia às 9h', () => {
  const ui = screen(lembreteFile, { params: { conta: `transaction_id:${ID}`, nome: 'Aluguel' } });
  ui.press('Salvar');
  assert.deepEqual(copia(ui.writes.at(-1)), { operation: 'saveBillReminder',
    value: { alvo: { transaction_id: ID }, avisos: [{ days_before: 0, at_time: '09:00' }], channel: 'push' } });
});

test('Lembrete de conta: "Só esta | Todas as próximas" só aparece quando há série', () => {
  const sem = screen(lembreteFile, { params: { conta: `transaction_id:${ID}`, nome: 'Aluguel' } });
  assert.equal(sem.has('Todas as próximas'), false);
  const com = screen(lembreteFile, { params: { conta: `transaction_id:${ID}`, todas: `recurring_id:${ID}`, nome: 'Academia' } });
  com.press('Todas as próximas');
  com.press('Salvar');
  assert.deepEqual(copia(com.writes.at(-1)?.value.alvo), { recurring_id: ID });
});

test('Lembrete de conta: sem nenhum aviso o Salvar não grava e diz por quê', () => {
  const ui = screen(lembreteFile, { params: { conta: `transaction_id:${ID}`, nome: 'Aluguel' } });
  ui.press('Tirar aviso');
  ui.press('Salvar');
  assert.equal(ui.writes.filter((w) => w.operation === 'saveBillReminder').length, 0);
  assert.ok(ui.has('Adicione pelo menos um aviso'));
});
```
⚠️ Se o harness não tiver `has`/`press` com esses nomes, use os que os testes de "Salvar" vizinhos usam (ex.: `ui.find(...)`, `ui.tap(...)`); o que vale são as três asserções.

Run: `npm test 2>&1 | grep -E "^ℹ (pass|fail)"` → os 3 falham.

- [ ] **Step 2: O componente** — `src/components/reminders/bill-reminder-form.tsx`:

```tsx
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { QuantityField } from '@/components/ui/quantity-field';
import { Screen } from '@/components/ui/screen';
import { Segmented } from '@/components/ui/segmented';
import { TaskHeader } from '@/components/ui/task-header';
import { TimePicker } from '@/components/ui/time-picker';
import { useToast } from '@/components/ui/toast';
import { Space } from '@/design/tokens';
import { useBillReminderFor, useSaveBillReminder } from '@/hooks/use-bill-reminders';
import { useProfile } from '@/hooks/use-profile';
import { AVISO_PADRAO, alvoDoParam, type Aviso } from '@/lib/lembrete-de-conta';

const CANAIS = [
  { value: 'push', label: 'Push' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'both', label: 'Os dois' },
] as const;

export function BillReminderForm({ conta, todas, nome }: { conta: string; todas?: string; nome: string }) {
  const toast = useToast();
  const alvoSo = alvoDoParam(conta);
  const alvoTodas = todas ? alvoDoParam(todas) : null;
  const [escopo, setEscopo] = useState<'so' | 'todas'>('so');
  const alvo = escopo === 'todas' && alvoTodas ? alvoTodas : alvoSo;
  const existente = useBillReminderFor(alvo);
  const [avisos, setAvisos] = useState<Aviso[] | null>(null);
  const [canal, setCanal] = useState<'push' | 'whatsapp' | 'both' | null>(null);
  const [horaAberta, setHoraAberta] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const salvar = useSaveBillReminder();
  const perfil = useProfile();

  const lista = avisos ?? existente?.avisos ?? [AVISO_PADRAO];
  const canalAtual = canal ?? existente?.channel ?? 'push';
  const mudar = (i: number, parte: Partial<Aviso>) => setAvisos(lista.map((a, j) => (j === i ? { ...a, ...parte } : a)));

  if (!alvo) {
    return (
      <Screen scroll={false}>
        <TaskHeader title="Lembrete" onClose={() => router.back()} />
        <ThemedText>Esse registro não existe mais.</ThemedText>
      </Screen>
    );
  }

  const gravar = (novos: Aviso[]) =>
    salvar.mutate(
      { alvo, avisos: novos, channel: canalAtual },
      {
        onSuccess: () => { toast.show(novos.length ? 'Lembrete salvo' : 'Lembrete removido'); router.back(); },
        onError: (e: Error) => setErro(e.message),
      }
    );

  const onSalvar = () => {
    if (!lista.length) return setErro('Adicione pelo menos um aviso');
    gravar(lista);
  };

  return (
    <Screen>
      <TaskHeader
        title={existente ? 'Editar lembrete' : 'Lembrar'}
        onClose={() => router.back()}
        action={{ label: 'Salvar', onPress: onSalvar, loading: salvar.isPending }}
      />
      <View style={styles.corpo}>
        <ThemedText type="subtitle">{nome}</ThemedText>
        {alvoTodas ? (
          <Segmented
            options={[{ value: 'so', label: 'Só esta' }, { value: 'todas', label: 'Todas as próximas' }]}
            value={escopo}
            onChange={(v) => { setEscopo(v as 'so' | 'todas'); setAvisos(null); setCanal(null); }}
          />
        ) : null}
        <Card>
          <Field label="Avisar" error={erro ?? undefined}>
            {lista.map((a, i) => (
              <View key={i} style={styles.aviso}>
                <QuantityField
                  value={a.days_before}
                  min={0}
                  max={30}
                  onChange={(n) => mudar(i, { days_before: n })}
                  accessibilityLabel="Dias antes"
                />
                <ThemedText type="small">{a.days_before === 0 ? 'no dia' : 'dias antes'}</ThemedText>
                <Pressable accessibilityRole="button" accessibilityLabel={`Hora, ${a.at_time}`} onPress={() => setHoraAberta(i)}>
                  <ThemedText type="smallBold">{a.at_time}</ThemedText>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="Tirar aviso" hitSlop={12}
                  onPress={() => setAvisos(lista.filter((_, j) => j !== i))}>
                  <ThemedText type="small">✕</ThemedText>
                </Pressable>
              </View>
            ))}
            <Button label="Adicionar aviso" variant="secondary" size="sm"
              onPress={() => { setErro(null); setAvisos([...lista, AVISO_PADRAO]); }} />
          </Field>
          {horaAberta !== null ? (
            <TimePicker value={lista[horaAberta]?.at_time ?? '09:00'}
              onChange={(h) => mudar(horaAberta, { at_time: h })}
              onClose={() => setHoraAberta(null)} />
          ) : null}
        </Card>
        <Card>
          <Field label="Onde avisar"
            hint={canalAtual !== 'push' && perfil.data && !perfil.data.alerts_whatsapp_enabled
              ? 'O WhatsApp está desligado no Perfil: este lembrete não vai por lá.' : undefined}>
            <Segmented options={CANAIS} value={canalAtual} onChange={(v) => setCanal(v as typeof canalAtual)} />
          </Field>
        </Card>
        {existente ? (
          <Button label="Remover lembrete" variant="destructive" onPress={() => gravar([])} />
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  corpo: { gap: Space.lg, padding: Space.lg },
  aviso: { flexDirection: 'row', alignItems: 'center', gap: Space.md, flexWrap: 'wrap' },
});
```

⚠️ Antes de colar, confira os nomes reais: `TaskHeader` aceita `action` com `loading`?; `Button` tem `variant="destructive"`?; existe `useProfile` com `alerts_whatsapp_enabled` (`grep -rn "alerts_whatsapp_enabled" src/hooks`)? `TimePicker` recebe `value`/`onChange(h: string)`? Ajuste para o que existe — sem criar primitivo novo. O aviso de WhatsApp "leva ao Perfil" (spec §6): se o `Field` não aceitar nó no `hint`, troque por um `Button variant="ghost" label="Ligar no Perfil" onPress={() => router.push('/profile')}` logo abaixo (confira a rota real do Perfil).

- [ ] **Step 3: O ramo na rota** — no início de `ReminderFormScreen` em `src/app/reminder-form.tsx`:

```tsx
  const params = useLocalSearchParams<{ id?: string; title?: string; noteId?: string; ocorrencia?: string; conta?: string; todas?: string; nome?: string }>();
  // Modo CONTA: o lembrete mora num registro financeiro, e quem manda na data é o vencimento.
  if (params.conta) return <BillReminderForm conta={params.conta} todas={params.todas} nome={params.nome ?? 'Conta'} />;
```
⚠️ Esse `return` vem ANTES de qualquer hook do resto da tela (o `useReminder` hoje vem logo depois do `useLocalSearchParams`): mova o `useReminder(params.id)` para depois do ramo NÃO é possível (regra dos hooks) — então chame `useReminder(params.conta ? undefined : params.id)` e ponha o `if (params.conta)` logo depois dele. `anti-slop.test.ts:1413` exige `<ReminderForm key={` no arquivo — não mexa nesse trecho.

- [ ] **Step 4: Rodar** — `npx tsc --noEmit && npx expo lint && npm test` → verdes (os 3 testes novos passam).

- [ ] **Step 5: Commit**
```bash
git add src/components/reminders/bill-reminder-form.tsx src/app/reminder-form.tsx src/lib/simple-finance-ui.test.ts
git commit -m "feat(app): formulario do lembrete de conta"
```

---

### Task 8: App — "Lembrar" nos registros e a linha 🔔

**Files:**
- Modify: `src/app/finance/[txId].tsx` (menu do `HeaderActions` + linha 🔔)
- Modify: `src/app/finance/debts.tsx` (`listaDaDivida`, ~l.370; linha 🔔 na ficha)
- Modify: `src/app/finance/invoice/[id].tsx` (menu "Mais opções" + linha 🔔 no cabeçalho)
- Modify: `src/app/finance/recurring.tsx` (`acoesDaSerie`, ~l.237)
- Modify: `src/app/finance/installments.tsx` (`acoesDaCompra`, ~l.254)
- Modify: `src/lib/lembrete-de-conta.ts` (+ `hrefDoLembrete`) e o teste
- Modify: `src/lib/simple-finance-ui.test.ts` (2 testes)

**Interfaces:**
- Consumes: Tasks 5–7.
- Produces: `hrefDoLembrete(aberto: Aberto, nome: string) => { pathname: '/reminder-form'; params: { conta: string; todas?: string; nome: string } }`

- [ ] **Step 1: Teste puro + testes de tela que falham**

Em `lembrete-de-conta.test.ts`:
```ts
test('o link do lembrete leva o alvo e, havendo série, a alternativa', () => {
  assert.deepEqual(hrefDoLembrete({ tipo: 'lancamento', tx: tx({ recurring_id: 'r1' }) }, 'Academia'),
    { pathname: '/reminder-form', params: { conta: 'transaction_id:t1', todas: 'recurring_id:r1', nome: 'Academia' } });
  assert.deepEqual(hrefDoLembrete({ tipo: 'fatura', invoiceId: 'f1' }, 'Fatura Nubank'),
    { pathname: '/reminder-form', params: { conta: 'invoice_id:f1', nome: 'Fatura Nubank' } });
});
```
Em `simple-finance-ui.test.ts`, no estilo dos testes de menu da dívida (`acoesDaDivida`/`actions`):
```ts
test('Dívida: o menu oferece "Lembrar" e abre o formulário em modo conta', () => {
  const ui = screen(debtsFile, { debts: [carro] });
  ui.longPress(carro.name);              // use o mesmo gesto que os testes de menu vizinhos usam
  ui.pressAction('Lembrar');
  assert.deepEqual(copia(ui.navigations.at(-1)),
    { pathname: '/reminder-form', params: { conta: `debt_id:${carro.id}`, nome: carro.name } });
});

test('Dívida com lembrete: a ação vira "Editar lembrete"', () => {
  const ui = screen(debtsFile, { debts: [carro], billReminders: [{ alvo: { debt_id: carro.id }, title: carro.name, channel: 'push', avisos: [{ days_before: 0, at_time: '09:00' }], next_due: null }] });
  ui.longPress(carro.name);
  assert.ok(ui.actions.at(-1).some((a: any) => a.label === 'Editar lembrete'));
});
```
⚠️ `alvoDoParam` exige uuid: o `alvoComoParam` não valida, então `debt_id:d1` sai no link mesmo com id curto de fixture (o teste acima compara o link, não o parse).

Run: `npm test 2>&1 | grep -E "^ℹ (pass|fail)"` → falham.

- [ ] **Step 2: `hrefDoLembrete`** em `src/lib/lembrete-de-conta.ts`:
```ts
export function hrefDoLembrete(aberto: Aberto, nome: string) {
  const { so, todas } = alvosDoAberto(aberto);
  return {
    pathname: '/reminder-form' as const,
    params: { conta: alvoComoParam(so), ...(todas ? { todas: alvoComoParam(todas) } : {}), nome },
  };
}
```

- [ ] **Step 3: Pendurar a ação em cada tela** (rótulo `existente ? 'Editar lembrete' : 'Lembrar'`, ícone `'bell'`; quando a compra é à vista no cartão, `'Lembrar da fatura'`):

`debts.tsx` — em `listaDaDivida`, antes de `Editar`:
```tsx
    { label: lembreteDa(d) ? 'Editar lembrete' : 'Lembrar', icon: 'bell' as const,
      onPress: () => router.push(hrefDoLembrete({ tipo: 'divida', debtId: d.id }, d.name)) },
```
com `const lembretes = useBillReminders();` no componente e
`const lembreteDa = (d: Debt) => lembretes.data?.find((l) => mesmoAlvo(l.alvo, { debt_id: d.id }));`

`[txId].tsx` — no `menu.actions`, só quando há o que lembrar (pendente, ou de série/compra, ou numa fatura em aberto) e não é pagamento de dívida/fatura nem juro do Pix:
```tsx
            ...(!tx.debt_id && !tx.pays_invoice_id && !tx.pix_fee_for_transaction_id &&
                (tx.status === 'pending' || tx.recurring_id || tx.installment_plan_id || tx.invoice_id)
              ? [{
                  label: lembrete ? 'Editar lembrete' : tx.invoice_id && !tx.recurring_id && !tx.installment_plan_id ? 'Lembrar da fatura' : 'Lembrar',
                  icon: 'bell' as const,
                  onPress: () => router.push(hrefDoLembrete({ tipo: 'lancamento', tx }, tx.description ?? tx.merchant ?? 'Lançamento')),
                }]
              : []),
```
com `const lembrete = useBillReminderFor(alvosDoAberto({ tipo: 'lancamento', tx }).so)` (chame o hook com `null` enquanto `tx` não carregou, antes de qualquer `return` antecipado).

`invoice/[id].tsx` — em `menu.actions` (bloco `fatura ? [...]`):
```tsx
                  { label: lembreteDaFatura ? 'Editar lembrete' : 'Lembrar', icon: 'bell' as const,
                    onPress: () => router.push(hrefDoLembrete({ tipo: 'fatura', invoiceId: fatura.id }, `Fatura ${nomeDoCartao}`)) },
```

`recurring.tsx` — em `acoesDeEdicao` de `acoesDaSerie` (só série NÃO encerrada):
```tsx
      { label: lembreteDaSerie(r) ? 'Editar lembrete' : 'Lembrar', icon: 'bell',
        onPress: () => router.push(hrefDoLembrete({ tipo: 'serie', recurringId: r.id }, r.description ?? 'Recorrente')) },
```

`installments.tsx` — em `acoesDaCompra`:
```tsx
    { label: lembreteDaCompra(plano) ? 'Editar lembrete' : 'Lembrar', icon: 'bell',
      onPress: () => router.push(hrefDoLembrete({ tipo: 'compra', planId: plano.id }, plano.title)) },
```
⚠️ Confira o nome real do id em `InstallmentPlanSummary` (`plano.id` ou `plano.plan_id`) e se `'bell'` existe no `IconName` (`grep -n "bell" src/components/ui/icon*`); se não, use `'bell.fill'`/o nome que a tela de lembretes usa.

- [ ] **Step 4: A linha 🔔 no registro** — em `[txId].tsx`, na ficha da dívida (`debts.tsx?id=`) e no cabeçalho da fatura, logo abaixo do bloco principal, quando houver lembrete:
```tsx
{lembrete ? (
  <Row icon="bell" title={resumoDosAvisos(lembrete.avisos)}
       onPress={() => router.push(hrefDoLembrete(<o mesmo Aberto da ação>, <o mesmo nome>))} />
) : null}
```
(na série/compra mostrada pela ocorrência, `lembrete` é o do alvo "só esta" OU o "todas" — use `useBillReminderFor(so) ?? useBillReminderFor(todas)` com os dois hooks chamados incondicionalmente.)

- [ ] **Step 5: Rodar** — `npx tsc --noEmit && npx expo lint && npm test` → verdes.

- [ ] **Step 6: Commit**
```bash
git add src/lib/lembrete-de-conta.ts src/lib/lembrete-de-conta.test.ts src/lib/simple-finance-ui.test.ts "src/app/finance/[txId].tsx" src/app/finance/debts.tsx "src/app/finance/invoice/[id].tsx" src/app/finance/recurring.tsx src/app/finance/installments.tsx
git commit -m "feat(app): Lembrar nos registros financeiros"
```

---

### Task 9: App — seção "Contas" em Lembretes

**Files:**
- Modify: `src/app/reminders.tsx`
- Modify: `src/lib/simple-finance-ui.test.ts` (1 teste)

**Interfaces:**
- Consumes: `useBillReminders`, `resumoDosAvisos`, `alvoComoParam` (Tasks 5–6).

- [ ] **Step 1: Teste que falha**
```ts
test('Lembretes: a seção Contas lista cada conta lembrada e abre a edição', () => {
  const ID = '11111111-1111-1111-1111-111111111111';
  const ui = screen('src/app/reminders.tsx', { billReminders: [
    { alvo: { debt_id: ID }, title: 'Carro', channel: 'push', avisos: [{ days_before: 1, at_time: '09:00' }], next_due: '2026-10-10' },
    { alvo: { transaction_id: ID }, title: 'Aluguel', channel: 'push', avisos: [{ days_before: 0, at_time: '09:00' }], next_due: null },
  ] });
  assert.ok(ui.has('Contas'));
  assert.ok(ui.has('sem próximo vencimento'));
  ui.press('Carro');
  assert.deepEqual(copia(ui.navigations.at(-1)),
    { pathname: '/reminder-form', params: { conta: `debt_id:${ID}`, nome: 'Carro' } });
});
```
Run: `npm test` → falha.

- [ ] **Step 2: Implementar** — em `reminders.tsx`, depois da lista de lembretes comuns e antes do `VerMais`/rodapé:
```tsx
  const contas = useBillReminders();
  ...
      {contas.data?.length ? (
        <Section title="Contas">
          {contas.data.map((c) => (
            <Row
              key={alvoComoParam(c.alvo)}
              icon="bell"
              title={c.title}
              subtitle={[resumoDosAvisos(c.avisos), c.next_due ? `vence ${formatDateBR(c.next_due)}` : 'sem próximo vencimento'].join(' · ')}
              onPress={() => router.push({ pathname: '/reminder-form', params: { conta: alvoComoParam(c.alvo), nome: c.title } })}
            />
          ))}
        </Section>
      ) : null}
```
(`formatDateBR` de `@/hooks/use-items`. Falha da consulta: `contas.isError` mostra `ErrorCard` com `onRetry={() => contas.refetch()}` — o mesmo que a tela já usa para a lista principal.)

- [ ] **Step 3: Rodar** — `npx tsc --noEmit && npx expo lint && npm test` → verdes.

- [ ] **Step 4: Commit**
```bash
git add src/app/reminders.tsx src/lib/simple-finance-ui.test.ts
git commit -m "feat(app): secao Contas em Lembretes"
```

---

### Task 10: Paridade, verificação ponta a ponta e limpeza

**Files:**
- Modify: `docs/AGENTE-PARIDADE-COM-O-APP.md`

- [ ] **Step 1: Linha de paridade** — perto do bloco "Lembrete VINCULADO a uma nota":
```markdown
**Lembrete de CONTA** (`bill_reminders`, `save_bill_reminder`, 07/10/2026). "Lembrar" no lançamento,
na dívida, na fatura, na série e na compra grava avisos (dias antes + hora + canal) que o cron de
1 minuto entrega pelo vencimento ATUAL. O agente NÃO cria nem edita esse lembrete: "me lembra da
parcela do carro 2 dias antes" vira lembrete solto (`create_reminder`). Lacuna declarada — pede
resolver o registro-alvo dentro de uma ação de lembrete.
```
Commit: `git add docs/AGENTE-PARIDADE-COM-O-APP.md && git commit -m "docs: paridade do lembrete de conta"`

- [ ] **Step 2: Portão completo**
```bash
npx tsc --noEmit && npx expo lint && npm test; echo "app exit=$?"
cd agent && .venv/bin/ruff check app --select F,E9 && .venv/bin/pytest -q; echo "agent exit=$?"
```
Expected: os dois `exit=0` (olhe o código de saída, não a contagem).

- [ ] **Step 3: Ponta a ponta no staging (sem WhatsApp de verdade)**
1. `docker compose -f docker-compose.yml -f docker-compose.sem-envio.yml up` (agente local, porta e telefone de teste conforme a memória `e2e-local-do-agente`).
2. App no simulador/emulador logado como `dev@` (botão "Entrar como teste (dev)"). Num lançamento pendente da conta de teste que vence AMANHÃ, "Lembrar" → aviso "1 dia antes" com a hora = agora + 2 min → Salvar. **Anote o id do lançamento.**
3. Disparar o cron local: `curl -s -X POST localhost:<porta>/cron/reminders` a cada minuto até a hora; esperado `"contas": {"sent": 1}` e o push chegando no aparelho (o toque abre o lançamento).
4. Repetir num financiamento (`/finance/debts?id=` → Lembrar → "Todas as próximas" é a dívida); o toque abre a ficha.
5. Conferir `_alerts_to_send` para aquele lançamento: não aparece como `bill_due` (`select * from public._alerts_to_send() where ref = '<id>'` via o padrão de leitura do Task 2 Step 2).
6. **Limpeza pelo id anotado**: remover o lembrete pela própria tela ("Remover lembrete") ou `delete from public.bill_reminders where transaction_id = '<id>'`; nunca por filtro de texto.

- [ ] **Step 4: Telas que não foram tocadas** — abrir Hoje, Financeiro, Lembretes e uma fatura no simulador e confirmar que nada mudou além da ação nova e da linha 🔔 (memória `terminar-testar-so-entao-proxima-fase`).

## Fora deste plano

- **Produção**: migrations `20261007120000` e `20261007120100` → deploy do agente → release do app (MINOR: funcionalidade nova). Só com pedido explícito do Gabriel; registrar em `docs/HISTORICO-DE-MIGRATIONS.md`.
- Agente criando lembrete de conta; "Paguei" dentro da mensagem; lembrete de receita.
