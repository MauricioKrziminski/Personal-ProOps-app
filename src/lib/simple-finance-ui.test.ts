import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);

// Execute the screen JSX and its event handlers. Native components/query boundaries
// are inert; state persists across renders so each interaction uses current props.
function screen(file: string, options: { debts?: any[]; invoiceStatus?: string; create?: boolean } = {}) {
  const state: any[] = [];
  let cursor = 0;
  let nodes: any[] = [];
  const writes: { operation: string; value: any }[] = [];
  const confirmations: (() => void)[] = [];
  const actions: { label: string; onPress: () => void }[] = [];
  const query = { data: [], isLoading: false, isError: false, isRefetching: false, refetch: async () => {} };
  const mutation = (operation: string) => ({ isPending: false, reset() {}, mutate(value: any) { writes.push({ operation, value }); } });
  const animation = { duration: () => animation, delay: () => animation };
  const finance = new Proxy({
    DEBT_KINDS: [{ value: 'financing', label: 'Financiamento' }, { value: 'loan', label: 'Empréstimo' }],
    useDebts: () => ({ ...query, data: options.debts ?? [] }),
    useSaveDebt: () => mutation('saveDebt'),
    useSettleInvoice: () => mutation('settleInvoice'),
    usePayInvoice: () => mutation('payInvoice'),
    useInvoice: () => ({ ...query, data: {
      invoice: { id: 'invoice-1', account_id: 'card-1', status: options.invoiceStatus ?? 'closed', reference_month: '2026-08-01', closing_date: '2026-08-10', due_date: '2026-08-20' },
      transactions: [{ id: 'purchase-1', kind: 'expense', amount_cents: 147000, occurred_at: '2026-08-01' }],
    } }),
  }, { get: (target, key) => key in target ? target[key as keyof typeof target] : () => query });
  const load = (path: string): any => {
    const module = { exports: {} as any };
    const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    runInNewContext(code, { module, exports: module.exports, require: (name: string) => {
      if (name === 'react') return {
        useState(initial: any) { const index = cursor++; if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial; return [state[index], (value: any) => { state[index] = typeof value === 'function' ? value(state[index]) : value; }]; },
        useMemo: (fn: () => unknown) => fn(),
      };
      if (name === 'react/jsx-runtime') return require(name);
      if (name === 'react-native') return { StyleSheet: { create: (value: unknown) => value }, View: 'View', Pressable: 'Pressable', ScrollView: 'ScrollView', FlatList: 'FlatList' };
      if (name === 'react-native-reanimated') return { default: { View: 'AnimatedView' }, FadeInDown: animation, LinearTransition: animation };
      if (name === 'expo-router') return { Stack: { Screen: 'StackScreen' }, useLocalSearchParams: () => ({ id: 'invoice-1', ...(options.create !== false ? { create: 'financing' } : {}) }), router: {} };
      if (name === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ bottom: 0 }) };
      if (name === '@/hooks/use-finance') return finance;
      if (name === '@/hooks/use-theme') return { useTheme: () => ({}) };
      if (name === '@/hooks/use-items') return { localISODate: () => '2026-09-08', formatDateBR: () => '08/09/2026', formatBRL: load('src/lib/dates.ts').formatBRL };
      if (name === '@/lib/finance-form' || name === '@/lib/dates') return load(`src/lib/${name.split('/').at(-1)}.ts`);
      if (name === '@/lib/item-actions') return { confirmDestructive: (_title: string, _label: string, callback: () => void) => confirmations.push(callback), showItemActions: (_title: string, entries: any[]) => actions.push(...entries) };
      if (name === '@/components/ui/toast') return { useToast: () => () => {} };
      if (name === '@/design/tokens') return { Motion: { duration: {}, stagger: {} }, Space: {}, Radius: {}, tabular: {} };
      return new Proxy({}, { get: (_, key) => String(key) });
    } });
    return module.exports;
  };
  const Component = load(file).default;
  const visit = (node: any) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node?.props || (node.type === 'Sheet' && !node.props.visible)) return;
    nodes.push(node);
    visit(node.props.children);
    visit(node.props.ListHeaderComponent);
  };
  const render = () => { cursor = 0; nodes = []; visit(Component()); };
  render();
  return {
    writes, confirmations, actions,
    nodes: () => nodes,
    button(label: string) { const node = nodes.find((n) => n.type === 'Button' && n.props.label === label); assert.ok(node, `visible button: ${label}`); return node; },
    press(label: string) { const node = this.button(label); assert.ok(!node.props.disabled, `${label} must be enabled`); node.props.onPress(); render(); },
    fill(label: string, value: string | number) { const field = nodes.find((n) => n.type === 'Field' && n.props.label === label); assert.ok(field, `visible field: ${label}`); const children: any[] = []; const collect = (n: any) => { if (Array.isArray(n)) return n.forEach(collect); if (n?.props) { children.push(n); collect(n.props.children); } }; collect(field); const input = children.find((n) => n.type === 'TextField' || n.type === 'MoneyField'); assert.ok(input); (input.props.onChangeText ?? input.props.onChangeCents)(value); render(); },
    interact(callback: (nodes: any[]) => void) { callback(nodes); render(); },
  };
}
const debtsFile = 'src/app/finance/debts.tsx';

test('new financing saves from only the installment value and total count, without account/name/interest', () => {
  const ui = screen(debtsFile);
  assert.deepEqual(ui.nodes().filter((n) => n.type === 'Field').map((n) => n.props.label), ['Valor da parcela', 'Quantidade total de parcelas']);
  assert.equal(ui.button('Salvar').props.disabled, true);
  ui.fill('Valor da parcela', 147000);
  assert.equal(ui.button('Salvar').props.disabled, true);
  ui.fill('Quantidade total de parcelas', '48');
  ui.press('Salvar');
  const saved = ui.writes[0].value;
  assert.equal(ui.writes.length, 1);
  assert.equal(saved.name, 'Financiamento');
  assert.equal(saved.kind, 'financing');
  assert.equal(saved.calculation_mode, 'fixed_installments');
  assert.equal(saved.installments, 48);
  assert.equal(saved.installments_paid, 0);
  assert.equal(saved.principal_cents, 7056000);
  assert.equal(saved.remaining_cents, 7056000);
  assert.equal(saved.interest_rate_monthly, 0);
  assert.equal(saved.account_id, null);
});

test('optional history reduces remaining installments without changing the original contract total', () => {
  const ui = screen(debtsFile);
  ui.fill('Valor da parcela', 147000);
  ui.fill('Quantidade total de parcelas', '48');
  ui.press('Adicionar detalhes (opcional)');
  ui.fill('Parcelas já pagas', '8');
  ui.press('Salvar');
  assert.equal(ui.writes[0].value.remaining_cents, 5880000);
  assert.equal(ui.writes[0].value.principal_cents, 7056000);
  assert.equal(ui.writes[0].value.installments, 48);
  assert.equal(ui.writes[0].value.installments_paid, 8);
});

test('history above the contract total prevents submission', () => {
  const ui = screen(debtsFile);
  ui.fill('Valor da parcela', 147000);
  ui.fill('Quantidade total de parcelas', '48');
  ui.press('Adicionar detalhes (opcional)');
  ui.fill('Parcelas já pagas', '49');
  assert.equal(ui.button('Salvar').props.disabled, true);
  ui.button('Salvar').props.onPress();
  assert.equal(ui.writes.length, 0);
});

test('detailed mode still exposes the financial inputs', () => {
  const ui = screen(debtsFile);
  ui.interact((nodes) => nodes.find((n) => n.type === 'Segmented').props.onChange('amortized'));
  const labels = ui.nodes().filter((n) => n.type === 'Field').map((n) => n.props.label);
  for (const label of ['Nome', 'Quanto você deve hoje', 'Valor original', 'Juros por mês']) assert.ok(labels.includes(label), label);
  assert.equal(ui.button('Salvar').props.disabled, true);
});

test('editing a legacy amortized financing preserves its mode and remaining-term semantics', () => {
  const ui = screen(debtsFile, { create: false, debts: [{ id: 'old-debt', name: 'Carro', kind: 'financing', calculation_mode: 'amortized', principal_cents: 7056000, remaining_cents: 5880000, installments: 48, installments_paid: 8, installment_cents: 147000, interest_rate_monthly: 0.0199, account_id: null, due_day: 10 }] });
  ui.interact((nodes) => nodes.find((n) => n.type === 'Pressable' && n.props.onLongPress).props.onLongPress());
  ui.interact(() => ui.actions.find((a) => a.label === 'Editar')!.onPress());
  assert.ok(ui.nodes().some((n) => n.type === 'Field' && n.props.label === 'Juros por mês'));
  assert.ok(!ui.nodes().some((n) => n.type === 'Segmented'));
  ui.press('Salvar');
  assert.equal(ui.writes[0].value.id, 'old-debt');
  assert.equal(ui.writes[0].value.calculation_mode, 'amortized');
  assert.equal(ui.writes[0].value.installments, 48);
  assert.equal(ui.writes[0].value.remaining_cents, 5880000);
  assert.equal(ui.writes[0].value.interest_rate_monthly, 0.0199);
});

test('visible invoice settlement confirms then marks paid without issuing an account payment', () => {
  const ui = screen('src/app/finance/invoice/[id].tsx');
  ui.button('Registrar pagamento');
  ui.press('Marcar como paga');
  assert.equal(ui.writes.length, 0, 'confirmation comes before settlement');
  assert.equal(ui.confirmations.length, 1);
  ui.confirmations[0]();
  assert.equal(ui.writes.length, 1);
  assert.equal(ui.writes[0].operation, 'settleInvoice');
  assert.equal(ui.writes[0].value.invoiceId, 'invoice-1');
});

test('a paid invoice does not expose settlement or payment buttons', () => {
  const ui = screen('src/app/finance/invoice/[id].tsx', { invoiceStatus: 'paid' });
  assert.ok(!ui.nodes().some((n) => n.type === 'Button' && ['Marcar como paga', 'Registrar pagamento'].includes(n.props.label)));
});
