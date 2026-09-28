import assert from 'node:assert/strict';
import test from 'node:test';
import { compraDoRegistro, compraParaRevisaoDaParcela, edicaoEscopadaDaCompra, mudarParcelas, payloadDaCompra, validaCompra, type CompraGravada } from './compra.ts';

// Uma compra de 10x de R$ 100 com as 3 primeiras pagas.
const tv: CompraGravada = {
  id: 'p1', description: 'TV', merchant: null, category: 'casa', account_id: 'conta', total_cents: 100000,
  installments: 10, first_occurred_at: '2026-06-05', installment_cents: 10000, paid: 3, locked: 3,
  locked_cents: 30000, locked_paid: 3, locked_in_invoice: 0, last_locked_no: 3, paid_floor: 0,
};

test('Com parcela paga o número muda, só não fica abaixo da última paga nem vira à vista', () => {
  const f = compraDoRegistro(tv);
  assert.deepEqual(validaCompra(f).faixa, { min: 3, max: 72 });
  assert.deepEqual(validaCompra(compraDoRegistro({ ...tv, paid: 0, locked: 0, locked_cents: 0, locked_paid: 0, last_locked_no: 0 })).faixa, { min: 1, max: 72 });
  assert.deepEqual(validaCompra(compraDoRegistro({ ...tv, last_locked_no: 1, locked: 1 })).faixa.min, 2, 'à vista fica fora');
});

test('Data e conta mudam fora do cartão; com parcela paga na fatura, não', () => {
  assert.equal(validaCompra(compraDoRegistro(tv)).dataLivre, true);
  assert.equal(validaCompra(compraDoRegistro({ ...tv, locked_in_invoice: 1 })).dataLivre, false);
});

test('As já pagas vão do piso (paga com a fatura) ao número de parcelas', () => {
  const f = compraDoRegistro({ ...tv, paid_floor: 2 });
  assert.equal(validaCompra({ ...f, pagas: 1 }).pagasOk, false);
  assert.equal(validaCompra({ ...f, pagas: 2 }).pagasOk, true);
  assert.equal(validaCompra({ ...f, pagas: 11 }).pagasOk, false);
  // encolher o número leva as pagas junto
  assert.equal(mudarParcelas({ ...f, pagas: 8 }, 6).pagas, 6);
});

test('O total mínimo permite corrigir também as parcelas já pagas quando Todas for escolhido', () => {
  const f = compraDoRegistro(tv);
  assert.equal(validaCompra({ ...f, totalCents: 9 }).totalOk, false);
  assert.equal(validaCompra({ ...f, totalCents: 10 }).totalOk, true);
  assert.equal(edicaoEscopadaDaCompra({ ...f, totalCents: 10 }, tv, 'all').kind, 'scope');
  // Mudar a estrutura ainda usa o contrato antigo, que conserva valores pagos.
  assert.equal(validaCompra({ ...f, installments: 3, totalCents: 30000 }).totalOk, true);
  assert.equal(edicaoEscopadaDaCompra({ ...f, installments: 3, totalCents: 10 }, tv, 'all').kind, 'structural-rejection');
});

test('O salvar só manda as pagas quando elas mudaram', () => {
  const f = compraDoRegistro(tv);
  assert.equal(payloadDaCompra(f, '2026-06-05').paidInstallments, null);
  assert.equal(payloadDaCompra({ ...f, pagas: 5 }, '2026-06-05').paidInstallments, 5);
  assert.equal(payloadDaCompra({ ...f, merchant: '  ' }, '2026-06-05').merchant, null);
});

test('Cada parcela digitada segue o número novo; as pagas não mudam de valor', () => {
  const f = { ...compraDoRegistro(tv), unidade: 'parcela' as const, parcelaCents: 5000 };
  // 3 pagas (30.000) + 9 em aberto de 5.000
  assert.equal(mudarParcelas(f, 12).totalCents, 30000 + 9 * 5000);
});

test('Ao escolher a compra toda no Salvar, o rascunho da parcela chega inteiro à revisão', () => {
  const revisao = compraParaRevisaoDaParcela(tv, {
    installment_no: 5, occurred_at: '2026-10-05', amount_cents: 10000, description: 'TV (5/10)',
  }, {
    occurred_at: '2026-10-30', amount_cents: 12000, description: 'TV nova', merchant: 'Loja', category: 'eletrônicos',
  });
  assert.equal(revisao.inicio, '30/06/2026');
  assert.equal(revisao.totalCents, 30000 + 7 * 12000);
  assert.equal(revisao.description, 'TV nova');
  assert.equal(revisao.merchant, 'Loja');
  assert.equal(revisao.category, 'eletrônicos');
  assert.equal(revisao.pagas, 3);

  const intocada = compraParaRevisaoDaParcela(tv, {
    installment_no: 5, occurred_at: '2026-10-05', amount_cents: 10000, description: 'TV (5/10)',
  }, {
    occurred_at: '2026-10-05', amount_cents: 10000, description: 'TV', merchant: null, category: 'casa',
  });
  assert.equal(intocada.totalCents, tv.total_cents);
  assert.equal(intocada.inicio, '05/06/2026');
  const rotulada = compraParaRevisaoDaParcela(tv, {
    installment_no: 5, occurred_at: '2026-10-05', amount_cents: 10000, description: 'TV (5/10)',
  }, {
    occurred_at: '2026-10-05', amount_cents: 10000, description: 'TV (5/10)', merchant: null, category: 'casa',
  });
  assert.equal(rotulada.description, 'TV', 'o número da parcela não entra no título da compra');
});

test('O total escolhido para esta ou futuras parcelas chega como total do plano, sem transformar em valor mensal', () => {
  const f = { ...compraDoRegistro(tv), totalCents: 112001, description: 'TV nova' };
  assert.deepEqual(edicaoEscopadaDaCompra(f, tv, 'future'), {
    kind: 'scope', lastDay: false, patch: { total_cents: 112001, description: 'TV nova' },
  });
  assert.deepEqual(edicaoEscopadaDaCompra(f, tv, 'one'), {
    kind: 'scope', lastDay: false, patch: { total_cents: 112001, description: 'TV nova' },
  });
});

test('Cada parcela aplica o valor digitado em cada linha do alcance, inclusive as pagas em Todas', () => {
  const f = { ...compraDoRegistro(tv), unidade: 'parcela' as const, parcelaCents: 12000, totalCents: 114000 };
  assert.deepEqual(edicaoEscopadaDaCompra(f, tv, 'all'), {
    kind: 'scope', lastDay: false, patch: { amount_cents: 12000 },
  });
  assert.deepEqual(edicaoEscopadaDaCompra(f, tv, 'future'), {
    kind: 'scope', lastDay: false, patch: { amount_cents: 12000 },
  });
  const entirelyPaid = { ...tv, installments: 3, total_cents: 30000, paid: 3, locked: 3 };
  const paidForm = { ...compraDoRegistro(entirelyPaid), unidade: 'parcela' as const, parcelaCents: 9000 };
  assert.deepEqual(edicaoEscopadaDaCompra(paidForm, entirelyPaid, 'all'), {
    kind: 'scope', lastDay: false, patch: { amount_cents: 9000 },
  });
});

test('Quantidade é contrato: escopos limitados explicam a impossibilidade', () => {
  const f = { ...compraDoRegistro(tv), installments: 12 };
  assert.equal(edicaoEscopadaDaCompra(f, tv, 'one').kind, 'structural-rejection');
  assert.equal(edicaoEscopadaDaCompra(f, tv, 'future').kind, 'structural-rejection');
  assert.equal(edicaoEscopadaDaCompra(f, tv, 'all').kind, 'contract');
});

test('Com 3 pagas a data muda nos três alcances, a partir da parcela de referência', () => {
  const f = { ...compraDoRegistro(tv), inicio: '20/06/2026' };
  // referência na 4ª: a mesma distância da primeira nova (20/06 + 3 meses)
  assert.deepEqual(edicaoEscopadaDaCompra(f, tv, 'future', 4), { kind: 'scope', lastDay: false, patch: { occurred_at: '2026-09-20' } });
  assert.deepEqual(edicaoEscopadaDaCompra(f, tv, 'one', 4), { kind: 'scope', lastDay: false, patch: { occurred_at: '2026-09-20' } });
  assert.deepEqual(edicaoEscopadaDaCompra(f, tv, 'all', 4), { kind: 'scope', lastDay: false, patch: { occurred_at: '2026-09-20' } },
    'pagas no banco andam em Todas');
  assert.equal(edicaoEscopadaDaCompra(f, { ...tv, locked_in_invoice: 1 }, 'all', 4).kind, 'protected-rejection',
    'a paga numa fatura de cartão segura a data');
});

test('Último dia de todo mês: regra no alcance, data própria em Só esta', () => {
  const f = { ...compraDoRegistro(tv), inicio: '30/06/2026', ultimoDia: true };
  assert.deepEqual(edicaoEscopadaDaCompra(f, tv, 'future', 4), { kind: 'scope', lastDay: true, patch: { occurred_at: '2026-09-30' } });
  assert.deepEqual(edicaoEscopadaDaCompra(f, tv, 'one', 4), { kind: 'scope', lastDay: false, patch: { occurred_at: '2026-09-30' } });
  // só a intenção, sem trocar de mês: nada a mover antes, o banco alinha os dias
  const mesmoMes = { ...compraDoRegistro({ ...tv, first_occurred_at: '2026-06-30' }), ultimoDia: true };
  assert.deepEqual(edicaoEscopadaDaCompra(mesmoMes, { ...tv, first_occurred_at: '2026-06-30' }, 'all', 4), { kind: 'scope', lastDay: true, patch: {} });
});

test('Todas inclui parcela paga fora do cartão; fatura protegida continua bloqueada', () => {
  const f = { ...compraDoRegistro(tv), totalCents: 110000 };
  assert.deepEqual(edicaoEscopadaDaCompra(f, tv, 'all'), {
    kind: 'scope', lastDay: false, patch: { total_cents: 110000 },
  });
  assert.equal(edicaoEscopadaDaCompra(f, { ...tv, locked_in_invoice: 1 }, 'all').kind, 'protected-rejection');
  assert.equal(edicaoEscopadaDaCompra(compraDoRegistro(tv), tv, 'all').kind, 'no-op');
});
