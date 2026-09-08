const fs = require('node:fs/promises');
const path = require('node:path');

const { AndroidConfig, withAndroidManifest, withDangerousMod } = require('expo/config-plugins');

const INSTALL_PERMISSION = 'android.permission.REQUEST_INSTALL_PACKAGES';
const PROVIDER_AUTHORITY = '${applicationId}.apkInstaller';
const PATHS_XML = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<paths xmlns:android="http://schemas.android.com/apk/res/android">',
  '  <cache-path name="apk_updates" path="apk-updates/" />',
  '</paths>',
  '',
].join('\n');

function configureAndroidManifest(androidManifest) {
  AndroidConfig.Permissions.ensurePermission(androidManifest, INSTALL_PERMISSION);

  const application = AndroidConfig.Manifest.getMainApplicationOrThrow(androidManifest);
  const providers = application.provider ?? [];
  const provider = {
    $: {
      'android:name': 'androidx.core.content.FileProvider',
      'android:authorities': PROVIDER_AUTHORITY,
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
  };
  const existingIndex = providers.findIndex(
    (entry) => entry.$?.['android:authorities'] === PROVIDER_AUTHORITY
  );

  if (existingIndex >= 0) providers[existingIndex] = provider;
  else providers.push(provider);

  application.provider = providers;
  return androidManifest;
}

async function writeApkInstallerPaths(projectRoot) {
  const outputPath = path.join(
    projectRoot,
    'android/app/src/main/res/xml/apk_installer_paths.xml'
  );
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, PATHS_XML, 'utf8');
}

const withApkInstaller = (config) => {
  config = withAndroidManifest(config, (modConfig) => {
    modConfig.modResults = configureAndroidManifest(modConfig.modResults);
    return modConfig;
  });

  return withDangerousMod(config, [
    'android',
    async (modConfig) => {
      await writeApkInstallerPaths(modConfig.modRequest.projectRoot);
      return modConfig;
    },
  ]);
};

module.exports = withApkInstaller;
module.exports.configureAndroidManifest = configureAndroidManifest;
module.exports.writeApkInstallerPaths = writeApkInstallerPaths;
