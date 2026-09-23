import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);

/*
  ⚠️ **Estado que depende da cor do vidro não pode depender de o vidro pintar** (23/09/2026).
  No iPhone escuro o dia escolhido do "Meu mês" ficou invisível: a grade abre dentro de um
  `FadeIn`, o `GlassView` montado com o ancestral ainda transparente não pinta a tinta, e o número
  (em `onTint`, escuro, escolhido para a tinta CLARA) ficou sobre o vidro escuro. Medido no
  simulador: o mesmo dia escolhido depois do fade pinta certo. Quem passa `tintColor` está dizendo
  "o conteúdo foi escolhido para esta cor" — então a cor sólida vai por baixo do vidro, sempre.
*/
function renderGlass(props: Record<string, unknown>) {
  const code = ts.transpileModule(readFileSync('src/components/ui/glass-backdrop.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} as any };
  runInNewContext(code, {
    module,
    exports: module.exports,
    require: (name: string) => {
      if (name === 'react') return { createContext: (v: unknown) => ({ v }), useContext: () => true };
      if (name === 'react/jsx-runtime') return require(name);
      if (name === 'react-native') return { Platform: { OS: 'ios' }, StyleSheet: { absoluteFill: {} }, View: 'View' };
      if (name === 'expo-glass-effect') return { GlassView: 'GlassView', isGlassEffectAPIAvailable: () => true, isLiquidGlassAvailable: () => true };
      if (name === '@/constants/theme') return { Colors: { dark: { overlay: 'overlay' } } };
      if (name === '@/hooks/use-theme') return { useScheme: () => 'dark' };
      throw new Error(`módulo inesperado: ${name}`);
    },
  });
  const nodes: any[] = [];
  const visit = (n: any) => {
    if (Array.isArray(n)) return n.forEach(visit);
    if (!n?.props) return;
    nodes.push(n);
    visit(n.props.children);
  };
  visit(module.exports.GlassBackdrop(props));
  return nodes;
}

const fundo = (n: any) => [n.props.style].flat(Infinity).find((s: any) => s?.backgroundColor)?.backgroundColor;

test('vidro com tinta leva a cor sólida por baixo: o conteúdo continua legível se o vidro não pintar', () => {
  const nodes = renderGlass({ fallbackColor: 'tinta', radius: 12, tintColor: 'tinta-vidro' });
  const vidro = nodes.findIndex((n) => n.type === 'GlassView');
  const solido = nodes.findIndex((n) => n.type === 'View' && fundo(n) === 'tinta');
  assert.ok(vidro >= 0, 'o vidro continua lá');
  assert.ok(solido >= 0 && solido < vidro, 'a cor sólida vem ANTES (por baixo) do vidro');
});

test('vidro sem tinta continua só vidro — o controle comum refrata o que está atrás', () => {
  const nodes = renderGlass({ fallbackColor: 'elemento', radius: 12 });
  assert.ok(nodes.some((n) => n.type === 'GlassView'));
  assert.equal(nodes.some((n) => n.type === 'View' && fundo(n) === 'elemento'), false);
});
