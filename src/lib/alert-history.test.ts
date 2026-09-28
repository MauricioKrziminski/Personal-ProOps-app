import assert from 'node:assert/strict';
import { test } from 'node:test';

import { alertChannelLabel, alertaMaisNovo, combineAlertDeliveries, temAlertaNovo } from './alert-history.ts';

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

test('a bolinha do sino: acende com alerta mais novo que o visto, e só com ele', () => {
  assert.equal(temAlertaNovo(null, ''), false, 'sem alerta nenhum');
  assert.equal(temAlertaNovo('2026-09-28T12:00:00+00:00', ''), true, 'nunca abriu o histórico');
  assert.equal(temAlertaNovo('2026-09-28T12:00:00+00:00', '2026-09-28T12:00:00+00:00'), false);
  assert.equal(temAlertaNovo('2026-09-28T12:00:00+00:00', '2026-09-28T09:00:00-03:00'), false, 'mesmo instante, outro fuso');
  assert.equal(temAlertaNovo('2026-09-29T12:00:00+00:00', '2026-09-28T12:00:00+00:00'), true);
});

test('abrir o histórico marca o mais novo da lista, fora de ordem ou não', () => {
  assert.equal(alertaMaisNovo([]), null);
  assert.equal(
    alertaMaisNovo([{ created_at: '2026-09-27T12:00:00Z' }, { created_at: '2026-09-28T12:00:00Z' }, { created_at: '2026-09-26T12:00:00Z' }]),
    '2026-09-28T12:00:00Z',
  );
});
