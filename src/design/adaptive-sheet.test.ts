import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { tabletSheetFrame } from './adaptive-sheet.ts';

test('tablet sheets use a bounded task surface in both orientations', () => {
  assert.deepEqual(tabletSheetFrame(820, 1180), { width: 720, height: 840 });
  assert.deepEqual(tabletSheetFrame(1180, 820), { width: 720, height: 756 });
  assert.deepEqual(tabletSheetFrame(610, 700), { width: 562, height: 636 });
});

test('shared sheets use native iPad form presentation and Android tablet dialog semantics', () => {
  const sheet = readFileSync('src/components/ui/sheet.tsx', 'utf8');
  const header = readFileSync('src/components/ui/task-header.tsx', 'utf8');
  assert.match(sheet, /presentationStyle=\{iosTablet \? 'formSheet'/);
  assert.match(sheet, /transparent=\{androidTablet\}/);
  assert.match(sheet, /tabletSheetFrame\(width, height\)/);
  assert.match(header, /useTabletSheetContext/);
});
