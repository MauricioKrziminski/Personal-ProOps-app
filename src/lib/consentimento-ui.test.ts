import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);

/* A tela de consentimento renderizada com os hooks como dublês (mesma técnica de forgot-password-ui). */
function tela(consentidoEm: string | null = null) {
  const state: any[] = [];
  let cursor = 0;
  const aceites: unknown[] = [];
  const module = { exports: {} as any };
  const code = ts.transpileModule(readFileSync('src/app/consentimento.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  runInNewContext(code, { module, exports: module.exports, require: (name: string) => {
    if (name === 'react') return {
      useState(initial: any) {
        const i = cursor++;
        if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial;
        return [state[i], (v: any) => { state[i] = v; }];
      },
    };
    if (name === 'react/jsx-runtime') return require(name);
    if (name === 'react-native') return { StyleSheet: { create: (v: unknown) => v }, View: 'View', ScrollView: 'ScrollView' };
    if (name === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) };
    if (name === '@/hooks/use-consentimento') return { useAceitarTermos: () => ({ isPending: false, mutate: (v: unknown) => aceites.push(v) }), useConsentimento: () => ({ data: { terms_version: null, ai_consent_at: consentidoEm } }) };
    if (name === '@/components/ui/toast') return { useToast: () => () => {} };
    if (name === '@/lib/termos') return require('./termos.ts');
    return new Proxy({}, { get: (_, key) => String(key) });
  } });
  const Component = module.exports.default;
  let nodes: any[] = [];
  const visit = (n: any) => {
    if (Array.isArray(n)) return n.forEach(visit);
    if (!n || typeof n !== 'object' || !n.props) return;
    nodes.push(n);
    for (const v of Object.values(n.props)) visit(v);
  };
  const render = () => { cursor = 0; nodes = []; visit(Component()); };
  render();
  return {
    aceites,
    render,
    achar: (pred: (n: any) => boolean) => nodes.find(pred),
  };
}

test('consentimento: a chave de IA nasce desligada e "Concordo e continuar" aceita sem IA', () => {
  const t = tela();
  const chave = t.achar((n) => n.props.accessibilityLabel === 'Autorizar o uso de IA');
  assert.ok(chave, 'a chave existe');
  assert.equal(chave.props.value, false, 'desligada por padrão');
  t.achar((n) => n.props.label === 'Concordo e continuar').props.onPress();
  assert.deepEqual(JSON.parse(JSON.stringify(t.aceites)), [{ ia: false }]);
});

test('consentimento: ligada a chave, o aceite leva ia: true', () => {
  const t = tela();
  t.achar((n) => n.props.accessibilityLabel === 'Autorizar o uso de IA').props.onValueChange(true);
  t.render();
  assert.equal(t.achar((n) => n.props.accessibilityLabel === 'Autorizar o uso de IA').props.value, true);
  t.achar((n) => n.props.label === 'Concordo e continuar').props.onPress();
  assert.deepEqual(JSON.parse(JSON.stringify(t.aceites)), [{ ia: true }]);
});

test('consentimento: a tela nomeia os três fornecedores e os dois textos legais', () => {
  const fonte = readFileSync('src/app/consentimento.tsx', 'utf8');
  for (const nome of ['Anthropic', 'Google', 'Groq', 'Termos de Uso', 'Política de Privacidade']) assert.ok(fonte.includes(nome), nome);
  assert.match(fonte, /não treinam modelos/i);
});

test('consentimento: termos novos não desligam a IA que a pessoa já tinha autorizado', () => {
  const t = tela('2026-09-01T12:00:00Z');
  const chave = t.achar((n) => n.props.accessibilityLabel === 'Autorizar o uso de IA');
  assert.equal(chave.props.value, true);
});
