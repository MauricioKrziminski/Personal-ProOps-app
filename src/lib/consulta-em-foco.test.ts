import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { QueryClient, QueryObserver } from '@tanstack/query-core';
import ts from 'typescript';

/** Carrega o wrapper de verdade, com o TanStack e o foco como dublês que só devolvem as opções. */
function carregar(emFoco: () => boolean) {
  const module = { exports: {} as any };
  const code = ts.transpileModule(readFileSync('src/lib/consulta-em-foco.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'module', 'exports', code)((name: string) => {
    if (name === '@tanstack/react-query') return { useQuery: (o: any) => o, useInfiniteQuery: (o: any) => o };
    if (name === 'expo-router') return { useIsFocused: emFoco };
    throw new Error(name);
  }, module, module.exports);
  return module.exports;
}

test('tela em foco assina o cache; fora de foco não assina; quem já pede subscribed:false continua sem', () => {
  let foco = true;
  const { useQuery, useInfiniteQuery } = carregar(() => foco);
  assert.equal(useQuery({ queryKey: ['a'] }).subscribed, true);
  assert.equal(useInfiniteQuery({ queryKey: ['a'] }).subscribed, true);
  foco = false;
  assert.equal(useQuery({ queryKey: ['a'] }).subscribed, false);
  assert.equal(useInfiniteQuery({ queryKey: ['a'] }).subscribed, false);
  foco = true;
  assert.equal(useQuery({ queryKey: ['a'], subscribed: false }).subscribed, false);
  // O resto das opções passa intacto.
  assert.equal(useQuery({ queryKey: ['a'], staleTime: 7 }).staleTime, 7);
});

test('o TanStack instalado honra `subscribed` (o wrapper depende disso)', () => {
  const fonte = readFileSync('node_modules/@tanstack/react-query/build/modern/useBaseQuery.js', 'utf8');
  assert.match(fonte, /options\.subscribed !== false/);
});

test('fora de foco a invalidação só marca velha; ao focar o que ficou velho refaz, e o que não ficou não', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000, retry: false } } });
  let leituras = 0;
  let outras = 0;
  const opcoes = (chave: string, contar: () => number) => ({ queryKey: [chave], queryFn: async () => contar() });
  const velha = new QueryObserver(client, opcoes('saldo', () => ++leituras));
  const intacta = new QueryObserver(client, opcoes('outra', () => ++outras));
  const tique = () => new Promise((r) => setTimeout(r, 0));
  let desassinar = [velha.subscribe(() => {}), intacta.subscribe(() => {})];
  await tique();
  assert.equal(leituras, 1);
  await client.invalidateQueries({ queryKey: ['saldo'] }); // em foco: refaz na hora
  assert.equal(leituras, 2);
  assert.equal(outras, 1);

  // Sai de foco: o observer sai do cache (é o que `subscribed: false` faz no hook).
  desassinar.forEach((f) => f());
  await client.invalidateQueries({ queryKey: ['saldo'] });
  assert.equal(leituras, 2, 'fora de foco a invalidação não refaz');
  assert.equal(client.getQueryData(['saldo']), 2, 'o dado antigo continua no cache para a tela mostrar');

  // Volta ao foco: só a invalidada refaz; a outra está fresca.
  desassinar = [velha.subscribe(() => {}), intacta.subscribe(() => {})];
  await tique();
  assert.equal(leituras, 3, 'ao focar o que ficou velho refaz');
  assert.equal(outras, 1, 'o que não foi invalidado não refaz ao focar');
  desassinar.forEach((f) => f());
  client.clear();
});

test('nenhum hook ou tela importa useQuery/useInfiniteQuery direto do TanStack', () => {
  const arquivos = execSync(`grep -rlE "\\b(useQuery|useInfiniteQuery|useQueries)\\b" src`, { encoding: 'utf8' })
    .trim().split('\n').filter((f) => !f.includes('.test.') && !f.endsWith('consulta-em-foco.ts'));
  for (const arquivo of arquivos) {
    const fonte = readFileSync(arquivo, 'utf8');
    // `useQueries` não passa pelo wrapper: quem o usa assina por `subscribed` à mão.
    if (/\buseQueries\(/.test(fonte)) assert.match(fonte, /subscribed:\s*emFoco/, `${arquivo}: useQueries sem subscribed`);
    const importacao = fonte.match(/import\s*\{([^}]*)\}\s*from '@tanstack\/react-query'/);
    const nomes = (importacao?.[1] ?? '').split(',').map((n) => n.trim());
    assert.ok(!nomes.includes('useQuery') && !nomes.includes('useInfiniteQuery'),
      `${arquivo}: importe de '@/lib/consulta-em-foco' — o TanStack direto refaz consulta de tela fora de foco`);
  }
});
