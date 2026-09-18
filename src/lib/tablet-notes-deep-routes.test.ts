import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const readRoute = (route: string) => readFileSync(route, 'utf8');

test('notes recovery routes use the measured tablet workspace and keep a compact fallback', () => {
  for (const route of ['src/app/notes/archived.tsx', 'src/app/notes/trash.tsx']) {
    const source = readRoute(route);
    assert.match(source, /useAdaptiveWindow/);
    assert.match(source, /<AdaptivePanes/);
    assert.match(source, /wide=\{tablet\}/);
    assert.match(source, /singlePaneContent=\{(?:archiveList|trashBody)\}/);
  }
});

test('notes deep editor and folder stay readable when a tablet window is wide', () => {
  for (const route of ['src/app/notes/[id].tsx', 'src/app/notes/folder/[id].tsx']) {
    const source = readRoute(route);
    assert.match(source, /useAdaptiveWindow/);
    assert.match(source, /wide=\{tablet\}/);
    assert.match(source, /headerLargeTitle: !tablet/);
    assert.doesNotMatch(source, /Device\.modelName/);
  }

  assert.match(readRoute('src/app/notes/[id].tsx'), /maxWidth: MaxContentWidth/);
});
