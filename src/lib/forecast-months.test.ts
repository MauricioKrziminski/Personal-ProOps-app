import assert from 'node:assert/strict';
import { test } from 'node:test';

import { mesDoCorte, type MesProjetado } from './forecast-months.ts';

/**
 * ⚠️ **As 9 asserções do AGRUPAMENTO saíram daqui em 10/09/2026.**
 *
 * `agruparPorMes` virou `private.month_group` (`20260911001500`) porque o modo Mês baixava
 * 3.651 linhas diárias para desenhar ~120 números — 288 KB contra 13 KB. As asserções foram
 * junto, com as MESMAS fixtures, para `supabase/tests/month_forecast.sql`: aritmética de
 * dinheiro não muda de casa sem a trava.
 *
 * O que sobrou aqui é `mesDoCorte`, que não é aritmética — é a regra de QUANDO avisar que a
 * linha deixou de ser lançamento e passou a sair da regra da recorrência.
 */
function mes(m: string): MesProjetado {
  return { mes: m, entra: 0, sai: 0, saldo: 1, primeiroNegativo: null, parcial: false };
}

test('o corte é o mês da cobertura, e só quando há mês além dele', () => {
  const meses = [mes('2026-11'), mes('2026-12'), mes('2027-01')];
  assert.equal(mesDoCorte(meses, '2026-12-09'), '2026-12');
  // tudo dentro da cobertura: não há o que avisar
  assert.equal(mesDoCorte(meses, '2027-06-01'), null);
  assert.equal(mesDoCorte(meses, null), null);
});

test('sem meses não há corte', () => {
  assert.equal(mesDoCorte([], '2026-12-09'), null);
});
