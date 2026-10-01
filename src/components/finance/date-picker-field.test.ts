import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

function datePicker(props: Record<string, unknown>) {
  const state: unknown[] = [];
  let cursor = 0;
  let effects: (() => void)[] = [];
  const element = (type: unknown, props: any, key?: string) => ({ type, key, props: props ?? {} });
  const runtime = { jsx: element, jsxs: element, Fragment: 'Fragment' };
  const module = { exports: {} as any };
  const source = readFileSync('src/components/finance/date-picker-field.tsx', 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  runInNewContext(code, {
    module,
    exports: module.exports,
    require(name: string) {
      if (name === 'react') return {
        useState(initial: unknown) {
          const index = cursor++;
          if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
          return [state[index], (next: unknown) => { state[index] = typeof next === 'function' ? next(state[index]) : next; }];
        },
        useRef(initial: unknown) {
          const index = cursor++;
          if (!(index in state)) state[index] = { current: initial };
          return state[index];
        },
        useEffect(effect: () => void) { effects.push(effect); },
        useLayoutEffect(effect: () => void) { effects.push(effect); },
      };
      if (name === 'react/jsx-runtime') return runtime;
      if (name === 'react-native') return { Pressable: 'Pressable', StyleSheet: { create: (value: unknown) => value }, View: 'View' };
      if (name === 'react-native-reanimated') return {
        __esModule: true,
        default: { View: 'AnimatedView' },
        ReduceMotion: { System: 'system' },
        useSharedValue(initial: unknown) {
          const index = cursor++;
          if (!(index in state)) state[index] = { value: initial, get() { return this.value; }, set(value: unknown) { this.value = value; } };
          return state[index];
        },
        useAnimatedStyle: (style: () => unknown) => style(),
        withTiming: (value: unknown) => value,
        withSpring: (value: unknown) => value,
      };
      if (name === 'expo-haptics') return { selectionAsync() {} };
      if (name === '@/components/motion/cores-suaves') return { useCoresSuaves: () => ({}), useOpacidadeSuave: () => ({}) };
      if (name === '@/components/finance/calendar') return { Calendar: 'Calendar' };
      if (name === '@/components/themed-text') return { ThemedText: 'ThemedText' };
      if (name === '@/components/ui/glass-backdrop') return { GlassBackdrop: 'GlassBackdrop', supportsLiquidGlass: () => false };
      if (name === '@/components/ui/icon') return { Icon: 'Icon' };
      if (name === '@/design/tokens') return { Elevation: { light: {} }, Radius: { sm: 8 }, Space: { sm: 4, md: 8 }, Motion: { duration: { base: 200, morph: 180 }, easing: { out: 'out', inOut: 'inOut' }, spring: { morph: { stiffness: 360, damping: 26, mass: 1 } } } };
      if (name === '@/hooks/use-theme') return { useScheme: () => 'light', useTheme: () => ({ surface: 'surface', cardBorder: 'border', backgroundSelected: 'selected', text: 'text', textSecondary: 'secondary' }) };
      if (name === '@/components/motion/transicao') return { transicaoDeLayout: {} };
      // Este contrato de calendário roda com movimento reduzido; o ciclo do fade é
      // exercitado separadamente em form-motion-ui.test.ts com o helper real.
      if (name === '@/components/motion/presenca') return {
        Presenca: 'Presenca',
        MudancaSuave: 'MudancaSuave',
        usePresencaAtiva: () => true,
        usePresenca: (visivel: boolean) => ({ presente: visivel, estilo: {}, reduzir: true }),
      };
      if (name === '@/lib/dates') return {
        brToISO: (value: string) => value.split('/').reverse().join('-'),
        isValidBRDate: (value: string) => /^\d{2}\/\d{2}\/\d{4}$/.test(value),
        isoToBR: (value: string) => value.split('-').reverse().join('/'),
        localISODate: () => '2026-10-01',
        monthBounds: (month: string) => ({ to: `${month}-${String(new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate()).padStart(2, '0')}` }),
      };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  const component = module.exports.DatePickerField;
  return () => {
    cursor = 0;
    effects = [];
    const tree = component(props);
    effects.forEach((effect) => effect());
    return tree;
  };
}

function find(root: any, predicate: (node: any) => boolean): any {
  if (!root || typeof root !== 'object') return undefined;
  if (root.type === 'Presenca' && !root.props.visivel) return undefined;
  if (predicate(root)) return root;
  const children = root.props?.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = find(child, predicate);
    if (found) return found;
  }
  return undefined;
}

test('month-end control stays visible while the calendar is collapsed and toggles to fixed month-end', () => {
  const lastDayChanges: string[] = [];
  const fixedDateChanges: string[] = [];
  const render = datePicker({
    value: '01/10/2026',
    onChange: (value: string) => fixedDateChanges.push(value),
    onSelectLastDay: (value: string) => lastDayChanges.push(value),
    lastDaySelected: false,
    accessibilityLabel: 'Vencimento',
  });

  let tree = render();
  const control = () => find(tree, (node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'Último dia de todo mês');
  assert.ok(control(), 'a ação de fim do mês aparece fora do calendário recolhido');
  assert.equal(control().props.accessibilityState.selected, false);
  control().props.onPress();
  assert.deepEqual(lastDayChanges, ['31/10/2026']);
  assert.deepEqual(fixedDateChanges, []);

  const selected = datePicker({
    value: '31/10/2026',
    onChange: (value: string) => fixedDateChanges.push(value),
    onSelectLastDay: (value: string) => lastDayChanges.push(value),
    lastDaySelected: true,
    accessibilityLabel: 'Vencimento',
  })();
  const selectedControl = find(selected, (node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'Último dia de todo mês');
  assert.equal(selectedControl.props.accessibilityState.selected, true);
  selectedControl.props.onPress();
  assert.deepEqual(fixedDateChanges, ['31/10/2026'], 'desmarcar converte -1 em dia 31 fixo');
});

test('month-end control is omitted when the date field has no monthly action', () => {
  const render = datePicker({ value: '01/10/2026', onChange() {}, accessibilityLabel: 'Data' });
  const tree = render();
  assert.equal(find(tree, (node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'Último dia de todo mês'), undefined);
  assert.equal(find(tree, (node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'Data').props.accessibilityValue?.text, '01/10/2026');
  const empty = datePicker({ value: null, onChange() {}, accessibilityLabel: 'Data', placeholder: 'Sem data' })();
  assert.equal(find(empty, (node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'Data').props.accessibilityValue?.text, 'Sem data');
});

test('month-end control follows the month shown in the open calendar, not the saved date', () => {
  const lastDayChanges: string[] = [];
  const render = datePicker({
    value: '30/09/2026',
    onChange() {},
    onSelectLastDay: (value: string) => lastDayChanges.push(value),
    lastDaySelected: true,
    accessibilityLabel: 'Vencimento',
  });
  let tree = render();
  find(tree, (node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'Vencimento').props.onPress();
  tree = render();
  find(tree, (node) => node.type === 'Calendar').props.onMonthChange('2026-06');
  tree = render();
  const control = find(tree, (node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'Último dia de todo mês');
  assert.equal(control.props.accessibilityState.selected, false, 'junho na tela: o fim de setembro gravado não está escolhido ali');
  control.props.onPress();
  assert.deepEqual(lastDayChanges, ['30/06/2026']);
});

test('month-end control jumps to the first allowed month when the saved date is before the minimum', () => {
  const lastDayChanges: string[] = [];
  const tree = datePicker({
    value: '15/06/2026',
    onChange() {},
    onSelectLastDay: (value: string) => lastDayChanges.push(value),
    min: '2026-09-28',
    accessibilityLabel: 'Próximo vencimento',
  })();
  const control = find(tree, (node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'Último dia de todo mês');
  assert.equal(control.props.accessibilityState.disabled, false);
  control.props.onPress();
  assert.deepEqual(lastDayChanges, ['30/09/2026']);
});

test('selecting a day closes the calendar, blocks stale calendar callbacks, and leaves month-end available', () => {
  const fixedDateChanges: string[] = [];
  const lastDayChanges: string[] = [];
  const props = {
    value: '01/09/2026',
    onChange(value: string) { fixedDateChanges.push(value); props.value = value; },
    onSelectLastDay: (value: string) => lastDayChanges.push(value),
    accessibilityLabel: 'Vencimento',
  };
  const render = datePicker(props);
  let tree = render();
  find(tree, (node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'Vencimento').props.onPress();
  tree = render();
  const staleCalendar = find(tree, (node) => node.type === 'Calendar');
  staleCalendar.props.onChange('2026-09-18');
  staleCalendar.props.onChange('2026-10-19');
  staleCalendar.props.onMonthChange('2026-12');
  assert.deepEqual(fixedDateChanges, ['18/09/2026'], 'closing is guarded synchronously before another render');
  tree = render();
  assert.equal(find(tree, (node) => node.type === 'Calendar'), undefined);
  assert.equal(find(tree, (node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'Vencimento').props.accessibilityValue?.text, '18/09/2026', 'o leitor deve anunciar a data que acabou de ser escolhida');
  const monthEnd = find(tree, (node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'Último dia de todo mês');
  monthEnd.props.onPress();
  assert.deepEqual(lastDayChanges, ['30/09/2026'], 'the previous day selection must not disable the collapsed month-end control');
  staleCalendar.props.onChange('2026-12-20');
  staleCalendar.props.onMonthChange('2026-12');
  tree = render();
  assert.deepEqual(fixedDateChanges, ['18/09/2026']);
  assert.deepEqual(lastDayChanges, ['30/09/2026']);
  assert.equal(find(tree, (node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'Vencimento').props.accessibilityState.expanded, false);
});

test('reopening remounts the calendar for the saved month and rejects callbacks from the previous opening', () => {
  const dates: string[] = [];
  const monthEnds: string[] = [];
  const render = datePicker({
    value: '15/09/2026', accessibilityLabel: 'Vencimento',
    onChange: (date: string) => dates.push(date), onSelectLastDay: (date: string) => monthEnds.push(date),
  });
  let tree = render();
  const toggle = () => find(tree, (node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'Vencimento').props.onPress();
  toggle(); tree = render();
  const juneCalendar = find(tree, (node) => node.type === 'Calendar');
  juneCalendar.props.onMonthChange('2026-06'); tree = render();
  assert.ok(find(tree, (node) => node.type === 'ThemedText' && node.props.children === 'Usar 30/06/2026'));
  toggle(); tree = render();
  toggle(); tree = render();
  const reopened = find(tree, (node) => node.type === 'Calendar');
  assert.notEqual(reopened.key, juneCalendar.key, 'a new opening remounts only the calendar');
  assert.equal(reopened.props.value, '2026-09-15');
  juneCalendar.props.onMonthChange('2026-06'); juneCalendar.props.onChange('2026-06-18'); tree = render();
  assert.deepEqual(dates, []);
  assert.equal(find(tree, (node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'Vencimento').props.accessibilityState.expanded, true);
  assert.ok(find(tree, (node) => node.type === 'ThemedText' && node.props.children === 'Usar 30/09/2026'), 'the new opening and its month-end action both start in September');
  reopened.props.onMonthChange('2026-06'); tree = render();
  assert.ok(find(tree, (node) => node.type === 'ThemedText' && node.props.children === 'Usar 30/06/2026'));
  find(tree, (node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'Último dia de todo mês').props.onPress();
  assert.deepEqual(monthEnds, ['30/06/2026']);
});
