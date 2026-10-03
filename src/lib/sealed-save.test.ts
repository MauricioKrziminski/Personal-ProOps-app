import assert from 'node:assert/strict';
import test from 'node:test';
import { createSealedSaveController, type SealedSaveStrategy } from './sealed-save.ts';

type Input = { value: number; details: { label: string }[] };
const command = (): Input => ({ value: 1, details: [{ label: 'frozen' }] });
const strategy: SealedSaveStrategy<Input, number> = {
  normalize: input => ({ value: input.value, details: input.details.map(item => ({ label: item.label })) }),
  requestId: value => value,
  decode: (value, input) => { if (value !== input.value + 1) throw new Error('unproven receipt'); return value; },
  definitiveRefusal: () => false, confirmedRefusal: () => false, terminalRefusal: () => false,
};
test('sealed controller coalesces a write with resolution and publishes immutable owned input', async () => {
  let finish!: (value: unknown) => void;let dispatched!: Input;const published: (Input | null)[] = [];
  const controller = createSealedSaveController<Input, number>((input) => {
    dispatched = input;return new Promise(resolve => { finish = resolve; });
  }, () => 'request', strategy, input => published.push(input), async () => 2);
  const original = command();const first = controller.submit(original);
  assert.equal(controller.submit(command()), first);
  assert.equal(controller.resolve(), first, 'resolution must not race the save');
  original.details[0].label = 'changed externally';
  assert.equal(dispatched.details[0].label, 'frozen');
  assert.ok(Object.isFrozen(dispatched.details[0]));assert.ok(Object.isFrozen(dispatched.details));
  finish(2);assert.equal(await first, 2);assert.equal(published.at(-1), null);
});
test('unproven receipt keeps the exact UUID and payload until a confirmed retry', async () => {
  const calls: { input: Input; id: string }[] = [];let ids = 0;
  const controller = createSealedSaveController<Input, number>(async (input, id) => {
    calls.push({ input, id });return calls.length === 1 ? 777 : 2;
  }, () => `request-${++ids}`, strategy);
  await assert.rejects(controller.submit(command()), /unproven/);
  await assert.rejects(controller.submit({ ...command(), value: 2 }), /tentativa|confirma/i);
  assert.equal(await controller.submit(command()), 2);
  assert.equal(calls[0].id, calls[1].id);assert.equal(calls[0].input, calls[1].input);
});
