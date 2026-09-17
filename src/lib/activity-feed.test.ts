import assert from 'node:assert/strict';
import { test } from 'node:test';

import { metaDoRegistro, paresDaConversa, type LinhaDaAtividade } from './activity-feed.ts';

const linha = (o: Partial<LinhaDaAtividade>): LinhaDaAtividade => ({
  source_message_id: 'app:1',
  executed_at: '2026-09-17T12:00:00-03:00',
  channel: 'app',
  input_kind: 'text',
  origin_text: 'gastei 45 no mercado',
  session_id: 'sessao-1',
  action_index: 0,
  action_type: 'create_expense',
  result_id: 'tx-1',
  record: { kind: 'transaction', id: 'tx-1', title: 'Mercado', amount_cents: 4500, tx_kind: 'expense', category: 'mercado' },
  ...o,
});

test('uma fala com duas ações vira UM balão com dois cards, na ordem das ações', () => {
  const pares = paresDaConversa(
    [
      linha({ action_index: 1, action_type: 'create_reminder', result_id: 'r-1', record: { kind: 'reminder', id: 'r-1', title: 'Aluguel', next_run_at: '2026-10-05T12:00:00Z' } }),
      linha({}),
    ],
    '2026-09-17'
  );
  assert.equal(pares.length, 1);
  assert.equal(pares[0].texto, 'gastei 45 no mercado');
  assert.equal(pares[0].dia, 'hoje');
  assert.deepEqual(pares[0].cards.map((c) => c.registro?.kind), ['transaction', 'reminder']);
  assert.deepEqual(pares[0].cards[0].destino, { pathname: '/finance/[txId]', params: { txId: 'tx-1' } });
  assert.deepEqual(pares[0].cards[1].destino, { pathname: '/reminder-form', params: { id: 'r-1' } });
});

test('falas diferentes viram pares diferentes, a mais recente primeiro', () => {
  const pares = paresDaConversa(
    [
      linha({ source_message_id: 'wamid.a', channel: 'whatsapp', executed_at: '2026-09-16T10:00:00-03:00', session_id: null }),
      linha({ source_message_id: 'app:2', executed_at: '2026-09-17T09:00:00-03:00' }),
    ],
    '2026-09-17'
  );
  assert.deepEqual(pares.map((p) => p.chave), ['app:2', 'wamid.a']);
  assert.equal(pares[1].dia, 'ontem');
  assert.equal(pares[1].canal, 'whatsapp');
  assert.equal(pares[1].sessao, null);
});

test('registro que sumiu depois de criado diz que foi apagado; o que não sabemos ler não afirma nada', () => {
  const [apagado] = paresDaConversa([linha({ action_type: 'create_note', record: null })], '2026-09-17');
  assert.equal(apagado.cards[0].rotulo, 'Nota apagada depois');
  assert.equal(apagado.cards[0].destino, null);
  const [regra] = paresDaConversa([linha({ action_type: 'set_rule', record: null })], '2026-09-17');
  assert.equal(regra.cards[0].rotulo, 'Regra salva');
  const [delecao] = paresDaConversa([linha({ action_type: 'delete_transaction', record: null })], '2026-09-17');
  assert.equal(delecao.cards[0].verbo, 'apagou');
  assert.equal(delecao.cards[0].rotulo, 'Lançamento apagado');
});

test('alteração é marcada como alteração', () => {
  const [p] = paresDaConversa([linha({ action_type: 'update_transaction' })], '2026-09-17');
  assert.equal(p.cards[0].verbo, 'alterou');
});

test('texto vazio vira nulo — a tela decide o que dizer, nunca inventa a frase', () => {
  const [p] = paresDaConversa([linha({ origin_text: '   ', input_kind: 'image' })], '2026-09-17');
  assert.equal(p.texto, null);
  assert.equal(p.entrada, 'image');
});

test('a linha pequena do registro diz o que ele é, sem inventar', () => {
  assert.equal(metaDoRegistro({ kind: 'transaction', id: 't', title: 'Mercado', category: 'mercado', account: 'Nubank' }), 'mercado · Nubank');
  assert.equal(metaDoRegistro({ kind: 'transaction', id: 't', title: 'Mercado', category: null, account: null }), 'lançamento');
  assert.equal(metaDoRegistro({ kind: 'installment_plan', id: 'p', title: 'TV', installments: 10, category: 'eletrônicos' }), '10× · eletrônicos');
  assert.equal(metaDoRegistro({ kind: 'account', id: 'a', title: 'Nubank', account_type: 'credit_card' }), 'cartão');
  assert.equal(metaDoRegistro({ kind: 'note', id: 'n', title: 'Wifi' }), 'nota');
  assert.match(metaDoRegistro({ kind: 'reminder', id: 'r', title: 'Aluguel', next_run_at: '2026-10-05T12:00:00Z' }), /^seg, 5 out · \d{2}:\d{2}$/);
});
