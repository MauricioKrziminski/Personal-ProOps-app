/** `node --test`. O período e a regra da explicação saem do MESMO payload que desenhou o número. */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { EmergencyReserveState } from './emergency-reserve.ts';
import { getEmergencyReserveSummary } from './emergency-reserve.ts';
import { explicaCiclo, explicaInvestimentos, explicaMudanca, explicaPlano, explicaOrcamento, explicaProjecao, explicaReserva, explicaSaude, ultimoDiaDoMes } from './explicacoes.ts';
import type { InvestmentPosition } from './investment.ts';

const brl = (c: number) => `R$ ${(c / 100).toFixed(2).replace('.', ',')}`;

test('saúde: o período é a janela devolvida pela RPC, e sem janela não há (i)', () => {
  const e = explicaSaude({ window_from: '2026-07-05', window_to: '2026-10-05' });
  assert.ok(e);
  assert.match(e.periodo, /05\/07\/2026 a 05\/10\/2026/);
  assert.match(e.oQueConta, /poupança/);
  assert.equal(explicaSaude(null), null);
  assert.equal(explicaSaude({ window_from: null, window_to: '2026-10-05' }), null);
});

function reserva(base: 'manual' | 'observed', over: Partial<EmergencyReserveState> = {}): EmergencyReserveState {
  const id = '6f1c2a3e-1b2c-4d5e-8f90-a1b2c3d4e5f6';
  return {
    workspace_id: id, workspace_name: 'Casa', as_of: '2026-10-05',
    config: { base_mode: base, manual_monthly_cents: base === 'manual' ? 300000 : null, target_months: 6, edit_revision: 1 },
    sources: [{ kind: 'account', id, name: 'Poupança', eligible: true, archived: false, available_cents: 500000, other_allocated_cents: 0, allocated_cents: 500000, liquidity_confirmed: true, effective_cents: 500000, valuation_date: null }],
    months: ['2026-07-01', '2026-08-01', '2026-09-01'].map((month) => ({ month, expense_count: 3, essential_cents: 100000, unclassified_count: 0, unclassified_cents: 0, fingerprint: 'a'.repeat(32), reviewed: true })),
    unassigned_goals_cents: 0,
    ...over,
  };
}

test('reserva observada: período são os meses fechados do payload e a base não é estimada', () => {
  const s = reserva('observed');
  const e = explicaReserva(s, getEmergencyReserveSummary(s), brl);
  assert.ok(e);
  assert.match(e.periodo, /05\/10\/2026/);
  assert.match(e.periodo, /01\/07\/2026 a 30\/09\/2026/);
  assert.match(e.oQueConta, /6 meses/);
  assert.equal(e.qualidade, undefined);
});

test('reserva manual: a qualidade diz que a base é informada; observada sem revisão diz que falta dado', () => {
  const m = reserva('manual');
  assert.match(explicaReserva(m, getEmergencyReserveSummary(m), brl)!.qualidade!, /Estimado/);
  const o = reserva('observed');
  o.months[1].reviewed = false;
  assert.match(explicaReserva(o, getEmergencyReserveSummary(o), brl)!.qualidade!, /insuficientes/);
});

test('reserva: sem configuração não há (i); lastro faltando entra com o valor do payload', () => {
  const sem = reserva('manual', { config: null });
  assert.equal(explicaReserva(sem, getEmergencyReserveSummary(sem), brl), null);
  const s = reserva('manual');
  s.sources[0].effective_cents = 200000;
  assert.match(explicaReserva(s, getEmergencyReserveSummary(s), brl)!.qualidade!, /R\$ 3000,00/);
});

test('orçamento: a janela é a da lista; sem bordas definitivas não há (i)', () => {
  const e = explicaOrcamento({ from: '2026-09-11', to: '2026-10-10', pronto: true });
  assert.equal(e!.periodo, '11/09/2026 a 10/10/2026');
  assert.match(e!.oQueConta, /gasto/);
  assert.match(e!.oQueConta, /previsto/);
  assert.equal(explicaOrcamento({ from: '2026-10-01', to: '2026-10-31', pronto: false }), null);
});

test('projeção: do dia de hoje ao último dia pedido, com o corte e as hipóteses como qualidade', () => {
  const limpa = explicaProjecao({ de: '2026-10-05', ate: '2027-01-03', corteMes: null, simulando: false });
  assert.equal(limpa.periodo, 'De 05/10/2026 a 03/01/2027.');
  assert.equal(limpa.qualidade, undefined);
  const e = explicaProjecao({ de: '2026-10-05', ate: '2030-10-05', corteMes: '2027-10', simulando: true });
  assert.match(e.qualidade!, /Depois de 10\/2027/);
  assert.match(e.qualidade!, /hipóteses/);
});

const posicao = (over: Partial<InvestmentPosition>): InvestmentPosition => ({
  account_id: 'a', workspace_id: 'w', name: 'CDB', type_label: 'Investimento', balance_cents: 0, net_contributed_cents: 0,
  movements_count: 1, value_cents: 110000, principal_cents: 100000, result_cents: 10000, result_quality: 'conhecido',
  received_cents: 0, last_valuation_on: '2026-10-01', opening_on: '2026-01-10', ...over,
});

test('investimentos: período cobre da abertura mais antiga à avaliação mais recente; qualidade só com incerteza', () => {
  const conhecido = explicaInvestimentos([posicao({}), posicao({ opening_on: '2026-03-01', last_valuation_on: '2026-10-04' })])!;
  assert.equal(conhecido.periodo, 'Desde 10/01/2026 até 04/10/2026.');
  assert.equal(conhecido.qualidade, undefined);
  const mista = explicaInvestimentos([
    posicao({ result_quality: 'estimado' }),
    posicao({ result_quality: 'indisponível', result_cents: null, last_valuation_on: null }),
  ])!;
  assert.match(mista.qualidade!, /1 posição com resultado estimado/);
  assert.match(mista.qualidade!, /1 posição sem atualização de valor/);
  const nunca = explicaInvestimentos([posicao({ result_quality: 'indisponível', result_cents: null, last_valuation_on: null })])!;
  assert.match(nunca.periodo, /ainda não houve/);
  assert.equal(explicaInvestimentos([]), null);
  assert.equal(explicaInvestimentos(null), null);
});

test('último dia do mês respeita bissexto', () => {
  assert.equal(ultimoDiaDoMes('2028-02-01'), '2028-02-29');
  assert.equal(ultimoDiaDoMes('2027-02-01'), '2027-02-28');
  assert.equal(ultimoDiaDoMes('2026-09-01'), '2026-09-30');
});

test('ciclo: o período são as bordas da linha do ciclo e o link leva o mês e a régua da tela', () => {
  const e = explicaCiclo({ ini: '2026-09-11', fim: '2026-10-10' }, { month: '2026-10', view: 'cycle' })!;
  assert.equal(e.periodo, '11/09/2026 a 10/10/2026.');
  assert.deepEqual(e.verItens!.href, { pathname: '/finance/cycle', params: { month: '2026-10', view: 'cycle', tipo: 'tudo' } });
  const semRegua = explicaCiclo({ ini: '2026-10-01', fim: '2026-10-31' }, { month: '2026-10', view: null })!;
  assert.deepEqual((semRegua.verItens!.href as any).params, { month: '2026-10', tipo: 'tudo' });
  assert.equal(explicaCiclo(null, { month: '2026-10' }), null);
});

test('toda explicação tem a regra em UMA frase', () => {
  const todas = [
    explicaSaude({ window_from: '2026-07-05', window_to: '2026-10-05' }),
    explicaOrcamento({ from: '2026-10-01', to: '2026-10-31', pronto: true }),
    explicaProjecao({ de: '2026-10-05', ate: '2026-12-05', corteMes: null, simulando: false }),
    explicaCiclo({ ini: '2026-09-11', fim: '2026-10-10' }, { month: '2026-10' }),
    explicaInvestimentos([posicao({})]),
    explicaPlano({ period_start: '2026-10-01', period_end: '2026-10-31', income_cents: 1, plan: {} as never }),
    explicaMudanca({ curFrom: '2026-10-01', curTo: '2026-10-31', prevFrom: '2026-09-01', prevTo: '2026-09-30' }),
  ];
  for (const e of todas) assert.equal((e!.oQueConta.match(/[.!?](\s|$)/g) ?? []).length, 1, e!.oQueConta);
});

test('plano: o período é o do estado e a qualidade só aparece sem renda', () => {
  const base = { period_start: '2026-10-01', period_end: '2026-10-31', plan: {} as never };
  const e = explicaPlano({ ...base, income_cents: 500000 })!;
  assert.equal(e.periodo, '01/10/2026 a 31/10/2026.');
  assert.equal(e.qualidade, undefined);
  assert.equal(explicaPlano({ ...base, income_cents: 0 })!.qualidade, 'Sem renda lançada neste período.');
  assert.equal(explicaPlano({ ...base, income_cents: 1, plan: null }), null);
  assert.equal(explicaPlano(null), null);
});

test('por que mudou: os dois períodos saem dos parâmetros, sem qualidade', () => {
  const e = explicaMudanca({ curFrom: '2026-10-01', curTo: '2026-10-31', prevFrom: '2026-09-01', prevTo: '2026-09-30' })!;
  assert.equal(e.periodo, '01/10/2026 a 31/10/2026 contra 01/09/2026 a 30/09/2026.');
  assert.equal(e.qualidade, undefined);
  assert.equal(explicaMudanca(null), null);
});
