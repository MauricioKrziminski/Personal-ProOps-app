import assert from 'node:assert/strict';
import { test } from 'node:test';

import { alcancesDoApagar, alvoDoLancamento, fraseDoEstrago, lerPrevia, textoDoApagado } from './apagar-com-alcance.ts';

const brl = (c: number) => `R$ ${(c / 100).toFixed(2).replace('.', ',')}`;

test('a prévia lê o dinheiro como TEXTO e recusa formato estranho', () => {
  const p = lerPrevia({ apagadas: 8, pagas_apagadas: 8, soma_pagas_cents: '959000', contas: ['Nubank'], desde: '2026-05-10', apaga_contrato: false });
  assert.equal(p.somaPagasCents, 959000);
  assert.throws(() => lerPrevia({ apagadas: 1, pagas_apagadas: 0, soma_pagas_cents: '12.5', contas: [], desde: null, apaga_contrato: false }));
  assert.throws(() => lerPrevia(null));
});

test('sem paga não há segunda confirmação; com paga a frase diz quanto, de onde e desde quando', () => {
  assert.equal(fraseDoEstrago(lerPrevia({ apagadas: 3, pagas_apagadas: 0, soma_pagas_cents: '0', contas: [], desde: null, apaga_contrato: false }), brl), null);
  const frase = fraseDoEstrago(lerPrevia({ apagadas: 8, pagas_apagadas: 8, soma_pagas_cents: '959000', contas: ['Nubank'], desde: '2026-05-10', apaga_contrato: false }), brl);
  assert.equal(frase, 'Isso apaga 8 lançamentos já pagos (R$ 9590,00) e muda o saldo da Nubank e o histórico desde maio de 2026.');
  const duas = fraseDoEstrago(lerPrevia({ apagadas: 2, pagas_apagadas: 1, soma_pagas_cents: '1000', contas: ['BB', 'Itaú'], desde: '2026-09-01', apaga_contrato: false }), brl);
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

test('o banco recusa dívida+futuras e lembrete+futuras: a pergunta não oferece', () => {
  assert.deepEqual(alcancesDoApagar('debt'), ['all']);
  assert.deepEqual(alcancesDoApagar('reminder'), ['one', 'all']);
  assert.equal(alcancesDoApagar('occurrence'), undefined);
});
