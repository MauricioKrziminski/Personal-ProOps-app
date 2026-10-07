# Apagar com alcance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ao apagar algo que faz parte de uma série (ocorrência de recorrente, parcela, pagamento de financiamento, ocorrência de lembrete), perguntar "Só esta / Esta e as próximas / Todas" — com a confirmação do estrago quando o alcance leva coisa paga — numa operação atômica no banco.

**Architecture:** Uma porta no banco, `public.delete_scoped(p_tipo, p_id, p_alcance, p_request_id, p_anchor)` + `public.delete_scoped_preview(...)`, as duas sobre UM comando `private.delete_scoped(..., p_apply)` (a prévia e a escrita não podem discordar — o desenho de `end_recurring_series`). O comando confere espaço, reserva o recibo e despacha para quatro ramos (`apagar_serie`, `apagar_parcelas`, `apagar_pagamentos`, `apagar_lembrete`), que COMPÕEM as portas existentes (`delete_installment_purchase`, `delete_debt`, o gatilho de pagamento de dívida, a marca `ocorrencia_apagada_nao_volta`). No app, um hook `useApagarComAlcance` faz a pergunta (`askDeleteScope`), lê a prévia, confirma o estrago e chama a escrita; as telas só declaram o alvo.

**Tech Stack:** Supabase Postgres (migrations SQL, testes `supabase/tests/*.sql` via `scripts/sql-test.py`), app Expo SDK 57 + TanStack Query (`src/`, `node --test`).

**Spec:** `docs/superpowers/specs/2026-10-07-apagar-com-alcance-design.md`

## Global Constraints

- Tudo no **STAGING** (`utkqoiigimqzeenxkxdl`). Produção (`kwriuifcwyvdrxtspjiz`) **fora deste plano** — só com pedido do Gabriel, na ordem migration → app.
- `scripts/supabase-target.sh </dev/null` antes de todo `db push`; push com `npx supabase db push --yes </dev/null`.
- Migrations deste plano: `20261008100000_…` em diante (outro plano em paralelo usa outra faixa). Antes de criar, `ls supabase/migrations | tail -1`: se houver timestamp MAIOR, renomeie para depois dele.
- Dinheiro sempre `amount_cents` inteiro; na resposta da RPC, dinheiro vai como **texto decimal** (`soma_pagas_cents`), e o cliente valida antes de virar `number` (`finance.md` → *Padrão das escritas compostas*).
- Função nova que usa `current_date`: `set timezone to 'America/Sao_Paulo'` NO CABEÇALHO. Função `security definer`: `set search_path = ''`, nomes qualificados, `revoke execute ... from public, anon` (e de `authenticated` nas internas que só o comando chama).
- `create or replace` de função existente: copiar o corpo VIGENTE inteiro (grep **case-insensitive**: há migrations com `FUNCTION` maiúsculo). Este plano NÃO reescreve função existente.
- Recusa de regra: `P0001` com a frase e o caminho. Pedido inválido: `22023`. Sem login: `42501`.
- Commits: uma linha, conventional, **sem** `Co-Authored-By`. Nunca stagear `.claude/settings.json`, `scripts/__pycache__/*`, `docs/qa/**/ios-pendencias/`.
- App: `useQuery` vem de `@/lib/consulta-em-foco`; nenhuma rolagem nova sem `keyboardShouldPersistTaps="handled"`; linha de lista só dentro de `Section`; nada de `Platform.OS` em `src/app/`.
- Portão: `npx tsc --noEmit && npx expo lint && npm test; echo exit=$?` (olhe o CÓDIGO DE SAÍDA, nunca a contagem). SQL: suíte inteira no fim do banco (falhas pré-existentes conhecidas: `finance_write_preview`, `preview_counted_debt_payments`, `subcategory_financial_preview`; `income_pending` depende de banco vazio).

## Review Focus

1. **"Esta e as próximas" aberta na PRIMEIRA ocorrência/parcela** vira "Todas" (encerrar na véspera do início seria recusado por `end_recurring_series`; encurtar para 0 parcelas não existe) — testes em Task 1 (série) e Task 2 (compra).
2. **Sobrar UMA parcela** depois de apagar (a compra de 2x perde uma; `installment_plans.installments` tem `check between 2 and 72`) — a sobrevivente vira lançamento à vista e o plano sai — teste em Task 2.
3. **Ocorrência ATRASADA entre a âncora e hoje** sai em "Esta e as próximas" (é "em aberto dali em diante"); a paga e a atrasada ANTES da âncora ficam — teste em Task 1.
4. **Duplo toque / rede que cai**: a mesma `p_request_id` devolve o resultado anterior sem apagar de novo; mesma chave com outro payload é recusada — teste em Task 1.
5. **Apagar compra numa fatura paga em parte** pelo caminho comum (lista, arrasto) não deixa a fatura com total abaixo do pago — teste em Task 5.

---

## File Structure

- `supabase/migrations/20261008100000_apagar_com_alcance.sql` — recibo, resumo, trava, comando, ramo da série, portas públicas (Task 1).
- `supabase/migrations/20261008100100_apagar_parcelas.sql` — ramo da compra parcelada (Task 2).
- `supabase/migrations/20261008100200_apagar_pagamentos.sql` — ramo do financiamento (Task 3).
- `supabase/migrations/20261008100300_apagar_lembrete.sql` — ramo do lembrete (Task 4).
- `supabase/migrations/20261008100400_apagar_nao_derruba_fatura.sql` — gatilho do delete comum (Task 5).
- `supabase/tests/apagar_com_alcance.sql` — um teste que cresce por tarefa (cada tarefa acrescenta um bloco antes do `end $$;`).
- `src/lib/edit-scope-model.ts` (+ `deleteScopeChoices`), `src/lib/edit-scope.ts` (+ `askDeleteScope`), `src/lib/edit-scope.test.ts`.
- `src/lib/apagar-com-alcance.ts` + `.test.ts` — tipos, leitura da prévia, frase do estrago, texto do toast, alvo de um lançamento.
- `src/hooks/use-apagar-com-alcance.ts` — o fluxo (pergunta → prévia → confirmação → escrita).
- Telas (Tasks 8–10) e `src/lib/simple-finance-ui.test.ts`.

---

### Task 1: Banco — comando, recibo, prévia e o ramo da SÉRIE

**Files:**
- Create: `supabase/migrations/20261008100000_apagar_com_alcance.sql`
- Create: `supabase/tests/apagar_com_alcance.sql`
- Modify: `supabase/tests/anon_sem_execute.sql` (as duas funções públicas novas entram na lista do `authenticated`, em ordem alfabética, como as outras)

**Interfaces:**
- Produces:
  - `public.delete_scoped(p_tipo text, p_id uuid, p_alcance text, p_request_id uuid, p_anchor date default null) returns jsonb`
  - `public.delete_scoped_preview(p_tipo text, p_id uuid, p_alcance text, p_anchor date default null) returns jsonb`
  - JSON: `{ "apagadas": int, "pagas_apagadas": int, "soma_pagas_cents": "<texto>", "contas": [nomes], "desde": "YYYY-MM-DD"|null, "apaga_contrato": bool }`
  - `p_tipo ∈ occurrence | installment | debt_payment | recurring | plan | debt | reminder`; `p_alcance ∈ one | future | all`; `recurring/plan/debt` recusam `one`.
  - `p_anchor` só vale para `recurring` (a data de uma ocorrência PREVISTA); padrão = `next_run_at` local.
  - Internos que as Tasks 2–4 implementam: `private.apagar_parcelas(p_tipo text, p_id uuid, p_alcance text, p_ws uuid, p_apply boolean) returns jsonb`, `private.apagar_pagamentos(...)` (mesma assinatura), `private.apagar_lembrete(p_id uuid, p_alcance text, p_ws uuid, p_apply boolean) returns jsonb`. Helpers compartilhados: `private.resumo_do_apagar(uuid[]) returns jsonb`, `private.recusa_fatura_travada(uuid[]) returns void`.

- [ ] **Step 1: Escrever o teste (RED)** — `supabase/tests/apagar_com_alcance.sql`:

```sql
-- Apagar com alcance (07/10/2026): "Só esta / Esta e as próximas / Todas" numa operação atômica.
begin;
set local timezone to 'America/Sao_Paulo';

insert into auth.users (id, instance_id, aud, role, phone, raw_user_meta_data, raw_app_meta_data)
values
  ('00000000-0000-0000-0000-0000000da001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '+5511999992001', '{}', '{}'),
  ('00000000-0000-0000-0000-0000000da002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '+5511999992002', '{}', '{}');

do $$
declare
  u constant uuid := '00000000-0000-0000-0000-0000000da001';
  outro constant uuid := '00000000-0000-0000-0000-0000000da002';
  ws uuid; ws_outro uuid;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  conta uuid; serie uuid; t_pago uuid; t_atrasada uuid; t_ancora uuid; t_depois uuid; t_longe uuid;
  r jsonb; n int; chave uuid := gen_random_uuid(); cfg text[];
begin
  select id into ws from public.workspaces where owner_id = u;
  select id into ws_outro from public.workspaces where owner_id = outro;

  for cfg in select p.proconfig from pg_proc p join pg_namespace s on s.oid = p.pronamespace
             where s.nspname = 'private' and p.proname = 'delete_scoped' loop
    assert array_to_string(cfg, ',') like '%TimeZone=America/Sao_Paulo%', 'comando sem fuso no cabeçalho';
  end loop;

  insert into public.accounts (workspace_id, user_id, name, type) values (ws, u, 'Conta AA', 'checking') returning id into conta;
  insert into public.recurring_transactions (workspace_id, user_id, kind, amount_cents, description, rrule, dtstart, next_run_at, account_id)
  values (ws, u, 'expense', 10000, 'Academia AA', 'FREQ=MONTHLY;BYMONTHDAY=5',
          ((hoje - 70) + time '09:00') at time zone 'America/Sao_Paulo',
          ((hoje + 20) + time '09:00') at time zone 'America/Sao_Paulo', conta)
  returning id into serie;
  -- paga há 70 dias, atrasada há 40, ÂNCORA há 10 (atrasada), em aberto daqui a 20 e daqui a 50
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, recurring_id)
  values (ws, u, 'expense', 10000, 'Academia AA', hoje - 70, 'cleared', conta, serie) returning id into t_pago;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, recurring_id)
  values (ws, u, 'expense', 10000, 'Academia AA', hoje - 40, 'pending', conta, serie) returning id into t_atrasada;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, recurring_id)
  values (ws, u, 'expense', 10000, 'Academia AA', hoje - 10, 'pending', conta, serie) returning id into t_ancora;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, recurring_id)
  values (ws, u, 'expense', 10000, 'Academia AA', hoje + 20, 'pending', conta, serie) returning id into t_depois;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, recurring_id)
  values (ws, u, 'expense', 10000, 'Academia AA', hoje + 50, 'pending', conta, serie) returning id into t_longe;

  perform set_config('request.jwt.claim.sub', u::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- 1) prévia de "Todas" conta a paga e não apaga nada
  r := public.delete_scoped_preview('occurrence', t_ancora, 'all');
  assert (r->>'apagadas')::int = 5 and (r->>'pagas_apagadas')::int = 1 and r->>'soma_pagas_cents' = '10000',
    format('prévia todas: %s', r);
  assert r->'contas' = '["Conta AA"]'::jsonb and (r->>'desde')::date = hoje - 70, format('contas/desde: %s', r);
  select count(*) into n from public.transactions where recurring_id = serie;
  assert n = 5, 'prévia não apaga';

  -- 2) "Esta e as próximas" a partir da âncora atrasada: âncora, +20 e +50 saem; paga e atrasada ANTES ficam;
  --    a série termina na véspera da âncora
  r := public.delete_scoped('occurrence', t_ancora, 'future', chave);
  assert (r->>'apagadas')::int = 3 and (r->>'pagas_apagadas')::int = 0, format('futuras: %s', r);
  select count(*) into n from public.transactions where recurring_id = serie;
  assert n = 2, format('ficam a paga e a atrasada, veio %s', n);
  assert (select end_date from public.recurring_transactions where id = serie) = hoje - 11, 'fim = véspera da âncora';

  -- 3) mesma chave = mesmo resultado, sem efeito novo; mesma chave com outro pedido = recusa
  r := public.delete_scoped('occurrence', t_ancora, 'future', chave);
  assert (r->>'apagadas')::int = 3, 'repetição devolve o recibo';
  begin
    perform public.delete_scoped('occurrence', t_atrasada, 'one', chave);
    n := -1;
  exception when others then
    assert sqlstate = '22023' and sqlerrm = 'Identificador reutilizado com dados diferentes', format('chave: %s %s', sqlstate, sqlerrm);
  end;
  assert n <> -1, 'chave reutilizada devia ser recusada';

  -- 4) "Só esta" na atrasada: some e a data não volta (marca do agendador)
  -- O teste é UMA transação: a marca `proops.series_editadas` do passo 2 (o UPDATE de end_date) ainda
  -- valeria aqui e calaria `ocorrencia_apagada_nao_volta`. Na vida real cada chamada é outra transação.
  perform set_config('proops.series_editadas', '', true);
  r := public.delete_scoped('occurrence', t_atrasada, 'one', gen_random_uuid());
  assert (r->>'apagadas')::int = 1, format('só esta: %s', r);
  reset role;
  assert exists (select 1 from private.recurring_moved_occurrences m where m.recurring_id = serie and m.original_date = hoje - 40),
    'a data apagada não pode voltar pelo agendador';
  set local role authenticated;

  -- 5) contrato não tem "só esta"; outro espaço não apaga
  begin
    perform public.delete_scoped_preview('recurring', serie, 'one');
    n := -1;
  exception when others then
    assert sqlstate = '22023', format('contrato one: %s %s', sqlstate, sqlerrm);
  end;
  assert n <> -1, 'contrato com "só esta" devia ser recusado';
  perform set_config('request.jwt.claim.sub', outro::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', outro, 'role', 'authenticated')::text, true);
  begin
    perform public.delete_scoped_preview('recurring', serie, 'all');
    n := -1;
  exception when others then
    assert sqlstate = 'P0001' and sqlerrm = 'Esse registro não existe mais', format('outro espaço: %s %s', sqlstate, sqlerrm);
  end;
  assert n <> -1, 'outro espaço devia ser recusado';
  perform set_config('request.jwt.claim.sub', u::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);

  -- 6) "Todas" pelo contrato: a série e a paga saem
  r := public.delete_scoped('recurring', serie, 'all', gen_random_uuid());
  assert (r->>'apagadas')::int = 1 and (r->>'pagas_apagadas')::int = 1, format('todas: %s', r);
  reset role;
  assert not exists (select 1 from public.recurring_transactions where id = serie), 'a série sai';
  assert not exists (select 1 from public.transactions where recurring_id = serie or id = t_pago), 'as ocorrências saem';
  set local role authenticated;

  -- 7) "Esta e as próximas" na PRIMEIRA ocorrência = "Todas"
  reset role;
  insert into public.recurring_transactions (workspace_id, user_id, kind, amount_cents, description, rrule, dtstart, next_run_at, account_id)
  values (ws, u, 'expense', 5000, 'Streaming AA', 'FREQ=MONTHLY;BYMONTHDAY=10',
          ((hoje + 5) + time '09:00') at time zone 'America/Sao_Paulo',
          ((hoje + 5) + time '09:00') at time zone 'America/Sao_Paulo', conta)
  returning id into serie;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, recurring_id)
  values (ws, u, 'expense', 5000, 'Streaming AA', hoje + 5, 'pending', conta, serie) returning id into t_ancora;
  set local role authenticated;
  r := public.delete_scoped('occurrence', t_ancora, 'future', gen_random_uuid());
  reset role;
  assert not exists (select 1 from public.recurring_transactions where id = serie), 'a partir da primeira = a série inteira';
  set local role authenticated;

  -- BLOCOS DAS PRÓXIMAS TAREFAS ENTRAM AQUI
  reset role;
end $$;

rollback;
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `agent/.venv/bin/python scripts/sql-test.py supabase/tests/apagar_com_alcance.sql </dev/null`
Expected: FAIL com `function public.delete_scoped_preview(...) does not exist`.

- [ ] **Step 3: Escrever a migration** — `supabase/migrations/20261008100000_apagar_com_alcance.sql`:

```sql
-- Apagar com alcance (spec 2026-10-07-apagar-com-alcance-design.md). UMA conta para a prévia e o
-- comando — a confirmação e a escrita não podem discordar (o desenho de end_recurring_series).

create table if not exists private.delete_scoped_receipts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, request_id)
);
create index if not exists delete_scoped_receipts_workspace_idx on private.delete_scoped_receipts(workspace_id);
alter table private.delete_scoped_receipts enable row level security;
revoke all on private.delete_scoped_receipts from public, anon, authenticated, service_role;

-- O que a confirmação precisa dizer: quantas, quantas pagas, quanto, de quais contas, desde quando.
create or replace function private.resumo_do_apagar(p_ids uuid[])
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'apagadas', count(*),
    'pagas_apagadas', count(*) filter (where t.status = 'cleared'),
    'soma_pagas_cents', (coalesce(sum(t.amount_cents) filter (where t.status = 'cleared'), 0))::text,
    'contas', coalesce((select jsonb_agg(distinct a.name order by a.name)
                          from public.transactions x join public.accounts a on a.id = x.account_id
                         where x.id = any(p_ids) and x.status = 'cleared'), '[]'::jsonb),
    'desde', min(t.occurred_at) filter (where t.status = 'cleared'),
    'apaga_contrato', false)
  from public.transactions t where t.id = any(p_ids)
$$;
revoke execute on function private.resumo_do_apagar(uuid[]) from public, anon, authenticated;

-- Linha em fatura paga, adiada ou paga em parte não sai — a régua de delete_installment_purchase.
create or replace function private.recusa_fatura_travada(p_ids uuid[])
returns void language plpgsql stable set search_path = '' as $$
begin
  if exists (select 1 from public.transactions t
             where t.id = any(p_ids) and private.parcela_travada('pending', t.invoice_id)) then
    raise exception using errcode = 'P0001',
      message = 'Há lançamento numa fatura paga, adiada ou paga em parte. Desfaça o pagamento da fatura antes.';
  end if;
end $$;
revoke execute on function private.recusa_fatura_travada(uuid[]) from public, anon, authenticated;

-- Ramo da SÉRIE. "Em aberto dali em diante" = pendente com dia >= âncora (dia = vencimento fora
-- do cartão, data da compra no cartão — a régua de series_end_scope); a âncora sai mesmo paga.
-- ⚠️ series_end_scope só olha o futuro (>= hoje) e por isso NÃO serve aqui: a atrasada entre a
-- âncora e hoje também é "próxima".
create or replace function private.apagar_serie(
  p_tipo text, p_id uuid, p_alcance text, p_anchor date, p_ws uuid, p_apply boolean
) returns jsonb
language plpgsql set search_path = '' set timezone to 'America/Sao_Paulo'
as $$
declare
  r public.recurring_transactions%rowtype;
  ancora public.transactions%rowtype;
  dia date; inicio date; ids uuid[]; tudo boolean := p_alcance = 'all'; res jsonb;
begin
  if p_tipo = 'occurrence' then
    select * into ancora from public.transactions t where t.id = p_id and t.workspace_id = p_ws;
    if ancora.recurring_id is null then
      raise exception using errcode = '22023', message = 'Este lançamento não é de uma série';
    end if;
    select * into r from public.recurring_transactions x where x.id = ancora.recurring_id;
    dia := case when ancora.invoice_id is null then coalesce(ancora.due_at, ancora.occurred_at) else ancora.occurred_at end;
  else
    select * into r from public.recurring_transactions x where x.id = p_id;
    dia := coalesce(p_anchor, (r.next_run_at at time zone 'America/Sao_Paulo')::date);
  end if;
  if p_apply then
    perform 1 from public.recurring_transactions x where x.id = r.id for update;
    perform 1 from public.transactions t where t.recurring_id = r.id and t.workspace_id = p_ws order by t.id for update;
  end if;
  -- o início original, como end_recurring_series: dtstart é reescrito a cada edição de calendário
  inicio := least((coalesce(r.dtstart, r.next_run_at) at time zone 'America/Sao_Paulo')::date,
    (select min(v.valid_from) from private.recurring_history_versions v where v.recurring_id = r.id),
    (select min(t.occurred_at) from public.transactions t where t.recurring_id = r.id and t.workspace_id = p_ws));
  if p_alcance = 'future' and dia - 1 < inicio then tudo := true; end if;

  if p_alcance = 'one' then
    ids := array[ancora.id];
  elsif tudo then
    select array_agg(t.id) into ids from public.transactions t where t.recurring_id = r.id and t.workspace_id = p_ws;
  else
    select array_agg(s.id) into ids from (
      select t.id, case when t.invoice_id is null then coalesce(t.due_at, t.occurred_at) else t.occurred_at end as d
      from public.transactions t
      where t.recurring_id = r.id and t.workspace_id = p_ws and t.status = 'pending') s
    where s.d >= dia;
    if ancora.id is not null and not (ancora.id = any(coalesce(ids, '{}'))) then
      ids := coalesce(ids, '{}') || ancora.id;
    end if;
  end if;
  ids := coalesce(ids, '{}');
  perform private.recusa_fatura_travada(ids);
  res := private.resumo_do_apagar(ids) || jsonb_build_object('apaga_contrato', tudo);
  if not p_apply then return res; end if;

  if p_alcance = 'one' then
    delete from public.transactions t where t.id = ancora.id;          -- a marca impede o agendador de recriar
  elsif tudo then
    delete from public.transactions t where t.id = any(ids);
    delete from public.recurring_transactions x where x.id = r.id;     -- as marcas saem no cascade
  else
    -- O UPDATE vem antes do DELETE (marca_serie_editada), como em end_recurring_series.
    update public.recurring_transactions x set end_date = dia - 1 where x.id = r.id;
    delete from public.transactions t where t.id = any(ids);
  end if;
  return res;
end $$;
revoke execute on function private.apagar_serie(text, uuid, text, date, uuid, boolean) from public, anon, authenticated;

create or replace function private.delete_scoped(
  p_tipo text, p_id uuid, p_alcance text, p_anchor date, p_request_id uuid, p_apply boolean
) returns jsonb
language plpgsql security definer set search_path = '' set timezone to 'America/Sao_Paulo'
as $$
declare
  uid uuid := auth.uid();
  ws uuid; intent jsonb; sealed private.delete_scoped_receipts%rowtype; result jsonb;
begin
  if uid is null then
    raise exception using errcode = '42501', message = 'Autenticação obrigatória';
  end if;
  if p_id is null
     or p_tipo is null or p_tipo not in ('occurrence', 'installment', 'debt_payment', 'recurring', 'plan', 'debt', 'reminder')
     or p_alcance is null or p_alcance not in ('one', 'future', 'all') then
    raise exception using errcode = '22023', message = 'Pedido de apagar inválido';
  end if;
  if p_tipo in ('recurring', 'plan', 'debt') and p_alcance = 'one' then
    raise exception using errcode = '22023', message = 'Pelo contrato não existe "só esta"';
  end if;
  if p_apply and p_request_id is null then
    raise exception using errcode = '22023', message = 'Identificador da tentativa obrigatório';
  end if;
  ws := case
    when p_tipo in ('occurrence', 'installment', 'debt_payment') then (select t.workspace_id from public.transactions t where t.id = p_id)
    when p_tipo = 'recurring' then (select r.workspace_id from public.recurring_transactions r where r.id = p_id)
    when p_tipo = 'plan' then (select p.workspace_id from public.installment_plans p where p.id = p_id)
    when p_tipo = 'debt' then (select d.workspace_id from public.debts d where d.id = p_id)
    else (select r.workspace_id from public.reminders r where r.id = p_id and r.user_id = uid) end;
  if ws is null or not exists (select 1 from public.workspace_members m where m.workspace_id = ws and m.user_id = uid) then
    raise exception using errcode = 'P0001', message = 'Esse registro não existe mais';
  end if;
  if p_apply then
    intent := jsonb_build_object('operation', 'delete_scoped', 'tipo', p_tipo, 'id', p_id,
                                 'alcance', p_alcance, 'anchor', p_anchor);
    perform pg_advisory_xact_lock(hashtextextended('delete-scoped:' || ws::text, 0));
    select * into sealed from private.delete_scoped_receipts where user_id = uid and request_id = p_request_id;
    if sealed.request_id is not null then
      if sealed.payload is distinct from intent then
        raise exception using errcode = '22023', message = 'Identificador reutilizado com dados diferentes';
      end if;
      return sealed.result;
    end if;
  end if;
  result := case
    when p_tipo in ('occurrence', 'recurring') then private.apagar_serie(p_tipo, p_id, p_alcance, p_anchor, ws, p_apply)
    when p_tipo in ('installment', 'plan') then private.apagar_parcelas(p_tipo, p_id, p_alcance, ws, p_apply)
    when p_tipo in ('debt_payment', 'debt') then private.apagar_pagamentos(p_tipo, p_id, p_alcance, ws, p_apply)
    else private.apagar_lembrete(p_id, p_alcance, ws, p_apply) end;
  if p_apply then
    insert into private.delete_scoped_receipts(user_id, request_id, workspace_id, payload, result)
      values (uid, p_request_id, ws, intent, result);
  end if;
  return result;
end $$;
revoke execute on function private.delete_scoped(text, uuid, text, date, uuid, boolean) from public, anon;
grant execute on function private.delete_scoped(text, uuid, text, date, uuid, boolean) to authenticated;

create or replace function public.delete_scoped(
  p_tipo text, p_id uuid, p_alcance text, p_request_id uuid, p_anchor date default null
) returns jsonb language sql security invoker set search_path = '' set timezone to 'America/Sao_Paulo' as $$
  select private.delete_scoped(p_tipo, p_id, p_alcance, p_anchor, p_request_id, true)
$$;
create or replace function public.delete_scoped_preview(
  p_tipo text, p_id uuid, p_alcance text, p_anchor date default null
) returns jsonb language sql security invoker set search_path = '' set timezone to 'America/Sao_Paulo' as $$
  select private.delete_scoped(p_tipo, p_id, p_alcance, p_anchor, null, false)
$$;
revoke execute on function public.delete_scoped(text, uuid, text, uuid, date) from public, anon;
revoke execute on function public.delete_scoped_preview(text, uuid, text, date) from public, anon;
grant execute on function public.delete_scoped(text, uuid, text, uuid, date) to authenticated;
grant execute on function public.delete_scoped_preview(text, uuid, text, date) to authenticated;
```

> ⚠️ Os ramos `apagar_parcelas`, `apagar_pagamentos` e `apagar_lembrete` só nascem nas Tasks 2–4. O `case` do plpgsql resolve a chamada na hora, então este comando compila e os tipos da série funcionam já; chamar `installment` antes da Task 2 dá "function does not exist" — esperado.

- [ ] **Step 4: Rodar com a migration prefixada (GREEN)**

Run: `cat supabase/migrations/20261008100000_apagar_com_alcance.sql supabase/tests/apagar_com_alcance.sql > /tmp/aa.sql && agent/.venv/bin/python scripts/sql-test.py /tmp/aa.sql </dev/null`
Expected: PASS (sem `ERROR`/`assert`).

- [ ] **Step 5: `anon_sem_execute.sql`** — acrescente `delete_scoped` e `delete_scoped_preview` à lista do `authenticated` (mesma forma das outras linhas). Run: `cat supabase/migrations/20261008100000_apagar_com_alcance.sql supabase/tests/anon_sem_execute.sql > /tmp/anon.sql && agent/.venv/bin/python scripts/sql-test.py /tmp/anon.sql </dev/null` → PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261008100000_apagar_com_alcance.sql supabase/tests/apagar_com_alcance.sql supabase/tests/anon_sem_execute.sql
git commit -m "feat(db): apagar com alcance, comando e ramo da serie"
```

---

### Task 2: Banco — o ramo da COMPRA PARCELADA

**Files:**
- Create: `supabase/migrations/20261008100100_apagar_parcelas.sql`
- Modify: `supabase/tests/apagar_com_alcance.sql` (bloco novo no lugar de `-- BLOCOS DAS PRÓXIMAS TAREFAS ENTRAM AQUI`, mantendo o marcador depois dele)

**Interfaces:**
- Consumes: `private.resumo_do_apagar`, `private.recusa_fatura_travada`, `public.delete_installment_purchase(uuid)` (`20261001155149`, recusa linha em fatura travada e leva a entrada).
- Produces: `private.apagar_parcelas(p_tipo text, p_id uuid, p_alcance text, p_ws uuid, p_apply boolean) returns jsonb`.

- [ ] **Step 1: Teste (RED)** — bloco a acrescentar (as variáveis novas entram no `declare` do topo: `plano uuid; p1 uuid; p2 uuid; p3 uuid; p4 uuid; soma bigint; k int;`):

```sql
  -- ── Task 2: compra parcelada (conta corrente, 4x de 25,00; a 1ª paga) ──
  reset role;
  insert into public.installment_plans (workspace_id, user_id, account_id, total_cents, installments, first_occurred_at, description)
  values (ws, u, conta, 10000, 4, hoje - 30, 'Fone AA') returning id into plano;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, installment_plan_id, installment_no)
  values (ws, u, 'expense', 2500, 'Fone AA (1/4)', hoje - 30, 'cleared', conta, plano, 1) returning id into p1;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, installment_plan_id, installment_no)
  values (ws, u, 'expense', 2500, 'Fone AA (2/4)', hoje, 'pending', conta, plano, 2) returning id into p2;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, installment_plan_id, installment_no)
  values (ws, u, 'expense', 2500, 'Fone AA (3/4)', hoje + 30, 'pending', conta, plano, 3) returning id into p3;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, installment_plan_id, installment_no)
  values (ws, u, 'expense', 2500, 'Fone AA (4/4)', hoje + 60, 'pending', conta, plano, 4) returning id into p4;
  set local role authenticated;

  -- "Só esta" na 4ª: o total vira a soma das que ficam
  r := public.delete_scoped('installment', p4, 'one', gen_random_uuid());
  reset role;
  select total_cents, installments into soma, k from public.installment_plans where id = plano;
  assert soma = 7500 and k = 3, format('só esta: total %s, parcelas %s', soma, k);
  set local role authenticated;

  -- "Esta e as próximas" na 3ª: sobram 1ª e 2ª, total 5000
  r := public.delete_scoped('installment', p3, 'future', gen_random_uuid());
  reset role;
  select total_cents, installments into soma, k from public.installment_plans where id = plano;
  assert soma = 5000 and k = 2, format('futuras: total %s, parcelas %s', soma, k);
  set local role authenticated;

  -- sobrar UMA: a 2ª sai e a 1ª vira lançamento à vista; o plano some
  r := public.delete_scoped('installment', p2, 'one', gen_random_uuid());
  reset role;
  assert not exists (select 1 from public.installment_plans where id = plano), 'sobrando uma, o plano sai';
  assert (select installment_plan_id is null and installment_no is null and description = 'Fone AA'
          from public.transactions where id = p1), 'a sobrevivente vira lançamento à vista com o nome da compra';
  set local role authenticated;

  -- "Esta e as próximas" pela 1ª = a compra inteira (com a paga)
  reset role;
  insert into public.installment_plans (workspace_id, user_id, account_id, total_cents, installments, first_occurred_at, description)
  values (ws, u, conta, 6000, 2, hoje - 30, 'Tênis AA') returning id into plano;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, installment_plan_id, installment_no)
  values (ws, u, 'expense', 3000, 'Tênis AA (1/2)', hoje - 30, 'cleared', conta, plano, 1) returning id into p1;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, installment_plan_id, installment_no)
  values (ws, u, 'expense', 3000, 'Tênis AA (2/2)', hoje + 30, 'pending', conta, plano, 2) returning id into p2;
  set local role authenticated;
  r := public.delete_scoped_preview('installment', p1, 'future');
  assert (r->>'apagadas')::int = 2 and (r->>'pagas_apagadas')::int = 1 and (r->>'apaga_contrato')::boolean,
    format('a partir da 1ª: %s', r);
  r := public.delete_scoped('plan', plano, 'all', gen_random_uuid());
  reset role;
  assert not exists (select 1 from public.installment_plans where id = plano), 'todas: o plano sai';
  assert not exists (select 1 from public.transactions where id in (p1, p2)), 'todas: as parcelas saem';
  set local role authenticated;
```

- [ ] **Step 2: Rodar e ver falhar** — `cat supabase/migrations/20261008100000_apagar_com_alcance.sql supabase/tests/apagar_com_alcance.sql > /tmp/aa.sql && agent/.venv/bin/python scripts/sql-test.py /tmp/aa.sql </dev/null` → FAIL `function private.apagar_parcelas(...) does not exist`.

- [ ] **Step 3: Migration** — `supabase/migrations/20261008100100_apagar_parcelas.sql`:

```sql
-- Ramo da COMPRA PARCELADA. "Esta e as próximas" encurta; a partir da 1ª é a compra inteira.
-- Sobrando UMA parcela, ela vira lançamento à vista (o plano tem check 2..72).
create or replace function private.apagar_parcelas(
  p_tipo text, p_id uuid, p_alcance text, p_ws uuid, p_apply boolean
) returns jsonb
language plpgsql set search_path = '' set timezone to 'America/Sao_Paulo'
as $$
declare
  plano public.installment_plans%rowtype;
  ancora public.transactions%rowtype;
  n_ancora int; ids uuid[]; res jsonb; restantes int; soma bigint; sobra uuid;
begin
  if p_tipo = 'installment' then
    select * into ancora from public.transactions t where t.id = p_id and t.workspace_id = p_ws;
    if ancora.installment_plan_id is null then
      raise exception using errcode = '22023', message = 'Este lançamento não é parcela de uma compra';
    end if;
    select * into plano from public.installment_plans p where p.id = ancora.installment_plan_id;
    n_ancora := ancora.installment_no;
  else
    select * into plano from public.installment_plans p where p.id = p_id;
    -- pelo contrato, "próximas" = a primeira parcela em aberto fora de fatura travada
    select min(t.installment_no) into n_ancora from public.transactions t
      where t.installment_plan_id = plano.id and t.workspace_id = p_ws and t.status = 'pending'
        and not private.parcela_travada('pending', t.invoice_id);
    if n_ancora is null and p_alcance = 'future' then
      return private.resumo_do_apagar('{}');
    end if;
  end if;
  if p_apply then
    perform 1 from public.installment_plans p where p.id = plano.id for update;
    perform 1 from public.transactions t where t.installment_plan_id = plano.id order by t.id for update;
  end if;

  if p_alcance = 'all' or (p_alcance = 'future' and n_ancora <= 1) then
    select array_agg(t.id) into ids from public.transactions t
      where (t.installment_plan_id = plano.id or t.down_payment_plan_id = plano.id) and t.workspace_id = p_ws;
    ids := coalesce(ids, '{}');
    perform private.recusa_fatura_travada(ids);
    res := private.resumo_do_apagar(ids) || jsonb_build_object('apaga_contrato', true);
    if p_apply then perform public.delete_installment_purchase(plano.id); end if;
    return res;
  end if;

  if p_alcance = 'one' then
    ids := array[ancora.id];
  else
    select array_agg(t.id) into ids from public.transactions t
      where t.installment_plan_id = plano.id and t.workspace_id = p_ws and t.installment_no >= n_ancora;
  end if;
  ids := coalesce(ids, '{}');
  perform private.recusa_fatura_travada(ids);
  res := private.resumo_do_apagar(ids);
  if not p_apply then return res; end if;

  delete from public.transactions t where t.id = any(ids);
  select count(*), coalesce(sum(t.amount_cents), 0) into restantes, soma
    from public.transactions t where t.installment_plan_id = plano.id;
  if restantes = 0 then
    perform public.delete_installment_purchase(plano.id);
  elsif restantes = 1 then
    select t.id into sobra from public.transactions t where t.installment_plan_id = plano.id;
    update public.transactions t set installment_plan_id = null, installment_no = null,
           description = coalesce(plano.description, plano.merchant, t.description)
     where t.id = sobra;
    delete from public.installment_plans p where p.id = plano.id;
  else
    -- ponytail: "Só esta" no meio deixa um buraco no installment_no (1,2,4); o rótulo "(k/N)" está
    -- no texto de cada parcela e não é reescrito. Renumerar quando alguém pedir.
    update public.installment_plans p set installments = restantes, total_cents = soma where p.id = plano.id;
  end if;
  return res;
end $$;
revoke execute on function private.apagar_parcelas(text, uuid, text, uuid, boolean) from public, anon, authenticated;
```

- [ ] **Step 4: GREEN** — `cat supabase/migrations/20261008100000_apagar_com_alcance.sql supabase/migrations/20261008100100_apagar_parcelas.sql supabase/tests/apagar_com_alcance.sql > /tmp/aa.sql && agent/.venv/bin/python scripts/sql-test.py /tmp/aa.sql </dev/null` → PASS.

- [ ] **Step 5: Commit** — `git add supabase/migrations/20261008100100_apagar_parcelas.sql supabase/tests/apagar_com_alcance.sql && git commit -m "feat(db): apagar parcelas com alcance"`

---

### Task 3: Banco — o ramo do FINANCIAMENTO

**Files:**
- Create: `supabase/migrations/20261008100200_apagar_pagamentos.sql`
- Modify: `supabase/tests/apagar_com_alcance.sql`

**Interfaces:**
- Consumes: `public.pay_debt_installment(debt uuid, amount bigint, account uuid, date)` (fixture), o gatilho `tg_transactions_debt_payment` (apagar um pagamento devolve o principal e renumera), `public.delete_debt(uuid)`.
- Produces: `private.apagar_pagamentos(p_tipo text, p_id uuid, p_alcance text, p_ws uuid, p_apply boolean) returns jsonb`.

- [ ] **Step 1: Teste (RED)** — variáveis novas no `declare`: `d uuid; pg1 uuid; pg2 uuid; pg3 uuid; restante bigint;`:

```sql
  -- ── Task 3: financiamento de parcela fixa, 6x de 100,00, três pagas ──
  reset role;
  insert into public.debts(workspace_id, user_id, name, kind, calculation_mode, principal_cents,
    remaining_cents, interest_rate_monthly, installments, installments_paid, installment_cents, due_day, first_due_date, account_id)
  values (ws, u, 'Moto AA', 'financing', 'fixed_installments', 60000, 60000, 0, 6, 0, 10000, 10, hoje - 80, conta)
  returning id into d;
  perform public.pay_debt_installment(d, 10000, conta, hoje - 80);
  perform public.pay_debt_installment(d, 10000, conta, hoje - 50);
  perform public.pay_debt_installment(d, 10000, conta, hoje - 20);
  select id into pg1 from public.transactions where debt_id = d and debt_payment_no = 1;
  select id into pg2 from public.transactions where debt_id = d and debt_payment_no = 2;
  set local role authenticated;

  -- "Este e os próximos" a partir do 2º: saem o 3º e o 2º (do mais recente para trás); o saldo volta
  r := public.delete_scoped_preview('debt_payment', pg2, 'future');
  assert (r->>'apagadas')::int = 2 and (r->>'pagas_apagadas')::int = 2 and r->>'soma_pagas_cents' = '20000',
    format('prévia pagamentos: %s', r);
  r := public.delete_scoped('debt_payment', pg2, 'future', gen_random_uuid());
  reset role;
  select remaining_cents into restante from public.debts where id = d;
  assert restante = 50000, format('o saldo volta a 50000, veio %s', restante);
  assert (select count(*) from public.transactions where debt_id = d) = 1, 'fica só o 1º pagamento';
  set local role authenticated;

  -- "Todos" = a dívida inteira com os pagamentos
  r := public.delete_scoped('debt_payment', pg1, 'all', gen_random_uuid());
  assert (r->>'apaga_contrato')::boolean, format('todos apaga o contrato: %s', r);
  reset role;
  assert not exists (select 1 from public.debts where id = d), 'a dívida sai';
  set local role authenticated;
```

- [ ] **Step 2: RED** — prefixe as migrations de Tasks 1–2 como na Task 2 Step 4 → FAIL `private.apagar_pagamentos does not exist`.

- [ ] **Step 3: Migration** — `supabase/migrations/20261008100200_apagar_pagamentos.sql`:

```sql
-- Ramo do FINANCIAMENTO. Pagamentos saem um a um, do MAIS RECENTE para trás, para o gatilho
-- devolver o saldo na ordem certa. "Todos" é o Excluir por completo (delete_debt).
create or replace function private.apagar_pagamentos(
  p_tipo text, p_id uuid, p_alcance text, p_ws uuid, p_apply boolean
) returns jsonb
language plpgsql set search_path = '' set timezone to 'America/Sao_Paulo'
as $$
declare
  divida uuid; ancora public.transactions%rowtype; ids uuid[]; res jsonb; x uuid;
begin
  if p_tipo = 'debt_payment' then
    select * into ancora from public.transactions t where t.id = p_id and t.workspace_id = p_ws;
    if ancora.debt_id is null then
      raise exception using errcode = '22023', message = 'Este lançamento não é pagamento de uma dívida';
    end if;
    divida := ancora.debt_id;
  else
    divida := p_id;
  end if;
  if p_apply then perform 1 from public.debts d where d.id = divida for update; end if;

  if p_alcance = 'all' then
    select array_agg(t.id) into ids from public.transactions t
      where (t.debt_id = divida or t.down_payment_debt_id = divida) and t.workspace_id = p_ws;
    ids := coalesce(ids, '{}');
    perform private.recusa_fatura_travada(ids);
    res := private.resumo_do_apagar(ids) || jsonb_build_object('apaga_contrato', true);
    if p_apply then perform public.delete_debt(divida); end if;
    return res;
  end if;

  if p_alcance = 'one' then
    ids := array[ancora.id];
  elsif p_tipo = 'debt_payment' then
    select array_agg(t.id) into ids from public.transactions t
      where t.debt_id = divida and t.workspace_id = p_ws
        and (t.debt_payment_no >= ancora.debt_payment_no
             or (ancora.debt_payment_no is null and t.occurred_at >= ancora.occurred_at));
  else
    -- pelo contrato: "dos próximos em diante" = pagamentos registrados com data depois de hoje
    select array_agg(t.id) into ids from public.transactions t
      where t.debt_id = divida and t.workspace_id = p_ws and t.occurred_at > current_date;
  end if;
  ids := coalesce(ids, '{}');
  perform private.recusa_fatura_travada(ids);
  res := private.resumo_do_apagar(ids);
  if not p_apply then return res; end if;
  for x in select t.id from public.transactions t where t.id = any(ids)
           order by t.debt_payment_no desc nulls last, t.occurred_at desc loop
    delete from public.transactions t where t.id = x;
  end loop;
  return res;
end $$;
revoke execute on function private.apagar_pagamentos(text, uuid, text, uuid, boolean) from public, anon, authenticated;
```

- [ ] **Step 4: GREEN** — as três migrations prefixadas + o teste → PASS.
- [ ] **Step 5: Commit** — `git add supabase/migrations/20261008100200_apagar_pagamentos.sql supabase/tests/apagar_com_alcance.sql && git commit -m "feat(db): apagar pagamentos de divida com alcance"`

---

### Task 4: Banco — o ramo do LEMBRETE

**Files:**
- Create: `supabase/migrations/20261008100300_apagar_lembrete.sql`
- Modify: `supabase/tests/apagar_com_alcance.sql`

**Interfaces:**
- Consumes: `public.reminders` (`recurrence`, `next_run_at`, `skip_run_at`, `parent_reminder_id`, `original_run_at`); o gatilho `restore_deleted_reminder_occurrence` (apagar uma edição pendente devolve a ocorrência original ao pai); o cron pula `next_run_at` quando `skip_run_at = next_run_at` (`agent/app/jobs/reminders.py:105`).
- Produces: `private.apagar_lembrete(p_id uuid, p_alcance text, p_ws uuid, p_apply boolean) returns jsonb`. **Lembrete só tem `one` e `all`**: `future` é recusado (`22023`) — ver "Divergência" no fim.

- [ ] **Step 1: Teste (RED)** — variáveis novas: `lem uuid; filho uuid;`:

```sql
  -- ── Task 4: lembrete que repete ──
  reset role;
  insert into public.reminders (user_id, workspace_id, title, recurrence, next_run_at, timezone, channel, active, source)
  values (u, ws, 'Remédio AA', 'FREQ=DAILY', now() + interval '1 hour', 'America/Sao_Paulo', 'push', true, 'app')
  returning id into lem;
  set local role authenticated;
  -- "Só esta" no pai: a próxima vez é pulada, o lembrete fica
  r := public.delete_scoped('reminder', lem, 'one', gen_random_uuid());
  reset role;
  assert (select skip_run_at = next_run_at from public.reminders where id = lem), 'só esta pula a próxima vez';
  update public.reminders set skip_run_at = null where id = lem;
  -- uma edição pendente desta vez (filho): "Só esta" apaga o filho e a vez continua pulada
  insert into public.reminders (user_id, workspace_id, title, next_run_at, timezone, channel, active, source, parent_reminder_id, original_run_at)
  select u, ws, 'Remédio AA (antes)', next_run_at - interval '30 minutes', 'America/Sao_Paulo', 'push', true, 'app', id, next_run_at
    from public.reminders where id = lem returning id into filho;
  update public.reminders set skip_run_at = next_run_at where id = lem;
  set local role authenticated;
  r := public.delete_scoped('reminder', filho, 'one', gen_random_uuid());
  reset role;
  assert not exists (select 1 from public.reminders where id = filho), 'o filho sai';
  assert (select skip_run_at = next_run_at from public.reminders where id = lem), 'a vez continua pulada';
  set local role authenticated;
  -- "Esta e as próximas" não existe para lembrete
  begin
    perform public.delete_scoped_preview('reminder', lem, 'future');
    n := -1;
  exception when others then
    assert sqlstate = '22023', format('lembrete future: %s %s', sqlstate, sqlerrm);
  end;
  assert n <> -1, 'future em lembrete devia ser recusado';
  -- "Todas": o lembrete inteiro
  r := public.delete_scoped('reminder', lem, 'all', gen_random_uuid());
  reset role;
  assert not exists (select 1 from public.reminders where id = lem), 'todas apaga o lembrete';
  set local role authenticated;
```

- [ ] **Step 2: RED** — prefixe as migrations das Tasks 1–3 → FAIL `private.apagar_lembrete does not exist`.

- [ ] **Step 3: Migration** — `supabase/migrations/20261008100300_apagar_lembrete.sql`:

```sql
-- Ramo do LEMBRETE. "Esta vez" é a próxima (o pai) ou a edição pendente dela (o filho).
-- Não há "Esta e as próximas": os registros do histórico (filhos processados) só existem com o pai
-- (check de 20260927220000), então encerrar mantendo o passado pede um estado novo de lembrete.
create or replace function private.apagar_lembrete(p_id uuid, p_alcance text, p_ws uuid, p_apply boolean)
returns jsonb language plpgsql set search_path = '' as $$
declare l public.reminders%rowtype;
begin
  if p_alcance = 'future' then
    raise exception using errcode = '22023', message = 'Lembrete: escolha só esta vez ou o lembrete inteiro';
  end if;
  select * into l from public.reminders r where r.id = p_id and r.workspace_id = p_ws;
  if p_apply then
    if p_alcance = 'all' then
      delete from public.reminders r where r.id = coalesce(l.parent_reminder_id, l.id);   -- os filhos saem no cascade
    elsif l.parent_reminder_id is null and l.recurrence is null then
      delete from public.reminders r where r.id = l.id;
    elsif l.parent_reminder_id is null then
      update public.reminders r set skip_run_at = r.next_run_at, updated_at = now() where r.id = l.id;
    else
      delete from public.reminders r where r.id = l.id;   -- o gatilho devolve a vez ao pai…
      update public.reminders r set skip_run_at = l.original_run_at, updated_at = now()
       where r.id = l.parent_reminder_id and r.next_run_at = l.original_run_at;   -- …e ela volta a ser pulada
    end if;
  end if;
  return jsonb_build_object('apagadas', 1, 'pagas_apagadas', 0, 'soma_pagas_cents', '0',
                            'contas', '[]'::jsonb, 'desde', null, 'apaga_contrato', p_alcance = 'all');
end $$;
revoke execute on function private.apagar_lembrete(uuid, text, uuid, boolean) from public, anon, authenticated;
```

- [ ] **Step 4: GREEN** — as quatro migrations prefixadas + o teste → PASS.
- [ ] **Step 5: Commit** — `git add supabase/migrations/20261008100300_apagar_lembrete.sql supabase/tests/apagar_com_alcance.sql && git commit -m "feat(db): apagar lembrete com alcance"`

---

### Task 5: Banco — o apagar comum não derruba fatura paga em parte; push no staging

**Files:**
- Create: `supabase/migrations/20261008100400_apagar_nao_derruba_fatura.sql`
- Modify: `supabase/tests/apagar_com_alcance.sql`
- Modify: `src/lib/database.types.ts` (regenerado)
- Modify: `docs/HISTORICO-DE-MIGRATIONS.md` (as cinco migrations, no formato das linhas de `20261007120000`)

**Interfaces:**
- Consumes: `private.invoice_open_cents(uuid)`, `private.conta_na_fatura(text)`.
- Produces: gatilho `apagar_nao_derruba_fatura` (BEFORE DELETE em `transactions`).

- [ ] **Step 1: Teste (RED)** — variáveis novas: `cartao uuid; fatura uuid; compra uuid;`:

```sql
  -- ── Task 5: fatura paga em parte não fica com total abaixo do pago ──
  reset role;
  insert into public.accounts (workspace_id, user_id, name, type, closing_day, due_day)
  values (ws, u, 'Cartão AA', 'credit_card', 3, 10) returning id into cartao;
  insert into public.card_invoices (workspace_id, user_id, account_id, reference_month, closing_date, due_date, paid_cents)
  values (ws, u, cartao, date_trunc('month', hoje)::date, hoje - 5, hoje + 2, 5000) returning id into fatura;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, status, account_id, invoice_id)
  values (ws, u, 'expense', 6000, 'Mercado AA', hoje - 10, 'pending', cartao, fatura) returning id into compra;
  update public.transactions set invoice_id = fatura where id = compra;   -- set_invoice pode ter escolhido outra
  set local role authenticated;
  begin
    delete from public.transactions where id = compra;
    n := -1;
  exception when others then
    assert sqlstate = 'P0001' and sqlerrm like 'A fatura de % já tem pagamento:%', format('fatura parcial: %s %s', sqlstate, sqlerrm);
  end;
  assert n <> -1, 'apagar a compra devia ser recusado';
```

> ⚠️ Confira as colunas de `accounts` para cartão (`closing_day`, `due_day`) e de `card_invoices` (`paid_cents`) na migration vigente antes de rodar; se `set_invoice` jogar a compra noutra fatura, o `update` acima a devolve para a do teste.

- [ ] **Step 2: RED** — prefixe as migrations das Tasks 1–4 → FAIL "apagar a compra devia ser recusado".

- [ ] **Step 3: Migration** — `supabase/migrations/20261008100400_apagar_nao_derruba_fatura.sql`:

```sql
-- O buraco de 20260909090000: apagar uma linha de fatura paga EM PARTE deixava "o que falta"
-- negativo e pay_invoice passava a recusar a quitação. Vale para todo caminho de apagar.
-- `pg_trigger_depth() > 1` = cascade (apagar a conta ou o espaço) ou gatilho (recurring_drop_future,
-- que só leva pendente futura): esses ficam de fora.
create or replace function private.apagar_nao_derruba_fatura()
returns trigger language plpgsql security definer set search_path = '' as $$
declare f public.card_invoices%rowtype;
begin
  if pg_trigger_depth() > 1 or old.invoice_id is null or not private.conta_na_fatura(old.kind) then
    return old;
  end if;
  select * into f from public.card_invoices i where i.id = old.invoice_id;
  if f.id is not null and f.status not in ('paid', 'rolled') and f.paid_cents > 0
     and private.invoice_open_cents(f.id) - old.amount_cents < 0 then
    raise exception using errcode = 'P0001',
      message = 'A fatura de ' || to_char(f.due_date, 'DD/MM') || ' já tem pagamento: sem esta compra o total '
                || 'ficaria abaixo do que foi pago. Desfaça o pagamento da fatura antes.';
  end if;
  return old;
end $$;
revoke execute on function private.apagar_nao_derruba_fatura() from public, anon, authenticated;
drop trigger if exists apagar_nao_derruba_fatura on public.transactions;
create trigger apagar_nao_derruba_fatura before delete on public.transactions
  for each row execute function private.apagar_nao_derruba_fatura();
```

- [ ] **Step 4: GREEN** — as cinco migrations prefixadas + o teste → PASS.

- [ ] **Step 5: Suíte SQL inteira contra a linha de base** (o gatilho novo pega todo delete de `transactions`):

```bash
M=supabase/migrations
for f in supabase/tests/*.sql; do
  cat $M/20261008100000_apagar_com_alcance.sql $M/20261008100100_apagar_parcelas.sql \
      $M/20261008100200_apagar_pagamentos.sql $M/20261008100300_apagar_lembrete.sql \
      $M/20261008100400_apagar_nao_derruba_fatura.sql "$f" > /tmp/suite.sql
  agent/.venv/bin/python scripts/sql-test.py /tmp/suite.sql </dev/null >/dev/null 2>&1 && echo "ok   $f" || echo "FAIL $f"
done
```

Expected: só as falhas pré-existentes (Global Constraints). Qualquer outra é desta tarefa.

- [ ] **Step 6: Push no staging + tipos**

```bash
scripts/supabase-target.sh </dev/null          # tem que dizer utkqoiigimqzeenxkxdl
npx supabase db push --yes </dev/null
npx supabase gen types typescript --project-id utkqoiigimqzeenxkxdl > src/lib/database.types.ts
agent/.venv/bin/python scripts/sql-test.py supabase/tests/apagar_com_alcance.sql </dev/null   # agora sem prefixo
npx tsc --noEmit; echo tsc=$?
```

- [ ] **Step 7: Commit** — `git add supabase/migrations/20261008100400_apagar_nao_derruba_fatura.sql supabase/tests/apagar_com_alcance.sql src/lib/database.types.ts docs/HISTORICO-DE-MIGRATIONS.md && git commit -m "feat(db): apagar nao derruba fatura paga em parte"`

---

### Task 6: App — a pergunta e as regras puras

**Files:**
- Modify: `src/lib/edit-scope-model.ts`, `src/lib/edit-scope.ts`, `src/lib/edit-scope.test.ts`
- Create: `src/lib/apagar-com-alcance.ts`, `src/lib/apagar-com-alcance.test.ts`

**Interfaces:**
- Produces:
  - `deleteScopeChoices(kind: EditScopeKind, opcoes?: { contrato?: boolean; alcances?: EditScope[] }): readonly { scope: EditScope; label: string }[]`
  - `askDeleteScope(kind, onSelect: (s: EditScope) => void, opcoes?: { contrato?: boolean; alcances?: EditScope[] })`
  - `type TipoDoApagar = 'occurrence' | 'installment' | 'debt_payment' | 'recurring' | 'plan' | 'debt' | 'reminder'`
  - `type AlvoDoApagar = { tipo: TipoDoApagar; id: string; nome: string; ancora?: string }`
  - `type PreviaDoApagar = { apagadas: number; pagas: number; somaPagasCents: number; contas: string[]; desde: string | null; apagaContrato: boolean }`
  - `lerPrevia(json: unknown): PreviaDoApagar` (lança se o formato não bate)
  - `fraseDoEstrago(p: PreviaDoApagar, brl: (cents: number) => string): string | null`
  - `textoDoApagado(p: PreviaDoApagar): string`
  - `alvoDoLancamento(tx: { id: string; recurring_id?: string | null; installment_plan_id?: string | null; debt_id?: string | null }, nome: string): AlvoDoApagar | null` (avulso → `null`)
  - `kindDoApagar(tipo: TipoDoApagar): EditScopeKind`, `ehContrato(tipo: TipoDoApagar): boolean`

- [ ] **Step 1: Testes (RED)** — acrescente em `src/lib/edit-scope.test.ts`:

```ts
import { deleteScopeChoices } from './edit-scope-model.ts';

test('apagar: mesmas três escolhas do editar; contrato fica com duas; lembrete só com esta/todas', () => {
  assert.deepEqual(deleteScopeChoices('occurrence').map((c) => c.scope), ['one', 'future', 'all']);
  assert.deepEqual(deleteScopeChoices('installment', { contrato: true }).map((c) => c.scope), ['future', 'all']);
  assert.deepEqual(deleteScopeChoices('reminder', { alcances: ['one', 'all'] }).map((c) => c.scope), ['one', 'all']);
});
```

E crie `src/lib/apagar-com-alcance.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { alvoDoLancamento, fraseDoEstrago, lerPrevia, textoDoApagado } from './apagar-com-alcance.ts';

const brl = (c: number) => `R$ ${(c / 100).toFixed(2).replace('.', ',')}`;

test('a prévia lê o dinheiro como TEXTO e recusa formato estranho', () => {
  const p = lerPrevia({ apagadas: 8, pagas_apagadas: 8, soma_pagas_cents: '959000', contas: ['Nubank'], desde: '2026-05-10', apaga_contrato: false });
  assert.equal(p.somaPagasCents, 959000);
  assert.throws(() => lerPrevia({ apagadas: 1, pagas_apagadas: 0, soma_pagas_cents: '12.5', contas: [], desde: null, apaga_contrato: false }));
  assert.throws(() => lerPrevia(null));
});

test('sem paga não há segunda confirmação; com paga a frase diz quanto, de onde e desde quando', () => {
  assert.equal(fraseDoEstrago(lerPrevia({ apagadas: 3, pagas_apagadas: 0, soma_pagas_cents: '0', contas: [], desde: null, apaga_contrato: false }), brl), null);
  const frase = fraseDoEstrago(lerPrevia({ apagadas: 8, pagas_apagadas: 8, soma_pagas_cents: '959000', contas: ['Nubank'], desde: '2026-05-10', apaga_contrato: false }), brl);
  assert.equal(frase, 'Isso apaga 8 lançamentos já pagos (R$ 9590,00) e muda o saldo da Nubank e o histórico desde maio de 2026.');
  const duas = fraseDoEstrago(lerPrevia({ apagadas: 2, pagas_apagadas: 1, soma_pagas_cents: '1000', contas: ['BB', 'Itaú'], desde: '2026-09-01', apaga_contrato: false }), brl);
  assert.equal(duas, 'Isso apaga 1 lançamento já pago (R$ 10,00) e muda o saldo das contas BB e Itaú e o histórico desde setembro de 2026.');
});

test('o toast conta o que saiu', () => {
  const p = (n: number, contrato = false) => lerPrevia({ apagadas: n, pagas_apagadas: 0, soma_pagas_cents: '0', contas: [], desde: null, apaga_contrato: contrato });
  assert.equal(textoDoApagado(p(1)), '1 lançamento apagado.');
  assert.equal(textoDoApagado(p(5)), '5 lançamentos apagados.');
  assert.equal(textoDoApagado(p(0, true)), 'Apagado por completo.');
});

test('o alvo sai do vínculo do lançamento; avulso não pergunta', () => {
  assert.deepEqual(alvoDoLancamento({ id: 't', recurring_id: 's' }, 'Academia'), { tipo: 'occurrence', id: 't', nome: 'Academia' });
  assert.deepEqual(alvoDoLancamento({ id: 't', installment_plan_id: 'p' }, 'Fone'), { tipo: 'installment', id: 't', nome: 'Fone' });
  assert.deepEqual(alvoDoLancamento({ id: 't', debt_id: 'd' }, 'Moto'), { tipo: 'debt_payment', id: 't', nome: 'Moto' });
  assert.equal(alvoDoLancamento({ id: 't' }, 'Mercado'), null);
});
```

- [ ] **Step 2: RED** — `npm test; echo exit=$?` → exit≠0 (módulos/exports ausentes).

- [ ] **Step 3: Implementar**

Em `src/lib/edit-scope-model.ts`, no fim:

```ts
/** Apagar pergunta o MESMO alcance do editar; `alcances` corta o que o tipo não oferece (lembrete). */
export function deleteScopeChoices(
  kind: EditScopeKind, opcoes: { contrato?: boolean; alcances?: EditScope[] } = {},
): readonly { scope: EditScope; label: string }[] {
  const todas = editScopeChoices(kind, { contrato: opcoes.contrato });
  return opcoes.alcances ? todas.filter((c) => opcoes.alcances!.includes(c.scope)) : todas;
}
```

Em `src/lib/edit-scope.ts`:

```ts
import { deleteScopeChoices, editScopeChoices, type EditScope, type EditScopeKind } from './edit-scope-model';

/** A pergunta do Apagar: os rótulos do editar, título "Apagar"; cancelar não chama nada. */
export function askDeleteScope(
  kind: EditScopeKind,
  onSelect: (scope: EditScope) => void,
  opcoes?: { contrato?: boolean; alcances?: EditScope[] },
) {
  showItemActions(
    'Apagar',
    deleteScopeChoices(kind, opcoes).map(({ scope, label }) => ({ label, destructive: true, onPress: () => onSelect(scope) })),
  );
}
```

`src/lib/apagar-com-alcance.ts`:

```ts
import type { EditScopeKind } from './edit-scope-model';

export type TipoDoApagar = 'occurrence' | 'installment' | 'debt_payment' | 'recurring' | 'plan' | 'debt' | 'reminder';
export type AlvoDoApagar = { tipo: TipoDoApagar; id: string; nome: string; ancora?: string };
export type PreviaDoApagar = {
  apagadas: number; pagas: number; somaPagasCents: number; contas: string[]; desde: string | null; apagaContrato: boolean;
};

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export const ehContrato = (tipo: TipoDoApagar) => tipo === 'recurring' || tipo === 'plan' || tipo === 'debt';

export function kindDoApagar(tipo: TipoDoApagar): EditScopeKind {
  if (tipo === 'installment' || tipo === 'plan') return 'installment';
  if (tipo === 'debt_payment' || tipo === 'debt') return 'payment';
  if (tipo === 'reminder') return 'reminder';
  return 'occurrence';
}

/** O dinheiro chega como texto decimal (padrão das escritas compostas) e é conferido antes de virar número. */
export function lerPrevia(json: unknown): PreviaDoApagar {
  const j = json as Record<string, unknown> | null;
  const inteiro = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0;
  if (!j || !inteiro(j.apagadas) || !inteiro(j.pagas_apagadas) || typeof j.soma_pagas_cents !== 'string'
      || !/^\d+$/.test(j.soma_pagas_cents) || !Array.isArray(j.contas)) {
    throw new Error('Resposta do apagar em formato inesperado');
  }
  return {
    apagadas: j.apagadas as number, pagas: j.pagas_apagadas as number, somaPagasCents: Number(j.soma_pagas_cents),
    contas: (j.contas as unknown[]).map(String), desde: typeof j.desde === 'string' ? j.desde : null,
    apagaContrato: j.apaga_contrato === true,
  };
}

const lista = (nomes: string[]) => (nomes.length > 1 ? `${nomes.slice(0, -1).join(', ')} e ${nomes.at(-1)}` : nomes[0] ?? '');

/** A segunda confirmação só existe quando o alcance leva coisa PAGA; sem isso, a pergunta já confirmou. */
export function fraseDoEstrago(p: PreviaDoApagar, brl: (cents: number) => string): string | null {
  if (p.pagas === 0) return null;
  const n = p.pagas === 1 ? '1 lançamento já pago' : `${p.pagas} lançamentos já pagos`;
  const contas = p.contas.length === 0 ? '' : p.contas.length === 1 ? ` e muda o saldo da ${p.contas[0]}` : ` e muda o saldo das contas ${lista(p.contas)}`;
  const desde = p.desde ? ` e o histórico desde ${MESES[Number(p.desde.slice(5, 7)) - 1]} de ${p.desde.slice(0, 4)}` : '';
  return `Isso apaga ${n} (${brl(p.somaPagasCents)})${contas}${desde}.`;
}

export function textoDoApagado(p: PreviaDoApagar): string {
  if (p.apagaContrato && p.apagadas === 0) return 'Apagado por completo.';
  return p.apagadas === 1 ? '1 lançamento apagado.' : `${p.apagadas} lançamentos apagados.`;
}

/** Ocorrência, parcela e pagamento perguntam o alcance; o avulso não (`null`). */
export function alvoDoLancamento(
  tx: { id: string; recurring_id?: string | null; installment_plan_id?: string | null; debt_id?: string | null },
  nome: string,
): AlvoDoApagar | null {
  if (tx.recurring_id) return { tipo: 'occurrence', id: tx.id, nome };
  if (tx.installment_plan_id) return { tipo: 'installment', id: tx.id, nome };
  if (tx.debt_id) return { tipo: 'debt_payment', id: tx.id, nome };
  return null;
}
```

> Se `src/lib/dates.ts` já tiver os nomes completos dos meses exportados, use-os no lugar de `MESES` (procure `MESES` / `nomeDoMes`).

- [ ] **Step 4: GREEN** — `npm test; echo exit=$?` → `exit=0`; `npx tsc --noEmit && npx expo lint`.
- [ ] **Step 5: Commit** — `git add src/lib/edit-scope-model.ts src/lib/edit-scope.ts src/lib/edit-scope.test.ts src/lib/apagar-com-alcance.ts src/lib/apagar-com-alcance.test.ts && git commit -m "feat(app): pergunta de alcance ao apagar"`

---

### Task 7: App — o hook `useApagarComAlcance`

**Files:**
- Create: `src/hooks/use-apagar-com-alcance.ts`
- Modify: `src/lib/simple-finance-ui.test.ts` (o dublê do módulo novo, junto dos outros `if (name === '@/hooks/...')`, ~l.627)

**Interfaces:**
- Consumes: `askDeleteScope`, `lerPrevia`, `fraseDoEstrago`, `textoDoApagado`, `kindDoApagar`, `ehContrato` (Task 6); `public.delete_scoped` / `delete_scoped_preview` (Task 1, tipos regenerados na Task 5); `newClientMessageId` (`@/lib/agent-chat`); `invalidateFinance`, `invalidateKeys` (`@/lib/query-invalidation`); `confirmDestructive` (`@/lib/item-actions`); `useToast`; `financeErrorMessage` (`@/lib/finance-form`); `formatBRL` (`@/hooks/use-items`).
- Produces: `useApagarComAlcance(aoApagar?: (p: PreviaDoApagar) => void): { apagar: (alvo: AlvoDoApagar, opcoes?: { alcances?: EditScope[] }) => void; apagarNoAlcance: (alvo: AlvoDoApagar, alcance: EditScope) => void; pendente: boolean }` — `apagar` pergunta e depois chama `apagarNoAlcance` (prévia → confirmação → escrita); quem já perguntou (a prevista) chama `apagarNoAlcance` direto. No dublê do teste de tela: `apagar` empurra `{ operation: 'apagarComAlcance', value: alvo }` e `apagarNoAlcance` empurra `{ operation: 'apagarComAlcance', value: { ...alvo, alcance } }` em `writes`.

- [ ] **Step 1: Escrever o hook**

```ts
import { useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useToast } from '@/components/ui/toast';
import { formatBRL } from '@/hooks/use-items';
import { newClientMessageId } from '@/lib/agent-chat';
import { ehContrato, fraseDoEstrago, kindDoApagar, lerPrevia, textoDoApagado, type AlvoDoApagar, type PreviaDoApagar } from '@/lib/apagar-com-alcance';
import { askDeleteScope } from '@/lib/edit-scope';
import type { EditScope } from '@/lib/edit-scope-model';
import { financeErrorMessage } from '@/lib/finance-form';
import { confirmDestructive } from '@/lib/item-actions';
import { invalidateFinance, invalidateKeys } from '@/lib/query-invalidation';
import { supabase } from '@/lib/supabase';

/**
 * Apagar algo de uma série: a pergunta de alcance → a prévia do banco → a confirmação do estrago
 * (só quando leva coisa paga) → a escrita, numa RPC atômica. A tela declara o alvo e mais nada.
 */
export function useApagarComAlcance(aoApagar?: (p: PreviaDoApagar) => void) {
  const qc = useQueryClient();
  const toast = useToast();
  const tentativa = useRef<{ key: string; id: string } | null>(null);
  const escrita = useMutation({
    mutationFn: async ({ alvo, alcance }: { alvo: AlvoDoApagar; alcance: EditScope }) => {
      const key = JSON.stringify([alvo.tipo, alvo.id, alcance, alvo.ancora ?? null]);
      if (tentativa.current?.key !== key) tentativa.current = { key, id: newClientMessageId() };
      const requestId = tentativa.current.id;
      const { data, error } = await supabase.rpc('delete_scoped', {
        p_tipo: alvo.tipo, p_id: alvo.id, p_alcance: alcance, p_request_id: requestId, p_anchor: alvo.ancora ?? null,
      });
      if (error) throw error;
      if (tentativa.current?.id === requestId) tentativa.current = null;
      return lerPrevia(data);
    },
    onSuccess: () => {
      invalidateFinance(qc);
      invalidateKeys(qc, [['reminders'], ['search', 'reminders']]);
    },
  });

  const apagarNoAlcance = async (alvo: AlvoDoApagar, alcance: EditScope) => {
      const erro = (e: unknown) => toast({ message: financeErrorMessage(e, 'Não deu para apagar. Tenta de novo.'), tone: 'error' });
      let previa: PreviaDoApagar;
      try {
        const { data, error } = await supabase.rpc('delete_scoped_preview', {
          p_tipo: alvo.tipo, p_id: alvo.id, p_alcance: alcance, p_anchor: alvo.ancora ?? null,
        });
        if (error) throw error;
        previa = lerPrevia(data);
      } catch (e) {
        erro(e);
        return;
      }
      const executar = () => escrita.mutate({ alvo, alcance }, {
        onSuccess: (r) => {
          toast({ message: textoDoApagado(r), tone: 'success' });
          aoApagar?.(r);
        },
        onError: erro,
      });
      const frase = fraseDoEstrago(previa, formatBRL);
      if (frase) confirmDestructive(`Apagar ${alvo.nome}?`, 'Apagar', executar, frase);
      else executar();
  };

  const apagar = (alvo: AlvoDoApagar, opcoes?: { alcances?: EditScope[] }) =>
    askDeleteScope(kindDoApagar(alvo.tipo), (alcance) => { void apagarNoAlcance(alvo, alcance); },
      { contrato: ehContrato(alvo.tipo), alcances: opcoes?.alcances ?? (alvo.tipo === 'reminder' ? ['one', 'all'] : undefined) });

  return { apagar, apagarNoAlcance, pendente: escrita.isPending };
}
```

> ⚠️ Confira os nomes reais antes de compilar: `useToast` (a forma `toast({ message, tone })` é a usada em `[txId].tsx`), `financeErrorMessage` (`@/lib/finance-form`), `invalidateFinance`/`invalidateKeys` (`@/lib/query-invalidation`, assinatura `(qc)` / `(qc, keys)`). Se `p_anchor` sair como opcional nos tipos regenerados, passe `undefined` em vez de `null` quando não houver âncora.

- [ ] **Step 2: Dublê no harness** — em `src/lib/simple-finance-ui.test.ts`, junto dos outros módulos dublados:

```ts
      if (name === '@/hooks/use-apagar-com-alcance') return { useApagarComAlcance: () => ({
        apagar: (alvo: any) => writes.push({ operation: 'apagarComAlcance', value: alvo }),
        apagarNoAlcance: (alvo: any, alcance: string) => writes.push({ operation: 'apagarComAlcance', value: { ...alvo, alcance } }),
        pendente: false }) };
```

- [ ] **Step 3: Portão** — `npx tsc --noEmit && npx expo lint && npm test; echo exit=$?` → `exit=0`.
- [ ] **Step 4: Commit** — `git add src/hooks/use-apagar-com-alcance.ts src/lib/simple-finance-ui.test.ts && git commit -m "feat(app): hook de apagar com alcance"`

---

### Task 8: App — o lançamento (detalhe, formulário e listas)

**Files:**
- Modify: `src/app/finance/[txId].tsx` (o menu do `HeaderActions`: `confirmDelete`, `confirmDeletePlan` e as duas ações "Apagar só esta parcela"/"Apagar a compra inteira", ~l.191–245 e ~l.556–575)
- Modify: `src/components/finance/formulario-do-lancamento.tsx` (`onDelete`, ~l.1069)
- Modify: `src/app/finance/transactions.tsx` (~l.857), `src/app/(tabs)/finance/index.tsx` (~l.266), `src/app/finance/invoice/[id].tsx` (`apagar`, ~l.374) — menu e arrasto "Apagar"
- Modify: `src/lib/simple-finance-ui.test.ts`

**Interfaces:**
- Consumes: `useApagarComAlcance`, `alvoDoLancamento` (Tasks 6–7).
- Regra: em cada ponto, `const alvo = alvoDoLancamento(tx, nome)`; com alvo → `apagar(alvo)`; sem alvo (avulso) → o `confirmDestructive` + `useDeleteTransaction` de hoje, sem mudança. No detalhe, depois de apagar, `router.back()` (passe `aoApagar` ao hook).

- [ ] **Step 1: Testes (RED)** — em `simple-finance-ui.test.ts`:

```ts
test('Apagar: ocorrência, parcela e pagamento perguntam o alcance; avulso confirma como antes', () => {
  const base = { kind: 'expense', status: 'pending', amount_cents: 500, description: 'Conta', category: 'x', account_id: 'a',
    counterparty_account_id: null, occurred_at: '2026-10-02', created_at: '2026-10-02T12:00:00Z', invoice_id: null,
    installment_plan_id: null, recurring_id: null, debt_id: null, pays_invoice_id: null, pix_fee_for_transaction_id: null };
  const apagarDe = (extra: object) => {
    const ui = screen('src/app/finance/[txId].tsx', { txs: [{ id: 't', ...base, ...extra }], params: { txId: 't' } });
    const acoes = ui.nodes().find((n: any) => n.type === 'HeaderActions').props.menu.actions;
    assert.equal(acoes.filter((a: any) => a.label.startsWith('Apagar')).length, 1, 'um "Apagar" só no menu');
    ui.interact(() => acoes.find((a: any) => a.label === 'Apagar').onPress());
    return ui;
  };
  for (const [extra, tipo] of [[{ recurring_id: 's' }, 'occurrence'], [{ installment_plan_id: 'p', installment_no: 2 }, 'installment'], [{ debt_id: 'd' }, 'debt_payment']] as const) {
    const ui = apagarDe(extra);
    assert.deepEqual(ui.writes.find((w: any) => w.operation === 'apagarComAlcance')?.value, { tipo, id: 't', nome: 'Conta' }, tipo);
  }
  const avulso = apagarDe({});
  assert.ok(!avulso.writes.some((w: any) => w.operation === 'apagarComAlcance'), 'avulso não pergunta alcance');
  assert.equal(avulso.confirmations.length, 1, 'avulso confirma');
});
```

> ⚠️ Confira o nome do campo que expõe as confirmações no harness (`confirmations`/`avisos`, ~l.124 e ~l.758) e o `nome` que o detalhe usa (`title` em `[txId].tsx`); ajuste o `nome: 'Conta'` da asserção para o que a tela realmente passa.

- [ ] **Step 2: RED** — `npm test; echo exit=$?` → falha (o menu ainda tem dois "Apagar…").
- [ ] **Step 3: Implementar** — em `[txId].tsx`: `const { apagar } = useApagarComAlcance(() => router.back());`; uma ação só:

```tsx
{
  label: 'Apagar',
  icon: 'trash',
  destructive: true,
  onPress: () => {
    const alvo = tx ? alvoDoLancamento(tx, title) : null;
    if (alvo) apagar(alvo);
    else confirmDelete();
  },
},
```
Remova `confirmDeletePlan`, `useDeleteInstallmentPlan` e `removePlan` desta tela (a compra inteira é o "Todas" da pergunta). Faça o mesmo padrão (`alvoDoLancamento` → `apagar` | caminho de hoje) em `formulario-do-lancamento.tsx`, `transactions.tsx`, `(tabs)/finance/index.tsx` e `invoice/[id].tsx` — no menu e no arrasto "Apagar".
- [ ] **Step 4: GREEN** — portão completo → `exit=0`.
- [ ] **Step 5: Commit** — `git add src/app/finance/[txId].tsx src/components/finance/formulario-do-lancamento.tsx src/app/finance/transactions.tsx "src/app/(tabs)/finance/index.tsx" "src/app/finance/invoice/[id].tsx" src/lib/simple-finance-ui.test.ts && git commit -m "feat(app): apagar lancamento de serie pergunta o alcance"`

---

### Task 9: App — os contratos (Recorrentes, Parceladas, Dívidas) e a prevista

**Files:**
- Modify: `src/app/finance/recurring.tsx` (`apagar`, ~l.219)
- Modify: `src/app/finance/installments.tsx` (`removePlan`, ~l.318)
- Modify: `src/app/finance/debts.tsx` (`excluir`, ~l.349/378/384)
- Modify: `src/components/finance/expected-ledger-lines.tsx` (~l.93)
- Modify: `src/lib/simple-finance-ui.test.ts`

**Interfaces:**
- Consumes: `useApagarComAlcance`.
- Regra: Recorrentes → `apagar({ tipo: 'recurring', id: r.id, nome })`; Parceladas → `apagar({ tipo: 'plan', id: plano.id, nome })`; Dívidas → `apagar({ tipo: 'debt', id: d.id, nome })`. A prevista (só existe na regra, não tem `id` de lançamento): `askDeleteScope('occurrence', (alcance) => …)` direto; `one` → `skip_recurring_occurrence` (o `useSkipOccurrence` de hoje); `future`/`all` → `apagarNoAlcance({ tipo: 'recurring', id: recurringId, nome, ancora: data }, alcance)`.

- [ ] **Step 1: Testes (RED)** — cinco testes em `simple-finance-ui.test.ts`, cada um reaproveitando a fixture e a abertura de menu do teste VIZINHO da mesma tela (`grep -n "recurring.tsx\|installments.tsx\|debtsFile\|expected-ledger" src/lib/simple-finance-ui.test.ts`); o harness expõe as ações do menu em `ui.actions` e o toque longo da linha pelo `onLongPress` do `Pressable` (o padrão do teste "Dívida: o menu oferece 'Lembrar'"):
  1. Recorrentes: tocar "Apagar" na série → `writes` contém `{ operation: 'apagarComAlcance', value: { tipo: 'recurring', id: <id da série>, nome: <descrição> } }`.
  2. Parceladas: "Apagar" na compra → `value.tipo === 'plan'` e `value.id === <id do plano>`.
  3. Dívidas: "Excluir"/"Apagar" na dívida → `value.tipo === 'debt'` e `value.id === carro.id`.
  4. Prevista, "Só esta" → `writes` contém a operação de `useSkipOccurrence` (o nome que o dublê de `use-finance` dá a ela) e NÃO contém `apagarComAlcance`.
  5. Prevista, "Todas" → `apagarComAlcance` com `{ tipo: 'recurring', id: <recurringId>, ancora: <data da prevista>, alcance: 'all' }`.

- [ ] **Step 2: RED** → **Step 3: Implementar** (troque os `confirmDestructive` + mutação de cada tela por `apagar(alvo)`; tire `useDeleteRecurring`/`useDeleteInstallmentPlan`/`useDeleteDebt` das telas que deixarem de usá-los) → **Step 4: GREEN** (portão completo, `exit=0`).
- [ ] **Step 5: Commit** — `git add src/app/finance/recurring.tsx src/app/finance/installments.tsx src/app/finance/debts.tsx src/components/finance/expected-ledger-lines.tsx src/lib/simple-finance-ui.test.ts && git commit -m "feat(app): apagar pelo contrato pergunta o alcance"`

---

### Task 10: App — o lembrete aberto por uma ocorrência

**Files:**
- Modify: `src/app/reminder-form.tsx` (`onDelete`, ~l.485)
- Modify: `src/lib/simple-finance-ui.test.ts`

**Interfaces:**
- Consumes: `useApagarComAlcance`.
- Regra: aberto como ocorrência (`editing.parent_reminder_id` ou `umaOcorrenciaAberta`, a mesma condição de `umaOcorrencia` ~l.459) e o lembrete repete → `apagar({ tipo: 'reminder', id: editing.id, nome: editing.title })` (o hook já limita a "Só esta | Todas"). Aberto pela lista (contrato) ou lembrete único → o `confirmDestructive` de hoje, sem mudança. `aoApagar` = `router.back()`.

- [ ] **Step 1: Teste (RED)** — um teste que abre `reminder-form` com `params: { id, ocorrencia: '1' }` e um lembrete com `recurrence`, toca "Apagar" e asserta `writes` com `{ tipo: 'reminder', id }`; e outro pela lista (`ocorrencia` ausente) que asserta a confirmação de hoje (sem `apagarComAlcance`). Use a fixture `reminders` do harness como os testes vizinhos do formulário.
- [ ] **Step 2: RED** → **Step 3: Implementar** → **Step 4: GREEN** (portão completo).
- [ ] **Step 5: Commit** — `git add src/app/reminder-form.tsx src/lib/simple-finance-ui.test.ts && git commit -m "feat(app): apagar lembrete pela ocorrencia pergunta o alcance"`

---

### Task 11: Paridade, verificação ponta a ponta e limpeza

**Files:**
- Modify: `docs/AGENTE-PARIDADE-COM-O-APP.md`

- [ ] **Step 1: Linha de paridade**

```markdown
**Apagar com alcance** (`delete_scoped`, 07/10/2026). No app, apagar uma ocorrência, parcela, pagamento
de financiamento ou vez de lembrete pergunta "Só esta / Esta e as próximas / Todas" (pelo contrato:
"Das próximas em diante / Todas"), numa RPC atômica com prévia do estrago. O agente segue como antes
(apaga a série inteira, a compra ou a dívida): "apaga o aluguel daqui pra frente" é lacuna declarada.
```
Commit: `git add docs/AGENTE-PARIDADE-COM-O-APP.md && git commit -m "docs: paridade do apagar com alcance"`

- [ ] **Step 2: Portão** — `npx tsc --noEmit && npx expo lint && npm test; echo "app exit=$?"` → `exit=0`.

- [ ] **Step 3: Tela (staging, `dev@`)** — no simulador (`com.proops.personal.dev`, login "Entrar como teste (dev)"): crie por REST com o JWT do `dev@` uma série de teste com três ocorrências (uma paga) e uma compra de 3x numa conta corrente; **anote os ids**. Pelo app: na ocorrência do meio, "Apagar" → "Esta e as próximas" (some ela e a seguinte; a paga fica); na compra, "Apagar" → "Todas" (aparece a segunda confirmação com a paga, R$ e conta) → confirma. Confira que "Lançamentos" e "O que vence" atualizaram. Limpe pelos ids anotados (nunca por filtro de texto).

- [ ] **Step 4: Telas não tocadas** — Hoje, Financeiro, Lembretes e uma fatura abrem como antes.

## Fora deste plano

- **Produção**: migrations `20261008100000`–`20261008100400` → release do app (MINOR). Só com pedido explícito do Gabriel; registrar em `docs/HISTORICO-DE-MIGRATIONS.md`.
- Agente com alcance no apagar; desfazer de alcance grande; renumerar parcelas depois de "Só esta" no meio.
