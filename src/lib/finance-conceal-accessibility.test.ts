import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);

// Native drawing/gestures stay inert; labels and the conceal formatter run production code.
function harness() {
  let concealed = false;
  const cache = new Map<string, any>();
  const gesture = new Proxy({}, { get: () => () => gesture });
  const animation = { duration: () => animation };
  const react = {
    createContext: () => ({ Provider: 'Provider' }),
    useContext: () => ({ concealed, ready: true, toggle() {} }),
    useCallback: (fn: any) => fn,
    useMemo: (fn: any) => fn(),
    useState: (value: any) => [value, () => {}],
    useEffect() {},
  };
  function load(path: string): any {
    if (cache.has(path)) return cache.get(path);
    const module = { exports: {} };
    const code = ts.transpileModule(readFileSync(path, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    runInNewContext(code, { module, exports: module.exports, require: (name: string) => {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return require(name);
      if (name === '@react-native-async-storage/async-storage') return {};
      if (name === '@/components/ui/conceal') return load('src/components/ui/conceal.tsx');
      if (name === '@/hooks/use-items') return load('src/lib/dates.ts');
      if (name === '@/lib/cycle-label') return load('src/lib/cycle-label.ts');
      if (name === '@/hooks/use-theme') return { useTheme: () => ({}) };
      if (name === 'react-native') return { View: 'View', Pressable: 'Pressable', StyleSheet: { create: (v: any) => v } };
      if (name === 'react-native-reanimated') return {
        View: 'AnimatedView', FadeIn: animation, runOnJS: (fn: any) => fn,
        useSharedValue: (value: any) => ({ get: () => value, set() {} }),
      };
      if (name === 'react-native-gesture-handler') return {
        Gesture: { Pan: () => gesture, Tap: () => gesture, Race: () => gesture }, GestureDetector: 'GestureDetector',
      };
      if (name === 'expo-haptics') return { selectionAsync() {} };
      if (name === '@/design/tokens') return { Space: {}, Radius: {}, Motion: { duration: {} } };
      if (name === '@/components/finance/month-picker') return {
        monthTitle: () => 'Outubro de 2026', monthShort: () => 'out',
      };
      if (name.startsWith('@/components/')) return new Proxy({}, { get: (_, key) => String(key) });
      throw new Error(`Unmocked dependency ${name} in ${path}`);
    } });
    cache.set(path, module.exports);
    return module.exports;
  }
  function labels(element: any): string[] {
    if (!element || typeof element !== 'object') return [];
    if (Array.isArray(element)) return element.flatMap(labels);
    if (typeof element.type === 'function') return labels(element.type(element.props));
    const props = element.props ?? {};
    return [...(props.accessibilityLabel ? [props.accessibilityLabel] : []), ...labels(props.children)];
  }
  return { load, labels, conceal: (value: boolean) => { concealed = value; } };
}

test('resumo do período oculta o total, o realizado e o ciclo para o leitor de tela e revela centavos exatos', () => {
  const h = harness();
  const { PeriodSummaryCard } = h.load('src/components/finance/period-summary-card.tsx');
  const props = { entrou: 1001, saiu: 2003, entrouPrevisto: 500, saiuPrevisto: 1000,
    nomeDoMes: 'outubro', lancamentos: 3, onAbrirCiclo() {},
    ciclo: { estado: 'fechado', resultado: -1002, caixa_no_fim: 0, faltou_pagar: 707 } };
  h.conceal(true);
  assert.deepEqual(h.labels(PeriodSummaryCard(props)), [
    'entrou ••••••, já aconteceu ••••••',
    'saiu ••••••, já aconteceu ••••••',
    'Fechei outubro devendo ••••••, por data do pagamento. Ver tudo que fecha o ciclo',
  ]);
  h.conceal(false);
  assert.deepEqual(h.labels(PeriodSummaryCard(props)).map((s) => s.replace(/\u00a0/g, ' ')), [
    'entrou R$ 10,01, já aconteceu R$ 5,01',
    'saiu R$ 20,03, já aconteceu R$ 10,03',
    'Fechei outubro devendo -R$ 7,07, por data do pagamento. Ver tudo que fecha o ciclo',
  ]);
});

test('tendência mensal respeita esconder saldo nos dois valores acessíveis e revela centavos exatos', () => {
  const h = harness();
  const { TrendCard } = h.load('src/components/finance/trend-card.tsx');
  const props = { meses: [{ month: '2026-10-01', income_cents: 1001, expense_cents: 2003,
    income_pending_cents: 0, expense_pending_cents: 0 }], janela: '6', onJanela() {} };
  h.conceal(true);
  assert.deepEqual(h.labels(TrendCard(props)), ['Outubro de 2026: entrou ••••••, saiu ••••••']);
  h.conceal(false);
  assert.deepEqual(h.labels(TrendCard(props)).map((s) => s.replace(/\u00a0/g, ' ')),
    ['Outubro de 2026: entrou R$ 10,01, saiu R$ 20,03']);
});
