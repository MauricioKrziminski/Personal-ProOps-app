import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

/**
 * A loja das dicas (`hooks/use-dicas.ts`) lê o aparelho UMA vez por usuário, e a leitura é
 * assíncrona. Abrir o app direto num link (o extrato de uma conta, o guia) faz a tela pedir uma
 * mudança ANTES de o disco responder — e ela não pode se perder nem apagar o que já estava gravado.
 */
function transpilar(caminho: string) {
  return ts.transpileModule(readFileSync(new URL(caminho, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

function carregar(gravado: string | null) {
  const disco = new Map<string, string>();
  if (gravado !== null) disco.set('dicas:u1', gravado);
  const gravacoes: string[] = [];
  let responder: () => void = () => {};
  const asyncStorage = {
    getItem: (k: string) => new Promise<string | null>((ok) => { responder = () => ok(disco.get(k) ?? null); }),
    setItem: async (k: string, v: string) => { disco.set(k, v); gravacoes.push(v); },
  };
  const lib = { exports: {} as any };
  runInNewContext(transpilar('./dicas.ts'), { module: lib, exports: lib.exports });
  const mod = { exports: {} as any };
  runInNewContext(transpilar('../hooks/use-dicas.ts'), {
    module: mod,
    exports: mod.exports,
    require: (nome: string) => {
      if (nome === '@react-native-async-storage/async-storage') return { default: asyncStorage, __esModule: true };
      if (nome === 'react') return { useEffect: (fn: () => void) => { fn(); }, useSyncExternalStore: (_: unknown, ler: () => unknown) => ler() };
      if (nome === '@/hooks/use-session') return { useSession: () => ({ session: { user: { id: 'u1' } } }) };
      if (nome === '@/lib/dicas') return lib.exports;
      throw new Error(`módulo inesperado: ${nome}`);
    },
  });
  return { api: mod.exports, disco, gravacoes, responder: () => responder() };
}

const esperar = () => new Promise((r) => setTimeout(r, 0));

test('usar antes de o disco responder não se perde, nem apaga o que já estava encerrado', async () => {
  const { api, disco, responder } = carregar(JSON.stringify({ encerradas: ['hoje-painel'], guia: false }));
  assert.equal(api.useGuiaAberto(), undefined, 'o disco ainda não respondeu');
  api.usarDica('hoje-contas');
  api.marcarGuiaAberto();
  responder();
  await esperar();
  assert.equal(api.useGuiaAberto(), true);
  const salvo = JSON.parse(disco.get('dicas:u1')!);
  assert.deepEqual([...salvo.encerradas].sort(), ['hoje-contas', 'hoje-painel']);
  assert.equal(salvo.guia, true);
});

test('sem nada gravado e sem mudança pendente, ler não grava nada', async () => {
  const { api, gravacoes, responder } = carregar(null);
  api.useGuiaAberto();
  responder();
  await esperar();
  assert.equal(api.useGuiaAberto(), false);
  assert.deepEqual(gravacoes, []);
});
