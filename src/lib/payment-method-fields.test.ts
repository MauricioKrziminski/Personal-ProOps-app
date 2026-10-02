import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as payment from './payment-method.ts';
import * as dates from './dates.ts';
import * as series from './serie.ts';
import * as purchase from './compra.ts';
import * as downPayment from './down-payment.ts';
import * as financeForm from './finance-form.ts';
import * as rruleText from './rrule-text.ts';

type Node = { type: string; props: Record<string, any> };
// Execute the actual field components; native primitives remain opaque boundaries.
function component(file: string) {
  const exports: Record<string, any> = {};
  const libs: Record<string, unknown> = { 'payment-method': payment, dates, serie: series, compra: purchase, 'down-payment': downPayment, 'finance-form': financeForm, 'rrule-text': rruleText };
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
  runInNewContext(code, {
    exports,
    require: (id: string) => {
      if (id === 'react/jsx-runtime') return { jsx: (type: string, props: Node['props']) => ({ type, props }), jsxs: (type: string, props: Node['props']) => ({ type, props }), Fragment: 'Fragment' };
      if (id === 'react') return { useState: (value: unknown) => [value, () => {}] };
      if (id === '@/components/finance/origin-creation-host') return { OriginAccountPicker: 'AccountPicker' };
      if (id === '@/design/tokens') return { Space: { lg: 16 } };
      if (id.startsWith('@/lib/')) return libs[id.slice(6)] ?? {};
      return new Proxy({}, { get: (_, key) => String(key) });
    },
  });
  return exports;
}
function nodes(root: any): Node[] {
  if (!root) return [];
  if (Array.isArray(root)) return root.flatMap(nodes);
  if (!root.props) return [];
  return [root, ...nodes(root.props.children)];
}
const accounts = [ { id: 'bank', name: 'Conta corrente', type: 'checking' }, { id: 'card', name: 'Meu cartão', type: 'credit_card' } ];

test('Pix fee input exposes a distinct label for assistive technology', () => {
  const path = 'src/components/finance/formulario-do-lancamento.tsx';
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let feeController: ts.JsxSelfClosingElement | undefined;
  const findController = (node: ts.Node) => {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === 'Controller' && node.attributes.properties.some((p) =>
      ts.isJsxAttribute(p) && p.name.getText(source) === 'name' && p.initializer && ts.isStringLiteral(p.initializer) && p.initializer.text === 'fee_cents')) feeController = node;
    ts.forEachChild(node, findController);
  };
  findController(source);
  assert.ok(feeController, 'fee Controller must exist');
  let label: string | undefined;
  const findInput = (node: ts.Node) => {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === 'MoneyField') {
      const attr = node.attributes.properties.find((p) => ts.isJsxAttribute(p) && p.name.getText(source) === 'accessibilityLabel');
      if (attr && ts.isJsxAttribute(attr) && attr.initializer && ts.isStringLiteral(attr.initializer)) label = attr.initializer.text;
    }
    ts.forEachChild(node, findInput);
  };
  findInput(feeController);
  assert.equal(label, 'Juros do Pix no crédito em reais');
});

test('payment control emits an intentional clear while keeping its error and hint in Field', () => {
  const { PaymentMethodField } = component('src/components/finance/payment-method-field.tsx');
  let selected: unknown = 'pix';
  const tree = PaymentMethodField({ value: 'pix', onChange: (v: unknown) => { selected = v; }, error: 'Rever origem', hint: 'Origem selecionada: Meu cartão' });
  assert.equal(tree.props.error, 'Rever origem');
  assert.equal(tree.props.hint, 'Origem selecionada: Meu cartão');
  const select = nodes(tree).find((n) => n.type === 'SelectField')!;
  select.props.onChange(null);
  assert.equal(selected, null);
  select.props.onChange('debit');
  assert.equal(selected, 'debit');
});
test('series and purchase method switches preserve the incompatible origin and explain its identity', () => {
  for (const [file, exported, initial] of [
    ['serie-form', 'CamposDaSerie', { ...series.SERIE_VAZIA, accountId: 'card', paymentMethod: 'pix' }],
    ['compra-form', 'CamposDaCompra', { id: 'p', description: 'Compra', merchant: '', category: null, accountId: 'card', paymentMethod: 'pix', totalCents: 101, installments: 2, inicio: '01/11/2026', travadas: 0, travadasPagas: 0, travadoCents: 0, naFatura: 0, ultimaTravada: 0, pagas: 0, pisoPagas: 0, unidade: 'total', parcelaCents: null, original: { totalCents: 101, installments: 2, parcelaCents: 50, accountId: 'card', pagas: 0 } }],
  ] as const) {
    const render = component(`src/components/finance/${file}.tsx`)[exported];
    let form: any = initial;
    const props = () => ({ form, contas: accounts, onChange: (next: unknown) => { form = next; } });
    const method = nodes(render(props())).find((n) => n.type === 'PaymentMethodField')!;
    method.props.onChange('debit');
    assert.equal(form.accountId, 'card', file);
    const tree = nodes(render(props()));
    const account = tree.find((n) => n.type === 'AccountPicker')!;
    assert.deepEqual(Array.from(account.props.accounts, (a: any) => a.id), ['bank']);
    assert.equal(account.props.value, 'card');
    assert.equal(account.props.selectedAccount, accounts[1], 'lookup identity comes from the unfiltered accounts');
    const error = tree.find((n) => n.type === 'Field' && n.props.label === 'Conta')!;
    assert.ok(error.props.error);
    assert.match(error.props.hint, /Meu cartão/);
    account.props.onChange('bank');
    assert.equal(form.paymentMethod, 'debit');
    assert.equal(form.accountId, 'bank');
  }
});
test('down payment can select card funding without changing its main payment draft', () => {
  const { DownPaymentFields } = component('src/components/finance/down-payment-fields.tsx');
  let value = { amountCents: 25, accountId: 'bank', dateBR: '01/10/2026', paymentMethod: 'pix' };
  const render = () => nodes(DownPaymentFields({ enabled: true, onEnabled: () => {}, value, onChange: (next: any) => { value = next; }, accounts }));
  render().find((n) => n.type === 'PaymentMethodField')!.props.onChange('credit');
  assert.equal(value.accountId, 'bank');
  const picker = render().find((n) => n.type === 'AccountPicker')!;
  assert.deepEqual(Array.from(picker.props.accounts, (a: any) => a.id), ['card']);
  assert.equal(picker.props.selectedAccount, accounts[0]);
  picker.props.onChange('card');
  assert.equal(value.paymentMethod, 'credit');
  assert.equal(value.accountId, 'card');
  assert.equal(value.amountCents, 25);
});
