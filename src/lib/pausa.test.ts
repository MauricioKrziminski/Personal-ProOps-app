import test from 'node:test';
import assert from 'node:assert/strict';
import { emPausa, fimDaPausa, foraDaPausa, rotuloDaPausa } from './pausa.ts';

test('emPausa: fim exclusivo', () => {
  assert.equal(emPausa('2026-11-05', '2026-11-05', '2027-01-05'), true);
  assert.equal(emPausa('2027-01-05', '2026-11-05', '2027-01-05'), false);
  assert.equal(emPausa('2026-11-05', null, null), false);
});

test('fimDaPausa: dias, meses, até e sem prazo', () => {
  assert.equal(fimDaPausa('2026-11-05', 'dias', 10, null), '2026-11-15');
  assert.equal(fimDaPausa('2026-01-31', 'meses', 1, null), '2026-02-28');
  assert.equal(fimDaPausa('2026-11-05', 'ate', 0, '2027-01-04'), '2027-01-05');
  assert.equal(fimDaPausa('2026-11-05', 'sem_prazo', 0, null), null);
});

test('rotuloDaPausa: dentro, futura e sem pausa', () => {
  const s = { active: true, paused_from: '2026-11-05', paused_until: '2027-01-05' };
  assert.equal(rotuloDaPausa(s, '2026-12-01'), 'Pausada até 04/01/2027');
  assert.equal(rotuloDaPausa(s, '2026-10-01'), 'Pausa de 05/11 a 04/01');
  assert.equal(rotuloDaPausa(s, '2027-02-01'), null);
  assert.equal(rotuloDaPausa({ active: true, paused_from: null, paused_until: null }, '2026-12-01'), null);
});

test('foraDaPausa: nega emPausa e tolera campos ausentes', () => {
  const r = { paused_from: '2026-11-05', paused_until: '2027-01-05' };
  assert.equal(foraDaPausa(r, '2026-12-01'), false);
  assert.equal(foraDaPausa(r, '2027-01-05'), true);
  assert.equal(foraDaPausa({}, '2026-12-01'), true);
});
