import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  assertExpectedSigner,
  extractSignerDigests,
  normalizeFingerprint,
} from './verify-apk-signature.mjs';

const expected = 'B3:1D:4D:8D:59:AC:82:F5:58:BD:5B:22:FE:C8:9A:1C:37:64:91:CF:1B:5F:17:D8:B9:EF:C4:09:8B:6F:BD:DA';
const compactExpected = expected.replaceAll(':', '').toLowerCase();

test('normaliza impressões com ou sem separadores', () => {
  assert.equal(normalizeFingerprint(expected), compactExpected);
  assert.equal(normalizeFingerprint(compactExpected.toUpperCase()), compactExpected);
});

test('extrai somente o certificado dos signers do APK', () => {
  const output = [
    'Verifies',
    `Signer #1 certificate SHA-256 digest: ${compactExpected}`,
    `Source Stamp Signer certificate SHA-256 digest: ${'f'.repeat(64)}`,
  ].join('\n');

  assert.deepEqual(extractSignerDigests(output), [compactExpected]);
});

test('aceita exatamente o signer esperado e recusa chave diferente ou múltipla', () => {
  assert.doesNotThrow(() => assertExpectedSigner([compactExpected], expected));
  assert.throws(() => assertExpectedSigner(['f'.repeat(64)], expected), /esperada/);
  assert.throws(
    () => assertExpectedSigner([compactExpected, compactExpected], expected),
    /exatamente um signer/,
  );
});
