import assert from 'node:assert/strict';
import { test } from 'node:test';

import { mesDoCorte, veioDe, type MesProjetado } from './forecast-months.ts';

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

/**
 * A corrente do acumulado fecha: o começo de um mês é o fim do anterior.
 *
 * Esta é a conta que o dono do produto faz na planilha, e a razão de ele não conseguir usar a
 * tela antes: com salário caindo num mês e fatura vencendo no começo do outro, ler cada mês
 * isolado dá um número que nunca existiu na conta dele.
 *
 * Os números são de produção, 10/09/2026 — setembro abre nos R$ 0,72 que ele tem em conta.
 */
test('veioDe encadeia: o começo de um mês é a sobra do anterior', () => {
  const meses: MesProjetado[] = [
    { mes: '2026-09', sai: 185664, entra: 114800, saldo: -70792, parcial: true, primeiroNegativo: '2026-09-10', de: '2026-09-01', ate: '2026-09-30' },
    { mes: '2026-10', sai: 780037, entra: 756652, saldo: -94177, parcial: false, primeiroNegativo: '2026-10-01', de: '2026-10-01', ate: '2026-10-31' },
    { mes: '2026-11', sai: 684516, entra: 756652, saldo: -22041, parcial: false, primeiroNegativo: '2026-11-01', de: '2026-11-01', ate: '2026-11-30' },
    { mes: '2026-12', sai: 670505, entra: 756652, saldo: 64106, parcial: false, primeiroNegativo: null, de: '2026-12-01', ate: '2026-12-31' },
  ];

  // O primeiro mês não tem anterior: ele abre com o dinheiro que está na conta HOJE, antes dos
  // vencimentos de hoje. Não é o saldo do dia 0 (que já desconta a fatura vencendo), nem zero.
  assert.equal(veioDe(meses[0]), 72);

  for (let i = 1; i < meses.length; i++) {
    assert.equal(
      veioDe(meses[i]),
      meses[i - 1].saldo,
      `${meses[i].mes} não começa onde ${meses[i - 1].mes} terminou`
    );
  }
});
