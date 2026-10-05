import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allocate, applyRows, decodePlanState, formatBp, motivoDoPlano, parseBp, planoInicial, realizedBp, toInput,
  type PlanDraft,
} from './budget-plan.ts';

test('parseBp: vírgula, ponto, % e duas casas; fora de 0 a 100 é inválido', () => {
  assert.equal(parseBp('12,5%'), 1250);
  assert.equal(parseBp(' 33,33 % '), 3333);
  assert.equal(parseBp('7'), 700);
  assert.equal(parseBp('0'), 0);
  assert.equal(parseBp('100'), 10000);
  assert.equal(parseBp('12.5'), 1250);
  for (const ruim of ['', ',', '100,01', '101', '-1', '1,234', 'abc', '1,2,3']) assert.equal(parseBp(ruim), null, ruim);
});

test('formatBp: vírgula e sem zero sobrando', () => {
  assert.equal(formatBp(1250), '12,5');
  assert.equal(formatBp(3333), '33,33');
  assert.equal(formatBp(10001), '100,01');
  assert.equal(formatBp(3000), '30');
  assert.equal(formatBp(5), '0,05');
  for (const bp of [0, 1, 10, 99, 1250, 9999, 10000]) assert.equal(parseBp(formatBp(bp)), bp);
});

test('allocate: o mesmo arredondamento do servidor (maior resto, empate pela posição)', () => {
  const a = allocate(1001, [3333, 3333, 3334]);
  assert.deepEqual(a.amounts, [334, 333, 334]); // idêntico ao `budget_plans.sql`
  assert.equal(a.totalCents, 1001);
  assert.equal(a.undistributedCents, 0);
  assert.equal(allocate(7, [3333, 3333, 3334]).amounts.reduce((s, v) => s + v, 0), 7);
  const b = allocate(1_000_000, [3333]);
  assert.deepEqual([b.amounts[0], b.undistributedCents, b.undistributedBp], [333300, 666700, 6667]);
  // R$ 99,999 bilhões não estoura inteiro de 53 bits
  assert.equal(allocate(9_999_999_999_999, [5000, 5000]).totalCents, 9_999_999_999_999);
});

const draft = (pcts: string[], base = 100_000): PlanDraft => ({
  baseCents: base,
  groups: [{ key: 'g', name: 'Essenciais', lines: pcts.map((pct, i) => ({ key: `l${i}`, category: `cat${i}`, pct })) }],
});

test('motivoDoPlano: renda, soma e categoria repetida têm frase', () => {
  assert.equal(motivoDoPlano(draft(['50'], 0)), 'Informe uma renda-base maior que zero.');
  assert.equal(motivoDoPlano(draft(['50'], -5)), 'Informe uma renda-base maior que zero.');
  assert.equal(motivoDoPlano(draft(['99,99'])), null);
  assert.equal(motivoDoPlano(draft(['50', '50'])), null);
  assert.match(motivoDoPlano(draft(['50', '50,01']))!, /100,01%: passa de 100%/);
  assert.match(motivoDoPlano(draft(['']))!, /Informe o percentual/);
  const dup = draft(['10', '10']);
  dup.groups[0].lines[1].category = 'CAT0';
  assert.match(motivoDoPlano(dup)!, /aparece em mais de uma linha/);
  const grupos = draft(['10']);
  grupos.groups.push({ key: 'h', name: 'essenciais', lines: [{ key: 'x', category: null, pct: '5' }] });
  assert.match(motivoDoPlano(grupos)!, /Dois grupos/);
  assert.equal(motivoDoPlano({ baseCents: 1, groups: planoInicial().groups }), 'Informe o percentual de uma linha de Essenciais (0 a 100%).');
});

test('toInput: renda como texto, categoria minúscula e a linha sem categoria segue no plano', () => {
  const d = draft(['12,5']);
  d.groups[0].lines.push({ key: 'z', category: null, pct: '20' });
  d.groups[0].lines[0].category = ' Moradia ';
  assert.deepEqual(toInput(d), { base_income_cents: '100000', lines: [
    { group: 'Essenciais', category: 'moradia', share_bp: 1250 }, { group: 'Essenciais', category: null, share_bp: 2000 },
  ] });
});

test('applyRows marca conflito só quando o limite do alcance já existe e é outro', () => {
  const st = decodePlanState({ revision: 1, month: '2026-10-01', period_start: '2026-10-01', period_end: '2026-10-31', income_cents: '500000',
    applications: [], plan: { version: 1, base_income_cents: '1000000', total_bp: 4500, total_cents: '450000', undistributed_bp: 5500, undistributed_cents: '550000',
      lines: [
        { position: 0, group: 'G', category: 'moradia', share_bp: 3000, amount_cents: '300000', current_default_cents: '250000', current_month_cents: null, spent_cents: '120000' },
        { position: 1, group: 'G', category: 'mercado', share_bp: 1500, amount_cents: '150000', current_default_cents: null, current_month_cents: '150000', spent_cents: '0' },
        { position: 2, group: 'G', category: null, share_bp: 0, amount_cents: '0', current_default_cents: null, current_month_cents: null, spent_cents: null },
      ] } });
  const plan = st.plan!;
  assert.deepEqual(applyRows(plan, ['moradia', 'mercado'], 'default'), [
    { category: 'moradia', before: 250000, after: 300000, conflict: true },
    { category: 'mercado', before: null, after: 150000, conflict: false },
  ]);
  assert.equal(applyRows(plan, ['mercado'], 'month')[0].conflict, false, 'mesmo valor não é conflito');
  // só o mês, sem limite do mês: o que vale naquele mês é o padrão, e é ele o "antes"
  assert.deepEqual(applyRows(plan, ['moradia'], 'month')[0], { category: 'moradia', before: 250000, after: 300000, conflict: true, doPadrao: true });
});

test('realizedBp: sem renda no período não há percentual', () => {
  assert.equal(realizedBp(120000, 500000), 2400);
  assert.equal(realizedBp(100, 0), null);
});
