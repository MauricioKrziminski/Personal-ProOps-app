/** `node --test` (Node 24 faz type stripping nativo). */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { describeCycle } from './cycle-label.ts';

test('ciclo fechado devendo lidera com a DÍVIDA, e o caixa vai para o rodapé', () => {
  // O caso real de setembro/2026: R$ 0,72 na conta e R$ 371,64 de fatura não paga. Liderar com
  // os 72 centavos em verde fazia o mês ler como positivo — a queixa do dono do produto.
  const d = describeCycle(
    { estado: 'fechado', resultado: 72, caixa_no_fim: 72, faltou_pagar: 37164 },
    'setembro',
  );
  assert.equal(d.label, 'Fechei setembro devendo');
  assert.equal(d.cents, -37164, 'a dívida vem negativa: vermelho sozinho não diz o sinal');
  assert.equal(d.ruim, true);
  assert.deepEqual(d.rodape, { label: 'Sobrou na conta', cents: 72 });
});

test('fatura ADIADA continua sendo "faltou pagar"', () => {
  // `rolled` quer dizer que o dinheiro NÃO saiu: o principal foi para a fatura seguinte, com
  // juros. O `faltou_pagar` do banco já inclui `rolled` (migration 20260913160000) — aqui só se
  // garante que a tela não invente uma terceira leitura para o mesmo número.
  const d = describeCycle(
    { estado: 'fechado', resultado: 72, caixa_no_fim: 72, faltou_pagar: 37164 },
    'setembro',
  );
  assert.notEqual(d.label, 'Sobrou em setembro');
});

test('ciclo fechado sem dívida lidera com o caixa', () => {
  const d = describeCycle(
    { estado: 'fechado', resultado: 50000, caixa_no_fim: 50000, faltou_pagar: 0 },
    'agosto',
  );
  assert.equal(d.label, 'Sobrou em agosto');
  assert.equal(d.cents, 50000);
  assert.equal(d.ruim, false);
  assert.equal(d.rodape, undefined);
});

test('ciclo aberto e previsto falam no futuro e usam o resultado', () => {
  const aberto = describeCycle(
    { estado: 'aberto', resultado: -62930, caixa_no_fim: null, faltou_pagar: null },
    'outubro',
  );
  assert.equal(aberto.label, 'Vou fechar em');
  assert.equal(aberto.cents, -62930);
  assert.equal(aberto.ruim, true);

  const previsto = describeCycle(
    { estado: 'previsto', resultado: 9206, caixa_no_fim: null, faltou_pagar: null },
    'novembro',
  );
  assert.equal(previsto.label, 'Devo fechar em');
  assert.equal(previsto.ruim, false);
});

test('os campos chegam como string do PostgREST e continuam somando', () => {
  // `bigint` vira string no JSON. Sem o `Number`, `faltou > 0` compararia texto.
  const d = describeCycle(
    { estado: 'fechado', resultado: '72', caixa_no_fim: '72', faltou_pagar: '37164' },
    'setembro',
  );
  assert.equal(d.cents, -37164);
  assert.equal(d.ruim, true);
});
