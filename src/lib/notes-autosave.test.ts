import assert from 'node:assert/strict';
import { test } from 'node:test';

import { skipReason, type AutosaveState } from './notes-autosave.ts';

const base: AutosaveState = {
  hydrated: true,
  trashed: false,
  id: 'nota-1',
  text: 'Reunião com o contador\nlevar extrato',
  folderId: 'pasta-1',
  persisted: { content: 'Reunião com o contador', folderId: 'pasta-1' },
};

test('autosave: texto novo em nota existente grava', () => {
  assert.equal(skipReason(base), null);
});

test('autosave: nada mudou não vira requisição', () => {
  assert.equal(
    skipReason({ ...base, text: 'Reunião com o contador', folderId: 'pasta-1' }),
    'unchanged'
  );
});

test('autosave: antes da hidratação nunca grava (a nota ainda está carregando)', () => {
  assert.equal(
    skipReason({ ...base, hydrated: false, text: '', folderId: null, persisted: null }),
    'not-hydrated'
  );
});

test('autosave: remontagem com estado zerado NÃO esvazia a nota — é o bug de 28/08', () => {
  // Refs sobreviveram ao Fast Refresh (hydrated/id/persisted), `useState` voltou ao inicial.
  const remontada: AutosaveState = { ...base, text: '', folderId: null };
  assert.equal(skipReason(remontada), 'would-empty');
});

test('autosave: apagar o texto de propósito também não grava — apagar é a Lixeira', () => {
  assert.equal(skipReason({ ...base, text: '   \n  ' }), 'would-empty');
});

test('autosave: nota em branco nunca é inserida', () => {
  assert.equal(skipReason({ ...base, id: null, text: '', persisted: null }), 'empty-new');
  // …mas com texto, o primeiro autosave insere.
  assert.equal(skipReason({ ...base, id: null, text: 'oi', persisted: null }), null);
});

test('autosave: nota que já estava vazia pode receber texto e continuar vazia sem gravar', () => {
  const vazia: AutosaveState = {
    ...base,
    text: '',
    persisted: { content: '', folderId: 'pasta-1' },
    folderId: 'pasta-2',
  };
  // Persistido vazio: mudar só a pasta é intenção legítima, não perda de dado.
  assert.equal(skipReason(vazia), null);
});

test('autosave: nota na lixeira não recebe mais nada', () => {
  assert.equal(skipReason({ ...base, trashed: true }), 'trashed');
});
