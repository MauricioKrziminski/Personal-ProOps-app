import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  bottomPillInset,
  chartWidthForPane,
  classifyWindow,
  rootContentMaxWidth,
  readingPaneWidths,
  tabletPaneWidths,
} from './adaptive-window.ts';

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

test('keeps compact roots at their existing width and pill clearance', () => {
  assert.equal(rootContentMaxWidth(384, false), 800);
  assert.equal(bottomPillInset('android', true, 'compact', 76), 76);
});

test('lets a tablet root spread without leaving phantom pill clearance', () => {
  assert.equal(rootContentMaxWidth(1280, true), 1200);
  assert.equal(bottomPillInset('android', true, 'medium', 76), 0);
  assert.equal(bottomPillInset('android', true, 'expanded', 76), 0);
});

test('does not invent an Android pill inset for pushed routes or iPad', () => {
  assert.equal(bottomPillInset('android', false, 'compact', 76), 0);
  assert.equal(bottomPillInset('ios', true, 'expanded', 76), 0);
});

test('Today uses measured content width to decide its editorial split', () => {
  assert.equal(tabletPaneWidths(336).twoPane, false);
  assert.equal(tabletPaneWidths(752).twoPane, false);
  assert.equal(tabletPaneWidths(1144).twoPane, true);
});

test('Finance chart fits inside the measured hero panel at phone and tablet widths', () => {
  assert.equal(chartWidthForPane(336, 20), 296);
  const pane = tabletPaneWidths(1144).main;
  assert.equal(chartWidthForPane(pane, 20), pane - 40);
  assert.equal(chartWidthForPane(0, 20), 0);
  assert.equal(chartWidthForPane(Number.NaN, 20), 0);
});

test('library and reading panes only split when both reading minimums fit', () => {
  assert.deepEqual(readingPaneWidths(720), { list: 720, reading: 0, twoPane: false });
  const result = readingPaneWidths(976);
  assert.equal(result.twoPane, true);
  assert.ok(result.list >= 280 && result.list <= 360);
  assert.ok(result.reading >= 480);
  assert.equal(result.list + result.reading + 24, 976);
  assert.deepEqual(readingPaneWidths(Number.NaN), { list: 0, reading: 0, twoPane: false });
});

test('an invoice card skeleton uses the bounded reading column, not the full tablet window', () => {
  assert.equal(chartWidthForPane(Math.min(384, rootContentMaxWidth(384, false)), 16), 352);
  assert.equal(chartWidthForPane(Math.min(1200, rootContentMaxWidth(1200, false)), 16), 768);
});
