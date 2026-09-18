import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('tablet authentication keeps the form and actions in one centered task', () => {
  const source = readFileSync('src/components/auth/auth-screen.tsx', 'utf8');
  assert.match(source, /classifyWindow\(width\) !== 'compact'/);
  assert.match(source, /tablet && styles\.tabletContent/);
  assert.match(source, /tablet && styles\.tabletFooter/);
  assert.match(source, /tabletFooter: \{ marginTop: 0 \}/);
  assert.match(source, /footer: \{[^}]*marginTop: "auto"/);
});
