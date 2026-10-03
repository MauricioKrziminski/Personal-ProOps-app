import assert from 'node:assert/strict';
import test from 'node:test';
import { createSubcategorySaveController, SubcategoryAttemptCancelledError, subcategoryWriteError } from './subcategory-save.ts';
import type { SubcategoryWriteInput } from './subcategories.ts';
const ws = '11111111-1111-4111-8111-111111111111';
const foreign = '22222222-2222-4222-8222-222222222222';
const source = '33333333-3333-4333-8333-333333333333';
const target = '44444444-4444-4444-8444-444444444444';
const uuid = (n: number) => `55555555-5555-4555-8555-${String(n).padStart(12, '0')}`;
function edit(): SubcategoryWriteInput { return { action: 'save', workspace_id: ws, subcategory_id: source, expected_revision: 7,
  parent_category: 'alimentação', name: 'mercado', merge_into_id: null, expected_merge_revision: null }; }
const receipt = { workspace_id: ws, subcategory_id: source, edit_revision: 8, merged: false, deleted: false, affected_records: 2 };
function changed(): SubcategoryWriteInput { return { ...edit(), expected_revision: 8 }; }

test('double tap coalesces and owns immutable normalized intent despite caller mutation', async () => {
  const calls: { input: SubcategoryWriteInput; id: string }[] = []; let finish!: (value: unknown) => void;
  const controller = createSubcategorySaveController((input, id) => { calls.push({ input, id }); return new Promise(resolve => { finish = resolve; }); }, () => uuid(1));
  const original = edit(); const first = controller.submit(original);
  assert.equal(controller.submit(edit()), first); assert.equal(calls.length, 1);
  if (original.action === 'save') original.name = 'feira';
  assert.equal(calls[0].input.action === 'save' && calls[0].input.name, 'mercado'); assert.ok(Object.isFrozen(calls[0].input));
  await assert.rejects(controller.submit(original), /tentativa|confirma/i);
  finish(receipt); assert.deepEqual(await first, receipt);
});

test('transport ambiguity retains exact normalized payload and UUID on reordered retry', async () => {
  const calls: { input: SubcategoryWriteInput; id: string }[] = []; let next = 0;
  const controller = createSubcategorySaveController(async (input, id) => { calls.push({ input, id }); if (calls.length === 1) throw new Error('lost'); return receipt; }, () => uuid(++next));
  await assert.rejects(controller.submit(edit()), /lost/);
  const reordered = Object.fromEntries(Object.entries(edit()).reverse()) as SubcategoryWriteInput;
  assert.deepEqual(await controller.submit(reordered), receipt);
  assert.equal(calls[0].id, calls[1].id); assert.equal(calls[0].input, calls[1].input); assert.equal(next, 1);
});

for (const code of ['22023', '23514', '42501', 'P0001', '40001', '40P01', 'PT409']) {
  test(`initial SQL ${code} releases intent after definite rejection`, async () => {
    let calls = 0; let next = 0; const published: (SubcategoryWriteInput | null)[] = [];
    const controller = createSubcategorySaveController(async () => { if (++calls === 1) throw { code }; return { ...receipt, edit_revision: 9 }; }, () => uuid(++next), value => published.push(value));
    await assert.rejects(controller.submit(edit())); assert.equal(published.at(-1), null);
    await controller.submit(changed()); assert.equal(next, 2);
  });
}
for (const failure of [{ code: '22023' }, { code: '23514' }, { code: '42501' }, { code: 'P0001' }, { code: '40001' }, { code: '40P01' }, { code: 'PT409', message: 'other conflict' }]) {
  test(`SQL ${JSON.stringify(failure)} after lost response cannot disprove commit`, async () => {
    let calls = 0;
    const controller = createSubcategorySaveController(async () => { if (++calls === 1) throw new Error('lost'); throw failure; }, () => uuid(1));
    await assert.rejects(controller.submit(edit())); await assert.rejects(controller.submit(edit()));
    await assert.rejects(controller.submit(changed()), /tentativa|confirma/i); assert.equal(calls, 2);
  });
}
for (const message of ['Detalhe alterado. Abra novamente', 'Detalhe receptor alterado. Abra novamente', 'Já existe um detalhe com esse nome nesta categoria. Confira para juntar']) {
  test(`sealed-first save PT409 ${message} confirms refusal after ambiguity`, async () => {
    let calls = 0; let next = 0;
    const controller = createSubcategorySaveController(async () => { if (++calls === 1) throw new Error('lost'); if (calls === 2) throw { code: 'PT409', message }; return { ...receipt, edit_revision: 9 }; }, () => uuid(++next));
    await assert.rejects(controller.submit(edit())); await assert.rejects(controller.submit(edit()));
    await controller.submit(changed()); assert.equal(next, 2);
  });
}

for (const value of [null, { ...receipt, workspace_id: foreign }, { ...receipt, subcategory_id: target },
  { ...receipt, edit_revision: 7 }, { ...receipt, merged: true }, { ...receipt, deleted: true, edit_revision: null },
  { ...receipt, extra: true }, { ...receipt, affected_records: '2' }, { ...receipt, affected_records: Number.MAX_SAFE_INTEGER + 1 },
  { workspace_id: foreign, cancelled: true }, { workspace_id: ws, cancelled: false }, { workspace_id: ws, cancelled: true, extra: 1 }]) {
  test(`malformed or mismatched receipt ${JSON.stringify(value)} cannot release intent`, async () => {
    const controller = createSubcategorySaveController(async () => value, () => uuid(1), undefined, async () => value);
    await assert.rejects(controller.submit(edit())); await assert.rejects(controller.resolve());
    await assert.rejects(controller.submit(changed()), /tentativa|confirma/i);
  });
}

test('resolution coalesces with submit and accepts only matching terminal cancellation', async () => {
  let next = 0; let finish!: (value: unknown) => void; const ids: string[] = []; const published: (SubcategoryWriteInput | null)[] = [];
  const controller = createSubcategorySaveController(async (_, id) => { ids.push(id); throw new Error('lost'); }, () => uuid(++next), value => published.push(value), (_, id) => { ids.push(id); return new Promise(resolve => { finish = resolve; }); });
  await assert.rejects(controller.submit(edit())); const first = controller.resolve();
  assert.equal(controller.resolve(), first); assert.equal(controller.submit(edit()), first);
  finish({ workspace_id: ws, cancelled: true }); await assert.rejects(first, SubcategoryAttemptCancelledError);
  assert.equal(published.at(-1), null); assert.equal(ids[0], ids[1]);
  await assert.rejects(controller.submit(changed())); assert.equal(next, 2);
});

test('resolution recovers delayed commit without rewriting; PT409 alone in resolve remains ambiguous', async () => {
  let sends = 0; let resolutions = 0;
  const controller = createSubcategorySaveController(async () => { sends++; throw new Error('lost'); }, () => uuid(1), undefined,
    async () => { if (++resolutions === 1) throw { code: 'PT409', message: 'Detalhe alterado. Abra novamente' }; return receipt; });
  await assert.rejects(controller.submit(edit())); await assert.rejects(controller.resolve());
  await assert.rejects(controller.submit(changed()), /tentativa|confirma/i);
  assert.deepEqual(await controller.resolve(), receipt); assert.equal(sends, 1);
});

test('create, merge and delete demand exact receipt identity, flags and next revision', async () => {
  const create = { ...edit(), subcategory_id: null, expected_revision: null } as SubcategoryWriteInput;
  const merge = { ...edit(), merge_into_id: target, expected_merge_revision: 3 } as SubcategoryWriteInput;
  const remove: SubcategoryWriteInput = { action: 'delete', workspace_id: ws, subcategory_id: source, expected_revision: 7 };
  for (const [input, good, bads] of [
    [create, { ...receipt, edit_revision: 1 }, [{ ...receipt, edit_revision: 2 }, { ...receipt, subcategory_id: null, edit_revision: 1 }]],
    [merge, { ...receipt, subcategory_id: target, edit_revision: 4, merged: true }, [{ ...receipt, merged: true }, { ...receipt, subcategory_id: target, edit_revision: 4 }]],
    [remove, { ...receipt, edit_revision: null, deleted: true }, [{ ...receipt, deleted: true }, { ...receipt, subcategory_id: target, edit_revision: null, deleted: true }]],
  ] as const) {
    const controller = createSubcategorySaveController(async () => good, () => uuid(1)); assert.deepEqual(await controller.submit(input), good);
    for (const bad of bads) {
      const failing = createSubcategorySaveController(async () => bad, () => uuid(1)); await assert.rejects(failing.submit(input));
      await assert.rejects(failing.submit({ ...edit(), expected_revision: 9 }), /tentativa|confirma/i);
    }
  }
});

test('malformed intent and revision overflow never dispatch; invalid request UUID is refused', async () => {
  let calls = 0; const controller = createSubcategorySaveController(async () => { calls++; return receipt; }, () => uuid(1));
  for (const input of [null, { ...edit(), extra: 1 }, { ...edit(), expected_revision: Number.MAX_SAFE_INTEGER },
    { ...edit(), merge_into_id: target, expected_merge_revision: Number.MAX_SAFE_INTEGER }]) await assert.rejects(controller.submit(input as SubcategoryWriteInput));
  await assert.rejects(createSubcategorySaveController(async () => { calls++; return receipt; }, () => 'bad').submit(edit()));
  assert.equal(calls, 0);
});

test('delayed send can return terminal cancellation and friendly errors hide transport internals', async () => {
  await assert.rejects(createSubcategorySaveController(async () => ({ workspace_id: ws, cancelled: true }), () => uuid(1)).submit(edit()), SubcategoryAttemptCancelledError);
  assert.match(subcategoryWriteError({ code: 'PT409', message: 'Detalhe alterado. Abra novamente' }), /abr|confer|mud/i);
  assert.doesNotMatch(subcategoryWriteError(new Error('https://secret.internal/token')), /secret|http|token/i);
  assert.match(subcategoryWriteError(new SubcategoryAttemptCancelledError()), /não.*salv/i);
});

test('a transport-thrown cancellation error is not a sealed terminal receipt', async () => {
  let calls = 0;
  const controller = createSubcategorySaveController(async () => {
    if (++calls === 1) throw new Error('lost');
    throw new SubcategoryAttemptCancelledError();
  }, () => uuid(1));
  await assert.rejects(controller.submit(edit())); await assert.rejects(controller.submit(edit()));
  await assert.rejects(controller.submit(changed()), /tentativa|confirma/i);
  assert.equal(calls, 2);
});
