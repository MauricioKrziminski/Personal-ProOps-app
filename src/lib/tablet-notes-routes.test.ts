import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('folder organizer is the whole tree, and renaming opens the same sheet as creating', () => {
  const source = readFileSync('src/app/notes/folders.tsx', 'utf8');
  assert.match(source, /<Screen grouped wide/);
  assert.match(source, /folderTree\(list\)/);
  assert.match(source, /onPress=\{\(\) => showActions\(folder\)\}/);
  assert.match(source, /<NovaPastaSheet[\s\S]{0,200}pasta=\{editando\}/);
  // Criar mora no "…" de Notas (25/09/2026): aqui não há mais editor nem "Criar pasta".
  assert.doesNotMatch(source, /Criar pasta|folderEditor/);
});
