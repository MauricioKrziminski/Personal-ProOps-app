import assert from 'node:assert/strict';
import { test } from 'node:test';
import { comumDepoisDeSalvar, comumParaSerie, hrefDoLancar, hrefDoResultadoDaConversao, opcoesDaConversao, hrefDoLancamento, papelDaTransacao, temPassadoDoParam, TIPOS_DE_LANCAMENTO } from './lancar.ts';

const c = { kind: 'transfer' as const, descricao: 'Aluguel', valorCents: 150000, contaId: 'cc', dataBR: '05/10/2026', categoria: 'moradia' };

test('F01: editar taxa vinculada abre sua compra; taxa antiga sem vínculo continua independente', () => {
  assert.equal(hrefDoLancamento({ id: 'fee', pix_fee_for_transaction_id: 'purchase' }, { month: '2026-10' }).params.id, 'purchase');
  assert.equal(hrefDoLancamento({ id: 'legacy-fee' }).params.id, 'legacy-fee');
});

test('a conversão abre o registro devolvido pelo banco, inclusive financiamento sem transação', () => {
  assert.deepEqual(hrefDoResultadoDaConversao({ tipo: 'financiamento', dados: {} }, { ids: ['debt'] }),
    { pathname: '/finance/debts', params: { id: 'debt' } });
  assert.deepEqual(hrefDoResultadoDaConversao({ tipo: 'lancamento', dados: {} }, { ids: ['tx', 'juros', 'fatura'] }),
    { pathname: '/finance/[txId]', params: { txId: 'tx' } });
  assert.deepEqual(hrefDoResultadoDaConversao({ tipo: 'parcelada', dados: {} }, { ids: ['plan', 'tx1', 'tx2', 'fatura'] }),
    { pathname: '/finance/[txId]', params: { txId: 'tx1' } }, 'o ID do plano não é uma transação');
});

test('a série convertida abre suas ocorrências no mês local do início escolhido', () => {
  const anterior = process.env.TZ;
  try {
    process.env.TZ = 'America/Sao_Paulo';
    assert.deepEqual(hrefDoResultadoDaConversao({ tipo: 'recorrente', dados: { dtstart: '2026-11-01T02:00:00Z', next_run_at: '2026-12-01T03:00:00Z' } }, { ids: ['serie'] }),
      { pathname: '/finance/transactions', params: { recurringId: 'serie', month: '2026-10' } });
  } finally {
    if (anterior === undefined) delete process.env.TZ; else process.env.TZ = anterior;
  }
});

test('sem ID de resultado a conversão abre a lista válida, nunca a origem removida', () => {
  assert.deepEqual(hrefDoResultadoDaConversao({ tipo: 'financiamento', dados: {} }, { ids: [] }), { pathname: '/finance/debts', params: {} });
  assert.deepEqual(hrefDoResultadoDaConversao({ tipo: 'recorrente', dados: {} }, { ids: [] }), { pathname: '/finance/recurring', params: {} });
  assert.deepEqual(hrefDoResultadoDaConversao({ tipo: 'lancamento', dados: {} }, { ids: [] }), { pathname: '/finance/transactions', params: {} });
});

test('as quatro opções da spec, e só as que mudam alguma coisa', () => {
  const rotulos = (o: Parameters<typeof opcoesDaConversao>[0]) => opcoesDaConversao(o).map((x) => x.label);
  assert.deepEqual(rotulos({ tipo: 'transacao', id: 't', papel: 'avulsa', temPassado: false }), ['Converter', 'Manter e criar um novo']);
  assert.deepEqual(rotulos({ tipo: 'transacao', id: 't', papel: 'ocorrencia', temPassado: true }),
    ['Só esta', 'Desta em diante', 'Todas, apagando as anteriores', 'Manter o atual e criar um novo']);
  assert.deepEqual(rotulos({ tipo: 'serie', id: 's', papel: 'registro', temPassado: false }), ['Converter', 'Manter o atual e criar um novo']);
  assert.deepEqual(rotulos({ tipo: 'transacao', id: 't', papel: 'parcela', temPassado: true }),
    ['Desta em diante', 'Todas, apagando as anteriores', 'Manter o atual e criar um novo'], 'parcela não tem "Só esta"');
  assert.equal(opcoesDaConversao({ tipo: 'divida', id: 'd', papel: 'registro', temPassado: true }).find((o) => o.alcance === 'todas')?.destrutiva, true);
  // sem passado, "Converter" é o "todas" da série (não há o que apagar)
  assert.equal(opcoesDaConversao({ tipo: 'serie', id: 's', papel: 'registro', temPassado: false })[0].alcance, 'todas');
  assert.equal(opcoesDaConversao({ tipo: 'transacao', id: 't', papel: 'avulsa', temPassado: false })[0].alcance, 'converter');
});

test('sem saber se há passado, a opção destrutiva aparece (e é confirmada)', () => {
  assert.equal(temPassadoDoParam(undefined), true);
  assert.equal(temPassadoDoParam('1'), true);
  assert.equal(temPassadoDoParam('0'), false);
  const o = opcoesDaConversao({ tipo: 'serie', id: 's', papel: 'registro', temPassado: temPassadoDoParam(undefined) });
  assert.ok(o.some((x) => x.alcance === 'todas' && x.destrutiva));
});

test('"Salvar e criar outro" mantém tipo, conta e data, e limpa o resto', () => {
  assert.deepEqual(comumDepoisDeSalvar(c), { kind: 'transfer', descricao: '', valorCents: 0, contaId: 'cc', dataBR: '05/10/2026', categoria: null });
  assert.deepEqual(comumDepoisDeSalvar({ ...c, estabelecimento: 'Padaria' }), comumDepoisDeSalvar(c), 'o estabelecimento também sai');
});

test('transferência não existe na recorrente: vira gasto', () => {
  assert.equal(comumParaSerie(c).kind, 'expense');
  assert.equal(comumParaSerie({ ...c, kind: 'income' }).kind, 'income');
});

test('o seletor tem três opções e o link carrega o tipo', () => {
  assert.deepEqual(TIPOS_DE_LANCAMENTO.map((t) => t.label), ['Uma vez', 'Recorrente', 'Financiamento']);
  assert.deepEqual(hrefDoLancar('recorrente', { id: 'r1' }), { pathname: '/finance/lancar', params: { tipo: 'recorrente', id: 'r1' } });
});

test('o papel do lançamento sai do registro: série, compra parcelada, dívida ou avulso', () => {
  assert.deepEqual([{ recurring_id: 'r' }, { installment_plan_id: 'p' }, { debt_id: 'd' }, {}].map(papelDaTransacao), ['ocorrencia', 'parcela', 'pagamento', 'avulsa']);
  // só o avulso SABE que não tem passado; os outros deixam o hospedeiro assumir que tem
  assert.equal(hrefDoLancamento({ id: 't' }).params.passado, '0');
  assert.equal('passado' in hrefDoLancamento({ id: 't', recurring_id: 'r' }).params, false);
});

test('F09 comum conserva filho compatível em conversão e limpa depois de salvar ou transferir', () => {
  const child = '33333333-3333-4333-8333-333333333333';
  const common = { kind: 'expense' as const, descricao: 'Compra', valorCents: 100, contaId: null,
    dataBR: '03/10/2026', categoria: 'casa', subcategory_id: child };
  assert.equal(comumParaSerie(common).subcategory_id, child);
  assert.equal(comumDepoisDeSalvar(common).subcategory_id, null);
  assert.equal(comumParaSerie({ ...common, kind: 'transfer' }).subcategory_id, null);
  const { subcategory_id, ...legacy } = common;
  assert.equal(Object.hasOwn(comumDepoisDeSalvar(legacy), 'subcategory_id'), false);
});
