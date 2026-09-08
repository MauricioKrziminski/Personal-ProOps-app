import assert from 'node:assert/strict';
import test from 'node:test';

import { parseAapt2Badging } from './parse-aapt2-badging.mjs';

test('extrai pacote e versões da saída real do aapt2', () => {
  const output = [
    "package: name='com.proops.personal' versionCode='2' versionName='1.0.0' platformBuildVersionName='16' compileSdkVersion='36'",
    "minSdkVersion:'24'",
  ].join('\n');

  assert.deepEqual(parseAapt2Badging(output), {
    applicationId: 'com.proops.personal',
    versionCode: '2',
    versionName: '1.0.0',
  });
});

test('tolera atributos extras e ordem diferente', () => {
  const output =
    "package: versionName='1.2.3' compileSdkVersion='36' name='com.proops.personal' versionCode='42'";

  assert.deepEqual(parseAapt2Badging(output), {
    applicationId: 'com.proops.personal',
    versionCode: '42',
    versionName: '1.2.3',
  });
});

test('recusa saída sem a linha package ou sem campo obrigatório', () => {
  assert.throws(() => parseAapt2Badging('<html>erro</html>'), /linha package/);
  assert.throws(
    () => parseAapt2Badging("package: name='com.proops.personal' versionCode='2'"),
    /versionName/,
  );
});

test('recusa atributos duplicados em vez de escolher silenciosamente', () => {
  assert.throws(
    () =>
      parseAapt2Badging(
        "package: name='com.proops.personal' name='com.example.fake' versionCode='2' versionName='1.0.0'",
      ),
    /duplicado: name/,
  );
});
