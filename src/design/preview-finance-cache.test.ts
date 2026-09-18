import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QueryClient } from '@tanstack/react-query';

import { seedFinancePeriodPreview } from './preview-finance-cache.ts';

test('preview seeds the period queries Finance actually requests', () => {
  const client = new QueryClient();
  seedFinancePeriodPreview(client, {
    month: '2026-09',
    previousMonth: '2026-08',
    lastDate: '2026-09-30',
    previousLastDate: '2026-08-31',
    daysLeft: 13,
  });

  assert.ok(client.getQueryData(['cycle', 'cycle']));
  assert.deepEqual(client.getQueryData(['cycle-range', '2026-09', 'cycle']), {
    de: '2026-09-01', ate: '2026-09-30',
  });
  assert.deepEqual(client.getQueryData(['cycle-range', '2026-08', 'cycle']), {
    de: '2026-08-01', ate: '2026-08-31',
  });
  const series = client.getQueryData<unknown[]>(['cycle-series', '2026-08', '2026-09', 'cycle']);
  assert.equal(series?.length, 2);
});
