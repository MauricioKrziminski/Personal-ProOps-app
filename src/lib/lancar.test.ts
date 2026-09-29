import assert from 'node:assert/strict';
import { test } from 'node:test';
import { comumDepoisDeSalvar, comumParaSerie, hrefDoLancar, opcoesDaConversao, temPassadoDoParam, TIPOS_DE_LANCAMENTO } from './lancar.ts';

const c = { kind: 'transfer' as const, descricao: 'Aluguel', valorCents: 150000, contaId: 'cc', dataBR: '05/10/2026', categoria: 'moradia' };

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
