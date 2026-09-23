# Arrastar o card para os lados — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Todo card com menu de toque longo ganha ações ao arrastar para a direita e para a esquerda, conforme a tabela aprovada da spec.

**Architecture:** A ação continua declarada uma vez (`ItemAction[]`). Dois campos opcionais dizem o lado (`arrasto`) e se ela pode executar ao arrastar até o fim (`desfaz`). Uma função pura (`ladosDoArrasto`) divide as ações nos lados. Um primitivo (`Deslizavel`, sobre o `ReanimatedSwipeable` do gesture-handler) desenha os lados, e `ItemLink` o aplica sozinho. As outras telas envolvem o card com a mesma lista que já passam ao `showItemActions`.

**Tech Stack:** Expo SDK 57, `react-native-gesture-handler` 2.32 (`react-native-gesture-handler/ReanimatedSwipeable`, já instalado), Reanimated 4, `node --test`.

**Spec:** `docs/superpowers/specs/2026-09-23-arrastar-card-design.md`

## Global Constraints

- Nenhuma biblioteca nova. `ReanimatedSwipeable` já vem no gesture-handler 2.32 instalado.
- O toque longo não muda: o menu continua com TODAS as ações.
- Apagar confirma como hoje (a própria ação chama `confirmDestructive`); o arrasto só chama a ação.
- "Até o fim executa" só em ação com `desfaz: true`, e essa ação mostra toast com "Desfazer".
- Um card aberto por vez; rolar a lista fecha o aberto.
- Tokens só (`theme.ts`/`tokens.ts`), monocromático:
  - Apagar: `dangerSoft` + texto `danger`.
  - Ação rápida da direita: `tintFill` + `onTint`.
  - Neutras e "Mais": `backgroundElement` + `text`.
- Háptico: seleção ao abrir, impacto leve ao executar até o fim. Um por gesto.
- iPhone: o gesto não começa nos primeiros `Space.xl` (24pt) da esquerda do card, que ficam para o voltar.
- Commits de uma linha, sem Co-Authored-By. Sem tag. Sem produção.

## Review Focus

1. **Card dentro de `Section` com cantos arredondados** (Lançamentos, fatura): o painel revelado fica recortado no grupo, sem vazar no canto.
2. **Tocar outro card com um aberto:** o toque só fecha o aberto; não navega no mesmo toque.
3. **Arrastar até o fim numa ação cuja mutation falha:** o toast de erro aparece e o card volta ao estado real.
4. **Ação condicional que muda com o card aberto** (Paguei vira Editar depois de pagar): o painel reflete o estado novo na próxima abertura.
5. **Voltar do iPhone pela borda** numa tela empurrada (Lançamentos, Lembretes): continua voltando.

---

### Task 1: A divisão das ações em lados (pura)

**Files:**
- Modify: `src/lib/item-actions.ts` (interface `ItemAction`)
- Create: `src/lib/arrasto.ts`
- Test: `src/lib/arrasto.test.ts`

**Interfaces:**
- Produces:
  - `ItemAction.arrasto?: 'direita' | 'esquerda' | 'fora'`: `fora` = não entra no arrasto e não conta para o "Mais" (é o mesmo que o toque curto já faz).
  - `ItemAction.desfaz?: boolean`
  - `ladosDoArrasto(acoes: ItemAction[]): { direita: ItemAction[]; esquerda: ItemAction[]; mais: boolean; pontaDireita: ItemAction | null; pontaEsquerda: ItemAction | null }`
  - `temArrasto(acoes: ItemAction[]): boolean`

- [ ] **Step 1: Write the failing test** (`src/lib/arrasto.test.ts`)

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ladosDoArrasto, temArrasto } from './arrasto.ts';

const a = (label: string, extra: Record<string, unknown> = {}) => ({ label, onPress: () => {}, ...extra });

test('cada ação vai para o lado marcado, na ordem declarada', () => {
  const lados = ladosDoArrasto([a('Editar', { arrasto: 'direita' }), a('Apagar', { arrasto: 'esquerda', destructive: true })]);
  assert.deepEqual(lados.direita.map((x) => x.label), ['Editar']);
  assert.deepEqual(lados.esquerda.map((x) => x.label), ['Apagar']);
  assert.equal(lados.mais, false, 'nada sobrou: sem "Mais"');
});

test('"Mais" aparece quando sobra ação sem lado, e "fora" não conta', () => {
  assert.equal(ladosDoArrasto([a('Fixar', { arrasto: 'direita' }), a('Cor')]).mais, true);
  assert.equal(ladosDoArrasto([a('Editar', { arrasto: 'direita' }), a('Ver detalhe', { arrasto: 'fora' })]).mais, false);
});

test('ação desligada ou sem onPress não entra no arrasto nem no "Mais"', () => {
  const lados = ladosDoArrasto([a('Paguei', { arrasto: 'direita', disabled: true }), { label: 'Mover para', arrasto: 'esquerda' }]);
  assert.deepEqual(lados.direita, []);
  assert.deepEqual(lados.esquerda, []);
  assert.equal(lados.mais, false);
});

test('até o fim só com desfaz: a ponta é a primeira do lado', () => {
  const lados = ladosDoArrasto([
    a('Fixar', { arrasto: 'direita', desfaz: true }),
    a('Apagar', { arrasto: 'esquerda', destructive: true }),
  ]);
  assert.equal(lados.pontaDireita?.label, 'Fixar');
  assert.equal(lados.pontaEsquerda, null, 'Apagar nunca vai sozinho');
});

test('temArrasto: só quando há algo para mostrar', () => {
  assert.equal(temArrasto([a('Ver', { arrasto: 'fora' })]), false);
  assert.equal(temArrasto([a('Editar', { arrasto: 'direita' })]), true);
});
```

- [ ] **Step 2:** Run `node --test src/lib/arrasto.test.ts`. Expected: FAIL (`Cannot find module './arrasto.ts'`).
- [ ] **Step 3: Implement.** In `src/lib/item-actions.ts`, add to `ItemAction`:

```ts
  /** Em que lado a ação aparece ao arrastar o card; `fora` repete o toque curto e não conta no "Mais". */
  arrasto?: 'direita' | 'esquerda' | 'fora';
  /** Pode executar ao arrastar até o fim — só quando a tela oferece "Desfazer". */
  desfaz?: boolean;
```

`src/lib/arrasto.ts`:

```ts
import type { ItemAction } from './item-actions';

/**
 * Divide as ações de um card nos dois lados do arrasto (spec 2026-09-23-arrastar-card).
 * Direita = a ação rápida; esquerda = tirar da lista; "Mais" quando sobra ação sem lado — ele
 * abre o mesmo menu do toque longo. Até o fim executa só a PRIMEIRA do lado, e só com `desfaz`.
 */
export function ladosDoArrasto(acoes: ItemAction[]) {
  const usavel = (x: ItemAction) => !x.disabled && Boolean(x.onPress);
  const direita = acoes.filter((x) => x.arrasto === 'direita' && usavel(x));
  const esquerda = acoes.filter((x) => x.arrasto === 'esquerda' && usavel(x));
  const mais = acoes.some((x) => !x.arrasto && !x.disabled && (Boolean(x.onPress) || Boolean(x.actions?.length)));
  const ponta = (lado: ItemAction[]) => (lado[0]?.desfaz ? lado[0] : null);
  return { direita, esquerda, mais, pontaDireita: ponta(direita), pontaEsquerda: ponta(esquerda) };
}

export function temArrasto(acoes: ItemAction[]): boolean {
  const lados = ladosDoArrasto(acoes);
  return lados.direita.length > 0 || lados.esquerda.length > 0 || lados.mais;
}
```

Note: `mais` counts submenus (`actions`) too, which is why "Mover para" (a submenu) counts in the `mais` check. The test above uses a submenu entry **with** `arrasto: 'esquerda'`, so it is excluded from `mais` by `!x.arrasto`; adjust nothing.

- [ ] **Step 4:** Run `node --test src/lib/arrasto.test.ts`. Expected: PASS 5/5.
- [ ] **Step 5:** Commit `feat(ui): ações do card divididas em lados de arrasto`.

### Task 2: O primitivo `Deslizavel`, provado em Lembretes

**Files:**
- Create: `src/components/ui/deslizavel.tsx`
- Modify: `src/app/reminders.tsx` (a lista), `src/components/ui/screen.tsx` (fechar ao rolar)
- Test: `src/lib/simple-finance-ui.test.ts` (Lembretes: lados)

**Interfaces:**
- Consumes: `ladosDoArrasto`, `temArrasto` (Task 1); `showItemActions(title, actions)` (`lib/item-actions.ts`).
- Produces:
  - `<Deslizavel titulo: string acoes: ItemAction[] children />`: sem arrasto, devolve `children` direto.
  - `fecharDeslizavelAberto(): void`: chamado ao começar a rolar.

- [ ] **Step 1: Failing test.** In `simple-finance-ui.test.ts`, render `src/app/reminders.tsx` with two reminders (one `active: true`). Find the `Deslizavel` node around the first row. Assert that `ladosDoArrasto(props.acoes)` gives:
  - direita `['Pausar']`, with `desfaz` true;
  - esquerda `['Apagar']`;
  - `mais` false (Editar is `fora`).

  To load `@/lib/arrasto` for real, add it to the harness `load` list (the same line that loads `@/lib/debt-history`). The harness mock of `@/hooks/use-items` (or the reminders hook) needs `useReminders` returning the fixture. Add `reminders?: any[]` handling where the screen reads it.
- [ ] **Step 2:** Run it. Expected: FAIL (no `Deslizavel` node).
- [ ] **Step 3: Implement `deslizavel.tsx`.**
  - `ReanimatedSwipeable` with `friction={1}`, `overshootFriction={8}`, `leftThreshold`/`rightThreshold` = 40, and `hitSlop={{ left: -Space.xl }}` on iOS.
  - `renderLeftActions` draws `direita`; `renderRightActions` draws `esquerda` + "Mais". Each button is a `Pressable` of width 88 with an `Icon` (`size="md"`) over a `ThemedText type="caption"` label. Colors per Global Constraints.
  - Pressing a button calls `methods.close()` then `acao.onPress()`. "Mais" calls `showItemActions(titulo, acoes)`.
  - Module-level `let aberto: SwipeableMethods | null`. On `onSwipeableWillOpen`, close the previous one and store this one. `fecharDeslizavelAberto()` closes it.
  - Até o fim:
    - Each panel keeps a `useSharedValue(false)` `passou`.
    - A `useAnimatedReaction` on `translation` sets `passou = |translation| > largura * 0.6` (`largura` from `onLayout` of the container, in a shared value). When it flips to true it fires a light impact via `runOnJS(Haptics.impactAsync)`.
    - `onSwipeableOpen(dir)`: if `passou` for that side and the side has a `ponta`, run `ponta.onPress()` and `close()`.
    - Reset `passou` on close.
  - Haptic selection on `onSwipeableWillOpen`.
  - `accessibilityRole="button"` and `accessibilityLabel={acao.label}` on each button.
  - `if (!temArrasto(acoes)) return <>{children}</>`.
- [ ] **Step 4: Lembretes.** Extract the menu of `reminders.tsx:46` into `acoesDoLembrete(r): ItemAction[]`, used by BOTH `onLongPress` and `<Deslizavel titulo={r.title} acoes={acoesDoLembrete(r)}>`:
  - Editar `arrasto:'fora'`;
  - Pausar/Retomar `arrasto:'direita', desfaz:true`, whose `onSuccess` shows `toast({ message: r.active ? 'Pausado' : 'Retomado', action: { label: 'Desfazer', onPress: () => <mesma mutation invertida> } })`;
  - Apagar `arrasto:'esquerda'`.
- [ ] **Step 5:** `Screen`: pass `onScrollBeginDrag={fecharDeslizavelAberto}` to its `ScrollView`, keeping any handler the screen passes.
- [ ] **Step 6:** Run the test → PASS; `npx tsc --noEmit`; `npx expo lint`.
- [ ] **Step 7: Validate on device** (Android 384dp × 1,3 and iPhone, light and dark, Lembretes):
  - open each side;
  - Pausar by tap and by full swipe (toast + Desfazer);
  - Apagar asks to confirm;
  - one open closes the other;
  - scrolling closes;
  - edge back works on iPhone.
- [ ] **Step 8:** Commit `feat(ui): arrastar o card para os lados, começando por Lembretes`.

### Task 3: `ItemLink` aplica o arrasto (Lançamentos, Financeiro, Contas, Fatura, Notas)

**Files:** Modify:
- `src/components/ui/item-link.tsx`, `src/components/ui/item-link.ios.tsx`;
- `src/app/finance/transactions.tsx:752`, `src/app/(tabs)/finance/index.tsx:487`, `src/app/finance/accounts.tsx:298`, `src/app/finance/invoice/[id].tsx:564`;
- `src/components/notes/note-actions.ts`; `src/app/(tabs)/notes/index.tsx` and `src/app/notes/folder/[id].tsx` (toast Desfazer do Fixar).

Test: `src/lib/simple-finance-ui.test.ts`.

- [ ] **Step 1: Failing tests.** One per screen, asserting `ladosDoArrasto(ItemLink.props.actions)`:
  - transações: pendente → direita `Paguei`, não pendente → direita `Editar`; esquerda `Apagar`; mais true;
  - Últimos lançamentos: direita `Editar`, esquerda `Apagar`, mais false;
  - conta: direita `Editar`, esquerda `Arquivar`, mais false;
  - fatura: direita `Editar`, esquerda `Apagar`.
- [ ] **Step 2:** Run → FAIL (no `arrasto` marks).
- [ ] **Step 3:** In both `ItemLink` files, wrap the returned tree: `<Deslizavel titulo={title} acoes={actions}>…</Deslizavel>`, **outside** `<Link>` (the Trigger swallows the child's style).
- [ ] **Step 4:** Mark the actions per the spec table:
  - Ver detalhe / Ver extrato: `'fora'`.
  - The quick action: `direita`. In transactions, Paguei when `status==='pending'`, otherwise Editar gets `direita`.
  - Apagar / Arquivar: `esquerda`.
  - Notas: Fixar/Desafixar `direita, desfaz` (toast "Fixada"/"Desafixada" + Desfazer); Arquivar `esquerda, desfaz` (it already has Desfazer).
- [ ] **Step 5:** Tests PASS; tsc; lint.
- [ ] **Step 6: Validate on device**, both platforms and themes, on each of the 5 screens:
  - Lançamentos' rounded group (Review Focus 1);
  - the iOS context menu still opens on long-press;
  - notes list with the drag handle: the handle still drags, the body swipes.
- [ ] **Step 7:** Commit `feat(ui): arrastar nos cards de lançamento, conta, fatura e nota`.

### Task 4: Telas de linha (Row) — Previsto, Pastas, Lixeira, Conversas, Regras, Importações, Aporte

**Files:** Modify:
- `src/app/finance/forecast.tsx:408`, `src/app/notes/folders.tsx:362`, `src/app/notes/trash.tsx:177`;
- `src/components/agent/conversation-row.tsx` + `src/app/agent/history.tsx:81`;
- `src/app/finance/rules.tsx:213`, `src/app/import-history.tsx:190`, `src/app/finance/goals.tsx:509`.

Test: `simple-finance-ui.test.ts` (forecast, rules, goals); device for the rest.

- [ ] **Step 1: Failing tests** (per the spec table):
  - Previsto: direita `Paguei/Recebi`, esquerda `Editar`;
  - Regra: direita `Editar`, esquerda `Apagar`;
  - Aporte: esquerda `Desfazer`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** In each screen, extract the menu into `acoesDe<Item>(item): ItemAction[]` (one list for long-press and swipe) and wrap the row in `<Deslizavel>`. The marks follow the spec table:
  - Pasta: Fixar `direita, desfaz`, Arquivar `esquerda, desfaz`.
  - Lixeira: Ver conteúdo `fora`, Apagar de vez `esquerda`.
  - Conversa: Renomear `direita`, Apagar `esquerda`.
  - Importação: Retomar/Ver itens `fora`, Apagar registro `esquerda`.
  - `ConversationRow` is `memo`'d: pass `acoes` built by a stable function of the id (keep the memo contract).
- [ ] **Step 4:** Tests PASS; tsc; lint.
- [ ] **Step 5:** Validate on device, both platforms. Commit `feat(ui): arrastar nas linhas de projeção, pastas, lixeira, conversas, regras e importações`.

### Task 5: Cards próprios — Orçamentos, Cartões, Dívidas, Parceladas, Recorrentes, Metas

**Files:** Modify:
- `src/app/finance/budgets.tsx:321`, `src/app/finance/cards.tsx:260` (`PressCard`), `src/app/finance/debts.tsx:484`;
- `src/app/finance/installments.tsx:484`, `src/app/finance/recurring.tsx:489`, `src/app/finance/goals.tsx:241`.

Test: `simple-finance-ui.test.ts`.

- [ ] **Step 1: Failing tests:**
  - Dívida: direita `Pagar parcela` (new action that opens the existing pay sheet), esquerda `Arquivar` (`desfaz`, it already has Desfazer), mais true;
  - Cartão: fatura fechada → direita `Paguei`, esquerda `Importar fatura` + `Abrir na carteira`; fatura aberta → direita `Importar fatura`;
  - Recorrente: direita `Pausar` (`desfaz`), esquerda `Apagar`, mais true;
  - Meta: direita `Guardar`, esquerda `Arquivar`;
  - Orçamento: direita `Editar limite`, mais true;
  - Parcelada: direita `Editar a compra`, esquerda `Apagar a compra`, mais true.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Wrap each card in `<Deslizavel>` with the same list its `onLongPress` uses. Mark per the table.
  - Debts: add `Pagar parcela` (opens `pagando` sheet), `arrasto:'direita'`.
  - Recurring: Pausar/Retomar with `desfaz` shows the Desfazer toast.
  - `PressCard` in `cards.tsx` receives `titulo` and the actions already; convert its `acoes` shape to `ItemAction` and wrap.
- [ ] **Step 4:** Existing long-press tests still pass (the `Pressable` with `onLongPress` is still inside). Tests PASS; tsc; lint.
- [ ] **Step 5:** Validate on device. Commit `feat(ui): arrastar nos cards de orçamento, cartão, dívida, parcelada, recorrente e meta`.

### Task 6: Fechar ao rolar nas listas próprias, regra escrita, polimento

**Files:**
- Modify: `src/app/finance/transactions.tsx` (SectionList), `src/app/finance/invoice/[id].tsx` (FlatList), `src/app/agent/history.tsx` (FlashList): `onScrollBeginDrag={fecharDeslizavelAberto}`.
- Modify: `.claude/rules/design.md` (§6: "Arrastar o card").

- [ ] **Step 1:** Wire `onScrollBeginDrag` in the three own-scroll lists.
- [ ] **Step 2:** Write the rule in design.md §6:
  - the lados;
  - "Mais";
  - até o fim só com `desfaz`;
  - `fora`;
  - o primitivo é o caminho único.
- [ ] **Step 3:** Run the `ui-polisher` agent on `deslizavel.tsx` and the touched screens; apply what fits.
- [ ] **Step 4:** Full gate (tsc, lint, `npm test` exit code); record a video of the swipe on Android and iPhone. Commit `docs(design): arrastar o card é caminho único`.
