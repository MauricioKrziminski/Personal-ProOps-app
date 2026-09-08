import assert from 'node:assert/strict';
import { test } from 'node:test';

import { alertChannelLabel, combineAlertDeliveries } from './alert-history.ts';

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
