import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);

// Commit effects after stable renders; neither springs nor native layout finish automatically.
// Component-local hooks and provider context exercise the real nested presence lifetimes.
function montar(file: string, name: string, initial: any, config: { reduzir: boolean; ativo: boolean; fontScale?: number; lock?: any } = { reduzir: false, ativo: true }) {
  type Instance = { slots: any[]; cursor: number; mounted: boolean; restart: boolean };
  type Animation = { shared: any; done?: (ok: boolean) => void; target: number; from: number; kind: 'spring' | 'timing'; settings: any; canceled: boolean };
  const instances = new Map<string, Instance>();
  const modules = new Map<string, any>();
  const contexts = new Map<any, any>();
  const animations: Animation[] = [];
  const sharedValues: any[] = [];
  let current: Instance;
  let seen = new Set<string>();
  let dirty = false;
  let mounted = true;
  let props = initial;
  let tree: any;
  let effects: { instance: Instance; index: number; fn: () => any; deps: any[] }[] = [];
  let postUnmountWrites = 0;
  let animatedStyles = 0;
  const timers: { fn: () => void; canceled: boolean }[] = [];
  function flatten(style: any): any {
    if (!style) return {};
    if (Array.isArray(style)) return Object.assign({}, ...style.map(flatten));
    return style.__worklet ? style.__worklet() : style;
  }
  const react = {
    forwardRef: (component: any) => component,
    createContext: (value: any) => { const context: any = { value }; context.Provider = { context }; return context; },
    useContext: (context: any) => contexts.has(context) ? contexts.get(context) : context.value === true ? config.ativo : context.value,
    useState: (initialValue: any) => {
      const instance = current;
      const index = instance.cursor++;
      if (!(index in instance.slots)) instance.slots[index] = typeof initialValue === 'function' ? initialValue() : initialValue;
      return [instance.slots[index], (value: any) => {
        if (!mounted || !instance.mounted) { postUnmountWrites++; return; }
        const next = typeof value === 'function' ? value(instance.slots[index]) : value;
        if (!Object.is(next, instance.slots[index])) {
          instance.slots[index] = next;
          if (current === instance) instance.restart = true; else dirty = true;
        }
      }];
    },
    useRef: (value: any) => {
      const index = current.cursor++;
      if (!(index in current.slots)) current.slots[index] = { current: value };
      return current.slots[index];
    },
    useMemo: (fn: () => any, deps: any[]) => {
      const index = current.cursor++;
      const previous = current.slots[index];
      if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) current.slots[index] = { deps, value: fn() };
      return current.slots[index].value;
    },
    useCallback: (fn: any, deps: any[]) => react.useMemo(() => fn, deps),
    useEffect: (fn: () => any, deps: any[]) => effect(fn, deps),
    useLayoutEffect: (fn: () => any, deps: any[]) => effect(fn, deps),
  };
  function effect(fn: () => any, deps: any[]) {
    const index = current.cursor++;
    const previous = current.slots[index];
    if (!previous || deps.length !== previous.deps.length || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
      effects.push({ instance: current, index, fn, deps });
    }
  }
  const reanimated = {
    __esModule: true,
    default: { View: 'Animated.View' },
    Easing: { linear: 'linear' },
    FadeIn: { duration: () => ({}), delay: () => ({ duration: () => ({}) }) },
    FadeOut: { duration: () => ({}) },
    ReduceMotion: { System: 'system' },
    useReducedMotion: () => config.reduzir,
    useAnimatedStyle: (fn: () => any) => { animatedStyles++; return { __worklet: fn }; },
    useSharedValue: (value: number) => {
      const ref = react.useRef(null);
      if (!ref.current) {
        ref.current = {
          value, animation: null,
          get() { return this.value; },
          set(next: any) {
            if (this.animation) this.animation.canceled = true;
            if (next?.timing || next?.spring) {
              const animation = { shared: this, done: next.done, target: next.target, from: this.value, kind: next.spring ? 'spring' as const : 'timing' as const, settings: next.settings, canceled: false };
              animations.push(animation);
              this.animation = animation;
            } else { this.animation = null; this.value = next; }
          },
        };
        sharedValues.push(ref.current);
      }
      return ref.current;
    },
    makeMutable: (value: number) => ({ value }),
    withTiming: (target: number, settings: any, done?: (ok: boolean) => void) => ({ timing: true, target, done, settings }),
    // Native color pulses have no completion callback; control-lifetime assertions finish separately.
    withSequence: (...steps: any[]) => steps.at(-1),
    withRepeat: (animation: any) => animation,
    withSpring: (target: number, settings: any, done?: (ok: boolean) => void) => ({ spring: true, target, done, settings }),
    cancelAnimation: (shared: any) => { if (shared.animation) shared.animation.canceled = true; },
    runOnJS: (fn: any) => fn,
    interpolateColor: (_t: number, _range: any, colors: any[]) => colors[0],
  };
  const tokens = {
    Motion: { duration: { fast: 120, base: 200, morph: 180 }, curtain: { duration: 1150 }, easing: { out: 'out', inOut: 'inOut' }, spring: { morph: { stiffness: 360, damping: 26, mass: 1 } } },
    Radius: { sm: 8, md: 12, pill: 100 }, Space: { sm: 8, md: 12, lg: 16, half: 2, xs: 4 },
    Elevation: { light: { raised: [] } }, Type: { meta: {}, body: { fontSize: 16, lineHeight: 23 }, money: {} }, HitTarget: 44, tabular: {},
  };
  function load(path: string): any {
    if (modules.has(path)) return modules.get(path);
    const module = { exports: {} };
    modules.set(path, module.exports);
    const code = ts.transpileModule(readFileSync(path, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    runInNewContext(code, { performance, module, exports: module.exports,
      setTimeout: (fn: () => void) => { const timer = { fn, canceled: false }; timers.push(timer); return timer; },
      clearTimeout: (timer: typeof timers[number]) => { timer.canceled = true; },
      require: (id: string) => {
      if (id === 'react') return react;
      if (id === 'react/jsx-runtime') return require(id);
      if (id === 'react-native') return { Pressable: 'Pressable', View: 'View', TextInput: 'TextInput', useWindowDimensions: () => ({ width: 402, fontScale: config.fontScale ?? 1 }), Platform: { OS: 'android' }, StyleSheet: { create: (s: any) => s, flatten, hairlineWidth: 1 } };
      if (id === 'react-native-reanimated') return reanimated;
      if (id === 'expo-haptics') return { selectionAsync() {} };
      if (id === '@/components/motion/presenca') return load('src/components/motion/presenca.tsx');
      if (id === '@/components/motion/cores-suaves') return { useCoresSuaves: () => ({}), useOpacidadeSuave: () => ({}) };
      if (id === '@/components/motion/pressable-scale') return { PressableScale: 'PressableScale' };
      if (id === '@/design/tokens') return tokens;
      if (id === '@/hooks/use-theme') return { useTheme: () => ({ curtain: '#0B0B0C' }), useScheme: () => 'light' };
      if (id === '@/hooks/use-lock') return { useLock: () => config.lock };
      if (id === '@/components/motion/session-curtain') return { useCortinaSaindo: () => config.ativo };
      if (id === '@/components/motion/wave-curtain') return { WaveCurtain: 'WaveCurtain' };
      if (id === '@/components/ui/mark') return { Mark: 'Mark' };
      if (id === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) };
      if (id === '@/components/ui/glass-backdrop') return { GlassBackdrop: 'GlassBackdrop', supportsLiquidGlass: () => false };
      if (id === '@/components/themed-text') return { ThemedText: 'ThemedText' };
      if (id === '@/components/ui/icon') return { Icon: 'Icon' };
      if (id === '@/components/ui/forte') return { ComNegrito: 'ComNegrito' };
      if (id === '@/constants/theme') return { Fonts: {} };
      if (id === '@/components/ui/field') return { TextField: 'TextField', Field: 'Field', MoneyField: 'MoneyField' };
      if (id === '@/components/finance/account-picker') return { AccountPicker: 'AccountPicker' };
      if (id === '@/components/finance/date-picker-field') return { DatePickerField: 'DatePickerField' };
      if (id === '@/components/ui/switch-row') return { SwitchRow: 'SwitchRow' };
      if (id === '@/lib/down-payment') return load('src/lib/down-payment.ts');
      if (id === '@/components/finance/calendar') return { Calendar: 'Calendar' };
      if (id === '@/lib/dates') return load('src/lib/dates.ts');
      if (id === './dates.ts') return load('src/lib/dates.ts');
      if (id === '@/lib/lancar') return load('src/lib/lancar.ts');
      if (id === '@/lib/atalhos-de-lancamento') return load('src/lib/atalhos-de-lancamento.ts');
      throw new Error(`Unexpected module ${id}`);
    } });
    return module.exports;
  }
  const Component = load(file)[name];
  function execute(component: any, componentProps: any, path: string) {
    let instance = instances.get(path);
    if (!instance) { instance = { slots: [], cursor: 0, mounted: true, restart: false }; instances.set(path, instance); }
    seen.add(path);
    const previous = current;
    current = instance;
    let result: any;
    for (let count = 0; count < 30; count++) {
      instance.cursor = 0; instance.restart = false;
      effects = effects.filter((pending) => pending.instance !== instance);
      result = component(componentProps);
      if (!instance.restart) break;
      if (count === 29) throw new Error(`Unstable component ${component.name}`);
    }
    current = previous;
    return resolve(result, `${path}/body`);
  }
  function resolve(node: any, path: string): any {
    if (Array.isArray(node)) return node.map((child, i) => resolve(child, `${path}/${child?.key ?? i}`));
    if (!node || typeof node !== 'object' || !node.props) return node;
    if (typeof node.type === 'function') return execute(node.type, node.props, `${path}/${node.type.name}:${node.key ?? ''}`);
    const context = node.type?.context;
    const before = contexts.get(context);
    const had = contexts.has(context);
    if (context) contexts.set(context, node.props.value);
    const child = node.props.children;
    const children = resolve(typeof child === 'function' ? child({ pressed: false }) : child, `${path}/children`);
    if (context) { if (had) contexts.set(context, before); else contexts.delete(context); }
    return { ...node, type: context ? 'Provider' : node.type, props: { ...node.props, children } };
  }
  function cleanup(instance: Instance) {
    instance.slots.forEach((slot) => slot?.cleanup?.());
    instance.mounted = false;
  }
  function render(next = props) {
    props = next;
    for (let count = 0; count < 30; count++) {
      dirty = false; effects = []; seen = new Set();
      tree = execute(Component, props, 'root');
      if (dirty) continue;
      for (const [path, instance] of instances) {
        if (!seen.has(path)) { cleanup(instance); instances.delete(path); }
      }
      for (const pending of effects) {
        pending.instance.slots[pending.index]?.cleanup?.();
        pending.instance.slots[pending.index] = { deps: pending.deps, cleanup: pending.fn() };
      }
      if (!dirty) return tree;
    }
    throw new Error('Unstable render');
  }
  function nodes() {
    const result: any[] = [];
    const visit = (node: any) => {
      if (Array.isArray(node)) { node.forEach(visit); return; }
      if (!node || typeof node !== 'object') return;
      result.push(node); visit(node.props?.children);
    };
    visit(tree); return result;
  }
  render();
  return {
    render, nodes, animations, sharedValues, config, timers,
    element: (path: string, component: string, componentProps: any) => ({ type: load(path)[component], props: componentProps }),
    find: (predicate: (node: any) => boolean) => nodes().find(predicate),
    style: (node: any) => flatten(node.props.style),
    close: () => animations.findLast((a) => a.target === 0 && a.done)!,
    transition: () => animations.findLast((a) => a.target === 1 && a.done)!,
    layout: (node: any, height: number, width = 300) => { node.props.onLayout({ nativeEvent: { layout: { width, height } } }); render(); },
    finish: (animation: Animation) => { assert.ok(animation, 'pending completion'); if (!animation.canceled) animation.shared.value = animation.target; animation.done?.(true); render(); },
    unmount: () => { instances.forEach(cleanup); mounted = false; },
    writesAfterUnmount: () => postUnmountWrites,
    animatedStyleCalls: () => animatedStyles,
  };
}

const helper = 'src/components/motion/presenca.tsx';
const outgoing = (ui: ReturnType<typeof montar>) => ui.find((n) => n.type === 'Animated.View' && n.props.pointerEvents === 'none');
const incoming = (ui: ReturnType<typeof montar>) => ui.find((n) => n.type === 'Animated.View' && n.props.onLayout)
  ?? ui.find((n) => n.type === 'Animated.View' && n.props.pointerEvents !== undefined)?.props.children;
const content = (ui: ReturnType<typeof montar>) => incoming(ui)?.props.children;
function assertMorphSpring(animation: ReturnType<typeof montar>['animations'][number]) {
  assert.equal(animation.kind, 'spring');
  assert.equal(animation.settings.stiffness, 360);
  assert.equal(animation.settings.damping, 26);
  assert.equal(animation.settings.mass, 1);
  assert.equal(animation.settings.reduceMotion, 'system');
}

test('Presenca shrinks space and opacity on the same spring, preserving an inactive outgoing snapshot', () => {
  const ui = montar(helper, 'Presenca', { visivel: true, children: 'old' });
  ui.layout(incoming(ui), 120);
  ui.render({ visivel: false, children: 'new' });
  const closing = ui.close();
  assertMorphSpring(closing);
  assert.equal(content(ui), 'old');
  assert.equal(outgoing(ui).props.accessibilityElementsHidden, true);
  assert.equal(outgoing(ui).props.importantForAccessibility, 'no-hide-descendants');
  closing.shared.value = 0.5;
  assert.equal(ui.style(outgoing(ui)).height, 60);
  assert.equal(ui.style(incoming(ui)).opacity, 0.5);
  ui.render({ visivel: true, children: 'reopened' });
  assert.equal(ui.transition().from, 0.5, 'reopening retargets the current progress');
  ui.finish(closing);
  assert.equal(content(ui), 'reopened');
  assert.equal(ui.find((n) => n.props?.pointerEvents === 'auto').props.accessibilityElementsHidden, false);
  ui.render({ visivel: false, children: null });
  ui.finish(ui.close());
  assert.equal(ui.nodes().length, 0);
});

test('Presenca ignores completion after unmount and reduced motion closes without waiting', () => {
  const ui = montar(helper, 'Presenca', { visivel: true, children: 'old' });
  ui.render({ visivel: false, children: null });
  const closing = ui.close();
  ui.unmount(); closing.done?.(true);
  assert.equal(ui.writesAfterUnmount(), 0);
  const reduced = montar(helper, 'Presenca', { visivel: true, children: 'old' }, { reduzir: true, ativo: true });
  reduced.render({ visivel: false, children: null });
  assert.equal(reduced.nodes().length, 0);
  assert.equal(reduced.animations.length, 0);
});

test('Nested presence inherits its inactive parent provider', () => {
  const ui = montar(helper, 'Presenca', { visivel: true, children: 'visible' }, { reduzir: false, ativo: false });
  assert.equal(ui.find((n) => n.type === 'Provider').props.value, false);
  assert.equal(outgoing(ui).props.pointerEvents, 'none');
});

test('Presenca reports an actual exit once and ignores a canceled exit after reopening', () => {
  let exits = 0;
  const props = { visivel: true, children: 'content', onSaidaConcluida: () => exits++ };
  const ui = montar(helper, 'Presenca', props);
  ui.render({ ...props, visivel: false });
  const stale = ui.close();
  assert.equal(exits, 0, 'starting the collapse does not report its completion');
  ui.render(props);
  ui.finish(stale);
  assert.equal(exits, 0, 'the previous completion cannot clear feedback on a reopened list');
  ui.render({ ...props, visivel: false });
  ui.finish(ui.close());
  ui.render();
  assert.equal(exits, 1);
  const reduced = montar(helper, 'Presenca', props, { reduzir: true, ativo: true });
  reduced.render({ ...props, visivel: false });
  assert.equal(exits, 2, 'reduced motion completes the exit immediately');
});

test('TrocaSuave mounts both layers immediately and starts progress only after incoming native layout', () => {
  const ui = montar(helper, 'TrocaSuave', { estado: 'fixed', children: 'fixed-fields' });
  ui.layout(incoming(ui), 80);
  ui.render({ estado: 'amortized', children: 'amortized-fields' });
  assert.equal(content(ui), 'amortized-fields');
  assert.equal(outgoing(ui).props.children, 'fixed-fields');
  assert.equal(ui.style(outgoing(ui)).position, 'absolute');
  assert.equal(outgoing(ui).props.accessibilityElementsHidden, true);
  assert.equal(incoming(ui).props.pointerEvents, 'auto');
  assert.deepEqual(ui.nodes().filter((n) => n.type === 'Provider').map((n) => n.props.value), [false, true]);
  assert.equal(ui.animations.length, 0, 'new content remains mounted while waiting for its first layout');
  assert.equal(ui.style(outgoing(ui)).opacity, 1);
  assert.equal(ui.style(incoming(ui)).opacity, 0);
  ui.layout(incoming(ui), 160);
  const progress = ui.transition();
  const height = ui.animations.find((a) => a.target === 160)!;
  assertMorphSpring(progress); assertMorphSpring(height);
  progress.shared.value = 0.5; height.shared.value = 120;
  assert.equal(ui.style(outgoing(ui)).opacity, 0.5);
  assert.equal(ui.style(incoming(ui)).opacity, 0.5);
  assert.equal(ui.style(ui.nodes()[0]).height, 120);
  assert.equal(ui.style(incoming(ui)).transform[0].translateY, 4);
  ui.finish(progress);
  assert.equal(outgoing(ui), undefined);
  assert.equal(content(ui), 'amortized-fields');
  assert.equal(ui.style(incoming(ui)).opacity, 1);
  assert.equal(ui.style(ui.nodes()[0]).height, 'auto', 'resting layout is explicitly returned to Yoga');
});

test('TrocaSuave retains its measured width during absolute-layer swaps and explicitly restores natural dimensions', () => {
  const ui = montar(helper, 'TrocaSuave', { estado: 'a', children: 'A' });
  ui.layout(incoming(ui), 80, 300);
  assert.equal(ui.style(ui.nodes()[0]).width, 'auto');
  assert.equal(ui.style(ui.nodes()[0]).height, 'auto');
  ui.render({ estado: 'b', children: 'B' });
  assert.equal(ui.style(ui.nodes()[0]).width, 300, 'absolute layers keep the previously measured frame');
  ui.layout(incoming(ui), 160, 420);
  const progress = ui.transition();
  progress.shared.value = 0.5;
  assert.equal(ui.style(ui.nodes()[0]).width, 300, 'incoming measurement cannot shrink or stretch the frame mid-swap');
  assert.equal(ui.style(outgoing(ui)).position, 'absolute');
  assert.equal(ui.style(incoming(ui)).position, 'absolute');
  ui.finish(progress);
  assert.equal(ui.style(ui.nodes()[0]).width, 'auto');
  assert.equal(ui.style(ui.nodes()[0]).height, 'auto');
  assert.equal(ui.style(incoming(ui)).position, 'relative');
});

test('Resting presence publishes natural height and swaps retain static geometry after stale shared-value writes', () => {
  const hasWorklet = (style: any): boolean => Array.isArray(style)
    ? style.some(hasWorklet) : Boolean(style?.__worklet);
  const presence = montar(helper, 'Presenca', { visivel: false, children: 'fields' });
  presence.render({ visivel: true, children: 'fields' });
  presence.layout(incoming(presence), 100);
  assert.ok(presence.nodes().filter((n) => n.type === 'Animated.View').every((n) => n.props.collapsable === false));
  const opening = presence.transition();
  presence.finish(opening);
  opening.shared.value = 0.2;
  presence.sharedValues[1].value = 999;
  const frame = presence.find((n) => n.props?.pointerEvents === 'auto');
  assert.equal(presence.style(frame).height, 'auto');
  assert.equal(presence.style(frame).width, 'auto');
  assert.equal(presence.style(incoming(presence)).opacity, 1);
  assert.equal(presence.style(incoming(presence)).transform[0].translateY, 0);
  assert.ok(hasWorklet(frame.props.style), 'resting presence explicitly releases animated height through the same binder');
  assert.ok(!hasWorklet(incoming(presence).props.style), 'resting content detaches its opacity animation');

  const swap = montar(helper, 'TrocaSuave', { estado: 'a', children: 'A' });
  swap.layout(incoming(swap), 80);
  swap.render({ estado: 'b', children: 'B' });
  swap.layout(incoming(swap), 160);
  assert.ok(swap.nodes().filter((n) => n.type === 'Animated.View').every((n) => n.props.collapsable === false), 'both moving layers preserve their native view identities');
  const progress = swap.transition();
  swap.finish(progress);
  progress.shared.value = 0.2;
  swap.sharedValues[1].value = 999;
  swap.sharedValues[2].value = 999;
  assert.equal(swap.style(swap.nodes()[0]).height, 'auto');
  assert.equal(swap.style(swap.nodes()[0]).width, 'auto');
  assert.equal(swap.style(incoming(swap)).opacity, 1);
  assert.equal(swap.style(incoming(swap)).transform[0].translateY, 0);
  assert.equal(swap.style(incoming(swap)).position, 'relative');
  assert.ok(hasWorklet(swap.nodes()[0].props.style), 'resting swap releases its measured geometry through the same native binder');
  assert.ok(!hasWorklet(incoming(swap).props.style), 'resting incoming content detaches its opacity animation');
  assert.ok(swap.nodes().filter((n) => n.type === 'Animated.View').every((n) => n.props.collapsable === false));
});

test('a settled label swap releases its frame before larger text measures again', () => {
  const ui = montar(helper, 'MudancaSuave', { valor: 'default', children: 'All items' });
  ui.layout(incoming(ui), 19, 266);
  ui.render({ valor: 'active', children: 'State: paused · Channel: WhatsApp' });
  ui.layout(incoming(ui), 19, 252);
  ui.finish(ui.transition());
  const frame = ui.nodes()[0];
  assert.ok(frame.props.style.some((style: any) => style?.__worklet), 'removing an animated style would retain its last native width and height');
  ui.layout(incoming(ui), 228, 370);
  assert.equal(ui.style(ui.nodes()[0]).height, 'auto');
  assert.equal(ui.style(ui.nodes()[0]).width, 'auto');
  assert.equal(outgoing(ui), undefined);
  assert.equal(content(ui), 'State: paused · Channel: WhatsApp');
});

test('TrocaSuave retargets midflight from its current progress while retaining the original outgoing layer', () => {
  const ui = montar(helper, 'TrocaSuave', { estado: 'a', children: 'A' });
  ui.layout(incoming(ui), 80);
  ui.render({ estado: 'b', children: 'B' });
  const oldB = incoming(ui);
  ui.layout(oldB, 160);
  const first = ui.transition();
  const firstHeight = ui.animations.find((a) => a.target === 160)!;
  first.shared.value = 0.45;
  firstHeight.shared.value = 116;
  const before = ui.animations.length;

  ui.render({ estado: 'c', children: 'C' });
  assert.equal(content(ui), 'C');
  assert.equal(outgoing(ui).props.children, 'A');
  assert.equal(ui.style(incoming(ui)).opacity, 0.45, 'the new intent does not reset the existing progress');
  assert.equal(ui.style(outgoing(ui)).opacity, 0.55);
  assert.equal(ui.style(incoming(ui)).transform[0].translateY, 4.4);
  assert.equal(ui.style(ui.nodes()[0]).height, 116);
  assert.equal(ui.animations.length, before, 'C waits for its own native layout before retargeting');
  ui.layout(oldB, 999);
  assert.equal(ui.animations.length, before);

  ui.layout(incoming(ui), 200);
  const latest = ui.transition();
  const latestHeight = ui.animations.findLast((a) => a.target === 200)!;
  assert.equal(latest.from, 0.45);
  assert.equal(latestHeight.from, 116);
  assertMorphSpring(latest); assertMorphSpring(latestHeight);
  ui.finish(first);
  assert.equal(outgoing(ui).props.children, 'A', 'an older spring cannot settle the latest intent');
  assert.equal(ui.style(incoming(ui)).opacity, 0.45);
  ui.finish(latest);
  assert.equal(content(ui), 'C');
  assert.equal(outgoing(ui), undefined);
  assert.equal(ui.style(ui.nodes()[0]).height, 'auto');
});

test('Spring overshoot keeps opacity bounded and height nonnegative while allowing a small spatial bounce', () => {
  const presence = montar(helper, 'Presenca', { visivel: false, children: 'fields' });
  presence.render({ visivel: true, children: 'fields' });
  presence.layout(incoming(presence), 100);
  const opening = presence.transition();
  opening.shared.value = 1.08;
  assert.equal(presence.style(incoming(presence)).opacity, 1);
  assert.equal(presence.style(presence.nodes().find((n) => n.type === 'Animated.View')).height, 108);
  opening.shared.value = -0.08;
  assert.equal(presence.style(incoming(presence)).opacity, 0);
  assert.equal(presence.style(presence.nodes().find((n) => n.type === 'Animated.View')).height, 0);

  const swap = montar(helper, 'TrocaSuave', { estado: 'a', children: 'A' });
  swap.layout(incoming(swap), 80);
  swap.render({ estado: 'b', children: 'B' });
  swap.layout(incoming(swap), 160);
  const progress = swap.transition();
  const height = swap.animations.find((a) => a.target === 160)!;
  progress.shared.value = 1.08;
  assert.equal(swap.style(incoming(swap)).opacity, 1);
  assert.equal(swap.style(outgoing(swap)).opacity, 0);
  assert.ok(swap.style(incoming(swap)).transform[0].translateY < 0, 'translation can overshoot without invalid opacity');
  progress.shared.value = -0.08; height.shared.value = -5;
  assert.equal(swap.style(incoming(swap)).opacity, 0);
  assert.equal(swap.style(outgoing(swap)).opacity, 1);
  assert.equal(swap.style(swap.nodes()[0]).height, 0);
});

test('TrocaSuave rejects stale completion after another mode, return to original, and unmount', () => {
  const ui = montar(helper, 'TrocaSuave', { estado: 'fixed', children: 'fixed' });
  ui.layout(incoming(ui), 80);
  ui.render({ estado: 'amortized', children: 'amortized' });
  ui.layout(incoming(ui), 160);
  const stale = ui.transition();
  ui.render({ estado: 'third', children: 'latest' });
  assert.equal(content(ui), 'latest');
  assert.equal(outgoing(ui).props.children, 'fixed');
  ui.finish(stale);
  assert.equal(outgoing(ui).props.children, 'fixed', 'old completion cannot remove the original outgoing layer');
  ui.layout(incoming(ui), 120);
  ui.finish(ui.transition());
  assert.equal(outgoing(ui), undefined);
  assert.equal(content(ui), 'latest');
  ui.render({ estado: 'fixed', children: 'edited-fixed' });
  assert.equal(content(ui), 'edited-fixed', 'returning to an earlier mode is immediately active');
  ui.layout(incoming(ui), 80);
  const pending = ui.transition();
  ui.unmount(); pending.done?.(true);
  assert.equal(ui.writesAfterUnmount(), 0);
});

test('TrocaSuave ignores a stale incoming layout when a newer mode is waiting for its own measurement', () => {
  const ui = montar(helper, 'TrocaSuave', { estado: 'a', children: 'A' });
  ui.layout(incoming(ui), 80);
  ui.render({ estado: 'b', children: 'B' });
  const oldB = incoming(ui);
  ui.render({ estado: 'c', children: 'C' });
  assert.equal(content(ui), 'C');
  const before = ui.animations.length;
  const height = ui.style(ui.nodes()[0]).height;
  ui.layout(oldB, 999);
  assert.equal(ui.animations.length, before, 'B cannot start C progress or enqueue a stale height target');
  assert.equal(ui.style(ui.nodes()[0]).height, height, 'the latest envelope keeps its previous measured height');
  assert.equal(ui.style(incoming(ui)).opacity, 0);
  assert.equal(ui.style(outgoing(ui)).opacity, 1);
  ui.layout(incoming(ui), 200);
  assertMorphSpring(ui.transition());
  assert.ok(ui.animations.some((a) => a.target === 200));
  assert.equal(ui.animations.some((a) => a.target === 999), false);
  ui.finish(ui.transition());
  assert.equal(content(ui), 'C');
  assert.equal(outgoing(ui), undefined);
});

test('TrocaSuave returning A to B to A creates a new incoming lifetime and waits for its new native layout', () => {
  const ui = montar(helper, 'TrocaSuave', { estado: 'a', children: 'First A' });
  const activeKey = () => ui.find((n) => n.type === 'Provider' && n.props.value === true).key;
  const firstAKey = activeKey();
  ui.layout(incoming(ui), 80);
  ui.render({ estado: 'b', children: 'B' });
  const oldB = incoming(ui);
  const bKey = activeKey();
  ui.render({ estado: 'a', children: 'Edited A' });
  assert.notEqual(activeKey(), firstAKey, 'returning to A cannot reuse its outgoing native view');
  assert.notEqual(activeKey(), bKey);
  assert.equal(content(ui), 'Edited A');
  assert.equal(outgoing(ui).props.children, 'First A');
  assert.equal(ui.animations.length, 0);
  ui.layout(oldB, 140);
  assert.equal(ui.animations.length, 0, 'the previous lifetime cannot release the new A layout gate');
  ui.layout(incoming(ui), 96);
  assertMorphSpring(ui.transition());
  ui.finish(ui.transition());
  assert.equal(content(ui), 'Edited A');
  assert.equal(outgoing(ui), undefined);
});

test('TrocaSuave ignores captured native measurement callbacks after unmount', () => {
  const ui = montar(helper, 'TrocaSuave', { estado: 'a', children: 'A' });
  ui.layout(incoming(ui), 80);
  ui.render({ estado: 'b', children: 'B' });
  const measure = incoming(ui).props.onLayout;
  const before = ui.animations.length;
  const values = ui.sharedValues.map((value) => value.get());
  ui.unmount();
  measure({ nativeEvent: { layout: { width: 300, height: 999 } } });
  assert.equal(ui.animations.length, before);
  assert.deepEqual(ui.sharedValues.map((value) => value.get()), values, 'unmounted callbacks cannot mutate shared geometry');
  assert.equal(ui.writesAfterUnmount(), 0);
});

test('TrocaSuave provider disables outgoing native input callbacks while the incoming input stays editable', () => {
  const calls: string[] = [];
  const ui = montar(helper, 'TrocaSuave', { estado: 'old', children: null });
  const old = ui.element('src/components/ui/field.tsx', 'TextField', {
    value: '3', accessibilityLabel: 'Old field', onChangeText: () => calls.push('old-edit'), onBlur: () => calls.push('old-clamp'),
  });
  ui.render({ estado: 'old', children: old });
  ui.layout(incoming(ui), 56);
  const next = ui.element('src/components/ui/field.tsx', 'TextField', {
    value: '5', accessibilityLabel: 'New field', onChangeText: () => calls.push('new-edit'),
  });
  ui.render({ estado: 'new', children: next });
  const oldInput = ui.find((n) => n.type === 'TextInput' && n.props.accessibilityLabel === 'Old field');
  const newInput = ui.find((n) => n.type === 'TextInput' && n.props.accessibilityLabel === 'New field');
  assert.equal(oldInput.props.editable, false);
  assert.equal(oldInput.props.onChangeText, undefined);
  oldInput.props.onBlur({});
  assert.deepEqual(calls, [], 'outgoing blur cannot change the stored financial draft');
  assert.equal(newInput.props.editable, true);
  newInput.props.onChangeText('50');
  assert.deepEqual(calls, ['new-edit'], 'incoming input is active before any layout or completion');
});

test('TrocaSuave reduced motion interrupts pending work and full-screen mode preserves its frame', () => {
  const config = { reduzir: false, ativo: true };
  const ui = montar(helper, 'TrocaSuave', { estado: 'a', children: 'a', preencher: true }, config);
  ui.layout(incoming(ui), 700);
  ui.render({ estado: 'b', children: 'b', preencher: true });
  assert.equal(ui.style(ui.nodes()[0]).flex, 1);
  assert.equal(ui.style(ui.nodes()[0]).height, undefined);
  ui.layout(incoming(ui), 720);
  assert.equal(ui.animations.length, 1, 'same-frame screens animate progress, not their height');
  const pending = ui.transition();
  config.reduzir = true;
  ui.render({ estado: 'c', children: 'c', preencher: true });
  assert.equal(content(ui), 'c');
  assert.equal(outgoing(ui), undefined);
  assert.equal(ui.style(incoming(ui)).opacity, 1);
  assert.equal(ui.style(incoming(ui)).transform[0].translateY, 0);
  ui.finish(pending);
  assert.equal(content(ui), 'c');
  assert.equal(ui.animations.length, 1, 'reduced motion does not enqueue another transition');
});

test('SelectField delivers selection synchronously once, keeps one chosen row, and can reopen while closing', () => {
  const selected: any[] = [];
  const props = { value: 'a', placeholder: 'Choose', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], onChange: (id: any) => selected.push(id) };
  const ui = montar('src/components/ui/select-field.tsx', 'SelectField', props);
  const header = () => ui.find((n) => n.type === 'PressableScale' && n.props.accessibilityState.expanded !== undefined);
  header().props.onPress(); ui.render();
  const radios = ui.nodes().filter((n) => n.props?.accessibilityRole === 'radio');
  assert.deepEqual(radios.map((n) => n.props.accessibilityLabel), ['A', 'B']);
  const choose = radios[1].props.onPress;
  choose(); choose();
  assert.deepEqual(selected, ['b']);
  ui.render({ ...props, value: 'b' });
  assert.equal(header().props.accessibilityLabel, 'B');
  assert.equal(header().props.accessibilityRole, 'button');
  const stale = ui.close();
  assert.equal(outgoing(ui).props.accessibilityElementsHidden, true);
  header().props.onPress(); ui.render();
  ui.finish(stale);
  assert.deepEqual(ui.nodes().filter((n) => n.props?.accessibilityRole === 'radio').map((n) => n.props.accessibilityLabel), ['B', 'A']);
  header().props.onPress();
  assert.deepEqual(selected, ['b', 'b'], 'choosing the current header emits once and closes');
});

test('SelectField confirms a different option during collapse without delaying its callback', () => {
  const selected: any[] = [];
  const props = { value: 'a', placeholder: 'Choose', options: [
    { id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: null, label: 'None', neutral: true },
  ], onChange: (id: any) => selected.push(id) };
  const ui = montar('src/components/ui/select-field.tsx', 'SelectField', props);
  const header = () => ui.find((n) => n.type === 'PressableScale' && n.props.accessibilityState.expanded !== undefined);
  const hasActiveCheck = (node: any): boolean => {
    if (Array.isArray(node)) return node.some(hasActiveCheck);
    if (!node?.props || node.props.accessibilityElementsHidden) return false;
    return node.type === 'Icon' && node.props.name === 'checkmark' || hasActiveCheck(node.props.children);
  };
  header().props.onPress(); ui.render();
  ui.find((n) => n.type === 'PressableScale' && n.props.accessibilityLabel === 'B').props.onPress();
  assert.deepEqual(selected, ['b']);
  ui.render({ ...props, value: 'b' });
  assert.equal(header().props.accessibilityLabel, 'B');
  assert.equal(header().props.accessibilityState.expanded, false);
  assert.equal(hasActiveCheck(header()), true, 'the new value receives confirmation while closing');
  ui.finish(ui.close());
  assert.equal(hasActiveCheck(header()), false, 'the chevron returns after the actual collapse');
  assert.deepEqual(selected, ['b'], 'visual completion cannot emit another change');
  header().props.onPress(); ui.render();
  ui.find((n) => n.type === 'PressableScale' && n.props.accessibilityLabel === 'None').props.onPress();
  ui.render({ ...props, value: null });
  assert.equal(hasActiveCheck(header()), true, 'a null option is a valid confirmed choice');
  ui.finish(ui.close());
  assert.equal(hasActiveCheck(header()), false);
  assert.deepEqual(selected, ['b', null]);
});

test('DatePicker delivers one date synchronously, preserves limits and can reopen during collapse', () => {
  const dates: string[] = [];
  const props = { value: '15/09/2026', accessibilityLabel: 'Date', min: '2026-09-01', max: '2026-10-31', onChange: (date: string) => dates.push(date) };
  const ui = montar('src/components/finance/date-picker-field.tsx', 'DatePickerField', props);
  ui.find((n) => n.props?.accessibilityLabel === 'Date').props.onPress(); ui.render();
  const calendar = ui.find((n) => n.type === 'Calendar');
  assert.equal(calendar.props.min, props.min); assert.equal(calendar.props.max, props.max);
  calendar.props.onChange('2026-09-20'); calendar.props.onChange('2026-09-21');
  assert.deepEqual(dates, ['20/09/2026']);
  ui.render(); const stale = ui.close();
  ui.find((n) => n.props?.accessibilityLabel === 'Date').props.onPress(); ui.render();
  ui.finish(stale);
  assert.ok(ui.find((n) => n.type === 'Calendar'));
  ui.find((n) => n.type === 'Calendar').props.onChange('2026-09-22');
  assert.deepEqual(dates, ['20/09/2026', '22/09/2026']);
});

test('SelectField keeps the outgoing snapshot and reactivates collapsed without clearing its value', () => {
  const props = { options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], value: 'a', placeholder: 'Choose', onChange: () => assert.fail('hiding must not change the account') };
  const ui = montar('src/components/ui/select-field.tsx', 'SelectField', props);
  const header = () => ui.find(n => n.type === 'PressableScale' && n.props.accessibilityState.expanded !== undefined);
  header().props.onPress(); ui.render();
  ui.config.ativo = false; ui.render();
  assert.equal(header().props.accessibilityState.expanded, true, 'outgoing visual state is frozen');
  assert.equal(header().props.disabled, true);
  ui.config.ativo = true; ui.render();
  assert.equal(header().props.accessibilityState.expanded, false, 'a hidden form must not revive an expanded picker');
  assert.equal(header().props.accessibilityLabel, 'A');
});

test('SelectField rejects captured choices while hidden and after reopening a different interaction', () => {
  const selected: string[] = [];
  const props = { options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], value: 'a', placeholder: 'Choose', onChange: (v: string) => selected.push(v) };
  const ui = montar('src/components/ui/select-field.tsx', 'SelectField', props);
  const toggle = () => { ui.find(n => n.type === 'PressableScale' && n.props.accessibilityState.expanded !== undefined).props.onPress(); ui.render(); };
  toggle();
  const stale = ui.find(n => n.type === 'PressableScale' && n.props.accessibilityLabel === 'B').props.onPress;
  ui.config.ativo = false; ui.render(); stale();
  assert.deepEqual(selected, [], 'queued input cannot edit an inactive financial draft');
  ui.config.ativo = true; ui.render(); toggle(); stale();
  assert.deepEqual(selected, [], 'a previous interaction cannot select in the new picker');
  const current = ui.find(n => n.type === 'PressableScale' && n.props.accessibilityLabel === 'B').props.onPress;
  current(); current();
  assert.deepEqual(selected, ['b'], 'the active choice stays synchronous and emits exactly once');
});

test('SelectField discards native handlers queued before unmount', () => {
  const selected: string[] = [];
  const ui = montar('src/components/ui/select-field.tsx', 'SelectField', {
    options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], value: 'a', placeholder: 'Choose', onChange: (v: string) => selected.push(v),
  });
  ui.find(n => n.props?.accessibilityState?.expanded === false).props.onPress(); ui.render();
  const choose = ui.find(n => n.type === 'PressableScale' && n.props.accessibilityLabel === 'B').props.onPress;
  const header = ui.find(n => n.props?.accessibilityState?.expanded === true).props.onPress;
  ui.unmount(); choose(); header();
  assert.deepEqual(selected, []);
  assert.equal(ui.writesAfterUnmount(), 0);
});

test('SelectField rejects a collapsed header queued before hiding even after reactivation', () => {
  const ui = montar('src/components/ui/select-field.tsx', 'SelectField', {
    options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], value: 'a', placeholder: 'Choose', onChange: () => assert.fail('header must not select'),
  });
  const header = () => ui.find(n => n.props?.accessibilityState?.expanded !== undefined);
  const stale = header().props.onPress;
  ui.config.ativo = false; ui.render(); stale(); ui.render();
  assert.equal(header().props.accessibilityState.expanded, false);
  ui.config.ativo = true; ui.render(); stale(); ui.render();
  assert.equal(header().props.accessibilityState.expanded, false, 'queued old header cannot reopen a new visit');
  header().props.onPress(); ui.render();
  assert.equal(header().props.accessibilityState.expanded, true, 'current header still opens synchronously');
});

test('DatePicker rejects a collapsed header queued before hiding even after reactivation', () => {
  const ui = montar('src/components/finance/date-picker-field.tsx', 'DatePickerField', {
    value: '15/09/2026', accessibilityLabel: 'Date', onChange: () => assert.fail('header must not change date'),
  });
  const header = () => ui.find(n => n.props?.accessibilityLabel === 'Date');
  const stale = header().props.onPress;
  ui.config.ativo = false; ui.render(); stale(); ui.render();
  assert.equal(header().props.accessibilityState.expanded, false);
  ui.config.ativo = true; ui.render(); stale(); ui.render();
  assert.equal(header().props.accessibilityState.expanded, false, 'queued old header cannot reopen a new visit');
  header().props.onPress(); ui.render();
  assert.equal(header().props.accessibilityState.expanded, true, 'current header still opens synchronously');
});

test('DatePicker rejects a collapsed month-end choice queued before reactivation with unchanged value', () => {
  const dates: string[] = [];
  const ui = montar('src/components/finance/date-picker-field.tsx', 'DatePickerField', {
    value: '15/09/2026', accessibilityLabel: 'Date', onChange: (d: string) => dates.push(d), onSelectLastDay: (d: string) => dates.push(d),
  });
  const monthEnd = () => ui.nodes().findLast(n => n.props?.accessibilityLabel === 'Último dia de todo mês').props.onPress;
  const stale = monthEnd();
  ui.config.ativo = false; ui.render(); stale();
  assert.deepEqual(dates, []);
  ui.config.ativo = true; ui.render(); stale();
  assert.deepEqual(dates, [], 'unchanged value must not revive an old collapsed month-end handler');
  monthEnd()(); monthEnd()();
  assert.deepEqual(dates, ['30/09/2026'], 'current collapsed choice emits synchronously once');
});

test('DatePicker discards calendar, header and month-end handlers queued before unmount', () => {
  const dates: string[] = [];
  const ui = montar('src/components/finance/date-picker-field.tsx', 'DatePickerField', {
    value: '15/09/2026', accessibilityLabel: 'Date', onChange: (d: string) => dates.push(d), onSelectLastDay: (d: string) => dates.push(d),
  });
  ui.find(n => n.props?.accessibilityLabel === 'Date').props.onPress(); ui.render();
  const calendar = ui.find(n => n.type === 'Calendar');
  const header = ui.find(n => n.props?.accessibilityLabel === 'Date').props.onPress;
  const lastDay = ui.find(n => n.props?.accessibilityLabel === 'Último dia de todo mês').props.onPress;
  ui.unmount(); calendar.props.onChange('2026-09-20'); header(); lastDay();
  assert.deepEqual(dates, []);
  assert.equal(ui.writesAfterUnmount(), 0);
});

test('DatePicker rejects an old month-end choice after reactivation or navigating another month', () => {
  const dates: string[] = [];
  const props = { value: '15/09/2026', accessibilityLabel: 'Date', onChange: (d: string) => dates.push(d), onSelectLastDay: (d: string) => dates.push(d) };
  const ui = montar('src/components/finance/date-picker-field.tsx', 'DatePickerField', props);
  const open = () => { ui.find(n => n.props?.accessibilityLabel === 'Date').props.onPress(); ui.render(); };
  const monthEnd = () => ui.nodes().findLast(n => n.props?.accessibilityLabel === 'Último dia de todo mês').props.onPress;
  open(); const oldVisit = monthEnd();
  ui.config.ativo = false; ui.render(); ui.config.ativo = true; ui.render(); open();
  oldVisit(); ui.render();
  assert.deepEqual(dates, [], 'last-day handler from a previous visit must be inert');
  const oldMonth = monthEnd();
  ui.find(n => n.type === 'Calendar').props.onMonthChange('2026-06'); ui.render();
  oldMonth(); ui.render();
  assert.deepEqual(dates, [], 'a September callback must not select in the June calendar');
  assert.equal(ui.find(n => n.props?.accessibilityLabel === 'Date').props.accessibilityState.expanded, true);
  monthEnd()(); monthEnd()();
  assert.deepEqual(dates, ['30/06/2026'], 'current choice emits once before rerender');
});

test('DatePicker month-end choice is single emission and a newly committed selection can toggle its intent', () => {
  const dates: string[] = [];
  const props = { value: '15/09/2026', accessibilityLabel: 'Date', onChange: (d: string) => dates.push(`day:${d}`), onSelectLastDay: (d: string) => dates.push(`last:${d}`) };
  const ui = montar('src/components/finance/date-picker-field.tsx', 'DatePickerField', props);
  const monthEnd = () => ui.nodes().findLast(n => n.props?.accessibilityLabel === 'Último dia de todo mês').props.onPress;
  const stale = monthEnd(); stale(); stale();
  assert.deepEqual(dates, ['last:30/09/2026']);
  ui.render({ ...props, value: '30/09/2026', lastDaySelected: true });
  stale(); assert.deepEqual(dates, ['last:30/09/2026'], 'queued old intent cannot toggle the committed selection');
  monthEnd()(); monthEnd()();
  assert.deepEqual(dates, ['last:30/09/2026', 'day:30/09/2026']);
  ui.render({ ...props, value: '30/09/2026', lastDaySelected: false });
  monthEnd()();
  assert.deepEqual(dates, ['last:30/09/2026', 'day:30/09/2026', 'last:30/09/2026']);
});

test('DatePicker preserves an outgoing calendar but reactivates collapsed and invalidates its old session', () => {
  const dates: string[] = [];
  const props = { value: '15/09/2026', accessibilityLabel: 'Date', onChange: (d: string) => dates.push(d), onSelectLastDay: () => {} };
  const ui = montar('src/components/finance/date-picker-field.tsx', 'DatePickerField', props);
  const header = () => ui.find(n => n.props?.accessibilityLabel === 'Date');
  header().props.onPress(); ui.render();
  const stale = ui.find(n => n.type === 'Calendar');
  stale.props.onMonthChange('2026-06'); ui.render();
  ui.config.ativo = false; ui.render();
  assert.equal(header().props.accessibilityState.expanded, true, 'outgoing content must not collapse during its exit');
  ui.config.ativo = true; ui.render();
  assert.equal(header().props.accessibilityState.expanded, false);
  stale.props.onChange('2026-06-18');
  assert.deepEqual(dates, []);
  header().props.onPress(); ui.render();
  const current = ui.find(n => n.type === 'Calendar' && n.key !== stale.key);
  assert.ok(current, 'a new opening has a new calendar lifetime');
  stale.props.onChange('2026-06-19'); stale.props.onMonthChange('2026-06'); ui.render();
  assert.deepEqual(dates, []);
  assert.equal(ui.nodes().findLast(n => n.type === 'ThemedText' && n.props.type === 'caption').props.children, 'Usar 30/09/2026');
  current.props.onChange('2026-09-20');
  assert.deepEqual(dates, ['20/09/2026']);
});

test('DatePicker outgoing calendar cannot select again while the collapsed month-end control remains active', () => {
  const dates: string[] = [];
  const monthEnds: string[] = [];
  const ui = montar('src/components/finance/date-picker-field.tsx', 'DatePickerField', {
    value: '15/09/2026', accessibilityLabel: 'Date',
    onChange: (date: string) => dates.push(date), onSelectLastDay: (date: string) => monthEnds.push(date),
  });
  ui.find((n) => n.props?.accessibilityLabel === 'Date').props.onPress(); ui.render();
  const calendar = ui.find((n) => n.type === 'Calendar');
  calendar.props.onChange('2026-09-18'); ui.render();
  assert.ok(ui.find((n) => n.type === 'Calendar'), 'the outgoing calendar snapshot still exists during collapse');
  assert.equal(ui.find((n) => n.props?.accessibilityLabel === 'Date').props.accessibilityState.expanded, false);
  calendar.props.onChange('2026-10-19'); calendar.props.onMonthChange('2026-12'); ui.render();
  assert.deepEqual(dates, ['18/09/2026']);
  ui.find((n) => n.props?.accessibilityLabel === 'Último dia de todo mês').props.onPress();
  assert.deepEqual(monthEnds, ['30/09/2026']);
  calendar.props.onChange('2026-12-20'); ui.render();
  assert.deepEqual(dates, ['18/09/2026']);
});

test('DatePicker reopening during collapse gives the calendar a new lifetime and keeps month-end aligned with its current month', () => {
  const dates: string[] = [];
  const monthEnds: string[] = [];
  const ui = montar('src/components/finance/date-picker-field.tsx', 'DatePickerField', {
    value: '15/09/2026', accessibilityLabel: 'Date',
    onChange: (date: string) => dates.push(date), onSelectLastDay: (date: string) => monthEnds.push(date),
  });
  const toggle = () => { ui.find((n) => n.props?.accessibilityLabel === 'Date').props.onPress(); ui.render(); };
  const latestCaption = () => ui.nodes().findLast((n) => n.type === 'ThemedText' && n.props.type === 'caption').props.children;
  toggle();
  const juneCalendar = ui.find((n) => n.type === 'Calendar');
  juneCalendar.props.onMonthChange('2026-06'); ui.render();
  assert.equal(latestCaption(), 'Usar 30/06/2026');
  toggle();
  const closing = ui.close();
  assert.ok(ui.find((n) => n.type === 'Calendar'), 'the old calendar remains mounted while closing');
  toggle();
  const reopened = ui.find((n) => n.type === 'Calendar');
  assert.notEqual(reopened.key, juneCalendar.key);
  assert.equal(reopened.props.value, '2026-09-15');
  juneCalendar.props.onMonthChange('2026-06'); juneCalendar.props.onChange('2026-06-18'); ui.render();
  assert.deepEqual(dates, []);
  assert.equal(latestCaption(), 'Usar 30/09/2026');
  ui.finish(closing);
  assert.equal(ui.find((n) => n.props?.accessibilityLabel === 'Date').props.accessibilityState.expanded, true);
  assert.equal(ui.find((n) => n.type === 'Calendar').key, reopened.key);
  ui.find((n) => n.type === 'Calendar').props.onMonthChange('2026-06'); ui.render();
  assert.equal(latestCaption(), 'Usar 30/06/2026');
  ui.nodes().findLast((n) => n.props?.accessibilityLabel === 'Último dia de todo mês').props.onPress();
  assert.deepEqual(monthEnds, ['30/06/2026']);
});

test('QuantityField snapshot never clamps or edits financial state; typing and steps stay synchronous', () => {
  const values: number[] = [];
  const config = { reduzir: false, ativo: false };
  const props = { value: 12, min: 1, max: 5, onChange: (n: number) => values.push(n) };
  const ui = montar('src/components/ui/quantity-field.tsx', 'QuantityField', props, config);
  assert.deepEqual(values, []);
  ui.find((n) => n.type === 'TextField').props.onChangeText('3');
  ui.find((n) => n.props?.accessibilityLabel === 'Um a menos').props.onPress();
  assert.deepEqual(values, []);
  config.ativo = true; ui.render();
  assert.deepEqual(values, [5]);
  ui.render({ ...props, value: 3 });
  ui.find((n) => n.type === 'TextField').props.onChangeText(''); ui.render();
  assert.equal(ui.find((n) => n.type === 'TextField').props.value, '');
  const before = ui.animations.length;
  ui.find((n) => n.type === 'TextField').props.onChangeText('4');
  assert.equal(values.at(-1), 4); assert.equal(ui.animations.length, before);
  ui.render({ ...props, value: 4 });
  ui.find((n) => n.props?.accessibilityLabel === 'Um a mais').props.onPress();
  assert.equal(values.at(-1), 5);
});

test('TextField outgoing snapshot suppresses editing and contract-clamping blur', () => {
  const calls: string[] = [];
  const config = { reduzir: false, ativo: true };
  const props = { value: '6', onChangeText: () => calls.push('edit'), onBlur: () => calls.push('clamp'), onFocus: () => calls.push('focus') };
  const ui = montar('src/components/ui/field.tsx', 'TextField', props, config);
  ui.find((n) => n.type === 'TextInput').props.onChangeText('60');
  config.ativo = false; ui.render();
  const snapshot = ui.find((n) => n.type === 'TextInput');
  assert.equal(snapshot.props.editable, false);
  assert.equal(snapshot.props.onChangeText, undefined);
  snapshot.props.onBlur({}); snapshot.props.onFocus({});
  assert.deepEqual(calls, ['edit']);
  config.ativo = true; ui.render();
  ui.find((n) => n.type === 'TextInput').props.onBlur({});
  assert.deepEqual(calls, ['edit', 'clamp']);
});

test('MudancaSuave crossfades discrete content and reduced motion restores the latest label immediately', () => {
  const config = { reduzir: false, ativo: true };
  const ui = montar(helper, 'MudancaSuave', { valor: 'a', children: 'Label A' }, config);
  ui.layout(incoming(ui), 20);
  ui.render({ valor: 'b', children: 'Label B' });
  assert.equal(outgoing(ui).props.children, 'Label A');
  assert.equal(content(ui), 'Label B');
  ui.layout(incoming(ui), 20);
  const pending = ui.transition();
  pending.shared.value = 0.5;
  assert.equal(ui.style(incoming(ui)).opacity, 0.5);
  assert.equal(ui.style(outgoing(ui)).opacity, 0.5);
  assert.equal(ui.style(incoming(ui)).transform[0].translateY, 0, 'pure labels remain aligned throughout the crossfade');
  pending.shared.value = 0.78;
  config.reduzir = true; ui.render();
  assert.equal(outgoing(ui), undefined);
  assert.equal(content(ui), 'Label B');
  assert.equal(ui.style(incoming(ui)).opacity, 1);
  ui.finish(pending);
  assert.equal(content(ui), 'Label B');
});

test('Presenca lazily mounts native motion once and first appearance springs through measured space', () => {
  const ui = montar(helper, 'Presenca', { visivel: false, children: 'not-yet-visible' });
  ui.render({ visivel: false, children: 'updated-while-hidden' });
  assert.equal(ui.nodes().length, 0); assert.equal(ui.sharedValues.length, 0);
  assert.equal(ui.animatedStyleCalls(), 0); assert.equal(ui.animations.length, 0);
  ui.render({ visivel: true, children: 'first-visible' });
  assert.equal(content(ui), 'first-visible');
  assert.equal(ui.sharedValues.length, 2, 'one progress and one measured-height value');
  assert.equal(ui.transition().from, 0); assertMorphSpring(ui.transition());
  ui.layout(incoming(ui), 100);
  ui.transition().shared.value = 0.4;
  assert.equal(ui.style(ui.find((n) => n.props?.pointerEvents === 'auto')).height, 40);
  ui.finish(ui.transition());
  assert.equal(ui.style(ui.find((n) => n.props?.pointerEvents === 'auto')).height, 'auto');
  const shared = ui.sharedValues[0];
  ui.render({ visivel: false, children: null }); ui.finish(ui.close());
  assert.equal(ui.nodes().length, 0);
  ui.render({ visivel: true, children: 'next-visible' });
  assert.equal(ui.sharedValues.length, 2, 'the animated lifetime stays mounted after first appearance');
  assert.equal(ui.sharedValues[0], shared); assert.equal(ui.transition().from, 0);
});

test('Presenca explicitly restores natural resting geometry after opening, closing and reopening', () => {
  const ui = montar(helper, 'Presenca', { visivel: false, children: 'fields' });
  const visibleFrame = () => ui.find((n) => n.props?.pointerEvents === 'auto');
  ui.render({ visivel: true, children: 'fields' });
  ui.layout(incoming(ui), 100);
  ui.finish(ui.transition());
  assert.equal(ui.style(visibleFrame()).height, 'auto');
  assert.ok(visibleFrame().props.style.some((style: any) => style?.height === 'auto'), 'React writes the natural height as well as the animated style');
  ui.render({ visivel: false, children: null });
  ui.finish(ui.close());
  assert.equal(ui.nodes().length, 0);
  ui.render({ visivel: true, children: 'reopened fields' });
  ui.layout(incoming(ui), 140);
  const reopening = ui.transition();
  reopening.shared.value = 0.5;
  assert.equal(ui.style(visibleFrame()).height, 70);
  ui.finish(reopening);
  assert.equal(content(ui), 'reopened fields');
  assert.equal(ui.style(visibleFrame()).height, 'auto');
  assert.ok(visibleFrame().props.style.some((style: any) => style?.height === 'auto'));
  assert.equal(ui.style(incoming(ui)).position, undefined, 'resting content returns to natural flow');
  assert.equal(visibleFrame().props.accessibilityElementsHidden, false);
  reopening.shared.value = 0;
  assert.equal(ui.style(visibleFrame()).height, 'auto', 'resting geometry no longer depends on the previous animated height');
});

test('Presenca lazy first appearance honors reduced motion and an inactive parent', () => {
  const reduced = montar(helper, 'Presenca', { visivel: false, children: null }, { reduzir: true, ativo: true });
  assert.equal(reduced.sharedValues.length, 0);
  reduced.render({ visivel: true, children: 'visible' });
  assert.equal(reduced.sharedValues[0].get(), 1); assert.equal(reduced.animations.length, 0);
  reduced.render({ visivel: false, children: null }); assert.equal(reduced.nodes().length, 0);
  const inactive = montar(helper, 'Presenca', { visivel: false, children: null }, { reduzir: false, ativo: false });
  inactive.render({ visivel: true, children: 'snapshot' });
  assert.equal(inactive.find((n) => n.type === 'Provider').props.value, false);
  assert.equal(outgoing(inactive).props.accessibilityElementsHidden, true);
  inactive.render({ visivel: false, children: null });
  const pending = inactive.close(); inactive.unmount(); pending.done?.(true);
  assert.equal(inactive.writesAfterUnmount(), 0);
});

test('prepared compact presence measures while hidden and first open reuses its native motion', () => {
  const props = { visivel: false, preparar: true, children: 'options' };
  const ui = montar(helper, 'Presenca', props);
  assert.ok(incoming(ui), 'compact options exist before the first interaction');
  assert.equal(ui.style(outgoing(ui)).height, 0);
  assert.equal(ui.style(incoming(ui)).opacity, 0);
  assert.equal(outgoing(ui).props.accessibilityElementsHidden, true);
  assert.equal(outgoing(ui).props.importantForAccessibility, 'no-hide-descendants');
  assert.equal(ui.find((n) => n.type === 'Provider').props.value, false);
  const installed = ui.sharedValues.length;
  ui.layout(incoming(ui), 120);
  ui.render({ ...props, visivel: true });
  assert.equal(ui.sharedValues.length, installed, 'opening installs no new shared values');
  const opening = ui.transition(); assertMorphSpring(opening);
  opening.shared.value = .25;
  assert.equal(ui.style(ui.find((n) => n.props?.pointerEvents === 'auto')).height, 30);
  ui.finish(opening);
  ui.render(props); ui.finish(ui.close());
  assert.equal(ui.style(outgoing(ui)).height, 0);
  assert.equal(content(ui), 'options');
  ui.render({ ...props, children: 'updated options' });
  ui.layout(incoming(ui), 180);
  ui.render({ ...props, children: 'updated options', visivel: true });
  ui.transition().shared.value = .5;
  assert.equal(ui.style(ui.find((n) => n.props?.pointerEvents === 'auto')).height, 90);
  assert.equal(ui.sharedValues.length, installed, 'reopening uses the updated measurement');
});

test('prepared presence waits for measurement on an immediate first tap and accepts an empty list', () => {
  const props = { visivel: false, preparar: true, children: null };
  const ui = montar(helper, 'Presenca', props);
  ui.render({ ...props, visivel: true });
  assert.equal(ui.animations.length, 0, 'no opening progress is lost before native layout');
  ui.layout(incoming(ui), 0);
  assertMorphSpring(ui.transition());
  ui.finish(ui.transition());
  assert.equal(ui.style(ui.find((n) => n.props?.pointerEvents === 'auto')).height, 'auto');
});

test('SelectField first opening and reopening install no new native motion for its options', () => {
  const props = { value: 'a', placeholder: 'Choose', options: [
    { id: 'a', label: 'A', icon: 'circle' }, { id: 'b', label: 'B', icon: 'circle' }, { id: 'c', label: 'C', icon: 'circle' },
  ], onChange() {} };
  const ui = montar('src/components/ui/select-field.tsx', 'SelectField', props);
  const header = () => ui.find((n) => n.type === 'PressableScale' && n.props.accessibilityState.expanded !== undefined);
  const installed = ui.sharedValues.length;
  header().props.onPress(); ui.render();
  assert.equal(ui.sharedValues.length, installed, 'the first tap must not initialize the option animations');
  header().props.onPress(); ui.render(); ui.finish(ui.close());
  header().props.onPress(); ui.render();
  assert.equal(ui.sharedValues.length, installed, 'closing must retain prepared compact options');
});

test('prepared presence remains hidden with reduced motion and ignores native layout after unmount', () => {
  const props = { visivel: false, preparar: true, children: 'options' };
  const ui = montar(helper, 'Presenca', props, { reduzir: true, ativo: true });
  assert.equal(ui.style(outgoing(ui)).height, 0);
  assert.equal(ui.style(incoming(ui)).opacity, 0);
  ui.render({ ...props, visivel: true });
  assert.equal(ui.animations.length, 0);
  assert.equal(ui.style(incoming(ui)).opacity, 1);
  ui.render(props);
  assert.equal(ui.style(outgoing(ui)).height, 0);
  const measure = incoming(ui).props.onLayout;
  const previous = ui.sharedValues.map((value) => value.get());
  ui.unmount(); measure({ nativeEvent: { layout: { width: 300, height: 999 } } });
  assert.deepEqual(ui.sharedValues.map((value) => value.get()), previous);
  assert.equal(ui.writesAfterUnmount(), 0);
});

test('FormatoDoLancamento prepares first opening and cannot select while hidden or inactive', () => {
  const calls: string[] = [];
  const props = { value: 'uma', onChange: (value: string) => calls.push(value) };
  const config = { reduzir: false, ativo: true };
  const ui = montar('src/components/finance/formato-do-lancamento.tsx', 'FormatoDoLancamento', props, config);
  const header = () => ui.find((n) => n.props?.accessibilityState?.expanded !== undefined);
  const option = () => ui.find((n) => n.props?.accessibilityLabel === 'Recorrente, Um valor que se repete');
  option().props.onPress(); assert.deepEqual(calls, []);
  ui.layout(incoming(ui), 240);
  const installed = ui.sharedValues.length;
  header().props.onPress(); ui.render();
  assert.equal(ui.sharedValues.length, installed);
  const choose = option().props.onPress;
  choose(); choose(); assert.deepEqual(calls, ['recorrente']);
  ui.render({ ...props, value: 'recorrente' }); ui.finish(ui.close());
  assert.equal(ui.style(outgoing(ui)).height, 0);
  config.ativo = false; ui.render({ ...props, value: 'recorrente' });
  header().props.onPress(); option().props.onPress();
  assert.equal(header().props.accessibilityState.expanded, false);
  assert.deepEqual(calls, ['recorrente']);
});

test('SelectField keeps the icon column spacing for alternatives without an icon', () => {
  const ui = montar('src/components/ui/select-field.tsx', 'SelectField', {
    value: 'a', placeholder: 'Choose', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], onChange() {},
  });
  const option = ui.find((n) => n.type === 'PressableScale' && n.props.accessibilityLabel === 'B');
  assert.equal(option.props.children.props.children.filter(Boolean).length, 3, 'icon spacer, labels and indicator retain the three original columns');
});

test('TextField keeps a full line visible when the font changes, retaining normal geometry and typing', () => {
  const config = { reduzir: false, ativo: true, fontScale: 1 };
  const typed: string[] = [];
  const ui = montar('src/components/ui/field.tsx', 'TextField', { value: 'QA', onChangeText: (s: string) => typed.push(s) }, config);
  const input = () => ui.find((n) => n.type === 'TextInput');
  const normal = ui.style(input()).height;
  config.fontScale = 3.12; ui.render();
  const large = ui.style(input());
  assert.ok(large.height >= large.lineHeight * config.fontScale + 4, 'scaled glyph line must fit inside the native input');
  assert.ok(large.height > normal);
  input().props.onChangeText('QA2');
  assert.deepEqual(typed, ['QA2']);
  config.fontScale = 1; ui.render();
  assert.equal(ui.style(input()).height, normal);
});

test('TextField respects the caller font cap, disabled scaling and multiline geometry', () => {
  const config = { reduzir: false, ativo: true, fontScale: 3.12 };
  const ui = montar('src/components/ui/field.tsx', 'TextField', { value: 'QA', allowFontScaling: false }, config);
  const input = () => ui.find((n) => n.type === 'TextInput');
  assert.equal(ui.style(input()).height, 50);
  ui.render({ allowFontScaling: true, maxFontSizeMultiplier: 1.5 });
  assert.equal(ui.style(input()).height, 50);
  ui.render({ maxFontSizeMultiplier: 0 });
  assert.ok(ui.style(input()).height >= 23 * config.fontScale + 4);
  ui.render({ multiline: true, style: { height: 120, lineHeight: 30 } });
  assert.equal(ui.style(input()).height, 120);
});

test('Field keeps its visible label gap through accessory and native text height changes', () => {
  const props = { label: 'Date', labelAccessory: 'Reset', labelGap: 16, children: 'Input' };
  const ui = montar('src/components/ui/field.tsx', 'Field', props);
  const text = () => ui.find((n) => n.type === 'ThemedText' && n.props.children === 'Date');
  const row = () => ui.find((n) => n.type === 'View' && n.props.onLayout);
  const body = () => ui.find((n) => n.type === 'View' && n.props.children?.includes?.('Input'));
  const visibleGap = (textHeight: number, rowHeight: number) =>
    (rowHeight - textHeight) / 2 + ui.style(body()).gap;
  for (const [textHeight, rowHeight] of [[18, 36], [30, 36], [60, 60], [128, 128], [18, 36]]) {
    ui.layout(text(), textHeight);
    ui.layout(row(), rowHeight);
    assert.equal(visibleGap(textHeight, rowHeight), 16, 'a taller action cannot add a second label-to-input gap');
  }
  ui.render({ ...props, labelAccessory: undefined });
  assert.equal(ui.style(body()).gap, 16, 'removing the action retains the requested gap');
  ui.render({ label: 'Date', children: 'Input' });
  assert.equal(ui.style(body()).gap, 8, 'ordinary fields retain the existing spacing');
});

for (const reduzir of [false, true]) {
  test(`LockOverlay immediately covers an interrupted reveal and ignores its queued animation (${reduzir ? 'reduced' : 'full'} motion)`, () => {
    const lock = { locked: true, velado: false, estado: 'trancado', comoAutentica: 'a senha do celular', autenticar: async () => 'aberto' };
    const ui = montar('src/components/ui/lock-overlay.tsx', 'LockOverlay', {}, { reduzir, ativo: true, lock });
    lock.locked = false;
    ui.render();
    const old = ui.transition();
    old.shared.value = 0.6;
    lock.locked = true;
    ui.render();
    const cover = ui.find((n) => n.props?.accessibilityViewIsModal === true);
    assert.ok(cover, 'the returned visit is protected and intercepts input');
    assert.equal(cover.props.pointerEvents, 'auto');
    assert.equal(ui.style(cover).backgroundColor, '#0B0B0C', 'protection is opaque on the relock render, before animation effects');
    assert.equal(old.shared.get(), 0, 'relocking does not animate exposed content back under the curtain');
    lock.locked = false;
    ui.render();
    const current = ui.transition();
    ui.finish(old);
    assert.ok(ui.find((n) => n.props?.accessibilityViewIsModal === false), 'a queued callback cannot unmount a newer reveal');
    ui.finish(current);
    assert.equal(ui.nodes().length, 0, 'the valid reveal still completes');
  });
}

test('LockOverlay rejects stale fallback timers after an interrupted reveal and callbacks after unmount', () => {
  const lock = { locked: true, velado: false, estado: 'trancado', comoAutentica: 'a senha do celular', autenticar: async () => 'aberto' };
  const ui = montar('src/components/ui/lock-overlay.tsx', 'LockOverlay', {}, { reduzir: false, ativo: true, lock });
  lock.locked = false; ui.render();
  const stale = ui.timers.at(-1)!;
  lock.locked = true; ui.render();
  lock.locked = false; ui.render();
  stale.fn(); ui.render();
  assert.ok(ui.find((n) => n.type === 'WaveCurtain'), 'an already queued old timeout cannot remove the latest curtain');
  const animation = ui.transition();
  const timer = ui.timers.at(-1)!;
  ui.unmount();
  animation.done?.(true); timer.fn();
  assert.equal(ui.writesAfterUnmount(), 0);
});

test('LockOverlay fallback completes only its current reveal when a native completion is missing', () => {
  const lock = { locked: true, velado: false, estado: 'trancado', comoAutentica: 'a senha do celular', autenticar: async () => 'aberto' };
  const ui = montar('src/components/ui/lock-overlay.tsx', 'LockOverlay', {}, { reduzir: false, ativo: true, lock });
  lock.locked = false; ui.render();
  ui.timers.at(-1)!.fn(); ui.render();
  assert.equal(ui.nodes().length, 0);
});

const entradaFile = 'src/components/finance/down-payment-fields.tsx';
function entradaUI(showToggle = true, reduzir = false) {
  let props: any = { enabled: !showToggle, showToggle,
    value: { amountCents: 0, dateBR: '01/09/2026', accountId: null }, accounts: [],
    onEnabled: (enabled: boolean) => { props = { ...props, enabled }; ui.render(props); },
    onChange: (value: any) => { props = { ...props, value }; ui.render(props); } };
  const ui = montar(entradaFile, 'DownPaymentFields', props, { reduzir, ativo: true });
  return { ui, change: (extra: any) => { props = { ...props, ...extra }; ui.render(props); } };
}
const campoEntrada = (ui: ReturnType<typeof montar>, label: string) => ui.find(n => n.type === 'Field' && n.props.label === label);

test('entrada começa sem erro nem foco, valida ao sair do valor e limpa o erro após corrigir', () => {
  const { ui } = entradaUI();
  ui.find(n => n.type === 'SwitchRow').props.onValueChange(true);
  assert.equal(campoEntrada(ui, 'Entrada').props.error, undefined);
  assert.equal(campoEntrada(ui, 'Conta da entrada').props.error, undefined);
  let money = ui.find(n => n.type === 'MoneyField');
  assert.equal(Boolean(money.props.invalid), false);
  assert.equal(Boolean(money.props.autoFocus), false);
  money.props.onBlur(); ui.render();
  assert.ok(campoEntrada(ui, 'Entrada').props.error);
  assert.equal(campoEntrada(ui, 'Conta da entrada').props.error, undefined);
  money = ui.find(n => n.type === 'MoneyField');
  money.props.onChangeCents(20000); ui.render();
  assert.equal(campoEntrada(ui, 'Entrada').props.error, undefined);
  assert.equal(Boolean(ui.find(n => n.type === 'MoneyField').props.invalid), false);
});

test('entrada fica inteira e utilizável no primeiro render, sem esperar medição ou animação', () => {
  const { ui } = entradaUI();
  const installed = ui.sharedValues.length;
  ui.find(n => n.type === 'SwitchRow').props.onValueChange(true);
  assert.equal(ui.sharedValues.length, installed, 'o toque não monta novos worklets');
  const envelope = ui.find(n => n.props?.pointerEvents === 'auto');
  const semQuadroAnimado = (style: any): any => Array.isArray(style)
    ? Object.assign({}, ...style.map(semQuadroAnimado)) : style?.__worklet ? {} : style ?? {};
  assert.equal(semQuadroAnimado(envelope.props.style).height, 'auto', 'a altura não espera o mapper da UI');
  assert.equal(semQuadroAnimado(incoming(ui).props.style).opacity, 1, 'a visibilidade não espera o mapper da UI');
  assert.equal(ui.style(envelope).height, 'auto', 'o campo completo não depende do progresso da expansão');
  assert.equal(envelope.props.accessibilityElementsHidden, false);
  assert.equal(ui.style(incoming(ui)).opacity, 1, 'o campo é legível antes de qualquer quadro da animação');
  ui.find(n => n.type === 'MoneyField').props.onChangeCents(5000);
  assert.equal(ui.find(n => n.type === 'MoneyField').props.valueCents, 5000);
  ui.find(n => n.type === 'MoneyField').props.onBlur(); ui.render();
  assert.equal(campoEntrada(ui, 'Entrada').props.error, undefined);
});

for (const reduzir of [false, true]) test(`entrada oculta imediatamente e reabre inteira durante reversões (${reduzir ? 'reduced' : 'full'} motion)`, () => {
  const { ui } = entradaUI(true, reduzir);
  ui.find(n => n.type === 'SwitchRow').props.onValueChange(true);
  const opening = ui.animations.at(-1);
  if (!reduzir) {
    assert.equal(opening?.kind, 'timing');
    assert.equal(opening.settings.duration, 120);
  }
  if (opening) opening.shared.value = .5;
  ui.find(n => n.type === 'MoneyField').props.onBlur(); ui.render();
  assert.ok(campoEntrada(ui, 'Entrada').props.error);
  ui.find(n => n.type === 'SwitchRow').props.onValueChange(false);
  if (opening) assert.equal(opening.canceled, true, 'a reversão cancela o movimento anterior');
  assert.equal(ui.style(outgoing(ui)).height, 0);
  assert.equal(ui.style(incoming(ui)).opacity, 0);
  assert.equal(outgoing(ui).props.accessibilityElementsHidden, true);
  ui.find(n => n.type === 'SwitchRow').props.onValueChange(true);
  if (opening) ui.finish(opening);
  assert.equal(ui.style(ui.find(n => n.props?.pointerEvents === 'auto')).height, 'auto');
  assert.equal(ui.style(incoming(ui)).opacity, 1);
  assert.equal(campoEntrada(ui, 'Entrada').props.error, undefined);
  assert.equal(Boolean(ui.find(n => n.type === 'MoneyField').props.autoFocus), false);
  ui.unmount();
  opening?.done?.(true);
  assert.equal(ui.writesAfterUnmount(), 0);
});

test('adicionar entrada a contrato existente também nasce sem validação prematura', () => {
  const { ui } = entradaUI(false);
  assert.equal(campoEntrada(ui, 'Entrada').props.error, undefined);
  assert.equal(campoEntrada(ui, 'Conta da entrada').props.error, undefined);
});

test('entrada já preenchida explica um limite do total mesmo depois de reiniciar a revisão', () => {
  const { ui, change } = entradaUI();
  const value = { amountCents: 10000, dateBR: '01/09/2026', accountId: 'conta' };
  change({ enabled: true, value });
  ui.find(n => n.type === 'MoneyField').props.onBlur(); ui.render();
  change({ enabled: false }); change({ enabled: true });
  assert.equal(campoEntrada(ui, 'Entrada').props.error, undefined);
  change({ error: 'A entrada precisa ser menor que o total da compra' });
  assert.equal(campoEntrada(ui, 'Entrada').props.error, 'A entrada precisa ser menor que o total da compra');
  assert.equal(Boolean(ui.find(n => n.type === 'MoneyField').props.invalid), true);
  change({ error: undefined });
  assert.equal(campoEntrada(ui, 'Entrada').props.error, undefined);
  assert.equal(Boolean(ui.find(n => n.type === 'MoneyField').props.invalid), false);
});

test('erros de conta e data não pintam a borda do valor; limite da compra aparece após revisar o valor', () => {
  const { ui, change } = entradaUI(false);
  const value = { amountCents: 20000, dateBR: '01/09/2026', accountId: null };
  change({ value, error: 'Escolha a conta da entrada' });
  ui.find(n => n.type === 'MoneyField').props.onBlur(); ui.render();
  assert.equal(campoEntrada(ui, 'Entrada').props.error, undefined);
  assert.equal(Boolean(ui.find(n => n.type === 'MoneyField').props.invalid), false);
  change({ value: { ...value, accountId: 'conta', dateBR: 'inválida' }, error: 'Informe a data da entrada' });
  assert.equal(campoEntrada(ui, 'Entrada').props.error, undefined);
  change({ value: { ...value, accountId: 'conta' }, error: 'A entrada precisa ser menor que o total da compra' });
  assert.ok(campoEntrada(ui, 'Entrada').props.error);
  assert.equal(Boolean(ui.find(n => n.type === 'MoneyField').props.invalid), true);
});
