import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MARCA_MINIMA_MS,
  TETO_DA_ABERTURA_MS,
  TETO_DA_TRAVA_MS,
  VALIDADE_DA_ORIGEM_MS,
  entradaLiberada,
  esperaDaAbertura,
  esperaDaMarca,
  ondaDaTroca,
  origemValida,
  precisaDeCortina,
} from './session-gate.ts';

test('a primeira sessão resolvida é a abertura, não uma troca', () => {
  assert.equal(precisaDeCortina(undefined, null), false);
  assert.equal(precisaDeCortina(undefined, 'u1'), false);
});

test('mesmo usuário (refresh de token, metadados do onboarding) passa direto', () => {
  assert.equal(precisaDeCortina('u1', 'u1'), false);
  assert.equal(precisaDeCortina(null, null), false);
});

test('entrar, sair e trocar de conta passam pela cortina', () => {
  assert.equal(precisaDeCortina(null, 'u1'), true);
  assert.equal(precisaDeCortina('u1', null), true);
  assert.equal(precisaDeCortina('u1', 'u2'), true);
});

test('sair cobre de baixo e revela até a capa do login', () => {
  assert.deepEqual(ondaDaTroca(null, null), { mode: 'up', ate: 'capa' });
  assert.deepEqual(ondaDaTroca(null, { x: 0.5, y: 0.8 }), { mode: 'up', ate: 'capa' });
});

test('entrar com botão nasce no botão; sem botão, do topo', () => {
  assert.deepEqual(ondaDaTroca('u1', { x: 0.5, y: 0.8 }), {
    mode: 'radial',
    origin: { x: 0.5, y: 0.8 },
    revealMode: 'down',
  });
  assert.deepEqual(ondaDaTroca('u1', null), { mode: 'down' });
});

test('a tela antiga permanece visível enquanto a cortina chega; a nova só entra na revelação', () => {
  assert.equal(entradaLiberada('cobrindo', false), true, 'não esvazia o Perfil sob a onda que chega');
  assert.equal(entradaLiberada('coberta', false), false, 'troca a sessão com o conteúdo oculto');
  assert.equal(entradaLiberada('revelando', false), true, 'a Hoje entra junto com a onda que sai');
  assert.equal(entradaLiberada('abertura', false), false, 'a abertura espera a tinta sair');
  assert.equal(entradaLiberada('revelando', true), false, 'a trava ainda segura o conteúdo');
});

test('a origem lembrada vence depois de um tempo', () => {
  const r = { ponto: { x: 0.3, y: 0.9 }, em: 1000 };
  assert.deepEqual(origemValida(r, 1000 + VALIDADE_DA_ORIGEM_MS), r.ponto);
  assert.equal(origemValida(r, 1001 + VALIDADE_DA_ORIGEM_MS), null);
  assert.equal(origemValida(null, 1000), null);
});

test('a abertura espera o teto curto, e o longo enquanto a trava pede a senha', () => {
  assert.equal(esperaDaAbertura(0, 1000, false), TETO_DA_ABERTURA_MS - 1000);
  assert.equal(esperaDaAbertura(0, TETO_DA_ABERTURA_MS + 1, false), 0);
  // Segurar depois do teto curto ainda vale: o prompt costuma chegar perto dele.
  assert.equal(esperaDaAbertura(0, TETO_DA_ABERTURA_MS + 1, true), TETO_DA_TRAVA_MS - TETO_DA_ABERTURA_MS - 1);
  assert.equal(esperaDaAbertura(0, TETO_DA_TRAVA_MS, true), 0);
});

test('a marca fica um mínimo na tela, e não mais que isso', () => {
  assert.equal(esperaDaMarca(1000, 1000), MARCA_MINIMA_MS);
  assert.equal(esperaDaMarca(1000, 1000 + MARCA_MINIMA_MS + 5), 0);
});
