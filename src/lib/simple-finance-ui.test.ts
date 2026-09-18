import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

import { telaPronta } from './tela-pronta.ts';

const require = createRequire(import.meta.url);

// Execute the screen JSX and its event handlers. Native components/query boundaries
// are inert; state persists across renders so each interaction uses current props.
function screen(file: string, options: { tablet?: boolean; debts?: any[]; invoiceStatus?: string; create?: boolean; monthLines?: any[]; monthSummary?: any; cycleLines?: any[]; cycleRow?: any; rangeError?: boolean; rangePending?: boolean; rangePendingMonths?: string[]; bills?: any[]; billsError?: boolean; charges?: any[]; reminders?: any[]; budgets?: any[]; setupPassos?: any[]; activity?: any[]; activityError?: boolean } = {}) {
  const state: any[] = [];
  let cursor = 0;
  let nodes: any[] = [];
  const writes: { operation: string; value: any }[] = [];
  const confirmations: (() => void)[] = [];
  const actions: { label: string; onPress: () => void }[] = [];
  const navigations: any[] = [];
  /** Quais consultas o "Tentar de novo" refez — é assim que se sabe se ele refez a CERTA. */
  const refetches: string[] = [];
  /** O que cada chamada do portão da tela recebeu — o dublê dele abre sempre, então é por aqui que se confere a COMPOSIÇÃO. */
  const gates: any[][] = [];
  const query = { data: [], isLoading: false, isError: false, isRefetching: false, refetch: async () => {} };
  const mutation = (operation: string) => ({ isPending: false, reset() {}, mutate(value: any) { writes.push({ operation, value }); } });
  const animation = { duration: () => animation, delay: () => animation };
  const finance = new Proxy({
    DEBT_KINDS: [{ value: 'financing', label: 'Financiamento' }, { value: 'loan', label: 'Empréstimo' }],
    SUGGESTED_CATEGORIES: [],
    INCOME_CATEGORIES: [],
    ASSET_CLASSES: [{ value: 'investment', label: 'Investimento', icon: 'chart.line.uptrend.xyaxis' }],
    useDebts: () => ({ ...query, data: options.debts ?? [] }),
    useMonthLines: () => ({ ...query, data: options.monthLines ?? [] }),
    useCycleLines: () => ({ ...query, data: options.cycleLines ?? [] }),
    // A tela do ciclo mostra o esqueleto enquanto não tem a série — sem este dublê ela nunca
    // chega a renderizar linha nenhuma, e o teste passaria a medir o esqueleto.
    useCycleSeries: () => ({ ...query, isPending: false, data: [options.cycleRow ?? {
      mes: '2026-09-01', ini: '2026-08-11', fim: '2026-09-10', estado: 'fechado',
      comecei_com: 86797, entrou: 633062, saiu: 719787, resultado: 72,
      caixa_no_fim: 72, faltou_pagar: 37164, confere: true,
    }] }),
    /*
      O CONTRATO de `MonthRange`: bordas + o estado da consulta que as resolve. Devolver só
      `{from, to}` passava pelo portão por ACASO (`!undefined`) e deixava `pronto` indefinido —
      o card de resumo dos Lançamentos caía no esqueleto e nenhum teste via.
    */
    useMonthRange: (month: string) => {
      const buscando = Boolean(options.rangePending || options.rangePendingMonths?.includes(month));
      return {
        from: `${month}-01`,
        to: `${month}-30`,
        pronto: !options.rangeError && !buscando,
        isPending: buscando,
        fetchStatus: buscando ? 'fetching' : 'idle',
        isError: Boolean(options.rangeError),
        refetch: async () => { refetches.push('range'); },
      };
    },
    /*
      Consulta INFINITA (`{pages}`), e o mesmo `enabled` do hook real: com `pronto: false` ela
      fica desligada — `isPending` para sempre, sem dado. É exatamente o estado que prendia a
      lista no esqueleto quando as bordas falhavam, então o dublê tem que reproduzi-lo.
    */
    useTransactions: (filters: { pronto?: boolean }) => filters.pronto === false
      ? { ...query, data: undefined, isPending: true, fetchStatus: 'idle', hasNextPage: false, isFetchingNextPage: false, fetchNextPage: () => {}, refetch: async () => { refetches.push('list'); } }
      // Uma linha: com a lista vazia o card do resumo SOME de propósito (card que soma uma lista
      // vazia é eco — design.md §1), e o caminho feliz não teria o que mostrar.
      : { ...query, data: { pages: [[{ id: 'tx-1', kind: 'expense', amount_cents: 4500, occurred_at: '2026-09-15', description: 'Mercado', category: 'mercado', account_id: null, status: 'cleared' }]], pageParams: [] }, isPending: false, hasNextPage: false, isFetchingNextPage: false, fetchNextPage: () => {}, refetch: async () => { refetches.push('list'); } },
    useMonthSummary: () => ({ ...query, data: options.monthSummary ?? null }),
    // O mês é uma STRING (`2026-09`); sem este dublê o Proxy devolvia um objeto-consulta.
    useCycleMonth: () => '2026-09',
    useMonthBreakdown: () => ({ ...query, data: [] }),
    useSaveDebt: () => mutation('saveDebt'),
    useSaveAsset: () => mutation('saveAsset'),
    useArchiveAsset: () => mutation('archiveAsset'),
    useSettleInvoice: () => mutation('settleInvoice'),
    useUpcomingBills: () => ({
      ...query,
      isSuccess: !options.billsError,
      isError: Boolean(options.billsError),
      data: options.billsError ? undefined : (options.bills ?? []),
      refetch: async () => { refetches.push('bills'); },
    }),
    useUpcomingCardCharges: () => ({ ...query, isSuccess: true, data: options.charges ?? [] }),
    useBudgetsStatus: () => ({ ...query, isSuccess: true, data: options.budgets ?? [] }),
    useSpendablePath: () => ({ ...query, isSuccess: true, data: [] }),
    useCycle: () => ({ ...query, isSuccess: true, data: options.cycle ?? { de: '2026-09-01', ate: '2026-09-30', mes: '2026-09', diasAteOFim: 22 } }),
    useAccountBalances: () => ({
      ...query,
      isSuccess: !options.balancesError,
      isError: Boolean(options.balancesError),
      data: options.balancesError ? undefined : (options.balances ?? []),
      refetch: async () => { refetches.push('balances'); },
    }),
    // A MESMA função serve as duas fatias da Hoje; o que as separa é a janela pedida.
    useTransactionsSummary: (from: string, to: string) => ({
      ...query,
      isSuccess: true,
      data: from === to ? (options.saiuHoje ?? []) : (options.saiuNoCiclo ?? []),
      refetch: async () => { refetches.push('summary'); },
    }),
    useMarkPaid: () => mutation('markPaid'),
    usePayInvoice: () => mutation('payInvoice'),
    useInvoice: () => ({ ...query, data: {
      invoice: { id: 'invoice-1', account_id: 'card-1', status: options.invoiceStatus ?? 'closed', reference_month: '2026-08-01', closing_date: '2026-08-10', due_date: '2026-08-20', paid_at: options.invoiceStatus === 'paid' ? '2026-08-18' : null },
      transactions: [{ id: 'purchase-1', kind: 'expense', amount_cents: 147000, occurred_at: '2026-08-01' }],
    } }),
  }, { get: (target, key) => key in target ? target[key as keyof typeof target] : () => query });
  const load = (path: string): any => {
    const module = { exports: {} as any };
    const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    runInNewContext(code, { module, exports: module.exports, require: (name: string) => {
      if (name === 'react') return {
        Fragment: Symbol.for('react.fragment'),
        useState(initial: any) { const index = cursor++; if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial; return [state[index], (value: any) => { state[index] = typeof value === 'function' ? value(state[index]) : value; }]; },
        useMemo: (fn: () => unknown) => fn(),
        useCallback: (fn: unknown) => fn,
        useRef: (v: unknown) => ({ current: v }),
        useEffect: () => {},
      };
      if (name === 'react/jsx-runtime') return require(name);
      if (name === 'react-native') return { StyleSheet: { create: (value: unknown) => value }, View: 'View', Pressable: 'Pressable', ScrollView: 'ScrollView', FlatList: 'FlatList', useWindowDimensions: () => ({ width: 384, height: 800 }), Platform: { OS: 'android', select: (o: any) => o.android ?? o.default } };
      if (name === 'react-native-reanimated') return { default: { View: 'AnimatedView' }, FadeInDown: animation, FadeOut: animation, FadeIn: animation, LinearTransition: animation };
      // `back` é navegação como qualquer outra e ENTRA na lista: é o que prende o "fechar um
      // formulário que outra tela abriu devolve para ela" (`useVoltarQuandoFechar`).
      if (name === 'expo-router') return { Stack: { Screen: 'StackScreen' }, useLocalSearchParams: () => ({ id: 'invoice-1', ...(options.create !== false ? { create: 'financing' } : {}) }), router: { push: (to: any) => navigations.push(to), back: () => navigations.push({ back: true }) } };
      if (name === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ bottom: 0 }) };
      if (name === '@/hooks/use-finance') return finance;
      if (name === '@/hooks/use-adaptive-window') return {
        useAdaptiveWindow: () => ({
          width: options.tablet ? 1280 : 384,
          windowClass: options.tablet ? 'expanded' : 'compact',
          androidRail: Boolean(options.tablet),
          fontScale: 1,
        }),
      };
      if (name === '@/hooks/use-theme') return { useTheme: () => ({}), useScheme: () => 'light' };
      // portão de "a tela está pronta": no harness nada carrega, então ele já nasce aberto
      if (name === '@/hooks/use-tela-pronta') return { useTelaPronta: (...consultas: any[]) => { gates.push(consultas); return true; } };
      // Carregado DE VERDADE: ele é a regra que se quer testar, não um arredor da tela.
      if (name === '@/hooks/use-voltar-quando-fechar') return load('src/hooks/use-voltar-quando-fechar.ts');
      if (name === '@/hooks/use-items') return { localISODate: () => '2026-09-08', formatDateBR: () => '08/09/2026', formatBRL: load('src/lib/dates.ts').formatBRL, useRealtimeInvalidate: () => {}, useTodayReminders: () => ({ ...query, isSuccess: true, data: options.reminders ?? [] }) };
      if (name === '@/hooks/use-session') return { useSession: () => ({ session: { user: { id: 'user-1' } } }) };
      if (name === '@/hooks/use-profile') return { useProfile: () => ({ ...query, isSuccess: true, data: { display_name: 'Gabriel Almeida', phone: null } }) };
      if (name === '@/hooks/use-setup-progress') return { useSetupProgress: () => ({ passos: options.setupPassos ?? [], pronto: true, consultas: [] }) };
      if (name === '@/hooks/use-bool-pref') return { useBoolPref: () => [false, () => {}] };
      if (name === '@/hooks/use-agent-activity') return {
        useAgentActivity: () => ({
          ...query,
          isSuccess: !options.activityError,
          isError: Boolean(options.activityError),
          data: options.activityError ? undefined : (options.activity ?? []),
          refetch: async () => { refetches.push('activity'); },
        }),
      };
      // Orçamentos consulta direto (a lista de linhas): o mesmo resultado inerte dos hooks.
      if (name === '@tanstack/react-query') return { useQuery: () => query };
      if (name === '@/lib/finance-form' || name === '@/lib/dates' || name === '@/lib/month-view' || name === '@/lib/settle-labels' || name === '@/lib/accounts' || name === '@/lib/cycle-label' || name === '@/lib/card-status' || name === '@/lib/today-sections' || name === '@/lib/runway' || name === '@/lib/budget-tight' || name === '@/lib/setup-steps' || name === '@/lib/activity-feed' || name === '@/lib/account-cash' || name === '@/lib/today-spend') return load(`src/lib/${name.split('/').at(-1)}.ts`);
      if (name === '@/hooks/use-debounced') return { useDebounced: (value: unknown) => value };
      if (name === '@/design/category-icons') return { categoryIcon: () => 'circle' };
      if (name === '@/design/adaptive-window') return load('src/design/adaptive-window.ts');
      // import relativo DENTRO de um módulo puro já carregado (month-view → ./dates.ts)
      if (name === './dates.ts' || name === './dates') return load('src/lib/dates.ts');
      // o `month-picker` é `.tsx` e importa React Native; aqui só as funções puras dele
      if (name === '@/components/finance/month-picker') return {
        MonthPicker: 'MonthPicker',
        currentMonth: () => '2026-09',
        monthLabel: (m: string) => m,
        monthShort: (m: string) => m,
        shiftMonth: (m: string, delta: number) => {
          const [y, mm] = m.split('-').map(Number);
          const d = new Date(y, mm - 1 + delta, 1);
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        },
        monthTitle: (m: string) => {
          const [y, mm] = m.split('-').map(Number);
          const label = new Date(y, mm - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
          return label.charAt(0).toUpperCase() + label.slice(1);
        },
      };
      // `month-ruler` também é `.tsx`: o hook devolve a régua inerte, que é o que a tela
      // precisa para renderizar sem escolher nada.
      if (name === '@/components/finance/month-ruler') return {
        MonthRuler: 'MonthRuler',
        useMonthRuler: () => ({ view: 'cycle', setView: () => {}, temCiclo: false, cycle: { data: undefined } }),
      };
      if (name === '@/lib/item-actions') return { confirmDestructive: (_title: string, _label: string, callback: () => void) => confirmations.push(callback), showItemActions: (_title: string, entries: any[]) => actions.push(...entries) };
      if (name === '@/components/ui/toast') return { useToast: () => () => {} };
      // O provider de "esconder saldo" só existe dentro da árvore real; aqui o valor aparece.
      if (name === '@/components/ui/conceal') return {
        useConceal: () => ({ concealed: false, toggle: () => {} }),
        concealText: () => '••••••',
        useBRL: () => (cents: number) => `R$ ${(cents / 100).toFixed(2)}`,
      };
      if (name === '@/design/tokens') return { Motion: { duration: {}, stagger: {} }, Space: {}, Radius: {}, tabular: {}, Elevation: { light: {}, dark: {} } };
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
    // Tablet adapters hold the existing blocks in named slots, not children. Visit those slots
    // too so the same behavior assertions cover both compositions.
    if (node.type === 'TodayTabletCanvas') {
      for (const slot of ['hero', 'signals', 'pulse', 'actions', 'accounts', 'coming']) visit(node.props[slot]);
    }
    if (node.type === 'FinanceTabletCanvas') {
      for (const slot of ['cycle', 'actions', 'ledger', 'breakdown']) visit(node.props[slot]);
    }
    visit(node.props.ListHeaderComponent);
    // Mesmo motivo do header: slot é conteúdo renderizado. As ações da fatura desceram para o
    // FIM da lista em 15/09/2026 (botão fixo sobre o scroll foi recusado pelo dono do produto),
    // e sem esta linha elas somem daqui enquanto continuam na tela.
    visit(node.props.ListFooterComponent);
    // O estado vazio da lista também é slot renderizado — e é ONDE a lista dos Lançamentos
    // desenhava três linhas de esqueleto para sempre quando as bordas do período falhavam.
    visit(node.props.ListEmptyComponent);
    // O "Salvar" do sheet mora no slot `action` do `SheetHeader`, não em `children` — sem esta
    // linha o botão existe na tela e some daqui, que foi o que estas seis asserções viram.
    visit(node.props.action);
    // Ação de header é DECLARADA como dado (`actions={[{label, onPress}]}`) e desenhada como
    // botão pela plataforma — o "+" que abre todo formulário de lista (§8 do design) mora aí.
    // Sem esta linha nenhum sheet de criação é alcançável por este harness. `ItemLink` também
    // tem `actions`, mas aquilo é menu de contexto, não botão visível: só `HeaderActions`.
    if (node.type === 'HeaderActions' && Array.isArray(node.props.actions))
      node.props.actions.forEach((a: any) => nodes.push({ type: 'Button', props: a }));
  };
  const render = () => { cursor = 0; nodes = []; visit(Component()); };
  render();
  return {
    writes, confirmations, actions, navigations, refetches, gates,
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
  assert.deepEqual(ui.nodes().filter((n) => n.type === 'Field').map((n) => n.props.label), ['Valor da parcela', 'Total de parcelas', 'Vence dia']);
  assert.equal(ui.button('Salvar').props.disabled, true);
  ui.fill('Valor da parcela', 147000);
  assert.equal(ui.button('Salvar').props.disabled, true);
  ui.fill('Total de parcelas', '48');
  // O cronograma ancora no vencimento: sem ele a projeção chuta o dia da saída.
  assert.equal(ui.button('Salvar').props.disabled, true);
  ui.fill('Vence dia', '10');
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
  assert.equal(saved.due_day, 10);
  assert.equal(saved.account_id, null);
});

test('optional history reduces remaining installments without changing the original contract total', () => {
  const ui = screen(debtsFile);
  ui.fill('Valor da parcela', 147000);
  ui.fill('Total de parcelas', '48');
  ui.fill('Vence dia', '10');
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
  ui.fill('Total de parcelas', '48');
  ui.fill('Vence dia', '10');
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

test('a debt without installments has no cadence, so it never demands a due day', () => {
  // "Devo 500 pro João": exigir dia de vencimento aqui travaria o cadastro por
  // um dado que o contrato não tem. A trava vale só para contrato com parcelas.
  // `create: 'financing'` no deep link nasce como financiamento, que exige parcelas.
  const ui = screen(debtsFile, { create: false });
  ui.interact((nodes) => nodes.find((n) => n.type === 'EmptyState').props.action.onPress());
  ui.interact((nodes) => nodes.find((n) => n.type === 'Segmented').props.onChange('amortized'));
  ui.fill('Nome', 'João');
  ui.fill('Quanto você deve hoje', 50000);
  ui.fill('Juros por mês', '0');
  ui.press('Salvar');
  assert.equal(ui.writes[0].value.due_day, null);
  assert.equal(ui.writes[0].value.remaining_cents, 50000);
});

test('fechar um formulário que OUTRA tela abriu devolve para aquela tela', () => {
  // A queixa (15/09/2026): *"cliquei em editar a compra inteira e quando eu clico em voltar,
  // ao invés de voltar para a tela onde eu estava, ele me leva para a tela de Parceladas"*.
  // Chegar num formulário de sheet vindo de fora é um `push` na tela da LISTA com parâmetro;
  // fechar o sheet tem que fechar também a tela que só existia para hospedá-lo.
  const ui = screen(debtsFile);
  const cabecalhos = ui.nodes().filter((n) => n.type === 'TaskHeader');
  assert.equal(cabecalhos.length, 1, 'só o sheet do formulário está aberto');
  ui.interact(() => cabecalhos[0].props.onClose());
  assert.deepEqual(ui.navigations, [{ back: true }]);
});

test('e quem abriu o formulário PELA PRÓPRIA tela continua nela', () => {
  // O espelho do caso acima, e o que quebra se alguém marcar "veio de fora" sem condição:
  // fechar levaria a pessoa para fora de uma lista que ela abriu de propósito.
  const ui = screen(debtsFile, { create: false });
  ui.interact((nodes) => nodes.find((n) => n.type === 'EmptyState').props.action.onPress());
  ui.interact((nodes) => nodes.find((n) => n.type === 'TaskHeader').props.onClose());
  assert.deepEqual(ui.navigations, []);
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

// A face ancorada carrega o que o card de total carregava (Regra 0 da fase 4): estado,
// contagem, total, fecha e vence — e as linhas que explicam o total ficam DENTRO dela.
test('the docked card carries the invoice summary and the explaining lines', () => {
  const ui = screen('src/app/finance/invoice/[id].tsx', { invoiceStatus: 'paid' });
  const doca = ui.nodes().find((n) => n.type === 'InvoiceDock');
  assert.ok(doca, 'a fatura desenha a doca');
  assert.deepEqual(
    { ...doca.props.resumo },
    { status: 'Paga', atrasada: false, contagem: 1, totalCents: 147000, fecha: '2026-08-10', vence: '2026-08-20' }
  );
  assert.equal(doca.props.atualId, 'invoice-1');
  const texto = JSON.stringify(doca.props.children);
  assert.ok(texto.includes('Paga em'), 'a linha "Paga em" mora sob a face');
});

test('a paid invoice does not expose settlement or payment buttons', () => {
  const ui = screen('src/app/finance/invoice/[id].tsx', { invoiceStatus: 'paid' });
  assert.ok(!ui.nodes().some((n) => n.type === 'Button' && ['Marcar como paga', 'Registrar pagamento'].includes(n.props.label)));
});


// ── tela do ciclo (era a tela Mês, apagada em 13/09/2026) ───────────────────
//
// O roteamento das linhas é testado em `cycle-routes.test.ts`: ele é lógica PURA, e este harness
// não desce em componente aninhado — a linha do ciclo mora dentro de `<Linha>`, não solta na
// árvore da tela.


// ── patrimônio: campo obrigatório é campo que BLOQUEIA ─────────────────────
//
// A queixa de 15/09/2026 foi de classe, não de tela: "tem campos que teoricamente são
// obrigatórios preencher mas me deixa eu salvar normalmente?". `assets.current_value_cents` é
// NOT NULL e o formulário só olhava o nome, então um bem nascia valendo R$ 0,00 — presente no
// banco, mudo na lista, somando zero no patrimônio. O caso que prende a regressão é o Salvar
// com nome válido e valor zerado: sem a guarda ele está habilitado e escreve.
test('an asset with a valid name but no value cannot be saved', () => {
  const ui = screen('src/app/finance/net-worth.tsx');
  ui.press('Novo bem');
  ui.fill('Nome', 'Tesouro Selic');
  const salvar = ui.button('Salvar');
  assert.equal(salvar.props.disabled, true, 'Salvar fica travado enquanto o valor é zero');
  assert.equal(ui.writes.length, 0);

  ui.fill('Valor atual', 150000);
  ui.press('Salvar');
  assert.equal(ui.writes.length, 1);
  assert.equal(ui.writes[0].value.current_value_cents, 150000);
});


/*
  ⚠️ **O skeleton eterno de 16/09/2026.** Com o `cycle_range` falhando, `range.pronto` ficava
  `false` para sempre: o portão da tela não abria, e mesmo com ele aberto o resumo (`!pronto`) e a
  lista (desligada, `isPending` eterno) desenhavam esqueleto. Reproduzido no emulador injetando a
  falha só naquela RPC — a tela parava no carregamento sem erro nem "Tentar de novo".

  O portão agora recebe o range como CONSULTA (preso em `anti-slop.test.ts`); estes testes prendem
  a outra metade: o que a tela DESENHA quando as bordas não vêm.
*/
const transacoesFile = 'src/app/finance/transactions.tsx';
const tipos = (ui: ReturnType<typeof screen>) => ui.nodes().map((n: any) => n.type);

test('Lançamentos com as bordas do período falhando mostra o erro, não um esqueleto eterno', () => {
  const ui = screen(transacoesFile, { rangeError: true });
  const t = tipos(ui);
  assert.ok(t.includes('ErrorCard'), 'a falha do período precisa aparecer');
  for (const esqueleto of ['Skeleton', 'SkeletonRow'])
    assert.ok(!t.includes(esqueleto), `${esqueleto} com o período em erro é o defeito de volta`);
  // Nem um total: sem bordas, qualquer número seria de OUTRA janela.
  assert.ok(!t.includes('PeriodSummaryCard'));
  // O card do resumo E a lista: as duas metades mostram a falha.
  assert.equal(t.filter((x: string) => x === 'ErrorCard').length, 2);
});

test('o "Tentar de novo" do período refaz as BORDAS, não o resumo buscado com o palpite', () => {
  // `refetch` do TanStack ignora `enabled`: refazer o resumo sem bordas definitivas buscaria o
  // mês civil. Refeito o range, a chave muda e o resumo liga sozinho.
  const ui = screen(transacoesFile, { rangeError: true });
  ui.nodes().find((n: any) => n.type === 'ErrorCard').props.onRetry();
  assert.deepEqual(ui.refetches, ['range']);
});

test('Lançamentos com o período resolvido desenha o resumo, sem erro', () => {
  // A outra ponta, e é ela que o dublê antigo (`{from, to}`, sem `pronto`) escondia: com `pronto`
  // indefinido o card caía no esqueleto e nenhum teste percebia.
  const t = tipos(screen(transacoesFile));
  assert.ok(t.includes('PeriodSummaryCard'), 'o card do resumo tem que aparecer');
  assert.ok(!t.includes('ErrorCard'));
});


const semLimiteFalhou = (ui: ReturnType<typeof screen>) =>
  ui.nodes().find((n: any) => n.props?.message === 'Não deu para ver em que você gastou sem limite.');

test('Orçamentos com as bordas falhando avisa em "Sem limite", em vez de sumir com a seção', () => {
  // Sem bordas o resumo não liga, `semLimite` fica vazio e a seção SUMIA calada — a pessoa lia
  // "não há gasto sem limite" quando o que houve foi não conseguir perguntar.
  const ui = screen('src/app/finance/budgets.tsx', { rangeError: true });
  const aviso = semLimiteFalhou(ui);
  assert.ok(aviso, 'a falha do período precisa aparecer');
  aviso.props.onRetry();
  assert.deepEqual(ui.refetches, ['range'], 'refaz as bordas, não o resumo com o palpite');
});

test('Orçamentos com o período resolvido não mostra falha nenhuma', () => {
  assert.equal(semLimiteFalhou(screen('src/app/finance/budgets.tsx')), undefined);
});


const financeiroFile = 'src/app/(tabs)/finance/index.tsx';

test('Financeiro com as bordas falhando mostra o erro no herói, não um esqueleto eterno', () => {
  const ui = screen(financeiroFile, { rangeError: true });
  const t = tipos(ui);
  assert.ok(t.includes('ErrorCard'), 'o herói precisa mostrar a falha do período');
  assert.ok(!t.includes('Skeleton'), 'esqueleto com o período em erro é o defeito de volta');
  // "Ainda não tem movimento" é uma afirmação: sem resposta do resumo ela não pode aparecer.
  assert.ok(!ui.nodes().some((n: any) => n.props?.title === 'Ainda não tem movimento'));
});

test('o "Tentar de novo" do herói refaz as bordas e nunca o resumo sem elas', () => {
  const ui = screen(financeiroFile, { rangeError: true });
  ui.nodes().find((n: any) => n.type === 'ErrorCard').props.onRetry();
  assert.ok(ui.refetches.includes('range'), 'as bordas são o que falhou');
  assert.ok(!ui.refetches.includes('summary'), '`refetch` ignora `enabled`: buscaria o mês civil');
});

test('trocando de mês, com as bordas ainda chegando, o herói espera em vez de desenhar zero', () => {
  // O resumo só liga com as bordas definitivas, então `summary.isLoading` fica `false` enquanto
  // elas buscam. Com o portão da tela já aberto — é o que acontece numa troca de mês —, sem
  // `bordasChegando` o herói pintaria R$ 0,00 nesse intervalo.
  const t = tipos(screen(financeiroFile, { rangePending: true }));
  assert.ok(t.includes('Skeleton'), 'o herói fica no esqueleto');
  assert.ok(!t.includes('ErrorCard'), 'buscando não é falha');
});

test('Financeiro segura a primeira pintura enquanto as bordas do mês ANTERIOR chegam', () => {
  // `previous` só liga com `previousRange.pronto`, e desligado ele não segura o portão. Sem o
  // `previousRange` na lista, a tela abria com o mês atual e o "vs agosto" chegava depois.
  const buscandoAnterior = screen(financeiroFile, { rangePendingMonths: ['2026-08'] });
  assert.equal(telaPronta(...buscandoAnterior.gates.at(-1)!), false, 'o range anterior buscando segura a tela');
  const tudoPronto = screen(financeiroFile);
  assert.equal(telaPronta(...tudoPronto.gates.at(-1)!), true, 'sem este, o de cima não distinguiria nada');
});

test('Financeiro com o período resolvido não mostra falha nem esqueleto no herói', () => {
  const t = tipos(screen(financeiroFile));
  assert.ok(!t.includes('ErrorCard'));
  assert.ok(!t.includes('Skeleton'), 'sem este, o teste de cima não distinguiria nada');
});

const hojeFile = 'src/app/(tabs)/today/index.tsx';
/** Objetos criados dentro do `runInNewContext` têm outro protótipo: o `deepEqual` estrito os recusa. */
const copia = (v: unknown) => JSON.parse(JSON.stringify(v));
const agendaItem = (ui: ReturnType<typeof screen>, title?: string) =>
  ui.nodes().find((n: any) => n.type === 'AgendaItem' && (!title || n.props.title === title));

test('Hoje: o atrasado aparece em Agora e o botão dá baixa no lançamento certo', () => {
  const ui = screen(hojeFile, {
    bills: [{ ref_id: 'luz-1', title: 'Luz', due_date: '2026-09-01', amount_cents: 21000, kind: 'transaction', overdue: true }],
  });
  const item = agendaItem(ui, 'Luz');
  assert.ok(item, 'a conta atrasada precisa estar na tela');
  assert.equal(item.props.meta, 'venceu 01/09');
  item.props.action.onPress();
  assert.deepEqual(ui.writes.map((w) => w.operation), ['markPaid']);
  assert.equal(ui.writes[0].value.id, 'luz-1');
});

test('Hoje: fatura atrasada leva para a fatura, nunca dá baixa de lançamento', () => {
  const ui = screen(hojeFile, {
    bills: [{ ref_id: 'fat-1', title: 'Fatura Nubank', due_date: '2026-09-01', amount_cents: 135000, kind: 'invoice', overdue: true }],
  });
  agendaItem(ui).props.action.onPress();
  assert.equal(ui.writes.length, 0);
  assert.deepEqual(copia(ui.navigations.at(-1)), { pathname: '/finance/invoice/[id]', params: { id: 'fat-1' } });
});

test('Hoje: compra que vai cair no cartão aparece nos próximos dias e abre a fatura', () => {
  const ui = screen(hojeFile, {
    charges: [{ id: 'c-1', title: 'DAS', occurred_at: '2026-09-10', amount_cents: 7000, card: 'Nubank', invoice_id: 'f-9' }],
  });
  const item = agendaItem(ui, 'DAS');
  assert.equal(item.props.cartao, 'Nubank');
  item.props.action.onPress();
  assert.deepEqual(copia(ui.navigations.at(-1)), { pathname: '/finance/invoice/[id]', params: { id: 'f-9' } });
});

test('Hoje: usuário novo vê os Primeiros passos', () => {
  const ui = screen(hojeFile, {
    setupPassos: [{ id: 'whatsapp', titulo: 'Ligar o WhatsApp', feito: false, href: '/link-phone' }],
  });
  const passos = ui.nodes().find((n: any) => n.type === 'SetupChecklist');
  assert.ok(passos, 'o card de primeiros passos precisa aparecer');
  passos.props.onOpen(passos.props.passos[0]);
  assert.equal(ui.navigations.at(-1), '/link-phone');
});

test('Hoje: com os passos todos feitos o card não aparece', () => {
  const ui = screen(hojeFile, {
    setupPassos: [{ id: 'whatsapp', titulo: 'Ligar o WhatsApp', feito: true, href: '/link-phone' }],
  });
  assert.ok(!tipos(ui).includes('SetupChecklist'));
});

test('Hoje: falha nas contas mostra o erro em Agora, e o "Tentar de novo" refaz as contas', () => {
  const ui = screen(hojeFile, { billsError: true });
  const erro = ui.nodes().find((n: any) => n.type === 'ErrorCard');
  assert.ok(erro, 'seção que falha diz que falhou (§7)');
  erro.props.onRetry();
  assert.ok(ui.refetches.includes('bills'));
  assert.ok(!ui.nodes().some((n: any) => n.type === 'ThemedText' && String(n.props.children).startsWith('Nada vence')),
    'sem resposta das contas a tela não afirma que nada vence');
});

test('Hoje: dia sem nada diz que nada vence, sem inventar lista', () => {
  const ui = screen(hojeFile, {});
  assert.ok(!tipos(ui).includes('AgendaItem'));
  assert.ok(ui.nodes().some((n: any) => n.type === 'ThemedText' && String(n.props.children).startsWith('Nada vence')));
});

test('Hoje: o painel destaca só avisos acionáveis e cada linha mantém seu destino', () => {
  const ui = screen(hojeFile, {
    bills: [{ ref_id: 'luz-1', title: 'Luz', due_date: '2026-09-01', amount_cents: 21000, kind: 'transaction', overdue: true }],
    reminders: [{ id: 'r-1', title: 'Comprar remédio' }],
    budgets: [{ category: 'Mercado', limit_cents: 100_00, spent_cents: 85_00, committed_cents: 0 }],
  });
  const painel = ui.nodes().find((n: any) => n.type === 'TodaySignals');
  assert.ok(painel);
  assert.deepEqual(copia(painel.props.signals.map((s: any) => s.key)), ['bills', 'reminders', 'budgets']);
  assert.equal(painel.props.signals[0].detail, '1 atrasada');
  for (const sinal of painel.props.signals) sinal.onPress();
  assert.deepEqual(copia(ui.navigations), ['/finance/transactions', '/reminders', '/finance/budgets']);

  const semOrcamentoNoLimite = screen(hojeFile, {
    bills: [{ ref_id: 'luz-1', title: 'Luz', due_date: '2026-09-01', amount_cents: 21000, kind: 'transaction', overdue: true }],
    reminders: [{ id: 'r-1', title: 'Comprar remédio' }],
  });
  const doisAvisos = semOrcamentoNoLimite.nodes().find((n: any) => n.type === 'TodaySignals');
  assert.deepEqual(copia(doisAvisos.props.signals.map((s: any) => s.key)), ['bills', 'reminders']);

  const semAvisos = screen(hojeFile);
  assert.ok(!semAvisos.nodes().some((n: any) => n.type === 'TodaySignals'), 'zero não vira card nem deixa vão na cascata');
});

const saldo = (nome: string, tipo: string, cents: number, aReceber = 0) => ({
  account_id: nome, name: nome, type: tipo,
  balance_cents: cents, cleared_cents: cents, pending_in_cents: aReceber, pending_out_cents: 0,
});

test('Hoje: "Nas contas" soma exatamente as linhas que mostra, e cartão fica de fora', () => {
  const ui = screen(hojeFile, {
    balances: [saldo('Nubank', 'checking', 120_00), saldo('Cofre', 'savings', 500_00), saldo('Cartão', 'credit_card', -900_00)],
  });
  const bloco = ui.nodes().find((n: any) => n.type === 'CashAccounts');
  assert.ok(bloco, 'o bloco das contas precisa aparecer');
  assert.equal(bloco.props.caixa.total, 620_00);
  assert.equal(
    bloco.props.caixa.linhas.reduce((t: number, l: any) => t + l.cents, 0),
    bloco.props.caixa.total,
    'o total do topo é a soma das linhas de baixo'
  );
  assert.ok(!bloco.props.caixa.linhas.some((l: any) => l.nome === 'Cartão'), 'cartão tem fatura, não saldo');
});

test('Hoje: tocar numa conta abre o extrato DELA', () => {
  const ui = screen(hojeFile, { balances: [saldo('Nubank', 'checking', 120_00)] });
  const bloco = ui.nodes().find((n: any) => n.type === 'CashAccounts');
  bloco.props.onOpen(bloco.props.caixa.linhas[0]);
  assert.deepEqual(copia(ui.navigations.at(-1)), { pathname: '/finance/transactions', params: { accountId: 'Nubank' } });
});

test('Hoje: falha nos saldos diz que falhou e refaz só os saldos', () => {
  const ui = screen(hojeFile, { balancesError: true });
  assert.ok(!tipos(ui).includes('CashAccounts'), 'sem resposta a tela não afirma saldo nenhum');
  const erro = ui.nodes().find((n: any) => n.type === 'ErrorCard');
  assert.ok(erro);
  erro.props.onRetry();
  assert.deepEqual(ui.refetches, ['balances']);
});

test('Hoje: sem conta nenhuma o bloco não desenha um card vazio', () => {
  const ui = screen(hojeFile, {});
  assert.ok(!tipos(ui).includes('CashAccounts'));
});

test('Hoje: o ritmo do dia compara hoje com os dias ANTERIORES do ciclo', () => {
  // ciclo começa 01/09, hoje é 08/09 → 8 dias decorridos, 7 anteriores.
  const ui = screen(hojeFile, {
    saiuHoje: [{ kind: 'expense', total_cents: 200_00 }],
    saiuNoCiclo: [{ kind: 'expense', total_cents: 900_00 }],
  });
  const tile = ui.nodes().find((n: any) => n.type === 'Tile' && n.props.label === 'Saiu hoje');
  assert.ok(tile, 'o ladrilho do dia precisa aparecer');
  // (900 − 200) / 7 = 100 por dia; hoje ficou acima.
  assert.match(String(tile.props.caption), /acima do ritmo/);
  assert.match(String(tile.props.caption), /100/, "a média por dia aparece na legenda");
});

test('Hoje: receita não entra no que "saiu"', () => {
  const ui = screen(hojeFile, {
    saiuHoje: [{ kind: 'income', total_cents: 4_000_00 }, { kind: 'expense', total_cents: 30_00 }],
    saiuNoCiclo: [{ kind: 'expense', total_cents: 100_00 }],
  });
  const tile = ui.nodes().find((n: any) => n.type === 'Tile' && n.props.label === 'Saiu hoje');
  assert.equal(tile.props.value.props.cents, 30_00);
});

test('Financeiro: os atalhos do mosaico levam aos mesmos destinos de antes', () => {
  const ui = screen(financeiroFile);
  const tiles = ui.nodes().filter((n: any) => n.type === 'Tile' && n.props.onPress);
  for (const t of tiles) t.props.onPress();
  const destinos = JSON.stringify(ui.navigations);
  for (const d of ['/finance/transactions', '/finance/accounts', '/finance/budgets', '/finance/forecast', '/finance/manage']) {
    assert.ok(destinos.includes(d), `o mosaico perdeu ${d}`);
  }
});

test('Financeiro: Entra e Sai abrem o ciclo filtrado pelo lado', () => {
  const ui = screen(financeiroFile);
  const entra = ui.nodes().find((n: any) => n.type === 'Tile' && n.props.label === 'Entra');
  const sai = ui.nodes().find((n: any) => n.type === 'Tile' && n.props.label === 'Sai');
  entra.props.onPress();
  sai.props.onPress();
  assert.equal(ui.navigations.at(-2).params.tipo, 'entra');
  assert.equal(ui.navigations.at(-1).params.tipo, 'sai');
  assert.equal(ui.navigations.at(-1).pathname, '/finance/cycle');
});

test('Financeiro: o FAB continua oferecendo as três formas de lançar', () => {
  const ui = screen(financeiroFile);
  const tela = ui.nodes().find((n: any) => n.type === 'Screen');
  tela.props.overlay.props.onPress();
  assert.deepEqual(
    ui.actions.map((a) => a.label),
    ['Gasto ou receita', 'Gasto ou receita que se repete', 'Financiamento']
  );
});

test('Hoje tablet reuses its real blocks and retains their destinations', () => {
  const ui = screen(hojeFile, { tablet: true, balances: [saldo('Conta', 'checking', 120_00)] });
  const tela = ui.nodes().find((n: any) => n.type === 'Screen');
  assert.equal(tela.props.wide, true);
  const canvas = ui.nodes().find((n: any) => n.type === 'TodayTabletCanvas');
  assert.ok(canvas);
  assert.ok(tipos(ui).includes('CashAccounts'));
  assert.ok(ui.nodes().some((n: any) => n.type === 'Tile' && n.props.label === 'Saiu hoje'));
});

test('Financeiro tablet keeps the cycle, analysis and all management actions', () => {
  const ui = screen(financeiroFile, { tablet: true });
  const tela = ui.nodes().find((n: any) => n.type === 'Screen');
  assert.equal(tela.props.wide, true);
  const canvas = ui.nodes().find((n: any) => n.type === 'FinanceTabletCanvas');
  assert.ok(canvas);
  assert.ok(ui.nodes().some((n: any) => n.type === 'Tile' && n.props.label === 'Entra'));
  assert.ok(ui.nodes().some((n: any) => n.type === 'Tile' && n.props.label === 'Sai'));
  tela.props.overlay.props.onPress();
  assert.deepEqual(ui.actions.map((a) => a.label),
    ['Gasto ou receita', 'Gasto ou receita que se repete', 'Financiamento']);
});
