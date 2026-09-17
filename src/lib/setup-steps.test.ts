import assert from 'node:assert/strict';
import { test } from 'node:test';

import { passosDeConfiguracao, progresso } from './setup-steps.ts';

test('usuário novo tem os três passos abertos', () => {
  const passos = passosDeConfiguracao({ telefone: null, contas: 0, temLancamento: false });
  assert.deepEqual(passos.map((p) => p.id), ['whatsapp', 'conta', 'lancamento']);
  assert.deepEqual(progresso(passos), { feitos: 0, total: 3, completo: false });
});

test('telefone em branco não conta como WhatsApp ligado', () => {
  const [whatsapp] = passosDeConfiguracao({ telefone: '   ', contas: 0, temLancamento: false });
  assert.equal(whatsapp.feito, false);
});

test('com tudo feito o progresso é completo', () => {
  const passos = passosDeConfiguracao({ telefone: '+5511999999999', contas: 2, temLancamento: true });
  assert.deepEqual(progresso(passos), { feitos: 3, total: 3, completo: true });
});
