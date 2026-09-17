const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { XML } = require('expo/config-plugins');

const { configureStyles, COR, CLARO, ESCURO } = require('./with-android-window-background');

const template = () =>
  XML.parseXMLAsync(`<resources>
  <style name="AppTheme" parent="Theme.AppCompat.DayNight.NoActionBar">
    <item name="colorPrimary">@color/colorPrimary</item>
  </style>
</resources>`);

const itens = (xml, nome) =>
  xml.resources.style.find((s) => s.$.name === 'AppTheme').item.filter((i) => i.$.name === nome);

test('o tema do app aponta o fundo da janela e o da tarefa para a cor do papel', async () => {
  const xml = configureStyles(await template());
  for (const nome of ['android:windowBackground', 'android:colorBackground']) {
    assert.deepEqual(itens(xml, nome).map((i) => i._), [`@color/${COR}`]);
  }
  assert.equal(itens(xml, 'colorPrimary').length, 1);
});

test('aplicar duas vezes não duplica o item', async () => {
  const xml = configureStyles(configureStyles(await template()));
  assert.equal(itens(xml, 'android:windowBackground').length, 1);
  assert.equal(itens(xml, 'android:colorBackground').length, 1);
});

test('as cores são o background do tema claro e do escuro', () => {
  const tema = fs.readFileSync(path.join(__dirname, '../src/constants/theme.ts'), 'utf8');
  const fundos = [...tema.matchAll(/^ {4}background: '(#[0-9A-Fa-f]{6})'/gm)].map((m) => m[1]);
  assert.deepEqual(fundos, [CLARO, ESCURO]);
});
