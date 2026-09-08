import assert from 'node:assert/strict';
import { assertAttestedBuild } from './native-compatibility.mjs';

export function assertOtaCompatible(base, current, { tag, sourceCommit, changedFiles = [] }) {
  // Fingerprint configuration itself can exclude native inputs. Also freeze native/build
  // inputs explicitly so a new ignore rule or unsupported plugin cannot weaken this gate.
  const nativeInput = /^(?:package(?:-lock)?\.json$|(?:app|eas|metro|babel|fingerprint)\.config\.|app\.json$|eas\.json$|\.fingerprintignore$|\.easignore$|(?:android|ios|modules|plugins)\/)/;
  assert.ok(!changedFiles.some((path) => nativeInput.test(path)), 'Entradas nativas alteradas; gere um APK nativo.');
  assert.match(tag, /^v\d+\.\d+\.\d+$/);
  assert.equal(base.schema, 1, 'APK sem comprovante de compatibilidade; publique um novo APK.');
  assert.match(sourceCommit, /^[a-f0-9]{40}$/);
  assertAttestedBuild(base);
  assert.equal(base.sourceCommit, sourceCommit, 'Tag não corresponde ao código do APK.');
  assert.equal(tag, `v${base.runtimeVersion}`, 'Tag/runtime divergentes.');
  for (const key of ['platform', 'environment', 'channel', 'variant', 'applicationId']) {
    const expected = { platform: 'android', environment: 'production', channel: 'production', variant: 'production', applicationId: 'com.proops.personal' }[key];
    assert.equal(base[key], expected, `APK: ${key} incorreto.`);
    assert.equal(current[key], expected, `OTA: ${key} incorreto.`);
  }
  for (const key of ['runtimeVersion', 'fingerprint', 'fingerprintVersion', 'publicEnvironmentHash', 'projectId', 'updatesUrl']) {
    assert.ok(typeof base[key] === 'string' && base[key].length > 0, `Comprovante sem ${key}.`);
    assert.equal(current[key], base[key], `${key} incompatível; gere um APK nativo.`);
  }
}

// Injectable action keeps the publication boundary testable without contacting EAS.
export async function publishCompatibleUpdate(base, current, reference, publish) {
  assertOtaCompatible(base, current, reference);
  return publish();
}
