import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  anualDeMensal,
  CENARIO_PADRAO,
  lerCenarios,
  mensalDeAnual,
  paraPremissas,
  quandoAtinge,
  simular,
  validar,
  type Premissas,
} from './accumulation.ts';

const base: Premissas = {
  inicialCents: 0, aporteCents: 0, anos: 1, meses: 0, taxa: 0, porMes: false,
  inicio: false, inflacao: 0, rendaCents: 0, retirada: 4,
};

test('exemplo 1: R$ 100/mês a 1% a.m. por 12 meses — fim e início do mês', () => {
  // 1,01^12 = 1,126825030131969 → fim: 100 × (1,126825030… − 1) / 0,01 = 1268,25030… → R$ 1.268,25
  const fim = simular({ ...base, aporteCents: 10000, taxa: 1, porMes: true });
  assert.equal(fim.fimCents, 126825);
  // início do mês: × 1,01 → 1268,25030 × 1,01 = 1280,93280 → R$ 1.280,93
  assert.equal(simular({ ...base, aporteCents: 10000, taxa: 1, porMes: true, inicio: true }).fimCents, 128093);
  // aportado 12 × 100 = 1.200 → rendimento 1.268,25 − 1.200 = 68,25
  assert.equal(fim.aportadoCents, 120000);
  assert.equal(fim.rendimentoCents, 6825);
  assert.equal(fim.curva.length, 13);
  assert.equal(fim.curva[12], fim.fimCents);
});

test('exemplo 2: R$ 1.000 a 12% a.a. por 2 anos — mensal equivalente, não a/12', () => {
  // (1+i)^24 = ((1,12)^(1/12))^24 = 1,12² = 1,2544 → R$ 1.254,40
  assert.equal(simular({ ...base, inicialCents: 100000, anos: 2, taxa: 12 }).fimCents, 125440);
});

test('exemplo 3: taxa zero, R$ 500 + R$ 100/mês por 36 meses', () => {
  // i = 0: 500 + 100 × 36 = 4.100 → R$ 4.100,00 (sem divisão por zero)
  const r = simular({ ...base, inicialCents: 50000, aporteCents: 10000, anos: 3 });
  assert.equal(r.fimCents, 410000);
  assert.equal(r.rendimentoCents, 0);
});

test('inflação igual ao retorno: real = inicial; maior que o retorno perde', () => {
  // 1000 × 1,10 = 1100 nominal; ÷ 1,10 = 1000 em dinheiro de hoje
  const r = simular({ ...base, inicialCents: 100000, taxa: 10, inflacao: 10 });
  assert.equal(r.fimCents, 110000);
  assert.equal(r.fimRealCents, 100000);
  // 1000 × 1,05 = 1050; ÷ 1,10 = 954,545… → R$ 954,55 < 1000 aportado
  const p = simular({ ...base, inicialCents: 100000, taxa: 5, inflacao: 10 });
  assert.equal(p.fimRealCents, 95455);
  assert.equal(p.perdeParaInflacao, true);
});

test('taxa negativa perde: R$ 1.000 a −10% a.a. por 1 ano = R$ 900', () => {
  assert.equal(simular({ ...base, inicialCents: 100000, taxa: -10 }).fimCents, 90000);
});

test('conversão anual ↔ mensal: 12,6825…% a.a. = 1% a.m.', () => {
  assert.ok(Math.abs(mensalDeAnual(12.682503013196973) - 0.01) < 1e-12);
  assert.ok(Math.abs(anualDeMensal(1) - 12.682503013196973) < 1e-9);
});

test('renda desejada: capital = 12 × renda ÷ retirada, e quando atinge', () => {
  // 5.000 × 12 / 0,04 = 1.500.000,00
  assert.equal(simular({ ...base, rendaCents: 500000 }).capitalCents, 150000000);
  // 12 × 1.000 / 0,12 = 100.000; i = 0, aporte 1.000 → k × 1.000 ≥ 100.000 no mês 100
  const r = simular({ ...base, aporteCents: 100000, rendaCents: 100000, retirada: 12, anos: 10 });
  assert.equal(r.capitalCents, 10000000);
  assert.equal(r.atingeMes, 100);
  assert.equal(quandoAtinge(100), 'atinge em 8 anos e 4 meses');
  assert.equal(quandoAtinge(0), 'já atinge');
  // já tem o capital: mês 0
  assert.equal(simular({ ...base, inicialCents: 10000000, rendaCents: 100000, retirada: 12 }).atingeMes, 0);
  // nunca atinge (sem aporte nem rendimento)
  const nunca = simular({ ...base, rendaCents: 100000 });
  assert.equal(nunca.atingeMes, null);
  assert.equal(quandoAtinge(nunca.atingeMes), 'não atinge em até 100 anos');
});

test('bordas: aporte zero, 1 centavo, 100 anos, teto', () => {
  assert.equal(simular({ ...base, inicialCents: 1, taxa: 0 }).fimCents, 1);
  assert.equal(simular({ ...base, anos: 100, inicialCents: 100000, taxa: 0 }).curva.length, 1201);
  assert.equal(validar({ ...base, inicialCents: 1e11 }), null);
  assert.ok(validar({ ...base, inicialCents: 1e11 + 1 }));
  assert.ok(validar({ ...base, anos: 100, meses: 1 }));
  assert.ok(validar({ ...base, anos: 0 }));
  assert.ok(validar({ ...base, taxa: -51 }));
  assert.ok(validar({ ...base, taxa: 101 }));
  assert.ok(validar({ ...base, inflacao: 51 }));
  assert.ok(validar({ ...base, retirada: 0.05 }));
  assert.ok(validar({ ...base, taxa: NaN }));
  assert.equal(validar({ ...base, taxa: 100, inflacao: 50, retirada: 20 }), null);
});

test('cenários gravados: vírgula no texto e lixo cai no padrão', () => {
  assert.equal(paraPremissas({ ...CENARIO_PADRAO, taxa: '8,5' }).taxa, 8.5);
  assert.ok(Number.isNaN(paraPremissas({ ...CENARIO_PADRAO, taxa: '' }).taxa));
  assert.deepEqual(lerCenarios('{'), [CENARIO_PADRAO]);
  assert.deepEqual(lerCenarios(JSON.stringify([CENARIO_PADRAO, CENARIO_PADRAO])), [CENARIO_PADRAO, CENARIO_PADRAO]);
});
