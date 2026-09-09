/** `node --test` (Node 24 faz type stripping nativo). */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { balanceMessage, type AccountBalanceRow } from './balance-text.ts';

const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Os números do staging: Nubank com R$ 3.020,00 confirmados e R$ 420,00 de Pix previsto, e um
 * cartão devendo R$ 21.360,00 dos quais R$ 15.330,00 são parcelas de meses à frente.
 */
const LINHAS: AccountBalanceRow[] = [
  { account_id: 'a1', name: 'Nubank', type: 'checking',
    balance_cents: 344000, cleared_cents: 302000, pending_in_cents: 42000, pending_out_cents: 0 },
  { account_id: 'a2', name: 'Poupança', type: 'savings',
    balance_cents: 185000, cleared_cents: 185000, pending_in_cents: 0, pending_out_cents: 0 },
  { account_id: 'a3', name: 'Nubank Cartão', type: 'credit_card',
    balance_cents: -2136000, cleared_cents: -603000, pending_in_cents: 0, pending_out_cents: 1533000 },
];

test('o saldo não conta o que não caiu', () => {
  const msg = balanceMessage(LINHAS, brl);
  assert.match(msg, /R\$\s*4\.870,00/, '3.020 + 1.850, sem o Pix previsto');
  assert.doesNotMatch(msg, /R\$\s*5\.290,00/, 'somou o Pix de 420 dentro do saldo');
});

test('cartão não entra no dinheiro disponível', () => {
  const msg = balanceMessage(LINHAS, brl);
  // Com o cartão dentro do total, a resposta antiga era "Saldo total: −R$ 16.070,00".
  assert.doesNotMatch(msg, /16\.070,00/, 'misturou o que tem com o que deve');
  assert.match(msg, /Dívida de cartão/);
  assert.match(msg, /21\.360,00/, 'a dívida precisa aparecer, só que separada');
  assert.match(msg, /parcelas de meses à frente/);
});

test('o previsto vira aviso, com a ação junto', () => {
  const msg = balanceMessage(LINHAS, brl);
  assert.match(msg, /A receber/);
  assert.match(msg, /420,00/);
  assert.match(msg, /recebi/i, 'aviso que só informa é aviso que ninguém usa');
});

test('sem previsto não inventa aviso', () => {
  const msg = balanceMessage(
    [{ account_id: 'a1', name: 'Nubank', type: 'checking',
       balance_cents: 302000, cleared_cents: 302000, pending_in_cents: 0, pending_out_cents: 0 }],
    brl
  );
  assert.doesNotMatch(msg, /A receber|A pagar|Dívida de cartão/);
});

/**
 * O cenário do deploy fora de ordem: código novo, RPC antiga (4 colunas). Sem a queda, isto
 * imprimia `R$ NaN` — que numa mensagem de dinheiro é pior do que não responder.
 */
test('sem as colunas novas, cai no comportamento antigo em vez de NaN', () => {
  const msg = balanceMessage(
    [
      { account_id: 'a1', name: 'Nubank', type: 'checking', balance_cents: 302000 },
      { account_id: 'a3', name: 'Nubank Cartão', type: 'credit_card', balance_cents: -2136000 },
    ],
    brl
  );
  assert.doesNotMatch(msg, /NaN/);
  assert.match(msg, /R\$\s*3\.020,00/);
  // a separação dinheiro × cartão NÃO depende das colunas novas, então continua valendo
  assert.match(msg, /Dívida de cartão/);
  assert.doesNotMatch(msg, /A receber|A pagar/, 'sem dado, nenhum aviso — não chutar');
});

test('conta sem nada não aparece na lista, mas o total continua', () => {
  const msg = balanceMessage(
    [
      { account_id: 'a1', name: 'Nubank', type: 'checking',
        balance_cents: 302000, cleared_cents: 302000, pending_in_cents: 0, pending_out_cents: 0 },
      { account_id: 'a9', name: 'Conta zerada', type: 'checking',
        balance_cents: 0, cleared_cents: 0, pending_in_cents: 0, pending_out_cents: 0 },
    ],
    brl
  );
  assert.doesNotMatch(msg, /Conta zerada/);
  assert.match(msg, /R\$\s*3\.020,00/);
});
