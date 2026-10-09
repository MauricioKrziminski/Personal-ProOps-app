import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { fitMoneyFieldScale } from './money-field-fit.ts';

type Node = { type: any; props: any };
const flatten = (style: any): any => Array.isArray(style) ? Object.assign({}, ...style.map(flatten)) : style ?? {};
function all(root: any): Node[] {
  if (Array.isArray(root)) return root.flatMap(all);
  return root?.props ? [root, ...all(root.props.children)] : [];
}

// Execute MoneyField with native layout callbacks as the boundary. This does not pretend
// to rasterize fonts: representative glyph widths exercise the overflow geometry.
function field(initialScale = 3.12) {
  let scale = initialScale;
  let cursor = 0;
  const state: any[] = [];
  const useState = (initial: any) => {
    const index = cursor++;
    if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
    return [state[index], (next: any) => { state[index] = typeof next === 'function' ? next(state[index]) : next; }];
  };
  const shared = (initial: any) => ({ value: initial, get() { return this.value; }, set(next: any) { this.value = next; } });
  const element = (type: any, props: any) => ({ type, props });
  const exports: any = {};
  const code = ts.transpileModule(readFileSync('src/components/ui/field.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  runInNewContext(code, { exports, require(id: string) {
    if (id === 'react/jsx-runtime') return { jsx: element, jsxs: element };
    if (id === 'react') return {
      useState, useRef: (v: any) => useState(() => ({ current: v }))[0],
      useEffect() {}, useLayoutEffect() {}, createContext: () => ({ Provider: 'Provider' }),
      useContext: () => null, forwardRef: (fn: any) => fn,
    };
    if (id === 'react-native') return {
      View: 'View', Text: 'Text', TextInput: 'TextInput', Platform: { OS: 'ios' },
      StyleSheet: { create: (v: any) => v, flatten, absoluteFill: { position: 'absolute' } },
      PixelRatio: { get: () => 3 }, useWindowDimensions: () => ({ width: 402, height: 874, fontScale: scale }),
    };
    if (id === 'react-native-worklets') return { scheduleOnRN: (fn: (...a: any[]) => unknown, ...a: unknown[]) => fn(...a) };
    if (id === 'react-native-reanimated') return {
      __esModule: true, default: { View: 'Animated.View', Text: 'Animated.Text' },
      Easing: { out: (v: any) => v, cubic: 'cubic' }, makeMutable: shared,
      useSharedValue: (v: any) => useState(() => shared(v))[0], useReducedMotion: () => false,
      useAnimatedStyle: (fn: any) => fn(), interpolateColor: () => 'border', cancelAnimation() {},
    };
    if (id === '@/design/tokens') return {
      Type: { body: { fontSize: 16, lineHeight: 23 }, money: { fontSize: 28, lineHeight: 36, letterSpacing: -0.8 }, title2: { fontSize: 19, lineHeight: 24 } },
      Space: { sm: 4, lg: 16 }, Radius: { sm: 8 }, HitTarget: 44, tabular: { fontVariant: ['tabular-nums'] },
      Motion: { duration: { morph: 180 }, easing: { inOut: 'inOut' } },
    };
    if (id === '@/constants/theme') return { Fonts: { medium: 'medium' } };
    if (id === '@/hooks/use-theme') return { useTheme: () => ({ text: 'text', surface: 'surface', textSecondary: 'secondary' }) };
    if (id === '@/components/motion/presenca') return { usePresencaAtiva: () => true };
    if (id === '@/components/ui/glass-backdrop') return { supportsLiquidGlass: () => false };
    if (id === '@/components/themed-text') return { ThemedText: 'ThemedText' };
    if (id === '@/components/ui/forte' || id === '@/lib/dates') return {};
    if (id === '@/lib/money-field-fit') {
      const helper: any = {};
      runInNewContext(ts.transpileModule(readFileSync('src/lib/money-field-fit.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS },
      }).outputText, { exports: helper });
      return helper;
    }
    throw new Error(`Unexpected import ${id}`);
  } });
  return {
    render(cents = 120000) {
      cursor = 0;
      return all(exports.MoneyField({ valueCents: cents, onChangeCents() {} }));
    },
    scale(next: number) { scale = next; },
  };
}

test('MoneyField fits all odometer houses inside the measured area at accessibility XL', () => {
  const ui = field();
  let nodes = ui.render();
  const area = nodes.find(n => n.props.pointerEvents === 'none' && typeof n.props.onLayout === 'function');
  assert.ok(area, 'the numeric area must report its available width instead of clipping leading digits');
  area.props.onLayout({ nativeEvent: { layout: { width: 250 } } });
  nodes = ui.render();
  for (const node of nodes.filter(n => n.type === 'Text' && n.props.onTextLayout)) {
    const char = node.props.children;
    node.props.onTextLayout({ nativeEvent: { lines: [{ width: char === '0' ? 54 : 25 }] } });
  }
  nodes = ui.render();
  const houses = nodes.filter(n => typeof n.type === 'function' && n.props.ch !== undefined);
  assert.equal(houses.map(n => n.props.ch).join(''), '1.200,00');
  const effective = houses[0].props.fontScale;
  assert.ok(effective > 0 && effective < 3.12, 'only the numeric area fits its requested size');
  assert.ok(houses.every(n => n.props.fontScale === effective), 'every animated house uses the same fitted scale');
  assert.ok((6 * 54 + 2 * 25) * effective / 3.12 + 5 <= 250, 'all houses and the end caret fit without clipping');
  const currency = nodes.find(n => n.props.children === 'R$')!;
  assert.notEqual(currency.props.allowFontScaling, false, 'currency keeps requested Dynamic Type');
  const capture = nodes.find(n => n.type === 'TextInput')!;
  assert.equal(capture.props.value, '1.200,00');
  assert.equal(capture.props.selection.end, 8);
  assert.equal(flatten(capture.props.style).opacity, 0.02);
});

test('requested size is retained when it fits; compact widths and the 11-digit ceiling fit completely', () => {
  for (const scale of [1, 1.3, 3.12]) {
    const ui = field(scale);
    const setWidth = (width: number) => ui.render().find(n => n.props.pointerEvents === 'none' && n.props.onLayout)!
      .props.onLayout({ nativeEvent: { layout: { width } } });
    setWidth(600);
    for (const node of ui.render().filter(n => n.type === 'Text' && n.props.onTextLayout)) {
      node.props.onTextLayout({ nativeEvent: { lines: [{ width: (node.props.children === '0' ? 17 : 8) * scale }] } });
    }
    const houses = (cents: number) => ui.render(cents).filter(n => typeof n.type === 'function' && n.props.ch !== undefined);
    assert.equal(houses(120000)[0].props.fontScale, scale);
    setWidth(180);
    const compact = houses(99999999999);
    assert.equal(compact.map(n => n.props.ch).join(''), '999.999.999,99');
    assert.ok((11 * 17 + 3 * 8) * compact[0].props.fontScale + 5 <= 180);
    setWidth(600);
    assert.equal(houses(120000)[0].props.fontScale, scale, 'growing the available width restores the requested size');
  }
});

test('late native measurements from a previous scale cannot replace current metrics', () => {
  const ui = field(1);
  ui.render().find(n => n.props.pointerEvents === 'none' && n.props.onLayout)!
    .props.onLayout({ nativeEvent: { layout: { width: 250 } } });
  const oldMeasurements = ui.render().filter(n => n.type === 'Text' && n.props.onTextLayout);
  ui.scale(3.12);
  for (const node of ui.render().filter(n => n.type === 'Text' && n.props.onTextLayout)) {
    node.props.onTextLayout({ nativeEvent: { lines: [{ width: node.props.children === '0' ? 54 : 25 }] } });
  }
  const scale = () => ui.render().find(n => typeof n.type === 'function' && n.props.ch !== undefined)!.props.fontScale;
  const before = scale();
  for (const node of oldMeasurements) node.props.onTextLayout({ nativeEvent: { lines: [{ width: 10 }] } });
  assert.equal(scale(), before);
});

test('invalid and zero geometry never produces a nonfinite font size', () => {
  for (const width of [0, NaN, Infinity, -5]) assert.equal(fitMoneyFieldScale(1.3, width, 100, 4, 3), 1.3);
  assert.equal(fitMoneyFieldScale(NaN, 200, 100, 4, 3), 1);
  assert.equal(fitMoneyFieldScale(3.12, 4, 100, 4, 3), 0);
  assert.equal(fitMoneyFieldScale(1, 200, NaN, 4, 3), 1);
});

test('a casa do odômetro assenta no estilo final escrito pelo React (o 1º dígito sumia no Android)', () => {
  const src = readFileSync('src/components/ui/field.tsx', 'utf8');
  const digito = src.slice(src.indexOf('function Digito('), src.indexOf('export function MoneyField'));
  assert.match(digito, /setAssentado\(true\)/, 'passada a animação o repouso é decidido pelo React');
  assert.match(digito, /assentado[^\n]*\? REPOUSO : entra/, 'assentada, a casa não lê mais o estilo animado');
  assert.match(src, /REPOUSO = \{ opacity: 1, transform: \[\{ translateY: 0 \}\] \}/);
});
