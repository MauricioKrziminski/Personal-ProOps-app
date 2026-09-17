# Tablet Foundation and Root Screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the five main Personal ProOps destinations an Android/iPad tablet composition while preserving every phone flow and preparing reusable primitives for the remaining routes.

**Architecture:** Classify the current window, not the device, in a pure design module. Keep the existing Expo Router URLs and iOS `NativeTabs`; switch only Android's custom chrome between the current pill and a rail. Extend `Screen` and add a small pane primitive so root screens can arrange their existing content, queries and actions without copying business logic.

**Tech Stack:** Expo SDK 57, React Native 0.86, React 19.2.3, Expo Router 57, TypeScript, Reanimated 4, Skia 2.6, Gesture Handler 2.32, FlashList 2, `node --test`.

## Global Constraints

- Read `AGENTS.md`, `PRODUCT.md`, `DESIGN.md` and `docs/superpowers/specs/2026-09-17-tablet-adaptive-design.md`. The Expo reference is **`https://docs.expo.dev/versions/v57.0.0/`**, not the unversioned latest docs.
- Keep the Suave / Papel e Tinta identity: warm paper, monochrome brand, semantic green/brick/amber, Plus Jakarta Sans, and existing iOS Liquid Glass. No generic blue fintech palette or second UI kit.
- Window width classes: compact `<600dp`, medium `600–839dp`, expanded `>=840dp`. Treat width changes, rotation and multi-window as live state; never branch on device model or physical pixels.
- Android touch targets `>=48dp`, iPad `>=44pt`; no truncated identifiers, false financial values, destructive action without its existing confirmation, or inaccessible gesture-only action.
- Preserve the existing compact layout and all root actions/routes. Existing `Screen` iOS native large-title behavior is a regression guard. Do not alter backend, SQL, agent Python, or deploy any environment.
- The shared worktree has concurrent, uncommitted Agent changes. **Do not edit, stage, commit, reset or reformat those files.** Execution should first use `using-git-worktrees` to make an isolated tablet branch from commit `1e5a728`; keep Agent root work behind a conflict check and integrate only after the parallel edits are committed or coordinated.
- Stage explicit paths for each commit; no broad `git add .`. Before any commit, inspect `git diff --cached --name-only` and confirm ownership. Do not prune the pre-existing stale worktree as a side effect.
- Work in verified increments: test the pure decision, inspect an Android phone and Pixel Tablet, then iPhone and iPad simulators. Compilation alone is not UI proof; physical refresh-rate/performance proof remains separate.

This is **plan 1 of 3** for the approved spec. Plan 2 owns the deep Notes/Finance/Agent routes; plan 3 owns authentication, account, auxiliary routes and the full route-by-route acceptance matrix. These will be written with exact interfaces after this foundation is proven, rather than guessing their integration points now. The five roots form an independently testable product increment.

---

### Task 1: Pure window classification and pane sizing

**Files:**
- Create: `src/design/adaptive-window.ts`
- Test: `src/design/adaptive-window.test.ts`

**Interfaces:**
- Produces: `type WindowClass = 'compact' | 'medium' | 'expanded'`;
  `classifyWindow(widthDp: number): WindowClass`;
  `tabletPaneWidths(containerWidthDp: number): { main: number; support: number; twoPane: boolean }`.
- Consumers: Tasks 2–8. This is geometry only; no React, theme or navigation state.

- [ ] **Step 1: Write the failing tests** for 599/600/839/840dp, resize back to compact, and pane minimums. Use this test shape:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyWindow, tabletPaneWidths } from './adaptive-window.ts';

test('window classes follow the available dp width', () => {
  assert.deepEqual([599, 600, 839, 840].map(classifyWindow),
    ['compact', 'medium', 'medium', 'expanded']);
});
test('support pane appears only when both panes remain readable', () => {
  assert.equal(tabletPaneWidths(704).twoPane, false);
  const wide = tabletPaneWidths(1144);
  assert.equal(wide.twoPane, true);
  assert.ok(wide.main >= 560 && wide.support >= 320);
});
```

- [ ] **Step 2: Run** `node --test src/design/adaptive-window.test.ts`; expect import/function failure.
- [ ] **Step 3: Implement** the pure module with explicit clamps, `RAIL_WIDTH = 88`, `PANE_GAP = 24`, main minimum `560`, support minimum `320`, and finite-width fallback. The implementation must not force two panes solely because class is expanded:

```ts
export type WindowClass = 'compact' | 'medium' | 'expanded';
export const RAIL_WIDTH = 88;
export function classifyWindow(widthDp: number): WindowClass {
  if (!Number.isFinite(widthDp) || widthDp < 600) return 'compact';
  return widthDp < 840 ? 'medium' : 'expanded';
}
export function tabletPaneWidths(containerWidthDp: number) {
  const usable = Math.max(0, Number.isFinite(containerWidthDp) ? containerWidthDp : 0);
  const support = Math.min(400, Math.max(320, usable * 0.34));
  const twoPane = usable - 24 - support >= 560 && usable >= 904;
  return { main: twoPane ? usable - 24 - support : usable, support: twoPane ? support : 0, twoPane };
}
```

- [ ] **Step 4: Run** `node --test src/design/adaptive-window.test.ts` and `npx tsc --noEmit`; expect pass.
- [ ] **Step 5: Commit** only those two files with `feat(tablet): define adaptive window geometry`.

### Task 2: Responsive `Screen` and pane primitive

**Files:**
- Create: `src/hooks/use-adaptive-window.ts`
- Create: `src/components/ui/adaptive-panes.tsx`
- Modify: `src/components/ui/screen.tsx`
- Test: `src/design/adaptive-window.test.ts` (add width/rail/inset assertions)

**Interfaces:**
- Consumes: Task 1's `classifyWindow`, `tabletPaneWidths`, `RAIL_WIDTH`.
- Produces: `useAdaptiveWindow(): { width: number; fontScale: number; windowClass: WindowClass; androidRail: boolean }`;
  `AdaptivePanes({ main, support, singlePane?, singlePaneContent?, testID? }: { main: React.ReactNode; support?: React.ReactNode; singlePane?: 'stack' | 'main-only'; singlePaneContent?: React.ReactNode; testID?: string })`;
  optional `Screen` prop `wide?: boolean` (false by default);
  pure `rootContentMaxWidth(widthDp, wide)` and `bottomPillInset(platform, hasTopBar, windowClass, pillSpace)` helpers.

- [ ] **Step 1: Add failing geometry assertions** for 384dp and 1280dp: compact keeps the current bottom-pill inset and 800dp maximum; wide root can use up to 1200dp; rail root has zero pill inset. Pure helpers may be exported from `adaptive-window.ts` so the test never imports a native component:

```ts
assert.equal(rootContentMaxWidth(384, false), 800);
assert.equal(rootContentMaxWidth(1280, true), 1200);
assert.equal(bottomPillInset('android', true, 'compact', 76), 76);
assert.equal(bottomPillInset('android', true, 'expanded', 76), 0);
```

- [ ] **Step 2: Run** `node --test src/design/adaptive-window.test.ts`; expect missing-helper failure.
- [ ] **Step 3: Implement** those pure helpers, the hook using `useWindowDimensions`, and `AdaptivePanes` with independent pane minimums. Change only `Screen`'s root-content max width/inset when `wide` is true or when Android rail is active; the default compact path must remain byte-for-byte equivalent in behavior. Use named props instead of a broad `style` override:

```tsx
export function useAdaptiveWindow() {
  const { width, fontScale } = useWindowDimensions();
  const windowClass = classifyWindow(width);
  return {
    width,
    fontScale,
    windowClass,
    androidRail: Platform.OS === 'android' && windowClass !== 'compact',
  };
}

export function rootContentMaxWidth(_widthDp: number, wide: boolean) {
  return wide ? 1200 : 800;
}

export function bottomPillInset(
  platform: string,
  hasTopBar: boolean,
  windowClass: WindowClass,
  pillSpace: number,
) {
  return platform === 'android' && hasTopBar && windowClass === 'compact' ? pillSpace : 0;
}
```

  Put the hook in `use-adaptive-window.ts` and the two pure helper exports in `adaptive-window.ts`. In `Screen`, use `rootContentMaxWidth(width, wide)` for the content width and pass the existing `TAB_BAR_SPACE` as the fourth `bottomPillInset` argument. `AdaptivePanes` measures **its own container** with `onLayout`; do not infer the pane width from the whole window. If `singlePaneContent` is provided, render that exact node when the second pane cannot fit, preserving the original reading order. Otherwise render `main` then `support` vertically when `singlePane='stack'` (default), or only `main` when `singlePane='main-only'`. Render both horizontally when `twoPane` is true. Use one 24dp gap; do not animate layout on each resize frame. Do not swallow native-stack `ScrollView` as an extra wrapper on pushed iOS routes; this primitive is used initially in tab roots only.
- [ ] **Step 4: Run** the focused test, `npx tsc --noEmit`, and `npm run lint`. Check `Screen` on a 384dp phone before any root opts into `wide`.
- [ ] **Step 5: Commit** only the four owned paths with `feat(tablet): add adaptive screen and pane primitives`.

### Task 3: Android navigation rail without changing route registration

**Files:**
- Create: `src/components/ui/tablet-navigation-rail.tsx`
- Modify: `src/components/app-tabs.android.tsx`
- Modify: `src/lib/agent-navigation.test.ts` (the existing tab-order contract, not an Agent runtime file)

**Interfaces:**
- Consumes: `useAdaptiveWindow().androidRail`, `RAIL_WIDTH`, the existing `TABS`/`HREFS`, `useSegments`, `router.navigate`.
- Produces: `TabletNavigationRail({ tabs, activeIndex, onSelect }: { tabs: PillTab[]; activeIndex: number; onSelect: (index: number) => void })`. No new tab state.

- [ ] **Step 1: Extend the existing source-level tab-order test** to assert that the rail and pill receive the same `tabs` array and that the badge is derived only for Hoje. Keep `TABS` and `HREFS` declared in `app-tabs.android.tsx`, so the existing iOS/Android/web textual order guard remains valid:

```ts
const android = ler('components/app-tabs.android.tsx');
assert.match(android, /<TabletNavigationRail\s+tabs=\{tabs\}/);
assert.match(android, /<PillTabBar\s+tabs=\{tabs\}/);
assert.match(android, /t\.name === 'today' \? \{ \.\.\.t, badge: pendentes \} : t/);
```

- [ ] **Step 2: Run** `node --test src/lib/agent-navigation.test.ts`; expect the new shared export/rail assertion to fail.
- [ ] **Step 3: Implement** the rail with theme tokens, at least 48dp hit areas, visible labels, selected state, badge `9+` cap, safe-area top/bottom, keyboard focus and Reanimated transform/opacity selection. In `AppTabs`, keep `<TabList style={styles.hidden}>` registered once and branch only the chrome:

```tsx
<Tabs style={{ flex: 1, backgroundColor: theme.background }}>
  <View style={androidRail ? styles.withRail : styles.fill}>
    {androidRail ? <TabletNavigationRail tabs={tabs} activeIndex={atual} onSelect={goToTab} /> : null}
    <TabSlot />
  </View>
  {androidRail ? null : <PillTabBar tabs={tabs} activeIndex={atual} onSelect={goToTab} />}
  <TabList style={styles.hidden}>
    {TABS.map((tab, i) => (
      <TabTrigger key={tab.name} name={tab.name} href={HREFS[i]}>
        <ThemedText type="caption">{tab.label}</ThemedText>
      </TabTrigger>
    ))}
  </TabList>
</Tabs>
```

  Use the existing shared `Motion.spring.tab`; honor reduced motion. Do not animate width/height per frame. Keep the pill untouched on phones.
- [ ] **Step 4: Run** the focused test, `npx tsc --noEmit`, `npm run lint`. On the Android phone and Pixel Tablet, tap all five destinations, use Back, and confirm the active label/badge match the route after deep-link navigation.
- [ ] **Step 5: Commit** only task-owned files with `feat(tablet): add adaptive Android navigation rail`.

### Task 4: Hoje as a decision canvas

**Files:**
- Create: `src/components/feed/today-tablet-canvas.tsx`
- Modify: `src/app/(tabs)/today/index.tsx`
- Test: `src/design/adaptive-window.test.ts` (add Today canvas decision)

**Interfaces:**
- Consumes: `useAdaptiveWindow`, `AdaptivePanes`, `Screen wide`, existing Today blocks/queries/actions.
- Produces: `TodayTabletCanvas({ hero, decisions, day, upcoming }: { hero: React.ReactNode; decisions: React.ReactNode; day: React.ReactNode; upcoming: React.ReactNode })` in an expanded window; compact render keeps the current order.

- [ ] **Step 1: Add a failing pure layout test** for `todayCanvasMode(containerWidth)`: `336 -> 'stack'`, `752 -> 'stack'`, `1144 -> 'two-pane'`. The mode must consider measured usable space, not width class alone.
- [ ] **Step 2: Run** the focused adaptive-window test; expect `todayCanvasMode` missing.
- [ ] **Step 3: Implement** the mode helper and extract existing JSX into stable fragments without duplicating queries, financial arithmetic or handlers. On wide screens, hero + Pista stay in the main pane, actionable signals/Agora align in support, and day/coming sections follow in the original urgency sequence. The exact same blocks render once in each mode. Use named slots, then select composition with this expression inside the existing `Screen`:

```tsx
{tablet
  ? <TodayTabletCanvas hero={heroBlock} decisions={decisionsBlock} day={dayBlock} upcoming={upcomingBlock} />
  : <>{heroBlock}{decisionsBlock}{dayBlock}{upcomingBlock}</>}

export function todayCanvasMode(containerWidthDp: number) {
  return tabletPaneWidths(containerWidthDp).twoPane ? 'two-pane' : 'stack';
}

type TodayTabletCanvasProps = {
  hero: React.ReactNode;
  decisions: React.ReactNode;
  day: React.ReactNode;
  upcoming: React.ReactNode;
};

export function TodayTabletCanvas({ hero, decisions, day, upcoming }: TodayTabletCanvasProps) {
  return (
    <AdaptivePanes
      main={<>{hero}{day}{upcoming}</>}
      support={decisions}
      singlePaneContent={<>{hero}{decisions}{day}{upcoming}</>}
    />
  );
}
```

  Define `TodayTabletCanvasProps` as four `React.ReactNode` slots in `today-tablet-canvas.tsx`; put the pure `todayCanvasMode` helper in `adaptive-window.ts`. The four named values are the **current full JSX blocks** moved from `today/index.tsx`; map every current section to exactly one slot before editing and do not drop a block. The `singlePaneContent` order is the current phone reading order. Preserve `isError` gates and menu destinations. Do not display a duplicated `Livre` number in the support pane.
- [ ] **Step 4: Run** focused test, `npx tsc --noEmit`, `npm run lint`. Capture tablet landscape/portrait and phone; compare every Today action/section to the pre-change inventory and test the Pista interaction.
- [ ] **Step 5: Commit** task-owned files with `feat(tablet): compose Hoje decision canvas`.

### Task 5: Financeiro as an analysis workspace

**Files:**
- Create: `src/components/finance/finance-tablet-canvas.tsx`
- Modify: `src/app/(tabs)/finance/index.tsx`
- Test: `src/design/adaptive-window.test.ts` (finance pane and chart-width boundaries)

**Interfaces:**
- Consumes: `useAdaptiveWindow`, `AdaptivePanes`, `Screen wide`, existing finance blocks and `ScrubChart`.
- Produces: `FinanceTabletCanvas` with named `cycle`, `actions`, `ledger`, `breakdown` slots; no new data query. `chartWidthForPane(paneWidthDp: number, horizontalInsetDp: number): number` lives in `adaptive-window.ts`.

- [ ] **Step 1: Add failing tests** that a 1144dp content container yields two panes but 704dp does not, and that `chartWidthForPane(tabletPaneWidths(1144).main, 16) <= tabletPaneWidths(1144).main - 32` while `chartWidthForPane(336, 16) === 304` on a phone. A pure helper avoids deriving chart width from the whole window.
- [ ] **Step 2: Run** the focused test; expect missing chart/pane helper failure.
- [ ] **Step 3: Implement** `FinanceTabletCanvas` and move the existing period, hero, Entra/Sai, Cartões, mosaico, ledger and charts into named areas. Measure chart container via `onLayout` or pass its pane width rather than `width - ...` from the whole window. The exact existing `ScrubChart` props remain; replace only its `width={chartWidth}` expression:

```tsx
const [chartPaneWidth, setChartPaneWidth] = useState(0);
const chartWidth = chartWidthForPane(chartPaneWidth, Space.lg);
const measureChartPane = (event: LayoutChangeEvent) =>
  setChartPaneWidth(event.nativeEvent.layout.width);

export function chartWidthForPane(paneWidthDp: number, horizontalInsetDp: number) {
  return Math.max(0, paneWidthDp - horizontalInsetDp * 2);
}

type FinanceTabletCanvasProps = {
  cycle: React.ReactNode;
  actions: React.ReactNode;
  ledger: React.ReactNode;
  breakdown: React.ReactNode;
};

export function FinanceTabletCanvas({ cycle, actions, ledger, breakdown }: FinanceTabletCanvasProps) {
  return (
    <AdaptivePanes
      main={<>{cycle}{ledger}</>}
      support={<>{actions}{breakdown}</>}
      singlePaneContent={<>{cycle}{actions}{ledger}{breakdown}</>}
    />
  );
}
```

  Put the pure chart helper in `adaptive-window.ts`; define `FinanceTabletCanvasProps` as four `React.ReactNode` slots in `finance-tablet-canvas.tsx`. Before coding, map the source order to the `singlePaneContent` expression and adjust that expression to match exactly; the sample order is not authority over the current screen. Keep card flight, wallet navigation, invoice link, FAB, month/cycle selector, all `isError` checks and cent-based values unchanged. No generic `TileGrid` replication merely to fill columns.
- [ ] **Step 4: Run** focused test, `npx tsc --noEmit`, `npm run lint`. On phone/tablet, switch Mês/Ciclo, scrub the chart, open Carteira/fatura, and inspect last item versus FAB/rail overlap.
- [ ] **Step 5: Commit** task-owned files with `feat(tablet): compose Financeiro workspace`.

### Task 6: Notes library and Profile settings roots

**Files:**
- Create: `src/components/notes/notes-tablet-library.tsx`
- Modify: `src/components/ui/adaptive-panes.tsx` (add library/reading sizing preset)
- Modify: `src/app/(tabs)/notes/index.tsx`
- Modify: `src/app/(tabs)/profile/index.tsx`
- Test: `src/design/adaptive-window.test.ts` (minimum list and reading widths)

**Interfaces:**
- Consumes: `useAdaptiveWindow`, `AdaptivePanes`, `Screen wide`, existing note/profile actions.
- Produces: `readingPaneWidths(containerWidthDp)` with 280dp list/480dp reading minimums; `AdaptivePanes` gains `variant?: 'main-support' | 'library-reading'`, defaulting to `main-support`. Notes root has a library/filter pane and bounded preview/empty selection; Profile has grouped navigation and bounded settings content. Deep note/profile detail remains in plan 2/3.

- [ ] **Step 1: Add failing tests** for list minimum `280dp`, reading minimum `480dp`, and fallback to a single pane when unavailable. Verify a roughly 720dp iPad-portrait content container has one primary area; a roughly 976dp iPad-landscape container can show two if minimums fit.
- [ ] **Step 2: Run** the focused adaptive-window test; expect the dedicated `readingPaneWidths` helper missing.
- [ ] **Step 3: Implement** library and Profile compositions by extracting the current quick-capture, search, folder grid, note list, profile hero and settings groups into local slots; re-render the same item cards and handlers. Tablet notes selection uses route IDs, not an unsaved parallel selection state. The empty reading pane states what tapping a note will do. Keep note drag/reorder confined to its list and preserve the current viewport-height handling.

```ts
export function readingPaneWidths(containerWidthDp: number) {
  const available = Math.max(0, Number.isFinite(containerWidthDp) ? containerWidthDp : 0);
  const list = Math.max(280, Math.min(360, available * 0.36));
  const twoPane = available - list - 24 >= 480;
  return {
    list: twoPane ? list : available,
    reading: twoPane ? available - list - 24 : 0,
    twoPane,
  };
}

type NotesTabletLibraryProps = {
  library: React.ReactNode;
  prompt: React.ReactNode;
};

export function NotesTabletLibrary({ library, prompt }: NotesTabletLibraryProps) {
  return (
    <AdaptivePanes
      main={library}
      support={prompt}
      variant="library-reading"
      singlePane="main-only"
    />
  );
}

type ProfileTabletCanvasProps = {
  account: React.ReactNode;
  settings: React.ReactNode;
};

function ProfileTabletCanvas({ account, settings }: ProfileTabletCanvasProps) {
  return <AdaptivePanes main={account} support={settings} />;
}
```

  Put `readingPaneWidths` in `adaptive-window.ts` and have `AdaptivePanes` choose it when `variant='library-reading'`. Define both prop types as named `React.ReactNode` slots in their respective files. The `library` node retains the existing filtered items and callbacks; the pane prompt must never imply a selected note before a route ID exists. `singlePane='main-only'` keeps portrait from appending an inert empty pane below the list.

  Do not show private profile values in an unguarded new pane. Preserve `ConcealProvider` and lock behavior.
- [ ] **Step 4: Run** focused test, `npx tsc --noEmit`, `npm run lint`. On tablet and phone, test quick note, search, folders, a note open/back, profile settings and concealed balance.
- [ ] **Step 5: Commit** only task-owned files with `feat(tablet): compose Notes and Profile roots`.

### Task 7: Agent root after concurrent-work boundary

**Files:**
- Create: `src/components/agent/agent-tablet-workspace.tsx`
- Modify: `src/app/(tabs)/agent/index.tsx` **only after** the adjacent session's edits are committed or the owner coordinates an explicit shared-file handoff.
- Test: `src/lib/agent-navigation.test.ts`, `src/design/adaptive-window.test.ts`

**Interfaces:**
- Consumes: `useAdaptiveWindow`, `AdaptivePanes`, current final Agent root and conversation list.
- Produces: tablet conversation index beside a real selected thread; no agent API or message-contract changes.

- [ ] **Step 1: Check the boundary**: `git status --short`, `git diff -- src/app/'(tabs)'/agent/index.tsx`, and `git log -1 --oneline`. If the adjacent work is still uncommitted, leave these files untouched; run the non-Agent checks in Task 8, but do **not** mark the five-root increment complete or claim Agent acceptance. Resume Task 7 after an explicit handoff; do not copy a stale version into the tablet branch.
- [ ] **Step 2: Once ownership is clear, add failing tests** for five-tab route order and agent pane width (384 one pane, 1280 two). Run `node --test src/lib/agent-navigation.test.ts src/design/adaptive-window.test.ts` and record the failure.
- [ ] **Step 3: Implement** a split using the *current* committed Agent UI, `FlashList` item renderer and existing `/agent/[id]` URL. Render a prompt or selected thread only when its state is real; preserve draft/session semantics and error states. Keep root query and thread route contracts intact.

```tsx
type AgentTabletWorkspaceProps = {
  list: React.ReactNode;
  detail: React.ReactNode;
};

export function AgentTabletWorkspace({ list, detail }: AgentTabletWorkspaceProps) {
  return <AdaptivePanes main={list} support={detail} singlePane="main-only" />;
}
```

  The adapter owns only pane arrangement. Keep the current compact return tree as the compact branch rather than recreating it in the adapter. Determine whether the selected thread can be rendered inline with the current route contract before finalizing the expanded branch; if not, keep thread navigation and use the support pane for a useful real empty state, not a fake preview.

- [ ] **Step 4: Run** focused tests, `npx tsc --noEmit`, `npm run lint`. On tablet, select thread, start new, return, and resize to compact without losing draft; do not send a message solely as a layout test.
- [ ] **Step 5: Commit** only owned Agent adapter/integration paths after staged-path inspection with `feat(tablet): compose Agent workspace`.

### Task 8: Root acceptance gate and handoff to deep-route plans

**Files:**
- Create: `docs/tablet-root-acceptance.md`
- Modify: no runtime files unless a bounded defect from this gate is demonstrated.

**Interfaces:**
- Consumes: Tasks 1–7 and the approved tablet spec.
- Produces: screenshot/interaction matrix and exact follow-on route inventory for plans 2 and 3.

- [ ] **Step 1: Write** a route/root matrix with five destinations × Android phone/tablet and iPhone/iPad; record compact/medium/expanded, portrait/landscape, light/dark, font 1.3, Back/deep link, keyboard, empty/error state, and any blocked hardware-only check. Link the generated screenshots and identify the build/commit tested.
- [ ] **Step 2: Run** `npm test`, `npx tsc --noEmit`, `npm run lint`, and `APP_VARIANT=development npx expo run:android --device emulator-5556` on the isolated branch after confirming the AVD and package ID. Record exact command, exit status and native build variant; avoid any production/staging write.
- [ ] **Step 3: Use** the Pixel Tablet AVD plus a phone AVD and iPad/iPhone simulators to inspect every root and the flows listed in Tasks 4–7. One bounded screenshot pass, one grouped defect-fix pass, and at most one confirmation pass, per Impeccable.
- [ ] **Step 4: Commit** only the acceptance document (and separately owned fixes, if any) with `test(tablet): record root-screen device acceptance`. Do not call emulator proof physical-device proof.

## Self-review at execution

- Spec coverage for this plan: adaptive width, Android rail, iPad native chrome, five roots, motion/accessibility baseline, no fabricated values, phone preservation and cross-device verification. Deep routes, auth/support and full matrix are deliberately assigned to plans 2 and 3, not silently omitted.
- No code change in this plan may touch the neighboring Agent work until the Task 7 boundary passes. The isolated worktree prevents accidental staging but does not replace a semantic diff review before integration.
- Before implementing each task, read its target file and current tests in full; use the snippets as interface contracts, not as permission to drop any existing branch-specific handler or screen block.
