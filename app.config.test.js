const assert = require('node:assert/strict');
const test = require('node:test');

const base = require('./app.json').expo;

function resolver(distribuicao, variante) {
  const antes = { d: process.env.DISTRIBUICAO, v: process.env.APP_VARIANT };
  if (variante === undefined) delete process.env.APP_VARIANT;
  else process.env.APP_VARIANT = variante;
  process.env.EXPO_PUBLIC_AGENT_URL ||= 'https://agente.exemplo';
  if (distribuicao === undefined) delete process.env.DISTRIBUICAO;
  else process.env.DISTRIBUICAO = distribuicao;
  delete require.cache[require.resolve('./app.config.js')];
  try {
    return require('./app.config.js')({ config: structuredClone(base) });
  } finally {
    if (antes.d === undefined) delete process.env.DISTRIBUICAO;
    else process.env.DISTRIBUICAO = antes.d;
    if (antes.v === undefined) delete process.env.APP_VARIANT;
    else process.env.APP_VARIANT = antes.v;
  }
}

const nomes = (cfg) => cfg.plugins.map((p) => (Array.isArray(p) ? p[0] : p));

test('loja: sem with-apk-installer, com o plugin que remove a permissão', () => {
  const cfg = resolver('loja');
  assert.equal(cfg.extra.distribuicao, 'loja');
  assert.ok(!nomes(cfg).includes('./plugins/with-apk-installer'));
  assert.ok(nomes(cfg).includes('./plugins/with-sem-instalador-apk'));
});

test('loja: o manifest marca REQUEST_INSTALL_PACKAGES como remove', () => {
  const withSem = require('./plugins/with-sem-instalador-apk');
  const manifest = {
    $: {},
    'uses-permission': [{ $: { 'android:name': 'android.permission.REQUEST_INSTALL_PACKAGES' } }],
  };
  const config = withSem({ name: 'x' });
  const mod = config.mods.android.manifest;
  assert.ok(mod, 'plugin registra mod de manifest');
  return mod({ modResults: { manifest }, modRequest: {}, ...config }).then((r) => {
    const perms = r.modResults.manifest['uses-permission'];
    assert.equal(perms.length, 1);
    assert.equal(perms[0].$['tools:node'], 'remove');
    assert.equal(r.modResults.manifest.$['xmlns:tools'], 'http://schemas.android.com/tools');
  });
});

test('apk (explícito ou sem variável): mantém o instalador', () => {
  for (const v of ['apk', undefined, 'qualquer']) {
    const cfg = resolver(v);
    assert.equal(cfg.extra.distribuicao, 'apk');
    assert.ok(nomes(cfg).includes('./plugins/with-apk-installer'));
    assert.ok(!nomes(cfg).includes('./plugins/with-sem-instalador-apk'));
  }
});

test('loja sem EXPO_PUBLIC_AGENT_URL falha; apk segue', () => {
  const url = process.env.EXPO_PUBLIC_AGENT_URL;
  const antes = process.env.DISTRIBUICAO;
  try {
    delete process.env.EXPO_PUBLIC_AGENT_URL;
    process.env.DISTRIBUICAO = 'loja';
    delete require.cache[require.resolve('./app.config.js')];
    assert.throws(() => require('./app.config.js'), /EXPO_PUBLIC_AGENT_URL/);
    process.env.DISTRIBUICAO = 'apk';
    delete require.cache[require.resolve('./app.config.js')];
    assert.doesNotThrow(() => require('./app.config.js'));
  } finally {
    if (url === undefined) delete process.env.EXPO_PUBLIC_AGENT_URL; else process.env.EXPO_PUBLIC_AGENT_URL = url;
    if (antes === undefined) delete process.env.DISTRIBUICAO; else process.env.DISTRIBUICAO = antes;
    delete require.cache[require.resolve('./app.config.js')];
  }
});

test('compartilhar: imagem e texto, App Group da própria variante (o mesmo dos widgets)', () => {
  for (const variante of ['development', 'preview', 'production']) {
    const cfg = resolver('apk', variante);
    const share = cfg.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-share-intent');
    assert.ok(share, `sem expo-share-intent em ${variante}`);
    const op = share[1];
    assert.deepEqual(op.androidIntentFilters, ['text/*', 'image/*']);
    assert.equal(op.iosActivationRules.NSExtensionActivationSupportsImageWithMaxCount, 1);
    assert.equal(op.iosActivationRules.NSExtensionActivationSupportsText, true);
    assert.equal(op.iosAppGroupIdentifier, `group.${cfg.ios.bundleIdentifier}`);
    const widgets = cfg.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-widgets');
    assert.equal(op.iosAppGroupIdentifier, widgets[1].groupIdentifier);
  }
});
