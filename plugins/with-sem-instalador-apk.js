const { withAndroidManifest } = require('expo/config-plugins');

const PERMISSION = 'android.permission.REQUEST_INSTALL_PACKAGES';

// Build de loja: a Play restringe a permissão. `tools:node="remove"` derruba a entrada mesmo que
// um módulo ou biblioteca a declare no manifest dele (o merge do Gradle respeita o marcador).
module.exports = (config) =>
  withAndroidManifest(config, (c) => {
    const manifest = c.modResults.manifest;
    manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    const perms = (manifest['uses-permission'] ?? []).filter(
      (p) => p.$['android:name'] !== PERMISSION
    );
    perms.push({ $: { 'android:name': PERMISSION, 'tools:node': 'remove' } });
    manifest['uses-permission'] = perms;
    return c;
  });
module.exports.PERMISSION = PERMISSION;
