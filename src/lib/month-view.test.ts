/** `node --test` (Node 24 faz type stripping nativo). */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  BUCKETS,
  bucketTitle,
  cashLabel,
  gapExplanation,
  groupLabel,
  heroFigure,
  horizonWarning,
  lineSubtitle,
  sharePercent,
  undocumentedWarning,
} from './month-view.ts';

test('os quatro blocos têm título e a ordem é a da planilha', () => {
  assert.deepEqual([...BUCKETS], ['entrada', 'fixa', 'parcela', 'variavel']);
  assert.deepEqual(BUCKETS.map(bucketTitle), [
    'Entradas',
    'Contas fixas',
    'Parcelas e financiamentos',
    'Gastos do mês',
  ]);
});

test('o subtítulo monta o que existe e não deixa separador solto', () => {
  assert.equal(
    lineSubtitle({ installment_no: 9, installments_total: 48, due_day: 23, method_label: 'Itaú', category: 'transporte' }),
    'parcela 9 de 48 · dia 23 · Itaú',
  );
  // lançamento avulso do WhatsApp: sem parcela e sem conta
  assert.equal(
    lineSubtitle({ installment_no: null, installments_total: null, due_day: 8, method_label: null, category: 'mercado' }),
    'dia 8',
  );
  // categoria só quando a seção pede
  assert.equal(
    lineSubtitle({ installment_no: null, installments_total: null, due_day: 8, method_label: 'Nubank', category: 'mercado' }, { comCategoria: true }),
    'dia 8 · Nubank · mercado',
  );
  assert.equal(
    lineSubtitle({ installment_no: null, installments_total: null, due_day: null, method_label: null, category: null }),
    '',
  );
  // parcela sem total não escreve "parcela 9 de null"
  assert.equal(
    lineSubtitle({ installment_no: 9, installments_total: null, due_day: 3, method_label: null, category: null }),
    'dia 3',
  );
});

test('o percentual sai de pontos-base inteiros, inclusive nos extremos', () => {
  assert.equal(sharePercent(0), 0);
  assert.equal(sharePercent(10000), 100);
  assert.equal(sharePercent(3647), 36);
  // mês sem saída: o SQL devolve 0 em vez de dividir por zero
  assert.equal(sharePercent(undefined as unknown as number), 0);
});

test('o corte por natureza traduz a chave crua do SQL; os outros usam o rótulo', () => {
  assert.equal(groupLabel('natureza', 'parcela', 'parcela'), 'Parcelas e financiamentos');
  assert.equal(groupLabel('meio', 'uuid-da-conta', 'Nubank'), 'Nubank');
  assert.equal(groupLabel('categoria', 'mercado', 'mercado'), 'mercado');
});

test('passado, presente e futuro pedem verbos diferentes para o mesmo caixa', () => {
  assert.equal(cashLabel('2026-08', '2026-09', 'agosto'), 'Terminei agosto com');
  assert.equal(cashLabel('2026-09', '2026-09', 'setembro'), 'Tenho hoje');
  assert.equal(cashLabel('2026-11', '2026-09', 'novembro'), 'Devo terminar com');
});

test('o aviso do horizonte fala mesmo quando nada foi gerado', () => {
  assert.match(horizonWarning('dezembro de 2026'), /dezembro de 2026/);
  assert.match(horizonWarning(null), /Nenhuma conta fixa foi gerada/);
});

test('parcela declarada sem lançamento: singular e plural', () => {
  assert.match(undocumentedWarning(1), /^Uma parcela/);
  assert.match(undocumentedWarning(8), /^8 parcelas/);
});

test('a diferença entre resultado e caixa é explicada, e some quando não existe', () => {
  // R$ 1.000 de abertura + R$ 500 de resultado = R$ 1.500; o caixa fechou em R$ 1.200
  assert.equal(gapExplanation(100000, 50000, 150000), null);
  const frase = gapExplanation(100000, 50000, 120000);
  // `formatBRL` usa espaço NÃO separável entre "R$" e o número — casar o valor, não a string toda
  assert.ok(frase?.includes('300,00'), frase ?? 'sem frase');
  // a diferença para o outro lado também é explicada
  assert.ok(gapExplanation(100000, 50000, 180000)?.includes('300,00'));
});

test('o herói mostra caixa quando ele existe e resultado quando não existe', () => {
  // mês passado: o caixa foi apurado
  assert.deepEqual(heroFigure({ closingCashCents: 480000, resultCents: -62085 }, '2026-08', '2026-09', 'agosto'), {
    label: 'Terminei agosto com',
    cents: 480000,
    isCash: true,
  });
  // mês corrente
  assert.equal(heroFigure({ closingCashCents: 480000, resultCents: 1 }, '2026-09', '2026-09', 'setembro').label, 'Tenho hoje');
  // mês futuro: caixa não se apura, então o destaque é o resultado — e o rótulo diz isso
  assert.deepEqual(heroFigure({ closingCashCents: null, resultCents: -37333 }, '2026-11', '2026-09', 'novembro'), {
    label: 'Resultado previsto de novembro',
    cents: -37333,
    isCash: false,
  });
});
