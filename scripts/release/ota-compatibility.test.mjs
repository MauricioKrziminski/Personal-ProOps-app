import test from 'node:test';
import assert from 'node:assert/strict';
import { publishCompatibleUpdate } from './ota-compatibility.mjs';
const base = { schema: 1, sourceCommit: 'a'.repeat(40), runtimeVersion: '1.0.0', fingerprint: 'native-hash', fingerprintVersion: '0.20.10', publicEnvironmentHash: 'environment-hash', platform: 'android', environment: 'production', channel: 'production', variant: 'production', applicationId: 'com.proops.personal', projectId: 'project-id', updatesUrl: 'https://u.expo.dev/project-id' };
base.build = { id: 'build-id', sourceCommit: base.sourceCommit, runtimeVersion: base.runtimeVersion, channel: base.channel, applicationId: base.applicationId, projectId: base.projectId, apkSha256: 'c'.repeat(64) };
const reference = { tag: 'v1.0.0', sourceCommit: base.sourceCommit };
test('compatible JS update reaches publication once without rebuilding', async () => {
  let calls = 0;
  await publishCompatibleUpdate(base, { ...base, sourceCommit: 'b'.repeat(40) }, reference, () => calls++);
  assert.equal(calls, 1);
});
for (const patch of [{ fingerprint: 'changed-native-code' }, { runtimeVersion: '1.0.1' }, { environment: 'preview' }, { channel: 'staging' }, { applicationId: 'com.proops.personal.dev' }, { publicEnvironmentHash: 'changed-backend' }, { fingerprintVersion: 'new-tool' }]) {
  test(`incompatible ${Object.keys(patch)[0]} never publishes`, async () => {
    let calls = 0;
    await assert.rejects(publishCompatibleUpdate(base, { ...base, ...patch }, reference, () => calls++));
    assert.equal(calls, 0);
  });
}
test('missing receipt, wrong source or tag fail closed', async () => {
  for (const [receipt, ref] of [[{}, reference], [base, { ...reference, sourceCommit: 'b'.repeat(40) }], [base, { ...reference, tag: '--bad' }]]) {
    let calls = 0;
    await assert.rejects(publishCompatibleUpdate(receipt, base, ref, () => calls++));
    assert.equal(calls, 0);
  }
});

for (const path of ['package.json', 'package-lock.json', 'app.json', 'app.config.js', 'eas.json', 'plugins/with-native.js', 'modules/example/index.ts', 'android/app/src/Main.kt', '.fingerprintignore', 'fingerprint.config.js']) {
  test(`changed native source ${path} blocks even an unchanged fingerprint`, async () => {
    let calls = 0;
    await assert.rejects(publishCompatibleUpdate(base, base, { ...reference, changedFiles: [path] }, () => calls++));
    assert.equal(calls, 0);
  });
}
test('JS and documentation changes preserve the publication path', async () => {
  let calls = 0;
  await publishCompatibleUpdate(base, base, { ...reference, changedFiles: ['src/app/onboarding.tsx', 'docs/bugs/report.md'] }, () => calls++);
  assert.equal(calls, 1);
});

test('unattested source receipt never authorizes publication', async () => {
  let calls = 0;
  const receipt = { ...base }; delete receipt.build;
  await assert.rejects(publishCompatibleUpdate(receipt, base, reference, () => calls++));
  assert.equal(calls, 0);
});
