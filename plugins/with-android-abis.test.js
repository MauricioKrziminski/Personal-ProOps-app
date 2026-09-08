const assert = require('node:assert/strict');
const test = require('node:test');

const {
  configureGradleProperties,
  TODAS,
  APARELHOS_REAIS,
} = require('./with-android-abis');

const template = () => [
  { type: 'property', key: 'android.useAndroidX', value: 'true' },
  { type: 'property', key: 'reactNativeArchitectures', value: TODAS },
];

const arquiteturas = (propriedades) =>
  propriedades.find((p) => p.key === 'reactNativeArchitectures').value;

test('produção e staging não levam x86: 67 MB que nenhum celular usa', () => {
  for (const variante of ['production', 'preview']) {
    const valor = arquiteturas(configureGradleProperties(template(), variante));
    assert.equal(valor, APARELHOS_REAIS);
    assert.ok(!valor.includes('x86'));
  }
});

test('development mantém as quatro — o emulador da máquina pode ser x86_64', () => {
  assert.equal(arquiteturas(configureGradleProperties(template(), undefined)), TODAS);
  assert.equal(arquiteturas(configureGradleProperties(template(), 'development')), TODAS);
});

test('sem a propriedade no template, o plugin acrescenta em vez de sumir', () => {
  const so = [{ type: 'property', key: 'android.useAndroidX', value: 'true' }];
  assert.equal(arquiteturas(configureGradleProperties(so, 'production')), APARELHOS_REAIS);
  assert.equal(so.length, 2);
});

test('aplicar duas vezes não duplica a propriedade', () => {
  const props = template();
  configureGradleProperties(props, 'production');
  configureGradleProperties(props, 'production');
  assert.equal(props.filter((p) => p.key === 'reactNativeArchitectures').length, 1);
});
