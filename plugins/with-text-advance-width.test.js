const assert = require('node:assert/strict');
const test = require('node:test');
const { XML } = require('expo/config-plugins');

const { configureStyles, ESTILO } = require('./with-text-advance-width');

const template = () =>
  XML.parseXMLAsync(`<resources xmlns:tools="http://schemas.android.com/tools">
  <style name="AppTheme" parent="Theme.AppCompat.DayNight.NoActionBar">
    <item name="colorPrimary">@color/colorPrimary</item>
  </style>
</resources>`);

const estilo = (xml, nome) => xml.resources.style.find((s) => s.$.name === nome);
const item = (grupo, nome) => (grupo.item ?? []).filter((i) => i.$.name === nome);

test('o tema do app aponta o estilo de texto para o que quebra pelo avanço', async () => {
  const xml = configureStyles(await template());
  const [ref] = item(estilo(xml, 'AppTheme'), 'android:textViewStyle');
  assert.equal(ref._, `@style/${ESTILO}`);
});

test('o estilo desliga a caixa de tinta e herda o TextView do AppCompat', async () => {
  const xml = configureStyles(await template());
  const grupo = estilo(xml, ESTILO);
  assert.equal(grupo.$.parent, 'Widget.AppCompat.TextView');
  const [bounds] = item(grupo, 'android:useBoundsForWidth');
  assert.equal(bounds._, 'false');
  // O atributo só existe da API 35 em diante; sem isto o lint do build acusa NewApi.
  assert.equal(bounds.$['tools:targetApi'], '35');
});

test('o item existente do tema continua lá', async () => {
  const xml = configureStyles(await template());
  assert.equal(item(estilo(xml, 'AppTheme'), 'colorPrimary').length, 1);
});

test('aplicar duas vezes não duplica estilo nem item', async () => {
  const xml = configureStyles(configureStyles(await template()));
  assert.equal(xml.resources.style.filter((s) => s.$.name === ESTILO).length, 1);
  assert.equal(item(estilo(xml, 'AppTheme'), 'android:textViewStyle').length, 1);
  assert.equal(item(estilo(xml, ESTILO), 'android:useBoundsForWidth').length, 1);
});
