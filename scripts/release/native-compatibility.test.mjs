import test from 'node:test';
import assert from 'node:assert/strict';
import { productionRuntimeConfig, attestNativeBuild } from './native-compatibility.mjs';
const exp = { version: '1.2.0', runtimeVersion: { policy: 'appVersion' }, android: { package: 'com.proops.personal' }, extra: { eas: { projectId: 'project-id' } }, updates: { url: 'https://u.expo.dev/project-id' } };
const profile = { environment: 'production', channel: 'production', env: { APP_VARIANT: 'production' }, android: { buildType: 'apk' }, distribution: 'internal' };
const eas = { build: { distribution: profile } };
test('receipt identity comes from checked-in production profile and resolved Expo config', () => {
  const actual = productionRuntimeConfig(exp, eas);
  assert.equal(actual.runtimeVersion, '1.2.0');
  assert.equal(actual.channel, profile.channel);
  assert.equal(actual.environment, profile.environment);
});
for (const patch of [{ channel: 'staging' }, { environment: 'preview' }, { env: { APP_VARIANT: 'preview' } }, { env: { APP_VARIANT: 'production', EXPO_PUBLIC_OTHER: 'unexpected' } }, { android: { buildType: 'app-bundle' } }, { extends: 'unknown' }]) {
  test(`profile ${Object.keys(patch)[0]} drift fails closed`, () => {
    assert.throws(() => productionRuntimeConfig(exp, { build: { distribution: { ...profile, ...patch } } }));
  });
}
test('wrong update project and Android runtime overrides fail closed', () => {
  assert.throws(() => productionRuntimeConfig({ ...exp, updates: { url: 'https://u.expo.dev/other' } }, eas));
  assert.throws(() => productionRuntimeConfig({ ...exp, android: { ...exp.android, runtimeVersion: 'other' } }, eas));
});
const receipt = { ...productionRuntimeConfig(exp, eas), sourceCommit: 'a'.repeat(40) };
const build = { id: 'build-id', status: 'FINISHED', platform: 'ANDROID', buildProfile: 'distribution', appIdentifier: 'com.proops.personal', appVersion: '1.2.0', runtime: { version: '1.2.0' }, updateChannel: { name: 'production' }, gitCommitHash: receipt.sourceCommit, app: { id: 'project-id' }, fingerprint: { hash: 'eas-hash' } };
test('finished build evidence binds source, runtime, channel and verified APK checksum', () => {
  const result = attestNativeBuild(receipt, [build], 'b'.repeat(64));
  assert.equal(result.build.id, 'build-id');
  assert.equal(result.build.apkSha256, 'b'.repeat(64));
  assert.equal(result.build.easFingerprint, 'eas-hash');
});
for (const patch of [{ status: 'ERRORED' }, { runtime: { version: 'other' } }, { updateChannel: { name: 'staging' } }, { gitCommitHash: 'c'.repeat(40) }, { appIdentifier: 'other' }, { app: { id: 'other' } }]) {
  test(`EAS ${Object.keys(patch)[0]} mismatch cannot attest receipt`, () => {
    assert.throws(() => attestNativeBuild(receipt, { ...build, ...patch }, 'b'.repeat(64)));
  });
}
test('missing EAS metadata is rejected rather than inferred from source', () => {
  assert.throws(() => attestNativeBuild(receipt, { status: 'FINISHED' }, 'b'.repeat(64)));
});
