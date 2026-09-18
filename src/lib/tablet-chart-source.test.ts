import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const nodeRequire = createRequire(import.meta.url);

test('measured sparkline waits for its own card width and updates after resize', () => {
  const source = readFileSync('src/components/ui/measured-sparkline.tsx', 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module = { exports: {} as Record<string, (props: Record<string, unknown>) => any> };
  let width = 0;
  runInNewContext(code, {
    module,
    exports: module.exports,
    require: (name: string) => {
      if (name === 'react') return {
        useState: () => [width, (next: number | ((current: number) => number)) => {
          width = typeof next === 'function' ? next(width) : next;
        }],
      };
      if (name === 'react/jsx-runtime') return {
        jsx: (type: unknown, props: unknown) => ({ type, props }),
        jsxs: (type: unknown, props: unknown) => ({ type, props }),
      };
      if (name === 'react-native') return { View: 'View' };
      if (name === '@/components/ui/sparkline') return { Sparkline: 'Sparkline' };
      return nodeRequire(name);
    },
  });
  const props = { values: [10, 20], height: 80 };
  const before = module.exports.MeasuredSparkline(props);
  assert.equal(before.props.children, null);
  before.props.onLayout({ nativeEvent: { layout: { width: 512 } } });
  const after = module.exports.MeasuredSparkline(props);
  assert.equal(after.props.children.type, 'Sparkline');
  assert.equal(after.props.children.props.width, 512);
  after.props.onLayout({ nativeEvent: { layout: { width: 320 } } });
  assert.equal(module.exports.MeasuredSparkline(props).props.children.props.width, 320);
});

test('finance chart and invoice face do not derive their width from the whole tablet window', () => {
  const forecast = readFileSync('src/app/finance/forecast.tsx', 'utf8');
  const netWorth = readFileSync('src/app/finance/net-worth.tsx', 'utf8');
  const dock = readFileSync('src/components/finance/invoice-dock.tsx', 'utf8');
  const invoice = readFileSync('src/app/finance/invoice/[id].tsx', 'utf8');
  assert.ok(forecast.includes('<MeasuredSparkline'), 'forecast uses a measured chart');
  assert.ok(netWorth.includes('<MeasuredSparkline'), 'net worth uses a measured chart');
  assert.doesNotMatch(forecast, /width\s*-\s*Space\.lg\s*\*\s*4/);
  assert.doesNotMatch(netWorth, /width\s*-\s*Space\.lg\s*\*\s*4/);
  assert.ok(dock.includes('onLayout={medir}'), 'invoice dock measures its own width');
  assert.doesNotMatch(dock, /width\s*-\s*Space\.lg\s*\*\s*2/);
  assert.ok(invoice.includes('rootContentMaxWidth'), 'invoice skeleton uses a bounded reading width');
});
