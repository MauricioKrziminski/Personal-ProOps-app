import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

/**
 * As escolhas de visualização (régua Mês/Ciclo, horizonte, período do gráfico) sobrevivem a fechar
 * e abrir o app (`hooks/use-preferencia.ts`, 28/09/2026). Cada `carregar` é um PROCESSO novo do app
 * sobre o mesmo disco.
 */
function transpilar(caminho: string) {
  return ts.transpileModule(readFileSync(new URL(caminho, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

function carregar(disco: Map<string, string>, usuario = 'u1', { segurarDisco = false } = {}) {
  let responder: () => void = () => {};
  const asyncStorage = {
    getItem: (k: string) =>
      new Promise<string | null>((ok) => {
        responder = () => ok(disco.get(k) ?? null);
        if (!segurarDisco) responder();
      }),
    setItem: async (k: string, v: string) => {
      disco.set(k, v);
    },
  };
  const mod = { exports: {} as any };
  runInNewContext(transpilar('../hooks/use-preferencia.ts'), {
    module: mod,
    exports: mod.exports,
    require: (nome: string) => {
      if (nome === '@react-native-async-storage/async-storage') return { default: asyncStorage, __esModule: true };
      if (nome === 'react')
        return {
          useCallback: (fn: unknown) => fn,
          useSyncExternalStore: (assinar: (f: () => void) => void, ler: () => unknown) => {
            assinar(() => {});
            return ler();
          },
        };
      if (nome === '@/hooks/use-session') return { useSession: () => ({ session: { user: { id: usuario } } }) };
      throw new Error(`módulo inesperado: ${nome}`);
    },
  });
  return { api: mod.exports, responder: () => responder() };
}

const esperar = () => new Promise((r) => setTimeout(r, 0));
const REGUA = ['civil', 'cycle'] as const;

test('a régua escolhida volta no próximo processo, e cada tela tem a sua', async () => {
  const disco = new Map<string, string>();
  const a = carregar(disco);
  a.api.carregarPreferencias('u1');
  await esperar();
  const [, mudar] = a.api.usePreferencia('regua:lancamentos', 'civil', a.api.umDe(REGUA));
  mudar('cycle');
  await esperar();

  const b = carregar(disco);
  b.api.carregarPreferencias('u1');
  await esperar();
  assert.equal(b.api.usePreferencia('regua:lancamentos', 'civil', b.api.umDe(REGUA))[0], 'cycle');
  assert.equal(b.api.usePreferencia('regua:projecao', 'civil', b.api.umDe(REGUA))[0], 'civil', 'outra tela segue no padrão');
});

test('o toque antes de o disco responder vale, e não apaga o que já estava gravado', async () => {
  const disco = new Map([['prefs:u1', JSON.stringify({ 'projecao:dias': 365 })]]);
  const { api, responder } = carregar(disco, 'u1', { segurarDisco: true });
  api.carregarPreferencias('u1');
  const [, mudar] = api.usePreferencia('regua:financeiro', 'cycle', api.umDe(REGUA));
  mudar('civil');
  assert.equal(api.usePreferencia('regua:financeiro', 'cycle', api.umDe(REGUA))[0], 'civil', 'a tela já mostra o toque');
  responder();
  await esperar();
  assert.equal(api.usePreferencia('regua:financeiro', 'cycle', api.umDe(REGUA))[0], 'civil', 'o disco não desfaz o toque');
  assert.deepEqual(JSON.parse(disco.get('prefs:u1')!), { 'projecao:dias': 365, 'regua:financeiro': 'civil' });
});

test('outra conta no mesmo aparelho não herda a escolha', async () => {
  const disco = new Map([['prefs:u1', JSON.stringify({ 'regua:lancamentos': 'cycle' })]]);
  const { api } = carregar(disco, 'u2');
  api.carregarPreferencias('u2');
  await esperar();
  assert.equal(api.usePreferencia('regua:lancamentos', 'civil', api.umDe(REGUA))[0], 'civil');
});

test('valor gravado que a tela não aceita mais, ou disco corrompido, cai no padrão', async () => {
  const velho = carregar(new Map([['prefs:u1', JSON.stringify({ 'regua:lancamentos': 'fatura' })]]));
  velho.api.carregarPreferencias('u1');
  await esperar();
  assert.equal(velho.api.usePreferencia('regua:lancamentos', 'civil', velho.api.umDe(REGUA))[0], 'civil');

  const quebrado = carregar(new Map([['prefs:u1', '{nao é json']]));
  quebrado.api.carregarPreferencias('u1');
  await esperar();
  assert.equal(quebrado.api.usePreferencia('regua:lancamentos', 'civil', quebrado.api.umDe(REGUA))[0], 'civil');
});

test('mudar por FUNÇÃO lê o valor gravado na hora: duas mudanças do mesmo render valem as duas', async () => {
  // 29/09/2026, visto no emulador: "Aplicar todas" tirava as hipóteses do rascunho com funções
  // criadas no MESMO render; cada uma partia do valor daquele render e a segunda desfazia a
  // primeira — uma hipótese já salva na conta continuava no rascunho, pronta para duplicar.
  const disco = new Map<string, string>();
  const a = carregar(disco);
  a.api.carregarPreferencias('u1');
  await esperar();
  const ehTexto = (v: unknown): v is string => typeof v === 'string';
  const [, mudar] = a.api.usePreferencia('lista', 'a,b,c', ehTexto);
  mudar((antes: string) => antes.split(',').filter((x) => x !== 'a').join(','));
  mudar((antes: string) => antes.split(',').filter((x) => x !== 'b').join(','));
  assert.equal(a.api.usePreferencia('lista', 'a,b,c', ehTexto)[0], 'c');
});

test('useRascunho v2: adicionar, trocar e tirar partem do GRAVADO (duas mudanças do mesmo render valem as duas)', async () => {
  const disco = new Map<string, string>();
  const a = carregar(disco);
  a.api.carregarPreferencias('u1');
  await esperar();
  const mod = { exports: {} as any };
  runInNewContext(transpilar('../hooks/use-rascunho.ts'), {
    module: mod,
    exports: mod.exports,
    require: (nome: string) => {
      if (nome === '@/hooks/use-preferencia') return a.api;
      if (nome === '@/lib/rascunho')
        return {
          lerRascunho: (t: string) => (t ? JSON.parse(t) : { versao: 2, hipoteses: [], adiantamentos: [] }),
          gravarRascunho: (r: any) => JSON.stringify(r),
        };
      throw new Error(`módulo inesperado: ${nome}`);
    },
  });
  const h = (id: string, valor: number) => ({ id, kind: 'expense', forma: 'uma', valor_cents: valor, parcelas: 1, repete: 'monthly', conta: null, data: '2026-10-01' });
  const r0 = mod.exports.useRascunho();
  r0.adicionar(h('a', 1));
  r0.adicionar(h('b', 2));
  const r1 = mod.exports.useRascunho();
  r1.tirar('a');
  r1.trocar(h('b', 3));
  assert.deepEqual(mod.exports.useRascunho().rascunho.hipoteses.map((x: any) => [x.id, x.valor_cents]), [['b', 3]]);
  // o Desfazer devolve só o que saiu, sem duplicar o que ainda está lá
  mod.exports.useRascunho().devolver({ hipoteses: [h('a', 1), h('b', 9)], adiantamentos: [] });
  assert.deepEqual(mod.exports.useRascunho().rascunho.hipoteses.map((x: any) => [x.id, x.valor_cents]), [['b', 3], ['a', 1]]);
});
