import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { deleteScopeChoices, editScopeChoices } from './edit-scope-model.ts';

for (const kind of ['occurrence', 'installment', 'payment', 'reminder'] as const) {
  test(`${kind}: Salvar oferece exatamente um, futuras e todas`, () => {
    const choices = editScopeChoices(kind);
    assert.deepEqual(choices.map((choice) => choice.scope), ['one', 'future', 'all']);
    assert.equal(new Set(choices.map((choice) => choice.label)).size, 3);
    assert.match(choices[2].label, /passad/);
  });
}

for (const kind of ['occurrence', 'installment', 'payment', 'reminder'] as const) {
  test(`${kind}: editando o contrato não há "Só esta" — próximas e todas`, () => {
    const choices = editScopeChoices(kind, { contrato: true });
    assert.deepEqual(choices.map((choice) => choice.scope), ['future', 'all']);
    assert.ok(!choices.some((c) => /\b(esta|este)\b/i.test(c.label)), 'nada de "esta" sem uma ocorrência aberta');
    assert.match(choices[1].label, /passad/);
  });
}

test('as portas de CONTRATO não oferecem "Só esta"; a ocorrência aberta oferece (28/09/2026)', () => {
  const ler = (f: string) => readFileSync(f, 'utf8');
  for (const tela of ['src/components/finance/formulario-da-divida.tsx', 'src/app/finance/installments.tsx', 'src/components/finance/formulario-da-serie.tsx'])
    assert.match(ler(tela), /askEditScope\([\s\S]*?\{ contrato: true \}\)/, `${tela} edita o contrato`);
  assert.doesNotMatch(ler('src/components/finance/formulario-do-lancamento.tsx'), /contrato: true/, 'o lançamento é UMA ocorrência');
  // o lembrete: pela lista é a série; pela Hoje (o disparo de hoje), uma ocorrência
  assert.match(ler('src/app/reminder-form.tsx'), /\{ contrato: !umaOcorrencia \}/);
  assert.match(ler('src/app/(tabs)/today/index.tsx'), /reminder-form', params: \{ id, ocorrencia: '1' \}/);
});

test('apagar: mesmas três escolhas do editar; contrato fica com duas; lembrete só com esta/todas', () => {
  assert.deepEqual(deleteScopeChoices('occurrence').map((c) => c.scope), ['one', 'future', 'all']);
  assert.deepEqual(deleteScopeChoices('installment', { contrato: true }).map((c) => c.scope), ['future', 'all']);
  assert.deepEqual(deleteScopeChoices('reminder', { alcances: ['one', 'all'] }).map((c) => c.scope), ['one', 'all']);
});
