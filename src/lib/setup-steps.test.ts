import assert from 'node:assert/strict';
import { test } from 'node:test';

import { passosDeConfiguracao, progresso } from './setup-steps.ts';

const novo = { telefone: null, contas: 0, temLancamento: false, abriuOGuia: false };

test('usuário novo tem os quatro passos abertos, e o último é conhecer o app', () => {
  const passos = passosDeConfiguracao(novo);
  assert.deepEqual(passos.map((p) => p.id), ['whatsapp', 'conta', 'lancamento', 'guia']);
  assert.equal(passos[3].href, '/guia');
  assert.deepEqual(progresso(passos), { feitos: 0, total: 4, completo: false });
});

test('telefone em branco não conta como WhatsApp ligado', () => {
  const [whatsapp] = passosDeConfiguracao({ ...novo, telefone: '   ' });
  assert.equal(whatsapp.feito, false);
});

test('abrir o guia marca "Conhecer o app"', () => {
  const passos = passosDeConfiguracao({ ...novo, abriuOGuia: true });
  assert.equal(passos.find((p) => p.id === 'guia')!.feito, true);
});

test('com tudo feito o progresso é completo', () => {
  const passos = passosDeConfiguracao({ telefone: '+5511999999999', contas: 2, temLancamento: true, abriuOGuia: true });
  assert.deepEqual(progresso(passos), { feitos: 4, total: 4, completo: true });
});
