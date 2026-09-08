import assert from 'node:assert/strict';
import test from 'node:test';
import { hasCompletedOnboarding } from './onboarding.ts';

test('only an explicit persisted completion skips initial preferences', () => {
  for (const metadata of [undefined, {}, { onboarding_completed: false }, { onboarding_completed: 'true' }, { display_name: 'Ana' }]) {
    assert.equal(hasCompletedOnboarding(metadata), false);
  }
  assert.equal(hasCompletedOnboarding({ onboarding_completed: true }), true);
});

test('completion belongs to the current account, not the device', () => {
  const accounts = [{ onboarding_completed: true }, {}, { onboarding_completed: true }];
  assert.deepEqual(accounts.map(hasCompletedOnboarding), [true, false, true]);
});
