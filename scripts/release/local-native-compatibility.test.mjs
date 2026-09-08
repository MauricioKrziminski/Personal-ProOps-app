import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseApkCompatibility, attestLocalNativeBuild } from './local-native-compatibility.mjs';
import { assertAttestedBuild } from './native-compatibility.mjs';
import { publishCompatibleUpdate } from './ota-compatibility.mjs';

// Relevant lines captured from a real signed production APK with Android build-tools 36.
const xml = readFileSync(new URL('./fixtures/local-apk-manifest.txt', import.meta.url), 'utf8');
const resources = readFileSync(new URL('./fixtures/local-apk-resources.txt', import.meta.url), 'utf8');
const receipt = { applicationId: 'com.proops.personal', runtimeVersion: '1.3.1', channel: 'production', projectId: '8313579c-3979-4ecd-ba6a-4dc0bf702f05', updatesUrl: 'https://u.expo.dev/8313579c-3979-4ecd-ba6a-4dc0bf702f05', sourceCommit: 'a'.repeat(40) };
const provenance = { sourceCommit: receipt.sourceCommit, runId: '123456', runAttempt: '1' };
test('real APK xmltree resolves runtime resource and literal JSON channel', () => {
  assert.deepEqual(parseApkCompatibility(xml, resources), { applicationId: receipt.applicationId, appVersion: '1.3.1', runtimeVersion: '1.3.1', updatesUrl: receipt.updatesUrl, channel: 'production', updatesEnabled: true });
});
test('local receipt records actual APK evidence and CI provenance without EAS metadata', () => {
  const result = attestLocalNativeBuild(receipt, parseApkCompatibility(xml, resources), 'b'.repeat(64), provenance);
  assertAttestedBuild(result);
  assert.equal(result.build.provider, 'github-actions-local');
  assert.equal(result.build.runId, '123456');
  assert.equal(result.build.easFingerprint, undefined);
  assert.throws(() => assertAttestedBuild({ ...result, build: { ...result.build, updatesUrl: 'other' } }));
});
for (const key of ['applicationId', 'appVersion', 'runtimeVersion', 'updatesUrl', 'channel', 'updatesEnabled']) {
  test(`APK ${key} mismatch blocks local attestation`, () => {
    assert.throws(() => attestLocalNativeBuild(receipt, { ...parseApkCompatibility(xml, resources), [key]: 'wrong' }, 'b'.repeat(64), provenance));
  });
}
test('missing runtime resource, ambiguous resource and absent metadata fail closed', () => {
  assert.throws(() => parseApkCompatibility(xml, ''));
  assert.throws(() => parseApkCompatibility(xml, resources + '      (fr) "other"\n'));
  assert.throws(() => parseApkCompatibility(xml.replace('EXPO_UPDATE_URL', 'MISSING'), resources));
});
test('missing or mismatched CI provenance and checksum fail closed', () => {
  const apk = parseApkCompatibility(xml, resources);
  for (const patch of [{ sourceCommit: 'c'.repeat(40) }, { runId: '' }, { runAttempt: undefined }]) {
    assert.throws(() => attestLocalNativeBuild(receipt, apk, 'b'.repeat(64), { ...provenance, ...patch }));
  }
  assert.throws(() => attestLocalNativeBuild(receipt, apk, 'bad', provenance));
});
test('local APK receipt permits compatible OTA and blocks divergent native fingerprint', async () => {
  const source = { ...receipt, schema: 1, platform: 'android', environment: 'production', variant: 'production', fingerprint: 'native-inputs', fingerprintVersion: '1', publicEnvironmentHash: 'public-env' };
  const base = attestLocalNativeBuild(source, parseApkCompatibility(xml, resources), 'b'.repeat(64), provenance);
  const reference = { tag: 'v1.3.1', sourceCommit: receipt.sourceCommit };
  let published = 0;
  await publishCompatibleUpdate(base, source, reference, () => { published++; });
  assert.equal(published, 1);
  await assert.rejects(publishCompatibleUpdate(base, { ...source, fingerprint: 'changed-native' }, reference, () => { published++; }));
  assert.equal(published, 1);
});
