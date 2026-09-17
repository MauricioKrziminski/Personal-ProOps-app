import assert from 'node:assert/strict';
import { test } from 'node:test';

import { classifyWindow, tabletPaneWidths } from './adaptive-window.ts';

test('classifies the available window width at both breakpoints', () => {
  assert.deepEqual(
    [384, 599, 600, 839, 840, 1280].map((width) => classifyWindow(width)),
    ['compact', 'compact', 'medium', 'medium', 'expanded', 'expanded'],
  );
});

test('returns to the compact composition after a window shrinks', () => {
  assert.equal(classifyWindow(1280), 'expanded');
  assert.equal(classifyWindow(384), 'compact');
});

test('rejects invalid window widths instead of choosing a tablet layout', () => {
  for (const width of [Number.NaN, Number.POSITIVE_INFINITY, -1, 0]) {
    assert.equal(classifyWindow(width), 'compact');
  }
});

test('keeps a single readable pane when both pane minimums cannot fit', () => {
  assert.deepEqual(tabletPaneWidths(704), {
    main: 704,
    support: 0,
    twoPane: false,
  });
});

test('uses two bounded panes only when both minimums fit', () => {
  const result = tabletPaneWidths(1144);
  assert.equal(result.twoPane, true);
  assert.ok(result.main >= 560);
  assert.ok(result.support >= 320 && result.support <= 400);
  assert.equal(result.main + result.support + 24, 1144);
});

test('normalizes invalid container measurements', () => {
  assert.deepEqual(tabletPaneWidths(Number.NaN), {
    main: 0,
    support: 0,
    twoPane: false,
  });
});
