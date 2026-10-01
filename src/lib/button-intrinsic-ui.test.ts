import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
type Props = Record<string, unknown>;
type Element = { type: unknown; key?: string | null; props: Props };
type Node = Element & { children: Node[]; parents: Node[] };
type Effect = { fn: () => unknown; deps: unknown[]; cleanup?: unknown };
type Instance = { slots: unknown[]; cursor: number; restart: boolean };
type Animation = { target: number; done?: (finished: boolean) => void };
type Shared = { value: number; pending?: Animation; get: () => number; set: (next: number | Animation) => void };
const wire = (value: unknown) => JSON.parse(JSON.stringify(value));

/** Button e presenca reais, com layout medido e animacoes pendentes controlados pelo teste. */
function mountButton(glass = false) {
  const config = { reduced: false, active: true };
  const instances = new Map<string, Instance>();
  const contexts = new Map<unknown, unknown>();
  const modules = new Map<string, unknown>();
  const shared: Shared[] = [];
  let current: Instance;
  let effects: { instance: Instance; slot: number; effect: Effect }[] = [];
  let dirty = false;
  let roots: Node[] = [];
  let pressed = 0;
  let props: Props = { label: 'Filtros', icon: 'line.3.horizontal.decrease', size: 'sm', variant: 'secondary', onPress: () => pressed++ };
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
    __esModule: true, default: { View: 'Animated.View' }, ReduceMotion: { System: 'system' },
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
      if (name === 'react-native') return { View: 'View', Dimensions: { get: () => ({ width: 400, height: 800 }) },
        StyleSheet: { create: (value: unknown) => value, flatten: style, absoluteFill: { position: 'absolute' } } };
      if (name === 'react-native-reanimated') return reanimated;
      if (name === '@/components/motion/presenca') return load('src/components/motion/presenca.tsx');
      if (name === '@/components/motion/cores-suaves') return {
        useCoresSuaves: (value: Props) => ({ colorTween: value }), useOpacidadeSuave: (opacity: number) => ({ opacity }),
      };
      if (name === '@/components/motion/session-curtain') return { useCortina: () => ({ lembrarOrigem() {} }) };
      if (name === '@/components/ui/glass-backdrop') return { GlassBackdrop: 'GlassBackdrop', supportsLiquidGlass: () => glass };
      if (name === '@/hooks/use-theme') return { useTheme: () => ({ tintFill: 'fill', backgroundElement: 'element', danger: 'danger', glassActionTint: 'glass-fill', glassElementTint: 'glass-element' }) };
      if (name === '@/design/tokens') return { HitTarget: 44, Radius: { pill: 100 }, Space: { sm: 8, lg: 16, xl: 24 },
        Motion: { duration: { morph: 180 }, easing: { inOut: 'inOut' }, spring: { morph: { stiffness: 360, damping: 26, mass: 1 } } } };
      if (name.startsWith('@/components/')) return new Proxy({}, { get: (_target, key) => String(key) });
      throw new Error(`Modulo inesperado ${name}`);
    } }, { filename: file });
    modules.set(file, module.exports);
    return module.exports;
  }
  const Button = (load('src/components/ui/button.tsx') as { Button: (value: Props) => unknown }).Button;
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
      if (Array.isArray(value)) return value.flatMap((child, i) => resolveNode(child, `${path}/${i}`));
      if (!value || typeof value !== 'object' || !('props' in value)) return [];
      const element = value as Element;
      if (typeof element.type === 'function') return execute(element.type as (p: Props) => unknown, element.props, `${path}/${element.key ?? ''}`);
      const context = typeof element.type === 'object' && element.type && 'context' in element.type ? element.type.context : undefined;
      const previous = contexts.get(context); const had = contexts.has(context);
      if (context) contexts.set(context, element.props.value);
      const children = resolveNode(element.props.children, `${path}/children/${element.key ?? ''}`);
      if (context) { if (had) contexts.set(context, previous); else contexts.delete(context); }
      return [{ ...element, type: context ? 'Provider' : element.type, children, parents: [] }];
    }
    for (let attempt = 0; attempt < 30; attempt++) {
      dirty = false; effects = [];
      roots = execute(Button, props, 'root');
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
  }
  function nodes(): Node[] { const all: Node[] = []; const visit = (node: Node) => { all.push(node); node.children.forEach(visit); }; roots.forEach(visit); return all; }
  function find(type: string, text?: string) {
    const node = nodes().find(node => node.type === type && (text === undefined || node.props.children === text));
    assert.ok(node, `Nao achei ${type} ${text ?? ''}`);
    return node;
  }
  render();
  return {
    config, nodes, find, style: (node: Node) => style(node.props.style),
    get pressed() { return pressed; },
    root: () => roots[0],
    render(patch: Props = {}) { render({ ...props, ...patch }); },
    layout(node: Node, width: number, height = 14) {
      (node.props.onLayout as (e: unknown) => void)({ nativeEvent: { layout: { width, height } } }); render();
    },
    finishAnimations() {
      for (const value of shared) if (value.pending) { const animation = value.pending; value.pending = undefined; value.value = animation.target; animation.done?.(true); }
      render();
    },
  };
}

/**
 * Caixa de texto já medida pelo nativo (Dynamic Type ou múltiplas linhas). Resolve apenas
 * as duas caixas verticais do Button; o simulador continua sendo a prova dos glifos reais.
 */
function layoutNativeLabel(ui: ReturnType<typeof mountButton>, textHeight: number, width = 400) {
  const label = ui.find('ThemedText');
  const content = label.parents.at(-1)!;
  const contentStyle = ui.style(content);
  const naturalHeight = textHeight + 2 * Number(contentStyle.paddingVertical ?? 0);
  const contentHeight = Number(contentStyle.height ?? Math.max(Number(contentStyle.minHeight ?? 0), naturalHeight));
  const pressable = ui.find('PressableScale');
  const pressableStyle = ui.style(pressable);
  const height = Number(pressableStyle.height ?? Math.max(Number(pressableStyle.minHeight ?? 0), contentHeight));
  ui.layout(pressable, width, height);
  return { height, contentHeight, naturalHeight };
}

for (const glass of [false, true]) {
  for (const size of ['sm', 'md', 'lg']) {
    test(`Button ${glass ? 'vidro' : 'opaco'} ${size}: altura natural acomoda fonte grande e várias linhas`, () => {
      const ui = mountButton(glass);
      ui.render({ size });
      for (const nativeHeight of [48, 114, 16]) {
        ui.render({ label: nativeHeight === 114 ? 'Aplicar\nfiltros ativos' : 'Aplicar filtros' });
        const { height, contentHeight, naturalHeight } = layoutNativeLabel(ui, nativeHeight);
        assert.ok(contentHeight >= naturalHeight, 'caixa do conteúdo não pode cortar texto ou seu respiro vertical');
        assert.ok(height >= contentHeight, 'área do botão deve crescer com o conteúdo');
        assert.ok(height + 2 * Number(ui.find('PressableScale').props.hitSlop) >= 44);
        assert.equal(ui.style(ui.find('PressableScale')).borderRadius, height / 2);
        if (glass) assert.equal(ui.find('GlassBackdrop').props.radius, height / 2);
        else {
          const pieces = ui.nodes().filter(node => ui.style(node).position === 'absolute' && ui.style(node).backgroundColor === 'element');
          assert.equal(pieces.length, 3);
          for (const piece of pieces) assert.equal(ui.style(piece).height, height, 'superfície acompanha a altura medida');
        }
      }
      (ui.find('PressableScale').props.onPress as () => void)();
      assert.equal(ui.pressed, 1);
    });
  }
}

test('Button: cápsula e centro do loader usam a altura atual ao crescer durante carregamento', () => {
  const ui = mountButton();
  ui.render({ loading: true });
  layoutNativeLabel(ui, 48);
  ui.finishAnimations();
  const firstHeight = ui.style(ui.find('PressableScale')).borderRadius as number * 2;
  const loader = ui.find('DotsLoader').parents.at(-1)!;
  assert.equal(ui.style(loader).height, firstHeight);
  const left = ui.nodes().find(node => ui.style(node).left === 0 && ui.style(node).width === firstHeight)!;
  assert.ok(left);
  const firstOffset = (ui.style(left).transform as { translateX: number }[])[0].translateX;
  assert.ok(firstOffset > 0, 'a pílula opaca continua encolhendo');
  ui.render({ label: 'Aplicando\nfiltros ativos' });
  const { height } = layoutNativeLabel(ui, 114);
  assert.ok(height > firstHeight);
  assert.equal(ui.style(ui.find('DotsLoader').parents.at(-1)!).height, height);
  const grownLeft = ui.nodes().find(node => ui.style(node).left === 0 && ui.style(node).width === height)!;
  const grownOffset = (ui.style(grownLeft).transform as { translateX: number }[])[0].translateX;
  assert.ok(grownOffset < firstOffset, 'cápsula mais alta precisa de menos recuo');
  ui.config.reduced = true;
  ui.render();
  const stillLeft = ui.nodes().find(node => ui.style(node).left === 0 && ui.style(node).width === height)!;
  assert.equal((ui.style(stillLeft).transform as { translateX: number }[])[0].translateX, 0);
  (ui.find('PressableScale').props.onPress as () => void)();
  assert.equal(ui.pressed, 0);
});

test('Button opaco: texto com muitas linhas mantém as tampas dentro de uma caixa mais alta que larga', () => {
  const ui = mountButton();
  ui.render({ label: 'Aplicar\nfiltros\nativos' });
  const { height } = layoutNativeLabel(ui, 114, 90);
  assert.ok(height > 90);
  const caps = ui.nodes().filter(node => typeof ui.style(node).width === 'number');
  assert.equal(caps.length, 2);
  for (const cap of caps) {
    assert.ok(Number(ui.style(cap).width) <= 90, 'tampa não pode desenhar além da largura medida');
    assert.equal(ui.style(cap).height, height);
  }
  ui.render({ loading: true });
  ui.finishAnimations();
  for (const cap of ui.nodes().filter(node => typeof ui.style(node).width === 'number'))
    assert.equal(Math.abs((ui.style(cap).transform as { translateX: number }[])[0].translateX), 0);
});

for (const glass of [false, true]) {
  test(`Button ${glass ? 'vidro' : 'opaco'}: label maior reflow imediato sem camada absoluta ou largura antiga`, () => {
    const ui = mountButton(glass);
    const rootRef = ui.root().props.ref;
    // Medir a largura inicial exercita o envelope real de TrocaSuave antes do novo rotulo.
    for (const node of ui.nodes().filter(node => typeof node.props.onLayout === 'function')) ui.layout(node, 80);
    ui.render({ label: 'Filtros ativos' });
    const label = ui.find('ThemedText', 'Filtros ativos');
    const icon = ui.find('Icon');
    for (const node of [...label.parents, label, ...icon.parents, icon]) {
      assert.notEqual(ui.style(node).position, 'absolute', 'rotulo/icone devem medir largura natural mesmo no primeiro frame da troca');
      assert.notEqual(typeof ui.style(node).width, 'number', 'largura antiga nao pode limitar o novo rotulo');
    }
    assert.equal(label.parents.at(-1), icon.parents.at(-1), 'icone e rotulo continuam na mesma linha natural');
    assert.equal(ui.style(label).flexShrink, 0);
    assert.equal(ui.root().props.ref, rootRef, 'trocar label nao remonta a instancia do botao');
    assert.equal(ui.root().key, null);
    assert.equal(ui.find('PressableScale').key, null);
    assert.equal(ui.find('PressableScale').props.accessibilityLabel, 'Filtros ativos');
    const { height } = layoutNativeLabel(ui, 16, 160);
    assert.equal(height, 36, 'o rótulo normal conserva a altura visual do sm');
    (ui.find('PressableScale').props.onPress as () => void)();
    assert.equal(ui.pressed, 1);
    if (!glass) assert.ok(ui.nodes().some(node => ui.style(node).colorTween), 'superficie conserva animacao de cores');
  });
}

test('Button preserva acessibilidade, bloqueio da acao, loader e largura externa durante carregamento', () => {
  const ui = mountButton();
  ui.render({ loading: true, label: 'Aplicando filtros' });
  const pressable = ui.find('PressableScale');
  assert.deepEqual(wire(pressable.props.accessibilityState), { disabled: true, busy: true });
  assert.equal(pressable.props.disabled, true);
  assert.equal(pressable.props.accessibilityLabel, 'Aplicando filtros');
  assert.equal(ui.find('DotsLoader').props.size, 5);
  assert.equal(ui.style(ui.root()).alignSelf, 'flex-start');
  (pressable.props.onPress as () => void)();
  assert.equal(ui.pressed, 0);
  ui.finishAnimations();
  ui.render({ loading: false, disabled: true });
  assert.deepEqual(wire(ui.find('PressableScale').props.accessibilityState), { disabled: true, busy: false });
  (ui.find('PressableScale').props.onPress as () => void)();
  assert.equal(ui.pressed, 0);
  ui.finishAnimations();
  assert.equal(ui.nodes().some(node => node.type === 'DotsLoader'), false);
  assert.equal(ui.find('ThemedText', 'Aplicando filtros').props.themeColor, 'textSecondary');
  ui.render({ disabled: false });
  (ui.find('PressableScale').props.onPress as () => void)();
  assert.equal(ui.pressed, 1);
});

test('Button conserva block, feedback e presenca inativa ao trocar rotulo', () => {
  const ui = mountButton();
  ui.config.active = false;
  ui.render({ block: true, label: 'Salvar filtros novos' });
  assert.equal(ui.style(ui.root()).alignSelf, 'stretch');
  const pressable = ui.find('PressableScale');
  assert.equal(pressable.props.disabled, true);
  assert.equal(pressable.props.hitSlop, 4);
  assert.equal(pressable.props.haptic, 'light');
  assert.equal(pressable.props.scaleTo, 0.97);
  (pressable.props.onPress as () => void)();
  assert.equal(ui.pressed, 0);
});
