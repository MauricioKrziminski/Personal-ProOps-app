import assert from 'node:assert/strict';
import { test } from 'node:test';

import { railBadge, railLabel } from './rail-badge.ts';

test('hides an empty navigation badge', () => {
  assert.equal(railBadge(0), null);
});

test('shows real pending counts and caps only the visual label', () => {
  assert.deepEqual(railBadge(4), { visual: '4', accessible: '4 pendentes' });
  assert.deepEqual(railBadge(13), { visual: '9+', accessible: '13 pendentes' });
});

test('rejects invalid pending counts instead of showing a false badge', () => {
  assert.equal(railBadge(Number.NaN), null);
  assert.equal(railBadge(-2), null);
});

test('uses a concise visible rail label while retaining the full destination name elsewhere', () => {
  assert.equal(railLabel('finance', 'Financeiro'), 'Finanças');
  assert.equal(railLabel('today', 'Hoje'), 'Hoje');
});
