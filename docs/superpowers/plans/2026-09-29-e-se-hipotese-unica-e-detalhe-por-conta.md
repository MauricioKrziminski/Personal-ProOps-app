# "E se…?" — uma hipótese só e o detalhe por conta: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um botão "Nova hipótese" com a folha que pede conta, forma e data; toda hipótese calculada
pelas regras reais (`simular`); "Aplicar" abrindo o formulário completo pré-preenchido; e o
"Onde muda" + a tela "Detalhe da hipótese" por conta e cartão.

**Architecture:** O banco ganha UMA lista de eventos de caixa com a conta
(`private.eventos_de_caixa`), de onde saem a projeção diária e o horizonte por conta; o horizonte
por cartão lê faturas e limite. `simular` ganha as leituras `contas` e `cartoes`. No app, a
hipótese rápida vira `Hipotese` (versão 2 do rascunho), convertida em registro por
`registroDaHipotese` com os construtores de `lib/escrita.ts`; o caminho "detalhado" some.

**Tech Stack:** Expo SDK 57, TanStack Query, Supabase Postgres (plpgsql/sql), `node --test`.

**Spec:** `docs/superpowers/specs/2026-09-29-e-se-hipotese-unica-e-detalhe-por-conta-design.md`
(e o de 28/09, `2026-09-28-hipoteses-detalhadas-e-aplicar-design.md`, para o motor `simular`).

## Global Constraints

- Dinheiro sempre `amount_cents`/`*_cents` inteiro; nunca float; exibição por `formatBRL`/`useBRL`/`<Money>`.
- Função nova em `public`: `revoke execute … from public, anon` + grant a `authenticated`; listar em `supabase/tests/anon_sem_execute.sql`.
- Função nova que use `current_date`: `set timezone to 'America/Sao_Paulo'` NO CABEÇALHO; `create or replace` repete cabeçalho inteiro (`security definer`, `set search_path`, `set timezone`).
- Leitura de fatura usa `private.conta_na_fatura(kind)`, nunca `kind = 'expense'`.
- Migrations só no STAGING (`utkqoiigimqzeenxkxdl`); produção é o Gabriel. Conferir `supabase/.temp/project-ref` antes de `db push`.
- Commits: conventional, 1 linha, SEM `Co-Authored-By`. Sem tag, sem push.
- Tela: régua de `design.md`/`frontend.md` — `Screen`, `TaskHeader`, `Segmented` ≤ 4, `SelectField`/`AccountPicker`, `Calendar` (inline), `MoneyField`, `QuantityField`, nada trunca, `Deslizavel` (direita = ação, esquerda = tirar), esqueleto com a forma final, erro com "Tentar de novo".
- Texto pt-BR, "Hipótese" como título automático do registro simulado.
- Gate antes de cada commit: `npx tsc --noEmit`, `npx expo lint`, `npm test` (código de saída 0).

## Review Focus

1. **Soma das contas ≠ visão geral** (evento sem conta, cartão sem conta de pagamento, transferência entre contas): a leitura por conta + "sem conta" tem que dar, dia a dia, o mesmo saldo de `cash_flow_forecast`. → teste SQL na Task 1.
2. **Projeção diária mudou de número** depois de passar a ler de `eventos_de_caixa`. → Task 1 compara a série do `dev@` no staging antes e depois do `db push` (tem que ser idêntica).
3. **Aplicar tira a hipótese errada** quando a lista mudou com o formulário aberto (índice). → Task 7 prende a retirada por `id`.
4. **Rascunho da versão 1 no aparelho** (rápidas `total`/`monthly`, adiantamentos, `detalhadas`): nada quebra, e o parcelado sem conta aparece incompleto. → Task 3.
5. **Fonte grande na tela nova** (valores lado a lado "antes → depois"): nada corta nem parte. → Task 10 (verificação em a11y-large e 384dp × 1,3) + teste de fonte (`Money` de linha sem `encolhe` quebra para baixo).

---

## File Structure

| arquivo | responsabilidade |
|---|---|
| `supabase/migrations/20260929140000_caixa_por_conta.sql` | `caixa_das_contas`, `cash_total` = soma dela, `eventos_de_caixa`, as duas `cash_flow_forecast` lendo dela |
| `supabase/migrations/20260929150000_horizonte_por_conta.sql` | `contas_no_horizonte`, `cartoes_no_horizonte`, `accounts_horizon`, `cards_horizon`, `simular` com `contas`/`cartoes` |
| `supabase/tests/caixa_por_conta.sql`, `supabase/tests/horizonte_por_conta.sql` | as provas SQL |
| `src/lib/hipotese.ts` (+ `.test.ts`) | tipo `Hipotese`, `registroDaHipotese`, `resumoDaHipotese`, `faltaNaHipotese`, `paramsDoAplicar` |
| `src/lib/rascunho.ts` (+ `.test.ts`) | Rascunho v2 (`hipoteses` + `adiantamentos`), leitura da v1, `motivoDaHipotese` |
| `src/lib/onde-muda.ts` (+ `.test.ts`) | antes × depois → linhas e avisos, por conta e por cartão |
| `src/hooks/use-rascunho.ts` | a API da v2 |
| `src/hooks/use-finance.ts` | `useSimulacao` (com `contas`/`cartoes`), `useHorizonteReal`, `useCicloSimulado` |
| `src/components/finance/campos-da-hipotese.tsx` | os campos da folha (menos Adiantar) |
| `src/components/finance/onde-muda.tsx` | o bloco "Onde muda" |
| `src/app/finance/hipotese.tsx` | a tela "Detalhe da hipótese" |
| `src/app/finance/forecast.tsx` | um botão, a lista, Aplicar/Tirar, o bloco, o caminho detalhado fora |
| `src/app/finance/transaction-form.tsx`, `recurring.tsx`, `debts.tsx` | modo hipótese fora; pré-preenchimento do Aplicar; retirada por id |
| `src/app/finance/cycle.tsx` | hipóteses lidas do aparelho quando `?hipoteses=1` |
| `src/app/_layout.tsx` | a rota `finance/hipotese` |

---

### Task 1: Uma lista de eventos de caixa, com a conta

**Files:**
- Create: `supabase/migrations/20260929140000_caixa_por_conta.sql`
- Create: `supabase/tests/caixa_por_conta.sql`

**Interfaces:**
- Produces: `private.caixa_das_contas(ws_ids uuid[], as_of date) returns table(account_id uuid, cents bigint)`; `private.eventos_de_caixa(ws_ids uuid[], ate date) returns table(account_id uuid, day date, in_cents bigint, out_cents bigint)`.

- [ ] **Step 1: Guardar a série real do `dev@` no staging (o "antes")**

```bash
python3 - <<'EOF' > /tmp/forecast-antes.json
import sys; sys.path.insert(0, '<scratchpad>')  # api.py do scratchpad (login dev@, staging)
from api import *
import json; print(json.dumps(rpc('forecast_json', days=3650, drafts=[])))
EOF
```
Expected: arquivo com ~3651 dias.

- [ ] **Step 2: Escrever o teste SQL (falha: funções não existem)**

`supabase/tests/caixa_por_conta.sql` — mesmo esqueleto de `supabase/tests/simular.sql` (usuário
`...f1b1`, `set local role authenticated`, `begin; … rollback;`), com:
- contas `A` (checking, saldo inicial 100000) e `B` (savings, 0); cartão `C` com
  `payment_account_id = A`, `closing_day 3`, `due_day 10`, `credit_limit_cents 500000`; cartão `D`
  sem `payment_account_id`;
- gasto pendente 5000 em `A` para hoje+5; transferência pendente 20000 de `A` para `B` para hoje+6;
  compra 30000 em `C` (hoje); compra 7000 em `D` (hoje); lançamento 1000 sem conta pendente hoje+2;
  dívida 1200 × 10 com `account_id = B`, `due_day` = dia de hoje+10; recorrente mensal 800 em `A`.

```sql
do $$
declare dif int;
begin
  -- 1. caixa por conta soma o cash_total
  if (select coalesce(sum(cents),0) from private.caixa_das_contas(array(select private.my_workspace_ids()), current_date))
     <> private.cash_total(array(select private.my_workspace_ids()), current_date) then
    raise exception '1. caixa_das_contas não soma o cash_total';
  end if;
  -- 2. dia a dia, saldo inicial + eventos por conta = cash_flow_forecast
  select count(*) into dif from public.cash_flow_forecast(400) f
  where f.balance_cents <> (select sum(cents) from private.caixa_das_contas(array(select private.my_workspace_ids()), current_date))
        + coalesce((select sum(e.in_cents - e.out_cents) from private.eventos_de_caixa(array(select private.my_workspace_ids()), current_date + 400) e where e.day <= f.day), 0);
  if dif > 0 then raise exception '2. % dias divergem da projeção', dif; end if;
  -- 3. a fatura de C sai de A; a de D não tem conta
  if not exists (select 1 from private.eventos_de_caixa(array(select private.my_workspace_ids()), current_date + 400) e
                 where e.account_id = (select id from public.accounts where name = 'A') and e.out_cents = 30000) then
    raise exception '3. a fatura do cartão C deveria sair da conta A';
  end if;
  if not exists (select 1 from private.eventos_de_caixa(array(select private.my_workspace_ids()), current_date + 400) e
                 where e.account_id is null and e.out_cents = 7000) then
    raise exception '3. a fatura do cartão D (sem conta de pagamento) deveria vir sem conta';
  end if;
  -- 4. a transferência A → B soma zero e aparece nos dois lados
  if (select count(*) from private.eventos_de_caixa(array(select private.my_workspace_ids()), current_date + 400) e
      where (e.out_cents = 20000 and e.account_id = (select id from public.accounts where name = 'A'))
         or (e.in_cents = 20000 and e.account_id = (select id from public.accounts where name = 'B'))) <> 2 then
    raise exception '4. a transferência deveria aparecer nos dois lados';
  end if;
  -- 5. a parcela da dívida sai de B
  if not exists (select 1 from private.eventos_de_caixa(array(select private.my_workspace_ids()), current_date + 400) e
                 where e.account_id = (select id from public.accounts where name = 'B') and e.out_cents = 1200) then
    raise exception '5. a parcela da dívida deveria sair de B';
  end if;
  raise notice 'caixa_por_conta: ok';
end $$;
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `docker exec -i supabase_db_app-proops psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/tests/caixa_por_conta.sql`
Expected: ERROR `function private.caixa_das_contas(...) does not exist`.

- [ ] **Step 4: Escrever a migration**

`supabase/migrations/20260929140000_caixa_por_conta.sql`:

```sql
-- O caixa e os eventos da projeção passam a dizer a CONTA (29/09/2026, spec "E se…? — uma
-- hipótese só e o detalhe por conta"). Uma fonte só: `cash_total` é a soma de `caixa_das_contas`,
-- e as duas `cash_flow_forecast` somam `eventos_de_caixa` — a soma das contas É a visão geral.

create or replace function private.caixa_das_contas(ws_ids uuid[], as_of date default null)
returns table (account_id uuid, cents bigint)
language sql stable
set search_path = public
as $$
  select a.id,
         (a.initial_balance_cents + coalesce((
           select sum(case
             when t.kind = 'income'   and t.account_id = a.id then t.amount_cents
             when t.kind = 'expense'  and t.account_id = a.id then -t.amount_cents
             when t.kind = 'transfer' and t.account_id = a.id then -t.amount_cents
             when t.kind = 'transfer' and t.counterparty_account_id = a.id then t.amount_cents
             else 0 end)
           from public.transactions t
           where t.status = 'cleared' and (as_of is null or t.paid_at <= as_of)
             and (t.account_id = a.id or t.counterparty_account_id = a.id)
         ), 0))::bigint
  from public.accounts a
  where a.workspace_id = any(ws_ids) and not a.archived and a.type <> 'credit_card'
  union all
  -- lançamento sem conta (WhatsApp): uma linha "sem conta"
  select null::uuid,
         coalesce(sum(case when t.kind = 'income' then t.amount_cents else -t.amount_cents end), 0)::bigint
  from public.transactions t
  where t.workspace_id = any(ws_ids) and t.status = 'cleared'
    and (as_of is null or t.paid_at <= as_of) and t.account_id is null and t.kind <> 'transfer';
$$;
revoke execute on function private.caixa_das_contas(uuid[], date) from public, anon;
grant execute on function private.caixa_das_contas(uuid[], date) to authenticated, service_role;

create or replace function private.cash_total(ws_ids uuid[], as_of date default null)
returns bigint
language sql stable
set search_path = public
as $$
  select coalesce(sum(cents), 0)::bigint from private.caixa_das_contas(ws_ids, as_of);
$$;

create or replace function private.eventos_de_caixa(ws_ids uuid[], ate date)
returns table (account_id uuid, day date, in_cents bigint, out_cents bigint)
language sql stable
set search_path = public
set timezone to 'America/Sao_Paulo'
as $$
  -- fatura em aberto: sai da conta que paga o cartão, no vencimento (clampado a hoje)
  select c.payment_account_id, greatest(ci.due_date, current_date), 0::bigint, private.invoice_open_cents(ci.id)
  from public.card_invoices ci
  join public.accounts c on c.id = ci.account_id
  where ci.workspace_id = any(ws_ids) and ci.status not in ('paid','rolled')
    and exists (select 1 from public.transactions t where t.invoice_id = ci.id and private.conta_na_fatura(t.kind))
    and greatest(ci.due_date, current_date) <= ate
  union all
  -- lançamento pendente fora de cartão (receita atrasada há mais de 3 dias sai)
  select t.account_id, greatest(coalesce(t.due_at, t.occurred_at), current_date),
         case when t.kind = 'income'  then t.amount_cents else 0 end::bigint,
         case when t.kind = 'expense' then t.amount_cents else 0 end::bigint
  from public.transactions t
  where t.workspace_id = any(ws_ids) and t.status = 'pending' and t.invoice_id is null
    and t.kind <> 'transfer'
    and (t.kind <> 'income' or coalesce(t.due_at, t.occurred_at) >= current_date - 3)
    and greatest(coalesce(t.due_at, t.occurred_at), current_date) <= ate
  union all
  -- transferência pendente entre contas (não cartão): sai de uma, entra na outra (soma zero)
  select t.account_id, greatest(coalesce(t.due_at, t.occurred_at), current_date), 0::bigint, t.amount_cents
  from public.transactions t
  join public.accounts o on o.id = t.account_id and o.type <> 'credit_card'
  join public.accounts d on d.id = t.counterparty_account_id and d.type <> 'credit_card'
  where t.workspace_id = any(ws_ids) and t.status = 'pending' and t.kind = 'transfer'
    and greatest(coalesce(t.due_at, t.occurred_at), current_date) <= ate
  union all
  select t.counterparty_account_id, greatest(coalesce(t.due_at, t.occurred_at), current_date), t.amount_cents, 0::bigint
  from public.transactions t
  join public.accounts o on o.id = t.account_id and o.type <> 'credit_card'
  join public.accounts d on d.id = t.counterparty_account_id and d.type <> 'credit_card'
  where t.workspace_id = any(ws_ids) and t.status = 'pending' and t.kind = 'transfer'
    and greatest(coalesce(t.due_at, t.occurred_at), current_date) <= ate
  union all
  -- parcela de dívida: sai da conta da dívida
  select d.account_id, greatest(s.due_date, current_date), 0::bigint, s.payment_cents
  from public.debts d
  cross join lateral private.debt_schedule_for(d.id) s
  where d.workspace_id = any(ws_ids) and not d.archived and d.remaining_cents > 0 and s.due_date <= ate
  union all
  -- recorrente projetada da regra: na conta da série
  select p.account_id, p.due_date,
         case when p.kind = 'income'  then p.amount_cents else 0 end::bigint,
         case when p.kind = 'expense' then p.amount_cents else 0 end::bigint
  from private.recurring_projection_for(ws_ids, current_date, ate) p;
$$;
revoke execute on function private.eventos_de_caixa(uuid[], date) from public, anon;
grant execute on function private.eventos_de_caixa(uuid[], date) to authenticated, service_role;
```

Mais, no mesmo arquivo, `public.cash_flow_forecast(days)` e `public._cash_flow_forecast(uid,
days)` com o **cabeçalho idêntico** ao da `20260928230000` (linhas 248-364: `language sql stable`,
`security definer` só na `_`, `set search_path TO 'public'`, `set "TimeZone" TO
'America/Sao_Paulo'`) e o CTE `eventos` trocado por:

```sql
  eventos as (
    select e.day, e.in_cents, e.out_cents
    from private.eventos_de_caixa(array(select private.my_workspace_ids()),   -- na `_`: public._workspace_ids(uid)
                                  current_date + (select dias from horizonte)) e
  ),
```

(o resto do corpo — `horizonte`, `saldo_inicial`, `dias`, `agregado`, o `select` final — igual).

- [ ] **Step 5: Aplicar no Postgres local e rodar o teste**

Run: `docker exec -i supabase_db_app-proops psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/migrations/20260929140000_caixa_por_conta.sql && docker exec -i supabase_db_app-proops psql -U postgres -v ON_ERROR_STOP=1 -q < supabase/tests/caixa_por_conta.sql`
Expected: `NOTICE: caixa_por_conta: ok`. Rodar também `simular.sql`, `linha_do_tempo.sql`, `pix_no_credito.sql`, `roll_invoice.sql`, `draft_scenario.sql` (todos verdes).

- [ ] **Step 6: Staging e a prova do "antes = depois"**

Conferir `cat supabase/.temp/project-ref` = `utkqoiigimqzeenxkxdl`; `echo Y | npx supabase db push`.
Repetir o Step 1 para `/tmp/forecast-depois.json` e `diff /tmp/forecast-antes.json /tmp/forecast-depois.json`.
Expected: sem diferença.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260929140000_caixa_por_conta.sql supabase/tests/caixa_por_conta.sql
git commit -m "feat(projecao): caixa e eventos da projeção por conta, numa fonte só"
```

---

### Task 2: Horizonte por conta e por cartão, antes e na simulação

**Files:**
- Create: `supabase/migrations/20260929150000_horizonte_por_conta.sql`
- Create: `supabase/tests/horizonte_por_conta.sql`
- Modify: `supabase/tests/anon_sem_execute.sql` (lista), `src/lib/database.types.ts` (as duas RPCs), `docs/HISTORICO-DE-MIGRATIONS.md`

**Interfaces:**
- Consumes: `private.caixa_das_contas`, `private.eventos_de_caixa` (Task 1).
- Produces: `public.accounts_horizon(days int) → jsonb` = `[{account_id, nome, tipo, saldo_hoje, menor, dia_do_menor, saldo_fim, negativa_em}]`;
  `public.cards_horizon(days int) → jsonb` = `[{account_id, nome, limite, livre, faturas: [{invoice_id, vencimento, total, aberto}]}]`;
  `simular` aceita leituras `contas: {days}` e `cartoes: {days}` (mesmo formato).

- [ ] **Step 1: Teste SQL (falha)** — `supabase/tests/horizonte_por_conta.sql`, fixture como a da Task 1 (sem a dívida) e:

```sql
do $$
declare c jsonb; k jsonb; s jsonb; conta uuid; cartao uuid; hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  conta := (select id from public.accounts where name = 'A');
  cartao := (select id from public.accounts where name = 'C');
  c := public.accounts_horizon(90);
  -- 1. saldo_fim por conta bate com a projeção somada
  if (select sum((x->>'saldo_fim')::bigint) from jsonb_array_elements(c) x)
     <> (select balance_cents from public.cash_flow_forecast(90) order by day desc limit 1) then
    raise exception '1. a soma dos saldos no fim difere da projeção';
  end if;
  -- 2. fica negativa: um gasto maior que o saldo da conta A
  s := public.simular(jsonb_build_array(jsonb_build_object('tipo','lancamento','dados',jsonb_build_object('linhas',jsonb_build_array(
         jsonb_build_object('kind','expense','amount_cents',500000,'description','Hipótese','account_id',conta,'occurred_at',hoje + 10,'status','pending','source','app'))))),
       jsonb_build_object('contas', jsonb_build_object('days', 90)));
  if (select x->>'negativa_em' from jsonb_array_elements(s->'leituras'->'contas') x where x->>'account_id' = conta::text) is null then
    raise exception '2. a conta A deveria ficar negativa';
  end if;
  -- 3. cartão: a compra entra na fatura e baixa o limite livre
  k := public.cards_horizon(90);
  s := public.simular(jsonb_build_array(jsonb_build_object('tipo','lancamento','dados',jsonb_build_object('linhas',jsonb_build_array(
         jsonb_build_object('kind','expense','amount_cents',60000,'description','Hipótese','account_id',cartao,'occurred_at',hoje,'status','pending','source','app'))))),
       jsonb_build_object('cartoes', jsonb_build_object('days', 90)));
  if ((select (x->>'livre')::bigint from jsonb_array_elements(k) x where x->>'account_id' = cartao::text)
      - (select (x->>'livre')::bigint from jsonb_array_elements(s->'leituras'->'cartoes') x where x->>'account_id' = cartao::text)) <> 60000 then
    raise exception '3. o limite livre deveria cair 600,00';
  end if;
  -- 4. cartão sem limite: limite e livre nulos
  if (select x->'limite' from jsonb_array_elements(k) x where x->>'nome' = 'D') <> 'null'::jsonb
     or (select x->'livre' from jsonb_array_elements(k) x where x->>'nome' = 'D') <> 'null'::jsonb then
    raise exception '4. cartão sem limite deveria vir com limite e livre nulos';
  end if;
  -- 5. livre = o do card_summary quando há limite
  if (select (x->>'livre')::bigint from jsonb_array_elements(k) x where x->>'account_id' = cartao::text)
     <> (select available_limit_cents from public.card_summary() where account_id = cartao) then
    raise exception '5. livre difere do card_summary';
  end if;
  -- 6. banco intacto depois do simular
  if exists (select 1 from public.transactions where description = 'Hipótese') then raise exception '6. sobrou registro'; end if;
  raise notice 'horizonte_por_conta: ok';
end $$;
```

- [ ] **Step 2: Ver falhar** — `docker exec -i supabase_db_app-proops psql … < supabase/tests/horizonte_por_conta.sql` → `function public.accounts_horizon(integer) does not exist`.

- [ ] **Step 3: Migration** — `20260929150000_horizonte_por_conta.sql`:

```sql
create or replace function private.contas_no_horizonte(ws_ids uuid[], fim date)
returns jsonb
language sql stable
set search_path = public
set timezone to 'America/Sao_Paulo'
as $$
  with base as (select account_id, cents from private.caixa_das_contas(ws_ids, current_date)),
  ev as (select account_id, day, sum(in_cents - out_cents)::bigint as delta
         from private.eventos_de_caixa(ws_ids, fim) group by 1, 2),
  contas as (select account_id from base union select account_id from ev),
  dias as (select generate_series(current_date, fim, interval '1 day')::date as day),
  serie as (
    select k.account_id, d.day,
           (coalesce((select b.cents from base b where b.account_id is not distinct from k.account_id), 0)
            + sum(coalesce(e.delta, 0)) over (partition by k.account_id order by d.day))::bigint as saldo
    from contas k cross join dias d
    left join ev e on e.account_id is not distinct from k.account_id and e.day = d.day
  ),
  resumo as (
    select account_id,
           (array_agg(saldo order by day))[1] as saldo_hoje,
           min(saldo) as menor,
           (array_agg(day order by saldo, day))[1] as dia_do_menor,
           (array_agg(saldo order by day desc))[1] as saldo_fim,
           min(day) filter (where saldo < 0) as negativa_em
    from serie group by account_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'account_id', r.account_id, 'nome', coalesce(a.name, 'Sem conta'), 'tipo', a.type,
           'saldo_hoje', r.saldo_hoje, 'menor', r.menor, 'dia_do_menor', r.dia_do_menor,
           'saldo_fim', r.saldo_fim, 'negativa_em', r.negativa_em) order by a.name nulls last), '[]'::jsonb)
  from resumo r left join public.accounts a on a.id = r.account_id;
$$;

create or replace function private.cartoes_no_horizonte(ws_ids uuid[], fim date)
returns jsonb
language sql stable
set search_path = public
set timezone to 'America/Sao_Paulo'
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'account_id', a.id, 'nome', a.name, 'limite', a.credit_limit_cents,
    -- a mesma conta do `card_summary`: limite − o que falta pagar das faturas não pagas
    'livre', case when a.credit_limit_cents is null then null else a.credit_limit_cents - coalesce((
               select sum(private.invoice_open_cents(ci.id)) from public.card_invoices ci
               where ci.account_id = a.id and ci.status not in ('paid','rolled')), 0) end,
    'faturas', (select coalesce(jsonb_agg(jsonb_build_object(
                  'invoice_id', ci.id, 'vencimento', ci.due_date,
                  'total', (select coalesce(sum(t.amount_cents), 0) from public.transactions t
                            where t.invoice_id = ci.id and private.conta_na_fatura(t.kind)),
                  'aberto', private.invoice_open_cents(ci.id)) order by ci.due_date), '[]'::jsonb)
                from public.card_invoices ci
                where ci.account_id = a.id and ci.status not in ('paid','rolled') and ci.due_date <= fim)
  ) order by a.name), '[]'::jsonb)
  from public.accounts a
  where a.workspace_id = any(ws_ids) and a.type = 'credit_card' and not a.archived;
$$;
revoke execute on function private.contas_no_horizonte(uuid[], date) from public, anon;
revoke execute on function private.cartoes_no_horizonte(uuid[], date) from public, anon;
grant execute on function private.contas_no_horizonte(uuid[], date) to authenticated, service_role;
grant execute on function private.cartoes_no_horizonte(uuid[], date) to authenticated, service_role;

create or replace function public.accounts_horizon(days int default 90)
returns jsonb language sql stable security invoker
set search_path = public set timezone to 'America/Sao_Paulo'
as $$ select private.contas_no_horizonte(array(select private.my_workspace_ids()), current_date + private.clamp_forecast_days(days)); $$;
create or replace function public.cards_horizon(days int default 90)
returns jsonb language sql stable security invoker
set search_path = public set timezone to 'America/Sao_Paulo'
as $$ select private.cartoes_no_horizonte(array(select private.my_workspace_ids()), current_date + private.clamp_forecast_days(days)); $$;
revoke execute on function public.accounts_horizon(int) from public, anon;
revoke execute on function public.cards_horizon(int) from public, anon;
grant execute on function public.accounts_horizon(int) to authenticated;
grant execute on function public.cards_horizon(int) to authenticated;
```

E `public.simular` recriada (cópia da `20260929130000`, cabeçalho inteiro, `'codigo', sqlstate`
em cada erro) com duas leituras novas antes do `raise … PSIM1`:

```sql
    l := p_leituras->'contas';
    if l is not null then
      begin
        leituras := leituras || jsonb_build_object('contas', public.accounts_horizon((l->>'days')::int));
      exception when others then
        erros := erros || jsonb_build_object('leitura', 'contas', 'mensagem', sqlerrm, 'codigo', sqlstate);
      end;
    end if;
    l := p_leituras->'cartoes';
    if l is not null then
      begin
        leituras := leituras || jsonb_build_object('cartoes', public.cards_horizon((l->>'days')::int));
      exception when others then
        erros := erros || jsonb_build_object('leitura', 'cartoes', 'mensagem', sqlerrm, 'codigo', sqlstate);
      end;
    end if;
```

- [ ] **Step 4: Local, testes** — aplicar e rodar `horizonte_por_conta.sql`, `simular.sql`, `anon_sem_execute.sql` (com `accounts_horizon` e `cards_horizon` somados à lista). Expected: todos ok.

- [ ] **Step 5: Staging** (`project-ref` conferido) + `database.types.ts` (as duas funções: `Args: { days?: number }`, `Returns: Json`) + linha no `HISTORICO-DE-MIGRATIONS.md` ("Só no STAGING: 20260929140000 e 20260929150000 …; sobem juntas, antes do app").

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260929150000_horizonte_por_conta.sql supabase/tests/horizonte_por_conta.sql supabase/tests/anon_sem_execute.sql src/lib/database.types.ts docs/HISTORICO-DE-MIGRATIONS.md
git commit -m "feat(projecao): horizonte por conta e por cartão, antes e na simulação"
```

---

### Task 3: A hipótese rápida com conta, forma e data (rascunho v2)

**Files:**
- Create: `src/lib/hipotese.ts`, `src/lib/hipotese.test.ts`
- Modify: `src/lib/rascunho.ts`, `src/lib/rascunho.test.ts`

**Interfaces:**
- Produces (`src/lib/hipotese.ts`):
  ```ts
  export type Forma = 'uma' | 'parcelado' | 'repete' | 'financiamento';
  export type Repete = 'weekly' | 'monthly' | 'yearly';
  export type Hipotese = { id: string; kind: 'income' | 'expense'; forma: Forma; valor_cents: number; parcelas: number; repete: Repete; conta: string | null; data: string };
  export type RegistroSimulado = { tipo: 'lancamento' | 'parcelada' | 'recorrente' | 'financiamento'; dados: Record<string, unknown> };
  export function faltaNaHipotese(h: Hipotese): string | null;   // frase do que falta, ou null
  export function registroDaHipotese(h: Hipotese): RegistroSimulado | null;  // null = incompleta
  export function resumoDaHipotese(h: Hipotese, brl: (c: number) => string, nomeDaConta: (id: string) => string | null): string;
  export function paramsDoAplicar(h: Hipotese): { pathname: '/finance/transaction-form' | '/finance/recurring' | '/finance/debts'; params: Record<string, string> };
  export function novaHipotese(hoje: string): Hipotese;
  ```
- Produces (`src/lib/rascunho.ts`): `type Rascunho = { versao: 2; hipoteses: Hipotese[]; adiantamentos: Draft[] }`, `RASCUNHO_VAZIO`, `lerRascunho(texto)` (lê v1 e v2), `gravarRascunho(r)`, `motivoDaHipotese` (fica).

- [ ] **Step 1: Testes (falham)** — `src/lib/hipotese.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { faltaNaHipotese, paramsDoAplicar, registroDaHipotese, resumoDaHipotese, type Hipotese } from './hipotese.ts';

const base: Hipotese = { id: 'h1', kind: 'expense', forma: 'uma', valor_cents: 10000, parcelas: 2, repete: 'monthly', conta: 'c1', data: '2026-10-05' };
const brl = (c: number) => `R$ ${(c / 100).toFixed(2)}`;
const nome = (id: string) => ({ c1: 'Nubank Cartão', c2: 'Itaú' } as Record<string, string>)[id] ?? null;

test('uma vez vira lançamento pendente com o título Hipótese', () => {
  const r = registroDaHipotese(base)!;
  assert.equal(r.tipo, 'lancamento');
  assert.deepEqual((r.dados.linhas as any[])[0], { kind: 'expense', amount_cents: 10000, category: null, description: 'Hipótese', merchant: null, account_id: 'c1', counterparty_account_id: null, occurred_at: '2026-10-05', status: 'pending', due_at: null, auto_confirm: false, source: 'app' });
});

test('parcelado vira a compra parcelada com 0 pagas; sem conta é incompleto', () => {
  const r = registroDaHipotese({ ...base, forma: 'parcelado', valor_cents: 300000, parcelas: 10 })!;
  assert.equal(r.tipo, 'parcelada');
  assert.equal(r.dados.p_total_cents, 300000);
  assert.equal(r.dados.p_installments, 10);
  assert.equal(r.dados.p_paid_installments, 0);
  assert.equal(r.dados.ultimo_dia, false);
  assert.equal(registroDaHipotese({ ...base, forma: 'parcelado', conta: null }), null);
  assert.equal(faltaNaHipotese({ ...base, forma: 'parcelado', conta: null }), 'Escolha a conta ou o cartão');
});

test('repete vira recorrente com a regra do app', () => {
  assert.equal(registroDaHipotese({ ...base, forma: 'repete', repete: 'weekly' })!.dados.rrule, 'FREQ=WEEKLY;BYDAY=MO');
  assert.equal(registroDaHipotese({ ...base, forma: 'repete', repete: 'monthly' })!.dados.rrule, 'FREQ=MONTHLY;BYMONTHDAY=5');
  assert.equal(registroDaHipotese({ ...base, forma: 'repete', repete: 'yearly' })!.dados.rrule, 'FREQ=YEARLY;BYMONTH=10;BYMONTHDAY=5');
});

test('financiamento: parcela fixa, âncora na data, dia da data', () => {
  const r = registroDaHipotese({ ...base, forma: 'financiamento', valor_cents: 147000, parcelas: 48, conta: 'c2', data: '2026-10-31' })!;
  assert.equal(r.tipo, 'financiamento');
  assert.equal(r.dados.calculation_mode, 'fixed_installments');
  assert.equal(r.dados.installment_cents, 147000);
  assert.equal(r.dados.remaining_cents, 147000 * 48);
  assert.equal(r.dados.first_due_date, '2026-10-31');
  assert.equal(r.dados.due_day, 31);
});

test('o que falta: valor, conta no parcelado e no financiamento, data no passado', () => {
  assert.equal(faltaNaHipotese({ ...base, valor_cents: 0 }), 'Digite o valor');
  assert.equal(faltaNaHipotese({ ...base, forma: 'financiamento', conta: null }), 'Escolha a conta que paga');
  assert.equal(faltaNaHipotese({ ...base, forma: 'parcelado', parcelas: 1 }), 'Parcelado precisa de 2 parcelas ou mais');
  assert.equal(faltaNaHipotese(base), null);
});

test('a linha diz forma, conta e data', () => {
  assert.equal(resumoDaHipotese({ ...base, forma: 'parcelado', valor_cents: 300000, parcelas: 10 }, brl, nome), 'Sai R$ 3000.00 em 10× · Nubank Cartão · a partir de 05/10/2026');
  assert.equal(resumoDaHipotese({ ...base, kind: 'income', forma: 'repete', repete: 'monthly', conta: null }, brl, nome), 'Entra R$ 100.00 todo mês · sem conta (só a visão geral) · a partir de 05/10/2026');
  assert.equal(resumoDaHipotese({ ...base, forma: 'financiamento', parcelas: 48, conta: 'c2' }, brl, nome), 'Financiamento de 48× R$ 100.00 · Itaú · 1ª em 05/10/2026');
});

test('aplicar abre o formulário certo, com tudo', () => {
  assert.deepEqual(paramsDoAplicar(base), { pathname: '/finance/transaction-form', params: { deHipotese: 'h1', kind: 'expense', amount: '10000', data: '05/10/2026', parcelas: '1', conta: 'c1' } });
  assert.deepEqual(paramsDoAplicar({ ...base, forma: 'parcelado', parcelas: 10 }).params.parcelas, '10');
  assert.deepEqual(paramsDoAplicar({ ...base, forma: 'repete', repete: 'weekly' }), { pathname: '/finance/recurring', params: { create: '1', deHipotese: 'h1', kind: 'expense', amount: '10000', start: '05/10/2026', account: 'c1', repete: 'weekly' } });
  assert.deepEqual(paramsDoAplicar({ ...base, forma: 'financiamento', parcelas: 48 }), { pathname: '/finance/debts', params: { create: 'financing', deHipotese: 'h1', parcela: '10000', parcelas: '48', conta: 'c1', data: '05/10/2026' } });
});
```

E em `src/lib/rascunho.test.ts` (trocando os testes das detalhadas):

```ts
test('rascunho da versão 1 vira a versão 2', () => {
  const v1 = JSON.stringify({ versao: 1, detalhadas: [{ id: 'x', tipo: 'lancamento', titulo: 'X', entrada: {} }], rapidas: [
    { kind: 'income', amount_cents: 500, start: '2026-10-01', installments: 1, mode: 'monthly', grupo: 'g1' },
    { kind: 'expense', amount_cents: 900, start: '2026-10-02', installments: 3, mode: 'total', grupo: 'g2' },
    { kind: 'expense', amount_cents: 100, start: '2026-10-03', installments: 1, mode: 'total', grupo: 'g3' },
    { kind: 'expense', amount_cents: 700, start: '2026-11-01', installments: 1, mode: 'total', grupo: 'g4', rotulo: 'adianta a tv' },
    { kind: 'expense', amount_cents: -300, start: '2026-12-10', installments: 1, mode: 'cancel', grupo: 'g4' },
  ] });
  const r = lerRascunho(v1);
  assert.equal(r.versao, 2);
  assert.deepEqual(r.hipoteses.map((h) => [h.id, h.forma, h.kind, h.valor_cents, h.parcelas, h.conta, h.data]), [
    ['g1', 'repete', 'income', 500, 1, null, '2026-10-01'],
    ['g2', 'parcelado', 'expense', 900, 3, null, '2026-10-02'],
    ['g3', 'uma', 'expense', 100, 1, null, '2026-10-03'],
  ]);
  assert.equal(r.adiantamentos.length, 2);
});

test('versão 2 volta como foi gravada; estragada vira vazia', () => {
  const r = { versao: 2 as const, hipoteses: [{ id: 'h1', kind: 'expense' as const, forma: 'uma' as const, valor_cents: 1, parcelas: 1, repete: 'monthly' as const, conta: null, data: '2026-10-01' }], adiantamentos: [] };
  assert.deepEqual(lerRascunho(gravarRascunho(r)), r);
  assert.deepEqual(lerRascunho('{"versao":2,"hipoteses":[null,{"id":1}],"adiantamentos":"x"}'), RASCUNHO_VAZIO);
  assert.deepEqual(lerRascunho('não é json'), RASCUNHO_VAZIO);
});
```

- [ ] **Step 2: Rodar e ver falhar** — `node --test src/lib/hipotese.test.ts src/lib/rascunho.test.ts` → FAIL (módulo `./hipotese.ts` não existe).

- [ ] **Step 3: Implementar `src/lib/hipotese.ts`**

```ts
import { formatBRL } from './dates.ts';
import { isoToBR } from './dates.ts';
import { argsDaParcelada, linhaDaRecorrente, linhaDoFinanciamento, linhasDoLancamento } from './escrita.ts';
import { montaRRule } from './serie.ts';

export type Forma = 'uma' | 'parcelado' | 'repete' | 'financiamento';
export type Repete = 'weekly' | 'monthly' | 'yearly';
/**
 * A hipótese do "E se…?" (spec 29/09/2026): rápida de fazer, mas com o que o detalhe por conta
 * precisa para estar CERTO — a conta (a fatura sai do cartão, a parcela da conta que paga), a
 * forma e o DIA (o dia decide a fatura). Vira registro de verdade na simulação.
 */
export type Hipotese = { id: string; kind: 'income' | 'expense'; forma: Forma; valor_cents: number; parcelas: number; repete: Repete; conta: string | null; data: string };
export type RegistroSimulado = { tipo: 'lancamento' | 'parcelada' | 'recorrente' | 'financiamento'; dados: Record<string, unknown> };

const TITULO = 'Hipótese';

export function novaHipotese(hoje: string): Hipotese {
  return { id: `h${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, kind: 'expense', forma: 'uma', valor_cents: 0, parcelas: 2, repete: 'monthly', conta: null, data: hoje };
}

export function faltaNaHipotese(h: Hipotese): string | null {
  if (!(h.valor_cents > 0)) return 'Digite o valor';
  if (h.forma === 'parcelado' && !h.conta) return 'Escolha a conta ou o cartão';
  if (h.forma === 'financiamento' && !h.conta) return 'Escolha a conta que paga';
  if (h.forma === 'parcelado' && h.parcelas < 2) return 'Parcelado precisa de 2 parcelas ou mais';
  if (h.forma === 'financiamento' && h.parcelas < 1) return 'Diga quantas parcelas';
  return null;
}

export function registroDaHipotese(h: Hipotese): RegistroSimulado | null {
  if (faltaNaHipotese(h)) return null;
  switch (h.forma) {
    case 'uma':
      return { tipo: 'lancamento', dados: { linhas: linhasDoLancamento({ kind: h.kind, amount_cents: h.valor_cents, category: null, description: TITULO, merchant: null, account_id: h.conta, counterparty_account_id: null, occurred_at: h.data, status: 'pending', due_at: null, auto_confirm: false } as never) } };
    case 'parcelado': {
      const { rpc, args } = argsDaParcelada({ accountId: h.conta!, totalCents: h.valor_cents, installments: h.parcelas, paidInstallments: 0, occurredAt: h.data, description: TITULO, category: null, merchant: null });
      return { tipo: 'parcelada', dados: { ...args, ultimo_dia: rpc === 'create_installment_plan_last_day' } };
    }
    case 'repete': {
      const [y, m, d] = h.data.split('-').map(Number);
      return { tipo: 'recorrente', dados: linhaDaRecorrente({ kind: h.kind, amount_cents: h.valor_cents, description: TITULO, merchant: null, category: null, account_id: h.conta, rrule: montaRRule(h.repete, new Date(y, m - 1, d), 1), next_run_at: `${h.data}T12:00:00.000Z`, end_date: null, auto_confirm: false }) };
    }
    case 'financiamento':
      return { tipo: 'financiamento', dados: linhaDoFinanciamento({ name: TITULO, kind: 'financing', calculation_mode: 'fixed_installments', principal_cents: h.valor_cents * h.parcelas, remaining_cents: h.valor_cents * h.parcelas, interest_rate_monthly: 0, installments: h.parcelas, installments_paid: 0, installment_cents: h.valor_cents, account_id: h.conta, due_day: Number(h.data.slice(8, 10)), first_due_date: h.data }) };
  }
}

const REPETE = { weekly: 'toda semana', monthly: 'todo mês', yearly: 'todo ano' } as const;

export function resumoDaHipotese(h: Hipotese, brl: (c: number) => string, nomeDaConta: (id: string) => string | null): string {
  const onde = h.conta ? (nomeDaConta(h.conta) ?? 'conta que não existe mais') : 'sem conta (só a visão geral)';
  const quando = isoToBR(h.data);
  if (h.forma === 'financiamento') return `Financiamento de ${h.parcelas}× ${brl(h.valor_cents)} · ${onde} · 1ª em ${quando}`;
  const lado = h.kind === 'income' ? 'Entra' : 'Sai';
  const como = h.forma === 'parcelado' ? ` em ${h.parcelas}×` : h.forma === 'repete' ? ` ${REPETE[h.repete]}` : '';
  return `${lado} ${brl(h.valor_cents)}${como} · ${onde} · ${h.forma === 'uma' ? 'em' : 'a partir de'} ${quando}`;
}

export function paramsDoAplicar(h: Hipotese) {
  const data = isoToBR(h.data);
  const conta = h.conta ? { conta: h.conta } : {};
  if (h.forma === 'repete') return { pathname: '/finance/recurring' as const, params: { create: '1', deHipotese: h.id, kind: h.kind, amount: String(h.valor_cents), start: data, ...(h.conta ? { account: h.conta } : {}), repete: h.repete } };
  if (h.forma === 'financiamento') return { pathname: '/finance/debts' as const, params: { create: 'financing', deHipotese: h.id, parcela: String(h.valor_cents), parcelas: String(h.parcelas), ...conta, data } };
  return { pathname: '/finance/transaction-form' as const, params: { deHipotese: h.id, kind: h.kind, amount: String(h.valor_cents), data, parcelas: String(h.forma === 'parcelado' ? h.parcelas : 1), ...conta } };
}
```

(`formatBRL` só entra se o resumo precisar; retirar o import se não usado — a lint diz.)

- [ ] **Step 4: `src/lib/rascunho.ts` v2** — substituir o tipo e a leitura:

```ts
import type { Draft } from '@/hooks/use-finance';
import { financeErrorMessage } from './finance-form.ts';
import type { Hipotese } from './hipotese.ts';

/** O rascunho do "E se…?" no aparelho: hipóteses (viram registro na simulação) e adiantamentos. */
export type Rascunho = { versao: 2; hipoteses: Hipotese[]; adiantamentos: Draft[] };
export const RASCUNHO_VAZIO: Rascunho = { versao: 2, hipoteses: [], adiantamentos: [] };

const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const FORMAS = new Set(['uma', 'parcelado', 'repete', 'financiamento']);

function hipoteseValida(h: unknown): h is Hipotese {
  return ehObjeto(h) && typeof h.id === 'string' && (h.kind === 'income' || h.kind === 'expense') && FORMAS.has(h.forma as string)
    && typeof h.valor_cents === 'number' && typeof h.parcelas === 'number' && typeof h.data === 'string';
}
function draftValido(d: unknown): d is Draft {
  return ehObjeto(d) && (d.kind === 'income' || d.kind === 'expense') && typeof d.amount_cents === 'number' && typeof d.start === 'string';
}
/** A rápida da v1 (valor + mês), agora com forma; sem conta — parcelada sem conta fica incompleta. */
function daVersao1(d: Draft): Hipotese {
  const forma = d.mode === 'monthly' ? 'repete' : d.installments > 1 ? 'parcelado' : 'uma';
  return { id: d.grupo ?? `v1${d.start}${d.amount_cents}`, kind: d.kind, forma, valor_cents: d.amount_cents, parcelas: forma === 'parcelado' ? d.installments : 1, repete: 'monthly', conta: null, data: d.start };
}

export function lerRascunho(texto: string): Rascunho {
  if (!texto) return RASCUNHO_VAZIO;
  try {
    const r = JSON.parse(texto) as Record<string, unknown>;
    if (r?.versao === 2 && Array.isArray(r.hipoteses) && Array.isArray(r.adiantamentos)) {
      return { versao: 2, hipoteses: r.hipoteses.filter(hipoteseValida), adiantamentos: r.adiantamentos.filter(draftValido) };
    }
    if (r?.versao === 1 && Array.isArray(r.rapidas)) {
      const rapidas = r.rapidas.filter(draftValido);
      return { versao: 2, hipoteses: rapidas.filter((d) => !d.grupo || (!d.rotulo && d.mode !== 'cancel' && !rapidas.some((o) => o.grupo === d.grupo && o.rotulo))).map(daVersao1),
               adiantamentos: rapidas.filter((d) => d.grupo && (d.rotulo || d.mode === 'cancel' || rapidas.some((o) => o.grupo === d.grupo && o.rotulo))) };
    }
    return RASCUNHO_VAZIO;
  } catch {
    return RASCUNHO_VAZIO;
  }
}

export function gravarRascunho(r: Rascunho): string {
  return r.hipoteses.length === 0 && r.adiantamentos.length === 0 ? '' : JSON.stringify(r);
}
```

`motivoDaHipotese` fica como está. Saem: `HipoteseDetalhada`, `TipoDetalhado`, `detalhadasValidas`, `registrosParaSimular`, `resumoDaHipotese` antigo, `frequencia`, `hipoteseDoLancamento`, e os imports de `escrita.ts` que só eles usavam.
O teste do envelope estragado da v2: a entrada `'{"versao":2,"hipoteses":[null,{"id":1}],"adiantamentos":"x"}'` tem `adiantamentos` não-array → cai em `RASCUNHO_VAZIO`.

- [ ] **Step 5: Rodar e ver passar** — `node --test src/lib/hipotese.test.ts src/lib/rascunho.test.ts` → PASS. (`npx tsc --noEmit` vai acusar os consumidores das funções removidas; eles mudam nas Tasks 5–9 — commitar esta task junto da Task 5.)

---

### Task 4: "Onde muda" — antes × depois, como regra pura

**Files:**
- Create: `src/lib/onde-muda.ts`, `src/lib/onde-muda.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ContaNoHorizonte = { account_id: string | null; nome: string; tipo: string | null; saldo_hoje: number; menor: number; dia_do_menor: string; saldo_fim: number; negativa_em: string | null };
  export type FaturaNoHorizonte = { invoice_id: string; vencimento: string; total: number; aberto: number };
  export type CartaoNoHorizonte = { account_id: string; nome: string; limite: number | null; livre: number | null; faturas: FaturaNoHorizonte[] };
  export type MudancaNaConta = { tipo: 'conta'; account_id: string; nome: string; antes: ContaNoHorizonte | null; depois: ContaNoHorizonte; ficaNegativaEm: string | null };
  export type MudancaNoCartao = { tipo: 'cartao'; account_id: string; nome: string; semLimite: boolean; livreAntes: number | null; livreDepois: number | null; passaDoLimiteEm: number | null; faturas: { vencimento: string; antes: number; depois: number }[] };
  export function ondeMuda(antes: { contas: ContaNoHorizonte[]; cartoes: CartaoNoHorizonte[] }, depois: { contas: ContaNoHorizonte[]; cartoes: CartaoNoHorizonte[] }): (MudancaNaConta | MudancaNoCartao)[];
  ```

- [ ] **Step 1: Testes (falham)**

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ondeMuda, type CartaoNoHorizonte, type ContaNoHorizonte } from './onde-muda.ts';

const conta = (id: string | null, fim: number, neg: string | null = null, tipo: string | null = 'checking'): ContaNoHorizonte =>
  ({ account_id: id, nome: id ?? 'Sem conta', tipo, saldo_hoje: 1000, menor: Math.min(1000, fim), dia_do_menor: '2026-10-10', saldo_fim: fim, negativa_em: neg });
const cartao = (id: string, limite: number | null, livre: number | null, faturas: [string, number][]): CartaoNoHorizonte =>
  ({ account_id: id, nome: id, limite, livre, faturas: faturas.map(([v, t]) => ({ invoice_id: v, vencimento: v, total: t, aberto: t })) });

test('conta que muda aparece; conta igual e "sem conta" não', () => {
  const r = ondeMuda({ contas: [conta('a', 500), conta('b', 900), conta(null, 0)], cartoes: [] },
                     { contas: [conta('a', 300), conta('b', 900), conta(null, -100)], cartoes: [] });
  assert.deepEqual(r.map((m) => m.account_id), ['a']);
});

test('fica negativa: quando passa a ficar, ou fica MAIS CEDO', () => {
  const [a] = ondeMuda({ contas: [conta('a', 500)], cartoes: [] }, { contas: [conta('a', -100, '2026-11-02')], cartoes: [] }) as any;
  assert.equal(a.ficaNegativaEm, '2026-11-02');
  const [b] = ondeMuda({ contas: [conta('a', -50, '2026-12-01')], cartoes: [] }, { contas: [conta('a', -100, '2026-11-02')], cartoes: [] }) as any;
  assert.equal(b.ficaNegativaEm, '2026-11-02');
  const [c] = ondeMuda({ contas: [conta('a', -50, '2026-11-01')], cartoes: [] }, { contas: [conta('a', -100, '2026-11-01')], cartoes: [] }) as any;
  assert.equal(c.ficaNegativaEm, null, 'já ficava negativa no mesmo dia: não é aviso novo');
});

test('cartão: faturas antes → depois pelo vencimento, fatura nova conta do zero', () => {
  const [m] = ondeMuda({ contas: [], cartoes: [cartao('nu', 500000, 200000, [['2026-10-10', 135000]])] },
                       { contas: [], cartoes: [cartao('nu', 500000, 170000, [['2026-10-10', 165000], ['2026-11-10', 30000]])] }) as any;
  assert.deepEqual(m.faturas, [{ vencimento: '2026-10-10', antes: 135000, depois: 165000 }, { vencimento: '2026-11-10', antes: 0, depois: 30000 }]);
  assert.equal(m.livreAntes, 200000);
  assert.equal(m.livreDepois, 170000);
  assert.equal(m.passaDoLimiteEm, null);
});

test('passa do limite: quanto; sem limite: nunca "passa", diz que não tem', () => {
  const [p] = ondeMuda({ contas: [], cartoes: [cartao('nu', 100000, 20000, [])] }, { contas: [], cartoes: [cartao('nu', 100000, -30000, [['2026-10-10', 130000]])] }) as any;
  assert.equal(p.passaDoLimiteEm, 30000);
  const [s] = ondeMuda({ contas: [], cartoes: [cartao('d', null, null, [])] }, { contas: [], cartoes: [cartao('d', null, null, [['2026-10-10', 5000]])] }) as any;
  assert.equal(s.semLimite, true);
  assert.equal(s.passaDoLimiteEm, null);
});

test('cartão que não muda não aparece; conta do tipo cartão no horizonte de contas não aparece', () => {
  assert.deepEqual(ondeMuda({ contas: [conta('nu', 0, null, 'credit_card')], cartoes: [cartao('nu', 1, 1, [['2026-10-10', 1]])] },
                            { contas: [conta('nu', -9, null, 'credit_card')], cartoes: [cartao('nu', 1, 1, [['2026-10-10', 1]])] }), []);
});
```

- [ ] **Step 2: Ver falhar** — `node --test src/lib/onde-muda.test.ts` → módulo não existe.

- [ ] **Step 3: Implementar**

```ts
/** "Onde muda" (spec 29/09/2026, §4): o que a hipótese faz em cada conta e cartão, antes → depois. */
export type ContaNoHorizonte = { account_id: string | null; nome: string; tipo: string | null; saldo_hoje: number; menor: number; dia_do_menor: string; saldo_fim: number; negativa_em: string | null };
export type FaturaNoHorizonte = { invoice_id: string; vencimento: string; total: number; aberto: number };
export type CartaoNoHorizonte = { account_id: string; nome: string; limite: number | null; livre: number | null; faturas: FaturaNoHorizonte[] };
export type MudancaNaConta = { tipo: 'conta'; account_id: string; nome: string; antes: ContaNoHorizonte | null; depois: ContaNoHorizonte; ficaNegativaEm: string | null };
export type MudancaNoCartao = { tipo: 'cartao'; account_id: string; nome: string; semLimite: boolean; livreAntes: number | null; livreDepois: number | null; passaDoLimiteEm: number | null; faturas: { vencimento: string; antes: number; depois: number }[] };

export function ondeMuda(
  antes: { contas: ContaNoHorizonte[]; cartoes: CartaoNoHorizonte[] },
  depois: { contas: ContaNoHorizonte[]; cartoes: CartaoNoHorizonte[] },
): (MudancaNaConta | MudancaNoCartao)[] {
  const contas: MudancaNaConta[] = depois.contas
    // "Sem conta" só muda a visão geral; conta do tipo cartão é lida pelo lado do cartão.
    .filter((d): d is ContaNoHorizonte & { account_id: string } => d.account_id !== null && d.tipo !== 'credit_card')
    .flatMap((d) => {
      const a = antes.contas.find((x) => x.account_id === d.account_id) ?? null;
      const mudou = !a || a.saldo_fim !== d.saldo_fim || a.menor !== d.menor || a.negativa_em !== d.negativa_em;
      if (!mudou) return [];
      const ficaNegativaEm = d.negativa_em && (!a?.negativa_em || d.negativa_em < a.negativa_em) ? d.negativa_em : null;
      return [{ tipo: 'conta' as const, account_id: d.account_id, nome: d.nome, antes: a, depois: d, ficaNegativaEm }];
    });
  const cartoes: MudancaNoCartao[] = depois.cartoes.flatMap((d) => {
    const a = antes.cartoes.find((x) => x.account_id === d.account_id);
    const vencimentos = [...new Set([...(a?.faturas ?? []), ...d.faturas].map((f) => f.vencimento))].sort();
    const faturas = vencimentos
      .map((v) => ({ vencimento: v, antes: a?.faturas.find((f) => f.vencimento === v)?.total ?? 0, depois: d.faturas.find((f) => f.vencimento === v)?.total ?? 0 }))
      .filter((f) => f.antes !== f.depois);
    if (faturas.length === 0 && (a?.livre ?? null) === d.livre) return [];
    const semLimite = d.limite === null;
    return [{ tipo: 'cartao' as const, account_id: d.account_id, nome: d.nome, semLimite, livreAntes: a?.livre ?? null, livreDepois: d.livre,
      passaDoLimiteEm: !semLimite && d.livre !== null && d.livre < 0 ? -d.livre : null, faturas }];
  });
  return [...contas, ...cartoes];
}
```

- [ ] **Step 4: Ver passar** — `node --test src/lib/onde-muda.test.ts` → PASS.

- [ ] **Step 5: Commit** (lib pura, sem consumidor ainda)

```bash
git add src/lib/onde-muda.ts src/lib/onde-muda.test.ts
git commit -m "feat(projecao): onde muda — antes e depois por conta e por cartão"
```

---

### Task 5: Hooks — rascunho v2, simulação com contas e cartões, o "antes"

**Files:**
- Modify: `src/hooks/use-rascunho.ts`, `src/hooks/use-finance.ts`, `src/lib/use-preferencia.test.ts`, `src/lib/simple-finance-ui.test.ts` (mocks)

**Interfaces:**
- Consumes: `Hipotese`, `registroDaHipotese` (Task 3); `ContaNoHorizonte`, `CartaoNoHorizonte` (Task 4).
- Produces:
  - `useRascunho()` → `{ rascunho: Rascunho; adicionar(h: Hipotese): void; trocar(h: Hipotese): void; tirar(id: string): void; setAdiantamentos(f: (a: Draft[]) => Draft[]): void; limpar(): void; devolver(saiu: Pick<Rascunho, 'hipoteses' | 'adiantamentos'>): void }` — toda mudança parte do GRAVADO (função de `usePreferencia`).
  - `useSimulacao({ dias, modo: 'dia' | 'mes', view, hipoteses, adiantamentos, porConta, enabled })` → `useQuery` com `data: { forecast?: ForecastDay[]; meses?: ProjecaoMensal; contas?: ContaNoHorizonte[]; cartoes?: CartaoNoHorizonte[]; erros: ErroDaHipotese[] }`; `ErroDaHipotese.indice` é o índice em `hipoteses` COMPLETAS (as incompletas não vão).
  - `useHorizonteReal(dias, enabled)` → `{ contas, cartoes }` por `accounts_horizon`/`cards_horizon`, chaves `['accounts-horizon', dias]`, `['cards-horizon', dias]` (somadas a `FINANCE_KEYS`).
  - `useCicloSimulado(registros, month, view)` — igual, recebendo `RegistroSimulado[]`.
  - Sai: `useForecastWithDrafts` (a RPC fica para o agente) — conferir com `grep -rn useForecastWithDrafts src` que só a Projeção e testes o usavam.

- [ ] **Step 1: Teste (falha)** — em `src/lib/use-preferencia.test.ts`, trocar o teste do `useRascunho` por:

```ts
test('useRascunho v2: adicionar, trocar e tirar partem do GRAVADO (duas mudanças do mesmo render valem as duas)', async () => {
  // … mesmo carregamento do teste atual (require de '@/hooks/use-preferencia' = a.api; '@/lib/rascunho' = o módulo real via transpile) …
  const r0 = mod.exports.useRascunho();
  r0.adicionar({ id: 'a', kind: 'expense', forma: 'uma', valor_cents: 1, parcelas: 1, repete: 'monthly', conta: null, data: '2026-10-01' });
  r0.adicionar({ id: 'b', kind: 'expense', forma: 'uma', valor_cents: 2, parcelas: 1, repete: 'monthly', conta: null, data: '2026-10-01' });
  const r1 = mod.exports.useRascunho();
  r1.tirar('a');
  r1.trocar({ id: 'b', kind: 'income', forma: 'uma', valor_cents: 3, parcelas: 1, repete: 'monthly', conta: null, data: '2026-10-01' });
  assert.deepEqual(mod.exports.useRascunho().rascunho.hipoteses.map((h: any) => [h.id, h.valor_cents]), [['b', 3]]);
});
```

- [ ] **Step 2: Ver falhar** — `node --test src/lib/use-preferencia.test.ts`.

- [ ] **Step 3: Implementar `use-rascunho.ts`**

```ts
import { usePreferencia } from '@/hooks/use-preferencia';
import type { Draft } from '@/hooks/use-finance';
import type { Hipotese } from '@/lib/hipotese';
import { gravarRascunho, lerRascunho, type Rascunho } from '@/lib/rascunho';

const ehTexto = (v: string | number): v is string => typeof v === 'string';

/** O rascunho do "E se…?" no aparelho, por usuário. Toda mudança parte do GRAVADO na hora. */
export function useRascunho() {
  const [texto, setTexto] = usePreferencia<string>('projecao:rascunho', '', ehTexto);
  const rascunho = lerRascunho(texto);
  const mudar = (f: (r: Rascunho) => Rascunho) => setTexto((antes) => gravarRascunho(f(lerRascunho(antes))));
  return {
    rascunho,
    adicionar: (h: Hipotese) => mudar((r) => ({ ...r, hipoteses: [...r.hipoteses, h] })),
    trocar: (h: Hipotese) => mudar((r) => ({ ...r, hipoteses: r.hipoteses.map((x) => (x.id === h.id ? h : x)) })),
    tirar: (id: string) => mudar((r) => ({ ...r, hipoteses: r.hipoteses.filter((x) => x.id !== id) })),
    setAdiantamentos: (f: (a: Draft[]) => Draft[]) => mudar((r) => ({ ...r, adiantamentos: f(r.adiantamentos) })),
    limpar: () => setTexto(''),
    /** O "Desfazer": devolve SÓ o que saiu, somado ao rascunho de agora. */
    devolver: (saiu: Pick<Rascunho, 'hipoteses' | 'adiantamentos'>) =>
      mudar((r) => ({ ...r,
        hipoteses: [...r.hipoteses, ...saiu.hipoteses.filter((h) => !r.hipoteses.some((x) => x.id === h.id))],
        adiantamentos: [...r.adiantamentos, ...saiu.adiantamentos] })),
  };
}
```

- [ ] **Step 4: `use-finance.ts`** — substituir `useSimulacao`:

```ts
export function useSimulacao(o: { dias: number; modo: 'dia' | 'mes'; view: CycleView | undefined; hipoteses: Hipotese[]; adiantamentos: Draft[]; porConta: boolean; enabled: boolean }) {
  const registros = o.hipoteses.map(registroDaHipotese).filter((r): r is RegistroSimulado => r !== null);
  const drafts = paraOBanco(o.adiantamentos);
  useRealtimeInvalidate('transactions', ['simular']);
  return useQuery({
    enabled: o.enabled && (registros.length > 0 || drafts.length > 0),
    placeholderData: (anterior) => anterior,
    queryKey: ['simular', o.modo, String(o.dias), JSON.stringify(drafts), JSON.stringify(registros), o.view ?? '', o.porConta],
    queryFn: async (): Promise<{ forecast?: ForecastDay[]; meses?: ProjecaoMensal; contas?: ContaNoHorizonte[]; cartoes?: CartaoNoHorizonte[]; erros: ErroDaHipotese[] }> => {
      const leitura: Record<string, unknown> = o.modo === 'mes'
        ? { meses: { days: o.dias, drafts, view: o.view ?? null } }
        : { forecast: { days: o.dias, drafts } };
      if (o.porConta) Object.assign(leitura, { contas: { days: o.dias }, cartoes: { days: o.dias } });
      const { data, error } = await supabase.rpc('simular', { p_registros: registros as never, p_leituras: leitura as never });
      if (error) throw error;
      const r = data as { leituras?: Record<string, unknown>; erros?: ErroDaHipotese[] } | null;
      const l = r?.leituras ?? {};
      return { forecast: l.forecast as ForecastDay[] | undefined, meses: l.meses as ProjecaoMensal | undefined,
               contas: l.contas as ContaNoHorizonte[] | undefined, cartoes: l.cartoes as CartaoNoHorizonte[] | undefined, erros: r?.erros ?? [] };
    },
  });
}

/** O "antes" do Onde muda: o horizonte por conta e por cartão, sem hipótese. */
export function useHorizonteReal(dias: number, enabled: boolean) {
  useRealtimeInvalidate('transactions', ['accounts-horizon']);
  useRealtimeInvalidate('transactions', ['cards-horizon']);
  const contas = useQuery({ enabled, queryKey: ['accounts-horizon', String(dias)], queryFn: async () => {
    const { data, error } = await supabase.rpc('accounts_horizon', { days: dias });
    if (error) throw error;
    return data as unknown as ContaNoHorizonte[];
  } });
  const cartoes = useQuery({ enabled, queryKey: ['cards-horizon', String(dias)], queryFn: async () => {
    const { data, error } = await supabase.rpc('cards_horizon', { days: dias });
    if (error) throw error;
    return data as unknown as CartaoNoHorizonte[];
  } });
  return { contas, cartoes };
}
```

Com `['accounts-horizon'], ['cards-horizon']` em `FINANCE_KEYS` (`src/lib/query-invalidation.ts`; `refresh-consistency.test.ts` confere). `useCicloSimulado` passa a tipar `registros: RegistroSimulado[]`. Apagar `useForecastWithDrafts`.
Mocks do harness (`simple-finance-ui.test.ts`): `useSimulacao: (o: any) => …` lendo `options.simulacao`; `useHorizonteReal: () => ({ contas: { ...query, isSuccess: true, data: options.horizonte?.contas ?? [] }, cartoes: { …, data: options.horizonte?.cartoes ?? [] } })`; somar `horizonte?: any` às opções do `screen`.

- [ ] **Step 5: Ver passar** — `node --test src/lib/use-preferencia.test.ts src/lib/refresh-consistency.test.ts` → PASS. `tsc` ainda acusa as telas (Tasks 6–9).

- [ ] **Step 6: Commit (Tasks 3 + 5 juntas, o tipo muda de mãos)** — depois das Tasks 6–9 compilarem; ver Task 9, Step 5.

---

### Task 6: A folha "Nova hipótese" e o bloco "Onde muda" (componentes)

**Files:**
- Create: `src/components/finance/campos-da-hipotese.tsx`, `src/components/finance/onde-muda.tsx`
- Test: `src/lib/simple-finance-ui.test.ts` (render dos componentes pelo `componente`)

**Interfaces:**
- Consumes: `Hipotese`, `faltaNaHipotese` (Task 3); `MudancaNaConta | MudancaNoCartao` (Task 4); `AccountPicker`, `Calendar`, `MoneyField`, `QuantityField`, `Segmented`, `Field`, `Row`, `Money`, `Note`.
- Produces:
  - `CamposDaHipotese({ valor, onChange, contas, max }: { valor: Hipotese; onChange: (h: Hipotese) => void; contas: PickableAccount[]; max: string })` — os campos da tabela do spec §2, na ordem tipo → como → valor → parcelas/repete → conta → data. Trocar Entra↔Sai com forma que não existe no outro lado volta a "uma". Financiamento oferece só contas (`contas.filter(c => c.type !== 'credit_card')`). O `Calendar` recebe `min={localISODate()}` e `max`.
  - `OndeMuda({ mudancas, onAbrir }: { mudancas: (MudancaNaConta | MudancaNoCartao)[]; onAbrir: (accountId: string) => void })` — um `Row` por mudança; título = nome; subtítulo = "fim do período R$ A → R$ B" (conta) ou "fatura de dd/mm R$ A → R$ B" (primeira que muda, cartão) + a segunda linha do aviso: "Fica negativa em dd/mm" / "Passa do limite em R$ X" / "Sem limite cadastrado" / "Limite livre R$ A → R$ B". `destructive` quando há aviso de negativo/limite. Nada muda → `null`.

- [ ] **Step 1: Testes (falham)** — no `simple-finance-ui.test.ts`:

```ts
test('Folha da hipótese: Sai oferece as quatro formas; Entra só "Uma vez" e "Repete"; financiamento sem cartão', () => {
  const h = { id: 'h1', kind: 'expense', forma: 'uma', valor_cents: 0, parcelas: 2, repete: 'monthly', conta: null, data: '2026-10-05' };
  let atual: any = h;
  const contas = [{ id: 'cc', name: 'Itaú', type: 'checking' }, { id: 'nu', name: 'Nubank Cartão', type: 'credit_card', closing_day: 3 }];
  const ui = screen('src/components/finance/campos-da-hipotese.tsx', { componente: 'CamposDaHipotese', props: { valor: h, onChange: (n: any) => { atual = n; }, contas, max: '2036-10-05' } });
  const como = ui.nodes().filter((n: any) => n.type === 'Segmented')[1];
  assert.deepEqual(como.props.options.map((o: any) => o.label), ['Uma vez', 'Parcelado', 'Repete', 'Financiamento']);
  ui.interact(() => ui.nodes().filter((n: any) => n.type === 'Segmented')[0].props.onChange('income'));
  const ui2 = screen('src/components/finance/campos-da-hipotese.tsx', { componente: 'CamposDaHipotese', props: { valor: { ...h, kind: 'income' }, onChange: () => {}, contas, max: '2036-10-05' } });
  assert.deepEqual(ui2.nodes().filter((n: any) => n.type === 'Segmented')[1].props.options.map((o: any) => o.label), ['Uma vez', 'Repete']);
  const ui3 = screen('src/components/finance/campos-da-hipotese.tsx', { componente: 'CamposDaHipotese', props: { valor: { ...h, forma: 'financiamento' }, onChange: () => {}, contas, max: '2036-10-05' } });
  assert.deepEqual(ui3.nodes().find((n: any) => n.type === 'AccountPicker').props.accounts.map((a: any) => a.id), ['cc']);
  assert.equal(ui3.nodes().find((n: any) => n.type === 'Calendar').props.min <= '2026-10-05', true);
});

test('Onde muda: conta negativa, cartão acima do limite e cartão sem limite, cada um com a frase', () => {
  const mudancas = [
    { tipo: 'conta', account_id: 'cc', nome: 'Itaú', antes: { saldo_fim: 420000 }, depois: { saldo_fim: -10000 }, ficaNegativaEm: '2026-11-12' },
    { tipo: 'cartao', account_id: 'nu', nome: 'Nubank Cartão', semLimite: false, livreAntes: 20000, livreDepois: -10000, passaDoLimiteEm: 10000, faturas: [{ vencimento: '2026-11-10', antes: 135000, depois: 165000 }] },
    { tipo: 'cartao', account_id: 'd', nome: 'Cartão D', semLimite: true, livreAntes: null, livreDepois: null, passaDoLimiteEm: null, faturas: [{ vencimento: '2026-11-10', antes: 0, depois: 5000 }] },
  ];
  const abertos: string[] = [];
  const ui = screen('src/components/finance/onde-muda.tsx', { componente: 'OndeMuda', props: { mudancas, onAbrir: (id: string) => abertos.push(id) } });
  const linhas = ui.nodes().filter((n: any) => n.type === 'Row');
  assert.deepEqual(linhas.map((l: any) => l.props.title), ['Itaú', 'Nubank Cartão', 'Cartão D']);
  assert.match(linhas[0].props.subtitle, /Fica negativa em 12\/11/);
  assert.match(linhas[1].props.subtitle, /Passa do limite em R\$ 100,00/);
  assert.match(linhas[2].props.subtitle, /Sem limite cadastrado/);
  ui.interact(() => linhas[1].props.onPress());
  assert.deepEqual(abertos, ['nu']);
  assert.equal(screen('src/components/finance/onde-muda.tsx', { componente: 'OndeMuda', props: { mudancas: [], onAbrir: () => {} } }).nodes().length, 0);
});
```

- [ ] **Step 2: Ver falhar** — `node --test src/lib/simple-finance-ui.test.ts` → os dois novos falham (módulos não existem).

- [ ] **Step 3: Implementar os dois componentes** (tokens do design, `Section`/`Card` do app, frases acima; `OndeMuda` usa `useBRL` e `formatDateBR(...).slice(0, 5)` para dd/mm). No `CamposDaHipotese`: `Field label="Tipo"` (Entra/Sai — o "Adiantar" continua no `Segmented` da tela, que decide qual corpo mostrar), `Field label="Como"`, `Field label={forma === 'parcelado' ? 'Valor total' : forma === 'financiamento' ? 'Valor da parcela' : 'Valor'}` com `MoneyField`, `QuantityField` (parcelado 2..72, financiamento 1..480), `Segmented` de Repete (Toda semana/Todo mês/Todo ano), `AccountPicker` com `emptyLabel="Sem conta"` fora de parcelado/financiamento, `Calendar` inline com `min`/`max`, e `Note` com "Sem conta, a hipótese só muda a visão geral." quando `conta === null`.

- [ ] **Step 4: Ver passar**.

---

### Task 7: A Projeção — um botão, a lista, Aplicar e Tirar, Onde muda

**Files:**
- Modify: `src/app/finance/forecast.tsx`, `src/lib/simple-finance-ui.test.ts`, `src/lib/anti-slop.test.ts`

**Interfaces:**
- Consumes: Tasks 3–6. `agruparHipoteses` (continua para os adiantamentos).

- [ ] **Step 1: Testes (falham)**:

```ts
test('E se: UM botão "Nova hipótese"; nada de "Adicionar como…" nem "Aplicar todas"', () => {
  const ui = screen(forecastFile, { forecastAccounts: [{ id: 'conta-1' }] });
  const botoes = ui.nodes().filter((n: any) => n.type === 'Button').map((n: any) => n.props.label);
  assert.ok(botoes.includes('Nova hipótese'));
  assert.ok(!botoes.includes('Adicionar como…') && !botoes.includes('Aplicar todas') && !botoes.includes('Supor um lançamento'));
});

test('E se: a linha da hipótese aplica pelo formulário com tudo e tira PELO ID', () => {
  const hipoteses = [
    { id: 'a', kind: 'expense', forma: 'parcelado', valor_cents: 300000, parcelas: 10, repete: 'monthly', conta: 'nu', data: '2026-10-05' },
    { id: 'b', kind: 'expense', forma: 'uma', valor_cents: 1000, parcelas: 1, repete: 'monthly', conta: null, data: '2026-10-06' },
  ];
  const ui = screen(forecastFile, { forecastAccounts: [{ id: 'nu', name: 'Nubank Cartão', type: 'credit_card' }], preferencias: { 'projecao:rascunho': JSON.stringify({ versao: 2, hipoteses, adiantamentos: [] }) } });
  const linha = (t: RegExp) => deslizaveis(ui).find((d: any) => t.test(d.props.titulo));
  ui.interact(() => linha(/10×/).props.acoes.find((a: any) => a.label === 'Aplicar').onPress());
  assert.deepEqual(JSON.parse(JSON.stringify(ui.navigations.at(-1))), { pathname: '/finance/transaction-form', params: { deHipotese: 'a', kind: 'expense', amount: '300000', data: '05/10/2026', parcelas: '10', conta: 'nu' } });
  ui.interact(() => linha(/sem conta/).props.acoes.find((a: any) => a.label === 'Tirar').onPress());
  assert.deepEqual(JSON.parse(ui.preferenciasGravadas['projecao:rascunho']).hipoteses.map((h: any) => h.id), ['a']);
});

test('E se: com hipótese, "Onde muda" aparece com as contas que mudam e leva ao detalhe', () => {
  const hipoteses = [{ id: 'a', kind: 'expense', forma: 'uma', valor_cents: 50000, parcelas: 1, repete: 'monthly', conta: 'cc', data: '2026-10-05' }];
  const conta = (fim: number, neg: string | null) => ({ account_id: 'cc', nome: 'Itaú', tipo: 'checking', saldo_hoje: 100, menor: fim, dia_do_menor: '2026-10-05', saldo_fim: fim, negativa_em: neg });
  const ui = screen(forecastFile, {
    forecastAccounts: [{ id: 'cc', name: 'Itaú', type: 'checking' }],
    preferencias: { 'projecao:rascunho': JSON.stringify({ versao: 2, hipoteses, adiantamentos: [] }) },
    horizonte: { contas: [conta(40000, null)], cartoes: [] },
    simulacao: { forecast: [], contas: [conta(-10000, '2026-10-05')], cartoes: [], erros: [] },
  });
  const bloco = ui.nodes().find((n: any) => typeof n.type === 'function' && n.type.name === 'OndeMuda');
  assert.equal(bloco.props.mudancas.length, 1);
  ui.interact(() => bloco.props.onAbrir('cc'));
  assert.deepEqual(JSON.parse(JSON.stringify(ui.navigations.at(-1))), { pathname: '/finance/hipotese', params: { conta: 'cc' } });
});

test('E se: hipótese incompleta (v1 parcelada sem conta) diz o que falta e não vai à simulação', () => {
  const ui = screen(forecastFile, { forecastAccounts: [{ id: 'cc' }], preferencias: { 'projecao:rascunho': JSON.stringify({ versao: 1, detalhadas: [], rapidas: [{ kind: 'expense', amount_cents: 900, start: '2026-10-02', installments: 3, mode: 'total', grupo: 'g2' }] }) } });
  const linha = ui.nodes().find((n: any) => n.type === 'Row' && /Escolha a conta/.test(n.props.subtitle ?? ''));
  assert.ok(linha, 'a linha pede a conta');
});
```

E em `anti-slop.test.ts`: um teste que lê `forecast.tsx` e barra `adicionarComo`, `aplicarTodas`, `useForecastWithDrafts`, `HipoteseDetalhada`, `detalhadas`.

- [ ] **Step 2: Ver falhar**.

- [ ] **Step 3: Reescrever o bloco do "E se…" em `forecast.tsx`:**
  - Estado: `const { rascunho, adicionar, trocar, tirar, setAdiantamentos, limpar, devolver } = useRascunho();`, `hipoteses = rascunho.hipoteses`, `adiantamentos = rascunho.adiantamentos`, `simulando = hipoteses.length + adiantamentos.length > 0`; o estado da folha vira `const [hipotese, setHipotese] = useState<Hipotese>(() => novaHipotese(localISODate()))` + os de adiantar (ficam) + `editando: string | null` (id da hipótese OU grupo do adiantamento) + `tipoDaFolha: 'hipotese' | 'adiantar'`.
  - Simulação: `const simulacao = useSimulacao({ dias, modo: emMes ? 'mes' : 'dia', view: regua.view, hipoteses, adiantamentos, porConta: hipoteses.length > 0, enabled: simulando });` e `const horizonte = useHorizonteReal(dias, hipoteses.length > 0);`. `serie = simulando ? (simulacao.data?.forecast ?? forecast.data) : forecast.data`; `mensalExibido = simulando ? (simulacao.data?.meses ?? mensal.data) : mensal.data`; `useForecastMonths(dias, [], emMes, regua.view)` (sem drafts: a simulação já os leva).
  - Lista: `hipoteses.map` com `Deslizavel` + `Row` (`title = resumoDaHipotese(h, brl, nomeDaConta)`, `subtitle = faltaNaHipotese(h) ?? erro-da-simulação ?? undefined`, `destructive` com erro/falta), ações `Aplicar` (direita, `router.push(paramsDoAplicar(h))`, desligado quando falta algo), `Editar`, `Tirar` (esquerda, `tirar(h.id)` + toast "Desfazer" com `devolver({ hipoteses: [h], adiantamentos: [] })`). O índice do erro da simulação é o índice entre as COMPLETAS (`hipoteses.filter(h => !faltaNaHipotese(h))`). Os adiantamentos continuam como hoje (via `agruparHipoteses(adiantamentos)`), sem Aplicar.
  - Botões: `Nova hipótese` (primary sem rascunho, secondary com) e `Limpar` (com Desfazer). No teto de 30 hipóteses, "Nova hipótese" dá o toast do limite.
  - Folha: `Segmented` Hipótese/Adiantar no topo (`tipoDaFolha`), corpo `CamposDaHipotese` ou `AdiantarCampos`; o botão "Ver resultado"/"Salvar" desligado com `faltaNaHipotese(hipotese)` escrito num `Note` logo abaixo do cabeçalho; "Ver resultado" grava (`adicionar` ou `trocar`) e amplia o horizonte até a data (`HORIZONTES.find(h => h.dias >= diasAte(data))`, e até a última parcela no parcelado/financiamento).
  - "Onde muda": `const mudancas = useMemo(() => ondeMuda({ contas: horizonte.contas.data ?? [], cartoes: horizonte.cartoes.data ?? [] }, { contas: simulacao.data?.contas ?? [], cartoes: simulacao.data?.cartoes ?? [] }), [...])`, só quando as três consultas têm dado e `!simulacao.isPlaceholderData`; `<OndeMuda mudancas={mudancas} onAbrir={(id) => router.push({ pathname: '/finance/hipotese', params: { conta: id } })} />` logo abaixo da lista; esqueleto de 2 linhas enquanto carrega; erro das leituras `contas`/`cartoes` com `ErrorBand`.
  - "Ver o ciclo": `params: { month, view, tipo: 'sai', ...(simulando ? { hipoteses: '1' } : {}) }` (o ciclo lê o rascunho do aparelho — Task 9).
  - Remover: `adicionarComo`, `editarDetalhada`, `gravarDetalhada`, `aplicarDetalhada`, `aplicarTodas`, `salvando`/`marcarAplicando`/`aplicando`, os hooks de salvar que só eles usavam, `paraOCiclo`, `aplicarRapida`, `tirarRapida`, os estados `novoValor`/`novoMes`/`novoParcelas`/`novoModo` (o mês do Adiantar passa a ser um estado próprio `mesAdiantar`), imports órfãos (a lint diz).

- [ ] **Step 4: Ver passar** — os testes novos e todos os da Projeção que ficaram (os que prendiam o caminho removido — "Adicionar como…", "Aplicar a detalhada", "Aplicar duas vezes", "teto de 30 hipóteses detalhadas", "enquanto aplica… desligados", "Aplicar a rápida abre o formulário" — saem ou são reescritos para a v2).

---

### Task 8: Os formulários — sem modo hipótese, com o pré-preenchimento do Aplicar

**Files:**
- Modify: `src/app/finance/transaction-form.tsx`, `src/app/finance/recurring.tsx`, `src/app/finance/debts.tsx`, `src/lib/simple-finance-ui.test.ts`, `src/lib/anti-slop.test.ts`

**Interfaces:**
- Consumes: `paramsDoAplicar` (Task 3) — os parâmetros; `useRascunho().tirar(id)` (Task 5).

- [ ] **Step 1: Testes (falham)**:

```ts
test('Recorrente aberta pelo Aplicar: conta e frequência chegam, e salvar tira a hipótese PELO ID', async () => {
  const rascunho = JSON.stringify({ versao: 2, adiantamentos: [], hipoteses: [
    { id: 'x', kind: 'expense', forma: 'uma', valor_cents: 1, parcelas: 1, repete: 'monthly', conta: null, data: '2026-10-01' },
    { id: 'r', kind: 'expense', forma: 'repete', valor_cents: 5000, parcelas: 1, repete: 'weekly', conta: 'cc', data: '2026-10-06' } ] });
  const ui = screen('src/app/finance/recurring.tsx', { segurarMutacoes: true, preferencias: { 'projecao:rascunho': rascunho },
    params: { create: '1', deHipotese: 'r', kind: 'expense', amount: '5000', start: '06/10/2026', account: 'cc', repete: 'weekly', description: 'Academia' } });
  const header = ui.nodes().find((n: any) => n.type === 'TaskHeader' && n.props.action);
  ui.interact(() => header.props.action.props.onPress());
  assert.equal(ui.writes.at(-1).value.account_id, 'cc');
  assert.match(ui.writes.at(-1).value.rrule, /^FREQ=WEEKLY/);
  (ui.pedidos.at(-1) as any).resolver('rec-1');
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(JSON.parse(ui.preferenciasGravadas['projecao:rascunho']).hipoteses.map((h: any) => h.id), ['x']);
});

test('Financiamento aberto pelo Aplicar: parcela, parcelas, conta e a próxima parcela preenchidas', () => {
  const ui = screen(debtsFile, { create: true, params: { create: 'financing', deHipotese: 'f', parcela: '147000', parcelas: '48', conta: 'cc', data: '31/10/2026' } });
  const form = ui.nodes().find((n: any) => n.props?.accessibilityLabel === 'Valor da parcela' || n.props?.label === 'Valor da parcela');
  assert.ok(form, 'o campo do valor da parcela está na tela');
  // e o valor dele vem dos parâmetros: conferir pelo MoneyField com 147000 e o QuantityField/TextField com 48
  assert.ok(ui.nodes().some((n: any) => n.type === 'MoneyField' && n.props.valueCents === 147000));
});
```

Mais: em `anti-slop.test.ts`, `transaction-form.tsx`, `recurring.tsx`, `debts.tsx` sem `hipotese`, `modoHipotese`, `guardada`, `paraHipotese`, `formDaHipotese`, `'Adicionar à hipótese'`; e o `tirarRapida` do lançamento chamando `tirar(daRapida.id)`.

- [ ] **Step 2: Ver falhar**.

- [ ] **Step 3: Implementar**:
  - `transaction-form.tsx`: tirar `hipotese`/`parcelada` dos params e das props, `modoHipotese`, `guardada`, `hipoteseAberta`, `hLanc`/`hParc`, `paraHipotese`, o desvio do salvar, os títulos. `daRapida` passa a ser `{ id: string; kind; amount; data?; parcelas; conta? }` (params `deHipotese`, `conta`); defaults: `account_id: … ?? daRapida?.conta ?? …`. `tirarRapida = () => { if (daRapida) tirar(daRapida.id); }`. Chave do componente: `novo:${params.conta ?? ''}:${params.deHipotese ?? ''}`.
  - `recurring.tsx`: tirar o modo `?hipotese`; o param `repete` (`weekly|monthly|yearly`) vira o `preset` do formulário de criação (`SERIE_VAZIA.preset`); o salvar tira `tirar(params.deHipotese)` pela promessa.
  - `debts.tsx`: tirar o modo `?hipotese`, `formDaHipotese`, `guardada`; ler `deHipotese`, `parcela`, `parcelas`, `conta`, `data` e abrir `{ ...FORM_VAZIO, kind: 'financing', unidade: 'parcela', valorCents: Number(parcela), installmentCents: Number(parcela), parcelas: parcelas ?? '', accountId: conta ?? null, diaVencimento: data?.slice(0, 2) ?? '', ancora: data ? brToISO(data) : null }`; salvar a dívida nova tira `tirar(params.deHipotese)` pela promessa (mesmo desenho do `montado` do lançamento).

- [ ] **Step 4: Ver passar**.

---

### Task 9: O ciclo com as hipóteses do aparelho

**Files:**
- Modify: `src/app/finance/cycle.tsx`, `src/lib/simple-finance-ui.test.ts`

- [ ] **Step 1: Teste (falha)** — reescrever o teste "Ciclo pela Projeção com hipótese detalhada" para `params: { month: '2026-10', view: 'cycle', hipoteses: '1' }` + `preferencias` com o rascunho v2 (uma hipótese no cartão) + `cicloSimulado`; conferir que a linha criada vai a "Hipóteses do rascunho" e a fatura existente diz "inclui hipótese". E um segundo: sem `hipoteses=1`, o ciclo NÃO usa o rascunho do aparelho (é o ciclo real aberto de outro lugar).

- [ ] **Step 2: Ver falhar**.

- [ ] **Step 3: Implementar** — `const comHipoteses = params.hipoteses === '1'; const { rascunho } = useRascunho();` → `registros = comHipoteses ? rascunho.hipoteses.map(registroDaHipotese).filter(Boolean) : []`; os adiantamentos (`comHipoteses ? rascunho.adiantamentos : []`) seguem pelo `useDraftLines` como as rápidas de antes. Sai `lerDetalhadas`, `detalhadasValidas` e o param `detalhadas`/`rascunho`.

- [ ] **Step 4: Ver passar** — e o gate completo (`tsc`, `lint`, `npm test`) agora compila tudo das Tasks 3–9.

- [ ] **Step 5: Commit (3, 5, 6, 7, 8, 9)**

```bash
git add src/lib/hipotese.ts src/lib/hipotese.test.ts src/lib/rascunho.ts src/lib/rascunho.test.ts src/hooks/use-rascunho.ts src/hooks/use-finance.ts src/lib/query-invalidation.ts src/components/finance/campos-da-hipotese.tsx src/components/finance/onde-muda.tsx src/app/finance/forecast.tsx src/app/finance/transaction-form.tsx src/app/finance/recurring.tsx src/app/finance/debts.tsx src/app/finance/cycle.tsx src/lib/simple-finance-ui.test.ts src/lib/anti-slop.test.ts src/lib/use-preferencia.test.ts src/lib/refresh-consistency.test.ts
git commit -m "feat(projecao): uma hipótese só, com conta e forma, aplicada pelo formulário completo"
```

---

### Task 10: A tela "Detalhe da hipótese"

**Files:**
- Create: `src/app/finance/hipotese.tsx`
- Modify: `src/app/_layout.tsx` (rota `finance/hipotese`, título "Detalhe da hipótese"), `src/lib/simple-finance-ui.test.ts`

**Interfaces:**
- Consumes: `useRascunho`, `useSimulacao` (`porConta: true`, modo `dia`, `dias` = `usePreferencia('projecao:dias', …)` — a MESMA chave da Projeção), `useHorizonteReal`, `ondeMuda`, `resumoDaHipotese`, `useAccounts`.

- [ ] **Step 1: Testes (falham)**:

```ts
test('Detalhe da hipótese — conta: hoje, menor (e o dia) e fim, antes → depois; e as hipóteses dela', () => {
  const c = (hoje: number, menor: number, fim: number, neg: string | null) => ({ account_id: 'cc', nome: 'Itaú', tipo: 'checking', saldo_hoje: hoje, menor, dia_do_menor: '2026-11-12', saldo_fim: fim, negativa_em: neg });
  const ui = screen('src/app/finance/hipotese.tsx', { params: { conta: 'cc' }, forecastAccounts: [{ id: 'cc', name: 'Itaú', type: 'checking' }],
    preferencias: { 'projecao:rascunho': JSON.stringify({ versao: 2, adiantamentos: [], hipoteses: [{ id: 'a', kind: 'expense', forma: 'uma', valor_cents: 50000, parcelas: 1, repete: 'monthly', conta: 'cc', data: '2026-11-12' }] }) },
    horizonte: { contas: [c(100000, 40000, 40000, null)], cartoes: [] }, simulacao: { contas: [c(100000, -10000, -10000, '2026-11-12')], cartoes: [], erros: [] } });
  const t = JSON.stringify(ui.nodes().map((n: any) => [n.props?.children, n.props?.title, n.props?.subtitle]));
  assert.match(t, /Fica negativa em 12\/11\/2026/);
  assert.match(t, /Sai R\$ 500,00 · Itaú · em 12\/11\/2026/);
});

test('Detalhe da hipótese — cartão sem limite: diz e oferece cadastrar; com limite estourado: quanto', () => {
  const k = (limite: number | null, livre: number | null, faturas: any[]) => ({ account_id: 'nu', nome: 'Nubank Cartão', limite, livre, faturas });
  const base = { params: { conta: 'nu' }, forecastAccounts: [{ id: 'nu', name: 'Nubank Cartão', type: 'credit_card' }],
    preferencias: { 'projecao:rascunho': JSON.stringify({ versao: 2, adiantamentos: [], hipoteses: [{ id: 'a', kind: 'expense', forma: 'uma', valor_cents: 50000, parcelas: 1, repete: 'monthly', conta: 'nu', data: '2026-10-05' }] }) } };
  const sem = screen('src/app/finance/hipotese.tsx', { ...base, horizonte: { contas: [], cartoes: [k(null, null, [])] }, simulacao: { contas: [], cartoes: [k(null, null, [{ invoice_id: 'f', vencimento: '2026-11-10', total: 50000, aberto: 50000 }])], erros: [] } });
  assert.ok(sem.nodes().some((n: any) => /Sem limite cadastrado/.test(JSON.stringify(n.props?.children ?? n.props?.title ?? ''))));
  assert.ok(sem.nodes().some((n: any) => n.props?.label === 'Cadastrar o limite'));
  const estoura = screen('src/app/finance/hipotese.tsx', { ...base, horizonte: { contas: [], cartoes: [k(100000, 20000, [])] }, simulacao: { contas: [], cartoes: [k(100000, -30000, [{ invoice_id: 'f', vencimento: '2026-11-10', total: 50000, aberto: 50000 }])], erros: [] } });
  assert.ok(estoura.nodes().some((n: any) => /Passa do limite em R\$ 300,00/.test(JSON.stringify(n.props ?? {}))));
});

test('Detalhe da hipótese — conta que não existe mais e erro da leitura', () => {
  const nada = screen('src/app/finance/hipotese.tsx', { params: { conta: 'sumiu' }, forecastAccounts: [], horizonte: { contas: [], cartoes: [] }, simulacao: { contas: [], cartoes: [], erros: [] } });
  assert.ok(nada.nodes().some((n: any) => n.type === 'EmptyState'));
  const erro = screen('src/app/finance/hipotese.tsx', { params: { conta: 'cc' }, forecastAccounts: [{ id: 'cc' }], horizonte: { contas: [], cartoes: [] }, simulacao: { contas: [], cartoes: [], erros: [{ leitura: 'contas', mensagem: 'x', codigo: 'XX000' }] } });
  assert.ok(erro.nodes().some((n: any) => n.type === 'ErrorCard'));
});
```

- [ ] **Step 2: Ver falhar**.

- [ ] **Step 3: Implementar `src/app/finance/hipotese.tsx`** — `Screen` com `<Stack.Title>` = nome da conta; `useTelaPronta` com as três consultas; conta → `Card` com três pares ("Hoje", "Menor saldo · dd/mm", "No fim · dd/mm") cada um `Money` antes, `Icon arrow.right`, `Money` depois (linha em `flexWrap`, `Money` sem `encolhe` — desce de linha com fonte grande), `Note tone danger` "Fica negativa em dd/mm/aaaa"; cartão → `Card` do limite livre (ou "Sem limite cadastrado" + `Button` "Cadastrar o limite" → `router.push({ pathname: '/finance/accounts', params: { edit: id } })` conferindo o param de edição que `accounts.tsx` já lê), `Note` "Passa do limite em R$ X", e `Section` "Faturas" com uma `Row` por fatura que muda (`title` "Vence dd/mm/aaaa", `trailing` antes → depois); por fim `Section` "Hipóteses nesta conta" com `resumoDaHipotese` das hipóteses de `conta === id`. Conta/cartão fora das listas → `EmptyState compacto` "Esta conta não existe mais" (o motivo). Erro de `contas`/`cartoes` na simulação → `ErrorCard` com `refetch`.
  Registrar em `_layout.tsx`: `<Stack.Screen name="finance/hipotese" options={{ title: 'Detalhe da hipótese' }} />`.

- [ ] **Step 4: Ver passar** + gate.

- [ ] **Step 5: Commit**

```bash
git add src/app/finance/hipotese.tsx src/app/_layout.tsx src/lib/simple-finance-ui.test.ts
git commit -m "feat(projecao): detalhe da hipótese por conta e por cartão"
```

---

### Task 11: Conferir de verdade, documentar

**Files:**
- Modify: `.claude/rules/finance.md` (seção *Rascunho de cenário*), `docs/AGENTE-PARIDADE-COM-O-APP.md`

- [ ] **Step 1: Medir** `simular` no staging com 10 hipóteses (as quatro formas, contas e cartões do `dev@`) e `contas`+`cartoes`+`forecast` a 3650 dias, três vezes. Critério < 2 s; acima, anotar e avisar o Gabriel.
- [ ] **Step 2: Conferir contra o banco** (staging, `dev@`): para cada forma, criar a MESMA hipótese de verdade por um script (RPC/insert, como o app), ler `accounts_horizon`/`cards_horizon`, e comparar com o que o "Onde muda" e o Detalhe mostram; apagar por ID anotado.
- [ ] **Step 3: No aparelho** — iPhone (normal e `accessibility-large`, relançando após trocar) e Android (normal e 384dp × 1,3, `force-stop` após trocar): criar as quatro formas + uma sem conta + uma no cartão sem limite + uma que estoura o limite + uma que deixa a conta negativa; Onde muda, Detalhe (conta e cartão), Ver o ciclo, Aplicar de cada forma (formulário preenchido; salvar tira a hipótese certa), Tirar/Desfazer, Limpar/Desfazer, fechar e abrir o app (rascunho fica). Devolver tamanhos e densidade no fim; apagar por ID o que o Aplicar criou.
- [ ] **Step 4: Documentar** — `finance.md` (*Rascunho de cenário*): a hipótese única (campos, `registroDaHipotese`, `simular` para todas menos Adiantar), `eventos_de_caixa`/`caixa_das_contas` como fonte única da projeção por conta, o "Onde muda". `AGENTE-PARIDADE-COM-O-APP.md`: a linha da hipótese detalhada passa a "hipótese com conta e forma, só no app; o agente segue com `simulate_scenario`".
- [ ] **Step 5: Gate completo e commit**

```bash
npx tsc --noEmit && npx expo lint && npm test
git add .claude/rules/finance.md docs/AGENTE-PARIDADE-COM-O-APP.md
git commit -m "docs(projecao): hipótese única e o detalhe por conta"
```

- [ ] **Step 6: Subida (só com o Gabriel)** — produção: `20260929120000`, `20260929130000`, `20260929140000`, `20260929150000` num `db push`, antes do app (MINOR).
