/** `node --test`. A regra que decide se o dado financeiro fica exposto. */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  aposBiometria,
  deveTrancar,
  deveTrancarNoInicio,
  esperaRestante,
  type LockState,
} from './lock-policy.ts';

const base: LockState = {
  mode: 'pin',
  delaySeconds: 0,
  backgroundedAt: null,
  systemUiOpen: false,
};

test('desligado nunca tranca — é o comportamento de hoje', () => {
  assert.equal(deveTrancar({ ...base, mode: 'off', backgroundedAt: 0 }, 999999), false);
  assert.equal(deveTrancarNoInicio('off'), false);
});

test('ligado, o app SEMPRE abre trancado', () => {
  assert.equal(deveTrancarNoInicio('pin'), true);
  assert.equal(deveTrancarNoInicio('biometric'), true);
});

test('delay 0 é IMEDIATO — e 0 é falsy, que é a armadilha', () => {
  // `if (delay)` faria o modo mais seguro ser o único que nunca tranca.
  assert.equal(deveTrancar({ ...base, delaySeconds: 0, backgroundedAt: 1000 }, 1000), true);
});

test('com carência, só tranca depois do tempo', () => {
  const s: LockState = { ...base, delaySeconds: 30, backgroundedAt: 1000 };
  assert.equal(deveTrancar(s, 1000 + 29_000), false);
  assert.equal(deveTrancar(s, 1000 + 30_000), true);
});

test('⚠️ voltar do seletor de arquivo NÃO tranca', () => {
  // No Android o DocumentPicker dispara `background`. Sem isto, importar extrato trancava o app
  // no meio da operação — a pessoa escolhe o arquivo e volta para um pedido de PIN.
  const s: LockState = { ...base, backgroundedAt: 1000, systemUiOpen: true };
  assert.equal(deveTrancar(s, 999_999), false);
});

test('nunca esteve em segundo plano = não tranca', () => {
  assert.equal(deveTrancar({ ...base, backgroundedAt: null }, 999_999), false);
});

test('biometria cancelada CAI NO PIN, não trava a pessoa fora', () => {
  // `user_fallback` é o toque em "Usar senha" e não é erro. Tratar tudo que não é success como
  // falha deixa esse botão morto — o caminho que mais gente usa quando a digital não pega.
  assert.equal(aposBiometria({ success: true }), 'aberto');
  assert.equal(aposBiometria({ success: false, error: 'user_fallback' }), 'pedir-pin');
  assert.equal(aposBiometria({ success: false, error: 'user_cancel' }), 'pedir-pin');
  assert.equal(aposBiometria({ success: false, error: 'lockout' }), 'pedir-pin');
});

test('cinco erros fazem esperar, e a espera anda', () => {
  assert.equal(esperaRestante(4, 1000, 1000), 0, 'antes do limite não espera');
  assert.equal(esperaRestante(5, 1000, 1000), 30);
  assert.equal(esperaRestante(5, 1000, 1000 + 10_000), 20);
  assert.equal(esperaRestante(5, 1000, 1000 + 30_000), 0, 'a espera termina');
  assert.equal(esperaRestante(9, null, 999), 0, 'sem registro de erro não trava');
});
