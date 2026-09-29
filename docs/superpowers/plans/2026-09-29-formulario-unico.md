# Formulário único de lançamento — Implementation Plan (A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uma tela só (`/finance/lancar`) com o seletor **Uma vez | Recorrente | Financiamento**, que troca os campos no lugar, leva os campos comuns, tem "Salvar e criar outro", e converte um registro existente de tipo pela pergunta de quatro opções.

**Architecture:** Os três formulários viram três CORPOS (componentes com o próprio estado e o próprio salvar), extraídos das telas atuais sem reescrever regra: `FormularioDoLancamento` (o `TransactionForm` de hoje), `FormularioDaSerie` (a folha de Recorrentes) e `FormularioDaDivida` (a folha de Dívidas). A tela `lancar.tsx` é o hospedeiro: guarda o tipo e os campos comuns, desenha o seletor dentro do corpo (prop `topo`), faz o crossfade na troca, pergunta o alcance da conversão e chama `converter_registro` — função nova no banco que encerra a origem e cria o destino numa transação só, pela `private.criar_registro_da_hipotese` que o `simular` já usa. (A spec fala em extrair `private.criar_registro(tipo, dados)`; essa função já existe com esse papel, então é reaproveitada e não renomeada — um nome a mais seria a segunda porta para a mesma regra.)

**Tech Stack:** Expo SDK 57 + expo-router, react-hook-form + zod, TanStack Query, react-native-reanimated v4, Supabase Postgres (plpgsql), `node --test` com o harness de `simple-finance-ui.test.ts`, testes SQL em `supabase/tests`.

**Spec:** `docs/superpowers/specs/2026-09-29-formulario-unico-e-categorias-design.md` (Partes 1, 2 e 4). As categorias (Parte 3) são o plano B: `docs/superpowers/plans/2026-09-29-categorias.md`.

## Global Constraints

- Commits conventional, UMA linha, sem corpo e **sem `Co-Authored-By`**. Sem push, sem tag.
- Banco: só STAGING (`utkqoiigimqzeenxkxdl`; conferir `scripts/supabase-target.sh` antes de `db push`). Produção é do Gabriel.
- Função nova em `public`: `revoke execute … from public, anon`, `grant … to authenticated`, entra no array de `supabase/tests/anon_sem_execute.sql` (ordem alfabética). `set timezone to 'America/Sao_Paulo'` no CABEÇALHO se usar `current_date`. `security invoker` sob a RLS de sempre.
- Portão antes de cada commit: `npx tsc --noEmit`, `npx expo lint`, `npm test` (olhe o código de saída, não a contagem).
- Design (`design.md`): cabeçalho é `TaskHeader`; seletor de 3 opções é `Segmented`; nunca `LinearTransition` (use `transicaoDeLayout`); toda rolagem com `keyboardShouldPersistTaps="handled"`; texto nunca trunca; dinheiro sempre `amount_cents` inteiro; ação no FIM do conteúdo, nunca ancorada.
- A régua de alcance já existente de edição ("Só esta / Esta e as próximas / Todas", "Só esta parcela / A compra toda") NÃO muda.
- Opções da conversão (spec, Parte 2): **Só esta** (só ocorrência de recorrente), **Desta em diante**, **Todas, apagando as anteriores**, **Manter o atual e criar um novo**; lançamento avulso: **Converter** / **Manter e criar um novo**; sem passado, "Desta em diante" some e "Todas" vira "Converter".

## Review Focus

1. **Trocar o tipo e VOLTAR ao original antes de salvar** — é uma edição comum: sem pergunta de conversão, grava pelo caminho de edição de sempre. → teste na Task 7.
2. **Conversão que falha no meio** (fatura paga, parcela fixa fora da faixa) — nada muda, e a frase do banco aparece. → teste SQL na Task 1 (recusa com estado intacto) e de tela na Task 7 (toast com `financeErrorMessage`).
3. **"Só esta" numa ocorrência** — o agendador não pode recriar a data. → Task 1 confere `recurring_moved_occurrences`.
4. **Campos comuns entre tipos com regras diferentes** — transferência não existe em Recorrente (vira gasto); Financiamento não tem categoria nem tipo gasto/receita; "Salvar e criar outro" mantém tipo, conta e data e limpa o resto. → testes puros na Task 2.
5. **Entradas antigas** — link para `/finance/transaction-form`, `/finance/recurring?edit=`, `/finance/nova-recorrente` (APK antigo, notificação, hipótese salva no aparelho) continuam abrindo o formulário certo. → Task 8.

---

## File Structure

| arquivo | responsabilidade |
|---|---|
| `supabase/migrations/20260929160000_converter_registro.sql` | `public.converter_registro` |
| `supabase/tests/converter_registro.sql` | origens × alcances, recusa atômica, data pulada |
| `src/lib/lancar.ts` (+ `.test.ts`) | tipos do hospedeiro: `TipoDeLancamento`, `Comum`, `OrigemDaConversao`, `opcoesDaConversao`, `comumDepoisDeSalvar`, `tipoDoRegistro`, `hrefDoLancar` |
| `src/hooks/use-finance.ts` | `useConverterRegistro` |
| `src/components/finance/corpo-do-lancar.ts` | `CorpoProps` — o contrato dos três corpos |
| `src/components/finance/formulario-do-lancamento.tsx` | o `TransactionForm` de hoje, movido, com `CorpoProps` |
| `src/components/finance/formulario-da-serie.tsx` | estado + salvar + campos da recorrente (sai de `recurring.tsx`) |
| `src/components/finance/formulario-da-divida.tsx` | estado + salvar + campos da dívida (sai de `debts.tsx`) |
| `src/app/finance/lancar.tsx` | hospedeiro: seletor, crossfade, comum, criar outro, conversão |
| `src/app/finance/transaction-form.tsx` | vira casca: redireciona para `/finance/lancar` |
| `src/app/finance/recurring.tsx`, `debts.tsx` | perdem a folha de formulário; "+"/Editar abrem `/finance/lancar` |
| `src/app/finance/nova-recorrente.tsx`, `novo-financiamento.tsx` | viram cascas que redirecionam (links antigos) |

---

### Task 1: `converter_registro` no banco

**Files:**
- Create: `supabase/migrations/20260929160000_converter_registro.sql`
- Create: `supabase/tests/converter_registro.sql`
- Modify: `supabase/tests/anon_sem_execute.sql` (array de nomes), `src/lib/database.types.ts` (regenerado), `docs/HISTORICO-DE-MIGRATIONS.md`

**Interfaces:**
- Consumes: `private.criar_registro_da_hipotese(p_tipo text, p_dados jsonb) returns jsonb` (`{ids, faturas}`), `public.convert_transaction_to_installments(...)`, `public.skip_recurring_occurrence(uuid, date)`, `public.update_recurring_series(uuid, jsonb, boolean)`, `public.delete_debt(uuid)`, `private.parcela_travada(text, uuid)`.
- Produces: `public.converter_registro(p_origem jsonb, p_alcance text, p_destino jsonb) returns jsonb` — `p_origem = {tipo: 'transacao'|'serie'|'plano'|'divida', id}`, `p_alcance in ('so_esta','desta_em_diante','todas','manter','converter')`, `p_destino = RegistroSimulado` (`{tipo: 'lancamento'|'parcelada'|'recorrente'|'financiamento', dados}`, o MESMO formato de `registroDaHipotese`). Devolve `{ids: uuid[]}`.

- [ ] **Step 1: Escrever o teste SQL (falha: a função não existe)**

`supabase/tests/converter_registro.sql` — mesmo cabeçalho de `horizonte_por_conta.sql` (usuário `…f1d1`, conta corrente `A`, cartão `C` fechando dia 3 vencendo 10 com `payment_account_id = A`). Montagem (como postgres):

```sql
-- série S mensal com uma ocorrência PAGA (hoje − 30) e uma PENDENTE (hoje + 5)
-- compra P no cartão C em 3x criada por create_installment_plan_with_history(… p_paid_installments => 1)
-- dívida D parcela fixa (3 × 10000, due_day do dia de hoje + 10, first_due_date hoje + 10) com 1 pagamento inserido (kind expense, cleared, debt_id = D, amount 10000, account A)
-- lançamento avulso T: expense cleared 5000 em A hoje − 1
-- fatura F do cartão C marcada paid com uma compra T2 dentro (para a recusa)
```

Asserções (como `authenticated`, cada caso num bloco `begin … exception when others then raise exception '<n>. %', sqlerrm; end` para localizar a falha):

```sql
-- 1. manter: cria a recorrente nova e S fica intacta
r := public.converter_registro(jsonb_build_object('tipo','serie','id',s), 'manter',
       jsonb_build_object('tipo','recorrente','dados', jsonb_build_object('kind','expense','amount_cents',700,'description','Nova','account_id',a,
         'rrule','FREQ=MONTHLY;BYMONTHDAY=5','next_run_at',(hoje+5)::timestamptz,'dtstart',(hoje+5)::timestamptz)));
if (select count(*) from recurring_transactions where id = s) <> 1 then raise exception '1. a origem sumiu'; end if;
-- 2. converter T → recorrente: o MESMO id vira a 1ª ocorrência
r := public.converter_registro(jsonb_build_object('tipo','transacao','id',t), 'converter', <recorrente com dtstart = hoje − 1>);
if (select recurring_id from transactions where id = t) is distinct from ((r->'ids'->>0)::uuid) then raise exception '2. T não foi adotado'; end if;
-- 3. converter um avulso PAGO → financiamento: vira o 1º pagamento (id muda; installments_paid = 1)
-- 4. so_esta na ocorrência PENDENTE de S → lancamento: mesmo id, recurring_id null, e (S, data) em private.recurring_moved_occurrences
-- 5. desta_em_diante em S (outra série igual, S2): a paga continua ligada, a pendente sumiu, end_date = âncora − 1
-- 6. todas em S3: nenhuma transação com recurring_id = S3 e a série não existe
-- 7. desta_em_diante em P: fica a parcela paga; installments = 1 e total_cents = soma do que ficou
-- 8. todas em D: a dívida e o pagamento somem
-- 9. recusa: todas numa compra com parcela em fatura PAGA → erro, e a contagem de transações do plano é a mesma de antes
-- 10. alcance desconhecido → erro
```

(O arquivo final tem os dez blocos completos, com os valores acima; cada `raise exception` numera o caso.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `docker exec -i supabase_db_app-proops psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f - < supabase/tests/converter_registro.sql`
Expected: FAIL — `function public.converter_registro(jsonb, text, jsonb) does not exist`.

- [ ] **Step 3: A migration**

```sql
-- A conversão de tipo de um registro que existe (spec 2026-09-29, Parte 2): encerra a ORIGEM pelo
-- alcance escolhido e cria o DESTINO numa transação só. Qualquer recusa desfaz tudo.
create or replace function public.converter_registro(p_origem jsonb, p_alcance text, p_destino jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
set timezone to 'America/Sao_Paulo'
as $$
declare
  v_tipo text := p_origem->>'tipo';
  v_id uuid := (p_origem->>'id')::uuid;
  v_tx public.transactions;
  v_serie uuid;
  v_plano uuid;
  v_divida uuid;
  v_ancora date;
  v_novo jsonb;
  v_linha jsonb;
  v_dados jsonb := p_destino->'dados';
  v_destino text := p_destino->>'tipo';
begin
  if p_alcance not in ('so_esta', 'desta_em_diante', 'todas', 'manter', 'converter') then
    raise exception 'Alcance desconhecido: %', p_alcance;
  end if;

  if v_tipo = 'transacao' then
    select * into v_tx from public.transactions where id = v_id for update;
    if not found then raise exception 'Esse lançamento não existe mais.'; end if;
    v_serie := v_tx.recurring_id;
    v_plano := v_tx.installment_plan_id;
    v_divida := v_tx.debt_id;
    v_ancora := coalesce(v_tx.due_at, v_tx.occurred_at);
  elsif v_tipo = 'serie' then
    select id, (next_run_at at time zone 'America/Sao_Paulo')::date into v_serie, v_ancora
      from public.recurring_transactions where id = v_id for update;
    if v_serie is null then raise exception 'Essa recorrência não existe mais.'; end if;
  elsif v_tipo = 'plano' then
    select id into v_plano from public.installment_plans where id = v_id for update;
    if v_plano is null then raise exception 'Essa compra não existe mais.'; end if;
  elsif v_tipo = 'divida' then
    select id into v_divida from public.debts where id = v_id for update;
    if v_divida is null then raise exception 'Essa dívida não existe mais.'; end if;
  else
    raise exception 'Origem desconhecida: %', v_tipo;
  end if;

  -- MANTER: nada muda na origem
  if p_alcance = 'manter' then
    v_novo := private.criar_registro_da_hipotese(v_destino, v_dados);
    return jsonb_build_object('ids', v_novo->'ids');
  end if;

  -- SÓ ESTA: a ocorrência sai da série (a data fica "pulada") e segue como avulsa
  if p_alcance = 'so_esta' then
    if v_tx.id is null or v_serie is null then
      raise exception '"Só esta" vale para uma ocorrência de recorrente.';
    end if;
    update public.transactions set recurring_id = null where id = v_tx.id;
    perform public.skip_recurring_occurrence(v_serie, v_tx.occurred_at);
    v_serie := null;
  end if;

  -- CONVERTER (ou o que sobrou do "Só esta"): a própria linha vira o destino
  if p_alcance in ('converter', 'so_esta') then
    if v_tx.id is null or v_serie is not null or v_plano is not null or v_divida is not null then
      raise exception 'Só um lançamento avulso se converte no lugar.';
    end if;
    if v_destino = 'lancamento' then
      v_linha := v_dados->'linhas'->0;
      update public.transactions set
        kind = v_linha->>'kind', amount_cents = (v_linha->>'amount_cents')::bigint,
        category = v_linha->>'category', description = v_linha->>'description',
        merchant = v_linha->>'merchant', account_id = (v_linha->>'account_id')::uuid,
        occurred_at = (v_linha->>'occurred_at')::date, status = v_linha->>'status',
        due_at = (v_linha->>'due_at')::date, auto_confirm = coalesce((v_linha->>'auto_confirm')::boolean, false)
      where id = v_tx.id;
      return jsonb_build_object('ids', jsonb_build_array(v_tx.id));
    elsif v_destino = 'parcelada' then
      return jsonb_build_object('ids', jsonb_build_array(public.convert_transaction_to_installments(
        v_tx.id, (v_dados->>'p_total_cents')::bigint, (v_dados->>'p_installments')::int,
        (v_dados->>'p_occurred_at')::date, v_dados->>'p_description', v_dados->>'p_category',
        v_dados->>'p_merchant', (v_dados->>'p_account_id')::uuid,
        coalesce((v_dados->>'p_paid_installments')::int, 0))));
    elsif v_destino = 'recorrente' then
      v_novo := private.criar_registro_da_hipotese('recorrente', v_dados);
      update public.transactions set
        recurring_id = (v_novo->'ids'->>0)::uuid, kind = v_dados->>'kind',
        amount_cents = (v_dados->>'amount_cents')::bigint, description = v_dados->>'description',
        merchant = v_dados->>'merchant', category = v_dados->>'category',
        account_id = (v_dados->>'account_id')::uuid
      where id = v_tx.id;
      return jsonb_build_object('ids', v_novo->'ids');
    elsif v_destino = 'financiamento' then
      v_novo := private.criar_registro_da_hipotese('financiamento', v_dados);
      -- o gatilho do contrato só conta pagamento INSERIDO: a linha sai e volta como 1º pagamento
      delete from public.transactions where id = v_tx.id;
      if v_tx.kind = 'expense' and v_tx.status = 'cleared' then
        insert into public.transactions (kind, amount_cents, category, description, merchant,
          account_id, occurred_at, status, source, debt_id, user_id)
        values ('expense', v_tx.amount_cents, v_tx.category, v_tx.description, v_tx.merchant,
          v_tx.account_id, v_tx.occurred_at, 'cleared', 'app', (v_novo->'ids'->>0)::uuid, auth.uid());
      end if;
      return jsonb_build_object('ids', v_novo->'ids');
    end if;
    raise exception 'Destino desconhecido: %', v_destino;
  end if;

  -- TODAS: a origem some inteira (inclusive o pago), com a trava da fatura fechada
  if p_alcance = 'todas' then
    if exists (select 1 from public.transactions t
               where (t.recurring_id = v_serie or t.installment_plan_id = v_plano)
                 and t.invoice_id is not null and private.parcela_travada('pending', t.invoice_id)) then
      raise exception 'Há lançamento numa fatura paga ou adiada. Desfaça o pagamento da fatura antes.';
    end if;
    if v_serie is not null then
      delete from public.transactions where recurring_id = v_serie;
      delete from public.recurring_transactions where id = v_serie;
    elsif v_plano is not null then
      delete from public.installment_plans where id = v_plano;
    elsif v_divida is not null then
      perform public.delete_debt(v_divida);
    elsif v_tx.id is not null then
      delete from public.transactions where id = v_tx.id;
    end if;
  end if;

  -- DESTA EM DIANTE: o passado fica; o futuro da origem sai
  if p_alcance = 'desta_em_diante' then
    if v_serie is not null then
      perform public.update_recurring_series(v_serie, jsonb_build_object('end_date', v_ancora - 1), true);
      delete from public.transactions
        where recurring_id = v_serie and status = 'pending' and coalesce(due_at, occurred_at) >= v_ancora;
    elsif v_plano is not null then
      delete from public.transactions t
        where t.installment_plan_id = v_plano and not private.parcela_travada(t.status, t.invoice_id)
          and (v_tx.id is null or t.installment_no >= v_tx.installment_no);
      if not exists (select 1 from public.transactions where installment_plan_id = v_plano) then
        delete from public.installment_plans where id = v_plano;
      else
        update public.installment_plans p set
          installments = (select count(*) from public.transactions where installment_plan_id = v_plano),
          total_cents = (select sum(amount_cents) from public.transactions where installment_plan_id = v_plano)
        where p.id = v_plano;
      end if;
    elsif v_divida is not null then
      update public.debts set archived = true where id = v_divida;
    end if;
  end if;

  v_novo := private.criar_registro_da_hipotese(v_destino, v_dados);
  return jsonb_build_object('ids', v_novo->'ids');
end;
$$;

revoke execute on function public.converter_registro(jsonb, text, jsonb) from public, anon;
grant execute on function public.converter_registro(jsonb, text, jsonb) to authenticated;
```

Em `supabase/tests/anon_sem_execute.sql`, inserir `'converter_registro'` no array, depois de `'categories_used'`.

- [ ] **Step 4: Aplicar no Postgres local e rodar**

Run: `docker exec -i supabase_db_app-proops psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f - < supabase/migrations/20260929160000_converter_registro.sql && docker exec -i supabase_db_app-proops psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f - < supabase/tests/converter_registro.sql && docker exec -i supabase_db_app-proops psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f - < supabase/tests/anon_sem_execute.sql`
Expected: `converter_registro: ok` e o anon sem erro.

- [ ] **Step 5: Staging, tipos, histórico, commit**

Run: `scripts/supabase-target.sh && npx supabase db push` (alvo staging), depois `npx supabase gen types typescript --project-id utkqoiigimqzeenxkxdl > src/lib/database.types.ts`; linha nova em `docs/HISTORICO-DE-MIGRATIONS.md` ("staging 29/09/2026; produção pendente").

```bash
git add supabase/migrations/20260929160000_converter_registro.sql supabase/tests/converter_registro.sql supabase/tests/anon_sem_execute.sql src/lib/database.types.ts docs/HISTORICO-DE-MIGRATIONS.md
git commit -m "feat(lancar): converter_registro encerra a origem e cria o destino numa transação só"
```

---

### Task 2: A régua pura do hospedeiro (`src/lib/lancar.ts`)

**Files:**
- Create: `src/lib/lancar.ts`, `src/lib/lancar.test.ts`

**Interfaces:**
- Produces:
```ts
export type TipoDeLancamento = 'uma' | 'recorrente' | 'financiamento';
export type Comum = { kind: 'expense' | 'income' | 'transfer'; descricao: string; valorCents: number; contaId: string | null; dataBR: string; categoria: string | null };
export type OrigemDaConversao = {
  tipo: 'transacao' | 'serie' | 'plano' | 'divida';
  id: string;
  /** o que é a transação aberta: avulsa, ocorrência de série, parcela ou pagamento */
  papel: 'avulsa' | 'ocorrencia' | 'parcela' | 'pagamento' | 'registro';
  temPassado: boolean;
};
export type Alcance = 'so_esta' | 'desta_em_diante' | 'todas' | 'manter' | 'converter';
export type OpcaoDaConversao = { alcance: Alcance; label: string; destrutiva?: boolean };
export function opcoesDaConversao(o: OrigemDaConversao): OpcaoDaConversao[];
export function comumDepoisDeSalvar(c: Comum): Comum; // mantém kind, conta, data; limpa descricao, valor, categoria
export function comumParaSerie(c: Comum): Comum;       // transfer → expense
export const TIPOS_DE_LANCAMENTO: { value: TipoDeLancamento; label: string }[]; // Uma vez | Recorrente | Financiamento
export function hrefDoLancar(tipo: TipoDeLancamento, extra?: Record<string, string>): { pathname: '/finance/lancar'; params: Record<string, string> };
/** Sem saber, assume que TEM passado: a pergunta mostra "Todas, apagando…" (destrutiva, confirmada) em vez de um "Converter" que apagaria o pago calado. */
export function temPassadoDoParam(v: string | undefined): boolean;
```

- [ ] **Step 1: Teste**

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { comumDepoisDeSalvar, comumParaSerie, hrefDoLancar, opcoesDaConversao, temPassadoDoParam, TIPOS_DE_LANCAMENTO } from './lancar.ts';

const c = { kind: 'transfer' as const, descricao: 'Aluguel', valorCents: 150000, contaId: 'cc', dataBR: '05/10/2026', categoria: 'moradia' };

test('as quatro opções da spec, e só as que mudam alguma coisa', () => {
  const rotulos = (o: Parameters<typeof opcoesDaConversao>[0]) => opcoesDaConversao(o).map((x) => x.label);
  assert.deepEqual(rotulos({ tipo: 'transacao', id: 't', papel: 'avulsa', temPassado: false }), ['Converter', 'Manter e criar um novo']);
  assert.deepEqual(rotulos({ tipo: 'transacao', id: 't', papel: 'ocorrencia', temPassado: true }),
    ['Só esta', 'Desta em diante', 'Todas, apagando as anteriores', 'Manter o atual e criar um novo']);
  assert.deepEqual(rotulos({ tipo: 'serie', id: 's', papel: 'registro', temPassado: false }), ['Converter', 'Manter o atual e criar um novo']);
  assert.deepEqual(rotulos({ tipo: 'transacao', id: 't', papel: 'parcela', temPassado: true }),
    ['Desta em diante', 'Todas, apagando as anteriores', 'Manter o atual e criar um novo'], 'parcela não tem "Só esta"');
  assert.equal(opcoesDaConversao({ tipo: 'divida', id: 'd', papel: 'registro', temPassado: true }).find((o) => o.alcance === 'todas')?.destrutiva, true);
  // sem passado, "Converter" é o "todas" da série (não há o que apagar)
  assert.equal(opcoesDaConversao({ tipo: 'serie', id: 's', papel: 'registro', temPassado: false })[0].alcance, 'todas');
  assert.equal(opcoesDaConversao({ tipo: 'transacao', id: 't', papel: 'avulsa', temPassado: false })[0].alcance, 'converter');
});

test('sem saber se há passado, a opção destrutiva aparece (e é confirmada)', () => {
  assert.equal(temPassadoDoParam(undefined), true);
  assert.equal(temPassadoDoParam('1'), true);
  assert.equal(temPassadoDoParam('0'), false);
  const o = opcoesDaConversao({ tipo: 'serie', id: 's', papel: 'registro', temPassado: temPassadoDoParam(undefined) });
  assert.ok(o.some((x) => x.alcance === 'todas' && x.destrutiva));
});

test('"Salvar e criar outro" mantém tipo, conta e data, e limpa o resto', () => {
  assert.deepEqual(comumDepoisDeSalvar(c), { kind: 'transfer', descricao: '', valorCents: 0, contaId: 'cc', dataBR: '05/10/2026', categoria: null });
});

test('transferência não existe na recorrente: vira gasto', () => {
  assert.equal(comumParaSerie(c).kind, 'expense');
  assert.equal(comumParaSerie({ ...c, kind: 'income' }).kind, 'income');
});

test('o seletor tem três opções e o link carrega o tipo', () => {
  assert.deepEqual(TIPOS_DE_LANCAMENTO.map((t) => t.label), ['Uma vez', 'Recorrente', 'Financiamento']);
  assert.deepEqual(hrefDoLancar('recorrente', { id: 'r1' }), { pathname: '/finance/lancar', params: { tipo: 'recorrente', id: 'r1' } });
});
```

- [ ] **Step 2: Ver falhar** — Run: `node --test src/lib/lancar.test.ts` — Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar**

```ts
/**
 * A régua do formulário único (spec 2026-09-29): os tipos, os campos comuns que viajam entre eles e
 * as opções da pergunta de conversão — pura, para as três telas e o teste lerem a mesma coisa.
 */
export type TipoDeLancamento = 'uma' | 'recorrente' | 'financiamento';
export type Comum = { kind: 'expense' | 'income' | 'transfer'; descricao: string; valorCents: number; contaId: string | null; dataBR: string; categoria: string | null };
export type OrigemDaConversao = { tipo: 'transacao' | 'serie' | 'plano' | 'divida'; id: string; papel: 'avulsa' | 'ocorrencia' | 'parcela' | 'pagamento' | 'registro'; temPassado: boolean };
export type Alcance = 'so_esta' | 'desta_em_diante' | 'todas' | 'manter' | 'converter';
export type OpcaoDaConversao = { alcance: Alcance; label: string; destrutiva?: boolean };

export const TIPOS_DE_LANCAMENTO: { value: TipoDeLancamento; label: string }[] = [
  { value: 'uma', label: 'Uma vez' },
  { value: 'recorrente', label: 'Recorrente' },
  { value: 'financiamento', label: 'Financiamento' },
];

export function opcoesDaConversao(o: OrigemDaConversao): OpcaoDaConversao[] {
  if (o.papel === 'avulsa') return [{ alcance: 'converter', label: 'Converter' }, { alcance: 'manter', label: 'Manter e criar um novo' }];
  const manter: OpcaoDaConversao = { alcance: 'manter', label: 'Manter o atual e criar um novo' };
  const soEsta: OpcaoDaConversao[] = o.papel === 'ocorrencia' ? [{ alcance: 'so_esta', label: 'Só esta' }] : [];
  // sem passado, "Desta em diante" e "Todas" dão o mesmo resultado: um "Converter" só
  if (!o.temPassado) return [...soEsta, { alcance: 'todas', label: 'Converter' }, manter];
  return [
    ...soEsta,
    { alcance: 'desta_em_diante', label: 'Desta em diante' },
    { alcance: 'todas', label: 'Todas, apagando as anteriores', destrutiva: true },
    manter,
  ];
}

export function comumDepoisDeSalvar(c: Comum): Comum {
  return { ...c, descricao: '', valorCents: 0, categoria: null };
}

export function comumParaSerie(c: Comum): Comum {
  return c.kind === 'transfer' ? { ...c, kind: 'expense' } : c;
}

export function hrefDoLancar(tipo: TipoDeLancamento, extra: Record<string, string> = {}) {
  return { pathname: '/finance/lancar' as const, params: { tipo, ...extra } };
}

export function temPassadoDoParam(v: string | undefined): boolean {
  return v !== '0';
}
```

- [ ] **Step 4: Ver passar** — Run: `node --test src/lib/lancar.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit** — `git add src/lib/lancar.ts src/lib/lancar.test.ts && git commit -m "feat(lancar): a régua do formulário único e das opções de conversão"`

---

### Task 3: `useConverterRegistro`

**Files:**
- Modify: `src/hooks/use-finance.ts` (depois de `useSimulacao`), `src/lib/simple-finance-ui.test.ts` (mock `useConverterRegistro: () => mutation('converterRegistro')`)

**Interfaces:**
- Consumes: `converter_registro` (Task 1), `OrigemDaConversao`/`Alcance` (Task 2), `RegistroSimulado` (`src/lib/hipotese.ts`).
- Produces: `useConverterRegistro()` → `useMutation<{ ids: string[] }, Error, { origem: OrigemDaConversao; alcance: Alcance; destino: RegistroSimulado }>`, que invalida `FINANCE_KEYS` no `onSuccess` (a mesma lista de `invalidate` das outras mutações de lançamento).

- [ ] **Step 1: Teste (anti-slop, falha)** — em `src/lib/anti-slop.test.ts`:

```ts
test('A conversão passa pela RPC converter_registro e invalida o financeiro', () => {
  const fonte = readFileSync(join(SRC, 'hooks/use-finance.ts'), 'utf8');
  const i = fonte.indexOf('export function useConverterRegistro');
  assert.ok(i > 0);
  const corpo = fonte.slice(i, i + 900);
  assert.match(corpo, /supabase\.rpc\('converter_registro'/);
  assert.match(corpo, /p_alcance: v\.alcance/);
  assert.match(corpo, /p_destino: v\.destino/);
  assert.match(corpo, /onSuccess: invalidate/);
});
```

- [ ] **Step 2: Ver falhar** — Run: `node --test --test-name-pattern="converter_registro" src/lib/anti-slop.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implementar**

```ts
/**
 * Mudar o tipo de um registro que existe (spec 2026-09-29, Parte 2): a origem encerra pelo alcance e
 * o destino nasce, numa transação só no banco — nunca dois passos pelo app.
 */
export function useConverterRegistro() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (v: { origem: OrigemDaConversao; alcance: Alcance; destino: RegistroSimulado }) => {
      const { data, error } = await supabase.rpc('converter_registro', { p_origem: { tipo: v.origem.tipo, id: v.origem.id }, p_alcance: v.alcance, p_destino: v.destino as never });
      if (error) throw error;
      return data as { ids: string[] };
    },
    onSuccess: invalidate,
  });
}
```

(`useInvalidateFinance` é o helper que as mutações de lançamento já usam em `use-finance.ts`.)

- [ ] **Step 4: Ver passar + portão** — Run: `npx tsc --noEmit && node --test src/lib/anti-slop.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -am "feat(lancar): useConverterRegistro"`

---

### Task 4: `FormularioDaSerie` sai de `recurring.tsx`

**Files:**
- Create: `src/components/finance/corpo-do-lancar.ts`, `src/components/finance/formulario-da-serie.tsx`
- Modify: `src/app/finance/recurring.tsx`
- Test: `src/lib/simple-finance-ui.test.ts`

**Interfaces:**
- Produces (`corpo-do-lancar.ts`):
```ts
import type { ReactNode } from 'react';
import type { Comum, OrigemDaConversao } from '@/lib/lancar';
import type { RegistroSimulado } from '@/lib/hipotese';

/** O contrato dos três corpos do formulário único. */
export type CorpoProps = {
  /** O seletor de tipo, desenhado pelo hospedeiro no TOPO da rolagem do corpo. */
  topo?: ReactNode;
  /** Os campos comuns ao montar (vindos do tipo anterior, ou dos parâmetros). */
  comum: Comum;
  /** O hospedeiro lê os campos comuns do corpo na hora de trocar de tipo. */
  registrarComum: (ler: () => Comum) => void;
  /** O estado INTEIRO do corpo (o objeto do formulário dele), para voltar a este tipo sem perder nada. */
  registrarEstado: (ler: () => unknown) => void;
  /** O que foi digitado neste tipo antes de a pessoa trocar para outro; vence o `comum` ao montar. */
  estadoGuardado?: unknown;
  /** Editando: o id do registro DESTE tipo. */
  editandoId?: string;
  /** Convertendo: o registro de OUTRO tipo que está virando este. Salvar chama `converter`. */
  converter?: (destino: RegistroSimulado) => void;
  /** Criando: `criarOutro` = "Salvar e criar outro". */
  onSalvo: (criarOutro: boolean) => void;
  onFechar: () => void;
  /** Aberta pelo "Aplicar" de uma hipótese: salvar a tira do rascunho. */
  deHipotese?: string;
};
```
- `FormularioDaSerie(props: CorpoProps & { preset?: SerieForm['preset'] })` — desenha `TaskHeader` + `KeyboardAwareScrollView` (`keyboardShouldPersistTaps="handled"`) com `{props.topo}` e `<CamposDaSerie>`, e no FIM, só criando (`!editandoId && !converter`), `<Button variant="secondary" block label="Salvar e criar outro">`.

- [ ] **Step 1: Teste (falha)** — acrescentar a `simple-finance-ui.test.ts` (mock do `CamposDaSerie` já existe na linha ~316):

```ts
test('FormularioDaSerie: cria, e "Salvar e criar outro" avisa o hospedeiro sem fechar', async () => {
  const salvos: boolean[] = [];
  const comum = { kind: 'expense', descricao: 'Academia', valorCents: 5000, contaId: 'cc', dataBR: '06/10/2026', categoria: null };
  const ui = screen('src/components/finance/formulario-da-serie.tsx', { componente: 'FormularioDaSerie', segurarMutacoes: true,
    props: { comum, registrarComum: () => {}, onSalvo: (outro: boolean) => salvos.push(outro), onFechar: () => {} } });
  ui.interact(() => ui.nodes().find((n: any) => n.type === 'Button' && n.props.label === 'Salvar e criar outro').props.onPress());
  assert.equal(ui.writes.at(-1).operation, 'createRecurring');
  (ui.pedidos.at(-1) as any).resolver('rec-1');
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(salvos, [true]);
  // editando não há "criar outro"
  const edit = screen('src/components/finance/formulario-da-serie.tsx', { componente: 'FormularioDaSerie', recurring: [{ id: 'r1', kind: 'expense', amount_cents: 5000, description: 'Academia', rrule: 'FREQ=MONTHLY;BYMONTHDAY=6', next_run_at: '2026-10-06T12:00:00Z', dtstart: '2026-10-06T12:00:00Z', active: true, account_id: null, category: null, merchant: null, end_date: null, auto_confirm: false }],
    props: { comum, registrarComum: () => {}, editandoId: 'r1', onSalvo: () => {}, onFechar: () => {} } });
  assert.equal(edit.nodes().some((n: any) => n.props?.label === 'Salvar e criar outro'), false);
});
```

- [ ] **Step 2: Ver falhar** — Run: `node --test --test-name-pattern="FormularioDaSerie" src/lib/simple-finance-ui.test.ts` — Expected: FAIL (arquivo não existe).

- [ ] **Step 3: Extrair**

Mover de `src/app/finance/recurring.tsx` para `src/components/finance/formulario-da-serie.tsx`, **sem mudar a regra**:
- os hooks `useCreateRecurring`, `useSaveRecurringSeries` (`editar`), `useSaveRecurringAll` (`editarTudo`), os refs `tentativaTudo`/`tentativaFuturo`, `useToast`, `useAccounts`, `useRascunho().tirar`, o objeto `montado`;
- `validaSerie(form)` e a função `salvar` inteira (hoje linhas 205-325), trocando: `volta.aoFechar(() => setForm(null))` → `props.onFechar()` (edição sem mudança e sucesso da edição); o sucesso da criação → `toast(...)` + `props.onSalvo(criarOutro)`; `tirar(params.deHipotese)` → `if (props.deHipotese) tirar(props.deHipotese)`;
- o estado inicial do formulário: editando, `serieDoRegistro(<a série de useRecurringTransactions com id = editandoId>)`; criando, `{ ...SERIE_VAZIA, kind: comumParaSerie(comum).kind === 'income' ? 'income' : 'expense', preset: props.preset ?? SERIE_VAZIA.preset, amountCents: comum.valorCents, description: comum.descricao, category: comum.categoria, accountId: comum.contaId, inicio: comum.dataBR }`;
- `props.registrarComum(() => ({ kind: form.kind, descricao: form.description, valorCents: form.amountCents, contaId: form.accountId, dataBR: form.inicio, categoria: form.category }))` e `props.registrarEstado(() => form)` num `useEffect` a cada render do form;
- com `props.estadoGuardado`, ele É o estado inicial (`(props.estadoGuardado as SerieForm | undefined) ?? <o de cima>`);
- com `props.converter`: o Salvar monta `{ tipo: 'recorrente', dados: linhaDaRecorrente(<a mesma EntradaRecorrente da criação>) }` e chama `props.converter(destino)` em vez de `create`.

Em `recurring.tsx`: a folha (`folhaDoFormulario`) passa a renderizar `<FormularioDaSerie>` dentro do `Sheet` com `comum` montado dos parâmetros e `onFechar`/`onSalvo` = `volta.aoFechar(() => setForm(null))` — a tela continua funcionando igual até a Task 8 trocar as entradas.

- [ ] **Step 4: Ver passar + suíte** — Run: `node --test src/lib/simple-finance-ui.test.ts && npx tsc --noEmit && npx expo lint` — Expected: PASS (os testes de Recorrentes seguem verdes).

- [ ] **Step 5: Commit** — `git add -A src/components/finance/corpo-do-lancar.ts src/components/finance/formulario-da-serie.tsx src/app/finance/recurring.tsx src/lib/simple-finance-ui.test.ts && git commit -m "refactor(recorrente): o formulário da série vira um corpo reaproveitável"`

---

### Task 5: `FormularioDaDivida` sai de `debts.tsx`

**Files:**
- Create: `src/components/finance/formulario-da-divida.tsx`
- Modify: `src/app/finance/debts.tsx`
- Test: `src/lib/simple-finance-ui.test.ts`

**Interfaces:**
- Consumes: `CorpoProps` (Task 4).
- Produces: `FormularioDaDivida(props: CorpoProps & { dadosDoAplicar?: { parcela?: string; parcelas?: string; conta?: string; data?: string } })`.

- [ ] **Step 1: Teste (falha)**

```ts
test('FormularioDaDivida: o comum vira Nome, Conta que paga e Valor da parcela; criar outro avisa o hospedeiro', async () => {
  const salvos: boolean[] = [];
  const comum = { kind: 'expense', descricao: 'Carro 2', valorCents: 147000, contaId: 'cc', dataBR: '31/10/2026', categoria: null };
  const ui = screen('src/components/finance/formulario-da-divida.tsx', { componente: 'FormularioDaDivida', segurarMutacoes: true, forecastAccounts: [{ id: 'cc', name: 'Itaú', type: 'checking' }],
    props: { comum, registrarComum: () => {}, onSalvo: (o: boolean) => salvos.push(o), onFechar: () => {} } });
  assert.ok(ui.nodes().some((n: any) => n.type === 'MoneyField' && n.props.valueCents === 147000));
  ui.fill('Total de parcelas', '48');
  ui.interact(() => ui.nodes().find((n: any) => n.type === 'Button' && n.props.label === 'Salvar e criar outro').props.onPress());
  assert.equal(ui.writes.at(-1).value.name, 'Carro 2');
  (ui.pedidos.at(-1) as any).resolver('d1');
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(salvos, [true]);
});
```

- [ ] **Step 2: Ver falhar** — Run: `node --test --test-name-pattern="FormularioDaDivida" src/lib/simple-finance-ui.test.ts` — Expected: FAIL.

- [ ] **Step 3: Extrair** — mover de `debts.tsx` para o componente, sem mudar a regra: `FormState`, `UNIDADES_DA_DIVIDA`, `FORM_VAZIO`, `formDoAplicar`, o `useState` do form, `save`/`saveScoped`/`contractAttempt`, as consultas `schedule`/`payments`/`paymentVersions` chaveadas no `form.id`, `pagadoras`, `abrirEdicao` (vira o estado inicial quando `editandoId`, lendo a dívida de `useDebts()`), todas as derivações (`fracao` … `podeSalvar`, hoje 379-463), `salvar` (466-576) e o JSX da folha de criar/editar (1019-1269, do `TaskHeader` ao fim dos campos), trocando:
- estado inicial criando: `dadosDoAplicar ? formDoAplicar(dadosDoAplicar) : { ...FORM_VAZIO, kind: 'financing', name: comum.descricao, valorCents: comum.valorCents, installmentCents: comum.valorCents, accountId: comum.contaId, ancora: comum.dataBR ? brToISO(comum.dataBR) : null, diaVencimento: comum.dataBR ? String(Number(comum.dataBR.slice(0, 2))) : '' }`;
- `registrarComum(() => ({ kind: 'expense', descricao: form.name, valorCents: form.valorCents, contaId: form.accountId, dataBR: form.ancora ? isoToBR(form.ancora) : comum.dataBR, categoria: comum.categoria }))` e `registrarEstado(() => form)`; com `estadoGuardado`, ele é o estado inicial (`as FormState`);
- sucesso: criando → `props.onSalvo(criarOutro)`; editando → `props.onFechar()`; `volta.*` sai do corpo;
- com `props.converter`: Salvar monta `{ tipo: 'financiamento', dados: linhaDoFinanciamento(<o mesmo target da criação>) }` e chama `props.converter(destino)`;
- no fim do conteúdo, só criando, o botão "Salvar e criar outro".

`debts.tsx` passa a renderizar `<FormularioDaDivida>` dentro do mesmo `Sheet` (a folha de pagar fica onde está).

- [ ] **Step 4: Ver passar + suíte** — Run: `node --test src/lib/simple-finance-ui.test.ts && npx tsc --noEmit && npx expo lint` — Expected: PASS (os ~40 testes de Dívidas seguem verdes).

- [ ] **Step 5: Commit** — `git commit -am "refactor(dividas): o formulário da dívida vira um corpo reaproveitável"` (com o arquivo novo no `git add`).

---

### Task 6: `FormularioDoLancamento` sai de `transaction-form.tsx`

**Files:**
- Create: `src/components/finance/formulario-do-lancamento.tsx`
- Modify: `src/app/finance/transaction-form.tsx`, `src/lib/anti-slop.test.ts` (os testes que leem o texto de `transaction-form.tsx` passam a ler o componente)

**Interfaces:**
- Produces: `FormularioDoLancamento(props: CorpoProps & { editing?: Transaction; plano?: InstallmentPlanSummary; jurosDoPix?: { id: string; amount_cents: number } | null; daRapida?: {...} })` — o `TransactionForm` de hoje com `CorpoProps`.

- [ ] **Step 1: Teste (falha)** — em `anti-slop.test.ts`:

```ts
test('O lançamento é um corpo do formulário único: seletor no topo, criar outro no fim, e converte', () => {
  const f = readFileSync(join(SRC, 'components/finance/formulario-do-lancamento.tsx'), 'utf8');
  assert.match(f, /export function FormularioDoLancamento\(/);
  assert.ok(f.indexOf('{props.topo}') > 0 && f.indexOf('{props.topo}') < f.indexOf('options={KINDS}'), 'o seletor vem antes do tipo');
  assert.match(f, /label="Salvar e criar outro"/);
  assert.match(f, /props\.converter\(/);
  assert.match(f, /props\.registrarComum\(/);
});
```

- [ ] **Step 2: Ver falhar** — Run: `node --test --test-name-pattern="corpo do formulário único" src/lib/anti-slop.test.ts` — Expected: FAIL.

- [ ] **Step 3: Mover** — o `schema`, `KINDS`, `FormValues` e o componente `TransactionForm` inteiro (hoje 97-161 e 249-1590) vão para `formulario-do-lancamento.tsx`, renomeado `FormularioDoLancamento`. Mudanças:
- o `TaskHeader` fica como está; `{props.topo}` é o PRIMEIRO filho do `KeyboardAwareScrollView`;
- saem os botões "Recorrente | Financiamento" do topo, `styles.outrosRegistros`/`outroRegistro` e o import de `ATALHOS_DE_LANCAMENTO` (o seletor faz o papel deles);
- `defaultValues` criando leem `comum`: `kind: comum.kind`, `amount_cents: comum.valorCents`, `description: comum.descricao`, `account_id: comum.contaId`, `occurred_at: comum.dataBR`, `category: comum.categoria` (editando, continua `editing`);
- `props.registrarComum(() => { const v = getValues(); return { kind: v.kind, descricao: v.description, valorCents: v.amount_cents, contaId: v.account_id, dataBR: v.occurred_at, categoria: v.category }; })` e `props.registrarEstado(() => getValues())` num `useEffect`; com `estadoGuardado`, os `defaultValues` são ele (`as FormValues`);
- com `props.converter`: o `onSubmit` monta o destino pelo mesmo `destinoDoSalvar`: `criarPlano` → `{ tipo: 'parcelada', dados: { ...argsDaParcelada(entradaParcelada).args, ultimo_dia: … } }`; os outros → `{ tipo: 'lancamento', dados: { linhas: linhasDoLancamento(entradaLancamento) } }`, e chama `props.converter(destino)`;
- o sucesso da criação (`createPlan.then`, `gravar.then`) chama `props.onSalvo(criarOutro)` em vez de `router.back()`; o `criarOutro` vem do botão novo "Salvar e criar outro" (fim do conteúdo, antes de "Apagar", só `!editing && !props.converter`), que chama o mesmo `onSubmit` com a flag;
- `onClose` do `TaskHeader` → `props.onFechar`.

`transaction-form.tsx` fica só com o `TransactionFormScreen` (as consultas e os portões de hoje) renderizando `<FormularioDoLancamento>` com `onFechar={() => router.back()}` e `onSalvo={() => router.back()}` — até a Task 8, que o troca por um redirecionamento.

Os testes de `anti-slop.test.ts` que leem o texto de `transaction-form.tsx` (linhas 1373, 1389, 1474, 1569, 1597, 1610, 1620, 1699, 1752) passam a ler `components/finance/formulario-do-lancamento.tsx`; o de 1398 (a chave `<TransactionForm key=…>`) passa a conferir `<FormularioDoLancamento key=…>`; os de 1836 e 1857 (botões do topo) saem — o comportamento deles vira o seletor (Task 7).

- [ ] **Step 4: Ver passar + portão** — Run: `npx tsc --noEmit && npx expo lint && npm test` — Expected: PASS.

- [ ] **Step 5: Commit** — `git add -A src/components/finance/formulario-do-lancamento.tsx src/app/finance/transaction-form.tsx src/lib/anti-slop.test.ts && git commit -m "refactor(lancamento): o formulário do lançamento vira um corpo reaproveitável"`

---

### Task 7: O hospedeiro `/finance/lancar`

**Files:**
- Create: `src/app/finance/lancar.tsx`
- Modify: `src/app/_layout.tsx` (registrar com `modalOptions`), `src/lib/simple-finance-ui.test.ts`

**Interfaces:**
- Consumes: `TIPOS_DE_LANCAMENTO`, `Comum`, `opcoesDaConversao`, `comumDepoisDeSalvar`, `comumParaSerie` (Task 2); `useConverterRegistro` (Task 3); os três corpos (Tasks 4-6).
- Produces: a rota `/finance/lancar?tipo=uma|recorrente|financiamento[&id=][&origem=transacao|serie|divida][&conta=][&deHipotese=][&kind=&amount=&data=&parcelas=&repete=&parcela=]`.

- [ ] **Step 1: Testes (falham)**

```ts
const lancarFile = 'src/app/finance/lancar.tsx';

test('Lançar: abre no tipo pedido, o seletor troca o corpo e leva os campos comuns', () => {
  const ui = screen(lancarFile, { params: { tipo: 'recorrente' } });
  const seletor = () => ui.nodes().find((n: any) => n.type === 'Segmented' && n.props.options.some((o: any) => o.value === 'financiamento'));
  assert.equal(seletor().props.value, 'recorrente');
  assert.ok(ui.nodes().some((n: any) => n.type === 'FormularioDaSerie'));
  // o corpo registra o comum; trocar de tipo o entrega ao outro corpo
  const serie = ui.nodes().find((n: any) => n.type === 'FormularioDaSerie');
  ui.interact(() => serie.props.registrarComum(() => ({ kind: 'expense', descricao: 'Academia', valorCents: 5000, contaId: 'cc', dataBR: '06/10/2026', categoria: 'saude' })));
  ui.interact(() => seletor().props.onChange('uma'));
  const lanc = ui.nodes().find((n: any) => n.type === 'FormularioDoLancamento');
  assert.equal(lanc.props.comum.descricao, 'Academia');
  assert.equal(lanc.props.comum.valorCents, 5000);
});

test('Lançar: voltar a um tipo devolve TUDO que foi digitado nele, não só os campos comuns', () => {
  const ui = screen(lancarFile, { params: { tipo: 'recorrente' } });
  const seletor = () => ui.nodes().find((n: any) => n.type === 'Segmented' && n.props.options.some((o: any) => o.value === 'financiamento'));
  const serie = () => ui.nodes().find((n: any) => n.type === 'FormularioDaSerie');
  const digitado = { preset: 'weekly', description: 'Academia', amountCents: 5000 };
  ui.interact(() => serie().props.registrarEstado(() => digitado));
  ui.interact(() => seletor().props.onChange('uma'));
  ui.interact(() => seletor().props.onChange('recorrente'));
  assert.deepEqual(serie().props.estadoGuardado, digitado);
  // "Salvar e criar outro" esvazia o guardado
  ui.interact(() => serie().props.onSalvo(true));
  assert.equal(serie().props.estadoGuardado, undefined);
});

test('Lançar: "Salvar e criar outro" remonta o corpo limpo, mantendo tipo, conta e data', () => {
  const ui = screen(lancarFile, { params: { tipo: 'recorrente' } });
  const serie = () => ui.nodes().find((n: any) => n.type === 'FormularioDaSerie');
  ui.interact(() => serie().props.registrarComum(() => ({ kind: 'income', descricao: 'Freela', valorCents: 90000, contaId: 'cc', dataBR: '10/10/2026', categoria: 'freela' })));
  ui.interact(() => serie().props.onSalvo(true));
  assert.deepEqual(JSON.parse(JSON.stringify(serie().props.comum)), { kind: 'income', descricao: '', valorCents: 0, contaId: 'cc', dataBR: '10/10/2026', categoria: null });
  assert.equal(ui.navigations.length, 0, 'não fechou');
  ui.interact(() => serie().props.onSalvo(false));
  assert.deepEqual(JSON.parse(JSON.stringify(ui.navigations.at(-1))), { back: true });
});

test('Lançar: editando e trocando o tipo, o salvar PERGUNTA o alcance e converte; voltar ao tipo original é edição comum', async () => {
  const ui = screen(lancarFile, { segurarMutacoes: true, params: { tipo: 'recorrente', id: 'r1', origem: 'serie' },
    recurring: [{ id: 'r1', kind: 'expense', amount_cents: 5000, description: 'Academia', rrule: 'FREQ=MONTHLY;BYMONTHDAY=6', next_run_at: '2026-10-06T12:00:00Z', dtstart: '2026-09-06T12:00:00Z', active: true, account_id: null, category: null, merchant: null, end_date: null, auto_confirm: false }] });
  const seletor = () => ui.nodes().find((n: any) => n.type === 'Segmented' && n.props.options.some((o: any) => o.value === 'financiamento'));
  // no tipo original o corpo recebe editandoId e NÃO recebe converter
  assert.equal(ui.nodes().find((n: any) => n.type === 'FormularioDaSerie').props.editandoId, 'r1');
  assert.equal(ui.nodes().find((n: any) => n.type === 'FormularioDaSerie').props.converter, undefined);
  ui.interact(() => seletor().props.onChange('uma'));
  const lanc = ui.nodes().find((n: any) => n.type === 'FormularioDoLancamento');
  ui.interact(() => lanc.props.converter({ tipo: 'lancamento', dados: { linhas: [] } }));
  assert.deepEqual(ui.actions.map((a: any) => a.label), ['Converter', 'Manter o atual e criar um novo'], 'série sem passado');
  ui.interact(() => ui.actions[0].onPress());
  assert.equal(ui.writes.at(-1).operation, 'converterRegistro');
  assert.equal(ui.writes.at(-1).value.alcance, 'todas');
  (ui.pedidos.at(-1) as any).resolver({ ids: ['t9'] });
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(JSON.parse(JSON.stringify(ui.navigations.at(-1))), { back: true });
  // volta ao original antes de salvar: sem converter
  const volta = screen(lancarFile, { params: { tipo: 'recorrente', id: 'r1', origem: 'serie' }, recurring: [] });
  const s2 = () => volta.nodes().find((n: any) => n.type === 'Segmented' && n.props.options.some((o: any) => o.value === 'financiamento'));
  volta.interact(() => s2().props.onChange('uma'));
  volta.interact(() => s2().props.onChange('recorrente'));
  assert.equal(volta.nodes().find((n: any) => n.type === 'FormularioDaSerie').props.converter, undefined);
});

test('Lançar: a conversão que o banco recusa mostra a frase dele e não fecha', async () => {
  const ui = screen(lancarFile, { segurarMutacoes: true, params: { tipo: 'uma', id: 'tx-1', origem: 'transacao' } });
  const seletor = () => ui.nodes().find((n: any) => n.type === 'Segmented' && n.props.options.some((o: any) => o.value === 'financiamento'));
  ui.interact(() => seletor().props.onChange('recorrente'));
  ui.interact(() => ui.nodes().find((n: any) => n.type === 'FormularioDaSerie').props.converter({ tipo: 'recorrente', dados: {} }));
  ui.interact(() => ui.actions.find((a: any) => a.label === 'Converter').onPress());
  (ui.pedidos.at(-1) as any).rejeitar({ code: 'P0001', message: 'Há lançamento numa fatura paga ou adiada. Desfaça o pagamento da fatura antes.' });
  await new Promise((r) => setTimeout(r, 0));
  assert.match(ui.toasts.at(-1).message, /fatura paga/);
  assert.equal(ui.navigations.length, 0);
});
```

(`pedidos.at(-1).rejeitar` existe no harness ao lado de `resolver`; se o nome local for outro, usar o que `segurarMutacoes` expõe.)

- [ ] **Step 2: Ver falhar** — Run: `node --test --test-name-pattern="Lançar:" src/lib/simple-finance-ui.test.ts` — Expected: FAIL (a tela não existe).

- [ ] **Step 3: Implementar `src/app/finance/lancar.tsx`**

```tsx
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Animated, { runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { FormularioDaDivida } from '@/components/finance/formulario-da-divida';
import { FormularioDaSerie } from '@/components/finance/formulario-da-serie';
import { FormularioDoLancamento } from '@/components/finance/formulario-do-lancamento';
import { useToast } from '@/components/ui/toast';
import { Segmented } from '@/components/ui/segmented';
import { Motion } from '@/design/tokens';
import { useConverterRegistro } from '@/hooks/use-finance';
import { financeErrorMessage } from '@/lib/finance-form';
import { showItemActions, confirmDestructive } from '@/lib/item-actions';
import { comumDepoisDeSalvar, comumParaSerie, opcoesDaConversao, TIPOS_DE_LANCAMENTO, type Comum, type OrigemDaConversao, type TipoDeLancamento } from '@/lib/lancar';
import { isoToBR, localISODate } from '@/lib/dates';
import type { RegistroSimulado } from '@/lib/hipotese';

/**
 * O formulário único (spec 2026-09-29): um seletor, três corpos, e os campos comuns viajando entre
 * eles. Editar abre no tipo do registro; trocar o tipo e salvar pergunta o alcance e converte.
 */
export default function LancarScreen() {
  const p = useLocalSearchParams<Record<string, string>>();
  const tipoOriginal = (TIPOS_DE_LANCAMENTO.some((t) => t.value === p.tipo) ? p.tipo : 'uma') as TipoDeLancamento;
  const [tipo, setTipo] = useState<TipoDeLancamento>(tipoOriginal);
  const [comum, setComum] = useState<Comum>(() => ({
    kind: p.kind === 'income' ? 'income' : 'expense',
    descricao: p.description ?? '',
    valorCents: Number(p.amount) > 0 ? Number(p.amount) : 0,
    contaId: p.conta ?? p.account ?? null,
    dataBR: p.data ?? p.start ?? isoToBR(localISODate()),
    categoria: p.category || null,
  }));
  const [geracao, setGeracao] = useState(0);
  const lerComum = useRef<() => Comum>(() => comum);
  const lerEstado = useRef<() => unknown>(() => undefined);
  const estados = useRef<Partial<Record<TipoDeLancamento, unknown>>>({});
  const toast = useToast();
  const converter = useConverterRegistro();
  const reduzir = useReducedMotion();
  const opacidade = useSharedValue(1);
  const estilo = useAnimatedStyle(() => ({ opacity: opacidade.value }));

  const editandoId = p.id;
  const origem: OrigemDaConversao | null = editandoId
    ? { tipo: (p.origem as OrigemDaConversao['tipo']) ?? 'transacao', id: editandoId, papel: (p.papel as OrigemDaConversao['papel']) ?? (p.origem === 'transacao' ? 'avulsa' : 'registro'), temPassado: temPassadoDoParam(p.passado) }
    : null;

  const trocar = (novo: TipoDeLancamento) => {
    if (novo === tipo) return;
    const atual = lerComum.current();
    estados.current[tipo] = lerEstado.current();
    const aplicar = () => {
      setComum(novo === 'recorrente' ? comumParaSerie(atual) : atual);
      setTipo(novo);
    };
    if (reduzir) return aplicar();
    // crossfade curto: some o corpo, troca, volta (design.md §5 — sem animação de layout no Android)
    opacidade.value = withTiming(0, { duration: Motion.duration.fast }, () => {
      runOnJS(aplicar)();
      opacidade.value = withTiming(1, { duration: Motion.duration.base });
    });
  };

  const onSalvo = (criarOutro: boolean) => {
    if (!criarOutro) return router.back();
    setComum(comumDepoisDeSalvar(lerComum.current()));
    estados.current = {};
    setGeracao((g) => g + 1);
  };

  const converterPara = (destino: RegistroSimulado) => {
    if (!origem) return;
    const acoes = opcoesDaConversao(origem).map((o) => ({
      label: o.label,
      destructive: o.destrutiva,
      onPress: () => {
        const ir = () =>
          converter.mutateAsync({ origem, alcance: o.alcance, destino }).then(
            () => router.back(),
            (e) => toast({ message: financeErrorMessage(e, 'Não deu para mudar o tipo.'), tone: 'error' })
          );
        if (o.destrutiva) confirmDestructive('Apagar o que já aconteceu?', 'Apagar e converter', ir, 'Os lançamentos já pagos também saem. Isso não volta.');
        else void ir();
      },
    }));
    showItemActions(`Mudar para ${TIPOS_DE_LANCAMENTO.find((t) => t.value === tipo)!.label}`, acoes);
  };

  const topo = (
    <Segmented<TipoDeLancamento> options={TIPOS_DE_LANCAMENTO} value={tipo} onChange={trocar} />
  );
  const base = {
    topo,
    comum,
    registrarComum: (ler: () => Comum) => { lerComum.current = ler; },
    registrarEstado: (ler: () => unknown) => { lerEstado.current = ler; },
    estadoGuardado: estados.current[tipo],
    onSalvo,
    onFechar: () => router.back(),
    deHipotese: p.deHipotese,
    editandoId: tipo === tipoOriginal ? editandoId : undefined,
    converter: editandoId && tipo !== tipoOriginal ? converterPara : undefined,
  };

  return (
    <Animated.View style={[styles.fill, estilo]}>
      {tipo === 'uma' ? (
        <FormularioDoLancamento key={`uma:${geracao}`} {...base} />
      ) : tipo === 'recorrente' ? (
        <FormularioDaSerie key={`rec:${geracao}`} {...base} preset={p.repete === 'weekly' || p.repete === 'yearly' ? p.repete : undefined} />
      ) : (
        <FormularioDaDivida key={`fin:${geracao}`} {...base} dadosDoAplicar={p.deHipotese ? { parcela: p.parcela, parcelas: p.parcelas, conta: p.conta, data: p.data } : undefined} />
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
```

Notas de implementação:
- O `FormularioDoLancamento` editando precisa das consultas de hoje (`useTransaction`, `useInstallmentPlan`, `useJurosDoPix`) e dos portões de esqueleto: mover o `TransactionFormScreen` de `transaction-form.tsx` para um componente `LancamentoEditando` dentro de `formulario-do-lancamento.tsx`, que o hospedeiro usa quando `tipo === 'uma' && editandoId`.
- `papel` e `passado` chegam na rota pelas entradas (Task 8): a transação sabe o que é (`recurring_id` → `ocorrencia`, `installment_plan_id` → `parcela`, `debt_id` → `pagamento`, senão `avulsa`). `passado=0` só vai quando a entrada SABE que não há passado — dívida com `installments_paid = 0`, compra sem parcela paga (`useInstallmentPlan`), lançamento avulso; na dúvida (a série aberta pela lista) o parâmetro não vai e `temPassadoDoParam` assume que há.
- Registrar em `_layout.tsx`: `<Stack.Screen name="finance/lancar" options={modalOptions} />`.

- [ ] **Step 4: Ver passar + portão** — Run: `node --test --test-name-pattern="Lançar:" src/lib/simple-finance-ui.test.ts && npx tsc --noEmit && npx expo lint && npm test` — Expected: PASS.

- [ ] **Step 5: Commit** — `git add src/app/finance/lancar.tsx src/app/_layout.tsx src/lib/simple-finance-ui.test.ts && git commit -m "feat(lancar): o formulário único com o seletor, criar outro e a conversão"`

---

### Task 8: Toda entrada abre `/finance/lancar`; o que sobrou sai

**Files:**
- Modify: todas as entradas listadas abaixo, `src/lib/hipotese.ts` (`paramsDoAplicar`), `src/lib/atalhos-de-lancamento.ts` (menus), `src/app/finance/recurring.tsx`, `src/app/finance/debts.tsx`, `src/app/finance/transaction-form.tsx`, `nova-recorrente.tsx`, `novo-financiamento.tsx`, `src/components/ui/task-header.tsx`, `src/hooks/use-voltar-quando-fechar.ts`, `src/app/_layout.tsx`, os testes
- Test: `src/lib/simple-finance-ui.test.ts`, `src/lib/anti-slop.test.ts`

- [ ] **Step 1: Testes (falham)**

```ts
test('Toda entrada de criar/editar lançamento, recorrente e dívida abre o formulário único', () => {
  const arquivos = (readdirSync('src', { recursive: true }) as string[]).filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes('.test.'));
  const fora: string[] = [];
  for (const f of arquivos) {
    const t = readFileSync(`src/${f}`, 'utf8');
    if (/pathname: '\/finance\/(transaction-form|nova-recorrente|novo-financiamento)'/.test(t)) fora.push(f);
    if (/pathname: '\/finance\/(recurring|debts)', params: \{ (create|edit)/.test(t)) fora.push(f);
  }
  assert.deepEqual(fora, []);
});

test('Links antigos continuam abrindo o formulário certo', () => {
  for (const [arquivo, tipo] of [['transaction-form', 'uma'], ['nova-recorrente', 'recorrente'], ['novo-financiamento', 'financiamento']] as const) {
    const ui = screen(`src/app/finance/${arquivo}.tsx`, { params: { id: 'x1' } });
    const r = ui.nodes().find((n: any) => n.type === 'Redirect');
    assert.equal(r.props.href.pathname, '/finance/lancar', arquivo);
    assert.equal(r.props.href.params.tipo, tipo, arquivo);
    assert.equal(r.props.href.params.id, 'x1', 'os parâmetros viajam');
  }
});
```

- [ ] **Step 2: Ver falhar** — Run: `node --test --test-name-pattern="formulário único|Links antigos" src/lib/simple-finance-ui.test.ts` — Expected: FAIL.

- [ ] **Step 3: Trocar as entradas** (use `hrefDoLancar`):
- criar lançamento: `(tabs)/today/index.tsx` (menu Lançar), `(tabs)/finance/index.tsx` (menu Lançar, `{month}`), `transactions.tsx:727` (`{conta?}`), `installments.tsx:657,682`, `invoice/[id].tsx:589`, `invoices.tsx:483`, `lib/proximo-passo.ts:59` → `hrefDoLancar('uma', {...})`;
- editar lançamento: `(tabs)/finance/index.tsx:530`, `transactions.tsx:966`, `[txId].tsx:461,473`, `forecast.tsx:496`, `invoice/[id].tsx:692`, `expected-ledger-lines.tsx:87` → `hrefDoLancar('uma', { id, origem: 'transacao', papel: <do registro>, ...(<sabe que não há passado> ? { passado: '0' } : {}) })` — `papel` vem de `tx.recurring_id ? 'ocorrencia' : tx.installment_plan_id ? 'parcela' : tx.debt_id ? 'pagamento' : 'avulsa'`; um helper `papelDaTransacao(tx)` em `src/lib/lancar.ts` (com teste de uma linha em `lancar.test.ts`);
- recorrente: menus Lançar → `hrefDoLancar('recorrente')`; `recurring.tsx` "+" (647), EmptyState (564, 576), "Editar" (390-393), `?edit=` (338-345), `[txId].tsx:396` → `hrefDoLancar('recorrente', { id, origem: 'serie' })` (sem `passado`: a lista não sabe, e o hospedeiro assume que há);
- dívida: menus Lançar → `hrefDoLancar('financiamento')`; `debts.tsx` "+" (1443), EmptyState "Nova dívida" (883), "Editar" (695, 1382, 1403, `?edit=1` 327) → `hrefDoLancar('financiamento', { id, origem: 'divida', passado: d.installments_paid > 0 ? '1' : '0' })`;
- `paramsDoAplicar` (`hipotese.ts`): os três ramos passam a `hrefDoLancar(<tipo da hipótese>, { deHipotese, ... })`, mantendo os parâmetros de hoje.

Remover: a folha de formulário de `recurring.tsx` e `debts.tsx` (a de PAGAR fica), `soFormulario`, `deOutroFormulario`, a prop `voltar` do `TaskHeader` e o `aoSalvar`/`router.dismiss` de `use-voltar-quando-fechar.ts` (se nenhuma outra tela usar), o registro de `finance/nova-recorrente` e `finance/novo-financiamento` em `_layout.tsx` (os ARQUIVOS ficam, como cascas; o expo-router registra rota pelo arquivo). Em `SEM_SCREEN` (`anti-slop.test.ts`): os dois continuam, e entram `src/app/finance/lancar.tsx` (desenha corpos, não `Screen`) e `src/app/finance/transaction-form.tsx` (vira um `Redirect`).

`transaction-form.tsx`, `nova-recorrente.tsx`, `novo-financiamento.tsx` viram cascas:

```tsx
import { Redirect, useLocalSearchParams } from 'expo-router';

/** Link antigo (APK em campo, notificação): o formulário único abre no tipo certo. */
export default function TransactionFormAntigo() {
  const p = useLocalSearchParams<Record<string, string>>();
  return <Redirect href={{ pathname: '/finance/lancar', params: { ...p, tipo: 'uma', ...(p.id ? { origem: 'transacao' } : {}) } }} />;
}
```

(`nova-recorrente` com `tipo: 'recorrente'`, `novo-financiamento` com `tipo: 'financiamento'`; o `Redirect` precisa entrar no mock de `expo-router` do harness como `'Redirect'`.)

Os testes antigos que viram comportamento removido (3692 `soFormulario`, 3727 `voltar`/`dismiss(2)`, 2946 o `pathname` do menu da Hoje, 1857 `ATALHOS` no formulário) são reescritos para a entrada nova ou apagados, com uma linha no ledger por teste.

- [ ] **Step 4: Ver passar + portão** — Run: `npx tsc --noEmit && npx expo lint && npm test` — Expected: PASS.

- [ ] **Step 5: Commit** — `git add -A src && git commit -m "feat(lancar): toda entrada abre o formulário único; as folhas antigas saem"`

---

### Task 9: No aparelho, documentação

**Files:**
- Modify: `.claude/rules/frontend.md` (seção do formulário que outra tela abre — o seletor substitui o "Voltar"), `.claude/rules/finance.md` (conversão de tipo: `converter_registro`), `docs/AGENTE-PARIDADE-COM-O-APP.md` (converter tipo: só no app)

- [ ] **Step 1: Aparelho** — iPhone (padrão e `accessibility-large`, relançando após trocar) e Android (padrão e 384dp × 1,3, `force-stop` após trocar; devolver 480 / 1.0 no fim):
  1. Lançar → Uma vez → digitar título e valor → trocar para Recorrente → os campos estão lá; a transição é um crossfade curto; trocar para Financiamento → Nome e Valor da parcela preenchidos.
  2. "Salvar e criar outro" três vezes seguidas (uma vez, recorrente, financiamento): o formulário limpa, mantém tipo, conta e data.
  3. Editar uma recorrente → mudar para Uma vez → Salvar → a pergunta (sem passado: Converter / Manter) → Converter → a série sumiu e o lançamento existe.
  4. Editar uma ocorrência paga de outra série → Uma vez → "Só esta" → a ocorrência saiu da série; rodar `materialize_horizon` no staging não a recria.
  5. Uma compra parcelada com parcela numa fatura paga → Recorrente → "Todas" → a frase da recusa aparece e nada mudou.
  6. Aplicar de uma hipótese de cada forma abre no tipo certo, preenchido.
  7. Link antigo `appproops://finance/transaction-form` abre o formulário único.
  Anotar os ids criados; apagar por id no fim.

- [ ] **Step 2: Documentar** — `frontend.md`: trocar o parágrafo do "Voltar"/`soFormulario` por "o formulário único (`/finance/lancar`): seletor Uma vez | Recorrente | Financiamento, corpos em `components/finance/formulario-*`, `CorpoProps`"; `finance.md`: seção "Mudar o tipo de um registro" com as quatro opções e `converter_registro`; `AGENTE-PARIDADE`: linha nova.

- [ ] **Step 3: Portão e commit** — Run: `npx tsc --noEmit && npx expo lint && npm test` — Expected: PASS. `git commit -am "docs(lancar): formulário único e conversão de tipo"`
