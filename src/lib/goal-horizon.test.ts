import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateGoalContribution } from './goal-contribution.ts';
import { decodeGoalHorizonState, goalHorizonDrafts, goalHorizonInput, goalHorizonPreview, normalizeGoalHorizonInput } from './goal-horizon.ts';

const ws = '10000000-0000-4000-8000-000000000001';
const goal = '20000000-0000-4000-8000-000000000001';
const fingerprint = 'abcdef0123456789abcdef0123456789';
function wire() {
  const item = { goal_id: goal, included: true, mode: 'deadline', monthly_cents: null,
    first_on: '2027-01-31', deadline_on: '2027-03-31', initial_cents: '1000', initial_on: '2027-01-01' };
  const result = calculateGoalContribution({ target_cents: 10001, saved_cents: 0, as_of: '2027-01-01',
    mode: 'deadline', monthly_cents: null, first_on: item.first_on, deadline_on: item.deadline_on,
    initial_cents: 1000, initial_on: item.initial_on });
  return {
    state: { workspace_id: ws, workspace_name: 'Pessoal', cycle_close_day: null, as_of: '2027-01-01', days: 365,
      view: 'civil', mode: 'day', edit_revision: 2, goals_fingerprint: fingerprint,
      goals: [{ goal_id: goal, name: 'Viagem', target_cents: '10001', saved_cents: '0', deadline: '2027-03-31',
        included: true, monthly_cents: String(result.monthly_cents), first_on: item.first_on, suggested_cents: '3334',
        origin: 'saved', deadline_status: 'future' }], reserved_cash_cents: '0', unassigned_goals_cents: '0',
      income_present: false, incomplete_goal_ids: [], excluded_goal_ids: [], missed_deadline_goal_ids: [],
      points: [{ day: '2027-01-01', cash_cents: '20000', planned_cents: '1000', cumulative_planned_cents: '1000', available_cents: '19000' }],
      months: [], first_pressure_on: null, minimum_available_cents: '9999' },
    horizons: [{ item, result: { ...result, remaining_cents: String(result.remaining_cents),
      initial_applied_cents: String(result.initial_applied_cents), monthly_cents: String(result.monthly_cents), last_cents: String(result.last_cents) } }],
  };
}

test('F10 DTO preserves server capacity and checks exact pure calendar, source money and cents', () => {
  const raw = wire();const original = structuredClone(raw);const state = decodeGoalHorizonState(raw);
  assert.equal(state.minimum_available_cents, 9999);
  assert.equal(state.horizons[0].item.monthly_cents, null);
  assert.equal(state.horizons[0].item.initial_cents, 1000);
  assert.equal(state.horizons[0].result.monthly_cents, 3001);
  assert.equal(state.horizons[0].result.last_cents, 2999);
  assert.equal(state.horizons[0].result.estimated_on, '2027-03-31');
  assert.deepEqual(raw, original);
});

for (const [name, corrupt] of [
  ['outer extra', (x: any) => { x.capacity = 1; }],
  ['missing horizon', (x: any) => { x.horizons = []; }],
  ['duplicate horizon', (x: any) => { x.horizons.push(structuredClone(x.horizons[0])); }],
  ['forged goal', (x: any) => { x.horizons[0].item.goal_id = ws; }],
  ['result extra', (x: any) => { x.horizons[0].result.paid = true; }],
  ['wrong date', (x: any) => { x.horizons[0].result.estimated_on = '2027-04-30'; }],
  ['wrong remainder', (x: any) => { x.horizons[0].result.last_cents = '3000'; }],
  ['unsafe amount', (x: any) => { x.horizons[0].item.initial_cents = '9007199254740992'; }],
  ['numeric money', (x: any) => { x.horizons[0].result.monthly_cents = 3001; }],
  ['inactive source', (x: any) => { x.horizons[0].item.monthly_cents = '5'; }],
  ['wrong source', (x: any) => { x.horizons[0].item.mode = 'other'; }],
  ['inconsistent included', (x: any) => { x.state.goals[0].included = false; }],
  ['inconsistent monthly', (x: any) => { x.state.goals[0].monthly_cents = '3000'; }],
] as const) test(`F10 DTO refuses ${name}`, () => {
  const raw = wire();corrupt(raw);assert.throws(() => decodeGoalHorizonState(raw), /Planejamento de metas/);
});

test('F10 draft stores derived inactive input and transport sends only the active source without mutation', () => {
  const state = decodeGoalHorizonState(wire());const drafts = goalHorizonDrafts(state);
  assert.equal(drafts[0].monthly_cents, 3001);
  const original = structuredClone(drafts);
  const preview = goalHorizonPreview(state, drafts);
  assert.equal(preview.items[0].monthly_cents, null);
  assert.equal(preview.items[0].deadline_on, '2027-03-31');
  assert.deepEqual(drafts, original);
  drafts[0].mode = 'monthly';drafts[0].monthly_cents = 2500;
  assert.equal(goalHorizonInput(state, drafts).items[0].deadline_on, null);
  drafts[0].mode = 'deadline';
  assert.equal(drafts[0].monthly_cents, 2500);
  assert.equal(goalHorizonInput(state, drafts).items[0].monthly_cents, null);
});

test('F10 exclusion clears intent on the wire and preserves the complete editor draft', () => {
  const state = decodeGoalHorizonState(wire());const drafts = goalHorizonDrafts(state);drafts[0].included = false;
  assert.deepEqual(goalHorizonInput(state, drafts).items[0], { goal_id: goal, included: false, mode: 'monthly',
    monthly_cents: null, first_on: null, deadline_on: null, initial_cents: 0, initial_on: null });
  assert.equal(drafts[0].initial_cents, 1000);
});

test('F10 preview can explain zero while save cannot accept a plan without contributions', () => {
  const state = decodeGoalHorizonState(wire());const drafts = goalHorizonDrafts(state);
  Object.assign(drafts[0], { mode: 'monthly', monthly_cents: 0, initial_cents: 0 });
  assert.equal(goalHorizonPreview(state, drafts).items[0].monthly_cents, 0);
  assert.throws(() => goalHorizonInput(state, drafts), /aporte mensal/);
});

test('F10 source deadline changes do not overwrite the actual goal deadline', () => {
  const state = decodeGoalHorizonState(wire());const drafts = goalHorizonDrafts(state);
  drafts[0].deadline_on = '2027-04-30';const input = goalHorizonInput(state, drafts);
  assert.equal(input.items[0].deadline_on, '2027-04-30');
  assert.equal(state.goals[0].deadline, '2027-03-31');
});

test('F10 syntax normalization copies closed intent independently of current goals for terminal resolution', () => {
  const state = decodeGoalHorizonState(wire());const input = goalHorizonInput(state, goalHorizonDrafts(state));
  const normalized = normalizeGoalHorizonInput(input);input.items[0].initial_cents = 2000;
  assert.equal(normalized.items[0].initial_cents, 1000);
  for (const corrupt of [
    (x: any) => { x.expected_revision = Number.MAX_SAFE_INTEGER; },
    (x: any) => { x.items[0].initial_on = '2027-02-31'; },
    (x: any) => { x.items[0].target_cents = 1; },
    (x: any) => { x.items[0].monthly_cents = 1; },
    (x: any) => { x.items[0].initial_cents = 1.1; },
    (x: any) => { x.items[0].included = 'true'; },
    (x: any) => { x.items[0].mode = { toString: () => 'deadline' }; },
    (x: any) => { x.items.push({ ...x.items[0] }); },
  ]) { const value = structuredClone(normalized);corrupt(value);assert.throws(() => normalizeGoalHorizonInput(value)); }
});

test('F10 builders require the exact current goal list and allow initial-only completion', () => {
  const state = decodeGoalHorizonState(wire());assert.throws(() => goalHorizonPreview(state, []));
  const drafts = goalHorizonDrafts(state);drafts[0].initial_cents = 10001;drafts[0].first_on = null;
  assert.equal(goalHorizonInput(state, drafts).items[0].first_on, null);
});
