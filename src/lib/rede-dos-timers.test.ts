import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// A rede dos timers do iOS (`modules/proops-relogio`) encaixa em peças INTERNAS do RCTTiming, que
// o React Native não promete manter: numa versão nova ela pode se desligar sozinha, e o único
// sinal seria `[ProOpsRelogio] RCTTiming mudou` no log do Xcode (a cortina presa depois do Face ID
// voltaria em silêncio). Esta trava faz o upgrade quebrar aqui. Ao subir: siga
// `modules/proops-relogio/README.md` (o RCTTiming.mm novo e a prova no simulador) e só então troque
// a versão abaixo. Mora fora de `modules/` porque qualquer arquivo lá fecha o OTA do Android.
test('o React Native é o mesmo em que a rede dos timers foi provada', () => {
  const pacote = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal(
    pacote.dependencies['react-native'],
    '0.86.3',
    'O React Native mudou: confira a rede dos timers (modules/proops-relogio/README.md) antes de atualizar esta versão.',
  );
});
