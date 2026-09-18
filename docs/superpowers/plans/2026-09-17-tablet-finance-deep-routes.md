# Tablet Finance Deep Routes Implementation Plan

> **Revisão de 18/09/2026:** qualquer referência a rail Android abaixo está superada. A
> navegação Android mantém a `PillTabBar` inferior no tablet.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every pushed Financeiro destination useful and readable on Android tablets and iPad without changing financial contracts or the compact flow.

**Architecture:** Keep `Screen` as the scroll/safe-area owner and `AdaptivePanes` as the measured split owner. Use named, route-specific slots only where the task truly has two simultaneous contexts; forms and decisive confirmations remain bounded single-column surfaces. Charts measure their actual card interiors, never the global window.

**Tech Stack:** Expo SDK 57, Expo Router, React Native, TanStack Query, Reanimated, Skia, Node test runner.

## Global Constraints

- Historical execution note: work was isolated in `/private/tmp/personal-proops-tablet-20260917`
  on `feat/tablet-adaptive`; it was integrated into `gabriel/concreto` on 18/09/2026 and that
  worktree and branch were removed. Preserve the current main worktree for future changes.
- Read `AGENTS.md`, the approved `docs/superpowers/specs/2026-09-17-tablet-adaptive-design.md`, and exact Expo 57 docs before source edits.
- Preserve cent-based money, query/cache keys, loading/empty/error states, destructive confirmations, concealment, VoiceOver/TalkBack labels, native iPad headers, and the compact view.
- Android phone and tablet: bottom pill. iPad: native tab semantics from Expo Router; no Android chrome on iOS.
- Do not add a visual library unless an exact capability gap and Expo 57 compatibility are demonstrated.
- Source edits use `apply_patch`; tests begin red; commit explicit paths only, never the `node_modules` symlink.

---

### Task 1: Card-local chart geometry

**Files:**
- Create: `src/components/ui/measured-sparkline.tsx`
- Modify: `src/app/finance/forecast.tsx`, `src/app/finance/net-worth.tsx`, `src/app/finance/invoice/[id].tsx`, `src/components/finance/invoice-dock.tsx`
- Test: `src/design/adaptive-window.test.ts`, `src/lib/tablet-chart-source.test.ts`

**Interfaces:**
- Consumes: `Sparkline` and `chartWidthForPane(paneWidthDp, horizontalInsetDp)`.
- Produces: `MeasuredSparkline(props: Omit<SparklineProps, 'width'>)` which measures its own wrapper and forwards its exact positive width; invoice skeleton and dock use the reading column/actual card width instead of the global window.

- [x] **Step 1: Write failing tests** asserting Finance forecast and net-worth render `MeasuredSparkline`, and invoice skeleton width never exceeds its 800dp reading column at a 1200dp window. Add a pure width assertion for 384dp and 1200dp.
- [x] **Step 2: Run** `node --test src/lib/tablet-chart-source.test.ts src/design/adaptive-window.test.ts`; expect a missing component/usage failure.
- [x] **Step 3: Implement** a wrapper with `onLayout`, `useState(0)`, and `<Sparkline {...props} width={measured} />` only when `measured > 0`. In invoice use `Math.min(width, rootContentMaxWidth(width, false)) - Space.lg * 2` for the skeleton estimate and cap the `FlatList` content to that reading width. `InvoiceDock` measures its own `View` before sizing `CardFace`; its rotation divides by `Math.max(1, measuredWidth)`.
- [x] **Step 4: Verify** the focused tests, `npx tsc --noEmit`, `npm run lint`, and the forecast/net-worth/invoice preview on phone/tablet. Confirm no chart crosses a card boundary at 1.3× font.
- [x] **Step 5: Commit** only task files with `fix(tablet): measure finance charts inside cards`.

### Task 2: Analysis routes as decision canvases

**Files:**
- Modify: `src/app/finance/forecast.tsx`, `src/app/finance/net-worth.tsx`, `src/app/finance/reports.tsx`, `src/app/finance/cycle.tsx`
- Create: `src/components/finance/finance-analysis-panes.tsx`
- Test: `src/lib/tablet-finance-routes.test.ts`

**Interfaces:**
- Consumes: `useAdaptiveWindow`, `AdaptivePanes`, existing route queries and actions.
- Produces: named `primary` and `support` slots in `FinanceAnalysisPanes`, with the exact compact order supplied as `singlePaneContent`; no new query or derived financial total.

- [ ] **Step 1: Add red structural tests** for each route's preserved HeaderActions, refresh, error, export/period/selector actions, and the tablet adapter. Use source tests only for wiring; device inspection remains the visual gate.
- [ ] **Step 2: Run** `node --test src/lib/tablet-finance-routes.test.ts`; capture the missing-layout failure.
- [ ] **Step 3: Extract** the existing JSX into named route blocks. Forecast keeps horizon+chart together and scenario/monthly explanation alongside; patrimônio keeps total+evolution together with asset/liability breakdown alongside; reports keeps year selector+summary with tax-useful balances/categories alongside; cycle keeps the same `describeCycle` total and period with grouped lines alongside. All four pass `Screen wide` only in noncompact windows, and each single-pane expression follows the prior source order exactly.
- [ ] **Step 4: Verify** the tests, typecheck, lint, and each screen in portrait/landscape tablet and compact phone. Check scrub/selection, export, concealment, refresh, and error before commit.
- [ ] **Step 5: Commit** named files with `feat(tablet): compose finance analysis routes`.

### Task 3: Financial lists and their real selection routes

**Files:**
- Modify: `src/app/finance/transactions.tsx`, `src/app/finance/accounts.tsx`, `src/app/finance/cards.tsx`, `src/app/finance/wallet.tsx`, `src/app/finance/invoices.tsx`, `src/app/finance/invoice/[id].tsx`, `src/app/finance/[txId].tsx`
- Create: `src/components/finance/finance-list-workspace.tsx`
- Test: `src/lib/tablet-finance-routes.test.ts`

**Interfaces:**
- Consumes: `AdaptivePanes` and existing Expo Router IDs (`txId`, invoice `id`, account/card IDs).
- Produces: bounded list/context slots; selection is encoded by real route IDs and never by a synthetic selected-row state. If an inline detail cannot reuse the actual route safely, keep navigation and show a truthful task prompt in the support pane.

- [ ] **Step 1: Add red route tests** for row press targets, pinned/sticky headers, pagination, wallet/card flight, invoice payment and settlement distinction, and tablet pane wiring.
- [ ] **Step 2: Run** the focused route test and record the first missing adapter/width failure.
- [ ] **Step 3: Move** only presentation blocks into `FinanceListWorkspace`; keep list virtualization and row handlers where they are. Transactions gets list plus period/filter context, accounts gets balances plus account actions, cards/wallet/invoices get real card and billing context. Transaction and invoice detail keep their existing payment/correction gates and a bounded reading surface.
- [ ] **Step 4: Verify** phone/tablet route navigation, Back, deep links, long lists, invoice/card touch targets and keyboard; run tests, typecheck and lint.
- [ ] **Step 5: Commit** named files with `feat(tablet): compose finance list and detail routes`.

### Task 4: Task-focused finance surfaces

**Files:**
- Modify: `src/app/finance/transaction-form.tsx`, `src/app/finance/budgets.tsx`, `src/app/finance/goals.tsx`, `src/app/finance/debts.tsx`, `src/app/finance/installments.tsx`, `src/app/finance/recurring.tsx`, `src/app/finance/rules.tsx`, `src/app/finance/plan.tsx`, `src/app/finance/manage.tsx`
- Test: `src/lib/tablet-finance-routes.test.ts`

**Interfaces:**
- Consumes: existing `Screen`, `Sheet`, `TaskHeader`, mutation hooks and tablet window classification.
- Produces: form widths capped for reading and touch; adjacent context only when the existing route already has a meaningful summary. No second editor, invented metric or extra query.

- [ ] **Step 1: Write red tests** for all nine route entry points and current Save/Delete/Cancel contracts, including transaction installment scope and plan/paywall navigation.
- [ ] **Step 2: Run** `node --test src/lib/tablet-finance-routes.test.ts`; note missing adaptive wiring.
- [ ] **Step 3: Apply** route-local bounded surfaces and two-pane compositions only to actual simultaneous workflows: budgets/goal/debt rule list next to editor context, recurring/installments next to schedule explanation, plan/manage next to current plan status. Transaction form stays a concentrated form; preserve the Android/iPad keyboard-aware scroll and sheet semantics.
- [ ] **Step 4: Verify** every form's focused field above keyboard, font 1.3×, dark mode, error and Save/Cancel paths on tablet/phone; run test/type/lint.
- [ ] **Step 5: Commit** named files with `feat(tablet): adapt finance task surfaces`.

### Task 5: Finance route acceptance

**Files:**
- Create: `docs/tablet-finance-acceptance.md`

**Interfaces:**
- Consumes: Tasks 1–4; produces an exact route-by-route evidence matrix with screenshots and blocked checks.

- [ ] **Step 1: Record** each of the 21 Financeiro destinations as inspected or blocked, including Android phone/tablet and iPhone/iPad, orientation, light/dark, 1.3× font, keyboard, empty/error, Back/deep link, and result of any real flow.
- [ ] **Step 2: Run** `npm test`, `npx tsc --noEmit`, `npm run lint`, `git diff --check`; record exit statuses and tested commit.
- [ ] **Step 3: Inspect** a grouped screenshot pass and one bounded defect-fix pass; do not claim physical-device validation from an emulator or simulator.
- [ ] **Step 4: Commit** only the evidence document with `test(tablet): record finance route acceptance`.

## Self-review

- Coverage: all 21 Financeiro destinations in the approved spec map to Tasks 1–5; visual/device gates are explicit and no Agent-owned files are touched.
- Shared `Screen`, native headers, route IDs, mutation/query ownership, and phone order remain in place. A route may legitimately stay one concentrated pane when its task is a form or confirmation.
- The user already chose inline execution for this approved tablet effort; use the existing `executing-plans` workflow without reopening that choice.
