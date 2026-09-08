import assert from 'node:assert/strict';

/** Resolve the actual checked-in profile; never label an arbitrary build as production. */
export function productionRuntimeConfig(exp, eas) {
  const profile = eas.build?.distribution;
  assert.ok(profile && !profile.extends, 'Perfil distribution direto obrigatório para comprovar configuração.');
  assert.equal(profile.environment, 'production');
  assert.equal(profile.channel, 'production');
  assert.equal(profile.env?.APP_VARIANT, 'production');
  assert.deepEqual(Object.keys(profile.env).sort(), ['APP_VARIANT'], 'Variáveis adicionais no perfil precisam ser incluídas na snapshot verificada.');
  assert.equal(profile.android?.buildType, 'apk');
  assert.equal(profile.distribution, 'internal');
  assert.equal(exp.android?.package, 'com.proops.personal');
  assert.equal(exp.runtimeVersion?.policy, 'appVersion');
  assert.ok(!exp.android?.runtimeVersion, 'Runtime Android específico requer nova verificação.');
  assert.match(exp.version, /^\d+\.\d+\.\d+$/);
  const projectId = exp.extra?.eas?.projectId;
  assert.ok(typeof projectId === 'string' && projectId.length > 0);
  assert.equal(exp.updates?.url, `https://u.expo.dev/${projectId}`);
  return {
    platform: 'android', environment: profile.environment, channel: profile.channel,
    variant: profile.env.APP_VARIANT, applicationId: exp.android.package,
    runtimeVersion: exp.version, projectId, updatesUrl: exp.updates.url,
  };
}

/** EAS metadata is tied to the same successfully downloaded and verified APK artifact. */
export function attestNativeBuild(receipt, result, apkSha256) {
  const builds = Array.isArray(result) ? result : [result];
  assert.equal(builds.length, 1, 'Esperado exatamente um build.');
  const build = builds[0];
  assert.equal(build.status, 'FINISHED');
  assert.equal(build.platform, 'ANDROID');
  assert.equal(build.buildProfile, 'distribution');
  assert.equal(build.appIdentifier, receipt.applicationId);
  assert.equal(build.appVersion, receipt.runtimeVersion);
  assert.equal(build.runtime?.version, receipt.runtimeVersion);
  assert.equal(build.updateChannel?.name, receipt.channel);
  assert.equal(build.gitCommitHash, receipt.sourceCommit);
  assert.equal(build.app?.id, receipt.projectId);
  assert.ok(typeof build.id === 'string' && build.id.length > 0);
  assert.match(apkSha256, /^[a-f0-9]{64}$/);
  return { ...receipt, build: {
    id: build.id, sourceCommit: build.gitCommitHash, runtimeVersion: build.runtime.version,
    channel: build.updateChannel.name, applicationId: build.appIdentifier,
    projectId: build.app.id, apkSha256,
    // Source fingerprint and EAS fingerprint have distinct provenance; no claim they coincide.
    easFingerprint: build.fingerprint?.hash ?? null,
  } };
}

export function assertAttestedBuild(receipt) {
  assert.ok(receipt.build, 'Comprovante sem metadados do build publicado; gere um APK nativo.');
  for (const key of ['sourceCommit', 'runtimeVersion', 'channel', 'applicationId', 'projectId']) {
    assert.equal(receipt.build[key], receipt[key], `Metadado EAS ${key} divergente.`);
  }
  assert.match(receipt.build.apkSha256, /^[a-f0-9]{64}$/);
  assert.ok(typeof receipt.build.id === 'string' && receipt.build.id.length > 0);
}
