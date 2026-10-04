import assert from 'node:assert/strict';
import test from 'node:test';
import { createGoalHorizonSaveController } from './goal-horizon-save.ts';
import { GoalPlanAttemptCancelledError } from './goal-plan-save.ts';
import type { GoalHorizonInput } from './goal-horizon.ts';

const ws = '10000000-0000-4000-8000-000000000001';const goal = '20000000-0000-4000-8000-000000000001';
const request = '30000000-0000-4000-8000-000000000001';
function input(): GoalHorizonInput {
  return { workspace_id: ws, expected_revision: 2, goals_fingerprint: 'abcdef0123456789abcdef0123456789',
    items: [{ goal_id: goal, included: true, mode: 'deadline', monthly_cents: null,
      first_on: '2027-01-31', deadline_on: '2027-03-31', initial_cents: 1000, initial_on: '2027-01-01' }] };
}
test('F10 lost response retains complete source/initial/date and same identity for confirmation', async () => {
  const calls: { intent: GoalHorizonInput; id: string }[] = [];const published: (GoalHorizonInput | null)[] = [];
  const controller = createGoalHorizonSaveController(async (intent, id) => {
    calls.push({ intent: structuredClone(intent), id });if (calls.length === 1) throw new Error('offline after commit');
    return { workspace_id: ws, edit_revision: 3 };
  }, () => request, value => published.push(value));
  const draft = input();await assert.rejects(controller.submit(draft), /offline/);draft.items[0].initial_cents = 2000;
  const changed = input();changed.items[0].deadline_on = '2027-04-30';
  await assert.rejects(controller.submit(changed));
  assert.equal(calls.length, 1);
  assert.equal(published.at(-1)?.items[0].initial_cents, 1000);
  await controller.submit(input());
  assert.deepEqual(calls[0], calls[1]);assert.equal(published.at(-1), null);
});
test('F10 terminal resolution accepts only command-owned matching closed receipt', async () => {
  const calls: GoalHorizonInput[] = [];let mode = 'wrong';
  const controller = createGoalHorizonSaveController(async () => { throw new Error('offline'); }, () => request, undefined,
    async intent => { calls.push(intent);return mode === 'wrong' ? { workspace_id: ws, cancelled: true, paid: false } : { workspace_id: ws, cancelled: true }; });
  await assert.rejects(controller.submit(input()));await assert.rejects(controller.resolve(), /campos inválidos|encerramento/);
  mode = 'right';await assert.rejects(controller.resolve(), GoalPlanAttemptCancelledError);
  assert.deepEqual(calls[0], input());
});
for (const receipt of [{ workspace_id: goal, edit_revision: 3 }, { workspace_id: ws, edit_revision: 4 },
  { workspace_id: ws, edit_revision: 3, extra: true }]) test('F10 refuses wrong workspace/revision/open receipt and freezes intent', async () => {
  let pending: GoalHorizonInput | null = null;
  const controller = createGoalHorizonSaveController(async () => receipt, () => request, value => { pending = value; });
  await assert.rejects(controller.submit(input()));assert.deepEqual(pending, input());
});
test('F10 controller refuses source-inactive money before transport', async () => {
  let calls = 0;const controller = createGoalHorizonSaveController(async () => { calls++;return {}; }, () => request);
  const draft = input();draft.items[0].monthly_cents = 1;
  await assert.rejects(controller.submit(draft), /fonte inativa/);assert.equal(calls, 0);
});
