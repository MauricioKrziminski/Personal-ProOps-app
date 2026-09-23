# Financiamento maleável — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Financiamento com data da 1ª parcela, contrato editável por inteiro (inclusive com pagamento lançado), arquivadas com volta, excluir por completo e o detalhe em linha do tempo — com o agente fazendo o mesmo.

**Architecture:** Uma coluna (`debts.first_due_date`) ancora o contrato dentro de `private.debt_schedule_for`, que é a fonte única de toda leitura de parcela futura (projeção, mês, Hoje, ciclo, "E se…"). Duas travas de trigger caem, e uma RPC (`delete_debt`) apaga pagamentos e dívida com um bypass local à transação. O app reusa os primitivos (`QuantityField`, `DatePickerField`, `Segmented`, `RingGauge`, `showItemActions`), e a aritmética nova é pura, em `lib/`.

**Tech Stack:** Supabase Postgres (plpgsql/sql), Expo SDK 57 + TanStack Query, Python 3.12 (agente), `node --test`, `pytest`.

**Spec:** `docs/superpowers/specs/2026-09-23-financiamento-maleavel-design.md`

## Global Constraints

- Dinheiro sempre `*_cents` inteiro; nunca float, nunca `parseFloat`.
- Migration nova só no STAGING (`utkqoiigimqzeenxkxdl`), com `bash scripts/supabase-target.sh < /dev/null` antes e `npx supabase db push --project-ref utkqoiigimqzeenxkxdl --yes`. Produção NUNCA.
- `create or replace` repete o cabeçalho inteiro (`security`, `set search_path`, `set "TimeZone"`), senão ele se perde.
- Commits: conventional, UMA linha, **sem Co-Authored-By**. Sem tag.
- Portão por commit: `npx tsc --noEmit`, `npx expo lint`, `npm test` (código de saída), e com `agent/` mexido `.venv/bin/ruff check app --select F,E9` + `.venv/bin/pytest`.
- Nada de `LinearTransition` (use `transicaoDeLayout`), nada de `numberOfLines` fora da allowlist, nada de hex/`fontSize` solto.
- Texto de UI em pt-BR, curto ("menos texto").
- Dado de teste no staging se apaga pelo ID anotado.
- Validar cada tarefa NA HORA (emulador Android + simulador iOS quando há tela).

## Review Focus

1. **Parcela fixa com "Total a pagar" que não divide por N** (R$ 70.000 em 48×): a parcela arredonda e o resumo mostra o total REAL que vai ser gravado (R$ 69.999,84), nunca o digitado.
2. **Dia 31 como vencimento** (1ª parcela em 31/01, 1 paga): a próxima é 28/02 ou 29/02, e a seguinte volta a 31/03 (o `due_day` guarda o 31; a âncora pode ser o dia clampado).
3. **Editar só as pagas, sem mexer na data**, numa dívida ANTIGA (`first_due_date` null): a próxima parcela mostrada no formulário não pode ir para uma data que o cronograma nunca teve.
4. **Excluir por completo duas vezes** (toque duplo, ou app e agente): a segunda chamada não dá erro e não apaga nada de outra dívida.
5. **Desfazer do arquivar depois de a dívida ter sido apagada** por outro caminho: o toast não pode "ressuscitar" nada nem quebrar.

---

### Task 1: Aritmética pura do contrato

**Files:**
- Modify: `src/lib/finance-form.ts` (fim do arquivo)
- Modify: `src/lib/debt-history.ts` (nova função `linhaDoTempo`)
- Test: `src/lib/finance-form.test.ts`, `src/lib/debt-history.test.ts`

**Interfaces — Produces:**
- `parcelaDoTotalDoContrato(totalCents: number, n: number): number`
- `ancoraDoContrato(proximaISO: string, pagas: number): string` — a data da parcela nº 1.
- `proximaDoContrato(ancoraISO: string, pagas: number, dia: number): string` — a data da parcela `pagas + 1`, no dia `dia` (clampado no mês).
- `linhaDoTempo(historico: PaidInstallment[], futuras: { installment_no: number; due_date: string; payment_cents: number; interest_cents: number | null }[]): { ano: string; itens: ItemDaLinha[] }[]` com `ItemDaLinha = { n: number; iso: string; cents: number; jurosCents: number | null; estado: 'paga' | 'estimada' | 'proxima' | 'futura' }`.

- [ ] **Step 1: testes que falham** — em `src/lib/finance-form.test.ts`:

```ts
import { ancoraDoContrato, parcelaDoTotalDoContrato, proximaDoContrato } from './finance-form.ts';

test('total a pagar vira parcela arredondada; o total gravado é parcela × N', () => {
  assert.equal(parcelaDoTotalDoContrato(7056000, 48), 147000);
  assert.equal(parcelaDoTotalDoContrato(7000000, 48), 145833); // 69.999,84 gravado
  assert.equal(parcelaDoTotalDoContrato(0, 48), 0);
  assert.equal(parcelaDoTotalDoContrato(100, 0), 0);
});

test('âncora e próxima parcela fazem ida e volta, inclusive no dia 31', () => {
  assert.equal(ancoraDoContrato('2026-12-05', 0), '2026-12-05');
  assert.equal(ancoraDoContrato('2026-10-05', 8), '2026-02-05');
  assert.equal(proximaDoContrato('2026-02-05', 8, 5), '2026-10-05');
  // 31/03 com 1 paga: a âncora cai em 28/02, e o dia 31 volta pelo `dia`
  assert.equal(ancoraDoContrato('2027-03-31', 1), '2027-02-28');
  assert.equal(proximaDoContrato('2027-02-28', 1, 31), '2027-03-31');
  assert.equal(proximaDoContrato('2027-01-31', 1, 31), '2027-02-28');
  assert.equal(proximaDoContrato('2027-01-31', 2, 31), '2027-03-31');
});
```

Em `src/lib/debt-history.test.ts`:

```ts
import { linhaDoTempo } from './debt-history.ts';

test('linha do tempo agrupa por ano e marca paga, estimada, próxima e futura', () => {
  const anos = linhaDoTempo(
    [
      { installment_no: 1, due_date: '2026-11-05', payment_cents: 100, registered: false },
      { installment_no: 2, due_date: '2026-12-05', payment_cents: 100, registered: true },
    ],
    [
      { installment_no: 3, due_date: '2027-01-05', payment_cents: 100, interest_cents: null },
      { installment_no: 4, due_date: '2027-02-05', payment_cents: 100, interest_cents: 7 },
    ],
  );
  assert.deepEqual(anos.map((a) => a.ano), ['2026', '2027']);
  assert.deepEqual(anos[0].itens.map((i) => i.estado), ['estimada', 'paga']);
  assert.deepEqual(anos[1].itens.map((i) => [i.n, i.estado, i.jurosCents]), [[3, 'proxima', null], [4, 'futura', 7]]);
});
```

- [ ] **Step 2:** `node --test src/lib/finance-form.test.ts src/lib/debt-history.test.ts` → FALHA ("is not a function").

- [ ] **Step 3: implementação** — em `src/lib/finance-form.ts` (a importação relativa já é o padrão dos módulos puros):

```ts
import { addMonthsISO } from './debt-history.ts';

/**
 * Parcela fixa a partir do TOTAL A PAGAR (decisão do dono do produto, 23/09/2026: "total" é a
 * soma das parcelas, com os juros dentro). O `check` de parcela fixa exige `total = parcela × N`
 * em centavos inteiros, então a parcela arredonda e o total GRAVADO é `parcela × N` — a tela
 * mostra esse, não o digitado.
 */
export function parcelaDoTotalDoContrato(totalCents: number, n: number): number {
  if (!Number.isInteger(n) || n <= 0 || totalCents <= 0) return 0;
  return Math.round(totalCents / n);
}

/** A data da parcela nº 1 do contrato, dada a próxima em aberto (`pagas + 1`). */
export function ancoraDoContrato(proximaISO: string, pagas: number): string {
  return addMonthsISO(proximaISO, -pagas);
}

/**
 * A data da parcela `pagas + 1`, no dia de vencimento do contrato (clampado no mês curto) — a
 * MESMA conta de `private.debt_schedule_for`: `day_in_month(add_months(first_due_date, pagas),
 * due_day)`.
 */
export function proximaDoContrato(ancoraISO: string, pagas: number, dia: number): string {
  const mes = addMonthsISO(`${ancoraISO.slice(0, 7)}-01`, pagas);
  const [y, m] = mes.split('-').map(Number);
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${mes.slice(0, 7)}-${String(Math.min(dia, ultimo)).padStart(2, '0')}`;
}
```

Em `src/lib/debt-history.ts`:

```ts
export interface ItemDaLinha {
  n: number;
  iso: string;
  cents: number;
  jurosCents: number | null;
  estado: 'paga' | 'estimada' | 'proxima' | 'futura';
}

/** O contrato inteiro numa linha só, agrupado por ano: o passado (histórico) e o que falta. */
export function linhaDoTempo(
  historico: readonly PaidInstallment[],
  futuras: readonly { installment_no: number; due_date: string; payment_cents: number; interest_cents: number | null }[],
): { ano: string; itens: ItemDaLinha[] }[] {
  const itens: ItemDaLinha[] = [
    ...historico.map((p) => ({
      n: p.installment_no, iso: p.due_date, cents: p.payment_cents, jurosCents: null,
      estado: p.registered ? ('paga' as const) : ('estimada' as const),
    })),
    ...futuras.map((p, i) => ({
      n: p.installment_no, iso: p.due_date, cents: Number(p.payment_cents),
      jurosCents: p.interest_cents == null ? null : Number(p.interest_cents),
      estado: i === 0 ? ('proxima' as const) : ('futura' as const),
    })),
  ];
  const anos: { ano: string; itens: ItemDaLinha[] }[] = [];
  for (const item of itens) {
    const ano = item.iso.slice(0, 4);
    if (anos.at(-1)?.ano !== ano) anos.push({ ano, itens: [] });
    anos.at(-1)!.itens.push(item);
  }
  return anos;
}
```

No harness de UI (`src/lib/simple-finance-ui.test.ts`), incluir `'@/lib/debt-history'` e `'./debt-history.ts'`/`'./debt-history'` na lista de módulos carregados DE VERDADE (a linha que já carrega `@/lib/finance-form`).

- [ ] **Step 4:** `node --test src/lib/finance-form.test.ts src/lib/debt-history.test.ts` → PASS; `npm test` → código 0.
- [ ] **Step 5:** `git commit -m "feat(finance): aritmética da âncora do contrato e da linha do tempo da dívida"`

---

### Task 2: Banco — âncora, contrato editável, `delete_debt`

**Files:**
- Create: `supabase/migrations/20260923160000_financiamento_maleavel.sql`
- Create: `supabase/tests/financiamento_maleavel.sql`
- Modify: `src/lib/database.types.ts` (regerado), `.claude/rules/finance.md` (seção de dívidas), `CLAUDE.md` (pendência de produção)

**Interfaces — Produces:** coluna `debts.first_due_date date`; RPC `public.delete_debt(p_debt_id uuid) returns int`.

- [ ] **Step 1: teste SQL que falha** — `supabase/tests/financiamento_maleavel.sql`, rodado no staging por `agent/.venv/bin/python <scratchpad>/sqltest.py` (transação + rollback). Casos: (1) `first_due_date = current_date + 3 meses`, 0 pagas → 1ª linha de `private.debt_schedule_for` é essa data; (2) 1 paga → 1ª linha é `first + 1 mês`; (3) `installments_paid` 8→10 → 1ª linha é a 11ª, em `first + 10 meses`; (4) dívida fixa com um `pay_debt_installment` registrado: `update debts set installment_cents = …, principal_cents = …, remaining_cents = …` passa; novo `pay_debt_installment` com o valor NOVO grava `debt_payment_no = pagas + 1`; (5) `delete_debt` devolve 2 (dois pagamentos), a dívida some, e a 2ª chamada devolve 0; `private.cash_events` sem linha `debt_schedule` dela; (6) `has_function_privilege('authenticated', 'public.delete_debt(uuid)', 'execute')` = true e `anon` = false. Cada caso levanta `raise exception` com o valor obtido × o esperado.

- [ ] **Step 2:** rodar → FALHA (`column "first_due_date" does not exist`).

- [ ] **Step 3: migration** — `20260923160000_financiamento_maleavel.sql`:
  1. `alter table public.debts add column if not exists first_due_date date;` + `comment`.
  2. `create or replace function private.debt_schedule_for(p_debt_id uuid)` com o MESMO corpo de hoje (lido do staging) e duas mudanças: o CTE `d` seleciona `first_due_date`, e `primeiro` vira
     ```sql
     greatest(
       case … (o case atual inteiro) … end,
       case when d.first_due_date is not null
            then private.day_in_month(private.add_months(d.first_due_date, d.installments_paid),
                                      (select valor from dia))
       end
     ) as primeiro
     ```
     Cabeçalho repetido: `language sql stable set search_path to 'public' set "TimeZone" to 'America/Sao_Paulo'`.
  3. `create or replace function public.tg_debts_calculation_mode()` só com a regra do modo:
     ```sql
     begin
       if new.calculation_mode is distinct from old.calculation_mode then
         raise exception 'O modo de cálculo não pode ser alterado. Cadastre outro financiamento para um novo contrato';
       end if;
       return new;
     end;
     ```
  4. `create or replace function public.tg_transactions_debt_payment()` com o corpo atual e, logo depois de `debt := …` e antes de qualquer outra coisa:
     ```sql
     if debt is not null and current_setting('proops.apagando_divida', true) = debt::text then
       if tg_op = 'DELETE' then return old; else return new; end if;
     end if;
     ```
  5. `create or replace function public.delete_debt(p_debt_id uuid) returns int language plpgsql security invoker set search_path = public as $$ declare n int; begin perform set_config('proops.apagando_divida', p_debt_id::text, true); delete from public.transactions where debt_id = p_debt_id; get diagnostics n = row_count; delete from public.debts where id = p_debt_id; perform set_config('proops.apagando_divida', '', true); return n; end $$;` + `revoke execute … from public, anon; grant execute … to authenticated, service_role;`

- [ ] **Step 4:** agente `migration-reviewer` na migration; corrigir o que ele apontar.
- [ ] **Step 5:** `bash scripts/supabase-target.sh < /dev/null` (tem que dizer staging), `npx supabase migration list --project-ref utkqoiigimqzeenxkxdl` (só esta pendente), `npx supabase db push --project-ref utkqoiigimqzeenxkxdl --yes`.
- [ ] **Step 6:** teste SQL → OK; regressão no staging: `parcela_paga_no_ciclo.sql`, `fluxo_do_financeiro.sql`, `month_forecast.sql`, `da_para_gastar.sql` → OK.
- [ ] **Step 7:** `npx supabase gen types typescript --linked > src/lib/database.types.ts`; `npx tsc --noEmit`.
- [ ] **Step 8:** `finance.md` (seção de dívidas: âncora, contrato editável, `delete_debt`), `CLAUDE.md` (pendência `20260923160000`, ordem migration → agente → app). Commit: `feat(db): âncora da primeira parcela, contrato editável e excluir dívida por completo`

---

### Task 3: Hooks

**Files:** Modify `src/hooks/use-finance.ts`; Test `src/lib/refresh-consistency.test.ts`

**Interfaces — Produces:**
- `Debt` ganha `first_due_date: string | null` (no `Pick` e no `select` de `useDebts`).
- `useArchivedDebts(): UseQueryResult<Debt[]>` — `queryKey ['debts', 'archived']`, `.eq('archived', true)`.
- `useUnarchiveDebt(): UseMutationResult<void, Error, string>`.
- `useDeleteDebt(): UseMutationResult<number, Error, string>` — `supabase.rpc('delete_debt', { p_debt_id })`.
- `pagamentosDaDivida(debtId: string): Promise<{ count: number; totalCents: number }>`.
- `useSaveDebt` aceita `first_due_date?: string | null` e `installments_paid` também com `id`.

- [ ] **Step 1:** incluir `'useUnarchiveDebt', 'useDeleteDebt'` na lista de `every ledger mutation invalidates…` → `npm test` FALHA.
- [ ] **Step 2:** implementar (as duas mutações com `onSuccess: invalidate`, como `useArchiveDebt`).
- [ ] **Step 3:** `npm test` → código 0. Commit: `feat(finance): hooks de arquivadas, desarquivar e excluir dívida`

---

### Task 4: Formulário (criar e editar)

**Files:** Modify `src/app/finance/debts.tsx`; Test `src/lib/simple-finance-ui.test.ts`

**Interfaces — Consumes:** Task 1 (as três funções), Task 3 (`useDebtPayments(form?.id)`, `useSaveDebt`).

Estado novo do `FormState`: `unidade: UnidadeDoValor` (`'parcela' | 'total'`), `valorCents: number` (o digitado, na unidade escolhida), `ancora: string | null`, `pagasOriginal: number`, `parcelasNum: number`, `mostraDetalhes`.

- [ ] **Step 1: testes que falham** (substituem os de "Vence dia" / "Adicionar detalhes"):
  - criar: rótulos `['Valor', 'Total de parcelas', 'Parcelas já pagas', 'Primeira parcela']`; preencher Valor 147000, parcelas 48, data `05/12/2026` → grava `installment_cents 147000`, `due_day 5`, `first_due_date '2026-12-05'`, `installments_paid 0`.
  - "Total a pagar": trocar a unidade e preencher 7000000 com 48 → grava `installment_cents 145833`, `principal_cents 6999984`.
  - com pagas 8 e data `05/10/2026` → `first_due_date '2026-02-05'` e o rótulo vira `Próxima parcela`.
  - editar (dívida `{ …, first_due_date: '2026-02-05', due_day: 5, installments_paid: 8 }`): pagas → 10 sem mexer na data → grava `first_due_date '2026-02-05'` (a próxima mostrada vira `05/12/2026`); `installments_paid` vai no UPDATE.
  - editar dívida antiga (`first_due_date: null`) sem cronograma carregado: salvar só o nome não grava `first_due_date`.
  - O harness: `fill` passa a aceitar `QuantityField` (`onChange(Number(v))`) e `DatePickerField` (`onChange(v)`).
- [ ] **Step 2:** `node --test src/lib/simple-finance-ui.test.ts` → FALHA.
- [ ] **Step 3: implementação** no modo parcela fixa, nesta ordem de campos: `Segmented` (Cada parcela | Total a pagar) + `MoneyField` no `Field label="Valor"`; `Field "Total de parcelas"` com `QuantityField min={Math.max(1, pagas)} max={999}`; `Field "Parcelas já pagas"` com `QuantityField min={pagamentosRegistrados} max={parcelasNum}`; `Field label={pagas === 0 ? 'Primeira parcela' : \`Próxima parcela (a ${pagas + 1}ª)\`}` com `DatePickerField` (`value = proximaExibida`, `onChange(br)` → `ancora = ancoraDoContrato(iso, pagas)`, `diaVencimento = dia(iso)`); o `Card` de resumo "N× de R$ X = R$ Y" com `Y = X × N`. `proximaExibida = form.ancora ? proximaDoContrato(form.ancora, pagas, dia) : schedule.data?.[0]?.due_date ?? null` e, na dívida antiga, `ancoraEfetiva = form.ancora ?? (schedule[0] ? ancoraDoContrato(schedule[0].due_date, form.pagasOriginal) : null)`. Salvar grava `first_due_date` e `due_day` só quando `ancoraEfetiva` existe. O botão "Adicionar detalhes (opcional)" sai: no lugar, um `Row` "Nome e conta" com o valor atual no `subtitle` e `accessibilityState.expanded`, que abre Nome + Conta no lugar (já aberto no editar). No modo com juros: `Field "Próxima parcela"` com o mesmo `DatePickerField` no lugar de "Vence dia", e "Parcelas já pagas" também no editar.
- [ ] **Step 4:** testes → PASS; `npx tsc --noEmit`, `npx expo lint`, `npm test` → 0.
- [ ] **Step 5: validar no aparelho** (Android 384dp × 1,3 claro/escuro; iOS): criar parcela fixa com "Total a pagar" R$ 70.000 / 48× e 1ª parcela daqui a 3 meses → conferir no staging (`ro.py`) a linha, e na Projeção/"O mês inteiro" nenhuma parcela antes; editar a data → a 1ª linha do cronograma anda. Anotar o ID e apagar no fim.
- [ ] **Step 6:** Commit: `feat(finance): financiamento com total a pagar, primeira parcela e pagas editáveis`

---

### Task 5: Lista — arquivadas, desfazer, excluir por completo

**Files:** Modify `src/app/finance/debts.tsx`; Test `src/lib/simple-finance-ui.test.ts`

- [ ] **Step 1: testes que falham:** (a) com `archivedDebts: [{…}]` no harness há um `Row` "Arquivadas · 1" e, aberto, a ação "Desarquivar" chama `useUnarchiveDebt`; (b) as ações do toque longo são `['Ver as parcelas', 'Editar', 'Arquivar', 'Excluir por completo']`; (c) "Excluir por completo" pede confirmação (`confirmations.length === 1`) e só então chama `useDeleteDebt`.
- [ ] **Step 2:** FALHA.
- [ ] **Step 3: implementação:** `acoesDaDivida(d)` (uma função, usada pelo toque longo E pelo "…" da Task 6); `arquivar` com `toast({ message, tone: 'success', action: { label: 'Desfazer', onPress: () => unarchive.mutate(d.id) } })`; `excluir(d)` = `await pagamentosDaDivida(d.id)` e `confirmDestructive(\`Excluir "${d.name}" por completo?\`, 'Excluir', …, count > 0 ? \`Apaga o financiamento, os ${count} pagamentos já lançados (${brl(total)}, que voltam ao saldo das contas) e as parcelas futuras da projeção. Não dá para desfazer.\` : 'Apaga o financiamento e as parcelas futuras da projeção. Não dá para desfazer.')`; seção "Arquivadas" no fim da lista (some sem arquivadas), cartões com `opacity` reduzida e toque longo `['Desarquivar', 'Excluir por completo']`.
- [ ] **Step 4:** testes → PASS; portão.
- [ ] **Step 5: validar no aparelho:** arquivar → toast "Desfazer" → volta; arquivar → "Arquivadas · 1" → desarquivar; excluir por completo uma dívida de teste com um "Paguei" → o lançamento some de Lançamentos (`ro.py` confirma 0 linhas com o `debt_id`).
- [ ] **Step 6:** Commit: `feat(finance): dívidas arquivadas com volta e excluir por completo`

---

### Task 6: Detalhe em linha do tempo

**Files:** Create `src/components/finance/debt-timeline.tsx`; Modify `src/app/finance/debts.tsx`

**Interfaces — Consumes:** `linhaDoTempo` (Task 1), `acoesDaDivida` (Task 5).

- [ ] **Step 1:** `DebtTimeline({ anos, calcMode })`: por ano, um cabeçalho (`ThemedText type="smallBold"`) e as linhas; cada linha = trilho vertical (`View` de 2dp em `separator`) com o nó (preenchido `tintFill` para paga/estimada, anel `tint` 2dp para a próxima, vazio com borda `separator` para futura), "9ª · out" (`type="default"`, `tabular`), à direita `<Money variant="default">`, e no modo com juros um `footnote` "juros R$ X" embaixo. A linha da próxima em `Card` destacado (`backgroundSelected`). Estimada leva "estimada" em `textSecondary`.
- [ ] **Step 2:** no `Sheet` do detalhe: `TaskHeader` com `action={<HeaderIconButton icon="ellipsis" label="Mais ações" onPress={() => detalhe && acoesDaDivida(detalhe)} />}`; herói = `Card` com `RingGauge value={pagas / total}` (texto "9 de 48" dentro), "R$ X a pagar", "Próxima · 05/10 · R$ 1.470" e o `Button` "Paguei esta parcela"; embaixo `<DebtTimeline anos={linhaDoTempo(historico, schedule.data ?? [])} />`. A tabela horizontal e o bloco "Já pagas" saem (a linha do tempo já tem os dois).
- [ ] **Step 3:** portão; teste de UI: o `TaskHeader` do detalhe tem `action`, e o "…" chama `showItemActions` com as 4 ações.
- [ ] **Step 4: validar no aparelho** (Android 384dp × 1,3 claro/escuro e iOS claro/escuro): financiamento de 48× com 8 pagas — ano a ano, a próxima destacada, sem texto cortado. Agente `ui-polisher` na tela; corrigir o que ele apontar.
- [ ] **Step 5:** Commit: `feat(finance): detalhe do financiamento em linha do tempo, com o menu de ações`

---

### Task 7: Agente — paridade

**Files:** Modify `agent/app/tools/resources.py`; Test `agent/tests/test_fixed_debt_resources.py`, `agent/tests/test_resource_actions.py`; Modify `docs/AGENTE-PARIDADE-COM-O-APP.md`

- [ ] **Step 1: testes que falham:**
  - `first_due_date` aceito no catálogo de `debts` (`YYYY-MM-DD`); criar parcela fixa com `first_due_date='2026-12-05'` e sem `due_day` → `due_day == 5` e não pergunta o dia.
  - parcela fixa: `installments_paid=10` (sem `remaining_cents`) → `values` com `remaining_cents = parcela × (N − 10)` e `principal_cents = parcela × N`; `installment_cents` e `installments` idem. `principal_cents`, `remaining_cents` e `interest_rate_monthly` diretos continuam recusados ("parcelas fixas").
  - com pagamento registrado, `installments_paid` não é mais recusado (a query de pagamentos sai do `prepare` e o `reference_guard` sai do `execute`).
  - `resource_delete debts` com `trashed=true` → `prepared["purge"] is True`, e o resumo diz "apagar DE VEZ" e conta os pagamentos; `execute` chama `select public.delete_debt(%s)` (dublê de `db.fetch_one`).
  - `resource_update debts archived=false` numa dívida arquivada acha a linha (sem filtro de `archived`).
- [ ] **Step 2:** `.venv/bin/pytest tests/test_fixed_debt_resources.py tests/test_resource_actions.py -q` → FALHA.
- [ ] **Step 3: implementação:** `first_due_date` e `trashed` na string de colunas de `debts`; `first_due_date` no ramo de datas do `validate_fields` e no `LABELS` ("data da primeira parcela"); `due_day` derivado de `first_due_date` antes do bloco `pedidos`; a regra "`installments_paid` exige `remaining_cents`" desce para o `prepare`, só no modo `amortized`; no modo fixo, `values` mesclado com `old` passa por `_derive_fixed_installments`; o `trashed=true` em `debts` vira `prepared["purge"] = True` (sem o erro das notas); `execute` com `purge` → `await db.fetch_one("select public.delete_debt(%s) as n", proposal["id"])` e a resposta "🗑️ Apaguei *X* e N pagamentos."; prompt: uma linha para `first_due_date` e uma para "apagar DE VEZ um financiamento é resource_delete com trashed=true".
- [ ] **Step 4:** `.venv/bin/ruff check app --select F,E9` e `.venv/bin/pytest -q` → verdes. Linhas novas na tabela de `docs/AGENTE-PARIDADE-COM-O-APP.md`.
- [ ] **Step 5:** Commit: `feat(agent): financiamento com primeira parcela, contrato editável e excluir de vez`

---

### Task 8: Validação ponta a ponta e documento do lote

- [ ] Os 6 cenários da spec (seção D) no Android e no iOS, com prints de antes/depois em `docs/bugs/evidence/2026-09-23-tarde/`.
- [ ] Linha 6–10 da tabela "Como cada um foi validado" em `docs/bugs/2026-09-23-tarde-calendario-busca-valor-financiamento.md`.
- [ ] Dado de teste apagado pelos IDs anotados (`ro.py` confirma).
- [ ] Commit: `docs(bugs): validação do financiamento maleável`
