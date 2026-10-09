const assert = require('node:assert/strict');
const test = require('node:test');

const base = require('./app.json').expo;

function resolver(distribuicao) {
  const antes = { d: process.env.DISTRIBUICAO };
  if (distribuicao === undefined) delete process.env.DISTRIBUICAO;
  else process.env.DISTRIBUICAO = distribuicao;
  delete require.cache[require.resolve('./app.config.js')];
  try {
    return require('./app.config.js')({ config: structuredClone(base) });
  } finally {
    if (antes.d === undefined) delete process.env.DISTRIBUICAO;
    else process.env.DISTRIBUICAO = antes.d;
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
