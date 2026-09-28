import assert from 'node:assert/strict';
import { test } from 'node:test';

import { editScopeChoices } from './edit-scope-model.ts';

for (const kind of ['occurrence', 'installment', 'payment', 'reminder'] as const) {
  test(`${kind}: Salvar oferece exatamente um, futuras e todas`, () => {
    const choices = editScopeChoices(kind);
    assert.deepEqual(choices.map((choice) => choice.scope), ['one', 'future', 'all']);
    assert.equal(new Set(choices.map((choice) => choice.label)).size, 3);
    assert.match(choices[2].label, /passad/);
  });
}
