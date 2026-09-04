import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const hook = readFileSync(new URL('../hooks/use-push.ts', import.meta.url), 'utf8');

test('desligar aviso financeiro não apaga a capacidade de push', () => {
  assert.doesNotMatch(hook, /expo_push_token:\s*null/);
  assert.match(hook, /alerts_push_enabled/);
  assert.match(hook, /alerts_whatsapp_enabled/);
});
