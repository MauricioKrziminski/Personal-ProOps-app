const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const raiz = __dirname;
const ler = (arquivo) => fs.readFileSync(path.join(raiz, arquivo), 'utf8');

test('registra o módulo de privacidade nas duas plataformas', () => {
  const config = JSON.parse(ler('expo-module.config.json'));
  assert.deepEqual(config.platforms, ['apple', 'android']);
  assert.deepEqual(config.apple.modules, ['ProOpsPrivacidadeModule']);
  assert.deepEqual(config.android.modules, [
    'expo.modules.proopsprivacidade.ProOpsPrivacidadeModule',
  ]);
});

test('iOS cobre só no segundo plano de verdade, nunca no inactive do Face ID', () => {
  const fonte = ler('ios/ProOpsPrivacidadeModule.swift');
  assert.match(fonte, /Name\("ProOpsPrivacidade"\)/);
  assert.match(fonte, /Function\("definirProtecao"\)/);
  assert.match(fonte, /didEnterBackgroundNotification/);
  assert.match(fonte, /didBecomeActiveNotification/);
  assert.doesNotMatch(fonte, /willResignActiveNotification/);
});

test('Android desliga a foto dos recentes e reaplica numa atividade recriada', () => {
  const fonte = ler('android/src/main/java/expo/modules/proopsprivacidade/ProOpsPrivacidadeModule.kt');
  assert.match(fonte, /Function\("definirProtecao"\)/);
  assert.match(fonte, /setRecentsScreenshotEnabled\(permitir\)/);
  assert.match(fonte, /OnActivityEntersForeground/);
  assert.match(fonte, /VERSION_CODES\.TIRAMISU/);
});
