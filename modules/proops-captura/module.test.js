const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const raiz = __dirname;
const kt = (nome) => fs.readFileSync(path.join(raiz, 'android/src/main/java/expo/modules/proopscaptura', nome), 'utf8');

test('registra o módulo só no Android', () => {
  const config = JSON.parse(fs.readFileSync(path.join(raiz, 'expo-module.config.json'), 'utf8'));
  assert.deepEqual(config.platforms, ['android']);
  assert.deepEqual(config.android.modules, ['expo.modules.proopscaptura.ProOpsCapturaModule']);
});

test('declara o listener protegido pela permissão do sistema', () => {
  const manifesto = fs.readFileSync(path.join(raiz, 'android/src/main/AndroidManifest.xml'), 'utf8');
  assert.match(manifesto, /android:name="expo\.modules\.proopscaptura\.CapturaService"/);
  assert.match(manifesto, /android:permission="android\.permission\.BIND_NOTIFICATION_LISTENER_SERVICE"/);
  assert.match(manifesto, /android\.service\.notification\.NotificationListenerService/);
});

test('o serviço filtra por pacote escolhido e só grava com a captura ligada', () => {
  const fonte = kt('Captura.kt');
  assert.match(fonte, /if \(!ativa\(ctx\) \|\| sbn\.packageName !in pacotes\(ctx\)\) return/);
  assert.match(fonte, /FLAG_GROUP_SUMMARY/);
  assert.match(fonte, /MAX_PENDENTES/);
  assert.match(fonte, /300_000/); // janela de 5 min no id
});

test('o serviço não fala com a rede', () => {
  for (const nome of ['Captura.kt', 'CapturaService.kt', 'ProOpsCapturaModule.kt']) {
    assert.doesNotMatch(kt(nome), /HttpURLConnection|OkHttp|java\.net\.URL|WorkManager/);
  }
});

test('expõe as funções que o app usa', () => {
  const fonte = kt('ProOpsCapturaModule.kt');
  for (const f of ['acessoConcedido', 'abrirAjustes', 'estado', 'configurar', 'pendentes', 'remover']) {
    assert.match(fonte, new RegExp(`Function\\("${f}"\\)`));
  }
});
