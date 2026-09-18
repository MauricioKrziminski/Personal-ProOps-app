import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

test('cycle detail keeps one financial source while composing a tablet decision pane', () => {
  const source = readFileSync('src/app/finance/cycle.tsx', 'utf8');
  assert.match(source, /<FinanceAnalysisPanes/);
  assert.match(source, /<Screen wide=\{tablet\}/);
  assert.match(source, /describeCycle\(ciclo, nome\)/);
  assert.match(source, /useCycleLines\(month, view\)/);
  assert.match(source, /rotaDaLinha\(l\.origin, l\.ref_id\)/);
});

test('annual report puts year-end evidence beside the categories without changing export or year selection', () => {
  const source = readFileSync('src/app/finance/reports.tsx', 'utf8');
  assert.match(source, /<FinanceAnalysisPanes/);
  assert.match(source, /<Screen wide=\{tablet\}/);
  assert.match(source, /useAnnualReport\(ano\)/);
  assert.match(source, /Exportar CSV do ano/);
  assert.match(source, /setAno\(a\)/);
  assert.match(source, /data\.yearEnd/);
});
