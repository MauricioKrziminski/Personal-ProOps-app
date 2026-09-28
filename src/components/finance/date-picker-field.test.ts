import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

function datePicker(props: Record<string, unknown>) {
  const state: unknown[] = [];
  let cursor = 0;
  const element = (type: unknown, props: any) => ({ type, props: props ?? {} });
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
          if (!(index in state)) state[index] = initial;
          return [state[index], (next: unknown) => { state[index] = next; }];
        },
      };
      if (name === 'react/jsx-runtime') return runtime;
      if (name === 'react-native') return { Pressable: 'Pressable', StyleSheet: { create: (value: unknown) => value }, View: 'View' };
      if (name === 'react-native-reanimated') return { default: { View: 'AnimatedView' } };
      if (name === 'expo-haptics') return { selectionAsync() {} };
      if (name === '@/components/finance/calendar') return { Calendar: 'Calendar' };
      if (name === '@/components/themed-text') return { ThemedText: 'ThemedText' };
      if (name === '@/components/ui/glass-backdrop') return { GlassBackdrop: 'GlassBackdrop', supportsLiquidGlass: () => false };
      if (name === '@/components/ui/icon') return { Icon: 'Icon' };
      if (name === '@/design/tokens') return { Elevation: { light: {} }, Radius: { sm: 8 }, Space: { sm: 4, md: 8 } };
      if (name === '@/hooks/use-theme') return { useScheme: () => 'light', useTheme: () => ({ surface: 'surface', cardBorder: 'border', backgroundSelected: 'selected', text: 'text', textSecondary: 'secondary' }) };
      if (name === '@/components/motion/transicao') return { transicaoDeLayout: {} };
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
    return component(props);
  };
}

function find(root: any, predicate: (node: any) => boolean): any {
  if (!root || typeof root !== 'object') return undefined;
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
  assert.equal(find(render(), (node) => node.type === 'Pressable' && node.props.accessibilityLabel === 'Último dia de todo mês'), undefined);
});
