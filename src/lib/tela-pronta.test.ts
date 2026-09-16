/** `node --test`. O portão que decide se a tela inteira ainda está no skeleton. */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { telaPronta, type Consulta } from './tela-pronta.ts';

const buscando: Consulta = { isPending: true, fetchStatus: 'fetching' };
const pronta: Consulta = { isPending: false, fetchStatus: 'idle' };
/** `enabled: false` no TanStack v5: pendente para sempre, sem ninguém buscando. */
const desligada: Consulta = { isPending: true, fetchStatus: 'idle' };
/** Sem rede: também não vai chegar resposta nenhuma. */
const pausada: Consulta = { isPending: true, fetchStatus: 'paused' };
/** Refetch de fundo por cima de dado que já existe. */
const revalidando: Consulta = { isPending: false, fetchStatus: 'fetching' };
/**
 * Consulta que FALHOU e não tem dado anterior: o TanStack a tira de `pending` (`status: 'error'`)
 * e para de buscar. Ninguém mais vai tentar sozinho — só o "Tentar de novo" da tela.
 */
const errou: Consulta = { isPending: false, fetchStatus: 'idle' };

test('sem consulta nenhuma a tela está pronta', () => {
  assert.equal(telaPronta(), true);
});

test('uma buscando segura a tela inteira', () => {
  assert.equal(telaPronta(pronta, pronta, buscando), false);
  assert.equal(telaPronta(buscando), false);
});

test('todas prontas abrem o portão', () => {
  assert.equal(telaPronta(pronta, pronta, pronta), true);
});

test('query DESLIGADA não pode prender a tela no skeleton para sempre', () => {
  // `enabled: false` deixa `isPending` true eternamente. Um portão que só olhasse `isPending`
  // devolveria `false` aqui — e a tela nunca sairia do carregamento.
  assert.equal(telaPronta(pronta, desligada), true);
});

test('sem rede a tela abre e mostra o estado dela, não um skeleton eterno', () => {
  assert.equal(telaPronta(pronta, pausada), true);
});

test('refetch de fundo NÃO traz o skeleton de volta', () => {
  assert.equal(telaPronta(revalidando, revalidando), true);
});

test('consulta que FALHOU libera a tela para ela mostrar o erro, não um skeleton eterno', () => {
  // O defeito de 16/09/2026: o portão recebia `range.pronto`, um booleano derivado de
  // `Boolean(ciclo.data)`. Com o `cycle_range` falhando ele ficava `false` para sempre e a tela
  // parava no carregamento — sem card de erro e sem "Tentar de novo". Como CONSULTA, a mesma
  // falha libera o portão, e quem desenha o erro é o bloco que depende dela.
  assert.equal(telaPronta(pronta, errou), true);
  assert.equal(telaPronta(errou, buscando), false, 'a que ainda busca continua segurando');
});

