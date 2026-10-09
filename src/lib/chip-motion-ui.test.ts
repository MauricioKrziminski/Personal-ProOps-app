import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);

// Keep springs pending so the real component can be inspected mid-flight and retargeted.
function mountChip(glass: boolean, selected = false) {
  const config = { reduced: false, active: true, fontScale: 1 };
  const theme = {
    backgroundElement: 'element', tintFill: 'fill', glassActionTint: 'glass-fill',
    cardBorder: 'border', text: 'text', onTint: 'on-tint',
    backgroundSelected: 'badge', overlay: 'overlay', textSecondary: 'secondary',
  };
  const slots: any[] = [];
  const shared: any[] = [];
  const animations: any[] = [];
  const cancellations: any[] = [];
  let cursor = 0;
  let effects: any[] = [];
  let tree: any;
  let haptics = 0;
  let presses = 0;
  let props = { label: 'Eletrônicos completos', selected, count: 3, icon: 'iphone', tinta: 'musgo', onPress: () => presses++ };
  const react = {
    useRef: (initial: any) => { const index = cursor++; return slots[index] ??= { current: initial }; },
    useLayoutEffect: (fn: () => any, deps: any[]) => {
      const index = cursor++;
      if (!slots[index] || deps.some((value, i) => !Object.is(value, slots[index].deps[i]))) effects.push({ index, fn, deps });
    },
  };
  const reanimated = {
    __esModule: true,
    default: { View: 'Animated.View', Text: 'Animated.Text' },
    ReduceMotion: { System: 'system' },
    useReducedMotion: () => config.reduced,
    useSharedValue: (initial: number) => {
      const index = cursor++;
      if (!slots[index]) {
        slots[index] = {
          value: initial, animation: null,
          get() { return this.value; },
          set(next: any) {
            if (next?.timing || next?.spring) {
              // Reanimated replaces the pending animation itself. Manual cancellation would
              // erase the previous animation before the new spring can inspect it.
              if (this.animation) this.animation.canceled = true;
              this.animation = { ...next, from: this.value, canceled: false };
              animations.push(this.animation);
            } else this.value = next;
          },
        };
        shared.push(slots[index]);
      }
      return slots[index];
    },
    useAnimatedStyle: (style: () => any) => ({ animatedStyle: style }),
    interpolateColor: (progress: number, _range: number[], colors: string[]) => progress === 0 ? colors[0] : progress === 1 ? colors[1] : `blend(${colors.join(',')},${progress})`,
    withTiming: (target: number, settings: any) => ({ timing: true, target, settings }),
    withSpring: (target: number, settings: any) => ({ spring: true, target, settings }),
    cancelAnimation: (value: any) => { cancellations.push(value); if (value.animation) value.animation.canceled = true; },
  };
  const module = { exports: {} as any };
  const code = ts.transpileModule(readFileSync('src/components/finance/chip.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  runInNewContext(code, { module, exports: module.exports, require: (id: string) => {
    if (id === 'react') return react;
    if (id === 'react/jsx-runtime') return require(id);
    if (id === 'react-native') return { View: 'View', useWindowDimensions: () => ({ fontScale: config.fontScale }), StyleSheet: { create: (s: any) => s, absoluteFill: { position: 'absolute' }, hairlineWidth: 1 } };
    if (id === 'react-native-worklets') return { scheduleOnRN: (fn: (...a: any[]) => unknown, ...a: unknown[]) => fn(...a) };
    if (id === 'react-native-reanimated') return reanimated;
    if (id === 'expo-haptics') return { selectionAsync: () => haptics++ };
    if (id === '@/components/ui/glass-backdrop') return { GlassBackdrop: 'GlassBackdrop', supportsLiquidGlass: () => glass };
    if (id === '@/components/ui/icon') return { Icon: 'Icon' };
    if (id === '@/constants/theme') return { Fonts: { semibold: 'semibold' } };
    if (id === '@/design/note-colors') return { noteInk: () => 'category-ink' };
    if (id === '@/design/tokens') return { Motion: { spring: { morph: { stiffness: 360, damping: 26, mass: 1 } }, duration: { base: 200, fast: 120 }, easing: { inOut: 'inOut' } }, Radius: { pill: 100 }, Space: { sm: 8, md: 12, xs: 4 }, Type: { subhead: {}, code: {} } };
    if (id === '@/hooks/use-theme') return { useScheme: () => 'light', useTheme: () => theme };
    if (id === '@/components/motion/presenca') return { usePresencaAtiva: () => config.active };
    if (id === '@/components/motion/pressable-scale') return { PressableScale: 'PressableScale' };
    throw new Error(`Unexpected module ${id}`);
  } });
  function render(nextSelected = props.selected) {
    props = { ...props, selected: nextSelected };
    cursor = 0; effects = [];
    tree = module.exports.Chip(props);
    for (const effect of effects) {
      slots[effect.index]?.cleanup?.();
      slots[effect.index] = { deps: effect.deps, cleanup: effect.fn() };
    }
  }
  function nodes() {
    const result: any[] = [];
    const visit = (node: any) => {
      if (Array.isArray(node)) return node.forEach(visit);
      if (!node?.props) return;
      result.push(node); visit(node.props.children);
    };
    visit(tree);
    return result;
  }
  render();
  return { config, shared, animations, cancellations, render, nodes, tree: () => tree, haptics: () => haptics, presses: () => presses, unmount: () => slots.forEach((slot) => slot?.cleanup?.()) };
}

function style(node: any) {
  return Object.assign({}, ...[node.props.style].flat(Infinity).filter(Boolean).map((value: any) => value.animatedStyle ? value.animatedStyle() : value));
}

for (const glass of [false, true]) {
  test(`Chip ${glass ? 'glass' : 'fallback'} colors follow one spring, retaining constant icon/material props and safe overshoot`, () => {
    const ui = mountChip(glass);
    assert.equal(ui.animations.length, 0, 'mount starts at the endpoint without selection animation');
    const constantLayers = () => ui.nodes().filter((node) => node.type === 'Icon' || node.type === 'GlassBackdrop').map((node) => JSON.stringify(node.props));
    const layers = constantLayers();
    ui.render(true);
    assert.equal(ui.animations.at(-1).spring, true);
    assert.equal(ui.animations.at(-1).settings.stiffness, 360);
    assert.equal(ui.animations.at(-1).settings.damping, 26);
    assert.equal(ui.animations.at(-1).settings.mass, 1);
    assert.equal(ui.animations.at(-1).settings.velocity, undefined, 'the caller does not force velocity back to zero');
    assert.equal(ui.animations.at(-1).settings.reduceMotion, 'system');
    assert.equal(ui.shared[0].get(), 0, 'selection props do not jump ahead of the pending animation');
    ui.shared[0].value = 0.45;
    const label = ui.nodes().find((node) => node.type === 'Animated.Text' && node.props.children === 'Eletrônicos completos');
    assert.equal(style(label).color, 'blend(text,on-tint,0.45)');
    const iconLayers = ui.nodes().filter((node) => node.props.children?.type === 'Icon');
    assert.equal(style(iconLayers[0]).opacity, 0.55);
    assert.equal(style(iconLayers[1]).opacity, 0.45);
    assert.equal(iconLayers[0].props.children.props.tint, 'category-ink');
    assert.equal(iconLayers[1].props.children.props.color, 'onTint');
    assert.equal(iconLayers[1].props.children.props.tint, undefined);
    const surface = ui.nodes().find((node) => node.type === 'Animated.View');
    assert.equal(style(surface).borderColor, 'blend(border,transparent,0.45)');
    assert.equal(style(surface).backgroundColor, glass ? 'transparent' : 'blend(element,fill,0.45)');
    assert.equal(style(surface).transform[0].scale, 1, 'ordinary progress does not shrink or grow the label');
    if (glass) {
      const materials = ui.nodes().filter((node) => node.props.children?.type === 'GlassBackdrop');
      assert.equal(style(materials[0]).opacity, 0.55);
      assert.equal(style(materials[1]).opacity, 0.45);
    }
    assert.deepEqual(constantLayers(), layers);
    const interrupted = ui.animations.at(-1);
    ui.render(false);
    assert.equal(interrupted.canceled, true);
    assert.equal(ui.cancellations.length, 0, 'retarget leaves the previous spring available to Reanimated');
    assert.equal(ui.animations.at(-1).from, 0.45);
    assert.equal(ui.animations.at(-1).target, 0);
    assert.deepEqual(constantLayers(), layers);

    for (const [progress, endpoint, scale] of [[1.05, 1, 1.01], [-0.05, 0, 0.99]]) {
      ui.shared[0].value = progress;
      assert.equal(style(label).color, endpoint ? 'on-tint' : 'text');
      assert.equal(style(surface).borderColor, endpoint ? 'transparent' : 'border');
      assert.equal(style(surface).backgroundColor, glass ? 'transparent' : endpoint ? 'fill' : 'element');
      assert.ok(Math.abs(style(surface).transform[0].scale - scale) < 1e-10);
      for (const node of ui.nodes().filter((node) => node.props.children?.type === 'Icon' || node.props.children?.type === 'GlassBackdrop')) {
        assert.ok(style(node).opacity === 0 || style(node).opacity === 1, 'native layers never receive extrapolated opacity');
      }
      const badge = ui.nodes().find((node) => node.type === 'Animated.View' && node.props.children?.type === 'Animated.Text');
      assert.equal(style(badge).backgroundColor, endpoint ? 'overlay' : 'badge');
      assert.equal(style(badge.props.children).color, endpoint ? 'on-tint' : 'secondary');
      ui.render(Boolean(endpoint));
      assert.equal(ui.animations.at(-1).from, progress, 'overshoot retarget uses the actual current numeric value');
      assert.equal(ui.cancellations.length, 0);
      assert.deepEqual(constantLayers(), layers);
    }
    for (const progress of [0, 1]) {
      ui.shared[0].value = progress;
      assert.equal(style(surface).transform[0].scale, 1, 'both settled endpoints retain original geometry');
    }
    const reversing = ui.animations.at(-1);
    ui.config.reduced = true; ui.render();
    assert.equal(reversing.canceled, true);
    assert.equal(ui.shared[0].get(), 0);
    ui.render(true);
    assert.equal(ui.shared[0].get(), 1);
    assert.equal(ui.animations.at(-1), reversing, 'reduced selection creates no animation');
    const reducedSurface = ui.nodes().find((node) => node.type === 'Animated.View');
    ui.shared[0].value = 1.05;
    assert.equal(style(reducedSurface).transform[0].scale, 1, 'ReduceMotion suppresses spatial overshoot');
  });
}

test('Chip preserves full keyed labels, selection/disabled semantics and one synchronous haptic/callback', () => {
  const ui = mountChip(true, true);
  assert.equal(ui.animations.length, 0);
  assert.equal(ui.shared[0].get(), 1, 'initial selected state starts at the correct endpoint');
  const animationCount = ui.animations.length;
  ui.config.fontScale = 1.4; ui.render();
  assert.equal(ui.animations.length, animationCount, 'label remeasurement does not trigger selection timing');
  const label = ui.nodes().find((node) => node.type === 'Animated.Text' && node.props.children === 'Eletrônicos completos');
  assert.equal(label.key, 'rotulo:1.4');
  assert.equal(style(label).flexShrink, 0);
  assert.equal(label.props.numberOfLines, undefined);
  assert.equal(label.props.adjustsFontSizeToFit, undefined);
  assert.equal(ui.tree().props.accessibilityLabel, 'Eletrônicos completos, 3');
  assert.equal(ui.tree().props.accessibilityState.selected, true);
  assert.equal(ui.tree().props.scaleTo, 1);
  ui.tree().props.onPressIn();
  assert.equal(ui.animations.at(-1).timing, true);
  assert.equal(ui.animations.at(-1).settings.duration, 120);
  ui.tree().props.onPressOut();
  const pendingPress = ui.animations.at(-1);
  assert.equal(pendingPress.timing, true);
  assert.equal(pendingPress.settings.duration, 200);
  ui.tree().props.onPress();
  assert.equal(ui.haptics(), 1); assert.equal(ui.presses(), 1);
  ui.config.active = false; ui.render();
  assert.equal(ui.tree().props.disabled, true);
  assert.equal(ui.tree().props.accessibilityState.disabled, true);
  ui.tree().props.onPress();
  assert.equal(ui.haptics(), 1); assert.equal(ui.presses(), 1);
  ui.render(false);
  const pendingSelection = ui.animations.at(-1);
  ui.unmount();
  assert.equal(pendingSelection.canceled, true);
  assert.equal(pendingPress.canceled, true);
});
