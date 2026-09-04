import assert from 'node:assert/strict';
import { test } from 'node:test';

import { extractArtifactUrl } from './extract-eas-artifact.mjs';

test('extrai o APK de um único build concluído', () => {
  const url = extractArtifactUrl([
    {
      status: 'FINISHED',
      artifacts: {
        applicationArchiveUrl: 'https://expo.dev/artifacts/eas/app.apk',
      },
    },
  ]);

  assert.equal(url, 'https://expo.dev/artifacts/eas/app.apk');
});

test('aceita a chave legada buildUrl e um objeto sem envelope de lista', () => {
  assert.equal(
    extractArtifactUrl({
      status: 'FINISHED',
      artifacts: { buildUrl: 'https://expo.dev/artifacts/eas/app.apk' },
    }),
    'https://expo.dev/artifacts/eas/app.apk',
  );
});

test('recusa saída ambígua, build incompleto e artefato inseguro', () => {
  assert.throws(() => extractArtifactUrl([]), /exatamente um build/);
  assert.throws(() => extractArtifactUrl([{}, {}]), /exatamente um build/);
  assert.throws(
    () => extractArtifactUrl({ status: 'ERRORED', artifacts: {} }),
    /não terminou/,
  );
  assert.throws(
    () =>
      extractArtifactUrl({
        status: 'FINISHED',
        artifacts: { applicationArchiveUrl: 'http://example.com/app.apk' },
      }),
    /HTTPS/,
  );
});
