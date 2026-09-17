/** `node --test`. A regra que decide se o dado financeiro fica exposto. */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  aposAutenticar,
  bandeiraCaiAoTerminar,
  bandeiraCaiNoActive,
  deveTrancar,
  deveVelarAoSair,
  deveTrancarNoInicio,
  podeTrancar,
  type LockState,
} from './lock-policy.ts';

const base: LockState = {
  mode: 'on',
  delaySeconds: 0,
  backgroundedAt: null,
  systemUiOpen: false,
  temSessao: true,
};

test('trava desligada nunca tranca', () => {
  assert.equal(deveTrancar({ ...base, mode: 'off', backgroundedAt: 0 }, 999_999), false);
});

test('sem ter saído do app não tranca', () => {
  assert.equal(deveTrancar(base, 1000), false);
});

test('espera 0 tranca na hora — e `0` é falsy, que é onde isto quebra', () => {
  assert.equal(deveTrancar({ ...base, backgroundedAt: 1000 }, 1000), true);
  assert.equal(deveTrancar({ ...base, backgroundedAt: 1000 }, 1001), true);
});

test('espera de 30s só tranca depois dos 30s', () => {
  const s = { ...base, delaySeconds: 30 as const, backgroundedAt: 1000 };
  assert.equal(deveTrancar(s, 1000 + 29_999), false);
  assert.equal(deveTrancar(s, 1000 + 30_000), true);
});

test('UI do sistema aberta (arquivo, câmera, o próprio prompt) não tranca', () => {
  const s = { ...base, backgroundedAt: 1000, systemUiOpen: true };
  assert.equal(deveTrancar(s, 999_999), false);
});

test('ligada, o app abre trancado', () => {
  assert.equal(deveTrancarNoInicio('on'), true);
  assert.equal(deveTrancarNoInicio('off'), false);
});

test('só sucesso abre — desistir ou falhar mantém trancado', () => {
  assert.equal(aposAutenticar({ success: true }), 'aberto');
  assert.equal(aposAutenticar({ success: false }), 'trancado');
});

test('celular sem bloqueio de tela não pode oferecer a trava', () => {
  // `SecurityLevel.NONE` é 0; SECRET 1, BIOMETRIC_WEAK 2, BIOMETRIC_STRONG 3.
  assert.equal(podeTrancar(0), false);
  assert.equal(podeTrancar(1), true, 'só a senha do aparelho já basta');
  assert.equal(podeTrancar(3), true);
});


/*
  O laço de 14/09/2026: Face ID aceito → app aberto → `active` 1,3 s depois → trancado de novo →
  pede de novo. A bandeira caía por relógio, e o relógio perdeu a corrida.
*/
test('a bandeira NÃO cai ao terminar quando o app saiu do primeiro plano', () => {
  assert.equal(bandeiraCaiAoTerminar(0, true), false, 'quem baixa é o `active` que ainda vem');
  const s: LockState = { ...base, backgroundedAt: 1_000, systemUiOpen: true };
  assert.equal(deveTrancar(s, 6_000), false, 'o `active` atrasado não pode trancar');
  assert.equal(deveTrancar({ ...s, systemUiOpen: false }, 6_000), true, 'sem ela, trancava');
});

test('a bandeira cai na hora quando o app nunca saiu do primeiro plano', () => {
  // O `BiometricPrompt` do Android é um diálogo: não vem `active` nenhum para consumi-la, e
  // deixá-la de pé engoliria o próximo retorno de verdade.
  assert.equal(bandeiraCaiAoTerminar(0, false), true);
});

test('operação ainda em voo segura a bandeira dos dois lados', () => {
  assert.equal(bandeiraCaiAoTerminar(1, false), false);
  assert.equal(bandeiraCaiNoActive(1), false, 'o `active` foi do prompt que JÁ fechou, não deste');
  assert.equal(bandeiraCaiNoActive(0), true);
});

test('sem conta aberta não tranca — a porta é o login', () => {
  assert.equal(deveTrancar({ ...base, backgroundedAt: 1000, temSessao: false }, 999_999), false);
});

test('sair do app com a trava ligada cobre na hora — menos para a UI do sistema e sem conta', () => {
  assert.equal(deveVelarAoSair(base), true);
  assert.equal(deveVelarAoSair({ ...base, delaySeconds: 60 }), true);
  assert.equal(deveVelarAoSair({ ...base, mode: 'off' }), false);
  assert.equal(deveVelarAoSair({ ...base, systemUiOpen: true }), false);
  assert.equal(deveVelarAoSair({ ...base, temSessao: false }), false);
});
