import assert from 'node:assert/strict';
import { test } from 'node:test';

import { alertChannelLabel, alertaLido, alertaMaisNovo, alertaVisivel, combineAlertDeliveries, naoLidos } from './alert-history.ts';

const base = {
  id: 'push-id',
  workspace_id: 'workspace-1',
  kind: 'negative_forecast',
  ref: '2026-09-10',
  sent_on: '2026-09-04',
  channel: 'push',
  created_at: '2026-09-04T11:00:00Z',
};

test('combina o mesmo alerta entregue por push e WhatsApp', () => {
  const result = combineAlertDeliveries([
    base,
    {
      ...base,
      id: 'whatsapp-id',
      channel: 'whatsapp',
      created_at: '2026-09-04T11:00:01Z',
    },
  ]);

  assert.equal(result.length, 1);
  assert.deepEqual(result[0]?.channels, ['push', 'whatsapp']);
  assert.equal(alertChannelLabel(result[0]?.channels ?? []), 'notificação e WhatsApp');
});

test('não combina alertas de workspaces diferentes', () => {
  const result = combineAlertDeliveries([
    base,
    { ...base, id: 'outro', workspace_id: 'workspace-2', channel: 'whatsapp' },
  ]);

  assert.equal(result.length, 2);
});

test('mantém uma entrega antiga sem canal reconhecido', () => {
  const [result] = combineAlertDeliveries([{ ...base, channel: null }]);

  assert.deepEqual(result?.channels, []);
  assert.equal(alertChannelLabel(result?.channels ?? []), null);
});

test('o número do sino: visíveis e não lidos, com marco e lista nos dois lados', () => {
  const a1 = { id: 'a1', created_at: '2026-09-26T12:00:00+00:00' };
  const a2 = { id: 'a2', created_at: '2026-09-27T12:00:00+00:00' };
  const a3 = { id: 'a3', created_at: '2026-09-28T12:00:00+00:00' };
  const nada = { vistoAte: '', lidos: [], limpoAte: '', limpos: [] };
  assert.equal(naoLidos([a1, a2, a3], nada), 3, 'nunca leu nada');
  // "marcar todas como lidas" anda o marco — o mesmo instante em outro fuso também conta
  assert.equal(naoLidos([a1, a2, a3], { ...nada, vistoAte: '2026-09-28T09:00:00-03:00' }), 0);
  // "marcar como lida" uma: entra na lista
  assert.equal(alertaLido(a2, { ...nada, lidos: ['a2'] }), true);
  assert.equal(naoLidos([a1, a2, a3], { ...nada, lidos: ['a2'] }), 2);
  // limpar uma some da lista E do número, mesmo sem ter lido
  assert.equal(alertaVisivel(a3, { ...nada, limpos: ['a3'] }), false);
  assert.equal(naoLidos([a1, a2, a3], { ...nada, limpos: ['a3'] }), 2);
  // "limpar todas" anda o marco: o que chegar DEPOIS volta a contar
  const a4 = { id: 'a4', created_at: '2026-09-29T12:00:00+00:00' };
  assert.equal(naoLidos([a1, a2, a3, a4], { ...nada, limpoAte: a3.created_at }), 1);
});

test('abrir o histórico marca o mais novo da lista, fora de ordem ou não', () => {
  assert.equal(alertaMaisNovo([]), null);
  assert.equal(
    alertaMaisNovo([{ created_at: '2026-09-27T12:00:00Z' }, { created_at: '2026-09-28T12:00:00Z' }, { created_at: '2026-09-26T12:00:00Z' }]),
    '2026-09-28T12:00:00Z',
  );
});
