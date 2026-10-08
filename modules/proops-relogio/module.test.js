const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ler = (arquivo) => fs.readFileSync(path.join(__dirname, arquivo), 'utf8');

test('o pod do relógio é só iOS e o autolinking o leva', () => {
  const config = JSON.parse(ler('expo-module.config.json'));
  assert.deepEqual(config.platforms, ['apple']);
  assert.deepEqual(config.apple.modules, ['ProOpsRelogioModule']);
});

test('a rede só se instala com o RCTTiming que ela conhece, e mora na thread do JS', () => {
  const fonte = ler('ios/ProOpsRedeDosTimers.m');
  for (const nome of ['_timers', '_paused', '_inBackground', 'startTimers', 'createTimerForNextFrame:duration:jsSchedulingTime:repeats:']) {
    assert.ok(fonte.includes(nome), nome);
  }
  assert.match(fonte, /RCTTiming mudou: a rede dos timers NÃO foi instalada/);
  assert.match(fonte, /CFRunLoopAddTimer\(rede->loop, rede->timer, kCFRunLoopCommonModes\)/);
  assert.doesNotMatch(fonte, /simular|TEMPORÁRIO/);
});
