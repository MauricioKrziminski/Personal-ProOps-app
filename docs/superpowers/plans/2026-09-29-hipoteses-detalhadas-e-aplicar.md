# Hipóteses detalhadas e "Aplicar" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O "E se…?" da Projeção aceita hipóteses criadas no formulário real (lançamento, compra
parcelada, recorrente, financiamento), simula com as regras reais sem salvar, e "Aplicar" salva
na conta exatamente o que foi simulado.

**Architecture:** Uma RPC `public.simular` cria os registros de verdade numa subtransação, roda as
leituras pedidas (Projeção, meses, ciclo) e desfaz tudo, devolvendo os números. O app guarda cada
hipótese detalhada como a ENTRADA do hook que a salvaria; funções puras em `src/lib/escrita.ts`
transformam essa entrada no que vai ao banco — usadas pelo salvar real e pela simulação, então o
simulado é o aplicado. O rascunho passa a morar no aparelho (`usePreferencia`), compartilhado pela
Projeção e pelos formulários.

**Tech Stack:** Supabase Postgres (plpgsql, RLS), Expo SDK 57 + expo-router + TanStack Query,
react-hook-form + zod, `node --test` (app), psql local (SQL).

**Spec:** `docs/superpowers/specs/2026-09-28-hipoteses-detalhadas-e-aplicar-design.md`

## Global Constraints

- Dinheiro sempre `amount_cents` inteiro; nunca float (`finance.md`).
- Função nova em `public` leva `revoke execute ... from public, anon` e `grant ... to authenticated` (`CLAUDE.md`, `supabase/tests/anon_sem_execute.sql`).
- Fuso e `security` vão no CABEÇALHO da função, nunca por `alter` depois (`finance.md`).
- Migration nasce no STAGING (`npx supabase db push` após `./scripts/supabase-target.sh`); produção só pelo Gabriel com `--project-ref`.
- Commits conventional, 1 linha, sem corpo, SEM co-autor.
- Gate antes de cada commit: `npx tsc --noEmit`, `npx expo lint`, `npm test` (código de saída 0).
- Arrasto: esquerda só tira da lista, direita nunca apaga, verbo "Apagar"/"Tirar" nunca "Excluir" (`design.md` §6, `anti-slop.test.ts`).
- Toda rolagem com `keyboardShouldPersistTaps="handled"`; tela nova conferida em `accessibility-large` (memória `gap-padrao-e-fonte-grande`).
- Versão: funcionalidade nova → MINOR `1.5.0` (`CLAUDE.md`, *Versão, build, release*). Não criar tag sem o Gabriel pedir.

## Review Focus

1. **Payload velho no aparelho** (conta arquivada/apagada depois que a hipótese foi criada): `simular` devolve o erro daquela hipótese e as outras continuam na série; "Aplicar" mostra o motivo e não salva meia coisa. Teste na Task 1 (SQL) e Task 7 (tela).
2. **Aplicar duas vezes** (toque duplo, rede lenta): a hipótese sai do rascunho só no sucesso e o botão fica desligado enquanto salva — um só registro no banco. Teste na Task 7.
3. **Rascunho gravado com formato antigo/corrompido** no AsyncStorage: `lerRascunho` devolve vazio sem quebrar a Projeção. Teste na Task 3.
4. **Formulário em modo hipótese NÃO escreve** nem por caminho lateral (juros do Pix, parcela, recorrente). Teste na Task 5.
5. **Simulação não deixa resto no banco** (nada novo em `transactions`, `installment_plans`, `recurring_transactions`, `debts`, `card_invoices` depois de `simular`). Teste na Task 1.

---

## File Structure

| arquivo | responsabilidade |
|---|---|
| `supabase/migrations/20260929120000_simular_hipoteses.sql` (novo) | `private.inserir_da_hipotese`, `private.criar_registro_da_hipotese`, `public.simular` |
| `supabase/tests/simular.sql` (novo) | igualdade com a criação real, banco intacto, erro isolado |
| `src/lib/escrita.ts` (novo) | entrada do hook → o que vai ao banco, para os 4 tipos (puro) |
| `src/lib/escrita.test.ts` (novo) | testes das funções puras |
| `src/lib/rascunho.ts` (novo) | tipos do rascunho, ler/gravar (versão), resumo da linha, registros para `simular` (puro) |
| `src/lib/rascunho.test.ts` (novo) | testes |
| `src/hooks/use-rascunho.ts` (novo) | o rascunho no aparelho, compartilhado entre telas |
| `src/hooks/use-finance.ts` (mod.) | hooks passam a usar `escrita.ts`; `useCreateRecurring` sai de `recurring.tsx` para cá; `useSimulacao` novo |
| `src/lib/query-invalidation.ts` (mod.) | chave `simular` em `FINANCE_KEYS` |
| `src/app/finance/forecast.tsx` (mod.) | rascunho do aparelho, "Adicionar como…", linhas, Aplicar/Tirar, Aplicar todas, leitura por `simular` |
| `src/app/finance/transaction-form.tsx` (mod.) | modo `?hipotese=` (criar/editar hipótese) e pré-preenchimento `?deHipotese=` |
| `src/app/finance/recurring.tsx` (mod.) | modo hipótese e `deHipotese` |
| `src/app/finance/debts.tsx` (mod.) | modo hipótese |
| `src/app/finance/cycle.tsx` (mod.) | ciclo por `simular` quando há hipótese detalhada |
| `src/lib/simple-finance-ui.test.ts` (mod.) | testes de tela |
| `.claude/rules/finance.md`, `docs/AGENTE-PARIDADE-COM-O-APP.md`, `docs/HISTORICO-DE-MIGRATIONS.md` (mod.) | regra nova e registro |

---

### Task 1: `public.simular` — criar de verdade, ler, desfazer

**Files:**
- Create: `supabase/migrations/20260929120000_simular_hipoteses.sql`
- Create: `supabase/tests/simular.sql`

**Interfaces:**
- Produces: `public.simular(p_registros jsonb, p_leituras jsonb) returns jsonb`.
  - `p_registros`: `[{ "tipo": "lancamento", "dados": { "linhas": [<linha de transactions>, …] } }`,
    `{ "tipo": "parcelada", "dados": { "p_account_id", "p_total_cents", "p_installments", "p_occurred_at", "p_paid_installments", "p_description", "p_category", "p_merchant", "ultimo_dia": bool } }`,
    `{ "tipo": "recorrente", "dados": <linha de recurring_transactions> }`,
    `{ "tipo": "financiamento", "dados": <linha de debts> }]`.
  - `p_leituras`: qualquer subconjunto de `{ "forecast": {"days", "drafts"}, "meses": {"days", "drafts", "view"}, "ciclo": {"de", "ate", "view"}, "linhas_do_ciclo": {"mes", "view"} }`.
  - Retorno: `{ "leituras": { "forecast": <forecast_json>, "meses": <month_forecast_json>, "ciclo": [<cycle_series rows>], "linhas_do_ciclo": [<cycle_lines rows>] }, "criados": [{ "indice", "ids": [uuid…] }], "erros": [{ "indice", "mensagem" }] }`.
  - `ids` de um registro: as transações criadas, as faturas delas, o plano, a série ou a dívida — o que puder aparecer como `ref_id` numa linha do ciclo.

- [ ] **Step 1: Write the failing SQL test** — `supabase/tests/simular.sql`

```sql
-- `public.simular` (20260929120000): cria de verdade, lê, desfaz.
--
--   docker exec -i supabase_db_app-proops psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/simular.sql

\set ON_ERROR_STOP on
begin;

do $$
declare
  usr uuid := '00000000-0000-0000-0000-00000000f1a1';
  ws uuid;
begin
  insert into auth.users (id, email) values (usr, 'teste-simular@example.invalid') on conflict (id) do nothing;
  insert into public.profiles (id) values (usr) on conflict (id) do nothing;
  insert into public.workspaces (name, owner_id) values ('teste simular', usr) returning id into ws;
  insert into public.workspace_members (workspace_id, user_id, role) values (ws, usr, 'owner');
  insert into public.accounts (workspace_id, user_id, name, type, initial_balance_cents)
    values (ws, usr, 'Conta', 'checking', 1000000);
  insert into public.accounts (workspace_id, user_id, name, type, closing_day, due_day, payment_account_id)
    values (ws, usr, 'Cartao', 'credit_card', 3, 10,
            (select id from public.accounts where workspace_id = ws and type = 'checking'));
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000f1a1', true);
set local role authenticated;

do $$
declare
  conta uuid := (select id from public.accounts where name = 'Conta' and user_id = '00000000-0000-0000-0000-00000000f1a1');
  cartao uuid := (select id from public.accounts where name = 'Cartao' and user_id = '00000000-0000-0000-0000-00000000f1a1');
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  registros jsonb;
  r jsonb;
  simulado jsonb;
  real jsonb;
  antes bigint;
  depois bigint;
begin
  registros := jsonb_build_array(
    jsonb_build_object('tipo', 'parcelada', 'dados', jsonb_build_object(
      'p_account_id', cartao, 'p_total_cents', 300000, 'p_installments', 10, 'p_occurred_at', hoje,
      'p_paid_installments', 0, 'p_description', 'Notebook', 'p_category', 'eletrônicos', 'p_merchant', null,
      'ultimo_dia', false)),
    jsonb_build_object('tipo', 'recorrente', 'dados', jsonb_build_object(
      'kind', 'expense', 'amount_cents', 5000, 'description', 'Academia', 'merchant', null, 'category', 'saúde',
      'account_id', conta, 'rrule', 'FREQ=WEEKLY;BYDAY=MO', 'next_run_at', (hoje + 1)::timestamptz,
      'dtstart', (hoje + 1)::timestamptz, 'end_date', null, 'auto_confirm', false)),
    jsonb_build_object('tipo', 'financiamento', 'dados', jsonb_build_object(
      'name', 'Carro', 'kind', 'financing', 'calculation_mode', 'fixed_installments',
      'principal_cents', 4800000, 'remaining_cents', 3600000, 'interest_rate_monthly', 0,
      'installments', 48, 'installments_paid', 12, 'installment_cents', 100000,
      'account_id', conta, 'due_day', 10)),
    -- 3. inválido: conta que não existe
    jsonb_build_object('tipo', 'lancamento', 'dados', jsonb_build_object('linhas', jsonb_build_array(
      jsonb_build_object('kind', 'expense', 'amount_cents', 100, 'description', 'X',
        'account_id', '00000000-0000-0000-0000-000000000000', 'occurred_at', hoje, 'status', 'cleared', 'source', 'app'))))
  );

  select count(*) into antes from public.transactions;
  simulado := public.simular(registros, jsonb_build_object('forecast', jsonb_build_object('days', 400, 'drafts', '[]'::jsonb)));
  select count(*) into depois from public.transactions;

  -- 1. banco intacto
  if depois <> antes then raise exception '1. simular deixou % transações', depois - antes; end if;
  if exists (select 1 from public.installment_plans where description = 'Notebook')
     or exists (select 1 from public.recurring_transactions where description = 'Academia')
     or exists (select 1 from public.debts where name = 'Carro') then
    raise exception '1. simular deixou registro';
  end if;

  -- 2. o inválido volta em erros, e só ele
  if jsonb_array_length(simulado->'erros') <> 1 or (simulado->'erros'->0->>'indice')::int <> 3 then
    raise exception '2. erros deveria ter só o índice 3: %', simulado->'erros';
  end if;
  if jsonb_array_length(simulado->'criados') <> 3 then raise exception '2. criados deveria ter 3'; end if;

  -- 3. a série simulada é a mesma de criar de verdade (criando os 3 válidos numa subtransação)
  begin
    for r in select value from jsonb_array_elements(registros) with ordinality as e(value, n) where n <= 3 loop
      perform private.criar_registro_da_hipotese(r->>'tipo', r->'dados');
    end loop;
    real := public.forecast_json(400, '[]'::jsonb);
    raise exception using errcode = 'PSIM1', message = 'desfaz o real do teste';
  exception when sqlstate 'PSIM1' then null;
  end;
  if simulado->'leituras'->'forecast' is distinct from real then
    raise exception '3. a série simulada difere da real';
  end if;
end $$;

reset role;
do $$
begin
  if has_function_privilege('anon', 'public.simular(jsonb, jsonb)', 'execute') then
    raise exception '4. anon executa simular';
  end if;
end $$;

select 'simular: ok' as resultado;
rollback;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `docker exec -i supabase_db_app-proops psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/simular.sql`
Expected: FAIL with `function public.simular(jsonb, jsonb) does not exist`.

- [ ] **Step 3: Write the migration** — `supabase/migrations/20260929120000_simular_hipoteses.sql`

```sql
-- Hipóteses detalhadas do "E se…?" (spec 2026-09-28-hipoteses-detalhadas-e-aplicar-design.md).
--
-- `simular` CRIA os registros de verdade, pelo mesmo caminho do formulário, roda as leituras
-- pedidas e DESFAZ tudo numa subtransação — as regras de fatura (`set_invoice`), cronograma
-- (`debt_schedule_for`) e recorrência (`recurring_projection_for`) valem sem uma segunda cópia.
-- `security invoker`: RLS vale e o `workspace_id` sai do default da coluna, como na criação manual.

-- Insere UMA linha com só as colunas permitidas que vieram; o resto fica com o default da coluna.
create or replace function private.inserir_da_hipotese(p_tabela text, p_linha jsonb, p_permitidas text[])
returns uuid
language plpgsql
set search_path = public
as $$
declare
  cols text;
  novo uuid;
begin
  if p_tabela not in ('transactions', 'recurring_transactions', 'debts') then
    raise exception 'tabela não permitida: %', p_tabela;
  end if;
  select string_agg(quote_ident(k), ', ') into cols
    from jsonb_object_keys(p_linha) k where k = any(p_permitidas);
  if cols is null then raise exception 'hipótese sem campos'; end if;
  execute format(
    'insert into public.%I (%s, user_id) select %s, auth.uid() from jsonb_populate_record(null::public.%I, $1) returning id',
    p_tabela, cols, cols, p_tabela)
    using p_linha into novo;
  return novo;
end;
$$;
revoke execute on function private.inserir_da_hipotese(text, jsonb, text[]) from public, anon;
grant execute on function private.inserir_da_hipotese(text, jsonb, text[]) to authenticated;

-- Um registro da hipótese → os ids que podem aparecer como `ref_id` nas leituras.
create or replace function private.criar_registro_da_hipotese(p_tipo text, p_dados jsonb)
returns uuid[]
language plpgsql
set search_path = public
set timezone to 'America/Sao_Paulo'
as $$
declare
  linha jsonb;
  ids uuid[] := '{}';
  novo uuid;
  plano uuid;
begin
  if p_tipo = 'lancamento' then
    for linha in select value from jsonb_array_elements(p_dados->'linhas') loop
      novo := private.inserir_da_hipotese('transactions', linha, array[
        'kind', 'amount_cents', 'category', 'description', 'merchant', 'account_id',
        'counterparty_account_id', 'occurred_at', 'status', 'due_at', 'auto_confirm', 'source']);
      ids := ids || novo;
    end loop;
  elsif p_tipo = 'parcelada' then
    if coalesce((p_dados->>'ultimo_dia')::boolean, false) then
      plano := public.create_installment_plan_last_day(
        (p_dados->>'p_account_id')::uuid, (p_dados->>'p_total_cents')::bigint,
        (p_dados->>'p_installments')::int, (p_dados->>'p_occurred_at')::date,
        coalesce((p_dados->>'p_paid_installments')::int, 0), p_dados->>'p_description',
        p_dados->>'p_category', p_dados->>'p_merchant');
    else
      plano := public.create_installment_plan_with_history(
        (p_dados->>'p_account_id')::uuid, (p_dados->>'p_total_cents')::bigint,
        (p_dados->>'p_installments')::int, (p_dados->>'p_occurred_at')::date,
        coalesce((p_dados->>'p_paid_installments')::int, 0), p_dados->>'p_description',
        p_dados->>'p_category', p_dados->>'p_merchant');
    end if;
    ids := ids || plano;
    ids := ids || array(select t.id from public.transactions t where t.installment_plan_id = plano);
  elsif p_tipo = 'recorrente' then
    ids := ids || private.inserir_da_hipotese('recurring_transactions', p_dados, array[
      'kind', 'amount_cents', 'description', 'merchant', 'category', 'account_id', 'rrule',
      'next_run_at', 'dtstart', 'end_date', 'auto_confirm']);
  elsif p_tipo = 'financiamento' then
    ids := ids || private.inserir_da_hipotese('debts', p_dados, array[
      'name', 'kind', 'calculation_mode', 'principal_cents', 'remaining_cents',
      'interest_rate_monthly', 'installments', 'installments_paid', 'installment_cents',
      'account_id', 'due_day', 'first_due_date']);
  else
    raise exception 'tipo de hipótese desconhecido: %', p_tipo;
  end if;
  -- As faturas em que as linhas caíram (a compra aparece no ciclo pela fatura).
  ids := ids || array(select distinct t.invoice_id from public.transactions t
                       where t.id = any(ids) and t.invoice_id is not null);
  return ids;
end;
$$;
revoke execute on function private.criar_registro_da_hipotese(text, jsonb) from public, anon;
grant execute on function private.criar_registro_da_hipotese(text, jsonb) to authenticated;

create or replace function public.simular(p_registros jsonb, p_leituras jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
set timezone to 'America/Sao_Paulo'
as $$
declare
  r jsonb;
  i int := 0;
  leituras jsonb := '{}'::jsonb;
  criados jsonb := '[]'::jsonb;
  erros jsonb := '[]'::jsonb;
  l jsonb;
begin
  begin
    for r in select value from jsonb_array_elements(coalesce(p_registros, '[]'::jsonb)) loop
      -- Cada registro na sua subtransação: o que falha é desfeito sozinho e vira erro.
      begin
        criados := criados || jsonb_build_object('indice', i,
          'ids', to_jsonb(private.criar_registro_da_hipotese(r->>'tipo', r->'dados')));
      exception when others then
        erros := erros || jsonb_build_object('indice', i, 'mensagem', sqlerrm);
      end;
      i := i + 1;
    end loop;

    l := p_leituras->'forecast';
    if l is not null then
      leituras := leituras || jsonb_build_object('forecast',
        public.forecast_json((l->>'days')::int, coalesce(l->'drafts', '[]'::jsonb)));
    end if;
    l := p_leituras->'meses';
    if l is not null then
      leituras := leituras || jsonb_build_object('meses',
        public.month_forecast_json((l->>'days')::int, coalesce(l->'drafts', '[]'::jsonb), l->>'view'));
    end if;
    l := p_leituras->'ciclo';
    if l is not null then
      leituras := leituras || jsonb_build_object('ciclo', coalesce((select jsonb_agg(to_jsonb(c))
        from public.cycle_series((l->>'de')::date, (l->>'ate')::date, l->>'view') c), '[]'::jsonb));
    end if;
    l := p_leituras->'linhas_do_ciclo';
    if l is not null then
      leituras := leituras || jsonb_build_object('linhas_do_ciclo', coalesce((select jsonb_agg(to_jsonb(c))
        from public.cycle_lines((l->>'mes')::date, l->>'view') c), '[]'::jsonb));
    end if;

    -- Desfaz TUDO. As variáveis sobrevivem ao `exception`; as escritas, não.
    raise exception using errcode = 'PSIM1', message = 'simulação desfeita';
  exception when sqlstate 'PSIM1' then
    null;
  end;
  return jsonb_build_object('leituras', leituras, 'criados', criados, 'erros', erros);
end;
$$;
revoke execute on function public.simular(jsonb, jsonb) from public, anon;
grant execute on function public.simular(jsonb, jsonb) to authenticated;
```

- [ ] **Step 4: Apply locally and run the test**

Run:
```bash
docker exec -i supabase_db_app-proops psql -U postgres -d postgres -v ON_ERROR_STOP=1 -1 -f - < supabase/migrations/20260929120000_simular_hipoteses.sql
docker exec -i supabase_db_app-proops psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/simular.sql
```
Expected: `simular: ok`. Rode também todos os `supabase/tests/*.sql` (loop do `workflow.md`): só `financiamento_maleavel` e `parcela_fixa_com_encargo` podem falhar (dependem de dado do banco local).

- [ ] **Step 5: Staging + tipos + commit**

```bash
./scripts/supabase-target.sh && npx supabase db push
```
Acrescente à mão em `src/lib/database.types.ts`, dentro de `Functions`, antes de `edit_budget:` (regenerar inteiro quebra tipos alheios — ver o commit `52ff6b7`):
```ts
      simular: {
        Args: { p_registros: Json; p_leituras: Json }
        Returns: Json
      }
```
Registre em `docs/HISTORICO-DE-MIGRATIONS.md` uma entrada **"Só no STAGING: `20260929120000_simular_hipoteses`"** (mesmo formato das anteriores). Rode o agente `migration-reviewer` sobre a migration e aplique os achados antes do commit.
```bash
git add supabase/migrations/20260929120000_simular_hipoteses.sql supabase/tests/simular.sql src/lib/database.types.ts docs/HISTORICO-DE-MIGRATIONS.md
git commit -m "feat(projecao): simular cria as hipóteses de verdade, lê e desfaz"
```

---

### Task 2: `src/lib/escrita.ts` — a entrada do hook vira o que vai ao banco

**Files:**
- Create: `src/lib/escrita.ts`, `src/lib/escrita.test.ts`
- Modify: `src/hooks/use-finance.ts` (`useSaveTransaction` ~2876, `linhaDeJuros` ~2862, `useCreateInstallmentPlan` ~825, `useSaveDebt` ~2370; novo `useCreateRecurring`)
- Modify: `src/app/finance/recurring.tsx` (remove o `useCreateRecurring` local, linhas 98-129, e importa de `use-finance`)
- Modify: `src/lib/simple-finance-ui.test.ts` (mock de `useCreateRecurring` no objeto `finance`, e carregar `@/lib/escrita` de verdade na lista da linha ~308)

**Interfaces:**
- Produces:
  ```ts
  export type EntradaLancamento = TransactionInput & { fee_cents?: number };
  export type EntradaParcelada = { accountId: string; totalCents: number; installments: number; paidInstallments: number; occurredAt: string; description: string | null; category: string | null; merchant: string | null; lastDay?: boolean };
  export type EntradaRecorrente = { kind: 'expense' | 'income'; amount_cents: number; description: string | null; merchant: string | null; category: string | null; account_id: string | null; rrule: string; next_run_at: string; end_date: string | null; auto_confirm: boolean };
  export type EntradaFinanciamento = Omit<Parameters<ReturnType<typeof useSaveDebt>['mutate']>[0], 'id' | 'versao'>; // declarar o tipo literal em escrita.ts, copiado do input de useSaveDebt
  export const DESCRICAO_JUROS_DO_PIX: string;              // movida de use-finance
  export function linhasDoLancamento(e: EntradaLancamento): Record<string, unknown>[];   // sem user_id; com source 'app'
  export function argsDaParcelada(e: EntradaParcelada): { rpc: 'create_installment_plan_last_day' | 'create_installment_plan_with_history'; args: {...p_*} };
  export function linhaDaRecorrente(e: EntradaRecorrente): Record<string, unknown>;      // com dtstart = next_run_at
  export function linhaDoFinanciamento(e: EntradaFinanciamento): Record<string, unknown>;
  ```
  `TransactionInput` é o tipo já exportado de `use-finance.ts`; importe com `import type` (é apagado em runtime, o `node --test` roda).

- [ ] **Step 1: Write the failing test** — `src/lib/escrita.test.ts`

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { argsDaParcelada, linhaDaRecorrente, linhaDoFinanciamento, linhasDoLancamento } from './escrita.ts';

const base = {
  kind: 'expense' as const, amount_cents: 35699, category: 'outros', description: 'Pix', merchant: null,
  account_id: 'cartao', counterparty_account_id: null, occurred_at: '2026-09-23', status: 'cleared' as const,
  due_at: null, auto_confirm: false,
};

test('lançamento: uma linha, com source app; juros do Pix vira a segunda linha no cartão', () => {
  assert.deepEqual(linhasDoLancamento(base), [{ ...base, source: 'app' }]);
  const [compra, juros] = linhasDoLancamento({ ...base, amount_cents: 34000, fee_cents: 1699 });
  assert.equal(compra.amount_cents, 34000);
  assert.deepEqual(
    { kind: juros.kind, amount_cents: juros.amount_cents, category: juros.category, merchant: juros.merchant, counterparty_account_id: juros.counterparty_account_id },
    { kind: 'expense', amount_cents: 1699, category: 'juros', merchant: null, counterparty_account_id: null },
  );
  // receita nunca ganha linha de juros
  assert.equal(linhasDoLancamento({ ...base, kind: 'income', fee_cents: 500 }).length, 1);
  // fee_cents não vai ao banco
  assert.ok(!('fee_cents' in linhasDoLancamento({ ...base, fee_cents: 500 })[0]));
});

test('parcelada: a RPC muda com o último dia; os argumentos são os da RPC', () => {
  const e = { accountId: 'c', totalCents: 300000, installments: 10, paidInstallments: 0, occurredAt: '2026-10-01', description: 'Notebook', category: null, merchant: null };
  assert.deepEqual(argsDaParcelada(e), {
    rpc: 'create_installment_plan_with_history',
    args: { p_account_id: 'c', p_total_cents: 300000, p_installments: 10, p_paid_installments: 0, p_occurred_at: '2026-10-01', p_description: 'Notebook', p_category: undefined, p_merchant: undefined },
  });
  assert.equal(argsDaParcelada({ ...e, lastDay: true }).rpc, 'create_installment_plan_last_day');
});

test('recorrente: a âncora é o próximo vencimento', () => {
  const r = linhaDaRecorrente({ kind: 'expense', amount_cents: 5000, description: 'Academia', merchant: null, category: null, account_id: null, rrule: 'FREQ=WEEKLY;BYDAY=MO', next_run_at: '2026-10-05T12:00:00.000Z', end_date: null, auto_confirm: false });
  assert.equal(r.dtstart, '2026-10-05T12:00:00.000Z');
});

test('financiamento: a linha é a entrada, sem id nem versão', () => {
  const f = linhaDoFinanciamento({ name: 'Carro', kind: 'financing', principal_cents: 1, remaining_cents: 1, interest_rate_monthly: 0, installments: 1, installment_cents: 1, account_id: null, due_day: 10 });
  assert.ok(!('id' in f) && !('versao' in f));
  assert.equal(f.name, 'Carro');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test src/lib/escrita.test.ts`
Expected: FAIL — `Cannot find module './escrita.ts'`.

- [ ] **Step 3: Implement** `src/lib/escrita.ts`

```ts
/**
 * A ENTRADA de cada hook de criação → o que vai ao banco (spec 2026-09-28, seção 2).
 *
 * Um lugar só, usado pelo salvar real e pela hipótese (`simular`): o que foi simulado é, byte a
 * byte, o que é aplicado. `user_id` fica de fora — o hook põe o da sessão, e `simular` põe
 * `auth.uid()` no banco.
 */
import type { TransactionInput } from '@/hooks/use-finance';

export const DESCRICAO_JUROS_DO_PIX = 'Juros do Pix no crédito';

export type EntradaLancamento = TransactionInput & { fee_cents?: number };
export type EntradaParcelada = {
  accountId: string;
  totalCents: number;
  installments: number;
  paidInstallments: number;
  occurredAt: string;
  description: string | null;
  category: string | null;
  merchant: string | null;
  lastDay?: boolean;
};
export type EntradaRecorrente = {
  kind: 'expense' | 'income';
  amount_cents: number;
  description: string | null;
  merchant: string | null;
  category: string | null;
  account_id: string | null;
  rrule: string;
  next_run_at: string;
  end_date: string | null;
  auto_confirm: boolean;
};
export type EntradaFinanciamento = {
  name: string;
  kind: 'financing' | 'loan' | 'other' | string;
  calculation_mode?: 'fixed_installments' | 'interest' | string;
  principal_cents: number;
  remaining_cents: number;
  interest_rate_monthly: number;
  installments: number | null;
  installments_paid?: number;
  installment_cents: number | null;
  account_id: string | null;
  due_day: number | null;
  first_due_date?: string | null;
};

/**
 * A linha de juros do Pix no crédito a partir da linha principal: SEMPRE uma despesa no cartão,
 * sem destino (movida de `use-finance.ts`, 28/09/2026).
 */
export function linhaDeJuros<T extends Record<string, unknown>>(base: T, cents: number) {
  return {
    ...base,
    kind: 'expense' as const,
    counterparty_account_id: null,
    amount_cents: cents,
    category: 'juros',
    description: DESCRICAO_JUROS_DO_PIX,
    merchant: null,
  };
}

export function linhasDoLancamento({ fee_cents, ...input }: EntradaLancamento): Record<string, unknown>[] {
  const compra = { ...input, source: 'app' as const };
  const linhas: Record<string, unknown>[] = [compra];
  if (fee_cents && fee_cents > 0 && input.kind !== 'income') linhas.push(linhaDeJuros(compra, fee_cents));
  return linhas;
}

export function argsDaParcelada(e: EntradaParcelada) {
  return {
    rpc: (e.lastDay ? 'create_installment_plan_last_day' : 'create_installment_plan_with_history') as
      | 'create_installment_plan_last_day'
      | 'create_installment_plan_with_history',
    args: {
      p_account_id: e.accountId,
      p_total_cents: e.totalCents,
      p_installments: e.installments,
      p_paid_installments: e.paidInstallments,
      p_occurred_at: e.occurredAt,
      p_description: e.description ?? undefined,
      p_category: e.category ?? undefined,
      p_merchant: e.merchant ?? undefined,
    },
  };
}

export function linhaDaRecorrente(e: EntradaRecorrente): Record<string, unknown> {
  // âncora da série: sem ela a hora de parede deriva a cada rodada do cron
  return { ...e, dtstart: e.next_run_at };
}

export function linhaDoFinanciamento(e: EntradaFinanciamento): Record<string, unknown> {
  const { ...linha } = e as EntradaFinanciamento & { id?: string; versao?: string | null };
  delete (linha as { id?: string }).id;
  delete (linha as { versao?: string | null }).versao;
  return linha;
}
```

Se `DESCRICAO_JUROS_DO_PIX` já existe em `use-finance.ts` com outro texto, use o TEXTO de lá (é o que as linhas gravadas têm) e reexporte de `use-finance.ts` a partir de `escrita.ts`.

- [ ] **Step 4: Route the hooks through `escrita.ts`** (`src/hooks/use-finance.ts`)

  - `useSaveTransaction`, ramo de criação (hoje `const compra = …; const linhas = [compra]; … insert(linhas)`), vira:
    ```ts
    const uid = await userId();
    const linhas = linhasDoLancamento({ ...input, fee_cents }).map((l) => ({ ...l, user_id: uid }));
    const { error } = await supabase.from('transactions').insert(linhas);
    if (error) throw error;
    ```
    e o ramo de edição que cria juro usa `linhaDeJuros` importada de `escrita.ts`. Apague a `linhaDeJuros` local.
  - `useCreateInstallmentPlan`: `const { rpc, args } = argsDaParcelada(input); const { error } = await supabase.rpc(rpc, args);` (o `input` do hook passa a ser `EntradaParcelada`).
  - `useSaveDebt`, ramo de criação: `insert({ ...linhaDoFinanciamento(resto), user_id: await userId() })`.
  - Novo `useCreateRecurring` (movido de `recurring.tsx`, mesma doc):
    ```ts
    export function useCreateRecurring() {
      const invalidate = useInvalidateFinance();
      return useMutation({
        mutationFn: async (input: EntradaRecorrente) => {
          const { error } = await supabase
            .from('recurring_transactions')
            .insert({ ...linhaDaRecorrente(input), user_id: await userId() });
          if (error) throw error;
        },
        onSuccess: invalidate,
      });
    }
    ```
  - Em `recurring.tsx`: apague a função local e importe `useCreateRecurring` de `@/hooks/use-finance`.

- [ ] **Step 5: Run tests**

Run: `node --test src/lib/escrita.test.ts && npx tsc --noEmit && npx expo lint && npm test`
Expected: tudo verde. Se `simple-finance-ui.test.ts` acusar `useCreateRecurring` indefinido, adicione `useCreateRecurring: () => mutation('createRecurring'),` ao objeto `finance` do harness.

- [ ] **Step 6: Commit**

```bash
git add src/lib/escrita.ts src/lib/escrita.test.ts src/hooks/use-finance.ts src/app/finance/recurring.tsx src/lib/simple-finance-ui.test.ts
git commit -m "refactor(finance): o que cada criação grava sai de uma função pura, a mesma da hipótese"
```

---

### Task 3: O rascunho no aparelho

**Files:**
- Create: `src/lib/rascunho.ts`, `src/lib/rascunho.test.ts`, `src/hooks/use-rascunho.ts`
- Modify: `src/lib/simple-finance-ui.test.ts` (carregar `@/lib/rascunho` e `@/hooks/use-rascunho` de verdade)

**Interfaces:**
- Consumes: `EntradaLancamento`, `EntradaParcelada`, `EntradaRecorrente`, `EntradaFinanciamento`, `linhasDoLancamento`, `argsDaParcelada`, `linhaDaRecorrente`, `linhaDoFinanciamento` (Task 2); `Draft` (`use-finance.ts`).
- Produces:
  ```ts
  export type TipoDetalhado = 'lancamento' | 'parcelada' | 'recorrente' | 'financiamento';
  export type HipoteseDetalhada =
    | { id: string; tipo: 'lancamento'; entrada: EntradaLancamento; titulo: string }
    | { id: string; tipo: 'parcelada'; entrada: EntradaParcelada; titulo: string }
    | { id: string; tipo: 'recorrente'; entrada: EntradaRecorrente; titulo: string }
    | { id: string; tipo: 'financiamento'; entrada: EntradaFinanciamento; titulo: string };
  export type Rascunho = { versao: 1; rapidas: Draft[]; detalhadas: HipoteseDetalhada[] };
  export const RASCUNHO_VAZIO: Rascunho;
  export function lerRascunho(texto: string): Rascunho;           // inválido → RASCUNHO_VAZIO
  export function gravarRascunho(r: Rascunho): string;             // vazio → ''
  export function registrosParaSimular(d: HipoteseDetalhada[]): { tipo: TipoDetalhado; dados: unknown }[];
  export function resumoDaHipotese(h: HipoteseDetalhada, brl: (c: number) => string): string;
  // hook
  export function useRascunho(): {
    rascunho: Rascunho;
    setRapidas: (f: (antes: Draft[]) => Draft[]) => void;
    adicionarDetalhada: (h: Omit<HipoteseDetalhada, 'id'>) => string;   // devolve o id
    trocarDetalhada: (id: string, h: Omit<HipoteseDetalhada, 'id'>) => void;
    tirarDetalhada: (id: string) => void;
    limpar: () => void;
    restaurar: (r: Rascunho) => void;
  };
  ```

- [ ] **Step 1: Write the failing test** — `src/lib/rascunho.test.ts`

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RASCUNHO_VAZIO, gravarRascunho, lerRascunho, registrosParaSimular, resumoDaHipotese } from './rascunho.ts';

const brl = (c: number) => `R$ ${(c / 100).toFixed(2)}`;
const parcelada = {
  id: 'h1', tipo: 'parcelada' as const, titulo: 'Notebook',
  entrada: { accountId: 'c', totalCents: 300000, installments: 10, paidInstallments: 0, occurredAt: '2026-10-01', description: 'Notebook', category: null, merchant: null },
};

test('ler e gravar vão e voltam; vazio grava texto vazio', () => {
  const r = { versao: 1 as const, rapidas: [{ kind: 'income' as const, amount_cents: 100, start: '2026-10-01', installments: 1 }], detalhadas: [parcelada] };
  assert.deepEqual(lerRascunho(gravarRascunho(r)), r);
  assert.equal(gravarRascunho(RASCUNHO_VAZIO), '');
});

test('formato velho ou corrompido não quebra: vira vazio', () => {
  assert.deepEqual(lerRascunho(''), RASCUNHO_VAZIO);
  assert.deepEqual(lerRascunho('{nao é json'), RASCUNHO_VAZIO);
  assert.deepEqual(lerRascunho(JSON.stringify({ versao: 99, rapidas: [], detalhadas: [] })), RASCUNHO_VAZIO);
  assert.deepEqual(lerRascunho(JSON.stringify({ versao: 1, rapidas: 'x', detalhadas: null })), RASCUNHO_VAZIO);
});

test('registros para simular usam as funções da escrita', () => {
  assert.deepEqual(registrosParaSimular([parcelada]), [{
    tipo: 'parcelada',
    dados: { p_account_id: 'c', p_total_cents: 300000, p_installments: 10, p_paid_installments: 0, p_occurred_at: '2026-10-01', p_description: 'Notebook', p_category: undefined, p_merchant: undefined, ultimo_dia: false },
  }]);
});

test('a linha diz título, tipo e valor', () => {
  assert.equal(resumoDaHipotese(parcelada, brl), 'Notebook · compra 10× · R$ 3000.00');
});
```

- [ ] **Step 2: Run to verify it fails** — `node --test src/lib/rascunho.test.ts` → FAIL (módulo inexistente).

- [ ] **Step 3: Implement** `src/lib/rascunho.ts`

```ts
/**
 * O rascunho do "E se…?" (spec 2026-09-28, seção 4): rápidas (o `Draft` de sempre, e os grupos
 * de adiantar) e detalhadas (a ENTRADA do hook que as salvaria). Mora no aparelho — ler aceita
 * qualquer coisa e devolve vazio no que não reconhece, para um dado velho nunca quebrar a tela.
 */
import type { Draft } from '@/hooks/use-finance';
import {
  argsDaParcelada,
  linhaDaRecorrente,
  linhaDoFinanciamento,
  linhasDoLancamento,
  type EntradaFinanciamento,
  type EntradaLancamento,
  type EntradaParcelada,
  type EntradaRecorrente,
} from './escrita.ts';

export type TipoDetalhado = 'lancamento' | 'parcelada' | 'recorrente' | 'financiamento';
export type HipoteseDetalhada =
  | { id: string; tipo: 'lancamento'; entrada: EntradaLancamento; titulo: string }
  | { id: string; tipo: 'parcelada'; entrada: EntradaParcelada; titulo: string }
  | { id: string; tipo: 'recorrente'; entrada: EntradaRecorrente; titulo: string }
  | { id: string; tipo: 'financiamento'; entrada: EntradaFinanciamento; titulo: string };
export type Rascunho = { versao: 1; rapidas: Draft[]; detalhadas: HipoteseDetalhada[] };

export const RASCUNHO_VAZIO: Rascunho = { versao: 1, rapidas: [], detalhadas: [] };

export function lerRascunho(texto: string): Rascunho {
  if (!texto) return RASCUNHO_VAZIO;
  try {
    const r = JSON.parse(texto) as Partial<Rascunho>;
    if (r?.versao !== 1 || !Array.isArray(r.rapidas) || !Array.isArray(r.detalhadas)) return RASCUNHO_VAZIO;
    return { versao: 1, rapidas: r.rapidas, detalhadas: r.detalhadas };
  } catch {
    return RASCUNHO_VAZIO;
  }
}

export function gravarRascunho(r: Rascunho): string {
  return r.rapidas.length === 0 && r.detalhadas.length === 0 ? '' : JSON.stringify(r);
}

export function registrosParaSimular(detalhadas: HipoteseDetalhada[]) {
  return detalhadas.map((h) => {
    switch (h.tipo) {
      case 'lancamento':
        return { tipo: h.tipo, dados: { linhas: linhasDoLancamento(h.entrada) } };
      case 'parcelada': {
        const { rpc, args } = argsDaParcelada(h.entrada);
        return { tipo: h.tipo, dados: { ...args, ultimo_dia: rpc === 'create_installment_plan_last_day' } };
      }
      case 'recorrente':
        return { tipo: h.tipo, dados: linhaDaRecorrente(h.entrada) };
      case 'financiamento':
        return { tipo: h.tipo, dados: linhaDoFinanciamento(h.entrada) };
    }
  });
}

export function resumoDaHipotese(h: HipoteseDetalhada, brl: (c: number) => string): string {
  switch (h.tipo) {
    case 'lancamento':
      return `${h.titulo} · ${h.entrada.kind === 'income' ? 'entrada' : h.entrada.kind === 'transfer' ? 'transferência' : 'gasto'} · ${brl(h.entrada.amount_cents)}`;
    case 'parcelada':
      return `${h.titulo} · compra ${h.entrada.installments}× · ${brl(h.entrada.totalCents)}`;
    case 'recorrente':
      return `${h.titulo} · recorrente · ${brl(h.entrada.amount_cents)}`;
    case 'financiamento':
      return `${h.titulo} · financiamento · ${brl(h.entrada.remaining_cents)}`;
  }
}
```

- [ ] **Step 4: Implement** `src/hooks/use-rascunho.ts`

```ts
import { usePreferencia } from '@/hooks/use-preferencia';
import type { Draft } from '@/hooks/use-finance';
import { gravarRascunho, lerRascunho, type HipoteseDetalhada, type Rascunho } from '@/lib/rascunho';

const ehTexto = (v: string | number): v is string => typeof v === 'string';

/**
 * O rascunho do "E se…?" no aparelho, por usuário (28/09/2026: *"salvar no aparelho"*). A
 * Projeção e os formulários em modo hipótese leem e escrevem o MESMO estado.
 */
export function useRascunho() {
  const [texto, setTexto] = usePreferencia<string>('projecao:rascunho', '', ehTexto);
  const rascunho = lerRascunho(texto);
  const gravar = (r: Rascunho) => setTexto(gravarRascunho(r));
  return {
    rascunho,
    setRapidas: (f: (antes: Draft[]) => Draft[]) => gravar({ ...rascunho, rapidas: f(rascunho.rapidas) }),
    adicionarDetalhada: (h: Omit<HipoteseDetalhada, 'id'>) => {
      const id = `h${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      gravar({ ...rascunho, detalhadas: [...rascunho.detalhadas, { ...h, id } as HipoteseDetalhada] });
      return id;
    },
    trocarDetalhada: (id: string, h: Omit<HipoteseDetalhada, 'id'>) =>
      gravar({ ...rascunho, detalhadas: rascunho.detalhadas.map((d) => (d.id === id ? ({ ...h, id } as HipoteseDetalhada) : d)) }),
    tirarDetalhada: (id: string) => gravar({ ...rascunho, detalhadas: rascunho.detalhadas.filter((d) => d.id !== id) }),
    limpar: () => setTexto(''),
    restaurar: (r: Rascunho) => gravar(r),
  };
}
```

- [ ] **Step 5: Run tests** — `node --test src/lib/rascunho.test.ts && npx tsc --noEmit && npx expo lint` → verde.

- [ ] **Step 6: Commit**

```bash
git add src/lib/rascunho.ts src/lib/rascunho.test.ts src/hooks/use-rascunho.ts
git commit -m "feat(projecao): o rascunho do E se mora no aparelho, com rápidas e detalhadas"
```

---

### Task 4: A Projeção lê pelo rascunho do aparelho e por `simular`

**Files:**
- Modify: `src/hooks/use-finance.ts` (novo `useSimulacao` logo depois de `useForecastMonths`, ~linha 1105)
- Modify: `src/lib/query-invalidation.ts` (`['simular']` em `FINANCE_KEYS`)
- Modify: `src/app/finance/forecast.tsx` (linhas 213-266: estado do rascunho e leituras)
- Modify: `.claude/rules/finance.md` (*Rascunho de cenário*: "Ele vive em `useState`…" passa a "mora no aparelho, por usuário, até aplicar ou limpar — decisão de 28/09/2026")
- Test: `src/lib/simple-finance-ui.test.ts`

**Interfaces:**
- Consumes: `useRascunho`, `registrosParaSimular` (Task 3); `paraOBanco(drafts)` (já existe em `use-finance.ts`); `ForecastDay`, `ProjecaoMensal`, `CycleView`.
- Produces:
  ```ts
  export type ErroDaHipotese = { indice: number; mensagem: string };
  export function useSimulacao(
    days: number, drafts: Draft[], registros: { tipo: string; dados: unknown }[],
    modo: 'dia' | 'mes', view: CycleView | undefined, enabled: boolean,
  ): UseQueryResult<{ forecast?: ForecastDay[]; meses?: ProjecaoMensal; erros: ErroDaHipotese[] }>;
  ```

- [ ] **Step 1: Write the failing test** (append to `src/lib/simple-finance-ui.test.ts`; adicione ao objeto `finance` do harness `useSimulacao: (_d: number, _dr: any[], registros: any[]) => ({ ...query, isPending: false, data: registros.length ? (options.simulacao ?? { forecast: [], erros: [] }) : undefined }),` e `simulacao?: any` ao tipo de `options`; carregue `@/hooks/use-rascunho` de verdade e mocke `usePreferencia` como já está):

```ts
test('Projeção: com hipótese detalhada no rascunho, a série vem de simular e o erro aparece na linha', () => {
  const rascunho = JSON.stringify({ versao: 1, rapidas: [], detalhadas: [
    { id: 'h1', tipo: 'parcelada', titulo: 'Notebook', entrada: { accountId: 'c', totalCents: 300000, installments: 10, paidInstallments: 0, occurredAt: '2026-10-01', description: 'Notebook', category: null, merchant: null } },
  ] });
  const ui = screen(forecastFile, { preferencias: { 'projecao:rascunho': rascunho }, simulacao: { forecast: [{ day: '2026-09-28', in_cents: 0, out_cents: 0, balance_cents: 100 }], erros: [{ indice: 0, mensagem: 'conta arquivada' }] } });
  assert.ok(ui.nodes().some((n: any) => typeof n.props?.children === 'string' && n.props.children.includes('Notebook')), 'a hipótese detalhada aparece no rascunho');
  assert.ok(ui.nodes().some((n: any) => typeof n.props?.children === 'string' && n.props.children.includes('conta arquivada')), 'o erro da simulação aparece na linha');
});
```

  Se o mock de `usePreferencia` do harness não aceitar valores iniciais, estenda-o para ler `options.preferencias?.[nome] ?? padrao` e acrescente `preferencias?: Record<string, string>` ao tipo de `options`.

- [ ] **Step 2: Run to verify it fails** — `node --test --test-name-pattern="hipótese detalhada no rascunho" src/lib/simple-finance-ui.test.ts` → FAIL.

- [ ] **Step 3: Implement `useSimulacao`** (`use-finance.ts`)

```ts
export type ErroDaHipotese = { indice: number; mensagem: string };

/**
 * A Projeção com hipóteses DETALHADAS (spec 2026-09-28): os registros são criados de verdade no
 * banco, lidos e desfeitos (`simular`). As rápidas vão junto, no mesmo `forecast_json`.
 * Uma chamada por modo: no dia pede a série; no mês, o agrupado.
 */
export function useSimulacao(
  days: number,
  drafts: Draft[],
  registros: { tipo: string; dados: unknown }[],
  modo: 'dia' | 'mes',
  view: CycleView | undefined,
  enabled: boolean,
) {
  useRealtimeInvalidate('transactions', ['simular']);
  return useQuery({
    enabled: enabled && registros.length > 0,
    placeholderData: (anterior) => anterior,
    queryKey: ['simular', modo, String(days), JSON.stringify(paraOBanco(drafts)), JSON.stringify(registros), view ?? ''],
    queryFn: async () => {
      const leitura = modo === 'mes'
        ? { meses: { days, drafts: paraOBanco(drafts), view: view ?? null } }
        : { forecast: { days, drafts: paraOBanco(drafts) } };
      const { data, error } = await supabase.rpc('simular', { p_registros: registros as never, p_leituras: leitura as never });
      if (error) throw error;
      const r = data as { leituras?: { forecast?: ForecastDay[]; meses?: ProjecaoMensal }; erros?: ErroDaHipotese[] } | null;
      return { forecast: r?.leituras?.forecast, meses: r?.leituras?.meses, erros: r?.erros ?? [] };
    },
  });
}
```

  Em `src/lib/query-invalidation.ts`, acrescente `['simular'],` a `FINANCE_KEYS` (a simulação lê o livro-caixa: um lançamento novo muda o resultado).

- [ ] **Step 4: Wire the Projeção** (`forecast.tsx`)

  - Troque `const [rascunhos, setRascunhos] = useState<Draft[]>([]);` (e o comentário acima, que dizia "sair da tela apaga") por:
    ```ts
    // O rascunho mora no aparelho (28/09/2026, spec hipóteses detalhadas): as rápidas continuam
    // `Draft[]`; as detalhadas são a entrada do formulário real.
    const { rascunho, setRapidas, tirarDetalhada, limpar, restaurar } = useRascunho();
    const rascunhos = rascunho.rapidas;
    const setRascunhos = (v: Draft[] | ((antes: Draft[]) => Draft[])) =>
      setRapidas(typeof v === 'function' ? v : () => v);
    const detalhadas = rascunho.detalhadas;
    const registros = useMemo(() => registrosParaSimular(detalhadas), [detalhadas]);
    ```
    (mantém toda chamada existente de `setRascunhos` funcionando).
  - Depois de `const mensal = useForecastMonths(...)`:
    ```ts
    const comDetalhadas = registros.length > 0;
    const simulacao = useSimulacao(dias, rascunhos, registros, emMes ? 'mes' : 'dia', regua.view, comDetalhadas);
    const errosDaSimulacao = simulacao.data?.erros ?? [];
    ```
  - Onde a tela escolhe a série simulada (`simulado.data`) e o mensal (`mensal.data`), com detalhadas use `simulacao.data?.forecast` e `simulacao.data?.meses` no lugar. Faça numa função pequena no topo do componente, para não espalhar:
    ```ts
    const serieSimulada = comDetalhadas ? simulacao.data?.forecast : simulado.data;
    const mesesExibidos = comDetalhadas ? simulacao.data?.meses : mensal.data;
    ```
    e troque os usos de `simulado.data` / `mensal.data` por essas duas. Os estados de carregamento/erro seguem a consulta ativa (`comDetalhadas ? simulacao : simulado|mensal`) — use a mesma troca no `useTelaPronta`/skeleton da tela.
  - `simulando` passa a ser `rascunhos.length > 0 || detalhadas.length > 0`.
  - No card do Rascunho, depois das linhas das rápidas, liste as detalhadas (Task 6 põe as ações; aqui só o texto, para o teste passar):
    ```tsx
    {detalhadas.map((h, i) => {
      const erro = errosDaSimulacao.find((e) => e.indice === i);
      return (
        <View key={h.id} style={styles.hipoteseLinha}>
          <ThemedText type="small">{resumoDaHipotese(h, brl)}</ThemedText>
          {erro ? <ThemedText type="caption" themeColor="danger">{`Não dá para simular: ${erro.mensagem}`}</ThemedText> : null}
        </View>
      );
    })}
    ```
    (`styles.hipoteseLinha`: `{ gap: Space.xs, paddingVertical: Space.sm }`.)
  - O "Limpar" do card passa a chamar `limpar()` com "Desfazer" (`restaurar(antes)` no toast), guardando `const antes = rascunho` antes de limpar.

- [ ] **Step 5: Run** — o teste novo, depois `npx tsc --noEmit && npx expo lint && npm test` → verde. Os testes existentes do "E se…?" continuam passando (o `setRascunhos` compatível garante).

- [ ] **Step 6: Commit**

```bash
git add src/hooks/use-finance.ts src/lib/query-invalidation.ts src/app/finance/forecast.tsx src/lib/simple-finance-ui.test.ts .claude/rules/finance.md
git commit -m "feat(projecao): o rascunho fica no aparelho e a Projeção simula as hipóteses detalhadas"
```

---

### Task 5: Os formulários em modo hipótese

**Files:**
- Modify: `src/app/finance/transaction-form.tsx` (params linha 160; `onSubmit` ~546-760; título e botão do header)
- Modify: `src/app/finance/recurring.tsx` (params linha 145; `salvar` ~306-332; título e botão)
- Modify: `src/app/finance/debts.tsx` (params linha 182; `salvar` ~442-478; título e botão)
- Test: `src/lib/simple-finance-ui.test.ts`

**Interfaces:**
- Consumes: `useRascunho().adicionarDetalhada / trocarDetalhada`, `rascunho.detalhadas` (Task 3); `EntradaLancamento`, `EntradaParcelada`, `EntradaRecorrente`, `EntradaFinanciamento` (Task 2).
- Produces: rotas
  - `/finance/transaction-form?hipotese=nova` (criar) e `?hipotese=<id>` (editar a hipótese `<id>`);
  - `/finance/recurring?create=1&hipotese=nova|<id>`;
  - `/finance/debts?create=financing&hipotese=nova|<id>`.

- [ ] **Step 1: Write the failing tests** (append):

```ts
test('Lançamento em modo hipótese: "Adicionar à hipótese" não grava e guarda a entrada no rascunho', () => {
  const ui = screen('src/app/finance/transaction-form.tsx', { params: { hipotese: 'nova' } });
  // preencha título e valor pelos campos do formulário, como os outros testes deste arquivo fazem
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'TextField' && n.props.accessibilityLabel === 'Título').props.onChangeText('Notebook'));
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'MoneyField').props.onChangeCents(300000));
  const header = ui.nodes().find((n: any) => n.type === 'TaskHeader');
  assert.equal(header.props.action.props.label, 'Adicionar à hipótese');
  ui.interact(() => header.props.action.props.onPress());
  assert.equal(ui.writes.length, 0, 'modo hipótese não escreve');
  const gravado = JSON.parse(ui.preferenciasGravadas['projecao:rascunho']);
  assert.equal(gravado.detalhadas[0].titulo, 'Notebook');
  assert.equal(gravado.detalhadas[0].tipo, 'lancamento');
});

test('Recorrente e financiamento em modo hipótese também não gravam', () => {
  const rec = screen('src/app/finance/recurring.tsx', { params: { create: '1', hipotese: 'nova', description: 'Academia', amount: '5000' } });
  rec.interact(() => rec.nodes().find((n: any) => n.type === 'TaskHeader').props.action.props.onPress());
  assert.equal(rec.writes.length, 0);
  const deb = screen('src/app/finance/debts.tsx', { params: { create: 'financing', hipotese: 'nova' } });
  assert.equal(deb.nodes().find((n: any) => n.type === 'TaskHeader').props.action.props.label, 'Adicionar à hipótese');
});
```

  No harness, o mock de `usePreferencia` grava em `preferenciasGravadas` (objeto devolvido em `screen(...)`), e aceita `options.preferencias` como valor inicial — os dois nomes já usados na Task 4.
  Se os rótulos exatos dos campos diferirem (confira `accessibilityLabel` em `transaction-form.tsx`), ajuste o seletor, não a asserção.

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: `transaction-form.tsx`**
  - `useLocalSearchParams<{ id?: string; conta?: string; hipotese?: string; deHipotese?: string }>()`; `const modoHipotese = Boolean(params.hipotese); const hipoteseAberta = rascunho.detalhadas.find((h) => h.id === params.hipotese) ?? null;` (use `useRascunho()`).
  - Pré-preencha o `defaultValues` quando `hipoteseAberta` existir: para `lancamento`, os campos saem de `entrada` (`kind`, `amount_cents`, `category`, `description`, `merchant`, `account_id`, `counterparty_account_id`, `occurred_at` → `isoToBR`, `pending` = `status === 'pending'`, `due_at` → `isoToBR`, `auto_confirm`, `fee_cents`); para `parcelada`, `installments`, `amount_cents` = `totalCents` com a unidade "total", `paid_installments` = `String(paidInstallments)`, `occurred_at`.
  - No `onSubmit`, os DOIS objetos que hoje vão direto ao `mutate` passam a ser variáveis:
    ```ts
    const entradaParcelada: EntradaParcelada = { accountId: values.account_id!, totalCents: totalDaCompraNova, installments: values.installments, paidInstallments: installmentHistory(values.paid_installments, values.installments, brToISO(values.occurred_at), localISODate()), occurredAt: brToISO(values.occurred_at), description: values.description.trim(), category: values.category, merchant: values.merchant?.trim() || null, lastDay: intencaoDoDia === 'ultimo' && !isCard };
    const entradaLancamento: EntradaLancamento = { kind: values.kind, amount_cents: values.amount_cents, category: values.kind === 'transfer' ? null : values.category, description: values.description.trim(), merchant: values.merchant?.trim() || null, account_id: values.account_id, counterparty_account_id: values.kind === 'transfer' ? values.counterparty_account_id : null, occurred_at: brToISO(values.occurred_at), status, due_at: dueAt, fee_cents: mostraJuros ? values.fee_cents : 0, auto_confirm: autoConfirm };
    ```
    e o `createPlan.mutate` / `save.mutate` recebem esses objetos (no `save.mutate` acrescente `id: editing?.id` e `juros` como hoje).
  - Logo depois de montar as duas, antes de qualquer `mutate`:
    ```ts
    if (modoHipotese) {
      const h = destino === 'criarPlano'
        ? { tipo: 'parcelada' as const, entrada: entradaParcelada, titulo: entradaParcelada.description ?? 'Compra' }
        : { tipo: 'lancamento' as const, entrada: entradaLancamento, titulo: entradaLancamento.description ?? 'Lançamento' };
      if (hipoteseAberta) trocarDetalhada(hipoteseAberta.id, h);
      else adicionarDetalhada(h);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
      return;
    }
    ```
  - Header: título `modoHipotese ? (hipoteseAberta ? 'Editar hipótese' : 'Nova hipótese') : <o de hoje>`; botão `modoHipotese ? 'Adicionar à hipótese' : 'Salvar'`.
  - Em modo hipótese esconda o que só faz sentido em registro existente (menu de apagar, histórico); a edição nunca abre com `params.id` junto.

- [ ] **Step 4: `recurring.tsx`** — `params.hipotese`; o `form` inicial com `create=1` já lê os params; com `hipotese=<id>` existente, preencha `form` da `entrada` (`kind`, `amountCents`, `description`, `merchant`, `category`, `accountId`, `inicio` = `isoToBR(dataLocalDe(next_run_at))`, `fim`, `autoConfirm`; a repetição sai de `rrule` pelo `serieDoRegistro` que já existe — passe um objeto com os campos que ele lê). No `salvar`, o objeto de `create.mutate` vira `const entrada: EntradaRecorrente = {...}`, e em modo hipótese:
    ```ts
    if (modoHipotese) {
      const h = { tipo: 'recorrente' as const, entrada, titulo: entrada.description ?? 'Recorrente' };
      if (hipoteseAberta) trocarDetalhada(hipoteseAberta.id, h); else adicionarDetalhada(h);
      volta.aoFechar(() => setForm(null));
      return;
    }
    ```
    Botão do sheet: `'Adicionar à hipótese'`; título `'Nova hipótese'`/`'Editar hipótese'`.

- [ ] **Step 5: `debts.tsx`** — igual: `const entrada: EntradaFinanciamento = <o target de hoje sem id nem versao>`; em modo hipótese `adicionarDetalhada({ tipo: 'financiamento', entrada, titulo: entrada.name })` (ou `trocarDetalhada`) e `volta.aoFechar(() => setForm(null))`, sem `save.mutate`. Pré-preencha o form de `hipoteseAberta.entrada` com o mesmo mapeamento que o formulário usa para editar uma dívida (a função que monta o form a partir de `Debt` — passe um objeto com os campos da entrada).

- [ ] **Step 6: Run** — testes novos + `npx tsc --noEmit && npx expo lint && npm test` → verde.

- [ ] **Step 7: Commit**

```bash
git add src/app/finance/transaction-form.tsx src/app/finance/recurring.tsx src/app/finance/debts.tsx src/lib/simple-finance-ui.test.ts
git commit -m "feat(projecao): lançamento, compra parcelada, recorrente e financiamento viram hipótese no formulário real"
```

---

### Task 6: "Adicionar como…" e as linhas do rascunho

**Files:**
- Modify: `src/app/finance/forecast.tsx` (card do "E se…?", ~linha 700-800)
- Test: `src/lib/simple-finance-ui.test.ts`

**Interfaces:**
- Consumes: rotas da Task 5; `useRascunho().tirarDetalhada / restaurar`; `resumoDaHipotese`; `Deslizavel`, `showItemActions`, `ItemAction`.

- [ ] **Step 1: Failing test** (append):

```ts
test('E se: "Adicionar como…" abre o formulário real em modo hipótese; a linha arrasta Aplicar e Tirar', () => {
  const rascunho = JSON.stringify({ versao: 1, rapidas: [], detalhadas: [
    { id: 'h1', tipo: 'recorrente', titulo: 'Academia', entrada: { kind: 'expense', amount_cents: 5000, description: 'Academia', merchant: null, category: null, account_id: null, rrule: 'FREQ=WEEKLY;BYDAY=MO', next_run_at: '2026-10-05T12:00:00.000Z', end_date: null, auto_confirm: false } },
  ] });
  const ui = screen(forecastFile, { preferencias: { 'projecao:rascunho': rascunho } });
  ui.interact(() => ui.nodes().find((n: any) => n.props?.label === 'Adicionar como…').props.onPress());
  const opcoes = ui.actions.map((a: any) => a.label);
  assert.deepEqual(opcoes, ['Lançamento', 'Compra parcelada', 'Recorrente', 'Financiamento']);
  ui.interact(() => ui.actions.find((a: any) => a.label === 'Recorrente').onPress());
  assert.deepEqual(JSON.parse(JSON.stringify(ui.navigations.at(-1))), { pathname: '/finance/recurring', params: { create: '1', hipotese: 'nova' } });
  const card = deslizaveis(ui).find((d: any) => d.props.titulo === 'Academia');
  assert.deepEqual(ladosDe(card), { direita: ['Aplicar'], esquerda: ['Tirar'], mais: true, pontaDireita: 'Aplicar', pontaEsquerda: 'Tirar' });
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement**
  - Ao lado de "Supor um lançamento" (e de "Adicionar outra hipótese" quando já há rascunho), um `Button` secundário **"Adicionar como…"** que chama:
    ```ts
    showItemActions('Adicionar como…', [
      { label: 'Lançamento', icon: 'doc.text', onPress: () => router.push({ pathname: '/finance/transaction-form', params: { hipotese: 'nova' } }) },
      { label: 'Compra parcelada', icon: 'creditcard', onPress: () => router.push({ pathname: '/finance/transaction-form', params: { hipotese: 'nova', parcelada: '1' } }) },
      { label: 'Recorrente', icon: 'repeat', onPress: () => router.push({ pathname: '/finance/recurring', params: { create: '1', hipotese: 'nova' } }) },
      { label: 'Financiamento', icon: 'banknote', onPress: () => router.push({ pathname: '/finance/debts', params: { create: 'financing', hipotese: 'nova' } }) },
    ]);
    ```
    (`parcelada=1` abre o formulário já com 2 parcelas: no `transaction-form`, `installments` inicial = 2 quando `params.parcelada === '1'`.)
  - Cada detalhada (a lista da Task 4) vira:
    ```tsx
    <Deslizavel key={h.id} titulo={h.titulo} acoes={acoesDaDetalhada(h)}>
      <Row title={h.titulo} subtitle={erro ? `Não dá para simular: ${erro.mensagem}` : resumoDaHipotese(h, brl).replace(`${h.titulo} · `, '')}
           onPress={() => editarDetalhada(h)} onLongPress={() => showItemActions(h.titulo, acoesDaDetalhada(h))} />
    </Deslizavel>
    ```
    com
    ```ts
    const rotaDaHipotese = (h: HipoteseDetalhada) =>
      h.tipo === 'recorrente' ? { pathname: '/finance/recurring' as const, params: { create: '1', hipotese: h.id } }
      : h.tipo === 'financiamento' ? { pathname: '/finance/debts' as const, params: { create: 'financing', hipotese: h.id } }
      : { pathname: '/finance/transaction-form' as const, params: { hipotese: h.id } };
    const editarDetalhada = (h: HipoteseDetalhada) => router.push(rotaDaHipotese(h));
    const acoesDaDetalhada = (h: HipoteseDetalhada): ItemAction[] => [
      { label: 'Aplicar', icon: 'checkmark.circle', arrasto: 'direita', onPress: () => aplicarDetalhada(h) },   // Task 7
      { label: 'Editar', icon: 'pencil', onPress: () => editarDetalhada(h) },
      { label: 'Tirar', icon: 'trash', destructive: true, arrasto: 'esquerda', desfaz: true,
        onPress: () => { const antes = rascunho; tirarDetalhada(h.id); toast({ message: `${h.titulo} saiu do rascunho.`, tone: 'success', action: { label: 'Desfazer', onPress: () => restaurar(antes) } }); } },
    ];
    ```
    Até a Task 7, `aplicarDetalhada` é `() => {}` declarado no componente — a Task 7 o implementa.
  - Confira no simulador em `accessibility-large` (a linha quebra entre palavras; o botão não corta).

- [ ] **Step 4: Run** — teste + gate → verde.

- [ ] **Step 5: Commit**

```bash
git add src/app/finance/forecast.tsx src/lib/simple-finance-ui.test.ts
git commit -m "feat(projecao): adicionar hipótese como lançamento, compra, recorrente ou financiamento"
```

---

### Task 7: Aplicar

**Files:**
- Modify: `src/app/finance/forecast.tsx` (`aplicarDetalhada`, "Aplicar todas", "Aplicar" das rápidas)
- Modify: `src/app/finance/transaction-form.tsx` e `src/app/finance/recurring.tsx` (`?deHipotese=` tira a rápida do rascunho ao salvar)
- Test: `src/lib/simple-finance-ui.test.ts`

**Interfaces:**
- Consumes: `useSaveTransaction`, `useCreateInstallmentPlan`, `useCreateRecurring`, `useSaveDebt` (Task 2); `useRascunho` (Task 3); `confirmDestructive` NÃO — a confirmação de aplicar é `Alert`-like não destrutivo: use `actionSheet` (já usado no app) com uma opção "Salvar na conta".
- Produces: rápida → formulário com `deHipotese=<índice-da-rápida>` e os campos pré-preenchidos por params.

- [ ] **Step 1: Failing tests** (append):

```ts
test('Aplicar a detalhada grava pelo mesmo hook do formulário e só então sai do rascunho', () => {
  const entrada = { accountId: 'c', totalCents: 300000, installments: 10, paidInstallments: 0, occurredAt: '2026-10-01', description: 'Notebook', category: null, merchant: null };
  const ui = screen(forecastFile, { preferencias: { 'projecao:rascunho': JSON.stringify({ versao: 1, rapidas: [], detalhadas: [{ id: 'h1', tipo: 'parcelada', titulo: 'Notebook', entrada }] }) } });
  const card = deslizaveis(ui).find((d: any) => d.props.titulo === 'Notebook');
  ui.interact(() => card.props.acoes.find((a: any) => a.label === 'Aplicar').onPress());
  ui.interact(() => ui.confirmations.at(-1)());
  assert.deepEqual(JSON.parse(JSON.stringify(ui.writes.at(-1))), { operation: 'createInstallmentPlan', value: entrada });
  // sai do rascunho no sucesso (o mock de mutation chama onSuccess em pedidos[].opts)
  ui.interact(() => ui.pedidos.at(-1).opts.onSuccess());
  assert.equal(JSON.parse(ui.preferenciasGravadas['projecao:rascunho'] || '{"detalhadas":[]}').detalhadas.length, 0);
});

test('Aplicar duas vezes seguidas grava uma vez só', () => {
  const entrada = { kind: 'expense', amount_cents: 1000, category: null, description: 'Pão', merchant: null, account_id: 'c', counterparty_account_id: null, occurred_at: '2026-10-01', status: 'cleared', due_at: null, auto_confirm: false };
  const ui = screen(forecastFile, { preferencias: { 'projecao:rascunho': JSON.stringify({ versao: 1, rapidas: [], detalhadas: [{ id: 'h1', tipo: 'lancamento', titulo: 'Pão', entrada }] }) } });
  const aplicar = () => deslizaveis(ui).find((d: any) => d.props.titulo === 'Pão').props.acoes.find((a: any) => a.label === 'Aplicar').onPress();
  ui.interact(aplicar); ui.interact(() => ui.confirmations.at(-1)());
  ui.interact(aplicar); ui.interact(() => ui.confirmations.at(-1)?.());
  assert.equal(ui.writes.filter((w: any) => w.operation === 'save').length, 1);
});

test('Aplicar a rápida abre o formulário real pré-preenchido', () => {
  const ui = screen(forecastFile, { preferencias: { 'projecao:rascunho': JSON.stringify({ versao: 1, rapidas: [{ kind: 'expense', amount_cents: 300000, start: '2026-10-01', installments: 6, mode: 'total' }], detalhadas: [] }) } });
  const card = deslizaveis(ui).find((d: any) => d.props.acoes.some((a: any) => a.label === 'Aplicar'));
  ui.interact(() => card.props.acoes.find((a: any) => a.label === 'Aplicar').onPress());
  assert.deepEqual(JSON.parse(JSON.stringify(ui.navigations.at(-1))), {
    pathname: '/finance/transaction-form',
    params: { deHipotese: '0', kind: 'expense', amount: '300000', data: '01/10/2026', parcelas: '6' },
  });
});
```

  Os nomes `createInstallmentPlan`/`save` são os `mutation('…')` do harness; confira-os no objeto `finance` e ajuste a string, não a lógica.

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement in `forecast.tsx`**
  ```ts
  const salvarLancamento = useSaveTransaction();
  const criarParcelada = useCreateInstallmentPlan();
  const criarRecorrente = useCreateRecurring();
  const salvarFinanciamento = useSaveDebt();
  const [aplicando, setAplicando] = useState<string | null>(null);

  const gravarDetalhada = (h: HipoteseDetalhada, depois: () => void) => {
    const fim = { onSuccess: () => { tirarDetalhada(h.id); setAplicando(null); depois(); },
                  onError: (e: unknown) => { setAplicando(null); toast({ message: financeErrorMessage(e, `Não deu para aplicar ${h.titulo}.`), tone: 'error' }); } };
    if (h.tipo === 'lancamento') salvarLancamento.mutate(h.entrada, fim);
    else if (h.tipo === 'parcelada') criarParcelada.mutate(h.entrada, fim);
    else if (h.tipo === 'recorrente') criarRecorrente.mutate(h.entrada, fim);
    else salvarFinanciamento.mutate(h.entrada, fim);
  };

  const aplicarDetalhada = (h: HipoteseDetalhada) => {
    if (aplicando) return;                                   // toque duplo não grava duas vezes
    actionSheet({ title: `Salvar ${h.titulo} na conta?`, message: resumoDaHipotese(h, brl), options: ['Salvar na conta'] }, () => {
      setAplicando(h.id);
      gravarDetalhada(h, () => toast({ message: `${h.titulo} foi para a conta.`, tone: 'success' }));
    });
  };
  ```
  (`actionSheet` já é usado em `notes/trash.tsx`; importe do mesmo lugar. O teste lê `ui.confirmations` — se o harness registra `actionSheet` noutro array, use o que ele expõe.)

  "Aplicar todas" (botão no fim do card, só com detalhadas): uma confirmação ("Salvar as N hipóteses detalhadas na conta?") e então aplica em SEQUÊNCIA — a próxima só no `depois` da anterior; parar no primeiro erro (a que falhou continua no rascunho com o motivo no toast). As rápidas ficam, e a frase do toast final diz "As N rápidas precisam do formulário para virar lançamento".

  Rápida: acrescente às ações de cada rápida (a lista de hoje, `hipoteses.map`) `{ label: 'Aplicar', icon: 'checkmark.circle', arrasto: 'direita', onPress: () => aplicarRapida(indice, d) }` — exceto grupos de adiantar (`d.grupo`), que não aplicam nesta versão. Com
  ```ts
  const aplicarRapida = (indice: number, d: Draft) => {
    const data = isoToBR(d.start);
    if (d.mode === 'monthly') {
      router.push({ pathname: '/finance/recurring', params: { create: '1', deHipotese: String(indice), kind: d.kind, amount: String(d.amount_cents), start: data } });
      return;
    }
    router.push({ pathname: '/finance/transaction-form', params: { deHipotese: String(indice), kind: d.kind, amount: String(d.amount_cents), data, parcelas: String(d.installments) } });
  };
  ```

- [ ] **Step 4: Forms consume `deHipotese`**
  - `transaction-form.tsx`: aceite `kind`, `amount`, `data`, `parcelas`, `deHipotese` nos params; eles entram nos `defaultValues` (com `parcelas > 1`, a unidade do valor começa em "Total da compra"). No `onSuccess` de `save.mutate` e de `createPlan.mutate`, se `params.deHipotese` existir: `setRapidas((antes) => antes.filter((_, i) => i !== Number(params.deHipotese)))`.
  - `recurring.tsx`: já aceita `kind`/`amount`/`start`; acrescente `deHipotese` e, no `onSuccess` do `create.mutate`, o mesmo `setRapidas(...)`.

- [ ] **Step 5: Run** — testes + gate → verde.

- [ ] **Step 6: Commit**

```bash
git add src/app/finance/forecast.tsx src/app/finance/transaction-form.tsx src/app/finance/recurring.tsx src/lib/simple-finance-ui.test.ts
git commit -m "feat(projecao): aplicar a hipótese salva na conta pelo mesmo caminho do formulário"
```

---

### Task 8: O ciclo com hipóteses detalhadas

**Files:**
- Modify: `src/hooks/use-finance.ts` (novo `useCicloSimulado`)
- Modify: `src/app/finance/forecast.tsx` ("Ver o ciclo" passa `detalhadas` pela rota junto com `rascunho`)
- Modify: `src/app/finance/cycle.tsx`
- Test: `src/lib/simple-finance-ui.test.ts`

**Interfaces:**
- Consumes: `registrosParaSimular` (Task 3); `simular` com leituras `ciclo` e `linhas_do_ciclo` (Task 1).
- Produces:
  ```ts
  export function useCicloSimulado(registros: { tipo: string; dados: unknown }[], month: string, view: CycleView, de?: string, ate?: string):
    UseQueryResult<{ ciclo: CycleRow | null; linhas: CycleLine[]; idsHipotese: Set<string>; erros: ErroDaHipotese[] }>;
  ```

- [ ] **Step 1: Failing test** (append):

```ts
test('Ciclo pela Projeção com hipótese detalhada: lê por simular e marca a linha que veio dela', () => {
  const ui = screen('src/app/finance/cycle.tsx', {
    params: { month: '2026-10', view: 'cycle', detalhadas: JSON.stringify([{ id: 'h1', tipo: 'recorrente', titulo: 'Academia', entrada: { kind: 'expense', amount_cents: 5000, description: 'Academia', merchant: null, category: null, account_id: null, rrule: 'FREQ=WEEKLY;BYDAY=MO', next_run_at: '2026-10-05T12:00:00.000Z', end_date: null, auto_confirm: false } }]) },
    cicloSimulado: {
      ciclo: { mes: '2026-10-01', ini: '2026-09-11', fim: '2026-10-10', estado: 'aberto', comecei_com: 0, entrou: 0, saiu: 5000, resultado: -5000, caixa_no_fim: -5000, faltou_pagar: 0, confere: true },
      linhas: [{ day: '2026-10-05', in_cents: 0, out_cents: 5000, title: 'Academia', origin: 'recurring_projection', ref_id: 'r1', method_label: null, realizado: false, atrasada: false }],
      idsHipotese: new Set(['r1']), erros: [],
    },
  });
  assert.ok(ui.nodes().some((n: any) => n.type === 'SectionHead' && /^Hipóteses do rascunho/.test(n.props.title)));
});
```
  (harness: `useCicloSimulado: (registros: any[]) => registros.length ? { ...query, isPending: false, data: options.cicloSimulado } : { ...query, isPending: true, data: undefined }`, e `cicloSimulado?: any` no tipo de `options`.)

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement**
  - `useCicloSimulado` chama `simular(registros, { ciclo: { de, ate, view }, linhas_do_ciclo: { mes: <primeiro dia do mês>, view } })` (`enabled` com `registros.length > 0 && de && ate`), e devolve `ciclo = leituras.ciclo.find(c => mesmoMes(c.mes, month)) ?? null`, `linhas = leituras.linhas_do_ciclo`, `idsHipotese = new Set(criados.flatMap(c => c.ids))`, `erros`. `gcTime: 0`.
  - `forecast.tsx` ("Ver o ciclo", ~linha 958): acrescente `...(detalhadas.length > 0 ? { detalhadas: JSON.stringify(detalhadas) } : {})` aos params.
  - `cycle.tsx`: `params.detalhadas` → `lerDetalhadas` (mesmo padrão do `lerRascunho` local: inválido vira `[]`) → `registros = registrosParaSimular(...)`. Com `registros.length > 0`:
    - o `ciclo` exibido e as `linhas` vêm de `useCicloSimulado` (as rápidas continuam somando por `draft_lines` + `fechamentoComHipoteses`, sobre esse ciclo);
    - toda linha com `ref_id` em `idsHipotese` vai ao grupo **"Hipóteses do rascunho"**: em `agrupar`, `balde` checa antes `l.origin === 'hipotese' || idsHipotese.has(l.ref_id)` (passe `idsHipotese` como parâmetro de `agrupar`);
    - a linha marcada não abre destino (`destino(l)` devolve `undefined` quando `idsHipotese.has(l.ref_id)`);
    - erros de simulação aparecem num `ThemedText` `danger` sob o painel ("Não deu para simular X: …").
  - Estados de carregamento/erro incluem `useCicloSimulado` quando ativo (mesma troca feita na Task 4).

- [ ] **Step 4: Run** — teste + gate → verde.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/use-finance.ts src/app/finance/forecast.tsx src/app/finance/cycle.tsx src/lib/simple-finance-ui.test.ts
git commit -m "feat(projecao): o ciclo aberto pela Projeção mostra as hipóteses detalhadas como seriam de verdade"
```

---

### Task 9: Medir, conferir no aparelho, documentar

**Files:**
- Modify: `docs/AGENTE-PARIDADE-COM-O-APP.md`, `.claude/rules/finance.md`

- [ ] **Step 1: Medir `simular` no staging** com 10 hipóteses detalhadas (3 compras 10×, 3 recorrentes semanais, 2 financiamentos, 2 lançamentos) e `forecast` de 3650 dias, pela API autenticada como `dev@proops.local` (script Python em `agent/.venv` com o JWT do login de teste, ou `curl` com `Authorization: Bearer`). Anote o tempo (três medições). Critério: abaixo de 2 s. Acima disso, registre o número e avise o Gabriel antes de seguir — não otimize às cegas.

- [ ] **Step 2: Conferir no simulador (iOS) e no emulador (Android)**, logado como `dev@` no staging:
  1. "Adicionar como…" → cada um dos quatro formulários em modo hipótese; "Adicionar à hipótese".
  2. A Projeção muda (curva e mês a mês); a compra no cartão sai no vencimento da fatura.
  3. Fechar e abrir o app: o rascunho continua.
  4. "Ver o ciclo": as hipóteses no grupo próprio.
  5. "Aplicar" uma detalhada: vira real (aparece em Lançamentos/Parceladas/Recorrentes/Dívidas).
  6. "Aplicar" uma rápida: formulário pré-preenchido; salvar tira do rascunho.
  7. Tudo de novo em `accessibility-large` (memória `gap-padrao-e-fonte-grande`).
  Apague depois, por ID anotado, tudo que o teste criou de verdade (memória `limpeza-so-pelo-que-eu-criei`).

- [ ] **Step 3: Documentar**
  - `docs/AGENTE-PARIDADE-COM-O-APP.md`: linha nova "Hipótese detalhada no E se…? e Aplicar — só no app; o agente segue com a hipótese rápida (`simulate_scenario`)".
  - `.claude/rules/finance.md`, em *Rascunho de cenário*: um parágrafo "**Hipótese detalhada** (`simular`, `20260929120000`): cria de verdade, lê e desfaz; a entrada é a do hook (`src/lib/escrita.ts`), então o simulado é o aplicado. O rascunho mora no aparelho (`useRascunho`)."

- [ ] **Step 4: Gate completo e commit**

```bash
npx tsc --noEmit && npx expo lint && npm test
git add docs/AGENTE-PARIDADE-COM-O-APP.md .claude/rules/finance.md
git commit -m "docs(projecao): hipótese detalhada e aplicar, com a paridade do agente"
```

- [ ] **Step 5: Subida (só com o Gabriel)** — migration `20260929120000` em produção pelo Gabriel (`PROOPS_PROD_OK=1 npx supabase db push --project-ref kwriuifcwyvdrxtspjiz`), registro em `HISTORICO-DE-MIGRATIONS.md`, e a versão `1.5.0` (MINOR) quando ele pedir a tag.
