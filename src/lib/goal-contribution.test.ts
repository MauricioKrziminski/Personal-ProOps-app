import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateGoalContribution, goalContributionAt, goalMonthOn } from './goal-contribution.ts';
import type { GoalContributionInput } from './goal-contribution.ts';

function input(change: Partial<GoalContributionInput> = {}): GoalContributionInput {
  return { target_cents: 1000, saved_cents: 0, as_of: '2026-10-03', mode: 'monthly',
    monthly_cents: 300, first_on: '2026-10-03', deadline_on: null, initial_cents: 0, initial_on: null, ...change };
}
function deadline(change: Partial<GoalContributionInput> = {}): GoalContributionInput {
  return input({ mode: 'deadline', monthly_cents: null, deadline_on: '2027-01-03', ...change });
}

test('monthly contributions preserve exact remaining cents with a smaller final contribution', () => {
  assert.deepEqual(calculateGoalContribution(input({ saved_cents: 99 })), {
    status: 'ready', reason: null, remaining_cents: 901, initial_applied_cents: 0, monthly_cents: 300,
    monthly_count: 4, contribution_count: 4, last_cents: 1, first_monthly_on: '2026-10-03',
    estimated_on: '2027-01-03', anchor_on: '2026-10-03', first_offset: 0, flags: [],
  });
});
test('one cent and a contribution larger than remaining finish today at exactly remaining', () => {
  for (const monthly_cents of [1, 1000, Number.MAX_SAFE_INTEGER]) {
    const i = input({ target_cents: 1, monthly_cents }); const result = calculateGoalContribution(i);
    assert.equal(result.status, 'ready'); assert.equal(result.monthly_count, 1);
    assert.equal(result.last_cents, 1); assert.equal(result.estimated_on, '2026-10-03');
    assert.deepEqual(goalContributionAt(i, 0), { on: '2026-10-03', cents: 1, kind: 'monthly' });
  }
});
for (const monthly_cents of [0, null]) test(`monthly ${monthly_cents} is incomplete rather than infinite`, () => {
  const result = calculateGoalContribution(input({ monthly_cents }));
  assert.equal(result.status, 'incomplete'); assert.equal(result.reason, 'monthly_amount');
  assert.equal(result.estimated_on, null); assert.equal(result.contribution_count, 0);
});
test('missing next date explicitly remains incomplete', () => {
  const result = calculateGoalContribution(input({ first_on: null }));
  assert.equal(result.status, 'incomplete'); assert.equal(result.reason, 'first_date');
});
test('reached goals need no contributions even when sources are incomplete', () => {
  for (const saved_cents of [1000, 1001, Number.MAX_SAFE_INTEGER]) {
    for (const i of [input({ saved_cents, monthly_cents: null, first_on: null }), deadline({ saved_cents, deadline_on: null })]) {
      const result = calculateGoalContribution(i); assert.equal(result.status, 'reached');
      assert.equal(result.remaining_cents, 0); assert.equal(result.contribution_count, 0);
      assert.equal(result.initial_applied_cents, 0); assert.equal(result.estimated_on, null);
      assert.equal(goalContributionAt(i, 0), null);
    }
  }
});
for (const [anchor, offset, expected] of [
  ['2027-01-31', 1, '2027-02-28'], ['2027-01-31', 2, '2027-03-31'],
  ['2028-01-31', 1, '2028-02-29'], ['2028-01-31', 2, '2028-03-31'],
  ['1900-01-31', 1, '1900-02-28'], ['2000-01-31', 1, '2000-02-29'],
  ['0001-01-31', 0, '0001-01-31'], ['9999-11-30', 1, '9999-12-30'],
  ['9999-12-31', 1, null], ['0001-01-01', Number.MAX_SAFE_INTEGER, null],
] as const) test(`civil calendar ${anchor} + ${offset} months = ${expected}`, () => {
  assert.equal(goalMonthOn(anchor, offset), expected);
});
test('past monthly intentions skip missed dates and preserve the original day 31', () => {
  const i = input({ as_of: '2028-02-29', first_on: '2028-01-31', target_cents: 901 });
  const result = calculateGoalContribution(i);
  assert.equal(result.first_offset, 1); assert.equal(result.anchor_on, '2028-01-31');
  assert.equal(result.first_monthly_on, '2028-02-29'); assert.equal(result.estimated_on, '2028-05-31');
  assert.deepEqual(goalContributionAt(i, 1), { on: '2028-03-31', cents: 300, kind: 'monthly' });
  const next = calculateGoalContribution({ ...i, as_of: '2028-03-01' });
  assert.equal(next.first_offset, 2); assert.equal(next.first_monthly_on, '2028-03-31');
  assert.equal(next.estimated_on, '2028-06-30');
});
test('missed initial intention is flagged and never counted as paid', () => {
  const result = calculateGoalContribution(input({ initial_cents: 900, initial_on: '2026-10-02' }));
  assert.equal(result.initial_applied_cents, 0); assert.equal(result.remaining_cents, 1000);
  assert.equal(result.monthly_count, 4); assert.equal(result.contribution_count, 4);
  assert.deepEqual(result.flags, ['initial_past']);
});
test('missed initial intention stays explicit even while the deadline source is incomplete', () => {
  const result = calculateGoalContribution(deadline({ initial_cents: 900, initial_on: '2026-10-02', deadline_on: null }));
  assert.equal(result.status, 'incomplete'); assert.equal(result.reason, 'deadline');
  assert.equal(result.initial_applied_cents, 0); assert.deepEqual(result.flags, ['initial_past']);
});
test('initial today counts once and an equal-day monthly contribution remains distinct', () => {
  const i = input({ initial_cents: 101, initial_on: '2026-10-03' }); const result = calculateGoalContribution(i);
  assert.equal(result.initial_applied_cents, 101); assert.equal(result.monthly_count, 3);
  assert.equal(result.contribution_count, 4); assert.equal(result.last_cents, 299);
  assert.equal(result.estimated_on, '2026-12-03');
  assert.deepEqual(goalContributionAt(i, 0), { on: '2026-10-03', cents: 101, kind: 'initial' });
  assert.deepEqual(goalContributionAt(i, 1), { on: '2026-10-03', cents: 300, kind: 'monthly' });
  assert.deepEqual(goalContributionAt(i, 3), { on: '2026-12-03', cents: 299, kind: 'monthly' });
});
test('full initial intention is capped and needs neither monthly amount nor first date', () => {
  const i = input({ initial_cents: 1200, initial_on: '2026-10-05', monthly_cents: null, first_on: null });
  const result = calculateGoalContribution(i); assert.equal(result.status, 'ready');
  assert.equal(result.remaining_cents, 1000); assert.equal(result.initial_applied_cents, 1000);
  assert.equal(result.monthly_cents, 0); assert.equal(result.monthly_count, 0);
  assert.equal(result.contribution_count, 1); assert.equal(result.last_cents, 1000);
  assert.equal(result.first_monthly_on, null); assert.equal(result.estimated_on, '2026-10-05');
  assert.deepEqual(goalContributionAt(i, 0), { on: '2026-10-05', cents: 1000, kind: 'initial' });
});
test('positive initial intention requires its own date', () => {
  const result = calculateGoalContribution(input({ initial_cents: 100 }));
  assert.equal(result.status, 'incomplete'); assert.equal(result.reason, 'initial_date');
});
test('partial initial after effective first monthly date is incomplete', () => {
  const result = calculateGoalContribution(input({ initial_cents: 100, initial_on: '2026-10-04' }));
  assert.equal(result.status, 'incomplete'); assert.equal(result.reason, 'initial_after_first');
  const future = calculateGoalContribution(input({ first_on: '2026-09-03', initial_cents: 100, initial_on: '2026-10-03' }));
  assert.equal(future.status, 'ready');
});
test('deadline mode rounds upward but preserves exact final remainder', () => {
  const i = deadline({ target_cents: 1001 }); const result = calculateGoalContribution(i);
  assert.equal(result.status, 'ready'); assert.equal(result.monthly_cents, 251);
  assert.equal(result.monthly_count, 4); assert.equal(result.last_cents, 248);
  assert.equal(result.estimated_on, '2027-01-03');
  assert.deepEqual(goalContributionAt(i, 3), { on: '2027-01-03', cents: 248, kind: 'monthly' });
});
test('deadline counts only slots on or before the deadline and can finish earlier', () => {
  const i = deadline({ target_cents: 1, deadline_on: '2027-01-02' }); const result = calculateGoalContribution(i);
  assert.equal(result.monthly_cents, 1); assert.equal(result.monthly_count, 1);
  assert.equal(result.estimated_on, '2026-10-03');
  const three = calculateGoalContribution({ ...i, target_cents: 900 });
  assert.equal(three.monthly_cents, 300); assert.equal(three.monthly_count, 3);
  assert.equal(three.estimated_on, '2026-12-03');
});
test('deadline today includes a contribution today', () => {
  const result = calculateGoalContribution(deadline({ deadline_on: '2026-10-03' }));
  assert.equal(result.status, 'ready'); assert.equal(result.monthly_cents, 1000);
  assert.equal(result.monthly_count, 1); assert.equal(result.estimated_on, '2026-10-03');
});
test('deadline missing is incomplete; passed deadline and first after deadline are unreachable', () => {
  const missing = calculateGoalContribution(deadline({ deadline_on: null }));
  assert.equal(missing.status, 'incomplete'); assert.equal(missing.reason, 'deadline');
  for (const i of [deadline({ deadline_on: '2026-10-02' }), deadline({ first_on: '2027-02-03' }),
    deadline({ first_on: '2026-09-04', deadline_on: '2026-10-03' })]) {
    const result = calculateGoalContribution(i); assert.equal(result.status, 'unreachable');
    assert.equal(result.reason, 'deadline'); assert.equal(result.contribution_count, 0);
  }
});
test('deadline initial cannot lie after the deadline even if it would cover everything', () => {
  for (const initial_cents of [100, 1000]) {
    const result = calculateGoalContribution(deadline({ initial_cents, initial_on: '2027-02-03' }));
    assert.equal(result.status, 'incomplete'); assert.equal(result.reason, 'initial_after_deadline');
  }
});
test('deadline initial reduces the amount used by the inverse monthly calculation', () => {
  const result = calculateGoalContribution(deadline({ target_cents: 1001, initial_cents: 101, initial_on: '2026-10-03' }));
  assert.equal(result.monthly_cents, 225); assert.equal(result.monthly_count, 4);
  assert.equal(result.contribution_count, 5); assert.equal(result.last_cents, 225);
});
test('full initial still needs the deadline source, but may complete without a monthly anchor', () => {
  const incomplete = calculateGoalContribution(deadline({ initial_cents: 1000, initial_on: '2026-10-04', deadline_on: null, first_on: null }));
  assert.equal(incomplete.status, 'incomplete'); assert.equal(incomplete.reason, 'deadline');
  const i = deadline({ initial_cents: 2000, initial_on: '2026-10-04', first_on: null, deadline_on: '2026-10-04' });
  const result = calculateGoalContribution(i); assert.equal(result.status, 'ready');
  assert.equal(result.monthly_count, 0); assert.equal(result.monthly_cents, 0);
  assert.equal(result.initial_applied_cents, 1000); assert.equal(result.estimated_on, '2026-10-04');
});
test('deadline month boundary counts the clamped leap-day slot without changing the anchor', () => {
  const i = deadline({ as_of: '2000-02-01', first_on: '2000-01-31', deadline_on: '2000-03-30', target_cents: 901 });
  const result = calculateGoalContribution(i); assert.equal(result.status, 'ready');
  assert.equal(result.monthly_cents, 901); assert.equal(result.monthly_count, 1);
  assert.equal(result.first_offset, 1); assert.equal(result.estimated_on, '2000-02-29');
  assert.deepEqual(goalContributionAt(i, 0), { on: '2000-02-29', cents: 901, kind: 'monthly' });
});
test('random access handles the full civil calendar without building a schedule', () => {
  const i = input({ as_of: '0001-01-01', first_on: '0001-01-31', target_cents: 119988, monthly_cents: 1 });
  const result = calculateGoalContribution(i); assert.equal(result.status, 'ready');
  assert.equal(result.monthly_count, 119988); assert.equal(result.estimated_on, '9999-12-31');
  assert.deepEqual(goalContributionAt(i, 119987), { on: '9999-12-31', cents: 1, kind: 'monthly' });
  assert.equal(goalContributionAt(i, 119988), null);
});
test('monthly horizon extends beyond ten years with no artificial cut', () => {
  const result = calculateGoalContribution(input({ target_cents: 121, monthly_cents: 1 }));
  assert.equal(result.status, 'ready'); assert.equal(result.monthly_count, 121);
  assert.equal(result.estimated_on, '2036-10-03');
});
test('year overflow and immense monthly counts are explicit without allocation or precision loss', () => {
  for (const i of [input({ first_on: '9999-12-31', target_cents: 2, monthly_cents: 1 }),
    input({ first_on: '0001-01-01', target_cents: Number.MAX_SAFE_INTEGER, monthly_cents: 1 }),
    input({ target_cents: Number.MAX_SAFE_INTEGER, monthly_cents: 1, initial_cents: 1, initial_on: '2026-10-03' })]) {
    const result = calculateGoalContribution(i); assert.equal(result.status, 'out_of_range');
    assert.equal(result.reason, 'calendar_range'); assert.equal(result.estimated_on, null);
    assert.equal(Number.isSafeInteger(result.monthly_count), true);
    assert.equal(result.contribution_count, i.target_cents);
    assert.equal(goalContributionAt(i, 0), null);
  }
  const passed = calculateGoalContribution(input({ as_of: '9999-12-31', first_on: '9999-01-01' }));
  assert.equal(passed.status, 'out_of_range'); assert.equal(passed.reason, 'calendar_range');
});
test('large safe cents use integer division rather than rounding intermediate doubles', () => {
  const max = Number.MAX_SAFE_INTEGER;
  const result = calculateGoalContribution(input({ target_cents: max, monthly_cents: 3002399751580330 }));
  assert.equal(result.status, 'ready'); assert.equal(result.monthly_count, 4);
  assert.equal(result.last_cents, 1); assert.equal(result.estimated_on, '2027-01-03');
  const inverse = calculateGoalContribution(deadline({ target_cents: max, deadline_on: '2026-12-03' }));
  assert.equal(inverse.monthly_cents, 3002399751580331); assert.equal(inverse.monthly_count, 3);
  assert.equal(inverse.last_cents, 3002399751580329);
});
const corruptions: [string, (raw: Record<string, unknown>) => void][] = [
  ['extra field', r => { r.caret = 1; }], ['missing field', r => { delete r.initial_on; }],
  ['zero target', r => { r.target_cents = 0; }], ['negative saved', r => { r.saved_cents = -1; }],
  ['decimal cents', r => { r.monthly_cents = 0.1; }], ['unsafe target', r => { r.target_cents = Number.MAX_SAFE_INTEGER + 1; }],
  ['string cents', r => { r.saved_cents = '0'; }], ['NaN cents', r => { r.initial_cents = NaN; }],
  ['infinite cents', r => { r.monthly_cents = Infinity; }], ['negative initial', r => { r.initial_cents = -1; }],
  ['invalid mode', r => { r.mode = 'other'; }], ['monthly opposite source', r => { r.deadline_on = '2027-01-03'; }],
  ['deadline opposite source', r => { r.mode = 'deadline'; r.deadline_on = '2027-01-03'; }],
  ['inactive initial date', r => { r.initial_on = '2026-10-03'; }], ['missing date type', r => { r.first_on = undefined; }],
  ['invalid day', r => { r.first_on = '2026-02-30'; }], ['invalid 1900 leap', r => { r.as_of = '1900-02-29'; }],
  ['noncivil timestamp', r => { r.as_of = '2026-10-03T00:00:00Z'; }], ['year zero', r => { r.as_of = '0000-01-01'; }],
  ['five digit year', r => { r.as_of = '10000-01-01'; }], ['short date', r => { r.as_of = '2026-1-03'; }],
];
for (const [name, change] of corruptions) test(`runtime input rejects ${name} before calculating, including reached goals`, () => {
  for (const saved_cents of [0, 1000]) {
    const raw = { ...input({ saved_cents }) } as Record<string, unknown>; change(raw);
    assert.throws(() => calculateGoalContribution(raw as unknown as GoalContributionInput));
  }
});
test('runtime objects must be plain records rather than null, arrays or class instances', () => {
  class Foreign { constructor() { Object.assign(this, input()); } }
  for (const raw of [null, [], new Foreign()]) assert.throws(() => calculateGoalContribution(raw as unknown as GoalContributionInput));
});
test('calendar and schedule reject invalid indexes and anchors', () => {
  for (const index of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => goalMonthOn('2026-10-03', index));
    assert.throws(() => goalContributionAt(input(), index));
  }
  for (const date of ['2026-02-30', '0000-01-01', '2026-1-01']) assert.throws(() => goalMonthOn(date, 0));
  assert.equal(goalContributionAt(input(), 4), null);
  assert.equal(goalContributionAt(input(), Number.MAX_SAFE_INTEGER), null);
  assert.equal(goalContributionAt(input({ monthly_cents: null }), 0), null);
});
test('manual schedules conserve remaining and agree with estimated date in both directions', () => {
  const fixtures: [GoalContributionInput, { on: string; cents: number; kind: 'initial' | 'monthly' }[]][] = [
    [input({ target_cents: 901, first_on: '2028-01-31' }), [
      { on: '2028-01-31', cents: 300, kind: 'monthly' }, { on: '2028-02-29', cents: 300, kind: 'monthly' },
      { on: '2028-03-31', cents: 300, kind: 'monthly' }, { on: '2028-04-30', cents: 1, kind: 'monthly' },
    ]],
    [input({ target_cents: 501, saved_cents: 100, initial_cents: 101, initial_on: '2026-10-03' }), [
      { on: '2026-10-03', cents: 101, kind: 'initial' }, { on: '2026-10-03', cents: 300, kind: 'monthly' },
    ]],
    [deadline({ target_cents: 701, initial_cents: 100, initial_on: '2026-10-03', deadline_on: '2026-12-03' }), [
      { on: '2026-10-03', cents: 100, kind: 'initial' }, { on: '2026-10-03', cents: 201, kind: 'monthly' },
      { on: '2026-11-03', cents: 201, kind: 'monthly' }, { on: '2026-12-03', cents: 199, kind: 'monthly' },
    ]],
  ];
  for (const [i, expected] of fixtures) {
    const result = calculateGoalContribution(i); assert.equal(result.status, 'ready');
    const actual = expected.map((_, index) => goalContributionAt(i, index)); assert.deepEqual(actual, expected);
    assert.equal(expected.reduce((sum, item) => sum + item.cents, 0), result.remaining_cents);
    assert.equal(result.contribution_count, expected.length); assert.equal(result.estimated_on, expected.at(-1)!.on);
    assert.equal(goalContributionAt(i, expected.length), null);
    if (result.monthly_count > 0) {
      const inverse = calculateGoalContribution({ ...i, mode: 'deadline', monthly_cents: null, deadline_on: result.estimated_on });
      assert.equal(inverse.status, 'ready'); assert.equal(inverse.remaining_cents, result.remaining_cents);
      assert.equal(inverse.estimated_on, result.estimated_on);
    }
  }
});
test('pure recalculation preserves the input and has no dependence on device clock or caret state', () => {
  const i = Object.freeze(input({ as_of: '2000-01-31', first_on: '2000-01-31' })); const before = { ...i };
  const first = calculateGoalContribution(i); assert.deepEqual(calculateGoalContribution(i), first);
  assert.deepEqual(i, before); assert.equal(first.estimated_on, '2000-04-30');
});
