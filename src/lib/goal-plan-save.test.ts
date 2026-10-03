import assert from 'node:assert/strict';
import test from 'node:test';
import { createGoalPlanSaveController, goalPlanWriteError } from './goal-plan-save.ts';
import type { GoalPlanInput } from './goal-planning.ts';

const workspace = '11111111-1111-4111-8111-111111111111';
const foreign = '22222222-2222-4222-8222-222222222222';
const g1 = '33333333-3333-4333-8333-333333333333';
const g2 = '44444444-4444-4444-8444-444444444444';
const id = (n: number) => `55555555-5555-4555-8555-${String(n).padStart(12, '0')}`;
function input(): GoalPlanInput { return { workspace_id: workspace, expected_revision: 7,
  goals_fingerprint: '0123456789abcdef0123456789abcdef', items: [
    { goal_id: g1, included: true, monthly_cents: 200, first_on: '2026-10-03' },
    { goal_id: g2, included: false, monthly_cents: null, first_on: null },
  ] }; }
const receipt = { workspace_id: workspace, edit_revision: 8 };
test('goal plan double tap shares one immutable operation and correct receipt', async () => {
  const calls: { payload: GoalPlanInput; id: string }[] = [];let finish!: (value: unknown) => void;
  const controller = createGoalPlanSaveController((payload, id) => {
    calls.push({ payload, id });return new Promise(resolve => { finish = resolve; });
  }, () => id(1));
  const original = input();const first = controller.submit(original);
  assert.equal(controller.submit(input()), first);assert.equal(calls.length, 1);
  original.items[0].monthly_cents = 500;
  assert.equal(calls[0].payload.items[0].monthly_cents, 200);assert.ok(Object.isFrozen(calls[0].payload.items[0]));
  await assert.rejects(controller.submit(original), /tentativa|confirma/i);
  finish(receipt);assert.deepEqual(await first, receipt);
});
test('transport loss preserves canonical array/key order and UUID until receipt', async () => {
  const calls: { payload: GoalPlanInput; id: string }[] = [];let next = 0;
  const controller = createGoalPlanSaveController(async (payload, id) => {
    calls.push({ payload, id });if (calls.length === 1) throw new Error('response lost');return receipt;
  }, () => id(++next));
  await assert.rejects(controller.submit(input()), /response lost/);
  const reordered = Object.fromEntries(Object.entries(input()).reverse()) as unknown as GoalPlanInput;
  reordered.items.reverse();assert.deepEqual(await controller.submit(reordered), receipt);
  assert.equal(calls[0].id, calls[1].id);assert.equal(calls[0].payload, calls[1].payload);
  assert.deepEqual(calls[1].payload.items.map(item => item.goal_id), [g1, g2]);
});
for (const code of ['22023', '23514', '42501', 'P0001', '40001', '40P01', 'PT409']) {
  test(`initial ${code} refusal releases the editable draft`, async () => {
    let count = 0;let next = 0;const published: (GoalPlanInput | null)[] = [];
    const controller = createGoalPlanSaveController(async payload => {
      if (++count === 1) throw { code };return { workspace_id: workspace, edit_revision: (payload.expected_revision ?? 0) + 1 };
    }, () => id(++next), value => published.push(value));
    await assert.rejects(controller.submit(input()));assert.equal(published.at(-1), null);
    assert.equal((await controller.submit({ ...input(), expected_revision: 8 })).edit_revision, 9);assert.equal(next, 2);
  });
}
for (const failure of [{ code: 'P0001' }, { code: '42501' }, { code: '22023' },
  { code: 'PT409', message: 'some unrelated refusal' },
  { code: '40001', message: 'Plano alterado. Confira novamente' }]) {
  test(`after ambiguity ${JSON.stringify(failure)} cannot disprove the original commit`, async () => {
    let count = 0;const controller = createGoalPlanSaveController(async () => {
      if (++count === 1) throw new Error('lost');throw failure;
    }, () => id(1));
    await assert.rejects(controller.submit(input()));await assert.rejects(controller.submit(input()));
    await assert.rejects(controller.submit({ ...input(), expected_revision: 8 }), /tentativa|confirma/i);assert.equal(count, 2);
  });
}
for (const message of ['Plano alterado. Confira novamente', 'As metas mudaram. Confira o plano novamente']) {
  test(`exact sealed-first PT409 ${message} permits reopening after timeout`, async () => {
    let count = 0;let next = 0;const controller = createGoalPlanSaveController(async payload => {
      if (++count === 1) throw new Error('lost');if (count === 2) throw { code: 'PT409', message };
      return { workspace_id: workspace, edit_revision: (payload.expected_revision ?? 0) + 1 };
    }, () => id(++next));
    await assert.rejects(controller.submit(input()));await assert.rejects(controller.submit(input()));
    assert.equal((await controller.submit({ ...input(), expected_revision: 8 })).edit_revision, 9);assert.equal(next, 2);
  });
}
for (const value of [null, { workspace_id: foreign, edit_revision: 8 }, { workspace_id: workspace, edit_revision: 7 },
  { ...receipt, extra: true }, { workspace_id: workspace, cancelled: false },
  { workspace_id: foreign, cancelled: true }, { workspace_id: workspace, cancelled: true, extra: true }]) {
  test(`unproven receipt ${JSON.stringify(value)} stays frozen`, async () => {
    const controller = createGoalPlanSaveController(async () => value, () => id(1), undefined, async () => value);
    await assert.rejects(controller.submit(input()));await assert.rejects(controller.resolve());
    await assert.rejects(controller.submit({ ...input(), expected_revision: 8 }), /tentativa|confirma/i);
  });
}
test('terminal resolution shares in-flight promise, releases intent and rotates UUID', async () => {
  let next = 0;let finish!: (value: unknown) => void;const requests: string[] = [];const published: (GoalPlanInput | null)[] = [];
  const controller = createGoalPlanSaveController(async (_, requestId) => {
    requests.push(requestId);throw new Error('lost');
  }, () => id(++next), value => published.push(value), (_, requestId) => {
    requests.push(requestId);return new Promise(resolve => { finish = resolve; });
  });
  await assert.rejects(controller.submit(input()));const first = controller.resolve();
  assert.equal(controller.resolve(), first);assert.equal(controller.submit(input()), first);
  finish({ workspace_id: workspace, cancelled: true });await assert.rejects(first, { name: 'GoalPlanAttemptCancelledError' });
  assert.equal(published.at(-1), null);assert.equal(requests[0], requests[1]);
  await assert.rejects(controller.submit({ ...input(), expected_revision: 8 }));assert.equal(next, 2);
});
test('resolution recovers matching sealed success without writing again', async () => {
  let sends = 0;const controller = createGoalPlanSaveController(async () => { sends++;throw new Error('lost'); },
    () => id(1), undefined, async () => receipt);
  await assert.rejects(controller.submit(input()));assert.deepEqual(await controller.resolve(), receipt);assert.equal(sends, 1);
});
test('PT409 from resolution does not replace a sealed success or cancellation receipt', async () => {
  const controller = createGoalPlanSaveController(async () => { throw new Error('lost'); },
    () => id(1), undefined, async () => { throw { code: 'PT409', message: 'Plano alterado. Confira novamente' }; });
  await assert.rejects(controller.submit(input()));await assert.rejects(controller.resolve());
  await assert.rejects(controller.submit({ ...input(), expected_revision: 8 }), /tentativa|confirma/i);
});
test('a delayed save receives terminal cancellation without inventing success', async () => {
  const controller = createGoalPlanSaveController(async () => ({ workspace_id: workspace, cancelled: true }), () => id(1));
  await assert.rejects(controller.submit(input()), { name: 'GoalPlanAttemptCancelledError' });
});
test('closed malformed commands and unsafe revision never dispatch', async () => {
  let sends = 0;const controller = createGoalPlanSaveController(async () => { sends++;return receipt; }, () => id(1));
  const invalid: unknown[] = [null, { ...input(), extra: true }, { ...input(), expected_revision: 0 },
    { ...input(), expected_revision: Number.MAX_SAFE_INTEGER }, { ...input(), workspace_id: 'wrong' },
    { ...input(), goals_fingerprint: 'wrong' }, { ...input(), items: [input().items[0], input().items[0]] },
    ...[null, 0, 1.5, Number.MAX_SAFE_INTEGER + 1, '200'].map(monthly_cents => ({ ...input(), items: [{ ...input().items[0], monthly_cents }] })),
    ...[null, '2026-02-29', '2026-13-01', '2026-10-32'].map(first_on => ({ ...input(), items: [{ ...input().items[0], first_on }] })),
    { ...input(), items: [{ ...input().items[1], monthly_cents: 1 }] },
  ];
  for (const value of invalid) await assert.rejects(controller.submit(value as GoalPlanInput));
  assert.equal(sends, 0);
  const badIdentity = createGoalPlanSaveController(async () => { sends++;return receipt; }, () => 'wrong');
  await assert.rejects(badIdentity.submit(input()));assert.equal(sends, 0);
});
test('new plan expects revision one, including explicit empty plan', async () => {
  const controller = createGoalPlanSaveController(async () => ({ workspace_id: workspace, edit_revision: 1 }), () => id(1));
  assert.deepEqual(await controller.submit({ ...input(), expected_revision: null, items: [] }), { workspace_id: workspace, edit_revision: 1 });
});
test('write messages keep transport internals private and qualify source changes', () => {
  assert.match(goalPlanWriteError({ code: 'PT409', message: 'As metas mudaram. Confira o plano novamente' }), /mud|confer/i);
  assert.doesNotMatch(goalPlanWriteError(new Error('https://internal.invalid?secret=x')), /internal|secret|http/i);
});
