const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { XML } = require('expo/config-plugins');

const { configureStyles, CORES } = require('./with-android-theme-colors');

const template = () =>
  XML.parseXMLAsync(`<resources>
  <style name="AppTheme" parent="Theme.AppCompat.DayNight.NoActionBar">
    <item name="colorPrimary">@color/colorPrimary</item>
  </style>
</resources>`);

const itens = (xml, nome) =>
  xml.resources.style.find((s) => s.$.name === 'AppTheme').item.filter((i) => i.$.name === nome);

test('o tema aponta fundo da janela, fundo da tarefa e acento para as cores do app', async () => {
  const xml = configureStyles(await template());
  assert.deepEqual(itens(xml, 'android:windowBackground').map((i) => i._), ['@color/fundoDaJanela']);
  assert.deepEqual(itens(xml, 'android:colorBackground').map((i) => i._), ['@color/fundoDaJanela']);
  assert.deepEqual(itens(xml, 'colorAccent').map((i) => i._), ['@color/acento']);
  assert.equal(itens(xml, 'colorPrimary').length, 1);
});

test('aplicar duas vezes não duplica item', async () => {
  const xml = configureStyles(configureStyles(await template()));
  for (const nome of ['android:windowBackground', 'android:colorBackground', 'colorAccent']) {
    assert.equal(itens(xml, nome).length, 1, nome);
  }
});

test('as cores são as do tema claro e do escuro do app', () => {
  const tema = fs.readFileSync(path.join(__dirname, '../src/constants/theme.ts'), 'utf8');
  const valores = (chave) =>
    [...tema.matchAll(new RegExp(`^ {4}${chave}: '(#[0-9A-Fa-f]{6})'`, 'gm'))].map((m) => m[1]);
  const [fundoClaro, fundoEscuro] = valores('background');
  const [tintaClara, tintaEscura] = valores('tint');
  assert.deepEqual(CORES.fundoDaJanela, { claro: fundoClaro, escuro: fundoEscuro });
  assert.deepEqual(CORES.acento, { claro: tintaClara, escuro: tintaEscura });
});
