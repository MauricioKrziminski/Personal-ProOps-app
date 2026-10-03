import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeSubcategoryState, subcategoryAfterParentChange, subcategoryForParent,
  subcategoryWriteInput, decodeSubcategoryWriteResult, sumSubcategoryBreakdown } from './subcategories.ts';

const ws = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';
const a = '20000000-0000-4000-8000-00000000000a';
const b = '20000000-0000-4000-8000-00000000000b';
function child() { return { id: a, workspace_id: ws, parent_category: 'alimentação', name: 'mercado', edit_revision: 1, uses: 0 }; }
function state() { return { workspace_id: ws, items: [child()] }; }
function save() { return { action: 'save', workspace_id: ws, subcategory_id: null, expected_revision: null,
  parent_category: 'alimentação', name: 'mercado', merge_into_id: null, expected_merge_revision: null }; }
function result() { return { workspace_id: ws, subcategory_id: a, edit_revision: 1, merged: false, deleted: false, affected_records: 0 }; }
const reject = (fn: () => unknown) => assert.throws(fn, /inválid|confira/i);

test('changing parent clears detail; equivalent aliases preserve it; null never invents detail', () => {
  assert.equal(subcategoryAfterParentChange(a, 'alimentação', 'saúde'), null);
  assert.equal(subcategoryAfterParentChange(a, 'alimentação', ' ALIMENTACAO '), a);
  assert.equal(subcategoryAfterParentChange(a, 'alimentação', null), null);
  assert.equal(subcategoryAfterParentChange(a, null, 'alimentação'), null);
  assert.equal(subcategoryAfterParentChange(null, 'alimentação', 'saúde'), null);
});

test('read decoder returns independent closed copies and accepts income parents', () => {
  const raw = state(); const decoded = decodeSubcategoryState(raw);
  assert.deepEqual(decoded, { workspace_id: ws, items: [{ id: a, workspace_id: ws, parent_category: 'alimentação', name: 'mercado', edit_revision: 1, uses: 0 }] });
  decoded.items[0].name = 'feira'; decoded.items.push({ ...child(), id: b });
  assert.equal(raw.items[0].name, 'mercado'); assert.equal(raw.items.length, 1);
  assert.equal(decodeSubcategoryState({ workspace_id: ws, items: [{ ...child(), parent_category: 'salário' }] }).items[0].parent_category, 'salário');
});

const invalidChild: [string, Record<string, unknown>][] = [
  ['extra', { secret: true }], ['bad id', { id: 'id' }], ['bad workspace', { workspace_id: other }],
  ['whitespace name', { name: ' mercado' }], ['uppercase name', { name: 'Mercado' }], ['empty parent', { parent_category: '' }],
  ['uppercase parent', { parent_category: 'Saúde' }], ['long parent', { parent_category: 'x'.repeat(41) }],
  ['long name', { name: '🛒'.repeat(41) }], ['null revision', { edit_revision: null }], ['zero revision', { edit_revision: 0 }],
  ['coerced revision', { edit_revision: '1' }], ['unsafe revision', { edit_revision: Number.MAX_SAFE_INTEGER + 1 }],
  ['negative count', { uses: -1 }], ['decimal count', { uses: 0.5 }], ['coerced count', { uses: '0' }], ['unsafe count', { uses: Number.MAX_SAFE_INTEGER + 1 }],
];
for (const [name, patch] of invalidChild) test(`read refuses ${name}`, () => reject(() => decodeSubcategoryState({ workspace_id: ws, items: [{ ...child(), ...patch }] })));

test('read refuses malformed state and duplicate identity or folded namespaces', () => {
  for (const raw of [null, [], {}, { ...state(), extra: 1 }, { ...state(), items: null }, { ...state(), workspace_id: 'x' },
    { workspace_id: ws, items: [child(), child()] },
    { workspace_id: ws, items: [child(), { ...child(), id: b, parent_category: 'alimentacao', name: 'mércado' }] }]) reject(() => decodeSubcategoryState(raw));
  assert.equal(decodeSubcategoryState({ workspace_id: ws, items: [child(), { ...child(), id: b, parent_category: 'saúde' }] }).items.length, 2);
});

test('name limits count Unicode codepoints and UUID aliases normalize', () => {
  const raw = { workspace_id: ws, items: [{ ...child(), name: '🛒'.repeat(40), parent_category: '🍎'.repeat(40), id: a.toUpperCase() }] };
  assert.equal(decodeSubcategoryState(raw).items[0].name, '🛒'.repeat(40));
  assert.equal(decodeSubcategoryState(raw).items[0].id, a);
  reject(() => decodeSubcategoryState({ workspace_id: ws, items: [child(), { ...child(), id: a.toUpperCase() }] }));
  assert.equal(subcategoryWriteInput({ ...save(), name: ' 🛒 '.trim(), parent_category: ' SALÁRIO ' }).action, 'save');
});

test('explicit detail resolves only current matching workspace and parent, as a copy', () => {
  const raw = state(); const resolved = subcategoryForParent(raw, a, ' ALIMENTACAO ', ws);
  assert.equal(resolved?.id, a); resolved!.name = 'feira'; assert.equal(raw.items[0].name, 'mercado');
  assert.equal(subcategoryForParent(null, null, null, ''), null);
  for (const fn of [() => subcategoryForParent(null, a, 'alimentação', ws), () => subcategoryForParent(raw, b, 'alimentação', ws),
    () => subcategoryForParent(raw, a, 'saúde', ws), () => subcategoryForParent(raw, a, null, ws),
    () => subcategoryForParent(raw, a, 'alimentação', other), () => subcategoryForParent(raw, a, 'alimentação', '')]) reject(fn);
});

test('save builder normalizes user names without mutating caller and admits create, edit, merge', () => {
  const raw = { ...save(), parent_category: ' ALIMENTAÇÃO ', name: ' MERCADO ' };
  const copied = subcategoryWriteInput(raw); assert.deepEqual(copied, save());
  assert.equal(raw.name, ' MERCADO '); assert.notEqual(copied, raw);
  assert.deepEqual(subcategoryWriteInput({ ...save(), subcategory_id: a, expected_revision: 2 }), { ...save(), subcategory_id: a, expected_revision: 2 });
  assert.deepEqual(subcategoryWriteInput({ ...save(), subcategory_id: a, expected_revision: 2, merge_into_id: b, expected_merge_revision: 3 }),
    { ...save(), subcategory_id: a, expected_revision: 2, merge_into_id: b, expected_merge_revision: 3 });
});
const invalidSave: [string, Record<string, unknown>][] = [
  ['extra', { extra: 0 }], ['action', { action: 'rename' }], ['workspace', { workspace_id: 'bad' }], ['missing id pair', { subcategory_id: a }],
  ['missing revision pair', { expected_revision: 1 }], ['zero revision', { subcategory_id: a, expected_revision: 0 }],
  ['bad id', { subcategory_id: 'bad', expected_revision: 1 }], ['blank name', { name: '  ' }], ['coerced name', { name: 10 }],
  ['long Unicode name', { name: '🛒'.repeat(41) }], ['merge create', { merge_into_id: b, expected_merge_revision: 1 }],
  ['merge same source', { subcategory_id: a, expected_revision: 1, merge_into_id: a, expected_merge_revision: 1 }],
  ['merge without revision', { subcategory_id: a, expected_revision: 1, merge_into_id: b }],
  ['merge revision without id', { subcategory_id: a, expected_revision: 1, expected_merge_revision: 1 }],
  ['merge zero revision', { subcategory_id: a, expected_revision: 1, merge_into_id: b, expected_merge_revision: 0 }],
  ['coerced revision', { subcategory_id: a, expected_revision: '1' }],
];
for (const [name, patch] of invalidSave) test(`save refuses ${name}`, () => reject(() => subcategoryWriteInput({ ...save(), ...patch })));

test('commands require every field, delete accepts only its own closed shape', () => {
  for (const key of Object.keys(save())) { const raw: Record<string, unknown> = save(); delete raw[key]; reject(() => subcategoryWriteInput(raw)); }
  const del = { action: 'delete', workspace_id: ws, subcategory_id: a, expected_revision: 1 };
  assert.deepEqual(subcategoryWriteInput(del), del); assert.notEqual(subcategoryWriteInput(del), del);
  for (const patch of [{ parent_category: 'alimentação' }, { expected_revision: null }, { expected_revision: 0 }, { subcategory_id: null }, { expected_revision: 1.1 }]) reject(() => subcategoryWriteInput({ ...del, ...patch }));
});

test('write result validates saved, merged and deleted invariants and copies result', () => {
  const raw = result(); assert.deepEqual(decodeSubcategoryWriteResult(raw), raw); assert.notEqual(decodeSubcategoryWriteResult(raw), raw);
  assert.equal(decodeSubcategoryWriteResult({ ...raw, merged: true }).merged, true);
  assert.equal(decodeSubcategoryWriteResult({ ...raw, deleted: true, edit_revision: null }).deleted, true);
  for (const patch of [{ extra: 1 }, { workspace_id: 'x' }, { subcategory_id: 'x' }, { deleted: 'false' }, { merged: 1 },
    { edit_revision: null }, { edit_revision: 0 }, { edit_revision: '1' }, { deleted: true },
    { deleted: true, merged: true, edit_revision: null }, { affected_records: -1 }, { affected_records: 0.1 },
    { affected_records: '1' }, { affected_records: Number.MAX_SAFE_INTEGER + 1 }]) reject(() => decodeSubcategoryWriteResult({ ...raw, ...patch }));
});

test('breakdown preserves Sem detalhe and closes exactly in safe integer cents', () => {
  assert.equal(sumSubcategoryBreakdown(1001, [{ subcategory_id: a, total_cents: 601 }, { subcategory_id: null, total_cents: 400 }]), 1001);
  assert.equal(sumSubcategoryBreakdown(0, []), 0);
  assert.equal(sumSubcategoryBreakdown(Number.MAX_SAFE_INTEGER, [{ subcategory_id: null, total_cents: Number.MAX_SAFE_INTEGER }]), Number.MAX_SAFE_INTEGER);
  for (const [parent, lines] of [
    [1001, [{ subcategory_id: a, total_cents: 601 }]],
    [2, [{ subcategory_id: a, total_cents: 1 }, { subcategory_id: a, total_cents: 1 }]],
    [2, [{ subcategory_id: null, total_cents: 1 }, { subcategory_id: null, total_cents: 1 }]],
    [1, [{ subcategory_id: 'bad', total_cents: 1 }]],
    [1, [{ subcategory_id: a, total_cents: 0.5 }]],
    [1, [{ subcategory_id: a, total_cents: -1 }]],
    [Number.MAX_SAFE_INTEGER, [{ subcategory_id: a, total_cents: Number.MAX_SAFE_INTEGER }, { subcategory_id: null, total_cents: 1 }]],
  ] as const) reject(() => sumSubcategoryBreakdown(parent, lines));
  for (const parent of [-1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) reject(() => sumSubcategoryBreakdown(parent, []));
});
