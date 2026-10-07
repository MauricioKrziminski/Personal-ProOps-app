import assert from 'node:assert/strict';
import test from 'node:test';

import { deslocamentoDaCarencia } from './carencia.ts';
import { ancoraDoContrato, parcelasPagasNoCiclo, proximaDoContrato } from './finance-form.ts';

const pausas = [{ from_installment_no: 10, months: 2 }, { from_installment_no: 5, months: 3 }];

test('deslocamentoDaCarencia soma só as carências que começam até a parcela', () => {
  assert.equal(deslocamentoDaCarencia(pausas, 4), 0);
  assert.equal(deslocamentoDaCarencia(pausas, 5), 3);
  assert.equal(deslocamentoDaCarencia(pausas, 9), 3);
  assert.equal(deslocamentoDaCarencia(pausas, 10), 5);
  assert.equal(deslocamentoDaCarencia(undefined, 10), 0);
});

test('a data mostrada soma o deslocamento e a salva o subtrai: sem deslocar duas vezes', () => {
  const pagas = 8;
  const desloc = deslocamentoDaCarencia([{ from_installment_no: 9, months: 3 }], pagas + 1);
  // âncora 05/02/2026: a 9ª seria 05/10/2026; com 3 meses de carência vai a 05/01/2027
  assert.equal(proximaDoContrato('2026-02-05', pagas + desloc, 5), '2027-01-05');
  // a pessoa escolhe a data mostrada: a âncora volta a ser a do contrato, não a deslocada
  assert.equal(ancoraDoContrato('2027-01-05', pagas + desloc), '2026-02-05');
});

test('parcelasPagasNoCiclo respeita a carência de cada parcela', () => {
  const p = [{ from_installment_no: 3, months: 1 }];
  const l = parcelasPagasNoCiclo('2026-01-05', 5, 1, 3, '2026-04-01', '2026-04-30', p);
  // a 3ª seria 05/03, com 1 mês de carência cai em 05/04
  assert.deepEqual(l, [{ no: 3, dataISO: '2026-04-05' }]);
});
