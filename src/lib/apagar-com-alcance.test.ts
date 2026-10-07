import assert from 'node:assert/strict';
import { test } from 'node:test';

import { alvoDoLancamento, ehContrato, escolhasDoApagar, kindDoApagar, fraseDoEstrago, lerPrevia, textoDoApagado } from './apagar-com-alcance.ts';

const brl = (c: number) => `R$ ${(c / 100).toFixed(2).replace('.', ',')}`;

test('a prévia lê o dinheiro como TEXTO e recusa formato estranho', () => {
  const p = lerPrevia({ apagadas: 8, pagas_apagadas: 8, soma_pagas_cents: '959000', contas: ['Nubank'], desde: '2026-05-10', apaga_contrato: false });
  assert.equal(p.somaPagasCents, 959000);
  assert.throws(() => lerPrevia({ apagadas: 1, pagas_apagadas: 0, soma_pagas_cents: '12.5', contas: [], desde: null, apaga_contrato: false }));
  assert.throws(() => lerPrevia(null));
});

test('sem paga não há segunda confirmação; com paga a frase diz quanto, de onde e desde quando', () => {
  assert.equal(fraseDoEstrago(lerPrevia({ apagadas: 3, pagas_apagadas: 0, soma_pagas_cents: '0', contas: [], desde: null, apaga_contrato: false }), brl, 'plan'), null);
  const frase = fraseDoEstrago(lerPrevia({ apagadas: 8, pagas_apagadas: 8, soma_pagas_cents: '959000', contas: ['Nubank'], desde: '2026-05-10', apaga_contrato: false }), brl, 'plan');
  assert.equal(frase, 'Isso apaga 8 lançamentos já pagos (R$ 9590,00) e muda o saldo da Nubank e o histórico desde maio de 2026.');
  const duas = fraseDoEstrago(lerPrevia({ apagadas: 2, pagas_apagadas: 1, soma_pagas_cents: '1000', contas: ['BB', 'Itaú'], desde: '2026-09-01', apaga_contrato: false }), brl, 'plan');
  assert.equal(duas, 'Isso apaga 1 lançamento já pago (R$ 10,00) e muda o saldo das contas BB e Itaú e o histórico desde setembro de 2026.');
});

test('o toast conta o que saiu', () => {
  const p = (n: number, contrato = false) => lerPrevia({ apagadas: n, pagas_apagadas: 0, soma_pagas_cents: '0', contas: [], desde: null, apaga_contrato: contrato });
  assert.equal(textoDoApagado(p(1)), '1 lançamento apagado.');
  assert.equal(textoDoApagado(p(5)), '5 lançamentos apagados.');
  assert.equal(textoDoApagado(p(0, true)), 'Apagado por completo.');
});

test('vira_avista e apaga_contrato chegam à prévia', () => {
  const p = lerPrevia({ apagadas: 3, pagas_apagadas: 0, soma_pagas_cents: '0', contas: [], desde: null, apaga_contrato: false, vira_avista: true });
  assert.equal(p.viraAvista, true);
  assert.equal(lerPrevia({ apagadas: 1, pagas_apagadas: 0, soma_pagas_cents: '0', contas: [], desde: null, apaga_contrato: true }).viraAvista, false);
});

test('o alvo sai do vínculo do lançamento; avulso não pergunta', () => {
  assert.deepEqual(alvoDoLancamento({ id: 't', recurring_id: 's' }, 'Academia'), { tipo: 'occurrence', id: 't', nome: 'Academia' });
  assert.deepEqual(alvoDoLancamento({ id: 't', installment_plan_id: 'p' }, 'Fone'), { tipo: 'installment', id: 't', nome: 'Fone' });
  assert.deepEqual(alvoDoLancamento({ id: 't', debt_id: 'd' }, 'Moto'), { tipo: 'debt_payment', id: 't', nome: 'Moto' });
  assert.equal(alvoDoLancamento({ id: 't' }, 'Mercado'), null);
});

test('a pergunta deriva kind, contrato e alcances do TIPO (o banco recusa dívida/lembrete + futuras)', () => {
  const esc = (t: Parameters<typeof escolhasDoApagar>[0]) => escolhasDoApagar(t).map((c) => c.scope);
  assert.deepEqual(esc('debt'), ['all']);
  assert.deepEqual(esc('reminder'), ['one', 'all']);
  assert.deepEqual(esc('recurring'), ['future', 'all']);
  assert.deepEqual(esc('plan'), ['future', 'all']);
  for (const t of ['occurrence', 'installment', 'debt_payment'] as const) assert.deepEqual(esc(t), ['one', 'future', 'all']);
});

test('kindDoApagar e ehContrato', () => {
  assert.equal(kindDoApagar('plan'), 'installment');
  assert.equal(kindDoApagar('installment'), 'installment');
  assert.equal(kindDoApagar('debt'), 'payment');
  assert.equal(kindDoApagar('debt_payment'), 'payment');
  assert.equal(kindDoApagar('reminder'), 'reminder');
  assert.equal(kindDoApagar('recurring'), 'occurrence');
  assert.deepEqual((['recurring', 'plan', 'debt', 'occurrence', 'installment', 'debt_payment', 'reminder'] as const).filter(ehContrato), ['recurring', 'plan', 'debt']);
});

test('a confirmação diz vira à vista e apaga contrato, mesmo sem paga', () => {
  const base = { apagadas: 2, pagas_apagadas: 0, soma_pagas_cents: '0', contas: [], desde: null };
  assert.equal(fraseDoEstrago(lerPrevia({ ...base, apaga_contrato: false, vira_avista: true }), brl, 'plan'), 'A compra fica com uma parcela só e vira um lançamento à vista.');
  assert.equal(fraseDoEstrago(lerPrevia({ ...base, apaga_contrato: true }), brl, 'plan'), 'A compra inteira sai.');
  const tudo = fraseDoEstrago(lerPrevia({ ...base, pagas_apagadas: 1, soma_pagas_cents: '1000', apaga_contrato: true }), brl, 'plan');
  assert.equal(tudo, 'Isso apaga 1 lançamento já pago (R$ 10,00). A compra inteira sai.');
  assert.equal(textoDoApagado(lerPrevia({ ...base, apaga_contrato: true })), 'Apagado por completo.');
});

test('a frase do contrato depende do tipo', () => {
  const p = lerPrevia({ apagadas: 2, pagas_apagadas: 0, soma_pagas_cents: '0', contas: [], desde: null, apaga_contrato: true, vira_avista: true });
  assert.equal(fraseDoEstrago(p, brl, 'debt'), 'O financiamento inteiro sai, com os pagamentos.');
  assert.equal(fraseDoEstrago(p, brl, 'debt_payment'), 'O financiamento inteiro sai, com os pagamentos.');
  assert.equal(fraseDoEstrago(p, brl, 'recurring'), 'A série inteira sai.');
  assert.equal(fraseDoEstrago(p, brl, 'occurrence'), 'A série inteira sai.');
  assert.equal(fraseDoEstrago(p, brl, 'installment'), 'A compra fica com uma parcela só e vira um lançamento à vista. A compra inteira sai.');
});

test('a prévia recusa apagadas negativo ou fracionário', () => {
  const ok = { pagas_apagadas: 0, soma_pagas_cents: '0', contas: [], desde: null, apaga_contrato: false };
  assert.throws(() => lerPrevia({ ...ok, apagadas: -1 }));
  assert.throws(() => lerPrevia({ ...ok, apagadas: 1.5 }));
});
