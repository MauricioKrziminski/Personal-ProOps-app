import assert from 'node:assert/strict';
import test from 'node:test';

test('next installment follows pending numbers, not the count already paid', async () => {
  const { nextPendingInstallment } = await import('./installment-progress.ts');
  const parcels = Array.from({ length: 48 }, (_, i) => ({ installment_no: i + 1, status: i < 8 ? 'cleared' : 'pending' }));
  assert.equal(nextPendingInstallment(parcels, 48), 9);
  assert.equal(nextPendingInstallment([{ installment_no: 3, status: 'cleared' }, { installment_no: 2, status: 'pending' }, { installment_no: 1, status: 'pending' }], 48), 1);
  assert.equal(nextPendingInstallment(parcels.map(p => ({ ...p, status: 'cleared' })), 48), 48);
});
