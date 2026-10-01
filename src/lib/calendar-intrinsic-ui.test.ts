import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
type Props = Record<string, unknown>;
type Element = { type: unknown; key?: string | null; props: Props };
type Node = Element & { children: Node[]; parents: Node[]; path: string };
type Effect = { fn: () => unknown; deps: unknown[]; cleanup?: unknown };
type Instance = { slots: unknown[]; cursor: number; restart: boolean };
type Animation = { target: number; done?: (finished: boolean) => void };
type Shared = { value: number; pending?: Animation; get: () => number; set: (next: number | Animation) => void };

/** Calendar, datas e presença reais; medições e springs ficam pendentes para inspecionar o primeiro frame. */
function mountCalendar(initial: Props = {}, glass = false, field = false) {
  const config = { reduced: false, active: true };
  const instances = new Map<string, Instance>();
  const contexts = new Map<unknown, unknown>();
  const modules = new Map<string, unknown>();
  const nativeAnimated = new Map<string, Props>();
  const shared: Shared[] = [];
  let current: Instance;
  let effects: { instance: Instance; slot: number; effect: Effect }[] = [];
  let dirty = false;
  let roots: Node[] = [];
  const changes: string[] = [];
  const months: string[] = [];
  let haptics = 0;
  let props: Props = { value: field ? '15/09/2026' : '2026-09-15', accessibilityLabel: 'Data final', onChange: (iso: string) => changes.push(iso), onMonthChange: (month: string) => months.push(month), ...initial };
  const react = {
    createContext(value: unknown) { const context = { value, Provider: {} }; context.Provider = { context }; return context; },
    useContext(context: { value: unknown }) { return contexts.has(context) ? contexts.get(context) : context.value === true ? config.active : context.value; },
    useRef(value: unknown) {
      const slot = current.cursor++;
      return current.slots[slot] ?? (current.slots[slot] = { current: value });
    },
    useState(initial: unknown) {
      const instance = current; const slot = instance.cursor++;
      if (!(slot in instance.slots)) instance.slots[slot] = typeof initial === 'function' ? initial() : initial;
      return [instance.slots[slot], (value: unknown) => {
        const next = typeof value === 'function' ? value(instance.slots[slot]) : value;
        if (Object.is(next, instance.slots[slot])) return;
        instance.slots[slot] = next;
        if (current === instance) instance.restart = true; else dirty = true;
      }];
    },
    useLayoutEffect(fn: () => unknown, deps: unknown[]) {
      const slot = current.cursor++;
      const previous = current.slots[slot] as Effect | undefined;
      if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps[i])))
        effects.push({ instance: current, slot, effect: { fn, deps } });
    },
  };
  function style(value: unknown): Props {
    if (!value) return {};
    if (Array.isArray(value)) return Object.assign({}, ...value.map(style));
    if (typeof value === 'object' && '__worklet' in value) return (value.__worklet as () => Props)();
    return value as Props;
  }
  const reanimated = {
    __esModule: true, default: { View: 'Animated.View', Text: 'Animated.Text' }, ReduceMotion: { System: 'system' },
    useReducedMotion: () => config.reduced,
    useAnimatedStyle: (worklet: () => Props) => ({ __worklet: worklet }),
    useSharedValue(value: number) {
      const slot = react.useRef(null) as { current: Shared | null };
      if (!slot.current) {
        slot.current = { value, get() { return this.value; }, set(next) {
          if (typeof next === 'number') { this.value = next; this.pending = undefined; }
          else this.pending = next;
        } };
        shared.push(slot.current);
      }
      return slot.current;
    },
    withTiming: (target: number, _settings: unknown, done?: Animation['done']) => ({ target, done }),
    withSpring: (target: number, _settings: unknown, done?: Animation['done']) => ({ target, done }),
    cancelAnimation: (value: Shared) => { value.pending = undefined; },
    runOnJS: (fn: unknown) => fn,
    interpolate: (value: number, range: number[], output: number[]) => output[0] + (value - range[0]) / (range[1] - range[0]) * (output[1] - output[0]),
  };
  function load(file: string): unknown {
    if (modules.has(file)) return modules.get(file);
    const module = { exports: {} };
    modules.set(file, module.exports);
    const code = ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    runInNewContext(code, { module, exports: module.exports, require: (name: string) => {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return require(name);
      if (name === 'react-native') return { View: 'View', Pressable: 'Pressable', useWindowDimensions: () => ({ fontScale: 1 }), Dimensions: { get: () => ({ width: 400, height: 800 }) },
        StyleSheet: { create: (value: unknown) => value, flatten: style, hairlineWidth: 1, absoluteFill: { position: 'absolute' } } };
      if (name === 'react-native-reanimated') return reanimated;
      if (name === 'expo-haptics') return { selectionAsync: () => haptics++ };
      if (name === '@/lib/dates') return load('src/lib/dates.ts');
      if (name === '@/components/finance/month-picker') return load('src/components/finance/month-picker.tsx');
      if (name === '@/components/finance/calendar') return load('src/components/finance/calendar.tsx');
      if (name === '@/components/motion/presenca') return load('src/components/motion/presenca.tsx');
      if (name === '@/components/motion/cores-suaves') return {
        useCoresSuaves: (value: Props) => value, useOpacidadeSuave: (opacity: number) => ({ opacity }),
      };
      if (name === '@/components/motion/session-curtain') return { useCortina: () => ({ lembrarOrigem() {} }) };
      if (name === '@/components/ui/glass-backdrop') return { GlassBackdrop: 'GlassBackdrop', supportsLiquidGlass: () => glass };
      if (name === '@/hooks/use-theme') return { useScheme: () => 'light', useTheme: () => ({ tint: 'tint', onTint: 'onTint', text: 'text', tintFill: 'fill', backgroundSelected: 'pressed', backgroundElement: 'element', danger: 'danger', glassActionTint: 'glass-fill', glassElementTint: 'glass-element' }) };
      if (name === '@/design/tokens') return { HitTarget: 44, Elevation: { light: { raised: [] } }, Radius: { sm: 8, pill: 100 }, Space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 }, Type: { ticker: {} }, tabular: {},
        Motion: { duration: { morph: 180 }, easing: { inOut: 'inOut' }, spring: { morph: { stiffness: 360, damping: 26, mass: 1 } } } };
      if (name.startsWith('@/components/')) return new Proxy({}, { get: (_target, key) => String(key) });
      throw new Error(`Modulo inesperado ${name}`);
    } }, { filename: file });
    modules.set(file, module.exports);
    return module.exports;
  }
  const file = field ? 'src/components/finance/date-picker-field.tsx' : 'src/components/finance/calendar.tsx';
  const Component = (load(file) as Record<string, (value: Props) => unknown>)[field ? 'DatePickerField' : 'Calendar'];
  function render(next = props) {
    props = next;
    function execute(fn: (value: Props) => unknown, value: Props, path: string): Node[] {
      const instance = instances.get(path) ?? { slots: [], cursor: 0, restart: false };
      instances.set(path, instance);
      const previous = current;
      current = instance;
      let result: unknown;
      for (let attempt = 0; attempt < 30; attempt++) {
        instance.cursor = 0; instance.restart = false;
        effects = effects.filter(effect => effect.instance !== instance);
        result = fn(value);
        if (!instance.restart) break;
        if (attempt === 29) throw new Error('Render instavel');
      }
      current = previous;
      return resolveNode(result, `${path}/body`);
    }
    function resolveNode(value: unknown, path: string): Node[] {
      if (Array.isArray(value)) return value.flatMap((child, i) => resolveNode(child, `${path}/${(child as Element)?.key ?? i}`));
      if (!value || typeof value !== 'object' || !('props' in value)) return [];
      const element = value as Element;
      if (typeof element.type === 'function') return execute(element.type as (p: Props) => unknown, element.props, `${path}/${element.key ?? ''}`);
      const context = typeof element.type === 'object' && element.type && 'context' in element.type ? element.type.context : undefined;
      const previous = contexts.get(context); const had = contexts.has(context);
      if (context) contexts.set(context, element.props.value);
      const child = element.props.children;
      const children = resolveNode(typeof child === 'function' ? child({ pressed: false }) : child, `${path}/children/${element.key ?? ''}`);
      if (context) { if (had) contexts.set(context, previous); else contexts.delete(context); }
      return [{ ...element, type: context ? 'Provider' : element.type, children, parents: [], path }];
    }
    for (let attempt = 0; attempt < 30; attempt++) {
      dirty = false; effects = [];
      roots = execute(Component, props, 'root');
      for (const { instance, slot, effect } of effects) {
        const previous = instance.slots[slot] as Effect | undefined;
        if (typeof previous?.cleanup === 'function') previous.cleanup();
        instance.slots[slot] = { ...effect, cleanup: effect.fn() };
      }
      if (!dirty) break;
      if (attempt === 29) throw new Error('Efeito instavel');
    }
    const addParents = (node: Node, parents: Node[]) => { node.parents = parents; node.children.forEach(child => addParents(child, [...parents, node])); };
    roots.forEach(node => addParents(node, []));
    flushAnimatedStyles();
  }
  function nodes(): Node[] { const all: Node[] = []; const visit = (node: Node) => { all.push(node); node.children.forEach(visit); }; roots.forEach(visit); return all; }
  // Reanimated 4 mantém props animadas removidas, e elas têm precedência sobre estilos estáticos.
  // https://docs.swmansion.com/react-native-reanimated/docs/core/useAnimatedStyle/#remarks
  function flushAnimatedStyles() {
    const apply = (node: Node, value: unknown) => {
      if (Array.isArray(value)) { value.forEach(item => apply(node, item)); return; }
      if (value && typeof value === 'object' && '__worklet' in value) {
        const previous = nativeAnimated.get(node.path) ?? {};
        for (const [key, next] of Object.entries(style(value))) {
          if (next === undefined) delete previous[key]; else previous[key] = next;
        }
        nativeAnimated.set(node.path, previous);
      }
    };
    for (const node of nodes()) apply(node, node.props.style);
    const present = new Set(nodes().map(node => node.path));
    for (const path of nativeAnimated.keys()) if (!present.has(path)) nativeAnimated.delete(path);
  }
  function find(type: string, text?: string) {
    const node = nodes().find(node => node.type === type && (text === undefined || node.props.children === text));
    assert.ok(node, `Nao achei ${type} ${text ?? ''}`);
    return node;
  }
  render();
  return {
    config, nodes, find, style: (node: Node) => style(node.props.style),
    nativeStyle: (node: Node) => ({ ...style(node.props.style), ...nativeAnimated.get(node.path) }),
    changes, months, get haptics() { return haptics; },
    root: () => roots[0],
    render(patch: Props = {}) { render({ ...props, ...patch }); },
    layout(node: Node, width: number, height = 14) {
      (node.props.onLayout as (e: unknown) => void)({ nativeEvent: { layout: { width, height } } }); render();
    },
    press(label: string) {
      const node = nodes().find(node => node.type === 'Pressable' && node.props.accessibilityLabel === label);
      assert.ok(node, `Botão ausente: ${label}`);
      (node.props.onPress as () => void)(); render();
    },
    finishAnimations() {
      for (const value of shared) if (value.pending) {
        const animation = value.pending; value.pending = undefined; value.value = animation.target;
        // UI thread writes the last frame before runOnJS commits the resting React render.
        flushAnimatedStyles(); animation.done?.(true);
      }
      render();
    },
  };
}

function dayNodes(ui: ReturnType<typeof mountCalendar>, month: string) {
  const [year, number] = month.split('-');
  return ui.nodes().filter(node => node.type === 'Pressable' && String(node.props.accessibilityLabel).endsWith(`/${number}/${year}`));
}

function assertNaturalMonth(ui: ReturnType<typeof mountCalendar>, month: string, weeks: number, days: number) {
  const buttons = dayNodes(ui, month);
  assert.equal(buttons.length, days, 'cada dia atual existe uma vez');
  assert.equal(new Set(buttons.map(node => node.parents.at(-1))).size, weeks, 'a quantidade de semanas acompanha o mês atual');
  for (const button of buttons) {
    for (const ancestor of button.parents) {
      assert.notEqual(ui.style(ancestor).position, 'absolute', 'a grade interativa precisa contribuir imediatamente para a altura natural');
      assert.notEqual(typeof ui.style(ancestor).height, 'number', 'altura medida do mês anterior não pode recortar os novos alvos');
      assert.notEqual(ancestor.props.pointerEvents, 'none', 'os dias atuais precisam permanecer interativos');
    }
  }
}

for (const glass of [false, true]) {
  test(`Calendar ${glass ? 'vidro' : 'opaco'}: 5→6→5 semanas reflow antes do spring, mantendo cabeçalho e seleção de 31/08`, () => {
    const ui = mountCalendar({ min: '2026-08-01', max: '2026-09-30' }, glass);
    assertNaturalMonth(ui, '2026-09', 5, 30);
    // Layout nativo anterior assentado. A transição seguinte ainda não recebeu layout nem terminou spring.
    for (const node of ui.nodes().filter(node => typeof node.props.onLayout === 'function')) ui.layout(node, 300, 280);
    ui.press('Mês anterior, Agosto de 2026');
    assertNaturalMonth(ui, '2026-08', 6, 31);
    assert.ok(ui.nodes().some(node => node.type === 'ThemedText' && node.props.children === 'Setembro de 2026'), 'o cabeçalho anterior mantém o crossfade');
    assert.ok(ui.nodes().some(node => node.type === 'ThemedText' && node.props.children === 'Agosto de 2026'), 'o cabeçalho atual aparece durante o crossfade');
    ui.press('31/08/2026');
    assert.deepEqual(ui.changes, ['2026-08-31']);
    ui.press('Próximo mês, Setembro de 2026');
    assertNaturalMonth(ui, '2026-09', 5, 30);
    assert.equal(dayNodes(ui, '2026-08').length, 0, 'a grade anterior não mantém alvos fora do mês atual');
    assert.deepEqual(ui.months, ['2026-08', '2026-09']);
    ui.press('30/09/2026');
    assert.deepEqual(ui.changes, ['2026-08-31', '2026-09-30']);
    assert.equal(ui.haptics, 4);
  });
}

test('Calendar ajusta quatro semanas de fevereiro para cinco de março e volta sem envelope antigo', () => {
  const ui = mountCalendar({ value: '2026-02-15' });
  assertNaturalMonth(ui, '2026-02', 4, 28);
  for (const node of ui.nodes().filter(node => typeof node.props.onLayout === 'function')) ui.layout(node, 300, 232);
  ui.press('Próximo mês, Março de 2026');
  assertNaturalMonth(ui, '2026-03', 5, 31);
  ui.press('31/03/2026');
  ui.press('Mês anterior, Fevereiro de 2026');
  assertNaturalMonth(ui, '2026-02', 4, 28);
  assert.equal(dayNodes(ui, '2026-03').length, 0);
  assert.deepEqual(ui.changes, ['2026-03-31']);
});

test('Calendar preserva limites inclusivos, estilo selecionado e bloqueio de presença inativa', () => {
  const ui = mountCalendar({ value: '2026-08-15', min: '2026-08-02', max: '2026-08-30' });
  const day = (label: string) => {
    const node = ui.nodes().find(node => node.type === 'Pressable' && node.props.accessibilityLabel === label);
    assert.ok(node); return node;
  };
  assert.equal(day('01/08/2026').props.disabled, true);
  assert.equal(day('31/08/2026').props.disabled, true);
  assert.equal(day('02/08/2026').props.disabled, false);
  assert.equal(day('30/08/2026').props.disabled, false);
  assert.equal((day('15/08/2026').props.accessibilityState as Props).selected, true);
  assert.equal(ui.style(day('15/08/2026').children[0]).backgroundColor, 'fill');
  assert.equal(ui.style(day('15/08/2026').children[0].children[0]).color, 'onTint');
  ui.press('31/08/2026'); ui.press('01/08/2026');
  ui.press('Mês anterior, Julho de 2026'); ui.press('Próximo mês, Setembro de 2026');
  assert.deepEqual(ui.changes, []); assert.deepEqual(ui.months, []);
  ui.press('02/08/2026'); ui.press('30/08/2026');
  assert.deepEqual(ui.changes, ['2026-08-02', '2026-08-30']);
  ui.config.active = false; ui.render({ min: undefined, max: undefined });
  ui.press('15/08/2026'); ui.press('Mês anterior, Julho de 2026');
  assert.deepEqual(ui.changes, ['2026-08-02', '2026-08-30']);
  assert.deepEqual(ui.months, []);
  assert.equal(ui.haptics, 2);
});

function measureOpenField(ui: ReturnType<typeof mountCalendar>, height: number) {
  const body = ui.nodes().find(node => typeof node.props.onLayout === 'function' && ui.style(node).borderTopWidth === 1);
  assert.ok(body, 'presença mede o corpo real do calendário');
  ui.layout(body, 360, height);
  return body;
}

function assertNativeNaturalMonth(ui: ReturnType<typeof mountCalendar>, month: string, weeks: number, days: number) {
  assertNaturalMonth(ui, month, weeks, days);
  for (const day of dayNodes(ui, month)) {
    for (const parent of day.parents) {
      assert.notEqual(typeof ui.nativeStyle(parent).height, 'number', 'altura animada nativa precisa ser liberada ao assentar; remover o worklet não libera a propriedade');
    }
  }
}

for (const glass of [false, true]) {
  test(`DatePicker + Calendar + Presenca reais ${glass ? 'vidro' : 'opaco'}: abertura libera altura animada antes de 5→6→5 semanas`, () => {
    const ui = mountCalendar({ min: '2026-08-01', max: '2026-09-30' }, glass, true);
    ui.press('Data final');
    const body = measureOpenField(ui, 380);
    const envelope = body.parents.at(-1)!;
    assert.equal(ui.nativeStyle(envelope).height, 0, 'a primeira abertura ainda anima espaço');
    ui.finishAnimations();
    assertNativeNaturalMonth(ui, '2026-09', 5, 30);
    ui.press('Mês anterior, Agosto de 2026');
    measureOpenField(ui, 436);
    assertNativeNaturalMonth(ui, '2026-08', 6, 31);
    ui.press('Próximo mês, Setembro de 2026');
    measureOpenField(ui, 380);
    assertNativeNaturalMonth(ui, '2026-09', 5, 30);
    ui.press('Mês anterior, Agosto de 2026');
    ui.press('31/08/2026');
    assert.deepEqual(ui.changes, ['31/08/2026']);
    assert.equal((ui.nodes().find(node => node.props.accessibilityLabel === 'Data final')!.props.accessibilityState as Props).expanded, false);
    ui.finishAnimations();
    assert.equal(dayNodes(ui, '2026-08').length, 0, 'a saída termina e desmonta os alvos do calendário');
  });
}

test('DatePicker real conserva limites e rejeita callbacks da abertura anterior ao reabrir durante saída', () => {
  const ui = mountCalendar({ min: '2026-08-02', max: '2026-09-30' }, false, true);
  ui.press('Data final'); measureOpenField(ui, 380); ui.finishAnimations();
  ui.press('Mês anterior, Agosto de 2026');
  const stale = dayNodes(ui, '2026-08').find(node => node.props.accessibilityLabel === '31/08/2026')!;
  assert.ok(stale);
  ui.press('01/08/2026');
  assert.deepEqual(ui.changes, [], 'o mínimo continua bloqueando handlers invocados diretamente');
  ui.press('31/08/2026');
  ui.press('Data final'); // reabre antes de a saída do calendário anterior concluir
  (stale.props.onPress as () => void)();
  ui.render();
  assert.deepEqual(ui.changes, ['31/08/2026'], 'o callback antigo não seleciona na nova abertura');
  ui.finishAnimations();
  assertNativeNaturalMonth(ui, '2026-09', 5, 30);
  ui.press('30/09/2026');
  assert.deepEqual(ui.changes, ['31/08/2026', '30/09/2026']);
});
