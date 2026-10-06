import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

/**
 * Roda `CongelaForaDeFoco` de verdade com um `react` mínimo (estado, efeito e timeout à mão) e devolve o
 * que o componente pediu ao `Freeze` a cada render.
 */
function montar() {
  const slots: any[] = [];
  let efeitos: (() => void)[] = [];
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
    // Efeito com deps; o `setTimeout(0)` do componente roda no fim do `assentar`, depois do render.
    useEffect: (fn: () => any, deps: any[]) => {
      const i = cursor++;
      const antigo = slots[i];
      if (antigo && antigo.deps[0] === deps[0]) return;
      efeitos.push(() => { antigo?.limpa?.(); slots[i] = { deps, limpa: fn() }; });
    },
  };
  const module = { exports: {} as any };
  const code = ts.transpileModule(readFileSync('src/components/ui/congela-fora-de-foco.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const timeouts: (() => void)[] = [];
  const setTimeoutFalso = (f: () => void) => { timeouts.push(f); return timeouts.length; };
  const clearTimeoutFalso = (id: number) => { timeouts[id - 1] = () => {}; };
  new Function('require', 'module', 'exports', 'setTimeout', 'clearTimeout', code)((nome: string) => {
    if (nome === 'react') return react;
    if (nome === 'expo-router') return { useIsFocused: () => focada };
    if (nome === 'react-freeze') return { Freeze: 'Freeze' };
    if (nome === 'react/jsx-runtime') return { jsx: (type: any, props: any) => ({ type, props }), jsxs: (type: any, props: any) => ({ type, props }) };
    throw new Error(nome);
  }, module, module.exports, setTimeoutFalso, clearTimeoutFalso);
  const historico: boolean[] = [];
  /** Renderiza até assentar (o timeout do componente pede outro render). */
  const assentar = () => {
    for (let n = 0; n < 5 && (precisaRenderizar || timeouts.length); n++) {
      precisaRenderizar = false; cursor = 0; efeitos = [];
      const arvore = module.exports.CongelaForaDeFoco({ children: 'filho' });
      historico.push(arvore.props.children.props.freeze);
      for (const rodar of efeitos) rodar();
      for (const t of timeouts.splice(0)) t();
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

test('voltar ao foco descongela no MESMO render, sem esperar o timeout', () => {
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
