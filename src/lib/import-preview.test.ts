/** `node --test` (Node 24 faz type stripping nativo). */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  agrupar,
  fraseDaParcela,
  grupoDe,
  motivoDaLinha,
  nomeDoItem,
  selecaoInicial,
  totais,
  type ItemDaPrevia,
} from './import-preview.ts';

const base: ItemDaPrevia = {
  id: 'x', kind: 'expense', amount_cents: 1000, occurred_at: '2026-09-10', description: 'Loja',
  merchant: null, status: 'pending', nature: 'compra', installment_no: null, installments: null,
  match_layer: null, match_note: null, adopt_ids: null, transactions: null,
};
const it = (p: Partial<ItemDaPrevia>): ItemDaPrevia => ({ ...base, ...p });

test('só o que é NOVO e é gasto/receita de verdade nasce marcado', () => {
  const itens = [
    it({ id: 'novo' }),
    it({ id: 'dup', status: 'duplicate', transactions: { id: 't', occurred_at: '2026-09-10', description: 'Loja' } }),
    it({ id: 'talvez', status: 'uncertain' }),
    it({ id: 'pagamento', kind: 'income', nature: 'pagamento_fatura' }),
    it({ id: 'feito', status: 'approved' }),
  ];
  assert.deepEqual([...selecaoInicial(itens, true)], ['novo']);
  assert.deepEqual(agrupar(itens, true).map((g) => g.grupo), ['entram', 'talvez', 'no_app', 'fora']);
});

test('crédito na fatura nunca entra sozinho como receita — mesmo sem a IA ter respondido', () => {
  assert.equal(grupoDe(it({ kind: 'income', nature: null }), true), 'fora');
  assert.equal(grupoDe(it({ kind: 'income', nature: 'estorno' }), true), 'entram', 'estorno é dinheiro de volta');
  assert.equal(grupoDe(it({ kind: 'income', nature: null }), false), 'entram', 'na conta, entrada é receita');
});

test('transferência entre contas e aplicação ficam de fora por padrão, com o motivo', () => {
  const t = it({ nature: 'transferencia_propria' });
  assert.equal(grupoDe(t, false), 'fora');
  assert.equal(motivoDaLinha(t, false), 'Entre as suas contas');
});

test('a frase do parcelado diz o que vai ser criado', () => {
  const p = it({ merchant: 'Luizroberto', description: 'Luizroberto - Parcela 2/12', installment_no: 2, installments: 12 });
  assert.equal(nomeDoItem(p), 'Luizroberto');
  assert.equal(fraseDaParcela(p, true), 'Parcela 2/12 · cria a compra de 12x: 1 anterior como paga, esta e mais 10');
  const ultima = it({ installment_no: 10, installments: 10, merchant: 'King', adopt_ids: ['a', null, null, null, null, null, null, null, null] });
  assert.match(fraseDaParcela(ultima, true)!, /9 anteriores como pagas, esta é a última · a anterior que já está no app entra nela/);
  assert.equal(fraseDaParcela(it({ status: 'duplicate', installment_no: 2, installments: 3 }), true), 'Parcela 2/3');
});

test('o motivo do "já está no app" mostra com o quê', () => {
  const d = it({ status: 'near_match', match_note: 'mesmo valor, no app em 08/09/2026',
    transactions: { id: 't', occurred_at: '2026-09-08', description: 'Posto' } });
  assert.equal(motivoDaLinha(d, true), 'mesmo valor, no app em 08/09/2026 — «Posto»');
  const s = it({ status: 'uncertain', match_note: 'é Energia no app, lá R$ 214,30, em 08/09/2026',
    transactions: { id: 't', occurred_at: '2026-09-08', description: 'Energia' } });
  assert.equal(motivoDaLinha(s, true), 'é Energia no app, lá R$ 214,30, em 08/09/2026', 'a nota já nomeia: sem eco');
});

test('o total é o que está MARCADO, e conta as compras parceladas que nascem', () => {
  const itens = [
    it({ id: 'a', amount_cents: 1000 }),
    it({ id: 'b', amount_cents: 500, installment_no: 1, installments: 2 }),
    it({ id: 'c', kind: 'income', amount_cents: 300, nature: 'estorno' }),
    it({ id: 'd', status: 'approved', amount_cents: 9999 }),
  ];
  assert.deepEqual(totais(itens, new Set(['a', 'b', 'c', 'd']), true),
    { quantos: 3, saiCents: 1500, entraCents: 300, compras: 1 });
});
