import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeGoalPlanningState, goalPlanInput, goalPlanPreview } from './goal-planning.ts';

const ws = '10000000-0000-4000-8000-000000000001';
const a = '20000000-0000-4000-8000-000000000001';
const b = '20000000-0000-4000-8000-000000000002';
const forged = '20000000-0000-4000-8000-000000000003';
const fingerprint = 'abcdef0123456789abcdef0123456789';
function dto() {
  return {
    workspace_id: ws, workspace_name: 'Principal', cycle_close_day: null, as_of: '2026-10-03', days: 90, view: 'civil', mode: 'month',
    edit_revision: 2, goals_fingerprint: fingerprint,
    goals: [a, b].map((goal_id, index) => ({ goal_id, name: `Meta ${index}`, target_cents: '50000', saved_cents: '10000',
      deadline: '2027-01-31', included: true, monthly_cents: '10000', first_on: '2026-10-03',
      suggested_cents: '10000', origin: 'saved', deadline_status: 'future' })),
    reserved_cash_cents: '10000', unassigned_goals_cents: '5000', minimum_available_cents: '-800', income_present: false,
    incomplete_goal_ids: [] as string[], excluded_goal_ids: [] as string[], missed_deadline_goal_ids: [a],
    points: [] as Record<string, unknown>[],
    months: [{ month: '2026-10', from: '2026-10-03', to: '2026-10-31', partial: true,
      cash_cents: '-1000', planned_cents: '20000', cumulative_planned_cents: '20000', available_cents: '-31000', first_pressure_on: '2026-10-03' }],
    first_pressure_on: '2026-10-03',
  };
}
function draft() { return [{ goal_id: b, included: false, monthly_cents: 999, first_on: '2026-09-30' },
  { goal_id: a, included: true, monthly_cents: 10000, first_on: '2026-09-30' }]; }

test('decodes safe cents without deriving or overwriting server scenario', () => {
  const raw = dto(); const state = decodeGoalPlanningState(raw);
  assert.equal(state.goals[0].target_cents, 50000);
  assert.equal(state.goals[0].monthly_cents, 10000);
  assert.equal(state.months[0].available_cents, -31000);
  assert.equal(state.months[0].cash_cents, -1000);
  assert.equal(state.reserved_cash_cents, 10000);
  assert.equal(raw.goals[0].target_cents, '50000');
});

const corruptions: [string, (raw: ReturnType<typeof dto>) => void][] = [
  ['unsafe cents', r => { r.goals[0].target_cents = '9007199254740992'; }],
  ['decimal cents', r => { r.goals[0].saved_cents = '1.5'; }],
  ['numeric wire cents', r => { Object.assign(r, { reserved_cash_cents: 10 }); }],
  ['negative saved', r => { r.goals[0].saved_cents = '-1'; }],
  ['zero target', r => { r.goals[0].target_cents = '0'; }],
  ['negative planned', r => { r.months[0].planned_cents = '-1'; }],
  ['invalid civil date', r => { r.goals[0].deadline = '2027-02-31'; }],
  ['invalid leap date', r => { r.as_of = '2027-02-29'; }],
  ['unknown field', r => { Object.assign(r, { capacity: 123 }); }],
  ['missing field', r => { Reflect.deleteProperty(r, 'income_present'); }],
  ['unknown goal field', r => { Object.assign(r.goals[0], { archived: false }); }],
  ['duplicate goals', r => { r.goals.push({ ...r.goals[0] }); }],
  ['duplicate month', r => { r.months.push({ ...r.months[0] }); }],
  ['forged incomplete id', r => { r.incomplete_goal_ids = [forged]; }],
  ['forged excluded id', r => { r.excluded_goal_ids = [forged]; }],
  ['duplicate missed id', r => { r.missed_deadline_goal_ids = [a, a]; }],
  ['invalid uuid', r => { r.workspace_id = 'x'; }],
  ['invalid workspace name', r => { r.workspace_name = ''; }],
  ['invalid cycle close day', r => { Object.assign(r, { cycle_close_day: 32 }); }],
  ['invalid fingerprint', r => { r.goals_fingerprint = 'xyz'; }],
  ['invalid view', r => { r.view = 'year'; }],
  ['invalid mode', r => { r.mode = 'week'; }],
  ['zero days', r => { r.days = 0; }],
  ['excessive days', r => { r.days = 3651; }],
  ['noninteger revision', r => { r.edit_revision = 1.5; }],
  ['zero revision', r => { r.edit_revision = 0; }],
  ['invalid origin', r => { r.goals[0].origin = 'other'; }],
  ['invalid deadline status', r => { r.goals[0].deadline_status = 'expired'; }],
  ['wrong mode array', r => { r.points = [{ day: '2026-10-03', cash_cents: '0', planned_cents: '0', cumulative_planned_cents: '0', available_cents: '0' }]; }],
  ['reversed month range', r => { r.months[0].to = '2026-10-01'; }],
];
for (const [name, change] of corruptions) test(`rejects ${name}`, () => {
  const raw = dto(); change(raw); assert.throws(() => decodeGoalPlanningState(raw));
});

test('daily mode accepts leap day and detects duplicate daily points', () => {
  const raw = { ...dto(), mode: 'day', months: [], points: [{ day: '2028-02-29', cash_cents: '9007199254740991',
    planned_cents: '0', cumulative_planned_cents: '0', available_cents: '-9007199254740991' }] };
  assert.equal(decodeGoalPlanningState(raw).points[0].cash_cents, Number.MAX_SAFE_INTEGER);
  raw.points.push({ ...raw.points[0] }); assert.throws(() => decodeGoalPlanningState(raw));
});

test('minimum availability retains an intraperiod negative even when month ends positive', () => {
  const raw = dto(); raw.months[0].available_cents = '100';
  assert.equal(decodeGoalPlanningState(raw).minimum_available_cents, -800);
  raw.minimum_available_cents = '9007199254740992';
  assert.throws(() => decodeGoalPlanningState(raw));
});

test('cycle month bounds may start in previous civil month', () => {
  const raw = dto(); raw.view = 'cycle'; raw.months[0].from = '2026-09-25'; raw.months[0].to = '2026-10-24';
  assert.equal(decodeGoalPlanningState(raw).months[0].from, '2026-09-25');
});

test('empty goals permit clearing an empty plan', () => {
  const state = decodeGoalPlanningState({ ...dto(), edit_revision: null, goals: [], missed_deadline_goal_ids: [] });
  assert.deepEqual(goalPlanInput(state, []), { workspace_id: ws, expected_revision: null, goals_fingerprint: fingerprint, items: [] });
});

test('builders copy and sort all current goals and normalize excluded fields without mutating draft', () => {
  const state = decodeGoalPlanningState(dto()); const items = draft(); const original = structuredClone(items);
  const preview = goalPlanPreview(state, items);
  assert.deepEqual(preview, { goals_fingerprint: fingerprint, items: [
    { goal_id: a, included: true, monthly_cents: 10000, first_on: '2026-09-30' },
    { goal_id: b, included: false, monthly_cents: null, first_on: null },
  ] });
  assert.deepEqual(goalPlanInput(state, items), { workspace_id: ws, expected_revision: 2, ...preview });
  preview.items[0].monthly_cents = 1;
  assert.deepEqual(items, original);
});

test('preview retains incomplete included proposals but save refuses them', () => {
  const state = decodeGoalPlanningState(dto());
  for (const incomplete of [{ monthly_cents: null, first_on: '2026-10-03' }, { monthly_cents: 100, first_on: null }, { monthly_cents: null, first_on: null }]) {
    const items = [{ goal_id: a, included: true, ...incomplete }, { goal_id: b, included: false, monthly_cents: null, first_on: null }];
    assert.deepEqual(goalPlanPreview(state, items).items[0], items[0]);
    assert.throws(() => goalPlanInput(state, items));
  }
});

for (const [name, change] of [
  ['missing', (items: ReturnType<typeof draft>) => { items.pop(); }],
  ['extra', (items: ReturnType<typeof draft>) => { items.push({ ...items[0], goal_id: forged }); }],
  ['duplicate', (items: ReturnType<typeof draft>) => { items[1].goal_id = b; }],
  ['unsafe', (items: ReturnType<typeof draft>) => { items[1].monthly_cents = Number.MAX_SAFE_INTEGER + 1; }],
  ['zero', (items: ReturnType<typeof draft>) => { items[1].monthly_cents = 0; }],
  ['decimal', (items: ReturnType<typeof draft>) => { items[1].monthly_cents = 1.5; }],
  ['invalid date', (items: ReturnType<typeof draft>) => { items[1].first_on = '2026-02-31'; }],
  ['unknown field', (items: ReturnType<typeof draft>) => { Object.assign(items[1], { target_cents: 1 }); }],
] as const) test(`builders reject ${name} items`, () => {
  const state = decodeGoalPlanningState(dto()); const items = draft(); change(items);
  assert.throws(() => goalPlanPreview(state, items)); assert.throws(() => goalPlanInput(state, items));
});
