import assert from 'node:assert/strict';

/** Read compiled APK values, including Expo's runtime string resource. */
export function parseApkCompatibility(xmltree, resources) {
  const nodes = [];
  const stack = [];
  for (const line of xmltree.split('\n')) {
    const element = line.match(/^(\s*)E: ([\w-]+)/);
    if (element) {
      const indent = element[1].length;
      while (stack.length && stack.at(-1).indent >= indent) stack.pop();
      const node = { name: element[2], indent, parent: stack.at(-1), attrs: {} };
      nodes.push(node);
      stack.push(node);
      continue;
    }
    const attr = line.match(/^\s*A: (?:http:\/\/schemas\.android\.com\/apk\/res\/android:)?([\w]+)(?:\(0x[\da-f]+\))?=(.*)$/i);
    if (attr && stack.length) {
      assert.ok(!Object.hasOwn(stack.at(-1).attrs, attr[1]), 'Atributo APK duplicado.');
      stack.at(-1).attrs[attr[1]] = attr[2];
    }
  }
  const resolve = (value) => {
    assert.equal(typeof value, 'string', 'Valor obrigatório ausente no APK.');
    const literal = value.match(/^"(.*)" \(Raw: ".*"\)$/) ?? value.match(/^"(.*)"$/);
    if (literal) return literal[1];
    if (value === 'true' || value === 'false') return value === 'true';
    assert.match(value, /^@0x[\da-f]{8}$/i, 'Valor APK não suportado.');
    const id = value.slice(1);
    const lines = resources.split('\n');
    const indices = lines.flatMap((line, index) => line.trim().startsWith(`resource ${id} `) ? [index] : []);
    assert.equal(indices.length, 1, 'Resource APK ausente ou duplicado.');
    const values = [];
    for (let i = indices[0] + 1; i < lines.length; i++) {
      if (/^\s*(resource |type |Package )/.test(lines[i])) break;
      if (lines[i].trim()) values.push(lines[i].trim());
    }
    assert.equal(values.length, 1, 'Resource APK com variantes não comprovadas.');
    const resource = values[0].match(/^\(\) "(.*)"$/);
    assert.ok(resource, 'Resource APK precisa ser string padrão.');
    return resource[1];
  };
  const manifests = nodes.filter((node) => node.name === 'manifest' && !node.parent);
  assert.equal(manifests.length, 1, 'Manifest APK inválido.');
  const manifest = manifests[0];
  const apps = nodes.filter((node) => node.name === 'application' && node.parent === manifest);
  assert.equal(apps.length, 1, 'Application APK inválida.');
  const metadata = (name) => {
    const matches = nodes.filter((node) => node.name === 'meta-data' && node.parent === apps[0] && resolve(node.attrs.name) === `expo.modules.updates.${name}`);
    assert.equal(matches.length, 1, `Metadata APK ${name} ausente ou duplicada.`);
    return resolve(matches[0].attrs.value);
  };
  const headers = JSON.parse(metadata('UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY'));
  assert.equal(typeof headers['expo-channel-name'], 'string');
  return {
    applicationId: resolve(manifest.attrs.package), appVersion: resolve(manifest.attrs.versionName),
    runtimeVersion: metadata('EXPO_RUNTIME_VERSION'), updatesUrl: metadata('EXPO_UPDATE_URL'),
    channel: headers['expo-channel-name'], updatesEnabled: metadata('ENABLED'),
  };
}

export function attestLocalNativeBuild(receipt, apk, apkSha256, provenance) {
  for (const key of ['applicationId', 'runtimeVersion', 'updatesUrl', 'channel']) {
    assert.equal(apk[key], receipt[key], `APK ${key} divergente.`);
  }
  assert.equal(apk.appVersion, receipt.runtimeVersion);
  assert.equal(apk.updatesEnabled, true);
  assert.equal(apk.updatesUrl, `https://u.expo.dev/${receipt.projectId}`);
  assert.match(provenance.sourceCommit, /^[a-f0-9]{40}$/);
  assert.equal(provenance.sourceCommit, receipt.sourceCommit);
  assert.match(provenance.runId, /^[1-9]\d*$/);
  assert.match(provenance.runAttempt, /^[1-9]\d*$/);
  assert.match(apkSha256, /^[a-f0-9]{64}$/);
  return { ...receipt, build: {
    provider: 'github-actions-local', id: `${provenance.runId}/${provenance.runAttempt}`,
    ...provenance, ...apk, projectId: receipt.projectId, apkSha256,
  } };
}
