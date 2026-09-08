const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const moduleRoot = __dirname;

test('registra o modulo Android local usado pelo instalador de APK', () => {
  const config = JSON.parse(
    fs.readFileSync(path.join(moduleRoot, 'expo-module.config.json'), 'utf8')
  );

  assert.deepEqual(config.platforms, ['android']);
  assert.deepEqual(config.android.modules, [
    'expo.modules.proopsapkinstaller.ProOpsApkInstallerModule',
  ]);
});

test('expoe a consulta da permissao especial e a URI segura do FileProvider', () => {
  const source = fs.readFileSync(
    path.join(
      moduleRoot,
      'android/src/main/java/expo/modules/proopsapkinstaller/ProOpsApkInstallerModule.kt'
    ),
    'utf8'
  );

  assert.match(source, /Function\("canRequestPackageInstalls"\)/);
  assert.match(source, /packageManager\.canRequestPackageInstalls\(\)/);
  assert.match(source, /Function\("getApkContentUri"\)/);
  assert.match(source, /FileProvider\.getUriForFile/);
  assert.match(source, /\.apkInstaller/);
});
