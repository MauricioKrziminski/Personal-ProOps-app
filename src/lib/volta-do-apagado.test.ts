import assert from 'node:assert/strict';
import { test } from 'node:test';

import { telasParaSairDoApagado } from './volta-do-apagado.ts';

const detalhe = (txId: string) => ({ name: 'finance/[txId]', params: { txId } });

test('formulário aberto pelo detalhe do mesmo lançamento sai das duas telas', () => {
  const rotas = [{ name: '(tabs)' }, detalhe('a'), { name: 'finance/lancar', params: { id: 'a' } }];
  assert.equal(telasParaSairDoApagado(rotas, 2, 'a'), 2);
});

test('aberto da lista, ou do detalhe de OUTRO lançamento, sai de uma só', () => {
  assert.equal(telasParaSairDoApagado([{ name: '(tabs)' }, { name: 'finance/lancar' }], 1, 'a'), 1);
  assert.equal(telasParaSairDoApagado([detalhe('b'), { name: 'finance/lancar' }], 1, 'a'), 1);
  assert.equal(telasParaSairDoApagado([{ name: 'finance/lancar' }], 0, 'a'), 1);
});

test('apagar pelo formulário fecha por promessa (sobrevive ao desmonte) e decide a saída antes de apagar', async () => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const form = readFileSync(join(import.meta.dirname, '..', 'components/finance/formulario-do-lancamento.tsx'), 'utf8');
  assert.match(form, /remove\.mutateAsync\(editing\.id\)\.then\(/);
  assert.doesNotMatch(form, /remove\.mutate\(editing\.id/);
  assert.ok(form.indexOf('decidirSaida();') < form.indexOf('apagar(alvo)'), 'a saída é decidida antes de apagar');
  const hook = readFileSync(join(import.meta.dirname, '..', 'hooks/use-apagar-com-alcance.ts'), 'utf8');
  assert.match(hook, /escrita\.mutateAsync\(\{ alvo, alcance \}\)\.then\(/);
});
