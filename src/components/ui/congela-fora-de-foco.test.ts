import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

/**
 * Roda `CongelaForaDeFoco` de verdade com um `react` mínimo (valor adiado à mão) e devolve o
 * que o componente pediu ao `Freeze` a cada render.
 */
function montar() {
  const slots: any[] = [];
  let adiados: (() => void)[] = [];
  let cursor = 0;
  let focada = true;
  let precisaRenderizar = true;
  const react = {
    createContext: () => ({ Provider: 'Provider' }),
    useState: (inicial: boolean) => {
      const i = cursor++;
      if (!(i in slots)) slots[i] = inicial;
      return [slots[i], (v: boolean) => { if (slots[i] !== v) { slots[i] = v; precisaRenderizar = true; } }];
    },
    // Como o React: o render urgente enxerga o valor ANTERIOR; o novo chega num render seguinte.
    useDeferredValue: (valor: boolean) => {
      const i = cursor++;
      if (!(i in slots)) slots[i] = valor;
      const visto = slots[i];
      if (visto !== valor) adiados.push(() => { slots[i] = valor; precisaRenderizar = true; });
      return visto;
    },
  };
  const module = { exports: {} as any };
  const code = ts.transpileModule(readFileSync('src/components/ui/congela-fora-de-foco.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  new Function('require', 'module', 'exports', code)((nome: string) => {
    if (nome === 'react') return react;
    if (nome === 'expo-router') return { useIsFocused: () => focada };
    if (nome === 'react-freeze') return { Freeze: 'Freeze' };
    if (nome === 'react/jsx-runtime') return { jsx: (type: any, props: any) => ({ type, props }), jsxs: (type: any, props: any) => ({ type, props }) };
    throw new Error(nome);
  }, module, module.exports);
  const historico: boolean[] = [];
  /** Renderiza até assentar (o valor adiado pede outro render). */
  const assentar = () => {
    for (let n = 0; n < 5 && precisaRenderizar; n++) {
      precisaRenderizar = false; cursor = 0; adiados = [];
      const arvore = module.exports.CongelaForaDeFoco({ children: 'filho' });
      historico.push(arvore.props.children.props.freeze);
      for (const aplicar of adiados) aplicar();
    }
  };
  return {
    historico,
    assentar,
    mudarFoco(valor: boolean) { focada = valor; precisaRenderizar = true; },
  };
}

test('aba que perde o foco renderiza UM render sem congelar (as consultas saem do cache) e só então congela', () => {
  const aba = montar();
  aba.assentar();
  assert.deepEqual(aba.historico, [false], 'em foco: descongelada');
  aba.historico.length = 0;
  aba.mudarFoco(false);
  aba.assentar();
  assert.deepEqual(aba.historico, [false, true], 'perdeu o foco: um render ainda descongelado, depois congela');
});

test('voltar ao foco descongela no MESMO render, sem esperar o valor adiado', () => {
  const aba = montar();
  aba.assentar();
  aba.mudarFoco(false);
  aba.assentar();
  aba.historico.length = 0;
  aba.mudarFoco(true);
  aba.assentar();
  assert.equal(aba.historico[0], false, 'o primeiro render já é descongelado');
  assert.equal(aba.historico.at(-1), false);
});

test('a folha na raiz de uma aba não depende do foco que o render a mais enxerga', () => {
  const folha = readFileSync('src/components/ui/sheet.tsx', 'utf8');
  assert.match(folha, /const dentroDeAba = useContext\(DentroDeAbaCongelavel\)/);
  assert.match(folha, /const focused = dentroDeAba \|\| focoDaTela/);
});
