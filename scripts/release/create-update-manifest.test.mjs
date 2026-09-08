import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createUpdateManifest } from './create-update-manifest.mjs';

const validRelease = {
  versionCode: 123,
  versionName: '1.2.0',
  url: 'https://github.com/almeidagabriel01/Personal-ProOps-app-releases/releases/download/v1.2.0/personal-proops-1.2.0.apk',
  sha256: 'A'.repeat(64),
  notes: 'Melhora a atualização do app.',
};

test('gera apenas os campos do contrato e normaliza o sha256', () => {
  assert.deepEqual(createUpdateManifest(validRelease), {
    versionCode: 123,
    versionName: '1.2.0',
    url: validRelease.url,
    sha256: 'a'.repeat(64),
    notes: 'Melhora a atualização do app.',
  });
});

test('recusa versionCode que não pode representar uma versão Android válida', () => {
  for (const versionCode of [0, -1, 1.5, Number.NaN, '123']) {
    assert.throws(
      () => createUpdateManifest({ ...validRelease, versionCode }),
      /versionCode/,
    );
  }
});

test('recusa versão sem semver, download fora de HTTPS e hash inválido', () => {
  assert.throws(
    () => createUpdateManifest({ ...validRelease, versionName: 'release-final' }),
    /versionName/,
  );
  assert.throws(
    () => createUpdateManifest({ ...validRelease, url: 'http://example.com/app.apk' }),
    /url/,
  );
  assert.throws(
    () => createUpdateManifest({ ...validRelease, sha256: 'abc' }),
    /sha256/,
  );
});

test('limita as notas para manter o manifesto muito abaixo do teto lido pelo app', () => {
  assert.throws(
    () => createUpdateManifest({ ...validRelease, notes: 'x'.repeat(16_385) }),
    /notes/,
  );
});
