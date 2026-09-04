const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

let apkInstallerPlugin = null;

try {
  apkInstallerPlugin = require('./with-apk-installer');
} catch {
  // O primeiro RED é a ausência do plugin. A asserção abaixo mantém a falha legível.
}

function manifestFixture() {
  return {
    manifest: {
      $: { 'xmlns:android': 'http://schemas.android.com/apk/res/android' },
      application: [{ $: { 'android:name': '.MainApplication' } }],
    },
  };
}

test('declara uma única permissão e um FileProvider privado para os APKs', () => {
  assert.equal(typeof apkInstallerPlugin?.configureAndroidManifest, 'function');

  const manifest = manifestFixture();
  apkInstallerPlugin.configureAndroidManifest(manifest);
  apkInstallerPlugin.configureAndroidManifest(manifest);

  const permissions = manifest.manifest['uses-permission'] ?? [];
  const installPermissions = permissions.filter(
    (permission) => permission.$['android:name'] === 'android.permission.REQUEST_INSTALL_PACKAGES'
  );
  assert.equal(installPermissions.length, 1);

  const providers = manifest.manifest.application[0].provider ?? [];
  const apkProviders = providers.filter(
    (provider) => provider.$['android:authorities'] === '${applicationId}.apkInstaller'
  );
  assert.equal(apkProviders.length, 1);
  assert.deepEqual(apkProviders[0], {
    $: {
      'android:name': 'androidx.core.content.FileProvider',
      'android:authorities': '${applicationId}.apkInstaller',
      'android:exported': 'false',
      'android:grantUriPermissions': 'true',
    },
    'meta-data': [
      {
        $: {
          'android:name': 'android.support.FILE_PROVIDER_PATHS',
          'android:resource': '@xml/apk_installer_paths',
        },
      },
    ],
  });
});

test('gera de forma idempotente um caminho restrito ao cache de atualizações', async (t) => {
  assert.equal(typeof apkInstallerPlugin?.writeApkInstallerPaths, 'function');

  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'apk-installer-plugin-'));
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));

  await apkInstallerPlugin.writeApkInstallerPaths(projectRoot);
  await apkInstallerPlugin.writeApkInstallerPaths(projectRoot);

  const output = fs.readFileSync(
    path.join(projectRoot, 'android/app/src/main/res/xml/apk_installer_paths.xml'),
    'utf8'
  );
  assert.equal(
    output,
    [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<paths xmlns:android="http://schemas.android.com/apk/res/android">',
      '  <cache-path name="apk_updates" path="apk-updates/" />',
      '</paths>',
      '',
    ].join('\n')
  );
});
