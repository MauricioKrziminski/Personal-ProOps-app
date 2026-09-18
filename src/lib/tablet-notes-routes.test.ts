import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('folder organizer places the hierarchy beside its editor on wide windows without changing folder actions', () => {
  const source = readFileSync('src/app/notes/folders.tsx', 'utf8');
  assert.match(source, /<Screen grouped wide/);
  assert.match(source, /<AdaptivePanes/);
  assert.match(source, /main=\{folderLibrary\}/);
  assert.match(source, /support=\{folderEditor\}/);
  assert.match(source, /singlePaneContent=\{compactOrganizer\}/);
  assert.match(source, /folderTree\(list\)/);
  assert.match(source, /onPress=\{\(\) => showActions\(folder\)\}/);
  assert.match(source, /onPress=\{\(\) => void submit\(\)\}/);
});
