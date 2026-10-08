import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createContext, runInContext, runInNewContext } from 'node:vm';
import ts from 'typescript';
import { prepararLancamento } from './lancamento-write.ts';
import { calculateGoalContribution } from './goal-contribution.ts';

import { telaPronta } from './tela-pronta.ts';
import { filtroDeEstadoDoLembrete } from './pausa.ts';
import { allocate as allocateF14 } from './budget-plan.ts';
import { ladosDoArrasto } from './arrasto.ts';

const require = createRequire(import.meta.url);
// Execute the actual guarded field/payload declarations, without reproducing their rules.
// The full launch form uses react-hook-form; this isolates the identity regression while
// keeping both UI visibility and the save payload sourced from the production component.
function pixFeeFieldAndPayload(editing: Record<string, unknown>) {
  const path = 'src/components/finance/formulario-do-lancamento.tsx';
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = new Map<string, ts.VariableDeclaration>();
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) declarations.set(node.name.text, node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  const init = (name: string) => {
    const declaration = declarations.get(name);
    assert.ok(declaration?.initializer, `production declaration ${name} must exist`);
    return declaration.initializer.getText(source);
  };
  const mostraJuros = runInNewContext(`${init('mostraJuros')}`, {
    editing, jurosDoPix: null, isCard: true, paymentMethod: 'pix', kind: 'expense', installmentCount: 1,
  });
  const prepared = prepararLancamento({ kind: 'expense', amount_cents: 10000, category: null,
    description: String(editing.description), merchant: null, account_id: 'card', payment_method: 'pix',
    counterparty_account_id: null, occurred_at: '02/10/2026', fee_cents: 500, installments: 1,
    value_unit: 'total', auto_confirm: false, pending: false, installment_occurrence: false, due_at: null,
    paid_installments: '0', down_payment_enabled: false, down_payment_cents: 0,
    down_payment_date: '', down_payment_account: null, down_payment_method: null,
  }, { editing: { ...editing, id: 'purchase' }, podeAdiar: false, podeParcelarAqui: false,
    intencaoDoDia: null, isCard: true, mostraJuros, hoje: '2026-10-02' });
  return { mostraJuros, fee: prepared.entradaLancamento.fee_cents };
}

test('F01: título de juros no pai mantém campo e taxa no payload; vínculo explícito oculta campo da filha', () => {
  const parent = pixFeeFieldAndPayload({ description: 'Juros do Pix no crédito', pix_fee_for_transaction_id: null });
  assert.equal(parent.mostraJuros, true, 'renomear compra não pode ocultar a taxa nem zerar seu payload');
  assert.equal(parent.fee, 500);
  const child = pixFeeFieldAndPayload({ description: 'Taxa renomeada', pix_fee_for_transaction_id: 'purchase-renamed' });
  assert.equal(child.mostraJuros, false, 'filha explícita não oferece taxa da própria taxa');
  assert.equal(child.fee, 0);
});

/** A régua das fixtures fica estável quando o teste roda depois de 01/10. */
const fixtureDate = new Proxy(Date, {
  construct: (target, args) => Reflect.construct(target, args.length ? args : ['2026-10-01T12:00:00-03:00']),
  get: (target, key) => key === 'now' ? () => Date.parse('2026-10-01T12:00:00-03:00') : Reflect.get(target, key),
});

// Execute the screen JSX and its event handlers. Native components/query boundaries
// are inert; state persists across renders so each interaction uses current props.
function screen(file: string, options: { realMoney?: boolean; planningState?: any; planningError?: boolean; planningFetching?: boolean; planningPending?: boolean; planningUnconfirmed?: any; freshPlanning?: (...args: any[]) => Promise<any>; hook?: string; hookArgs?: any[]; reserveState?: any; reserveError?: boolean; reservePending?: boolean; reserveUnconfirmed?: any;  categoryDefaultsCached?: boolean; categoryDefaults?: any[]; categoryDefaultsPending?: boolean; categoryDefaultsError?: boolean; debtsPending?: boolean; debtsError?: boolean; plansPending?: boolean; plansError?: boolean; txPending?: boolean; txError?: boolean; downPayment?: any; downPaymentPending?: boolean; downPaymentError?: boolean; fontScale?: number; datasReais?: boolean; concealed?: boolean; executarEfeitos?: boolean; controlarTimers?: boolean; noteTags?: { tag: string; count: number }[]; reduzirMovimento?: boolean; tablet?: boolean; debts?: any[]; archivedDebts?: any[]; debtSchedule?: any[]; payoff?: any[]; invoiceStatus?: string; create?: boolean; monthLines?: any[]; monthSummary?: any; cycleLines?: any[]; cycleRow?: any; rangeError?: boolean; rangePending?: boolean; rangePendingMonths?: string[]; bills?: any[]; billsError?: boolean; charges?: any[]; reminders?: any[]; budgets?: any[]; setupPassos?: any[]; proximo?: any; activity?: any[]; activityError?: boolean; forecastAccounts?: any[]; anticipation?: any[] | ((pagarEm: string) => any[]); cards?: any[]; params?: Record<string, string>; paymentsError?: boolean; debtPayments?: any[]; declaredEstimates?: any[]; expectedLines?: any[]; expectedError?: boolean; expectedInTransit?: any[]; listError?: boolean; importItems?: any[]; importBatch?: any; unmatched?: any[]; forecastMonths?: any[]; categoriasUsadas?: any[]; maisPaginas?: boolean; alerts?: any[]; buscaNotas?: any[]; faturas?: any[]; balances?: any[]; balancesError?: boolean; plan?: string; planPending?: boolean; txStatus?: string; recent?: any[]; rules?: any[]; recurring?: any[]; goals?: any[]; componente?: string; props?: any; folders?: any[]; notes?: any[]; conversations?: any[]; conversationsPending?: boolean; batches?: any[]; plans?: any[]; contributions?: any[]; txs?: any[]; arquivadas?: number; pastasArquivadas?: any[]; budgetsPending?: boolean; spendable?: any; spendableError?: boolean; budgetsError?: boolean; cycleError?: boolean; gastos?: any[]; gastosError?: boolean; notesError?: boolean; notesPending?: boolean; cycleSeriesPending?: boolean; cycleSeriesError?: boolean; buscaPendente?: boolean; resumoPendente?: boolean; resumoErro?: boolean; arquivados?: any[]; draftLines?: any; preferencias?: Record<string, any>; simulacao?: any; cicloSimulado?: any; segurarMutacoes?: boolean; horizonte?: any; goalMoney?: any; linkCandidates?: any[]; investments?: any; assetValuations?: any[]; assets?: any[]; budgetPlan?: any; spending?: any; invoiceMissing?: boolean; primeiraOcorrencia?: string | null; milestones?: Record<string, number[]>; marcosPendentes?: boolean; favoritos?: any[]; favoritosArquivados?: any[]; billReminders?: any[]; billRemindersPending?: boolean; pausaPrevia?: any; pausaBuscando?: boolean; carencias?: any[]; carenciaPrevia?: any; carenciaBuscando?: boolean; carenciasPendentes?: boolean; carenciasErro?: boolean; carenciaErro?: boolean } = {}) {
  const state: any[] = [];
  // Metro executes these modules in one realm. Per-module VMs reject valid records in the
  // strict classification domain, so all production modules share a context here as well.
  const realm = createContext({ performance, Date: options.datasReais ? Date : fixtureDate });
  const inRealm = runInContext(`(() => {
    const copies = new WeakMap();
    function copy(value) {
      if (!value || typeof value !== 'object') return value;
      const prototype = Object.getPrototypeOf(value);
      if (prototype === Object.prototype || prototype === Array.prototype) return value;
      let result = copies.get(value);
      if (!result) { result = Array.isArray(value) ? [] : {}; copies.set(value, result); }
      for (const key of Object.keys(result)) if (!(key in value)) delete result[key];
      for (const key of Object.keys(value)) result[key] = copy(value[key]);
      return result;
    }
    return copy;
  })()`, realm);
  const timers = new Map<number, () => void>();
  let timerId = 0;
  let clientRequest = 0;
  const conclusoesDeAnimacao: ((terminou: boolean) => void)[] = [];
  let cursor = 0;
  let desmontado = false;
  let efeitosPendentes: { index: number; fn: () => any; deps: any[] }[] = [];
  const efeitos: { deps: any[]; cleanup?: () => void }[] = [];
  const animacoes: { valor: unknown; config: any; concluir?: (terminou: boolean) => void }[] = [];
  let nodes: any[] = [];
  // Como no React: `setState` DURANTE o render (o `?edit=`/`?id=` consumido quando o dado chega)
  // desenha de novo na hora, antes de a tela valer.
  let renderizando = false;
  let deNovo = false;
  const writes: { operation: string; value: any }[] = [];
  const confirmations: (() => void)[] = [];
  const actions: { label: string; onPress: () => void }[] = [];
  const navigations: any[] = [];
  /** Quais consultas o "Tentar de novo" refez — é assim que se sabe se ele refez a CERTA. */
  const refetches: string[] = [];
  const rulerViews: string[] = [];
  let forecastDrafts: any[] = [];
  /** Cada chamada de `useSimulacao`, com o que ela recebeu. */
  const simulacoes: any[] = [];
  /** O que cada chamada do portão da tela recebeu — o dublê dele abre sempre, então é por aqui que se confere a COMPOSIÇÃO. */
  const gates: any[][] = [];
  /** Contratos de consulta emitidos pela tela; cada render deixa a chamada mais recente no fim. */
  const transactionQueries: any[] = [];
  const expectedQueries: { from?: string; to?: string; pronto: boolean; recurringId?: string }[] = [];
  const summaryQueries: { from?: string; to?: string; pronto: boolean }[] = [];
  const categoryDefaultsQueries: { workspaceId?: string; enabled: boolean }[] = [];
  const planningQueries: any[][] = [];
  const freshPlanningQueries: any[][] = [];
  let hookResult: any;
  const query = { data: [], isLoading: false, isError: false, isRefetching: false, refetch: async () => {} };
  /** As mesmas escritas de `writes`, com as opções (`onSuccess`/`onError`) — é por aqui que se chama o retorno. */
  const pedidos: { operation: string; value: any; opts: any }[] = [];
  const toasts: any[] = [];
  /** Com que id, início e fim (exclusivo) a folha "Pausar…" pediu a prévia. */
  const previasDePausa: [string | null, string | null, string | null][] = [];
  const previasDeCarencia: [string | null, number | null, number | null][] = [];
  /** Os pedidos de nome de favorito (a folha é dublê): o teste confirma por aqui. */
  const nomesPedidos: { padrao: string; aoConfirmar: (nome: string) => void }[] = [];
  // O que as telas gravaram em `usePreferencia` (o rascunho do E se, por exemplo).
  const preferenciasGravadas: Record<string, any> = {};
  /** O texto de cada confirmação destrutiva (o 4º argumento de `confirmDestructive`). */
  const avisos: string[] = [];
  /** Com que limite cada lista paginada no servidor foi pedida — é como se vê o "Ver mais" pedir mais. */
  const pedidosDeLimite: [string, number | undefined][] = [];
  /** Quantas chamadas de cada mutação seguem no banco (`segurarMutacoes`): é o `isPending` delas. */
  const emCurso: Record<string, number> = {};
  const mutation = (operation: string) => ({ get isPending() { return (emCurso[operation] ?? 0) > 0; }, reset() {}, mutate(value: any, opts?: any) { writes.push({ operation, value }); pedidos.push({ operation, value, opts }); }, async mutateAsync(value: any) {
    writes.push({ operation, value });
    // `segurarMutacoes`: a promessa só resolve quando o teste chama `resolver` — é como se vê o que
    // a tela faz ANTES e DEPOIS do sucesso sem depender do callback por chamada.
    if (!options.segurarMutacoes) return `${operation}-id`;
    emCurso[operation] = (emCurso[operation] ?? 0) + 1;
    const terminou = () => { emCurso[operation] -= 1; };
    return new Promise((resolver, rejeitar) => pedidos.push({ operation, value, opts: undefined,
      resolver: (v: unknown) => { terminou(); resolver(v); }, rejeitar: (e: unknown) => { terminou(); rejeitar(e); } } as any));
  } });
  const animation = { duration: () => animation, delay: () => animation, reduceMotion: () => animation };
  const finance = new Proxy({
    NO_ACCOUNT: 'none',
    DEBT_KINDS: [{ value: 'financing', label: 'Financiamento' }, { value: 'loan', label: 'Empréstimo' }],
    SUGGESTED_CATEGORIES: [],
    ACCOUNT_TYPES: [
      { value: 'checking', label: 'Conta corrente', icon: 'building.columns' },
      { value: 'savings', label: 'Poupança', icon: 'banknote' },
      { value: 'credit_card', label: 'Cartão de crédito', icon: 'creditcard' },
    ],
    INCOME_CATEGORIES: [],
    ASSET_CLASSES: [{ value: 'investment', label: 'Investimento', icon: 'chart.line.uptrend.xyaxis' }],
    useDebts: () => ({ ...query, data: options.debts ?? [], isPending: Boolean(options.debtsPending), isSuccess: !options.debtsPending && !options.debtsError, isError: Boolean(options.debtsError), refetch: async () => { refetches.push('debts'); } }),
    useCardSummary: () => ({ ...query, isSuccess: true, data: options.cards ?? [] }),
    useCardInvoices: () => ({ ...query, isSuccess: true, data: options.faturas ?? [] }),
    useCategoriesUsed: () => ({ ...query, isSuccess: true, data: options.categoriasUsadas ?? [] }),
    useCategoryClassificationDefaults: (workspaceId?: string, enabled = true) => {
      categoryDefaultsQueries.push({ workspaceId, enabled });
      // A disabled TanStack query can still expose a successful cached result.
      const available = enabled || Boolean(options.categoryDefaultsCached);
      return { ...query,
      data: options.categoryDefaults ?? [], isPending: !available || Boolean(options.categoryDefaultsPending),
      status: enabled && options.categoryDefaultsError ? 'error'
        : !available || options.categoryDefaultsPending ? 'pending' : 'success',
      fetchStatus: enabled && options.categoryDefaultsPending ? 'fetching' : 'idle',
      isSuccess: available && !options.categoryDefaultsPending && !options.categoryDefaultsError,
      isError: enabled && Boolean(options.categoryDefaultsError),
      refetch: async () => { refetches.push('category-defaults'); },
    }; },
    // A aparência sai da régua de verdade (`lib/categorias.ts`) sobre as categorias do teste.
    useAparencia: () => (nome: string | null, kind?: string | null) => load('src/lib/categorias.ts').aparenciaDaCategoria(nome, options.categoriasUsadas ?? [], kind),
    useSalvarCategoria: () => mutation('salvarCategoria'),
    useApagarCategoria: () => mutation('apagarCategoria'),
    useImportItems: () => ({ ...query, isSuccess: true, data: options.importItems ?? [] }),
    useImportBatch: () => ({ ...query, isSuccess: true, data: options.importBatch ?? { status: 'open', account_id: 'conta-1', accounts: { type: 'checking' } } }),
    useImportUnmatched: () => ({ ...query, isSuccess: true, data: options.unmatched ?? [] }),
    useUpdateImportItem: () => mutation('updateImportItem'),
    // Só responde quando o teste dá os lançamentos: respondido e vazio, o Financeiro afirmaria
    // "Ainda não tem movimento", e o teste das bordas falhando depende de ele NÃO afirmar.
    useRules: () => ({ ...query, isSuccess: true, data: options.rules ?? [] }),
    useRecurringTransactions: () => ({ ...query, isSuccess: true, data: options.recurring ?? [] }),
    useToggleRecurring: () => mutation('toggleRecurring'),
    useGoals: () => ({ ...query, isSuccess: true, data: options.goals ?? [] }),
    useImportBatches: (limite?: number) => { pedidosDeLimite.push(['batches', limite]); return { ...query, isSuccess: true, data: options.batches ?? [] }; },
    useAlertsSent: (limite?: number) => { pedidosDeLimite.push(['alerts', limite]); return { ...query, isSuccess: true, data: options.alerts ?? [] }; },
    useInstallmentPlans: () => ({ ...query, isSuccess: true, data: options.plans ?? [] }),
    // Os três vizinhos enxutos do detalhe: desligados (sem o vínculo) ficam `idle` e pendentes, como no TanStack.
    useInstallmentPlanResumo: (id?: string | null) => id ? ({ ...query, isSuccess: true, data: (options.plans ?? []).find((p: any) => p.id === id) ?? null, refetch: async () => { refetches.push('plan'); } }) : ({ ...query, isPending: true, fetchStatus: 'idle', data: undefined }),
    useRecurringSerie: (id?: string | null) => id ? ({ ...query, isSuccess: true, data: (options.recurring ?? []).find((r: any) => r.id === id) ?? null, refetch: async () => { refetches.push('serie-do-lancamento'); } }) : ({ ...query, isPending: true, fetchStatus: 'idle', data: undefined }),
    useInvoiceHead: (id?: string) => id ? ({ ...query, isSuccess: true, data: { reference_month: '2026-08-01', due_date: '2026-08-20' }, refetch: async () => { refetches.push('invoice-head'); } }) : ({ ...query, isPending: true, fetchStatus: 'idle', data: undefined }),
    useUpdateInstallmentPlan: () => mutation('updateInstallmentPlan'),
    useInstallmentPlan: (id?: string) => ({ ...query, isPending: Boolean(options.plansPending), isSuccess: !options.plansPending && !options.plansError, isError: Boolean(options.plansError), refetch: async () => { refetches.push('plan'); }, data: (options.plans ?? []).find((p: any) => p.id === id) ?? null }),
    useGoalContributions: () => ({ ...query, isSuccess: true, data: options.contributions ?? [] }),
    useEditGoalContribution: () => mutation('editGoalContribution'),
    useGoalDeposit: () => mutation('goalDeposit'),
    useSaveGoal: () => mutation('saveGoal'),
    useDeleteImportBatch: () => mutation('deleteImportBatch'),
    useRecentTransactions: () => (options.recent ? { ...query, isSuccess: true, data: options.recent } : query),
    PLANS: [
      { value: 'free', label: 'Free', price: 'grátis', pitch: '1 pessoa' },
      { value: 'pro', label: 'Pro', price: 'R$ 24,90/mês', pitch: '3 pessoas' },
      { value: 'family', label: 'Família', price: 'R$ 39,90/mês', pitch: '5 pessoas' },
    ],
    usePlanStatus: () => options.planPending
      ? { ...query, isPending: true, data: undefined }
      : { ...query, isPending: false, isSuccess: true, data: { plan: options.plan ?? 'pro' } },
    useMonthLines: () => ({ ...query, data: options.monthLines ?? [] }),
    useCycleLines: () => ({ ...query, data: options.cycleLines ?? [] }),
    useDraftLines: (hipoteses: any[]) => hipoteses.length ? { ...query, isPending: false, isSuccess: true, data: options.draftLines ?? { antes: 0, linhas: [] } } : { ...query, isPending: true, data: undefined },
    // A tela do ciclo mostra o esqueleto enquanto não tem a série — sem este dublê ela nunca
    // chega a renderizar linha nenhuma, e o teste passaria a medir o esqueleto.
    // `cycleSeriesPending`: a série de OUTRO mês chegando (a troca de mês, com o portão já aberto).
    useCycleSeries: () => options.cycleSeriesError ? { ...query, isError: true, isPending: false, data: undefined, refetch: async () => { refetches.push('serie'); } } : options.cycleSeriesPending ? { ...query, isLoading: true, isPending: true, fetchStatus: 'fetching', data: undefined } : ({ ...query, isPending: false, data: [options.cycleRow ?? {
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
    useTransactions: (filters: { pronto?: boolean }) => {
      transactionQueries.push({ ...filters });
      return filters.pronto === false
      ? { ...query, data: undefined, isPending: true, fetchStatus: 'idle', hasNextPage: false, isFetchingNextPage: false, fetchNextPage: () => {}, refetch: async () => { refetches.push('list'); } }
      // Uma linha: com a lista vazia o card do resumo SOME de propósito (card que soma uma lista
      // vazia é eco — design.md §1), e o caminho feliz não teria o que mostrar.
      : options.listError
        ? { ...query, data: undefined, isError: true, isPending: false, hasNextPage: false, isFetchingNextPage: false, fetchNextPage: () => {}, refetch: async () => { refetches.push('list'); } }
        : { ...query, data: { pages: [options.txs ?? [{ id: 'tx-1', kind: 'expense', amount_cents: 4500, occurred_at: '2026-09-15', description: 'Mercado', category: 'mercado', account_id: null, status: options.txStatus ?? 'cleared' }]], pageParams: [] }, isPending: false, hasNextPage: false, isFetchingNextPage: false, fetchNextPage: () => {}, refetch: async () => { refetches.push('list'); } };
    },
    useExpectedLedgerLines: (from?: string, to?: string, pronto = true, recurringId?: string) => {
      expectedQueries.push({ from, to, pronto, recurringId });
      // Desligar não apaga dados/erro em cache; a tela precisa ignorá-los deliberadamente.
      return { ...query, isPending: !pronto && !options.expectedError, fetchStatus: 'idle',
        isError: Boolean(options.expectedError), data: options.expectedError ? undefined : options.expectedLines ?? [],
        refetch: async () => { refetches.push('expected'); } };
    },
    useMonthSummary: () => ({ ...query, data: options.monthSummary ?? null }),
    useAccounts: () => ({ ...query, data: options.forecastAccounts ?? [] }),
    useCashFlowForecast: () => ({ ...query, data: [{ day: '2026-09-18', balance_cents: 10000, in_cents: 0, out_cents: 0 }] }),
    useCashHistory: () => ({ ...query, data: [] }),
    useAnticipationCandidates: (pagarEm: string) => ({ ...query, isSuccess: true,
      data: typeof options.anticipation === 'function' ? options.anticipation(pagarEm) : options.anticipation ?? [] }),
    useForecastMonths: () => ({ ...query, data: { hoje: 10000, meses: options.forecastMonths ?? [] }, isPlaceholderData: false }),
    // O mês é uma STRING (`2026-09`); sem este dublê o Proxy devolvia um objeto-consulta.
    useCycleMonth: () => '2026-09',
    useMonthBreakdown: () => ({ ...query, data: [] }),
    useSaveDebt: () => mutation('saveDebt'),
    useSaveDebtContractScoped: () => mutation('saveDebtContractScoped'),
    useRegistrarPagasContadas: () => mutation('registrarPagasContadas'),
    useDebtPaymentVersions: () => ({ ...query, isSuccess: true, data: (options.debtPayments ?? []).map((p) => ({ ...p, edit_revision: p.edit_revision ?? 0 })) }),
    usePayDebtInstallment: () => mutation('payDebt'),
    useDeleteTransaction: () => mutation('deleteTransaction'),
    useSaveAccount: () => mutation('saveAccount'),
    useCreateAccount: () => ({ ...mutation('createAccount'), unconfirmedInput: null }),
    useDefaultWorkspaceId: () => ({ ...query, isSuccess: true, data: 'ws-1' }),
    useContaTemLancamentos: () => ({ ...query, isSuccess: true, data: Boolean(options.contaTemLancamentos) }),
    useArchiveDebt: () => mutation('archiveDebt'),
    useUnarchiveDebt: () => mutation('unarchiveDebt'),
    useDeleteDebt: () => mutation('deleteDebt'),
    useSkipOccurrence: () => mutation('skipOccurrence'),
    useMaterializeOccurrence: () => mutation('materializeOccurrence'),
    useArchivedDebts: () => ({ ...query, data: options.archivedDebts ?? [] }),
    useDebtSchedule: () => ({ ...query, data: options.debtSchedule ?? [] }),
    usePayoffStrategy: () => ({ ...query, data: options.payoff ?? [] }),
    useDebtPayments: () => options.paymentsError
      ? { ...query, isSuccess: false, isError: true, data: undefined, refetch: async () => { refetches.push('payments'); } }
      : { ...query, isSuccess: true, data: options.debtPayments ?? [] },
    useDebtDeclaredEstimates: () => ({ ...query, isSuccess: true, data: options.declaredEstimates ?? [] }),
    pagamentosDaDivida: async () => ({ count: 0, totalCents: 0 }),
    useAssets: () => ({ ...query, isSuccess: true, data: options.assets ?? [] }),
    useSaveAsset: () => mutation('saveAsset'),
    useArchiveAsset: () => mutation('archiveAsset'),
    useSettleInvoice: () => mutation('settleInvoice'),
    useUnsettleInvoice: () => mutation('unsettleInvoice'),
    useUnrollInvoice: () => mutation('unrollInvoice'),
    useUpcomingBills: () => ({
      ...query,
      isSuccess: !options.billsError,
      isError: Boolean(options.billsError),
      data: options.billsError ? undefined : (options.bills ?? []),
      refetch: async () => { refetches.push('bills'); },
    }),
    useUpcomingCardCharges: () => ({ ...query, isSuccess: true, data: options.charges ?? [] }),
    // `budgetsPending`: os limites do mês chegando (a troca de mês, com o portão já aberto).
    useSaveBudget: () => mutation('saveBudget'),
    useDeleteBudget: () => mutation('deleteBudget'),
    useBudgetsStatus: () => options.budgetsError ? { ...query, isError: true, isSuccess: false, data: undefined, refetch: async () => { refetches.push('budgets'); } } : options.budgetsPending ? { ...query, isLoading: true, isPending: true, isSuccess: false, data: undefined } : ({ ...query, isSuccess: true, data: options.budgets ?? [] }),
    useSpendable: () => options.spendableError ? { ...query, isError: true, data: undefined, refetch: async () => { refetches.push('spendable'); } } : ({ ...query, isSuccess: true, data: options.spendable ?? { caixa: 0, comprometido_ate_entrada: 0, comprometido_no_ciclo: 0, proxima_entrada: null }, refetch: async () => { refetches.push('spendable'); } }),
    useCycle: () => options.cycleError ? { ...query, isError: true, isSuccess: false, data: undefined } : ({ ...query, isSuccess: true, data: options.cycle ?? { de: '2026-09-01', ate: '2026-09-30', mes: '2026-09', diasAteOFim: 22 } }),
    useAccountBalances: () => ({
      ...query,
      isSuccess: !options.balancesError,
      isError: Boolean(options.balancesError),
      data: options.balancesError ? undefined : (options.balances ?? []),
      refetch: async () => { refetches.push('balances'); },
    }),
    // A MESMA função serve as duas fatias da Hoje; o que as separa é a janela pedida.
    // A semana da Hoje: o gasto de cada dia (`daily_spending`), de três dias atrás até hoje.
    useDailySpending: (from: string, to: string) => options.gastosError
      ? { ...query, isError: true, isSuccess: false, data: undefined, refetch: async () => { refetches.push('gastos'); } }
      : { ...query, isSuccess: true, data: options.gastos ?? [], janela: [from, to], refetch: async () => { refetches.push('gastos'); } },
    useTransactionsSummary: (from?: string, to?: string, pronto = true) => {
      summaryQueries.push({ from, to, pronto });
      return !pronto ? { ...query, isPending: true, fetchStatus: 'idle', data: undefined,
        refetch: async () => { refetches.push('summary'); } } : options.resumoErro ? { ...query, isError: true, isSuccess: false, data: undefined,
        refetch: async () => { refetches.push('summary'); } } : options.resumoPendente ? { ...query, isPending: true, isLoading: true, isSuccess: false, fetchStatus: 'fetching', data: undefined } : ({
      ...query,
      isSuccess: true,
      data: from === to ? (options.saiuHoje ?? []) : (options.saiuNoCiclo ?? []),
      refetch: async () => { refetches.push('summary'); },
    });
    },
    useMarkPaid: () => mutation('markPaid'),
    useConfirmPaymentScoped: () => mutation('confirmPaymentScoped'),
    useSaveTransactionScoped: () => mutation('saveScoped'),
    useSaveTransaction: () => mutation('saveTransaction'),
    useCicloSimulado: (registros: any[]) => registros.length ? { ...query, isPending: false, isSuccess: true, data: options.cicloSimulado } : { ...query, isPending: true, data: undefined },
    useCreateInstallmentPlan: () => mutation('createInstallmentPlan'),
    useCreateRecurring: () => mutation('createRecurring'),
    useSaveRecurringSeries: () => mutation('saveRecurringSeries'),
    useSaveRecurringAll: () => mutation('saveRecurringAll'),
    useSaveRecurringOne: () => mutation('saveRecurringOne'),
    useRecurringFirstDate: () => ({ ...query, isSuccess: true, data: options.primeiraOcorrencia ?? null }),
    usePreviewEndRecurring: () => mutation('previewEndRecurring'),
    useEndRecurring: () => mutation('endRecurring'),
    useTransaction: (id: string) => ({ ...query, isPending: Boolean(options.txPending), isSuccess: !options.txPending && !options.txError, isError: Boolean(options.txError), refetch: async () => { refetches.push('transaction'); }, data: (options.txs ?? [{ id: 'tx-1', kind: 'expense', amount_cents: 4500, occurred_at: '2026-09-15', description: 'Mercado', category: 'mercado', account_id: null, status: options.txStatus ?? 'cleared', recurring_id: null, installment_plan_id: null }]).find((t: any) => t.id === id) ?? null }),
    usePayInvoice: () => mutation('payInvoice'),
    useConverterRegistro: () => mutation('converterRegistro'),
    useArquivados: () => ({ ...query, isSuccess: true, data: options.arquivados ?? [] }),
    // O que a Projeção mandou simular: os adiantamentos (drafts de caixa) e as hipóteses.
    useSimulacao: (o: any) => {
      forecastDrafts = o.adiantamentos;
      simulacoes.push(o);
      const ativo = o.enabled && (o.hipoteses.length > 0 || o.adiantamentos.length > 0);
      return ativo
        ? { ...query, isPending: false, isSuccess: true, isPlaceholderData: Boolean(options.simulacao?.placeholder),
            data: options.simulacao ?? { forecast: [{ day: '2026-09-18', balance_cents: 10000, in_cents: 0, out_cents: 0 }], erros: [] } }
        : { ...query, isPending: true, data: undefined };
    },
    useHorizonteReal: () => ({
      contas: { ...query, isPending: false, isSuccess: true, data: options.horizonte?.contas ?? [] },
      cartoes: { ...query, isPending: false, isSuccess: true, data: options.horizonte?.cartoes ?? [] },
    }),
    useDesarquivar: () => mutation('desarquivar'),
    useExcluirArquivado: (tabela: string) => mutation(`excluir:${tabela}`),
    ContaComLancamentos: class extends Error {},
    useInvoice: () => options.invoiceMissing ? ({ ...query, isError: true, isSuccess: false, data: undefined, error: { name: 'FaturaInexistente' } }) : ({ ...query, data: {
      invoice: { id: 'invoice-1', account_id: 'card-1', status: options.invoiceStatus ?? 'closed', reference_month: '2026-08-01', closing_date: '2026-08-10', due_date: '2026-08-20', paid_at: options.invoiceStatus === 'paid' ? '2026-08-18' : null, settled_manually: Boolean(options.settledManually) },
      transactions: [{ id: 'purchase-1', kind: 'expense', amount_cents: 147000, occurred_at: '2026-08-01' }],
      pagamentos: options.pagamentos ?? [],
    } }),
  }, { get: (target, key) => {
    const value = key in target ? target[key as keyof typeof target] : () => query;
    if (key === 'ContaComLancamentos' || typeof value !== 'function') return value;
    return (...args: any[]) => {
      const result = value(...args);
      // Keep live mutation getters; only read fixtures cross the domain boundary.
      return result?.mutateAsync ? result : inRealm(result);
    };
  } });
  const react = {
    Fragment: Symbol.for('react.fragment'),
    useState(initial: any) { const index = cursor++; if (!(index in state)) state[index] = inRealm(typeof initial === 'function' ? initial() : initial); return [state[index], (value: any) => { state[index] = inRealm(typeof value === 'function' ? value(state[index]) : value); if (renderizando || options.executarEfeitos) deNovo = true; }]; },
    useMemo: (fn: () => unknown) => fn(),
    useCallback: (fn: unknown) => fn,
    // Persistente entre renders, como no React: um `ref` que zera a cada render esconde o guarda
    // de toque duplo do "Aplicar" (29/09/2026).
    useRef: (v: unknown) => { const index = cursor++; if (!(index in state)) state[index] = { current: v }; return state[index]; },
    useEffect: (fn: () => any, deps: any[]) => {
      if (!options.executarEfeitos) return;
      const index = cursor++;
      const anterior = efeitos[index];
      if (!anterior || !deps || deps.some((v, i) => !Object.is(v, anterior.deps?.[i]))) efeitosPendentes.push({ index, fn, deps });
    },
    useLayoutEffect: (fn: () => any, deps: any[]): void => { react.useEffect(fn, deps); },
    memo: (componente: unknown) => componente,
    createContext: (valor: unknown) => ({ valor, Provider: 'Provider' }),
    useContext: (ctx: any) => ctx?.valor,
  };
  let reserveCancellationConstructor: any;
  let goalCancellationConstructor: any;
  const load = (path: string): any => {
    const module = { exports: {} as any };
    const sourcePath = path === 'src/components/finance/categoria-sheet.tsx'
      ? process.env.PROOPS_F06_CATEGORY_SHEET_FIXTURE ?? path : path;
    const code = ts.transpileModule(readFileSync(sourcePath, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const evaluate = runInContext(`(function(module, exports, require, setTimeout, clearTimeout) { ${code}\n })`, realm);
    evaluate(module, module.exports, (name: string) => {
      if (name === 'react') return react;
      if (name === '@/components/ui/sheet') return { Sheet: 'Sheet', SheetScroll: 'SheetScroll', SheetHeader: 'SheetHeader', FormularioEmTela: { Provider: 'FormularioEmTela.Provider' }, molduraEmTela: () => ({}) };
      if (name === 'zod') return require(name);
      if (name === '@hookform/resolvers/zod') return { zodResolver: (schema: any) => schema };
      // Stateful form boundary; the production JSX, handlers and Zod schema remain real.
      if (name === 'react-hook-form') return {
        useForm: ({ defaultValues, resolver }: any) => {
          const [control] = react.useState(() => ({ values: { ...defaultValues }, resolver }));
          const getValues = (name?: string) => name ? control.values[name] : { ...control.values };
          const setValue = (name: string, value: any) => { control.values[name] = value; };
          return { control, getValues, setValue, formState: { errors: {} },
            handleSubmit: (submit: any) => () => {
              const parsed = control.resolver.safeParse(control.values);
              if (parsed.success) submit(parsed.data);
            },
          };
        },
        useWatch: ({ control, name }: any) => name === undefined ? control.values : control.values[name],
        Controller: function Controller({ control, name, render }: any) {
          return render({ field: { value: control.values[name], onChange: (value: any) => { control.values[name] = value; } }, fieldState: {} });
        },
      };

      // A preferência gravada vale como `useState` dentro de uma visita; o disco tem teste próprio
      // (`use-preferencia.test.ts`).
      if (name === '@/lib/subcategories') return load('src/lib/subcategories.ts');
      if (name === '@/lib/category-detail-breakdown') return load('src/lib/category-detail-breakdown.ts');
      if (name === '@/hooks/use-category-details') return { useSubcategoryFilterOptions: () => ({ data: [], isError: false, isPending: false, isLoading: false, refetch: async () => {} }) };
      if (name === '@/hooks/use-subcategories') return { useSubcategories: () => ({ data: { workspace_id: '10000000-0000-4000-8000-000000000001', items: [] }, isError: false, isPending: false, isLoading: false, refetch: async () => {} }) };
      if (name === '@/hooks/use-preferencia') return { umDe: () => () => true, usePreferencia: (nome: string, padrao: unknown) => {
        const [v, setV] = react.useState(options.preferencias?.[nome] ?? padrao);
        // Por função, parte do GRAVADO (como o hook de verdade), não do valor deste render.
        return [v, (x: unknown) => {
          const antes = nome in preferenciasGravadas ? preferenciasGravadas[nome] : (options.preferencias?.[nome] ?? padrao);
          const novo = typeof x === 'function' ? (x as (a: unknown) => unknown)(antes) : x;
          preferenciasGravadas[nome] = novo;
          setV(novo);
        }];
      } };
      if (name === '@/hooks/use-rascunho') return load('src/hooks/use-rascunho.ts');
      // Import relativo dentro de `src/lib` (o `rascunho.ts` importa `./escrita.ts`): o módulo de verdade.
      if (name.startsWith('./') && path.startsWith('src/lib/')) return load(`src/lib/${name.slice(2)}`);
      if (name === 'react/jsx-runtime') return require(name);
      if (name === 'react-native') return { StyleSheet: { create: (value: unknown) => value }, View: 'View', Pressable: 'Pressable', ScrollView: 'ScrollView', FlatList: 'FlatList', SectionList: 'SectionList', useWindowDimensions: () => ({ width: 384, height: 800, fontScale: options.fontScale ?? 1 }), Platform: { OS: 'android', select: (o: any) => o.android ?? o.default } };
      // `View` também no topo: sem `__esModule`, o `import Animated from` do TS lê o módulo inteiro.
      if (name === 'react-native-reanimated') return { default: { View: 'AnimatedView' }, View: 'AnimatedView', FadeInDown: animation, FadeOut: animation, FadeIn: animation, ReduceMotion: { System: 'system' }, LinearTransition: animation, useAnimatedRef: () => ({ current: null }),
        // O crossfade do Lançar: com "reduzir movimento" a troca é imediata, e o teste lê a tela logo depois.
        useReducedMotion: () => options.reduzirMovimento ?? true,
        useSharedValue: (value: unknown) => {
          const novo = () => ({ value, get() { return this.value; }, set(v: unknown) { this.value = v; } });
          if (!options.executarEfeitos) return novo();
          const ref = react.useRef(null);
          if (!ref.current) ref.current = novo();
          return ref.current;
        },
        useAnimatedStyle: (fn: () => any) => options.executarEfeitos ? fn() : ({}), cancelAnimation: () => {},
        withTiming: (value: unknown, config: unknown, concluir?: (terminou: boolean) => void) => { animacoes.push({ valor: value, config, concluir }); if (concluir) conclusoesDeAnimacao.push(concluir); return value; },
        withSpring: (value: unknown, config: unknown, concluir?: (terminou: boolean) => void) => { animacoes.push({ valor: value, config, concluir }); if (concluir) conclusoesDeAnimacao.push(concluir); return value; }, runOnJS: (fn: unknown) => fn };
      if (name === 'expo-haptics') return { selectionAsync() {}, notificationAsync() {}, NotificationFeedbackType: { Success: 'success', Warning: 'warning' } };
      // `back` é navegação como qualquer outra e ENTRA na lista: é o que prende o "fechar um
      // formulário que outra tela abriu devolve para ela" (`useVoltarQuandoFechar`).
      if (name === 'expo-router') return { Stack: { Screen: 'StackScreen' }, Redirect: 'Redirect', useLocalSearchParams: () => options.params ?? (file.endsWith('finance/debts.tsx') ? {} : { id: 'invoice-1' }), useFocusEffect: () => {}, useIsFocused: () => true, router: { push: (to: any) => navigations.push(to), replace: (to: any) => navigations.push({ replace: to }), navigate: (to: any) => navigations.push(to), back: () => navigations.push({ back: true }), dismissAll: () => navigations.push({ dismissAll: true }), dismiss: (n?: number) => navigations.push({ dismiss: n ?? 1 }), canDismiss: () => !options.primeiraDaPilha, canGoBack: () => !options.primeiraDaPilha } };
      if (name === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ bottom: 0 }) };
      if (name === '@/hooks/use-finance') return finance;
      if (name === '@/hooks/use-goal-money') return {
        useGoalMoneyState: (goalId?: string) => ({ ...query, isSuccess: true, data: goalId && options.goalMoney ? options.goalMoney : undefined }),
        useGoalLinkCandidates: () => ({ ...query, isSuccess: true, data: options.linkCandidates ?? [] }),
        useGoalMoneyCommand: () => mutation('goalMoney'),
      };
      // F19: os marcos chegam prontos; a régua (etapa, % em centavos, diferença) é a DE VERDADE.
      if (name === '@/hooks/use-goal-milestones') return { useGoalMilestones: () => options.marcosPendentes ? { ...query, isPending: true, isSuccess: false, data: undefined } : ({ ...query, isSuccess: true, data: options.milestones ?? {} }) };
      if (name === '@/lib/goal-milestones') return load('src/lib/goal-milestones.ts');
      if (name === '@/hooks/use-spending-change') return {
        useSpendingChange: () => ({ ...query, isPending: false, isSuccess: true, data: options.spending, refetch: async () => { refetches.push('spending-change'); } }),
      };
      if (name === '@/lib/spending-change') return load('src/lib/spending-change.ts');
      if (name === '@/hooks/use-favoritos') return {
        NOME_REPETIDO: '23505',
        useFavoritos: (arquivados = false) => ({ ...query, isSuccess: true, isPending: false, data: (arquivados ? options.favoritosArquivados : options.favoritos) ?? [] }),
        useSalvarFavorito: () => mutation('salvarFavorito'),
        useApagarFavorito: () => mutation('apagarFavorito'),
        useUsouFavorito: () => mutation('usouFavorito'),
      };
      if (name === '@/components/finance/nome-do-favorito') return { useNomeDoFavorito: () => ({ pedir: (padrao: string, aoConfirmar: (n: string) => void) => nomesPedidos.push({ padrao, aoConfirmar }), folha: null }) };
      if (name === '@/hooks/use-investments') return {
        useInvestmentPositions: () => ({ ...query, isSuccess: true, data: options.investments?.positions ?? [], refetch: async () => { refetches.push('investments'); } }),
        useInvestmentMovements: (id?: string) => ({ ...query, isSuccess: true, data: id ? { pages: [{ movements: options.investments?.movements ?? [] }] } : undefined, hasNextPage: false, isFetchingNextPage: false, fetchNextPage: async () => {} }),
        useInvestmentLinkCandidates: () => ({ ...query, isSuccess: true, data: options.investments?.candidates ?? [] }),
        useInvestmentCommand: () => mutation('investment'),
        useInvestmentValueCommand: () => mutation('investment_value'),
        useAssetValuations: (id?: string) => ({ ...query, isSuccess: true, data: id ? (options.assetValuations ?? []) : undefined }),
        useDeleteAssetValuation: () => mutation('deleteAssetValuation'),
      };
      if (name === '@/hooks/use-budget-plan') return {
        useBudgetPlanState: () => ({ ...query, isSuccess: true, data: options.budgetPlan?.state, refetch: async () => { refetches.push('budget-plan'); } }),
        useBudgetPlanPreview: (input: any) => ({ ...query, isSuccess: true, data: input && options.budgetPlan?.preview ? options.budgetPlan.preview(input) : undefined }),
        useBudgetPlanCommand: () => mutation('budgetPlan'),
      };
      if (name === '@/components/finance/budget-plan-sheet') return load('src/components/finance/budget-plan-sheet.tsx');
      if (name === '@/lib/budget-plan') return load('src/lib/budget-plan.ts');
      if (name === '@/components/finance/investments-section') return load('src/components/finance/investments-section.tsx');
      if (name === '@/lib/investment') return load('src/lib/investment.ts');
      if (name === '@/lib/explicacoes') return load('src/lib/explicacoes.ts');
      if (name === '@/lib/push-routes') return load('src/lib/push-routes.ts');
      if (name === '@/hooks/use-emergency-reserve') return {
        useEmergencyReserve: () => inRealm({ ...query, data: options.reserveState, isPending: Boolean(options.reservePending), isSuccess: !options.reservePending && !options.reserveError, isError: Boolean(options.reserveError), refetch: async () => { refetches.push('emergency-reserve'); } }),
        useSaveEmergencyReserve: () => ({ ...mutation('saveEmergencyReserve'),
          isPending: (emCurso.saveEmergencyReserve ?? 0) > 0 || (emCurso.resolveEmergencyReserve ?? 0) > 0,
          isResolving: (emCurso.resolveEmergencyReserve ?? 0) > 0,
          resolveAsync: mutation('resolveEmergencyReserve').mutateAsync,
          unconfirmedInput: options.reserveUnconfirmed ?? null }),
      };
      if (name === '@/hooks/use-goal-planning' || name === '@/hooks/use-goal-horizon') {
        const fetched = async (...args: any[]) => {
          freshPlanningQueries.push(args);
          const snapshot = await (options.freshPlanning ? options.freshPlanning(...args) : Promise.resolve(options.planningState ?? f08UIState()));
          return inRealm(JSON.parse(JSON.stringify(name.endsWith('use-goal-horizon') ? f10UIState(snapshot) : snapshot)));
        };
        const queried = (...args: any[]) => {
          planningQueries.push(args);
          const state = options.planningState ?? f08UIState();
          return inRealm({ ...query, data: name.endsWith('use-goal-horizon') ? f10UIState(state) : state,
            isPending: Boolean(options.planningPending), isLoading: Boolean(options.planningPending),
            isFetching: Boolean(options.planningFetching), isError: Boolean(options.planningError),
            isSuccess: !options.planningPending && !options.planningError,
            error: options.planningError ? new Error('scenario failed') : null,
            refetch: async () => { refetches.push('goal-planning'); } });
        };
        const saving = () => ({ ...mutation('saveGoalPlan'),
          isPending: (emCurso.saveGoalPlan ?? 0) > 0 || (emCurso.resolveGoalPlan ?? 0) > 0,
          isResolving: (emCurso.resolveGoalPlan ?? 0) > 0,
          resolveAsync: mutation('resolveGoalPlan').mutateAsync,
          unconfirmedInput: options.planningUnconfirmed ? inRealm(options.planningUnconfirmed) : null });
        return { fetchGoalHorizonPlanning: fetched, useGoalHorizonPlanning: queried, useSaveGoalHorizon: saving,
        fetchGoalPlanning: async (...args: any[]) => {
          freshPlanningQueries.push(args);
          const snapshot = await (options.freshPlanning ? options.freshPlanning(...args) : Promise.resolve(options.planningState ?? f08UIState()));
          return inRealm(JSON.parse(JSON.stringify(snapshot)));
        },
        useGoalPlanning: (...args: any[]) => {
          planningQueries.push(args);
          return inRealm({ ...query, data: options.planningState ?? f08UIState(),
            isPending: Boolean(options.planningPending), isLoading: Boolean(options.planningPending),
            isFetching: Boolean(options.planningFetching), isError: Boolean(options.planningError),
            isSuccess: !options.planningPending && !options.planningError,
            error: options.planningError ? new Error('scenario failed') : null,
            refetch: async () => { refetches.push('goal-planning'); } });
        },
        useSaveGoalPlan: () => ({ ...mutation('saveGoalPlan'),
          isPending: (emCurso.saveGoalPlan ?? 0) > 0 || (emCurso.resolveGoalPlan ?? 0) > 0,
          isResolving: (emCurso.resolveGoalPlan ?? 0) > 0,
          resolveAsync: mutation('resolveGoalPlan').mutateAsync,
          unconfirmedInput: options.planningUnconfirmed ? inRealm(options.planningUnconfirmed) : null }),
      }; }
      if (name === '@/components/finance/goal-contribution-fields') return load('src/components/finance/goal-contribution-fields.tsx');
      if (name === '@/lib/goal-horizon') return load('src/lib/goal-horizon.ts');
      if (name === '@/lib/goal-contribution') return load('src/lib/goal-contribution.ts');
      if (name === '@/lib/goal-money') return load('src/lib/goal-money.ts');
      if (name === '@/components/finance/goal-planning') return load('src/components/finance/goal-planning.tsx');
      if (name === '@/lib/goal-planning') return load('src/lib/goal-planning.ts');
      if (name === '@/lib/goal-plan-save') {
        const domain = load('src/lib/goal-plan-save.ts');goalCancellationConstructor = domain.GoalPlanAttemptCancelledError;return domain;
      }
      if (name === '@/components/finance/emergency-reserve-section') return load('src/components/finance/emergency-reserve-section.tsx');
      if (name === '@/lib/emergency-reserve') {
        const domain = load('src/lib/emergency-reserve.ts');
        reserveCancellationConstructor = domain.EmergencyReserveAttemptCancelledError;
        return domain;
      }
      if (name === '@/hooks/use-expense-classification') return load('src/hooks/use-expense-classification.ts');
      if (name === '@/components/finance/origin-creation-host') return { OriginCreationHost: ({ children }: any) => children, OriginAccountPicker: 'AccountPicker' };
      if (name === '@/lib/payment-method') return load('src/lib/payment-method.ts');
      if (name === '@/lib/payment-method-filters') return load('src/lib/payment-method-filters.ts');
      if (name === '@/lib/expense-classification-filters') return load('src/lib/expense-classification-filters.ts');
      if (name === '@/components/finance/expense-classification-controls') return load('src/components/finance/expense-classification-controls.tsx');
      if (name === '@/lib/expense-classification') return load('src/lib/expense-classification.ts');
      if (name === '@/lib/category-configuration') return load('src/lib/category-configuration.ts');
      if (name === '@/components/ui/filter-bar') return load('src/components/ui/filter-bar.tsx');
      if (name === '@/lib/supabase' && file.endsWith('finance/recurring.tsx')) return { supabase: {
        from: () => {
          const filters: Record<string, unknown> = {};
          const chain = {
            select: () => chain,
            eq: (key: string, value: unknown) => { filters[key] = value; return chain; },
            gte: (key: string, value: unknown) => { filters[`gte:${key}`] = value; return chain; },
            order: () => chain,
            limit: () => chain,
            maybeSingle: async () => ({ data: (options.txs ?? []).find((tx: any) =>
              tx.recurring_id === filters.recurring_id && tx.status === filters.status &&
              tx.occurred_at >= String(filters['gte:occurred_at'])) ?? null, error: null }),
          };
          return chain;
        },
      } };
      if (name === '@/hooks/use-aos-poucos') return load('src/hooks/use-aos-poucos.ts');
      if (name === '@/hooks/use-lock') return { useLock: () => ({ semTrancar: (fn: () => unknown) => fn() }) };
      // O voo da Carteira é camada da raiz; aqui só a forma dos hooks, inerte.
      if (name === '@/components/motion/flight-layer') return { useFlight: () => ({ voar: async () => false }), useFlightAnchor: () => ({ prender: null, aoPosicionar: undefined }), useFlightHidden: () => undefined };
      if (name === '@/hooks/use-adaptive-window') return {
        useAdaptiveWindow: () => ({
          width: options.tablet ? 1280 : 384,
          windowClass: options.tablet ? 'expanded' : 'compact',
          fontScale: 1,
        }),
      };
      // Presença é fronteira visual aqui; os seus ciclos/cleanup são testados no harness próprio.
      if (name === '@/components/motion/cores-suaves') return { useCoresSuaves: () => ({}), useOpacidadeSuave: () => ({}) };
      if (name === '@/components/motion/presenca') return { Presenca: function Presenca(p: any) { return p.visivel ? p.children : null; }, MudancaSuave: 'MudancaSuave', TrocaSuave: 'TrocaSuave', usePresencaAtiva: () => true, usePresenca: (visivel: boolean) => ({ presente: visivel, estilo: {}, reduzir: true }) };
      if (name === '@/hooks/use-theme') return { useTheme: () => ({}), useScheme: () => 'light', PaletaTingida: 'PaletaTingida' };
      // portão de "a tela está pronta": no harness nada carrega, então ele já nasce aberto
      if (name === '@/hooks/use-apagar-com-alcance') return { useApagarComAlcance: () => ({
        apagar: (alvo: any) => writes.push({ operation: 'apagarComAlcance', value: alvo }),
        apagarNoAlcance: (alvo: any, alcance: string) => writes.push({ operation: 'apagarComAlcance', value: { ...alvo, alcance } }),
        pendente: false }) };
      if (name === '@/hooks/use-tela-pronta') return { useTelaPronta: (...consultas: any[]) => { gates.push(consultas); return true; } };
      // Carregado DE VERDADE: ele é a regra que se quer testar, não um arredor da tela.
      if (name === '@/hooks/use-voltar-quando-fechar') return load('src/hooks/use-voltar-quando-fechar.ts');
      if (name === '@/hooks/use-alertas-vistos') return load('src/hooks/use-alertas-vistos.ts');
      // O "Paguei" que confirma o valor (25/09/2026): carregado DE VERDADE, é a regra em teste.
      // O "Por voz" (F16) grava e fala com o agente: aqui só o gancho de abrir, que navega como marca.
      if (name === '@/components/finance/lancar-por-voz') return { useLancarPorVoz: () => ({ abrir: () => navigations.push({ porVoz: true }), folha: null }) };
      if (name === '@/components/finance/confirmar-baixa') return load('src/components/finance/confirmar-baixa.tsx');
      if (name === '@/lib/confirmar-baixa') return load('src/lib/confirmar-baixa.ts');
      if (name === '@/lib/encerrar-serie') return load('src/lib/encerrar-serie.ts');
      // A folha de "Encerrar" série (F18): aqui só o gancho — a conta mora no banco e a frase em `lib/encerrar-serie`.
      if (name === '@/components/finance/encerrar-serie') return { useEncerrarSerie: () => ({ abrir: (serie: any) => writes.push({ operation: 'encerrarSerie', value: serie.id }), folha: null }) };
      if (name === '@/lib/down-payment') return load('src/lib/down-payment.ts');
      // Os campos da série (26/09/2026): a folha de Recorrentes e o "Esta e as próximas" do lançamento.
      if (name === '@/components/finance/serie-form') return load('src/components/finance/serie-form.tsx');
      // E os da compra (26/09/2026): a folha de Parceladas e o "A compra toda" do lançamento.
      if (name === '@/components/finance/compra-form') return load('src/components/finance/compra-form.tsx');
      // O corpo do formulário da série (Task 4): carregado de verdade só em Recorrentes, que o hospeda
      // na folha; noutras telas ele é um nó (quem o hospeda confere as props).
      if (name === '@/components/finance/formulario-da-serie' && file.endsWith('finance/recurring.tsx')) return load('src/components/finance/formulario-da-serie.tsx');
      // O da dívida (Task 5): de verdade só em Dívidas, pelo mesmo motivo.
      if (name === '@/components/finance/formulario-da-divida' && file.endsWith('finance/debts.tsx')) return load('src/components/finance/formulario-da-divida.tsx');
      if (name === '@/hooks/use-down-payment') return { usePurchaseDownPayment: (_type: string, parentId?: string) => ({ ...query, isPending: Boolean(parentId && options.downPaymentPending), isSuccess: !options.downPaymentPending && !options.downPaymentError, isError: Boolean(options.downPaymentError), data: parentId ? options.downPayment ?? null : undefined, refetch: async () => { refetches.push('down-payment'); } }) };
      if (name === '@/hooks/use-items') return { localISODate: () => '2026-09-08', formatDateBR: options.datasReais ? load('src/lib/dates.ts').formatDateBR : () => '08/09/2026', formatBRL: load('src/lib/dates.ts').formatBRL, useRealtimeInvalidate: () => {}, useTodayReminders: () => ({ ...query, isSuccess: true, data: options.reminders ?? [] }), useReminders: (f: any = {}) => ({ ...query, isSuccess: true, data: { pages: [(options.reminders ?? []).filter((r: any) => { if (!f.status) return true; const em = r.active && load('src/lib/pausa.ts').emPausa(f.hoje, r.paused_from ?? null, r.paused_until ?? null); return (f.status === 'active') === (r.active && !em); })], pageParams: [0] }, hasNextPage: Boolean(options.maisPaginas), isFetchingNextPage: false, fetchNextPage: () => { refetches.push('proxima-pagina'); } }), useReminder: () => ({ ...query, data: undefined, isLoading: false }), useToggleReminder: () => mutation('toggleReminder'), useDeleteReminder: () => mutation('deleteReminder'), useSaveReminder: () => mutation('saveReminder') };
      if (name === '@/lib/pausa') return load('src/lib/pausa.ts');
      if (name === '@/components/finance/pausa-sheet') return load('src/components/finance/pausa-sheet.tsx');
      if (name === '@/components/finance/carencia-sheet') return load('src/components/finance/carencia-sheet.tsx');
      if (name === '@/hooks/use-pausas') return {
        usePauseRecurringPreview: (id: string | null, from: string | null, until: string | null) => { previasDePausa.push([id, from, until]); return { ...query, data: id ? options.pausaPrevia : undefined, isFetching: Boolean(options.pausaBuscando), isError: false }; },
        usePauseRecurring: () => mutation('pauseRecurring'),
        useResumeRecurring: () => mutation('resumeRecurring'),
        usePauseReminder: () => mutation('pauseReminder'),
        useDebtPausePreview: (id: string | null, de: number | null, meses: number | null) => { previasDeCarencia.push([id, de, meses]); return { ...query, data: id ? options.carenciaPrevia : undefined, isFetching: Boolean(options.carenciaBuscando), isError: Boolean(options.carenciaErro), error: { code: 'P0001', message: 'Já houve pagamento.' } }; },
        useDebtPause: () => mutation('debtPause'),
        useUndoDebtPause: () => mutation('undoDebtPause'),
        useDebtPauses: () => ({ ...query, data: options.carenciasPendentes || options.carenciasErro ? undefined : (options.carencias ?? []), isSuccess: !options.carenciasPendentes && !options.carenciasErro, isError: Boolean(options.carenciasErro), isPending: Boolean(options.carenciasPendentes), refetch: async () => { refetches.push('carencias'); } }),
      };
      if (name === '@/lib/lembrete-de-conta') return load('src/lib/lembrete-de-conta.ts');
      if (name === '@/hooks/use-bill-reminders') return {
        useBillReminders: () => ({ ...query, data: options.billReminders ?? [], isPending: Boolean(options.billRemindersPending), isSuccess: !options.billRemindersPending, isError: false }),
        useBillReminderFor: (alvo: any) => alvo ? (options.billReminders ?? []).find((l: any) => load('src/lib/lembrete-de-conta.ts').mesmoAlvo(l.alvo, alvo)) : undefined,
        useSaveBillReminder: () => mutation('saveBillReminder'),
      };
      if (name === '@/hooks/use-push') return { useAlertPreferences: () => ({ ...query, data: { push: true, whatsapp: true } }) };
      if (name === '@/hooks/use-session') return { useSession: () => ({ session: { user: { id: 'user-1' } } }) };
      if (name === '@/hooks/use-profile') return { useProfile: () => ({ ...query, isSuccess: true, data: { display_name: 'Gabriel Almeida', phone: null } }) };
      if (name === '@/hooks/use-proximo-passo') return { useProximoPasso: () => ({ passo: options.proximo ?? null, dispensar: (id: string) => writes.push({ operation: 'dispensarProximo', value: id }), consultas: [] }) };
      if (name === '@/hooks/use-setup-progress') return { useSetupProgress: () => ({ passos: options.setupPassos ?? [], pronto: true, consultas: [] }) };
      if (name === '@/hooks/use-bool-pref') return { useBoolPref: () => [false, () => {}] };
      // O relógio da Hoje, parado ao meio-dia de 08/09 (o `localISODate` do dublê de use-items).
      if (name === '@/hooks/use-agora') return { useAgora: () => new Date(2026, 8, 8, 12, 0).getTime() };
      // As dicas: a loja fica fora (aparelho); o que se prende é ONDE a tela as põe e o que o
      // gesto e o "Mostrar" pedem a ela.
      if (name === '@/hooks/use-dicas') return {
        useDica: () => true,
        useGuiaAberto: () => false,
        usarDica: (id: string) => writes.push({ operation: 'usarDica', value: id }),
        reacenderDica: (id: string) => writes.push({ operation: 'reacenderDica', value: id }),
        dispensarDica: () => {},
        marcarGuiaAberto: () => {},
      };
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
      if (name === '@/lib/consulta-em-foco') return { useQuery: () => query };
      if (name === '@tanstack/react-query') return { useQuery: () => query, useMutation: () => mutation('mutation'), useQueryClient: () => ({ invalidateQueries: async () => {} }) };
      if (name === '@/lib/account-form') return load('src/lib/account-form.ts');
      if (name === '@/components/finance/account-form') return load('src/components/finance/account-form.tsx');
      if (name === '@/lib/lancamento-write' || name === '@/lib/finance-write-input' || name === '@/lib/list-filters' || name === '@/lib/finance-form' || name === '@/lib/dates' || name === '@/lib/forecast-months' || name === '@/lib/month-view' || name === '@/lib/settle-labels' || name === '@/lib/accounts' || name === '@/lib/cycle-label' || name === '@/lib/card-status' || name === '@/lib/today-sections' || name === '@/lib/runway' || name === '@/lib/budget-tight' || name === '@/lib/setup-steps' || name === '@/lib/activity-feed' || name === '@/lib/account-cash' || name === '@/lib/today-spend' || name === '@/lib/anticipation' || name === '@/lib/widget-snapshot' || name === '@/lib/debt-history' || name === '@/lib/import-preview' || name === '@/lib/arrasto' || name === '@/lib/text' || name === '@/lib/installment-progress' || name === '@/lib/aos-poucos' || name === '@/lib/categories' || name === '@/lib/categories-merge' || name === '@/lib/alert-history' || name === '@/lib/data-da-compra' || name === '@/lib/dicas' || name === '@/lib/recurring-state' || name === '@/lib/serie' || name === '@/lib/compra' || name === '@/lib/rascunho-no-ciclo' || name === '@/lib/rascunho' || name === '@/lib/escrita' || name === '@/lib/hipotese' || name === '@/lib/onde-muda' || name === '@/lib/atalhos-de-lancamento' || name === '@/lib/lancar' || name === '@/lib/voice-draft' || name === '@/lib/categorias' || name === '@/lib/comecar' || name === '@/lib/duplicar' || name === '@/lib/favoritos' || name === '@/lib/apagar-com-alcance' || name === '@/lib/carencia') return load(`src/lib/${name.split('/').at(-1)}.ts`);
      // o `categorias.ts` importa o mapa de ícones por caminho relativo (roda no `node --test` puro)
      if (name === '../design/category-icons.ts') return { categoryIcon: () => 'circle' };
      if (name === '@/hooks/use-debounced') return { useDebounced: (value: unknown) => value };
      if (name === '@/components/ui/glass-backdrop') return { GlassBackdrop: 'GlassBackdrop', supportsLiquidGlass: () => false };
      if (name === '@/hooks/use-note-sort') return { SORT_LABEL: {}, useNoteSort: () => ['manual', () => {}] };
      if (name === '@/components/notes/use-folder-menu') return { useFolderMenu: () => () => {} };
      if (name === '@/components/notes/nova-pasta') return load('src/components/notes/nova-pasta.tsx');
      if (name === '@/lib/volta-da-parcela') return load('src/lib/volta-da-parcela.ts');
      if (name === '@/lib/ledger-expected') return load('src/lib/ledger-expected.ts');
      if (name === '@/components/finance/expected-ledger-lines') return {
        LinhaPrevista: 'LinhaPrevista',
        useAcoesDaPrevista: () => ({ abrir: (line: any) => { refetches.push(`abrir:${line.ref_id}`); }, acoes: () => [], emTransito: options.expectedInTransit ?? [] }),
      };
      if (name === '@/lib/rrule-text') return { describeRRule: () => 'todo mês' };
      if (name === '@/hooks/use-archived-folders') return { useArchivedFolders: () => ({ ...query, isSuccess: true, data: options.pastasArquivadas ?? [] }) };
      if (name === '@/hooks/use-notes') return new Proxy({
        useNoteTags: () => ({ ...query, isSuccess: true, data: options.noteTags ?? [] }),
        useNoteFolders: () => ({ ...query, isSuccess: true, data: options.folders ?? [] }),
        useNotesList: () => options.notesPending ? { ...query, isPending: true, isLoading: true, isSuccess: false, fetchStatus: 'fetching', data: undefined } : options.notesError ? { ...query, isError: true, data: undefined, refetch: async () => { refetches.push('notas'); } } : ({ ...query, isSuccess: true, data: { pages: [options.notes ?? []] }, hasNextPage: Boolean(options.maisPaginas), isFetchingNextPage: false, fetchNextPage: () => { refetches.push('proxima-pagina'); } }),
        folderTree: (lista: any[]) => lista.map((f) => ({ ...f, depth: 0 })),
        useArchivedCount: () => ({ ...query, isSuccess: true, data: options.arquivadas ?? 0 }),
      } as Record<string, any>, { get: (target, key) => key in target ? target[key as string] : () => mutation(String(key)) });
      if (name === '@/hooks/use-agent-chat') return {
        useAgentConversations: () =>
          options.conversationsPending
            ? { ...query, isPending: true, isLoading: true, isSuccess: false, fetchStatus: 'fetching', hasNextPage: false, fetchNextPage() {}, data: undefined }
            : { ...query, isSuccess: true, hasNextPage: false, fetchNextPage() {}, data: { pages: [{ items: options.conversations ?? [] }] } },
        useRenameAgentConversation: () => mutation('renameConversation'),
        useDeleteAgentConversation: () => mutation('deleteConversation'),
      };
      if (name === '@/components/notes/note-actions') return { actionSheet: () => {}, confirmarApagarPasta: (pasta: any, apagar: () => void) => { avisos.push(`apagar ${pasta.name}: ${pasta.notes_count}`); confirmations.push(apagar); }, FOLDER_ICONS: [], notesLabel: (n: number) => `${n} notas`, symbol: () => 'folder' };
      if (name === '@/design/note-colors') return { noteInk: () => null, notePalette: (cor: string | null) => (cor ? { surface: `fundo-${cor}`, backgroundSelected: `forte-${cor}`, cardBorder: `borda-${cor}`, accentSoft: `forte-${cor}` } : null) };
      if (name === '@/hooks/use-search') return {
        useGlobalSearch: (_q: string, limite?: number) => {
          pedidosDeLimite.push(['busca', limite]);
          const r = (data: any[]) => ({ ...query, isSuccess: true, isLoading: false, data });
          // `buscaPendente`: as notas já responderam, lançamentos e lembretes ainda não (1ª busca).
          const chegando = { ...query, isLoading: true, isSuccess: false, data: undefined };
          return { notes: r(options.buscaNotas ?? []), transactions: options.buscaPendente ? chegando : r([]), reminders: options.buscaPendente ? chegando : r([]), enabled: true, term: 'mercado' };
        },
      };
      // A normalização do nome de pasta é a real: a "Nova pasta" a usa para achar nome repetido.
      if (name === '@/lib/search') return { noteTitle: (texto: string) => texto.split('\n')[0], notePreview: () => '', normalizeFolderName: load('src/lib/search.ts').normalizeFolderName };
      if (name === '@/lib/note-blocks') return { todoProgress: () => ({ done: 0, total: 0 }) };
      if (name === '@/design/category-icons') return { categoryIcon: () => 'circle' };
      if (name === '@/design/adaptive-window') return load('src/design/adaptive-window.ts');
      // import relativo DENTRO de um módulo puro já carregado (month-view → ./dates.ts)
      if (name === './dates.ts' || name === './dates') return load('src/lib/dates.ts');
      if (name === './debt-history.ts' || name === './debt-history') return load('src/lib/debt-history.ts');
      if (name === './finance-form.ts' || name === './finance-form') return load('src/lib/finance-form.ts');
      if (name === './text.ts' || name === './text') return load('src/lib/text.ts');
      if (name === './budget-tight.ts') return load('src/lib/budget-tight.ts');
      if (name === './today-spend.ts') return load('src/lib/today-spend.ts');
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
        useMonthRuler: (_tela: string, initialView = 'cycle') => {
          rulerViews.push(initialView);
          return { view: initialView, setView: () => {}, temCiclo: false, cycle: { data: undefined } };
        },
      };
      if (name === '@/lib/item-actions') return { confirmDestructive: (_title: string, _label: string, callback: () => void, mensagem?: string) => { confirmations.push(callback); avisos.push(mensagem ?? ''); }, showItemActions: (_title: string, entries: any[]) => actions.push(...entries) };
      if (name === '@/lib/edit-scope') return { askDeleteScope: (_tipo: string, onSelect: (scope: string) => void) => actions.push(
        { label: 'Só esta', onPress: () => onSelect('one') },
        { label: 'Esta e as próximas', onPress: () => onSelect('future') },
        { label: 'Todas', onPress: () => onSelect('all') },
      ), askEditScope: (_kind: string, onSelect: (scope: string) => void, _msg?: string, opcoes?: { contrato?: boolean }) => actions.push(
        // editando o contrato não há "esta" (28/09/2026)
        ...(opcoes?.contrato ? [] : [{ label: 'Só esta parcela', onPress: () => onSelect('one') }]),
        { label: 'Esta e próximas', onPress: () => onSelect('future') },
        { label: 'Todas', onPress: () => onSelect('all') },
      ) };
      if (name === '@/lib/agent-chat') return { newClientMessageId: () => `00000000-0000-4000-8000-${String(++clientRequest).padStart(12, '0')}` };
      if (name === '@/components/ui/toast') return { useToast: () => (t: any) => toasts.push(t), useSubirAcimaDoToast: () => ({}) };
      // O provider de "esconder saldo" só existe dentro da árvore real; aqui o valor aparece.
      if (name === '@/components/ui/conceal') return {
        useConceal: () => ({ concealed: Boolean(options.concealed), toggle: () => {} }),
        concealText: () => '••••••',
        useBRL: () => (cents: number) => options.concealed ? '••••••' : `R$ ${(cents / 100).toFixed(2)}`,
      };
      if (name === '@/components/ui/money' && options.realMoney) return load('src/components/ui/money.tsx');
      if (name === '@/components/ui/money') return { Money: 'Money', DinheiroEncolhe: { Provider: 'DinheiroEncolhe.Provider' } };
      if (name === '@/design/tokens') return { Motion: { duration: { fast: 120, base: 200, morph: 180 }, stagger: {}, easing: {}, spring: { morph: { stiffness: 360, damping: 26, mass: 1 } } }, IconSize: { md: 24 }, Space: { xs: 4, md: 12, lg: 16 }, Radius: {}, tabular: {}, Elevation: { light: {}, dark: {} }, Type: new Proxy({}, { get: () => ({}) }) };
      return new Proxy({}, { get: (_, key) => String(key) });
    }, options.controlarTimers ? (fn: () => void) => { const id = ++timerId; timers.set(id, fn); return id; } : undefined,
    options.controlarTimers ? (id: number) => timers.delete(id) : undefined);
    return module.exports;
  };
  // `componente`: um componente nomeado (o card de nota), renderizado com `props`.
  const loaded = load(file);
  const Component = options.hook ? () => {
    hookResult = loaded[options.hook!](...(options.hookArgs ?? []));
    return options.componente ? loaded[options.componente]({ editor: hookResult }) : null;
  } : loaded[options.componente ?? 'default'];
  const visit = (node: any) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node?.props || (node.type === 'Sheet' && !node.props.visible)) return;
    if (node.type?.name === 'Presenca' && !node.props.visivel) return;
    nodes.push(node);
    visit(node.props.children);
    if (node.type === 'Screen' && (file.endsWith('finance/recurring.tsx') || file === 'src/app/(tabs)/notes/index.tsx')) visit(node.props.search);
    // Tablet adapters hold the existing blocks in named slots, not children. Visit those slots
    // too so the same behavior assertions cover both compositions.
    if (node.type === 'TodayTabletCanvas') {
      for (const slot of ['saudacao', 'passos', 'dia', 'dinheiro', 'proximos', 'notas']) visit(node.props[slot]);
    }
    if (node.type === 'FinanceTabletCanvas') {
      for (const slot of ['cycle', 'actions', 'ledger', 'breakdown']) visit(node.props[slot]);
    }
    if (node.type === 'FinanceAnalysisPanes') visit(node.props.compact);
    // `CamposDaSerie` é um grupo de campos sem hook: desenhado aqui, a tela é a que a pessoa vê.
    // Os corpos (`FormularioDaSerie`, `FormularioDaDivida`) têm hooks: eles rodam depois dos da tela, na mesma ordem a cada render.
    if (typeof node.type === 'function' && ['Controller', 'AccountFormFields', 'CamposDaSerie', 'CamposDaCompra', 'FormularioDaSerie', 'CorpoDaSerie', 'FormularioDaDivida', 'CorpoDaDivida', 'TrashEmptyState', 'LinhaDoExtrato', 'FilterBar', 'ExpenseClassificationControls', 'EmergencyReserveSection', 'InvestmentsSection', 'BudgetPlanSheet', 'EmergencyReserveSheet', 'EmergencyReserveEditor', 'GoalPlanningSummary', 'GoalPlanSheet', 'GoalContributionCaption', 'GoalContributionFields', 'GoalContributionSummary', 'GoalContributionReady', 'GoalContributionHint', 'PlanningResult', 'Qualifications', ...(options.realMoney ? ['Money'] : [])].includes(node.type.name)) visit(node.type(node.props));
    if (node.type === 'Field') visit(node.props.hint);
    // No celular o `AdaptivePanes` desenha o slot de uma coluna só (Pastas, Recorrentes…).
    if (node.type === 'AdaptivePanes') visit(node.props.singlePaneContent ?? node.props.main);
    visit(node.props.ListHeaderComponent);
    // Mesmo motivo do header: slot é conteúdo renderizado. As ações da fatura desceram para o
    // FIM da lista em 15/09/2026 (botão fixo sobre o scroll foi recusado pelo dono do produto),
    // e sem esta linha elas somem daqui enquanto continuam na tela.
    visit(node.props.ListFooterComponent);
    // O estado vazio da lista também é slot renderizado — e é ONDE a lista dos Lançamentos
    // desenhava três linhas de esqueleto para sempre quando as bordas do período falhavam.
    visit(node.props.ListEmptyComponent);
    // As linhas de `FlatList`/`SectionList` são `renderItem` — é nelas que mora o card de uma
    // lista longa (Lançamentos, fatura), e sem isto nenhum teste enxergava a linha.
    if (typeof node.props.renderItem === 'function') {
      const itens = Array.isArray(node.props.sections)
        ? node.props.sections.flatMap((section: any) => (section.data ?? []).map((item: any) => ({ item, section })))
        : (Array.isArray(node.props.data) ? node.props.data : []).map((item: any) => ({ item }));
      itens.forEach((x: any, index: number) => visit(node.props.renderItem({ ...x, index })));
    }
    // O "Salvar" do sheet mora no slot `action` do `SheetHeader`, não em `children` — sem esta
    // linha o botão existe na tela e some daqui, que foi o que estas seis asserções viram.
    visit(node.props.action);
    if (options.realMoney) visit(node.props.trailing);
    // O seletor do Lançar mora no `topo` do corpo (que aqui é um nó com nome, não a árvore dele).
    visit(node.props.topo);
    // A barra das raízes de aba (`AppHeader`) — é nela que mora o "…" da tela.
    visit(node.props.topBar);
    // O `overlay` do `Screen` é conteúdo renderizado (a folha do "Paguei" na Hoje).
    visit(node.props.overlay);
    // Ação de header é DECLARADA como dado (`actions={[{label, onPress}]}`) e desenhada como
    // botão pela plataforma — o "+" que abre todo formulário de lista (§8 do design) mora aí.
    // Sem esta linha nenhum sheet de criação é alcançável por este harness. `ItemLink` também
    // tem `actions`, mas aquilo é menu de contexto, não botão visível: só `HeaderActions`.
    if (node.type === 'HeaderActions' && Array.isArray(node.props.actions))
      node.props.actions.forEach((a: any) => nodes.push({ type: 'Button', props: a }));
  };
  const render = () => {
    if (desmontado) return;
    for (let vez = 0; vez < 10; vez++) {
      cursor = 0; nodes = []; deNovo = false; efeitosPendentes = []; renderizando = true;
      try { visit(Component(inRealm(options.props ?? {}))); } finally { renderizando = false; }
      if (deNovo) continue;
      for (const efeito of efeitosPendentes) {
        efeitos[efeito.index]?.cleanup?.();
        efeitos[efeito.index] = { deps: efeito.deps, cleanup: efeito.fn() };
      }
      if (!deNovo) return;
    }
  };
  render();
  return {
    writes, pedidos, toasts, previasDePausa, previasDeCarencia, nomesPedidos, inRealm, preferenciasGravadas, pedidosDeLimite, avisos, confirmations, actions, navigations, refetches, gates, rulerViews, transactionQueries, expectedQueries, summaryQueries, categoryDefaultsQueries,
    drafts: () => forecastDrafts,
    cancelledReserveAttempt: () => new reserveCancellationConstructor(),
    cancelledGoalPlanAttempt: () => new goalCancellationConstructor(),
    planningQueries, freshPlanningQueries, editor: () => hookResult,
    simulacoes,
    nodes: () => nodes,
    animacoes: () => animacoes,
    flushTimers() { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); },
    desmontar() { efeitos.forEach((efeito) => efeito?.cleanup?.()); desmontado = true; nodes = []; },
    concluirAnimacao(terminou = true) { const concluir = conclusoesDeAnimacao.shift(); assert.ok(concluir, 'animação com conclusão pendente'); concluir(terminou); render(); },
    button(label: string) { const node = nodes.find((n) => n.type === 'Button' && n.props.label === label); assert.ok(node, `visible button: ${label}`); return node; },
    press(label: string) { const node = this.button(label); assert.ok(!node.props.disabled, `${label} must be enabled`); node.props.onPress(); render(); },
    fill(label: string, value: string | number) { const field = nodes.find((n) => n.type === 'Field' && n.props.label === label); assert.ok(field, `visible field: ${label}`); const children: any[] = []; const collect = (n: any) => { if (Array.isArray(n)) return n.forEach(collect); if (n?.props) { children.push(n); collect(n.props.children); } }; collect(field); const input = children.find((n) => ['TextField', 'MoneyField', 'QuantityField', 'DatePickerField'].includes(n.type)); assert.ok(input); if (input.type === 'QuantityField') input.props.onChange(Number(value)); else (input.props.onChangeText ?? input.props.onChangeCents ?? input.props.onChange)(value); render(); },
    interact(callback: (nodes: any[]) => void) { callback(nodes); render(); },
  };
}
const debtsFile = 'src/app/finance/debts.tsx';
/**
 * O formulário da dívida é o corpo do formulário único (Task 8: a folha de Dívidas saiu). Criando, ele
 * nasce do `comum` vazio que o hospedeiro passa; editando, com `editandoId`.
 */
const formDivida = (opts: Parameters<typeof screen>[1] = {}, props: Record<string, unknown> = {}) =>
  screen('src/components/finance/formulario-da-divida.tsx', { componente: 'FormularioDaDivida', ...opts, props: {
    comum: { kind: 'expense', descricao: '', valorCents: 0, contaId: null, dataBR: '', categoria: null },
    registrarComum: () => {}, registrarEstado: () => {}, onSalvo: () => {}, onFechar: () => {}, ...props,
  } });
/** Editando a primeira dívida da lista. */
const editarDivida = (opts: Parameters<typeof screen>[1] & { debts: any[] }) => formDivida(opts, { editandoId: opts.debts[0].id });
const forecastFile = 'src/app/finance/forecast.tsx';

/** O rascunho gravado no aparelho (vazio grava ''). */
const gravado = (ui: any) => {
  const t = ui.preferenciasGravadas['projecao:rascunho'];
  return t ? JSON.parse(t) : { hipoteses: [], adiantamentos: [] };
};
/** Preenche a hipótese da folha pelos campos (o componente é um nó no harness). */
const preenche = (ui: any, mudanca: Record<string, unknown>) => {
  const campos = ui.nodes().find((n: any) => n.type === 'CamposDaHipotese');
  assert.ok(campos, 'a folha mostra os campos da hipótese');
  ui.interact(() => campos.props.onChange({ ...campos.props.valor, ...mudanca }));
};

test('E se: Ver resultado funciona na primeira hipótese, com Adicionar mais uma disponível em paralelo', () => {
  const ui = screen(forecastFile, { forecastAccounts: [{ id: 'conta-1' }] });
  ui.press('Nova hipótese');
  preenche(ui, { valor_cents: 25000 });
  assert.equal(ui.button('Adicionar mais uma').props.disabled, false);
  ui.press('Ver resultado');

  const [h] = gravado(ui).hipoteses;
  assert.deepEqual([h.kind, h.forma, h.valor_cents], ['expense', 'uma', 25000]);
  assert.ok(ui.nodes().some((n: any) => n.type === 'ThemedText' && n.props.children === 'Rascunho'));
  assert.equal(ui.nodes().some((n: any) => n.type === 'Sheet' && n.props.visible), false);
  assert.deepEqual(ui.writes, []);
});

test('E se: Adicionar mais uma prepara várias hipóteses sem fechar; Ver resultado inclui a última', () => {
  const ui = screen(forecastFile, { forecastAccounts: [{ id: 'conta-1' }] });
  ui.press('Nova hipótese');
  preenche(ui, { valor_cents: 25000 });
  ui.press('Adicionar mais uma');
  assert.ok(ui.nodes().some((n: any) => n.type === 'Sheet' && n.props.visible));
  assert.equal(ui.button('Adicionar mais uma').props.disabled, true);
  assert.equal(ui.button('Ver resultado').props.disabled, false);
  // a folha diz o que falta na hipótese nova
  assert.ok(ui.nodes().some((n: any) => n.type === 'Note' && n.props.children === 'Digite o valor'));
  preenche(ui, { valor_cents: 10000 });
  ui.press('Adicionar mais uma');
  assert.deepEqual(gravado(ui).hipoteses.map((h: any) => h.valor_cents), [25000, 10000]);

  preenche(ui, { valor_cents: 5000 });
  ui.press('Ver resultado');
  assert.deepEqual(gravado(ui).hipoteses.map((h: any) => h.valor_cents), [25000, 10000, 5000]);
  assert.equal(new Set(gravado(ui).hipoteses.map((h: any) => h.id)).size, 3, 'cada uma com o seu id');
  assert.equal(ui.nodes().some((n: any) => n.type === 'Sheet' && n.props.visible), false);
  assert.deepEqual(ui.writes, []);
});

test('E se: adiantar vira UMA hipótese — o pagamento e um cancelamento por parcela, no dia de cada uma', () => {
  const carro = {
    source: 'debt', ref_id: 'd1', title: 'Carro', account_name: null, total_n: 48, taxa: 0.0199,
    events: [
      { n: 46, day: '2029-01-15', cents: 124500, pv_cents: 80000 },
      { n: 47, day: '2029-02-15', cents: 124500, pv_cents: 79000 },
      { n: 48, day: '2029-03-15', cents: 124500, pv_cents: 78000 },
    ],
  };
  const ui = screen(forecastFile, { forecastAccounts: [{ id: 'conta-1' }], anticipation: [carro] });
  const linhas = () => ui.nodes().filter((n: any) => n.type === 'Row' && String(n.props.accessibilityLabel).startsWith('Hipótese:'));
  ui.press('Nova hipótese');
  const tipo = () => ui.nodes().find((n: any) => n.type === 'Segmented'
    && n.props.options.some((o: any) => o.value === 'adiantar'));
  ui.interact(() => tipo().props.onChange('adiantar'));
  const campos = () => ui.nodes().find((n: any) => n.type === 'AdiantarCampos');
  assert.equal(ui.button('Ver resultado').props.disabled, true, 'sem item escolhido não há hipótese');

  ui.interact(() => campos().props.onItem('d1'));
  ui.interact(() => campos().props.onQuantas(2));
  // o padrão é "as últimas", e o valor nasce na soma dos valores presentes
  assert.equal(campos().props.valor, 79000 + 78000);
  ui.press('Ver resultado');

  const drafts = ui.drafts();
  assert.equal(drafts.length, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(drafts.map((d: any) => [d.mode, d.amount_cents, d.start]).slice(1))), [
    ['cancel', 124500, '2029-02-15'],
    ['cancel', 124500, '2029-03-15'],
  ]);
  assert.equal(drafts[0].mode, 'total');
  assert.equal(drafts[0].amount_cents, 157000);
  assert.equal(linhas().length, 1, 'a lista mostra uma linha');
  assert.ok(linhas()[0].props.title.includes('adianta 2 parcelas de Carro'));
  assert.deepEqual(ui.writes, []);

  // Tocar na linha EDITA: o sheet volta com a escolha feita e o valor aprovado
  const linha = () => linhas()[0];
  assert.equal(ui.nodes().some((n: any) => n.type === 'Button' && n.props.label === 'Tirar'), false,
    'o card não tem um botão por linha');
  ui.interact(() => linha().props.onPress());
  assert.ok(ui.nodes().some((n: any) => n.type === 'TaskHeader' && n.props.title === 'Editar hipótese'));
  assert.equal(campos().props.itemId, 'd1');
  assert.equal(campos().props.quantas, 2);
  assert.equal(campos().props.valor, 157000);
  assert.equal(ui.nodes().some((n: any) => n.type === 'Button' && n.props.label === 'Adicionar mais uma'), false);

  // mudar a quantidade volta à sugestão e Salvar TROCA a hipótese, não soma outra
  ui.interact(() => campos().props.onQuantas(3));
  assert.equal(campos().props.valor, 80000 + 79000 + 78000);
  ui.press('Salvar');
  assert.equal(ui.drafts().length, 4, 'um pagamento e três cancelamentos, a hipótese antiga saiu');
  assert.equal(ui.drafts().filter((d: any) => d.mode === 'total').length, 1);
  assert.ok(linha().props.title.includes('adianta 3 parcelas de Carro'));

  // "Tirar hipótese" mora no sheet de edição e leva o grupo inteiro
  ui.interact(() => linha().props.onPress());
  ui.press('Tirar hipótese');
  assert.equal(ui.drafts().length, 0);
});

test('E se: trocar o mês do pagamento para depois das parcelas escolhidas DIMINUI a quantidade sozinho', () => {
  // 22/09/2026: 4x escolhidas em setembro, pagar em dezembro. Primeiro virou um erro que travava
  // a hipótese; o dono do produto pediu o número diminuindo sozinho. Campo, valor e hipótese
  // leem o MESMO número assentado.
  const eventos = [
    { n: 5, day: '2026-10-10', cents: 10000, pv_cents: 10000 },
    { n: 6, day: '2026-11-10', cents: 10000, pv_cents: 10000 },
    { n: 7, day: '2026-12-10', cents: 10000, pv_cents: 10000 },
    { n: 8, day: '2027-01-10', cents: 10000, pv_cents: 10000 },
  ];
  const tv = (pagarEm: string) => [{ source: 'plan', ref_id: 'p1', title: 'TV', account_name: null,
    total_n: 8, taxa: null, events: eventos.filter((e) => e.day > pagarEm) }];
  const ui = screen(forecastFile, { forecastAccounts: [{ id: 'conta-1' }], anticipation: tv });
  ui.press('Nova hipótese');
  ui.interact((nodes) => nodes.find((n: any) => n.type === 'Segmented'
    && n.props.options.some((o: any) => o.value === 'adiantar')).props.onChange('adiantar'));
  const campos = () => ui.nodes().find((n: any) => n.type === 'AdiantarCampos');
  ui.interact(() => campos().props.onItem('p1'));
  ui.interact(() => campos().props.onQuantas(4));
  assert.equal(campos().props.quantas, 4);

  ui.interact(() => campos().props.onMes('2026-12'));
  assert.equal(campos().props.quantas, 2, 'assentou nas 2 que ainda vencem');
  assert.equal('erroQuantidade' in campos().props, false, 'não existe mais erro');
  assert.equal(ui.button('Ver resultado').props.disabled, false);
  ui.press('Ver resultado');
  assert.equal(ui.drafts().filter((d: any) => d.mode === 'cancel').length, 2);
});

test('E se: editar uma entrada troca o valor e a forma no mesmo lugar da lista', () => {
  const ui = screen(forecastFile, { forecastAccounts: [{ id: 'conta-1', name: 'Itaú', type: 'checking' }] });
  ui.press('Nova hipótese');
  preenche(ui, { valor_cents: 25000 });
  ui.press('Adicionar mais uma');
  preenche(ui, { valor_cents: 10000 });
  ui.press('Ver resultado');
  const linhas = () => ui.nodes().filter((n: any) => n.type === 'Row' && String(n.props.accessibilityLabel).startsWith('Hipótese:'));
  assert.equal(linhas().length, 2);

  ui.interact(() => linhas()[0].props.onPress());
  assert.ok(ui.nodes().some((n: any) => n.type === 'TaskHeader' && n.props.title === 'Editar hipótese'));
  // editando, o tipo da folha é o da linha: nada de trocar para adiantar
  assert.equal(ui.nodes().some((n: any) => n.type === 'Segmented' && n.props.options.some((o: any) => o.value === 'adiantar')), false);
  assert.equal(ui.button('Salvar').props.disabled, false);
  preenche(ui, { valor_cents: 30000, forma: 'parcelado', parcelas: 3, conta: 'conta-1' });
  ui.press('Salvar');

  assert.deepEqual(gravado(ui).hipoteses.map((h: any) => [h.valor_cents, h.forma, h.parcelas]), [[30000, 'parcelado', 3], [10000, 'uma', 2]]);
  assert.equal(ui.nodes().some((n: any) => n.type === 'Sheet' && n.props.visible), false);
  assert.deepEqual(ui.writes, []);
});

test('E se: Ver resultado depois de Somar não duplica a hipótese já adicionada', () => {
  const ui = screen(forecastFile, { forecastAccounts: [{ id: 'conta-1' }] });
  ui.press('Nova hipótese');
  preenche(ui, { valor_cents: 25000 });
  ui.press('Adicionar mais uma');
  ui.press('Ver resultado');
  assert.equal(gravado(ui).hipoteses.length, 1);
  assert.equal(ui.nodes().some((n: any) => n.type === 'Sheet' && n.props.visible), false);
});

test('new financing: Nome and Conta first, the name is required and the typed one is saved', () => {
  const ui = formDivida();
  // 23/09/2026: "Nome e conta" era uma linha recolhida no FIM, e o nome caía em "Financiamento 2".
  assert.deepEqual(ui.nodes().filter((n) => n.type === 'Field').map((n) => n.props.label), ['Nome', 'Conta que paga', 'Categoria dos pagamentos', 'Tipo', 'Cobrança', 'Valor', 'Total de parcelas', 'Parcelas já pagas', 'Primeira parcela']);
  assert.equal(ui.nodes().some((n) => n.type === 'Row' && n.props.title === 'Nome e conta'), false);
  assert.equal(ui.button('Salvar').props.disabled, true);
  ui.fill('Valor', 147000);
  ui.fill('Total de parcelas', '48');
  // A data ancora o cronograma: sem ela a projeção chuta quando o dinheiro sai.
  assert.equal(ui.button('Salvar').props.disabled, true);
  ui.fill('Primeira parcela', '05/12/2026');
  // Tudo preenchido menos o nome: o Salvar segue travado e o campo diz por quê.
  assert.equal(ui.button('Salvar').props.disabled, true);
  assert.equal(ui.nodes().find((n) => n.type === 'Field' && n.props.label === 'Nome').props.error, 'Dê um nome');
  ui.fill('Nome', 'Carro');
  ui.press('Salvar');
  const saved = ui.writes[0].value;
  assert.equal(ui.writes.length, 1);
  assert.equal(saved.name, 'Carro');
  assert.equal(saved.kind, 'financing');
  assert.equal(saved.calculation_mode, 'fixed_installments');
  assert.equal(saved.installments, 48);
  assert.equal(saved.installments_paid, 0);
  assert.equal(saved.installment_cents, 147000);
  assert.equal(saved.principal_cents, 7056000);
  assert.equal(saved.remaining_cents, 7056000);
  assert.equal(saved.interest_rate_monthly, 0);
  assert.equal(saved.due_day, 5);
  assert.equal(saved.first_due_date, '2026-12-05');
  assert.equal(saved.account_id, null);
});

test('"Total a pagar" divides by the count and saves the contract that the check accepts', () => {
  const ui = formDivida();
  ui.fill('Nome', 'Carro');
  ui.interact((nodes) => nodes.find((n) => n.type === 'Segmented' && n.props.options.some((o: any) => o.value === 'total')).props.onChange('total'));
  ui.fill('Valor', 7000000);
  ui.fill('Total de parcelas', '48');
  ui.fill('Primeira parcela', '05/12/2026');
  ui.press('Salvar');
  assert.equal(ui.writes[0].value.installment_cents, 145833);
  assert.equal(ui.writes[0].value.principal_cents, 145833 * 48, 'grava parcela × N, nunca o digitado');
});

test('financiamento com entrada aceita 12 parcelas de um centavo sem comparar parcela com entrada', () => {
  const ui = formDivida();
  ui.fill('Nome', 'Compra pequena');
  ui.fill('Valor', 1);
  ui.fill('Total de parcelas', '12');
  ui.fill('Primeira parcela', '05/12/2026');
  ui.interact((nodes) => nodes.find((n) => n.type === 'DownPaymentFields').props.onEnabled(true));
  ui.interact((nodes) => nodes.find((n) => n.type === 'DownPaymentFields').props.onChange({
    amountCents: 100, dateBR: '01/09/2026', accountId: 'conta-1',
  }));
  ui.press('Salvar');
  assert.equal(ui.writes.length, 1);
  assert.equal(ui.writes[0].value.installment_cents, 1);
  assert.equal(ui.writes[0].value.installments, 12);
  assert.equal(ui.writes[0].value.principal_cents, 12);
  assert.equal(ui.writes[0].value.remaining_cents, 12);
  assert.deepEqual(copia(ui.writes[0].value.down_payment), {
    amount_cents: 100, occurred_at: '2026-09-01', account_id: 'conta-1',
  });
});

test('financiamento com entrada conserva o piso de um centavo por parcela e rejeita valores inválidos', () => {
  for (const fixture of [
    { unidade: 'total', valor: 99, parcelas: '12', podeSalvar: false },
    { unidade: 'total', valor: 100, parcelas: '12', podeSalvar: false },
    { unidade: 'total', valor: 111, parcelas: '12', podeSalvar: false },
    { unidade: 'total', valor: 112, parcelas: '12', podeSalvar: true },
    { unidade: 'parcela', valor: 0, parcelas: '12', podeSalvar: false },
    { unidade: 'parcela', valor: 1, parcelas: '0', podeSalvar: false },
    { unidade: 'parcela', valor: 1, parcelas: 'inválida', podeSalvar: false },
  ]) {
    const ui = formDivida();
    ui.fill('Nome', 'Compra pequena');
    ui.interact((nodes) => nodes.find((n) => n.type === 'Segmented' && n.props.options.some((o: any) => o.value === 'total')).props.onChange(fixture.unidade));
    ui.fill('Valor', fixture.valor);
    ui.fill('Total de parcelas', fixture.parcelas);
    ui.fill('Primeira parcela', '05/12/2026');
    ui.interact((nodes) => nodes.find((n) => n.type === 'DownPaymentFields').props.onEnabled(true));
    ui.interact((nodes) => nodes.find((n) => n.type === 'DownPaymentFields').props.onChange({
      amountCents: 100, dateBR: '01/09/2026', accountId: 'conta-1',
    }));
    assert.equal(!ui.button('Salvar').props.disabled, fixture.podeSalvar, JSON.stringify(fixture));
    if (fixture.podeSalvar) ui.press('Salvar');
    else ui.interact(() => ui.button('Salvar').props.onPress());
    assert.equal(ui.writes.length, Number(fixture.podeSalvar), 'o handler também protege os dados inválidos');
    if (fixture.podeSalvar) assert.equal(ui.writes[0].value.principal_cents, 12);
  }
});

test('paid history moves the anchor: the date asked is the NEXT one, and the first is derived', () => {
  const ui = formDivida();
  ui.fill('Nome', 'Carro');
  ui.fill('Valor', 147000);
  ui.fill('Total de parcelas', '48');
  ui.fill('Parcelas já pagas', '8');
  ui.fill('Próxima parcela (a 9ª)', '05/10/2026');
  // sem conta que paga, a 8ª (05/09) fica só contada, sem pergunta
  ui.press('Salvar');
  assert.equal(ui.writes[0].value.installments_paid, 8);
  assert.equal(ui.writes[0].value.remaining_cents, 5880000);
  assert.equal(ui.writes[0].value.principal_cents, 7056000);
  assert.equal(ui.writes[0].value.first_due_date, '2026-02-05');
});

test('history above the contract total settles on the total instead of blocking (22/09/2026)', () => {
  const ui = formDivida();
  ui.fill('Nome', 'Carro');
  ui.fill('Valor', 147000);
  ui.fill('Total de parcelas', '48');
  ui.fill('Parcelas já pagas', '49');
  ui.fill('Próxima parcela (a 49ª)', '05/10/2026');
  ui.press('Salvar');
  assert.equal(ui.writes[0].value.installments_paid, 48, 'nunca mais pagas que o contrato');
  assert.equal(ui.writes[0].value.installments, 48);
});

const carro = {
  id: 'd1', name: 'Carro', kind: 'financing', calculation_mode: 'fixed_installments',
  principal_cents: 7056000, remaining_cents: 5880000, interest_rate_monthly: 0, installments: 48,
  installments_paid: 8, installment_cents: 147000, account_id: null, due_day: 5, archived: false,
  first_due_date: '2026-02-05',
  edit_revision: 0, updated_at: 'v1',
};

test('Dívidas: Editar e "Nova dívida" abrem o formulário único, e a dívida diz se tem passado', () => {
  const ui = screen(debtsFile, { debts: [carro, { ...carro, id: 'd2', name: 'Moto', installments_paid: 0 }] });
  const editarA = (i: number) => {
    ui.interact((nodes: any[]) => nodes.filter((n) => (n.type === 'Pressable' || n.type === 'PressableScale') && n.props.onLongPress)[i].props.onLongPress());
    ui.interact(() => ui.actions.findLast((a: any) => a.label === 'Editar').onPress());
    return copia(ui.navigations.at(-1));
  };
  assert.deepEqual(editarA(0), { pathname: '/finance/lancar', params: { tipo: 'financiamento', id: 'd1', origem: 'divida', passado: '1' } });
  assert.deepEqual(editarA(1).params.passado, '0', 'nenhuma parcela paga: sem passado');
  ui.press('Nova dívida');
  assert.deepEqual(copia(ui.navigations.at(-1)), { pathname: '/finance/lancar', params: { tipo: 'financiamento' } });
  assert.equal(ui.nodes().some((n: any) => n.type === 'FormularioDaDivida' || n.type?.name === 'FormularioDaDivida'), false, 'a folha de formulário saiu');
});

test('editing the paid count keeps the contract calendar: the next date follows the anchor', () => {
  const ui = editarDivida({ debts: [carro] });
  ui.fill('Parcelas já pagas', '10');
  const data = ui.nodes().find((n) => n.type === 'Field' && n.props.label === 'Próxima parcela (a 11ª)');
  assert.ok(data, 'o rótulo segue as pagas');
  ui.press('Salvar');
  // "parcelas já pagas" vale para o contrato inteiro: a escolha de alcance não muda nada, não pergunta
  assert.ok(!ui.actions.some((a: any) => a.label === 'Todas'));
  const saved = ui.writes[0].value;
  assert.equal(saved.debtId, 'd1');
  assert.equal(saved.scope, 'future');
  assert.equal(saved.patch.installments_paid, 10);
  assert.equal(saved.patch.remaining_cents, 147000 * 38);
  assert.equal('first_due_date' in saved.patch, false);
});

test('na ficha da dívida o Salvar pergunta só próximas ou todas: não há "esta" (28/09/2026)', () => {
  const ui = editarDivida({ debts: [carro],
    debtSchedule: [{ installment_no: 9, due_date: '2026-10-05', payment_cents: 147000 }] });
  ui.fill('Valor', 150000);
  ui.press('Salvar');
  assert.equal(ui.writes.length, 0);
  assert.ok(!ui.actions.some((a: any) => a.label === 'Só esta parcela'), 'a ficha é o contrato, não uma parcela');
  ui.interact(() => ui.actions.find((a: any) => a.label === 'Esta e próximas').onPress());
  assert.deepEqual(copia(ui.writes[0]), {
    operation: 'saveDebtContractScoped',
    value: { debtId: 'd1', anchorNo: 9, scope: 'future',
      patch: { installment_cents: 150000 }, debtRevision: 0, paymentVersions: {},
      requestId: '00000000-0000-4000-8000-000000000002' },
  });
});

test('last-day choice from debt editor carries the due-day rule to future installments', () => {
  const ui = editarDivida({ debts: [carro],
    debtSchedule: [{ installment_no: 9, due_date: '2026-10-05', payment_cents: 147000 }] });
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'DatePickerField').props.onSelectLastDay('31/10/2026'));
  ui.press('Salvar');
  ui.interact(() => ui.actions.find((a: any) => a.label === 'Esta e próximas').onPress());
  assert.equal(ui.writes[0].value.scope, 'future');
  assert.equal(ui.writes[0].value.patch.due_day, -1);
  assert.ok(ui.writes[0].value.patch.first_due_date);
});

test('unchanged debt Save closes without asking and without writing', () => {
  const ui = editarDivida({ debts: [carro],
    debtSchedule: [{ installment_no: 9, due_date: '2026-10-05', payment_cents: 147000 }] });
  ui.press('Salvar');
  assert.ok(!ui.actions.some((a: any) => a.label === 'Todas'), 'nada mudou: nada a perguntar');
  assert.equal(ui.writes.length, 0);
});

test('long press on an active debt offers the full set, including delete for good', () => {
  const ui = screen(debtsFile, { debts: [carro] });
  ui.interact((nodes: any[]) => nodes.find((n) => (n.type === 'Pressable' || n.type === 'PressableScale') && n.props.onLongPress).props.onLongPress());
  assert.deepEqual(ui.actions.map((a: any) => a.label), ['Pagar parcela', 'Ver as parcelas', 'Lembrar', 'Pausar pagamentos…', 'Editar', 'Arquivar', 'Apagar por completo']);
});

test('Dívida: o menu oferece "Lembrar" e abre o formulário em modo conta', () => {
  const ui = screen(debtsFile, { debts: [carro] });
  ui.interact((nodes: any[]) => nodes.find((n) => (n.type === 'Pressable' || n.type === 'PressableScale') && n.props.onLongPress).props.onLongPress());
  ui.interact(() => ui.actions.find((a: any) => a.label === 'Lembrar').onPress());
  assert.deepEqual(copia(ui.navigations.at(-1)),
    { pathname: '/reminder-form', params: { conta: `debt_id:${carro.id}`, nome: carro.name } });
});

test('Dívida com lembrete: a ação vira "Editar lembrete"', () => {
  const ui = screen(debtsFile, { debts: [carro], billReminders: [{ alvo: { debt_id: carro.id }, title: carro.name, channel: 'push', avisos: [{ days_before: 0, at_time: '09:00' }], next_due: null }] });
  ui.interact((nodes: any[]) => nodes.find((n) => (n.type === 'Pressable' || n.type === 'PressableScale') && n.props.onLongPress).props.onLongPress());
  assert.ok(ui.actions.some((a: any) => a.label === 'Editar lembrete'));
});

test('Lançamento: sem "Lembrar" em pagamento de dívida, de fatura e juro do Pix; com ele no pendente', () => {
  const base = { kind: 'expense', status: 'pending', amount_cents: 500, description: 'Conta', category: 'x', account_id: 'a',
    counterparty_account_id: null, occurred_at: '2026-10-02', created_at: '2026-10-02T12:00:00Z', invoice_id: null,
    installment_plan_id: null, recurring_id: null, debt_id: null, pays_invoice_id: null, pix_fee_for_transaction_id: null };
  const rotulos = (extra: object) => {
    const ui = screen('src/app/finance/[txId].tsx', { txs: [{ id: 't', ...base, ...extra }], params: { txId: 't' } });
    return ui.nodes().find((n: any) => n.type === 'HeaderActions').props.menu.actions.map((a: any) => a.label);
  };
  assert.ok(rotulos({}).includes('Lembrar'));
  for (const extra of [{ debt_id: 'd' }, { pays_invoice_id: 'f' }, { pix_fee_for_transaction_id: 'p' }]) {
    assert.ok(!rotulos(extra).some((l: string) => l.startsWith('Lembrar') || l === 'Editar lembrete'), JSON.stringify(extra));
  }
});

test('Lançamento à vista no cartão: "Lembrar da fatura" aponta para a fatura', () => {
  const tx = { id: 't', kind: 'expense', status: 'cleared', amount_cents: 500, description: 'Compra', category: 'x', account_id: 'a',
    counterparty_account_id: null, occurred_at: '2026-10-02', created_at: '2026-10-02T12:00:00Z', invoice_id: 'f1',
    installment_plan_id: null, recurring_id: null, debt_id: null, pays_invoice_id: null, pix_fee_for_transaction_id: null };
  const ui = screen('src/app/finance/[txId].tsx', { txs: [tx], params: { txId: 't' } });
  const acao = ui.nodes().find((n: any) => n.type === 'HeaderActions').props.menu.actions.find((a: any) => a.label === 'Lembrar da fatura');
  ui.interact(() => acao.onPress());
  assert.equal(copia(ui.navigations.at(-1)).params.conta, 'invoice_id:f1');
});

test('archived debts have a place to come back from', () => {
  const ui = screen(debtsFile, { create: false, debts: [carro], archivedDebts: [{ ...carro, id: 'd2', name: 'Moto', archived: true }] });
  const linha = ui.nodes().find((n) => n.type === 'Row' && n.props.title === 'Arquivadas · 1');
  assert.ok(linha, 'a seção das arquivadas existe');
  ui.interact(() => linha.props.onPress());
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'Row' && n.props.title === 'Moto').props.onPress());
  assert.deepEqual(ui.actions.map((a: any) => a.label), ['Desarquivar', 'Apagar por completo']);
  ui.interact(() => ui.actions[0].onPress());
  assert.deepEqual(ui.writes.at(-1), { operation: 'unarchiveDebt', value: 'd2' });
});

/** O texto de um aviso, que pode vir com o nome em `<Forte>` (25/09/2026). */
const textoDo = (n: any): string =>
  typeof n === 'string' || typeof n === 'number'
    ? String(n)
    : Array.isArray(n)
      ? n.map(textoDo).join('')
      : n?.props?.children !== undefined
        ? textoDo(n.props.children)
        : '';

test('"Desfazer"/Desarquivar de uma dívida que já não existe não diz que ela voltou', () => {
  const ui = screen(debtsFile, { create: false, debts: [carro], archivedDebts: [{ ...carro, id: 'd2', name: 'Moto', archived: true }] });
  ui.interact(() => ui.nodes().find((n) => n.type === 'Row' && n.props.title === 'Arquivadas · 1').props.onPress());
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'Row' && n.props.title === 'Moto').props.onPress());
  ui.interact(() => ui.actions[0].onPress());
  ui.interact(() => ui.pedidos.at(-1).opts.onSuccess(false));
  assert.doesNotMatch(textoDo(ui.toasts.at(-1).message), /voltou/);
  assert.match(textoDo(ui.toasts.at(-1).message), /Moto não existe mais/);
  ui.interact(() => ui.pedidos.at(-1).opts.onSuccess(true));
  assert.match(textoDo(ui.toasts.at(-1).message), /Moto voltou para a lista/);
});

test('salvar a edição manda a versão que foi aberta, e a dívida que mudou no meio vira aviso', () => {
  const ui = editarDivida({ debts: [{ ...carro, updated_at: '2026-09-24T10:00:00.123456+00:00' }] });
  ui.fill('Nome', 'Carro novo');
  ui.press('Salvar');
  assert.equal(ui.writes.length, 0);
  ui.interact(() => ui.actions.find((a: any) => a.label === 'Todas').onPress());
  assert.equal(ui.writes[0].value.patch.name, 'Carro novo');
  assert.equal(ui.writes[0].value.debtRevision, 0);
  ui.interact(() => ui.pedidos.at(-1).opts.onError(Object.assign(new Error('x'), { code: 'VERSAO' })));
  assert.match(ui.toasts.at(-1).message, /mudou enquanto você editava/);
});

test('without archived debts there is no empty "Arquivadas" row', () => {
  const ui = screen(debtsFile, { debts: [carro] });
  assert.equal(ui.nodes().some((n) => n.type === 'Row' && String(n.props.title).startsWith('Arquivadas')), false);
});

test('a ficha da dívida é uma tela: Editar no topo e o resto no "…", com as ações do toque longo', () => {
  // 25/09/2026: era uma folha — abrir uma parcela fechava a ficha e voltar a reabria.
  const lista = screen(debtsFile, { create: false, debts: [carro], params: {} });
  lista.interact((nodes: any[]) => nodes.find((n) => (n.type === 'Pressable' || n.type === 'PressableScale') && n.props.onLongPress).props.onPress());
  assert.deepEqual(copia(lista.navigations.at(-1)), { pathname: '/finance/debts', params: { id: 'd1' } }, 'tocar empilha a ficha');
  const ui = screen(debtsFile, { create: false, debts: [carro], params: { id: 'd1' } });
  const cabeca = ui.nodes().find((n: any) => n.type === 'HeaderActions');
  assert.deepEqual(copia(cabeca.props.actions.map((a: any) => a.label)), ['Editar']);
  // na ficha "Ver as parcelas" sai: é o que já se está vendo
  assert.deepEqual(copia(cabeca.props.menu.actions.map((a: any) => a.label)), ['Lembrar', 'Pausar pagamentos…', 'Arquivar', 'Apagar por completo']);
});

test('detalhe da dívida: a próxima que já venceu diz Atrasada no cartão (05/10/2026)', () => {
  // Hoje do dublê é 08/09: a 9ª de 05/09 venceu. A ficha só dizia "Próxima · 05/09/2026".
  const ui = screen(debtsFile, { create: false, debts: [{ ...carro, installments_paid: 8 }],
    debtSchedule: [{ installment_no: 9, due_date: '2026-09-05', payment_cents: 147000 }], params: { id: 'd1' } });
  assert.ok(ui.nodes().some((n: any) => n.props?.children === 'Atrasada · 05/09/2026'));
  const emDia = screen(debtsFile, { create: false, debts: [{ ...carro, installments_paid: 8 }],
    debtSchedule: [{ installment_no: 9, due_date: '2026-10-05', payment_cents: 147000 }], params: { id: 'd1' } });
  assert.ok(emDia.nodes().some((n: any) => n.props?.children === 'Próxima · 05/10/2026'));
});

test('detalhe da dívida: "A seguir" começa na próxima, 20 por vez, e "Já pagas" vem da mais recente', () => {
  const futuras = Array.from({ length: 30 }, (_, i) => ({
    installment_no: 9 + i, due_date: `${2026 + Math.floor((9 + i) / 12)}-${String(((9 + i) % 12) + 1).padStart(2, '0')}-05`,
    payment_cents: 147000, interest_cents: null, principal_cents: null, balance_cents: 0,
  }));
  const ui = screen(debtsFile, { create: false, debts: [{ ...carro, installments_paid: 8 }], debtSchedule: futuras, params: { id: 'd1' } });
  const linhas = () => ui.nodes().filter((n: any) => n.type === 'DebtTimeline');
  const seguir = () => linhas()[0].props.anos.flatMap((a: any) => a.itens);
  assert.equal(seguir()[0].n, 9, 'a próxima no topo');
  assert.equal(seguir().length, 20, 'só o primeiro passo');
  const pagas = linhas()[1].props.anos.flatMap((a: any) => a.itens);
  assert.deepEqual(JSON.parse(JSON.stringify(pagas.map((i: any) => i.n))), [8, 7, 6, 5, 4, 3, 2, 1], 'a mais recente primeiro');
  const mais = ui.nodes().find((n: any) => n.type === 'VerMais' && n.props.restantes === 10);
  assert.ok(mais, '"Ver mais" com as 10 que faltam');
  ui.interact(() => mais.props.onPress());
  assert.equal(seguir().length, 30);
});

test('detalhe da dívida: juros de R$ 0,00 não viram linha vermelha; juros de verdade continuam', () => {
  const texto = (ui: any) => JSON.stringify(ui.nodes().filter((n: any) => n.type === 'ThemedText').map((n: any) => n.props.children));
  const abrir = (juros: number | null) => {
    const ui = screen(debtsFile, {
      create: false,
      debts: [{ ...carro, calculation_mode: 'amortized', interest_rate_monthly: juros ? 0.0199 : 0 }],
      debtSchedule: [{ installment_no: 9, due_date: '2026-10-05', payment_cents: 147000, interest_cents: juros, principal_cents: 147000, balance_cents: 0 }],
      params: { id: 'd1' },
    });
    return texto(ui);
  };
  assert.doesNotMatch(abrir(0), /são juros/, 'sem juros, nada a avisar');
  assert.match(abrir(29000), /são juros/);
});

test('por onde começar: dívida com juros ZERO diz "sem juros", como a linha dela', () => {
  const moto = { ...carro, id: 'd2', name: 'Moto', calculation_mode: 'amortized', interest_rate_monthly: 0 };
  const ui = screen(debtsFile, {
    create: false,
    debts: [carro, moto],
    payoff: [{ debt_id: 'd2', name: 'Moto', interest_rate_monthly: 0, months_left: 11, remaining_cents: 110000 }],
  });
  const texto = JSON.stringify(ui.nodes().filter((n: any) => n.type === 'ThemedText').map((n: any) => n.props.children));
  assert.doesNotMatch(texto, /juros 0/);
  assert.match(texto, /sem juros/);
});

test('editing the paid count of an OLD debt keeps the date its schedule shows (final review, 23/09/2026)', () => {
  // A dívida antiga não tem âncora: deduzir uma de `schedule[0]` − pagas levaria a data meses para
  // a frente quando a pessoa corrige as pagas (5 → 9), e parcelas sumiriam da projeção.
  const ui = editarDivida({
    debts: [{ ...carro, first_due_date: null, installments_paid: 5, remaining_cents: 147000 * 43 }],
    debtSchedule: [{ installment_no: 6, due_date: '2026-10-05', payment_cents: 147000, interest_cents: null, principal_cents: null, balance_cents: 0 }],
  });
  ui.fill('Parcelas já pagas', '9');
  const campo = ui.nodes().find((n) => n.type === 'DatePickerField');
  assert.equal(campo.props.value, '05/10/2026', 'a data mostrada é a do cronograma, não uma deduzida');
  ui.press('Salvar');
  assert.equal('first_due_date' in ui.writes[0].value.patch, false, 'sem tocar na data, nada de âncora');
  assert.equal(ui.writes[0].value.patch.installments_paid, 9);
});

test('editar com os pagamentos sem carregar diz por que o Salvar não liga, e tenta de novo', () => {
  const ui = editarDivida({ debts: [{ ...carro }], paymentsError: true });
  assert.equal(ui.button('Salvar').props.disabled, true);
  const faixa = ui.nodes().find((n: any) => typeof n.type === 'function' && n.type.name === 'ErrorBand' && /pagamentos/.test(n.props.message));
  assert.ok(faixa, 'a faixa de erro aparece no formulário');
  faixa.props.onRetry();
  assert.ok(ui.refetches.includes('payments'));
});

test('as pagas não descem abaixo da maior parcela já paga pelo app (não só da contagem)', () => {
  // Um "Paguei" lançado como a 5ª: dizer 4 pagas deixaria a 5ª paga aparecendo como futura.
  const ui = editarDivida({ debts: [{ ...carro, installments_paid: 5, remaining_cents: 147000 * 43 }],
    debtPayments: [{ debt_payment_no: 5, occurred_at: '2026-09-05', amount_cents: 147000 }],
  });
  ui.fill('Parcelas já pagas', '4');
  ui.press('Salvar');
  assert.equal(ui.writes.length, 0, 'o piso conserva o valor original e Save não escreve');
});

test('diminuir as pagas com âncora mostra a parcela do CONTRATO, vencida, e diz que venceu (05/10/2026)', () => {
  // 1ª em 05/02/2026 e 9 pagas: a 10ª é 05/11. Corrigir para 5 leva a 6ª a 05/07, que já passou:
  // a data é a do contrato (não desliza para o mês seguinte) e a frase diz que ela venceu.
  const ui = editarDivida({ debts: [{ ...carro, first_due_date: '2026-02-05', installments_paid: 9, remaining_cents: 147000 * 39 }] });
  ui.fill('Parcelas já pagas', '5');
  const campo = ui.nodes().find((n) => n.type === 'DatePickerField');
  assert.equal(campo.props.value, '05/07/2026');
  assert.ok(ui.nodes().some((n: any) => typeof n.props?.children === 'string' && n.props.children.startsWith('Venceu em 05/07 e ainda não foi paga')));
});

test('escolher uma data já vencida mantém a data e avisa que venceu (23/09 com hoje depois)', () => {
  const ui = formDivida();
  ui.fill('Valor', 148500);
  ui.fill('Total de parcelas', '48');
  ui.fill('Parcelas já pagas', '8');
  ui.fill('Próxima parcela (a 9ª)', '05/09/2026');
  assert.equal(ui.nodes().find((n) => n.type === 'DatePickerField').props.value, '05/09/2026', 'não troca a data da pessoa');
  assert.ok(ui.nodes().some((n: any) => typeof n.props?.children === 'string' && n.props.children.startsWith('Venceu em 05/09 e ainda não foi paga')));
});

test('parcela paga que venceu no ciclo atual: pergunta se já saiu da conta e lança uma vez', () => {
  const ciclo = { de: '2026-09-01', ate: '2026-09-30', mes: '2026-09', diasAteOFim: 22 };
  const contas = [{ id: 'cc', name: 'Itaú', type: 'checking' }];
  const comum = { kind: 'expense', descricao: 'Carro', valorCents: 148500, contaId: 'cc', dataBR: '', categoria: null };
  const ui = formDivida({ forecastAccounts: contas, cycle: ciclo, segurarMutacoes: true }, { comum });
  ui.fill('Total de parcelas', '48');
  ui.fill('Parcelas já pagas', '8');
  ui.fill('Próxima parcela (a 9ª)', '05/10/2026');
  const pergunta = ui.nodes().filter((n: any) => n.type === 'Field' && /^A 8ª \(05\/09\) já saiu da conta Itaú\?/.test(n.props.label));
  assert.equal(pergunta.length, 1, 'uma linha por parcela no ciclo, com a conta');
  // com conta escolhida o padrão é Sim: a prévia "Ao salvar" já leva a parcela (o que o Salvar lança)
  const previa = (x: any) => JSON.parse(JSON.stringify(x.nodes().find((n: any) => n.type === 'FinanceWritePreview').props.write));
  assert.deepEqual(previa(ui).args.p_ja_sairam, { accountId: 'cc', numbers: [8] });
  ui.press('Salvar');
  assert.deepEqual(JSON.parse(JSON.stringify(ui.writes.at(-1).value.ja_sairam)), { accountId: 'cc', numbers: [8] });
  // Não: continua só contada
  const nao = formDivida({ forecastAccounts: contas, cycle: ciclo, segurarMutacoes: true }, { comum });
  nao.fill('Total de parcelas', '48');
  nao.fill('Parcelas já pagas', '8');
  nao.fill('Próxima parcela (a 9ª)', '05/10/2026');
  nao.press('Não');
  assert.equal('p_ja_sairam' in previa(nao).args, false, 'Não: a prévia não simula a parcela');
  nao.press('Salvar');
  assert.equal(nao.writes.at(-1).value.ja_sairam, undefined);
  // Pagas de ciclos anteriores não perguntam
  const antes = formDivida({ forecastAccounts: contas, cycle: { ...ciclo, de: '2026-10-01', ate: '2026-10-31' }, segurarMutacoes: true }, { comum });
  antes.fill('Total de parcelas', '48');
  antes.fill('Parcelas já pagas', '8');
  antes.fill('Próxima parcela (a 9ª)', '05/10/2026');
  assert.equal(antes.nodes().some((n: any) => n.type === 'Field' && /já saiu da conta/.test(n.props.label ?? '')), false);
});

test('financiamento COM JUROS também pergunta se a parcela paga do ciclo já saiu da conta (05/10/2026)', () => {
  const ciclo = { de: '2026-09-01', ate: '2026-09-30', mes: '2026-09', diasAteOFim: 22 };
  const contas = [{ id: 'cc', name: 'Itaú', type: 'checking' }];
  const comum = { kind: 'expense', descricao: 'Carro', valorCents: 148500, contaId: 'cc', dataBR: '', categoria: null };
  const ui = formDivida({ forecastAccounts: contas, cycle: ciclo, segurarMutacoes: true }, { comum });
  ui.interact((nodes) => nodes.find((n) => n.type === 'SelectField' && n.props.options.some((o: any) => o.id === 'amortized')).props.onChange('amortized'));
  ui.fill('Quanto você deve hoje', 5000000);
  ui.fill('Valor original', 7000000);
  ui.fill('Juros por mês', '1,99');
  ui.fill('Parcelas que faltam', '40');
  ui.fill('Parcelas já pagas', '8');
  ui.fill('Próxima parcela (a 9ª)', '05/10/2026');
  const pergunta = ui.nodes().filter((n: any) => n.type === 'Field' && /^A 8ª \(05\/09\) já saiu da conta Itaú\?/.test(n.props.label));
  assert.equal(pergunta.length, 1);
  const previa = JSON.parse(JSON.stringify(ui.nodes().find((n: any) => n.type === 'FinanceWritePreview').props.write));
  assert.deepEqual(previa.args.p_ja_sairam, { accountId: 'cc', numbers: [8] });
  ui.press('Salvar');
  assert.deepEqual(JSON.parse(JSON.stringify(ui.writes.at(-1).value.ja_sairam)), { accountId: 'cc', numbers: [8] });
});

test('sem conta que paga não há o que lançar: nada pergunta e o Salvar fica livre (05/10/2026)', () => {
  // Visto no iPhone: "A 8ª (05/10) já saiu da conta sua conta?" travava o Salvar de quem não tem conta.
  const ciclo = { de: '2026-09-01', ate: '2026-09-30', mes: '2026-09', diasAteOFim: 22 };
  const ui = formDivida({ cycle: ciclo, segurarMutacoes: true });
  ui.fill('Nome', 'Carro');
  ui.fill('Valor', 148500);
  ui.fill('Total de parcelas', '48');
  ui.fill('Parcelas já pagas', '8');
  ui.fill('Próxima parcela (a 9ª)', '05/10/2026');
  assert.equal(ui.nodes().some((n: any) => n.type === 'Field' && /já saiu da conta/.test(n.props.label ?? '')), false);
  assert.equal(ui.button('Salvar').props.disabled, false);
  ui.press('Salvar');
  assert.equal(ui.writes.at(-1).value.ja_sairam, undefined, 'as pagas ficam só contadas');
});

test('tocar no dia 28 de fevereiro escolhe dia fixo, e a ação explícita preserva fim do mês', () => {
  const ui = editarDivida({ debts: [{ ...carro, due_day: 31, first_due_date: '2026-01-31', installments_paid: 1, remaining_cents: 147000 * 47 }] });
  ui.fill('Próxima parcela (a 2ª)', '28/02/2026');
  ui.press('Salvar');
  ui.interact(() => ui.actions.find((a: any) => a.label === 'Esta e próximas').onPress());
  assert.equal(ui.writes[0].value.patch.due_day, 28, 'tocar 28 é escolher 28 fixo');

  const ultimo = editarDivida({ debts: [{ ...carro, due_day: 31, first_due_date: '2026-01-31', installments_paid: 1, remaining_cents: 147000 * 47 }] });
  ultimo.interact((nodes: any[]) => nodes.find((n) => n.type === 'DatePickerField').props.onSelectLastDay('28/02/2026'));
  ultimo.press('Salvar');
  ultimo.interact(() => ultimo.actions.find((a: any) => a.label === 'Esta e próximas').onPress());
  assert.equal(ultimo.writes[0].value.patch.due_day, -1);
});

test('editing an OLD debt without its schedule loaded never invents an anchor', () => {
  const ui = editarDivida({ debts: [{ ...carro, first_due_date: null }] });
  ui.fill('Nome', 'Carro novo');
  ui.press('Salvar');
  ui.interact(() => ui.actions.find((a: any) => a.label === 'Todas').onPress());
  assert.equal(ui.writes[0].value.patch.name, 'Carro novo');
  assert.equal('first_due_date' in ui.writes[0].value.patch, false);
  assert.equal('due_day' in ui.writes[0].value.patch, false);
});

test('detailed mode still exposes the financial inputs', () => {
  const ui = formDivida();
  ui.interact((nodes) => nodes.find((n) => n.type === 'SelectField' && n.props.options.some((o: any) => o.id === 'amortized')).props.onChange('amortized'));
  const labels = ui.nodes().filter((n) => n.type === 'Field').map((n) => n.props.label);
  for (const label of ['Nome', 'Quanto você deve hoje', 'Valor original', 'Juros por mês']) assert.ok(labels.includes(label), label);
  assert.equal(ui.button('Salvar').props.disabled, true);
});

test('a debt without installments has no cadence, so it never demands a due day', () => {
  // "Devo 500 pro João": exigir dia de vencimento aqui travaria o cadastro por
  // um dado que o contrato não tem. A trava vale só para contrato com parcelas.
  // O formulário único nasce em financiamento, que exige parcelas: "Devo 500 pro João" é empréstimo.
  const ui = formDivida();
  ui.interact((nodes) => nodes.find((n) => n.type === 'SelectField' && n.props.options.some((o: any) => o.id === 'amortized')).props.onChange('amortized'));
  ui.interact((nodes) => nodes.find((n) => n.type === 'SelectField' && n.props.options.some((o: any) => o.id === 'loan')).props.onChange('loan'));
  ui.fill('Nome', 'João');
  ui.fill('Quanto você deve hoje', 50000);
  ui.fill('Juros por mês', '0');
  ui.press('Salvar');
  assert.equal(ui.writes[0].value.due_day, null);
  assert.equal(ui.writes[0].value.remaining_cents, 50000);
});

test('link antigo de Dívidas e Recorrentes (`?create=`, `?edit=`) abre o formulário único no lugar da lista', () => {
  // A lista não fica por baixo: fechar o formulário devolve para quem abriu o link (15/09/2026,
  // *"ao invés de voltar para a tela onde eu estava, ele me leva para a tela de Parceladas"*).
  const redirect = (file: string, params: Record<string, string>) =>
    copia(screen(file, { params, debts: [carro] }).nodes().find((n: any) => n.type === 'Redirect')?.props.href);
  assert.deepEqual(redirect(debtsFile, { create: 'financing', de: 'novo-lancamento', deHipotese: 'f', parcela: '147000' }),
    { pathname: '/finance/lancar', params: { tipo: 'financiamento', deHipotese: 'f', parcela: '147000' } });
  assert.deepEqual(redirect(debtsFile, { id: 'd1', edit: '1' }), { pathname: '/finance/lancar', params: { tipo: 'financiamento', id: 'd1', origem: 'divida' } });
  assert.deepEqual(redirect('src/app/finance/recurring.tsx', { create: '1', kind: 'income', amount: '5000' }),
    { pathname: '/finance/lancar', params: { tipo: 'recorrente', kind: 'income', amount: '5000' } });
  // a série não sabe se tem passado: sem `passado`, o hospedeiro assume que tem
  assert.deepEqual(redirect('src/app/finance/recurring.tsx', { edit: 'rec-1' }), { pathname: '/finance/lancar', params: { tipo: 'recorrente', id: 'rec-1', origem: 'serie' } });
  // a ficha sem `edit` continua a ficha
  assert.equal(screen(debtsFile, { params: { id: 'd1' }, debts: [carro] }).nodes().some((n: any) => n.type === 'Redirect'), false);
});

test('aberto por link, como a primeira tela da pilha, fechar o formulário fica na lista', () => {
  // Deep link (notificação) abre a lista já com o sheet: não há tela atrás, e o `back` virava
  // "The action 'GO_BACK' was not handled" (visto no s26 em 26/09/2026).
  const ui = screen('src/app/finance/accounts.tsx', { params: { create: '1' }, primeiraDaPilha: true });
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'TaskHeader').props.onClose());
  assert.deepEqual(ui.navigations, []);
});

test('e quem abriu o formulário PELA PRÓPRIA tela continua nela', () => {
  // O espelho do caso acima, e o que quebra se alguém marcar "veio de fora" sem condição:
  // fechar levaria a pessoa para fora de uma lista que ela abriu de propósito.
  const ui = screen('src/app/finance/accounts.tsx', { params: {} });
  ui.press('Nova conta');
  ui.interact((nodes) => nodes.find((n) => n.type === 'TaskHeader').props.onClose());
  assert.deepEqual(ui.navigations, []);
});

test('na ficha da dívida, pagar e fechar a folha fica na ficha — nada de voltar sozinho', () => {
  // A ficha é a tela (`?id=`): quem chegou de fora volta pelo "voltar" dela, não por fechar a folha.
  const ui = screen(debtsFile, {
    create: false, debts: [carro], params: { id: 'd1' },
    debtSchedule: [{ installment_no: 9, due_date: '2026-10-05', payment_cents: 147000, interest_cents: null, principal_cents: null, balance_cents: 0 }],
  });
  ui.press('Paguei esta parcela');
  ui.interact((nodes) => nodes.find((n) => n.type === 'TaskHeader' && /^Pagar/.test(n.props.title)).props.onClose());
  assert.deepEqual(ui.navigations, []);
  assert.ok(ui.nodes().some((n: any) => n.type === 'DebtTimeline'), 'a ficha continua na tela');
});

test('editing a legacy amortized financing preserves its mode and remaining-term semantics', () => {
  const ui = editarDivida({ debts: [{ id: 'old-debt', name: 'Carro', kind: 'financing', calculation_mode: 'amortized', principal_cents: 7056000, remaining_cents: 5880000, installments: 48, installments_paid: 8, installment_cents: 147000, interest_rate_monthly: 0.0199, account_id: null, due_day: 10 }] });
  assert.ok(ui.nodes().some((n) => n.type === 'Field' && n.props.label === 'Juros por mês'));
  // O modo também se edita (26/09/2026) — e abre no modo que a dívida tem.
  const modo = ui.nodes().find((n) => n.type === 'SelectField' && n.props.options.some((o: any) => o.id === 'amortized'));
  assert.equal(modo?.props.value, 'amortized');
  ui.interact(() => modo.props.onChange('amortized'));
  ui.press('Salvar');
  assert.equal(ui.writes.length, 0, 'sem mudar campos, o contrato existente fica intacto');
});

test('trocar cobrança de financiamento existente salva o modo e conserva o prazo restante', () => {
  for (const from of ['fixed_installments', 'amortized']) {
    const to = from === 'amortized' ? 'fixed_installments' : 'amortized';
    const ui = editarDivida({ debts: [{ ...carro, calculation_mode: from, interest_rate_monthly: 0 }] });
    ui.interact((nodes) => nodes.find((n) => n.type === 'SelectField' && n.props.options.some((o: any) => o.id === 'amortized')).props.onChange(to));
    ui.press('Salvar');
    assert.equal(ui.writes.length, 1, `${from} → ${to} grava o contrato existente`);
    assert.equal(ui.writes[0].operation, 'saveDebtContractScoped');
    assert.equal(ui.writes[0].value.debtId, carro.id);
    assert.equal(ui.writes[0].value.scope, 'future');
    assert.equal(ui.writes[0].value.patch.calculation_mode, to);
    assert.equal(ui.writes[0].value.anchorNo, 9);
    assert.equal(ui.toasts.some((t: any) => t.tone === 'error'), false);
  }
});

test('trocar cobrança e valor com pagamento registrado não oferece reescrever o passado', () => {
  const ui = editarDivida({ debts: [{ ...carro, calculation_mode: 'amortized', interest_rate_monthly: 0 }],
    debtPayments: [{ id: 'p1', debt_payment_no: 8, edit_revision: 2, amount_cents: 147000 }] });
  ui.interact((nodes) => nodes.find((n) => n.type === 'SelectField' && n.props.options.some((o: any) => o.id === 'amortized')).props.onChange('fixed_installments'));
  ui.fill('Valor', 150000);
  ui.press('Salvar');
  assert.equal(ui.actions.some((a: any) => a.label === 'Todas'), false);
  assert.equal(ui.writes.length, 1);
  assert.equal(ui.writes[0].value.scope, 'future');
  assert.equal(ui.writes[0].value.patch.calculation_mode, 'fixed_installments');
  assert.equal(ui.writes[0].value.patch.installment_cents, 150000);
  assert.equal('principal_cents' in ui.writes[0].value.patch, false, 'banco deriva parcela × prazo');
  assert.deepEqual(copia(ui.writes[0].value.paymentVersions), { p1: 2 });
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

test('Fatura: tudo que se faz com ela se desfaz — pagamento, quitar à mão e adiar', () => {
  // 26/09/2026: "tudo que se cria se edita". O pagamento abre no lançamento (editar/apagar refaz a
  // fatura no banco); quitar à mão e adiar ganham o desfazer no menu.
  const menu = (ui: any) => ui.nodes().find((n: any) => n.type === 'HeaderActions').props.menu.actions;
  const rotulos = (ui: any) => menu(ui).map((a: any) => a.label);

  const paga = screen('src/app/finance/invoice/[id].tsx', { invoiceStatus: 'paid', pagamentos: [{ id: 'pg-1', amount_cents: 147000, occurred_at: '2026-08-18', account_id: 'cc' }] });
  assert.ok(rotulos(paga).includes('Ver o pagamento') && !rotulos(paga).includes('Marcar como paga') && !rotulos(paga).includes('Desmarcar como paga'));
  menu(paga).find((a: any) => a.label === 'Ver o pagamento').onPress();
  assert.deepEqual(JSON.parse(JSON.stringify(paga.navigations.at(-1))), { pathname: '/finance/[txId]', params: { txId: 'pg-1', month: '2026-08' } });

  const quitada = screen('src/app/finance/invoice/[id].tsx', { invoiceStatus: 'paid', settledManually: true });
  menu(quitada).find((a: any) => a.label === 'Desmarcar como paga').onPress();
  assert.equal(quitada.writes.length, 0, 'confirma antes');
  quitada.confirmations[0]();
  assert.equal(quitada.writes[0].operation, 'unsettleInvoice');
  assert.equal(quitada.writes[0].value, 'invoice-1');

  const adiada = screen('src/app/finance/invoice/[id].tsx', { invoiceStatus: 'rolled' });
  assert.ok(!rotulos(adiada).includes('Marcar como paga'));
  menu(adiada).find((a: any) => a.label === 'Desfazer adiamento').onPress();
  adiada.confirmations[0]();
  assert.equal(adiada.writes[0].operation, 'unrollInvoice');
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

test('Lançamentos abre julho pelo mês civil para incluir um vencimento de 31/07 em julho', () => {
  const ui = screen(transacoesFile, { params: { month: '2026-07' } });
  assert.deepEqual(ui.rulerViews, ['civil']);
  assert.equal(ui.nodes().find((n: any) => n.type === 'PeriodBar')?.props.ruler.view, 'civil');
  assert.deepEqual(screen('src/app/finance/forecast.tsx').rulerViews, ['cycle'],
    'a escolha inicial de Lançamentos não altera a régua da Projeção');
});

test('Lançamentos mantém Lançar no header sem cobrir a recorrência calculada', () => {
  const ui = screen(transacoesFile, {
    params: { month: '2026-07' },
    txs: [],
    expectedLines: [{
      origin: 'recurring', ref_id: 'internet', due_date: '2026-07-31',
      amount_cents: 12000, kind: 'expense', description: 'Internet', category: null,
      account_id: null, installment_no: null, installments_total: null, inferred_start: false,
    }],
  });
  const action = ui.nodes().find((n: any) => n.type === 'HeaderActions')?.props.actions
    .find((entry: any) => entry.label === 'Lançar');
  assert.equal(action?.icon, 'plus');
});

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

const assinaturaPrevista = {
  origin: 'recurring', ref_id: 'series', due_date: '2026-09-10',
  amount_cents: 5590, kind: 'expense', description: 'Assinatura', category: null,
  account_id: null, installment_no: null, installments_total: null, inferred_start: false,
};

test('Lançamentos: a prevista mora na lista, no dia dela, e o toque a abre (28/09/2026)', () => {
  const ui = screen(transacoesFile, { txs: [], expectedLines: [assinaturaPrevista] });
  const linha = ui.nodes().find((n: any) => n.type === 'LinhaPrevista');
  assert.equal(linha?.props.line.ref_id, 'series', 'a prevista é uma linha da lista, não um bloco à parte');
  linha.props.onAbrir();
  assert.deepEqual(ui.refetches, ['abrir:series']);
});

test('Lançamentos mostra a falha na leitura dos registros reais, mesmo com previstas', () => {
  const ui = screen(transacoesFile, { txs: [], expectedLines: [assinaturaPrevista], listError: true });
  assert.ok(!ui.nodes().some((n: any) => n.type === 'LinhaPrevista'),
    'uma lista só de previstas esconderia que os lançamentos não vieram');
  const error = ui.nodes().find((n: any) => n.type === 'ErrorCard');
  assert.ok(error, 'a previsão não deve esconder o erro dos lançamentos gravados');
  error.props.onRetry();
  assert.deepEqual(ui.refetches, ['list']);
});

test('Lançamentos mostra só uma falha quando a consulta das previsões falha', () => {
  const ui = screen(transacoesFile, { txs: [], expectedError: true });
  assert.equal(tipos(ui).filter((type: string) => type === 'ErrorCard').length, 1);
  assert.ok(!tipos(ui).includes('EmptyState'));
  ui.nodes().find((n: any) => n.type === 'ErrorCard').props.onRetry();
  assert.deepEqual(ui.refetches, ['expected']);
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
  const ui = screen(financeiroFile, { rangePending: true });
  const t = tipos(ui);
  const hero = ui.nodes().find((n: any) => n.type === 'HeroPanel');
  assert.ok(hero, 'o cartão permanece montado durante a troca');
  assert.equal(hero.props.value.type, 'Skeleton', 'o valor ainda não confirmado fica oculto');
  assert.equal(hero.props.onPress, undefined, 'ações do período aguardam os dados');
  assert.ok(!t.includes('ErrorCard'), 'buscando não é falha');
});

test('Financeiro: o portão é a PRIMEIRA DOBRA — resumo, mês anterior e blocos de baixo não seguram a tela', () => {
  // 06/10/2026: o portão esperava 14 consultas, e a mais lenta decidia a primeira pintura. O herói
  // lê ciclo, bordas, série e curva; o resumo por categoria e o mês anterior são da rosca (abaixo).
  const anteriorChegando = screen(financeiroFile, { rangePendingMonths: ['2026-08'] });
  assert.equal(telaPronta(...anteriorChegando.gates.at(-1)!), true, 'o range do mês anterior não segura a tela');
  const resumoChegando = screen(financeiroFile, { resumoPendente: true });
  assert.equal(telaPronta(...resumoChegando.gates.at(-1)!), true, 'o resumo buscando não segura a tela');
  const heroSemEsqueleto = resumoChegando.nodes().find((n: any) => n.type === 'HeroPanel');
  assert.ok(heroSemEsqueleto && heroSemEsqueleto.props.value.type !== 'Skeleton', 'o herói não espera o resumo');
  // A rosca pode não existir depois de carregar (mês sem gasto): bloco assim não desenha esqueleto (§7).
  assert.ok(!tipos(resumoChegando).includes('SkeletonChart'), 'bloco que pode sumir não promete conteúdo');
  // E o que desenha o topo continua segurando: sem as bordas do mês corrente a tela espera.
  const bordasChegando = screen(financeiroFile, { rangePending: true });
  assert.equal(telaPronta(...bordasChegando.gates.at(-1)!), false, 'as bordas do mês exibido seguram a primeira pintura');
  const tudoPronto = screen(financeiroFile);
  assert.equal(telaPronta(...tudoPronto.gates.at(-1)!), true, 'sem este, os de cima não distinguiriam nada');
});

test('Financeiro: o resumo falhando mostra o erro no BLOCO dele; o herói segue de pé', () => {
  const ui = screen(financeiroFile, { resumoErro: true });
  assert.ok(ui.nodes().some((n: any) => n.type === 'HeroPanel'), 'o herói não depende do resumo');
  const erro = ui.nodes().find((n: any) => n.type === 'ErrorCard');
  assert.ok(erro, 'cada seção tem o seu erro (§7)');
  erro.props.onRetry();
  assert.ok(ui.refetches.includes('summary'), 'o "Tentar de novo" refaz o resumo');
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

test('Hoje: o portão é a primeira dobra — as notas (último bloco) chegando não seguram a tela', () => {
  const ui = screen(hojeFile, { notesPending: true });
  assert.equal(telaPronta(...ui.gates.at(-1)!), true, 'notas e pastas não entram no portão');
  assert.ok(ui.nodes().some((n: any) => n.type === 'SemanaDoDia'), 'o topo já está na tela');
  assert.ok(!ui.nodes().some((n: any) => n.type === 'NotasDaHoje'), 'o bloco de notas espera, sem inventar conteúdo');
  const falha = screen(hojeFile, { notesError: true });
  assert.ok(falha.nodes().some((n: any) => n.type === 'ErrorCard'), 'a falha das notas aparece no bloco delas');
});

test('Hoje: o atrasado aparece no Seu dia e o botão dá baixa no lançamento certo, depois de confirmar o valor', () => {
  const ui = screen(hojeFile, {
    bills: [{ ref_id: 'luz-1', title: 'Luz', due_date: '2026-09-01', amount_cents: 21000, kind: 'transaction', overdue: true }],
    txs: [{ id: 'luz-1', kind: 'expense', amount_cents: 21000, description: 'Luz', status: 'pending', recurring_id: null, installment_plan_id: null }],
  });
  const item = agendaItem(ui, 'Luz');
  assert.ok(item, 'a conta atrasada precisa estar na tela');
  assert.equal(item.props.meta, 'venceu 01/09');
  ui.interact(() => item.props.action.onPress());
  assert.equal(ui.writes.length, 0, 'abre a confirmação, não dá baixa direto');
  ui.press('Paguei');
  assert.deepEqual(ui.writes.map((w) => w.operation), ['confirmPaymentScoped']);
  assert.equal(ui.writes[0].value.id, 'luz-1');
});

test('Hoje: "Recebi" pergunta quanto ENTROU; numa série, outro valor pode valer para as próximas', () => {
  const ui = screen(hojeFile, {
    bills: [{ ref_id: 'sal-1', title: 'Salário', due_date: '2026-09-05', amount_cents: 400000, kind: 'income', overdue: true }],
    txs: [{ id: 'sal-1', kind: 'income', amount_cents: 400000, description: 'Salário', status: 'pending', recurring_id: 'rec-1', installment_plan_id: null }],
  });
  ui.interact(() => agendaItem(ui, 'Salário').props.action.onPress());
  assert.ok(ui.nodes().some((n: any) => n.type === 'Field' && n.props.label === 'Quanto entrou'));
  assert.ok(!ui.nodes().some((n: any) => n.type === 'SwitchRow'), 'com o valor previsto não há o que propagar');
  ui.interact((nodes) => nodes.find((n: any) => n.type === 'MoneyField').props.onChangeCents(410000));
  const chave = ui.nodes().find((n: any) => n.type === 'SwitchRow');
  assert.equal(chave?.props.label, 'Usar este valor nas próximas');
  ui.interact(() => chave.props.onValueChange(true));
  ui.press('Recebi');
  assert.equal(ui.writes[0].operation, 'confirmPaymentScoped');
  assert.equal(ui.writes[0].value.id, 'sal-1');
  assert.equal(ui.writes[0].value.scope, 'future');
  assert.equal(ui.writes[0].value.amountCents, 410000);
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
  assert.equal(item.props.action, undefined, 'nos próximos dias a linha só abre — "Ver fatura" em toda compra era ruído');
  item.props.onPress();
  // `foco` leva a compra: a fatura abre inteira, rolada até ela e com ela acesa.
  assert.deepEqual(copia(ui.navigations.at(-1)), { pathname: '/finance/invoice/[id]', params: { id: 'f-9', foco: 'c-1' } });
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

const passoImportar = { id: 'importar', titulo: 'Traga sua fatura', acao: 'Importar fatura', icon: 'square.and.arrow.down', href: '/import?conta=c1' };

test('Hoje: o Próximo passo espera os Primeiros passos acabarem', () => {
  const ui = screen(hojeFile, {
    setupPassos: [{ id: 'whatsapp', titulo: 'Ligar o WhatsApp', feito: false, href: '/link-phone' }],
    proximo: passoImportar,
  });
  assert.ok(!tipos(ui).includes('ProximoPassoCard'), 'um card de descoberta por vez');
});

test('Hoje: com os Primeiros passos feitos aparece o Próximo passo, e ele leva ao lugar', () => {
  const ui = screen(hojeFile, {
    setupPassos: [{ id: 'whatsapp', titulo: 'Ligar o WhatsApp', feito: true, href: '/link-phone' }],
    proximo: passoImportar,
  });
  const card = ui.nodes().find((n: any) => n.type === 'ProximoPassoCard');
  assert.ok(card, 'o card do próximo passo aparece');
  card.props.onAbrir();
  assert.equal(ui.navigations.at(-1), '/import?conta=c1');
  card.props.onDispensar();
  assert.deepEqual(ui.writes.at(-1), { operation: 'dispensarProximo', value: 'importar' });
});

test('Hoje: falha nas contas mostra o erro no Seu dia, e o "Tentar de novo" refaz as contas', () => {
  const ui = screen(hojeFile, { billsError: true });
  const erro = ui.nodes().find((n: any) => n.type === 'ErrorCard');
  assert.ok(erro, 'seção que falha diz que falhou (§7)');
  erro.props.onRetry();
  assert.ok(ui.refetches.includes('bills'));
  assert.ok(!diaVazio(ui), 'sem resposta das contas a tela não afirma que o dia está livre');
});

const diaVazio = (ui: ReturnType<typeof screen>) =>
  ui.nodes().some((n: any) => n.type === 'EmptyState' && n.props.title === 'Nada para hoje');

test('Hoje: dia sem nada diz "Nada para hoje" num vazio COMPACTO — o resto da tela continua embaixo', () => {
  const ui = screen(hojeFile, {});
  assert.ok(!tipos(ui).includes('AgendaItem'));
  const vazio = ui.nodes().find((n: any) => n.type === 'EmptyState');
  assert.equal(vazio.props.title, 'Nada para hoje');
  assert.equal(vazio.props.compacto, true);
  const comAluguel = screen(hojeFile, {
    bills: [{ ref_id: 'alu', title: 'Aluguel', due_date: '2026-09-10', amount_cents: 65000, kind: 'transaction', overdue: false }],
  });
  assert.ok(diaVazio(comAluguel), 'o que vence daqui a dois dias não é "do dia"');
  assert.ok(agendaItem(comAluguel, 'Aluguel'), 'ele está nos próximos dias');
});

test('Hoje: os blocos vão DIRETO para a cascata — um Fragment vazio era um vão de 24dp', () => {
  const ui = screen(hojeFile, {});
  const filhos = [].concat(ui.nodes().find((n: any) => n.type === 'Screen').props.children).filter(Boolean);
  assert.ok(filhos.length >= 3);
  assert.ok(filhos.every((f: any) => f.type !== Symbol.for('react.fragment')), 'nenhum bloco embrulhado em Fragment');
});

test('Hoje: cada leitura do card do dinheiro que falha aparece, e o "Tentar de novo" refaz só ela', () => {
  const orcamento = screen(hojeFile, { budgetsError: true });
  assert.deepEqual(copia(orcamento.nodes().find((n: any) => n.type === 'DinheiroDoDia').props.apertados), []);
  orcamento.nodes().find((n: any) => n.type === 'ErrorCard').props.onRetry();
  assert.deepEqual(orcamento.refetches, ['budgets']);

});

test('Hoje: sem o ciclo e sem próxima entrada, o card não inventa "1 dia"', () => {
  const ui = screen(hojeFile, { cycleError: true, spendable: { caixa: 50_000, comprometido_ate_entrada: 0, comprometido_no_ciclo: 0, proxima_entrada: null } });
  const painel = ui.nodes().find((n: any) => n.type === 'DinheiroDoDia').props.painel;
  assert.deepEqual(copia({ rotulo: painel.rotulo, legenda: painel.legenda }), { rotulo: 'Livre', legenda: '' });
});

test('Hoje: sem as contas, os próximos dias dizem que falharam em vez de mostrar só o cartão', () => {
  const ui = screen(hojeFile, {
    billsError: true,
    charges: [{ id: 'c-1', title: 'DAS', occurred_at: '2026-09-10', amount_cents: 7000, card: 'Nubank', invoice_id: 'f-9' }],
  });
  assert.ok(!agendaItem(ui, 'DAS'), 'uma lista só com o cartão mentiria');
  const erros = ui.nodes().filter((n: any) => n.type === 'ErrorCard');
  // Cada seção que lê as contas diz que falhou (§7): o Seu dia, a semana (as marcas) e os próximos.
  assert.equal(erros.length, 3, 'o erro no Seu dia, na semana e nos próximos dias');
});

/** Um horário LOCAL de 08/09 — o dia do dublê de `use-items`. */
const lembreteAs = (id: string, h: number, dia = 8) =>
  ({ id, title: id, recurrence: null, channel: 'push', next_run_at: new Date(2026, 8, dia, h, 0).toISOString() });

test('Hoje: o que pede atenção mora no Seu dia e no card do dinheiro, cada um com o seu destino', () => {
  const ui = screen(hojeFile, {
    bills: [{ ref_id: 'luz-1', title: 'Luz', due_date: '2026-09-01', amount_cents: 21000, kind: 'transaction', overdue: true }],
    reminders: [lembreteAs('Comprar remédio', 15)],
    budgets: [{ category: 'Mercado', limit_cents: 100_00, spent_cents: 85_00, committed_cents: 0 }],
  });
  assert.ok(agendaItem(ui, 'Luz'), 'o atrasado está no Seu dia');
  const lembrete = ui.nodes().find((n: any) => n.type === 'LinhaDeLembrete');
  assert.equal(lembrete.props.estado, 'proximo');
  lembrete.props.onOpen('Comprar remédio');
  assert.deepEqual(copia(ui.navigations.at(-1)), { pathname: '/reminder-form', params: { id: 'Comprar remédio', ocorrencia: '1' } });

  const dinheiro = ui.nodes().find((n: any) => n.type === 'DinheiroDoDia');
  assert.deepEqual(copia(dinheiro.props.apertados.map((o: any) => o.categoria)), ['Mercado']);
  dinheiro.props.onAbrirOrcamentos();
  assert.equal(ui.navigations.at(-1), '/finance/budgets');
  ui.nodes().find((n: any) => n.type === 'BlockHeader' && n.props.title === 'Seu dia').props.action.onPress();
  assert.equal(ui.navigations.at(-1), '/reminders', 'os lembretes todos continuam a um toque');
  assert.ok(!tipos(ui).includes('TodaySignals') && !tipos(ui).includes('BudgetRings') && !tipos(ui).includes('HeroPanel'),
    'nada dos blocos que eram iguais aos do Financeiro');
});

test('Hoje: lembrete que ficou de outro dia diz a data dele; o de hoje tem o AGORA antes', () => {
  // O "Para hoje" listava lembretes de 25 dias antes (28/09/2026).
  const ui = screen(hojeFile, { reminders: [lembreteAs('seguro', 6, 3), lembreteAs('manhã', 9), lembreteAs('filtro', 15)] });
  const linhas = ui.nodes().filter((n: any) => n.type === 'LinhaDeLembrete' || n.type === 'AgoraLinha');
  assert.deepEqual(
    linhas.map((n: any) => (n.type === 'AgoraLinha' ? 'agora' : `${n.props.lembrete.id}:${n.props.estado}`)),
    ['seguro:outroDia', 'manhã:passou', 'agora', 'filtro:proximo']
  );
});

test('Hoje: o dinheiro vem por dia, com o livre total na legenda, e tocar abre o menu de sempre', () => {
  // caixa 3.300 − 300 comprometido = 3.000 livres; de 08/09 até o fim do ciclo (30/09) são 22 dias.
  const ui = screen(hojeFile, { spendable: { caixa: 330_000, comprometido_ate_entrada: 30_000, comprometido_no_ciclo: 30_000, proxima_entrada: null } });
  const dinheiro = ui.nodes().find((n: any) => n.type === 'DinheiroDoDia');
  assert.equal(dinheiro.props.painel.rotulo, 'Dá para gastar por dia');
  assert.equal(dinheiro.props.painel.cents, Math.floor(300_000 / 22));
  assert.equal(dinheiro.props.painel.legenda, 'R$ 3000.00 livre até 30/09');
  ui.interact(() => dinheiro.props.onAbrirMenu());
  assert.deepEqual(ui.actions.map((a: any) => a.label), ['Ver o que fecha o ciclo', 'Projeção', 'Patrimônio', 'Metas']);
  assert.deepEqual(copia(ui.writes.at(-1)), { operation: 'usarDica', value: 'hoje-painel' });

  const noVermelho = screen(hojeFile, { spendable: { caixa: 10_000, comprometido_ate_entrada: 50_000, comprometido_no_ciclo: 50_000, proxima_entrada: null } });
  const painel = noVermelho.nodes().find((n: any) => n.type === 'DinheiroDoDia').props.painel;
  assert.deepEqual(copia({ rotulo: painel.rotulo, cents: painel.cents, negativo: painel.negativo }), { rotulo: 'Livre até 30/09', cents: -40_000, negativo: true });
});

test('Hoje: falha no dinheiro do dia diz que falhou, e o "Tentar de novo" refaz só ele', () => {
  const ui = screen(hojeFile, { spendableError: true });
  assert.ok(!tipos(ui).includes('DinheiroDoDia'), 'sem resposta a tela não inventa um "por dia"');
  ui.nodes().find((n: any) => n.type === 'ErrorCard').props.onRetry();
  assert.deepEqual(ui.refetches, ['spendable']);
});

test('Hoje: as notas fixadas aparecem; sem fixada, as últimas; e tocar abre a nota', () => {
  const nota = (id: string, pinned: boolean) => ({ id, content: id, folder_id: null, pinned, color: null, source: 'app', tags: [], updated_at: '2026-09-08T10:00:00Z' });
  const comFixada = screen(hojeFile, { notes: [nota('mercado', true), nota('ideia', false)] });
  const faixa = comFixada.nodes().find((n: any) => n.type === 'NotasDaHoje');
  assert.deepEqual(copia(faixa.props.notas.map((n: any) => n.id)), ['mercado']);
  assert.ok(comFixada.nodes().some((n: any) => n.type === 'BlockHeader' && n.props.title === 'Fixadas'));
  faixa.props.onOpen('mercado');
  assert.deepEqual(copia(comFixada.navigations.at(-1)), { pathname: '/notes/[id]', params: { id: 'mercado' } });

  const semFixada = screen(hojeFile, { notes: [nota('ideia', false), nota('lista', false)] });
  assert.deepEqual(copia(semFixada.nodes().find((n: any) => n.type === 'NotasDaHoje').props.notas.map((n: any) => n.id)), ['ideia', 'lista']);
  assert.ok(semFixada.nodes().some((n: any) => n.type === 'BlockHeader' && n.props.title === 'Notas recentes'));

  assert.ok(!tipos(screen(hojeFile, {})).includes('NotasDaHoje'), 'sem nota, sem faixa — e nenhum card "Nova nota" (o Lançar já cria)');
  const falhou = screen(hojeFile, { notesError: true });
  falhou.nodes().find((n: any) => n.type === 'ErrorCard').props.onRetry();
  assert.deepEqual(falhou.refetches, ['notas']);
});

const saldo = (nome: string, tipo: string, cents: number, aReceber = 0) => ({
  account_id: nome, name: nome, type: tipo,
  balance_cents: cents, cleared_cents: cents, pending_in_cents: aReceber, pending_out_cents: 0,
});

test('Hoje: "Em conta" soma exatamente as linhas que mostra, e cartão fica de fora', () => {
  const ui = screen(hojeFile, {
    balances: [saldo('Nubank', 'checking', 120_00), saldo('Cofre', 'savings', 500_00), saldo('Cartão', 'credit_card', -900_00)],
  });
  const bloco = ui.nodes().find((n: any) => n.type === 'DinheiroDoDia');
  assert.ok(bloco, 'o card do dinheiro precisa aparecer');
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
  const bloco = ui.nodes().find((n: any) => n.type === 'DinheiroDoDia');
  bloco.props.onAbrirConta(bloco.props.caixa.linhas[0]);
  assert.deepEqual(copia(ui.navigations.at(-1)), { pathname: '/finance/transactions', params: { accountId: 'Nubank' } });
});

test('Hoje: falha nos saldos diz que falhou e refaz só os saldos', () => {
  const ui = screen(hojeFile, { balancesError: true });
  assert.equal(ui.nodes().find((n: any) => n.type === 'DinheiroDoDia').props.caixa, null, 'sem resposta a tela não afirma saldo nenhum');
  const erro = ui.nodes().find((n: any) => n.type === 'ErrorCard');
  assert.ok(erro);
  erro.props.onRetry();
  assert.deepEqual(ui.refetches, ['balances']);
});

test('Hoje: sem conta nenhuma a linha "Em conta" não afirma R$ 0,00', () => {
  const ui = screen(hojeFile, {});
  assert.deepEqual(copia(ui.nodes().find((n: any) => n.type === 'DinheiroDoDia').props.caixa.linhas), []);
});

test('Hoje: a semana vem no topo — três dias para trás pela régua do "saiu hoje", hoje no meio', () => {
  // 08/09 é o "hoje" do dublê; caixa 3.300 − 300 = 3.000 livres em 22 dias = 13.636 por dia.
  const ui = screen(hojeFile, {
    spendable: { caixa: 330_000, comprometido_ate_entrada: 30_000, comprometido_no_ciclo: 30_000, proxima_entrada: null },
    gastos: [
      { day: '2026-09-05', expense_cents: 5000, income_cents: 0 },
      { day: '2026-09-08', expense_cents: 20000, income_cents: 400000 },
    ],
    bills: [{ ref_id: 'luz', title: 'Luz', due_date: '2026-09-10', amount_cents: 21430, kind: 'transaction', overdue: false }],
  });
  const filhos = [].concat(ui.nodes().find((n: any) => n.type === 'Screen').props.children).filter(Boolean);
  assert.equal(filhos[1].key, 'semana', 'logo abaixo da saudação (sem passos pendentes)');
  const semana = ui.nodes().find((n: any) => n.type === 'SemanaDoDia');
  assert.deepEqual(copia(semana.props.semana.dias.map((d: any) => [d.day, d.tipo, d.saiu])), [
    ['2026-09-05', 'passado', 5000], ['2026-09-06', 'passado', 0], ['2026-09-07', 'passado', 0],
    ['2026-09-08', 'hoje', 20000], ['2026-09-09', 'futuro', 0], ['2026-09-10', 'futuro', 0], ['2026-09-11', 'futuro', 0],
  ]);
  assert.equal(semana.props.semana.dias[5].previsto, 21430, 'o que vence dia 10 é a marca daquele dia');
  assert.equal(semana.props.semana.linha, Math.floor(300_000 / 22), 'a régua é o "por dia" do card do dinheiro');
  assert.equal(semana.props.escolhido, '2026-09-08', 'abre no dia de hoje');
  ui.interact(() => semana.props.onEscolher('2026-09-05'));
  assert.equal(ui.nodes().find((n: any) => n.type === 'SemanaDoDia').props.escolhido, '2026-09-05');
  ui.interact(() => ui.nodes().find((n: any) => n.type === 'SemanaDoDia').props.onEscolher('2026-09-08'));
  assert.equal(ui.nodes().find((n: any) => n.type === 'SemanaDoDia').props.escolhido, '2026-09-08',
    'tocar em hoje volta a seguir o hoje (não prende a data depois da meia-noite)');
  ui.nodes().find((n: any) => n.type === 'BlockHeader' && n.props.title === 'Sua semana').props.action.onPress();
  assert.equal(ui.navigations.at(-1), '/finance/transactions', 'o que saiu continua a um toque dos Lançamentos');
});

test('Hoje: a semana sem o gasto — ou sem os próximos dias — diz que falhou, e refaz só o que falhou', () => {
  const ui = screen(hojeFile, { gastosError: true });
  assert.ok(!tipos(ui).includes('SemanaDoDia'), 'sem resposta, nenhuma barra inventada');
  ui.nodes().find((n: any) => n.type === 'ErrorCard').props.onRetry();
  assert.deepEqual(ui.refetches, ['gastos']);
  const semProximos = screen(hojeFile, { billsError: true });
  assert.ok(!tipos(semProximos).includes('SemanaDoDia'), 'sem as contas, as marcas diriam "nada previsto"');
});

test('Hoje: sem "por dia" a semana não desenha régua', () => {
  const ui = screen(hojeFile, { spendable: { caixa: 10_000, comprometido_ate_entrada: 50_000, comprometido_no_ciclo: 50_000, proxima_entrada: null } });
  assert.equal(ui.nodes().find((n: any) => n.type === 'SemanaDoDia').props.semana.linha, null);
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
  tela.props.overlay.props.children[0].props.onPress();
  assert.deepEqual(
    ui.actions.map((a) => a.label),
    ['Gasto ou receita', 'Recorrente', 'Financiamento', 'Por voz']
  );
});

test('Hoje tablet reuses its real blocks and retains their destinations', () => {
  const ui = screen(hojeFile, { tablet: true, balances: [saldo('Conta', 'checking', 120_00)] });
  const tela = ui.nodes().find((n: any) => n.type === 'Screen');
  assert.equal(tela.props.wide, true);
  const canvas = ui.nodes().find((n: any) => n.type === 'TodayTabletCanvas');
  assert.ok(canvas);
  assert.ok(tipos(ui).includes('DinheiroDoDia'));
  assert.ok(ui.nodes().some((n: any) => n.type === 'BlockHeader' && n.props.title === 'Seu dia'));
});

test('Financeiro tablet keeps the cycle, analysis and all management actions', () => {
  const ui = screen(financeiroFile, { tablet: true });
  const tela = ui.nodes().find((n: any) => n.type === 'Screen');
  assert.equal(tela.props.wide, true);
  const canvas = ui.nodes().find((n: any) => n.type === 'FinanceTabletCanvas');
  assert.ok(canvas);
  assert.ok(ui.nodes().some((n: any) => n.type === 'Tile' && n.props.label === 'Entra'));
  assert.ok(ui.nodes().some((n: any) => n.type === 'Tile' && n.props.label === 'Sai'));
  tela.props.overlay.props.children[0].props.onPress();
  assert.deepEqual(ui.actions.map((a) => a.label),
    ['Gasto ou receita', 'Recorrente', 'Financiamento', 'Por voz']);
});

test('Cartões: "Importar fatura" se alcança com o DEDO (toque longo), não só pelo leitor de tela', () => {
  const ui = screen('src/app/finance/cards.tsx', { cards: [{ account_id: 'card-1', name: 'Nubank Cartão', invoice_id: 'invoice-1', invoice_total_cents: 10000, unpaid_total_cents: 10000, closing_date: '2026-10-03', due_date: '2026-10-10', overdue_count: 0 }] });
  const card = ui.nodes().find((n: any) => typeof n.type === 'function' && n.type.name === 'PressCard');
  assert.ok(card, 'o card do cartão');
  // O PressCard devolve o Deslizavel (arrasto) em volta do tocável.
  const raiz = card.type(card.props);
  const tocavel = raiz.type === 'Deslizavel' ? raiz.props.children : raiz;
  assert.equal(typeof tocavel.props.onLongPress, 'function', 'o card abre as ações no toque longo');
  tocavel.props.onLongPress();
  const importar = ui.actions.find((a: any) => a.label === 'Importar fatura');
  assert.ok(importar, 'Importar fatura entre as ações');
  importar.onPress();
  assert.deepEqual(JSON.parse(JSON.stringify(ui.navigations.at(-1))), { pathname: '/import', params: { conta: 'card-1' } });
});

const importFile = 'src/app/import.tsx';
const contasDoImport = [{ id: 'card-1', name: 'Nubank Cartão', type: 'credit_card' }, { id: 'conta-1', name: 'Nubank', type: 'checking' }];
const temTexto = (ui: any, texto: string) => ui.nodes().some((n: any) => n.type === 'ThemedText' && n.props.children === texto);

test('Importar: no Free o aviso do Pro É a etapa — sem conta, sem arquivo, "Ver planos" leva ao paywall', () => {
  const ui = screen(importFile, { params: {}, plan: 'free', forecastAccounts: contasDoImport });
  assert.ok(temTexto(ui, 'Importar é do plano Pro'));
  assert.equal(ui.nodes().some((n: any) => n.type === 'Button' && n.props.label === 'Escolher arquivo'), false, 'nada de botão que nunca liga');
  assert.equal(ui.nodes().some((n: any) => n.type === 'AccountPicker'), false, 'nada de escolher conta que não leva a lugar nenhum');
  ui.press('Ver planos');
  assert.equal(ui.navigations.at(-1), '/paywall');
});

test('Importar: enquanto o plano carrega, esqueleto — o botão não nasce ligado para o aviso entrar depois', () => {
  const ui = screen(importFile, { params: {}, planPending: true, forecastAccounts: contasDoImport });
  assert.equal(ui.nodes().some((n: any) => n.type === 'Button' && n.props.label === 'Escolher arquivo'), false);
  assert.ok(ui.nodes().some((n: any) => n.type === 'SkeletonRow'));
});

test('Importar: ?conta= de uma conta da pessoa já nasce escolhida e o arquivo está liberado', () => {
  const ui = screen(importFile, { params: { conta: 'card-1' }, forecastAccounts: contasDoImport });
  assert.equal(ui.nodes().find((n: any) => n.type === 'AccountPicker').props.value, 'card-1');
  assert.equal(ui.button('Escolher arquivo').props.disabled, false);
});

test('Importar: ?conta= que não é da pessoa é ignorado — nada pré-escolhido, o arquivo espera a conta', () => {
  const ui = screen(importFile, { params: { conta: 'de-outra-pessoa' }, forecastAccounts: contasDoImport });
  assert.equal(ui.nodes().find((n: any) => n.type === 'AccountPicker').props.value, null);
  assert.equal(ui.button('Escolher arquivo').props.disabled, true);
});

/*
  Arrastar o card para os lados (spec 2026-09-23-arrastar-card): o card declara as ações UMA vez
  e o `Deslizavel` divide. Os testes leem o que cada card entrega a ele.
*/
const ladosDe = (node: any) => {
  const l = ladosDoArrasto(node.props.acoes);
  // Ícone em TODA ação revelada: sem ele, o rótulo fica numa altura e o do "Mais" (que tem ícone)
  // noutra — medido no Android em 23/09/2026 ("Arquivar" desalinhado de "Mais").
  const semIcone = [...l.direita, ...l.esquerda].filter((a: any) => !a.icon).map((a: any) => a.label);
  assert.deepEqual(JSON.parse(JSON.stringify(semIcone)), [], `ação do arrasto sem ícone: ${semIcone.join(', ')}`);
  // O botão revelado tem 88dp: rótulo de uma palavra, como no WhatsApp ("Apagar a compra inteira"
  // partia em três linhas). A frase inteira continua no menu; no arrasto vale `curto`.
  const longos = [...l.direita, ...l.esquerda].map((a: any) => a.curto ?? a.label).filter((t: string) => t.length > 10);
  assert.deepEqual(JSON.parse(JSON.stringify(longos)), [], `rótulo longo no arrasto: ${longos.join(', ')}`);
  // JSON: o harness roda a tela noutro contexto (vm), e arrays de lá não são `deepStrictEqual` daqui.
  return JSON.parse(JSON.stringify({ direita: l.direita.map((a: any) => a.label), esquerda: l.esquerda.map((a: any) => a.label), mais: l.mais, pontaDireita: l.pontaDireita?.label ?? null, pontaEsquerda: l.pontaEsquerda?.label ?? null }));
};
const deslizaveis = (ui: any) => ui.nodes().filter((n: any) => n.type === 'Deslizavel');

test('Lembretes: arrastar à direita pausa (até o fim, com Desfazer), à esquerda apaga', () => {
  const ui = screen('src/app/reminders.tsx', { reminders: [{ id: 'r1', title: 'Aluguel', active: true, next_run_at: '2026-10-05T12:00:00Z', recurrence: null }] });
  const [card] = deslizaveis(ui);
  assert.ok(card, 'o lembrete está num Deslizavel');
  assert.deepEqual(ladosDe(card), { direita: ['Pausar'], esquerda: ['Apagar'], mais: false, pontaDireita: 'Pausar', pontaEsquerda: 'Apagar' });
  // o toque longo continua com todas as ações
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'Row' && n.props.onLongPress).props.onLongPress());
  assert.deepEqual(JSON.parse(JSON.stringify(ui.actions.map((a: any) => a.label))), ['Editar', 'Pausar', 'Apagar']);
  // Apagar ficou a um arrasto: ele confirma antes, como em toda outra tela.
  const apagar = card.props.acoes.find((x: any) => x.label === 'Apagar');
  ui.interact(() => apagar.onPress());
  assert.deepEqual(ui.writes, [], 'nada apagado antes da confirmação');
  assert.equal(ui.confirmations.length, 1);
});

const itemLinks = (ui: any) => ui.nodes().filter((n: any) => n.type === 'ItemLink');
const ladosDoLink = (node: any) => ladosDe({ props: { acoes: node.props.actions } });

test('Lançamentos: pendente arrasta Paguei à direita; efetivado arrasta Editar; Apagar à esquerda', () => {
  const pendente = itemLinks(screen(transacoesFile, { txStatus: 'pending' }))[0];
  assert.deepEqual(ladosDoLink(pendente), { direita: ['Paguei'], esquerda: ['Apagar'], mais: true, pontaDireita: 'Paguei', pontaEsquerda: 'Apagar' });
  const efetivado = itemLinks(screen(transacoesFile))[0];
  assert.deepEqual(ladosDoLink(efetivado), { direita: ['Editar'], esquerda: ['Apagar'], mais: true, pontaDireita: 'Editar', pontaEsquerda: 'Apagar' });
});

test('Paguei confirma valor e baixa numa única escrita, inclusive com correção', () => {
  // 25/09/2026, pedido do dono do produto: *"às vezes eu posso ter pago menos ou mais"*.
  const abrir = () => {
    const ui = screen(transacoesFile, { txStatus: 'pending' });
    ui.interact(() => itemLinks(ui)[0].props.actions.find((a: any) => a.label === 'Paguei').onPress());
    return ui;
  };
  const igual = abrir();
  assert.equal(igual.writes.length, 0, 'Paguei não dá baixa sem confirmar o valor');
  const campo = igual.nodes().find((n: any) => n.type === 'MoneyField');
  assert.equal(campo?.props.valueCents, 4500, 'o valor nasce no previsto');
  igual.press('Paguei');
  assert.deepEqual(igual.writes.map((w: any) => w.operation), ['confirmPaymentScoped']);
  assert.equal(igual.writes[0].value.amountCents, 4500);

  const outro = abrir();
  outro.interact((nodes) => nodes.find((n: any) => n.type === 'MoneyField').props.onChangeCents(5200));
  outro.press('Paguei');
  assert.deepEqual(JSON.parse(JSON.stringify(outro.writes[0])), { operation: 'confirmPaymentScoped', value: { id: 'tx-1', scope: 'one', amountCents: 5200, paidAt: outro.writes[0].value.paidAt } });
  outro.interact(() => outro.pedidos[0].opts.onSuccess());
  assert.equal(outro.writes.length, 1, 'a confirmação inteira usa uma chamada');
});

test('Financeiro: o último lançamento arrasta Editar e Apagar (Ver detalhe é o toque)', () => {
  const ui = screen(financeiroFile, { recent: [{ id: 't1', kind: 'expense', amount_cents: 4500, occurred_at: '2026-09-15', description: 'Mercado', status: 'cleared' }] });
  assert.deepEqual(ladosDoLink(itemLinks(ui)[0]), { direita: ['Editar'], esquerda: ['Apagar'], mais: false, pontaDireita: 'Editar', pontaEsquerda: 'Apagar' });
});

test('Fatura: a compra arrasta Editar e Apagar', () => {
  const ui = screen('src/app/finance/invoice/[id].tsx');
  assert.deepEqual(ladosDoLink(itemLinks(ui)[0]), { direita: ['Editar'], esquerda: ['Apagar'], mais: false, pontaDireita: 'Editar', pontaEsquerda: 'Apagar' });
});

test('Contas: a conta arrasta Editar e Arquivar (Ver extrato é o toque)', () => {
  const ui = screen('src/app/finance/accounts.tsx', {
    balances: [{ account_id: 'a1', name: 'Nubank', type: 'checking', balance_cents: 10000, cleared_cents: 10000, pending_in_cents: 0, pending_out_cents: 0 }],
    forecastAccounts: [{ id: 'a1', name: 'Nubank', type: 'checking', archived: false }],
  });
  const [link] = itemLinks(ui);
  assert.ok(link, 'a conta está num ItemLink');
  assert.deepEqual(ladosDoLink(link), { direita: ['Editar'], esquerda: ['Arquivar'], mais: false, pontaDireita: 'Editar', pontaEsquerda: 'Arquivar' });
});

test('Projeção: a conta prevista arrasta Paguei à direita; Editar mora no Mais (a esquerda só tira da lista)', () => {
  const ui = screen(forecastFile, { forecastAccounts: [{ id: 'conta-1' }], bills: [{ ref_id: 'b1', title: 'Aluguel', kind: 'expense', amount_cents: 180000, due_date: '2026-10-05', overdue: false }] });
  const card = deslizaveis(ui).find((n: any) => n.props.titulo === 'Aluguel');
  assert.ok(card, 'a conta prevista está num Deslizavel');
  assert.deepEqual(ladosDe(card), { direita: ['Paguei'], esquerda: [], mais: true, pontaDireita: 'Paguei', pontaEsquerda: null });
});

test('Regras: a regra arrasta Editar e Apagar', () => {
  const ui = screen('src/app/finance/rules.tsx', { rules: [{ id: 'r1', pattern: 'ifood', category: 'restaurante', match_type: 'contains', account_id: null, hits: 3, source: 'user' }] });
  const [card] = deslizaveis(ui);
  assert.ok(card, 'a regra está num Deslizavel');
  assert.deepEqual(ladosDe(card), { direita: ['Editar'], esquerda: ['Apagar'], mais: false, pontaDireita: 'Editar', pontaEsquerda: 'Apagar' });
});

test('Dívidas: arrasta Pagar parcela à direita; Arquivar à esquerda vai até o fim (tem Desfazer)', () => {
  const ui = screen(debtsFile, { create: false, debts: [carro] });
  assert.deepEqual(ladosDe(deslizaveis(ui)[0]), { direita: ['Pagar parcela'], esquerda: ['Arquivar'], mais: true, pontaDireita: 'Pagar parcela', pontaEsquerda: 'Arquivar' });
});

test('Cartões: fatura aberta arrasta Importar fatura à direita e Arquivar à esquerda', () => {
  const ui = screen('src/app/finance/cards.tsx', { cards: [{ account_id: 'card-1', name: 'Nubank Cartão', invoice_id: 'invoice-1', invoice_total_cents: 10000, unpaid_total_cents: 10000, closing_date: '2026-10-03', due_date: '2026-10-10', overdue_count: 0 }] });
  const card = ui.nodes().find((n: any) => typeof n.type === 'function' && n.type.name === 'PressCard');
  const raiz = card.type(card.props);
  assert.equal(raiz.type, 'Deslizavel', 'o cartão está num Deslizavel');
  // A esquerda só tira da lista (28/09/2026): Arquivar; carteira e editar moram no "Mais".
  assert.deepEqual(ladosDe(raiz), { direita: ['Importar fatura'], esquerda: ['Arquivar cartão'], mais: true, pontaDireita: 'Importar fatura', pontaEsquerda: 'Arquivar cartão' });
  const rotulos = raiz.props.acoes.map((a: any) => a.label);
  assert.ok(rotulos.includes('Editar cartão') && rotulos.includes('Arquivar cartão'), rotulos.join(', '));
  ui.interact(() => raiz.props.acoes.find((a: any) => a.label === 'Editar cartão').onPress());
  assert.equal(ui.navigations.at(-1), '/finance/accounts?edit=card-1');
});

test('Cartões: "Paguei" abre a fatura já no pagamento, não só a fatura', () => {
  const ui = screen('src/app/finance/cards.tsx', { cards: [{ account_id: 'card-1', name: 'Nubank Cartão', invoice_id: 'invoice-1', invoice_total_cents: 10000, invoice_open_cents: 10000, unpaid_total_cents: 10000, closing_date: '2026-09-03', due_date: '2026-09-10', overdue_count: 1 }] });
  const card = ui.nodes().find((n: any) => typeof n.type === 'function' && n.type.name === 'PressCard');
  const raiz = card.type(card.props);
  const paguei = raiz.props.acoes.find((x: any) => x.label === 'Paguei');
  assert.ok(paguei, 'fatura fechada tem Paguei');
  ui.interact(() => paguei.onPress());
  assert.deepEqual(JSON.parse(JSON.stringify(ui.navigations.at(-1))), { pathname: '/finance/invoice/[id]', params: { id: 'invoice-1', acao: 'pagar' } });
});

test('Recorrentes: arrasta Pausar (até o fim, com Desfazer) e Apagar; o resto no Mais', () => {
  const ui = screen('src/app/finance/recurring.tsx', { recurring: [{ id: 'rec-1', description: 'Academia', kind: 'expense', amount_cents: 12000, rrule: 'FREQ=MONTHLY;BYMONTHDAY=15', dtstart: '2026-01-15', next_run_at: '2026-10-15T12:00:00Z', active: true, account_id: null, category: 'saúde' }] });
  const card = deslizaveis(ui)[0];
  assert.ok(card, 'a série está num Deslizavel');
  assert.deepEqual(ladosDe(card), { direita: ['Pausar'], esquerda: ['Apagar'], mais: true, pontaDireita: 'Pausar', pontaEsquerda: 'Apagar' });
  // O Desfazer é a rede do "até o fim": se ele falhar, a pessoa precisa saber (design.md §6).
  ui.interact(() => card.props.acoes.find((x: any) => x.label === 'Pausar').onPress());
  ui.interact(() => ui.pedidos.at(-1).opts.onSuccess());
  const desfazer = ui.toasts.at(-1).action;
  assert.equal(desfazer?.label, 'Desfazer');
  ui.interact(() => desfazer.onPress());
  const volta = ui.pedidos.at(-1);
  assert.equal(typeof volta.opts?.onError, 'function', 'o Desfazer avisa quando falha');
  ui.interact(() => volta.opts.onError());
  assert.equal(ui.toasts.at(-1).tone, 'error');
});

test('Metas: arrasta Guardar à direita e Arquivar à esquerda', () => {
  const ui = screen('src/app/finance/goals.tsx', { goals: [{ id: 'g1', name: 'Viagem', target_cents: 500000, saved_cents: 100000, deadline: null, archived: false }] });
  const card = deslizaveis(ui)[0];
  assert.ok(card, 'a meta está num Deslizavel');
  assert.deepEqual(ladosDe(card), { direita: ['Guardar'], esquerda: ['Arquivar'], mais: true, pontaDireita: 'Guardar', pontaEsquerda: 'Arquivar' });
});

const metaComMarcos = { id: 'g1', name: 'Viagem', target_cents: 100000, saved_cents: 30000, deadline: null, archived: false, icon: null, color: null };
const linhaDoMarco = (ui: any) => JSON.stringify(ui.nodes().filter((n: any) => n.type === 'ThemedText').map((n: any) => n.props.children));

test('Metas: o card mostra o próximo marco e quanto falta; sem marcos, sem linha; oculto, escondida', () => {
  const com = linhaDoMarco(screen('src/app/finance/goals.tsx', { goals: [metaComMarcos], milestones: { g1: [25000, 50000, 75000] } }));
  assert.match(com, /Próximo marco: R\$ 500\.00 · faltam R\$ 200\.00/);
  assert.doesNotMatch(linhaDoMarco(screen('src/app/finance/goals.tsx', { goals: [metaComMarcos] })), /marco/i, 'meta sem marcos não tem a linha');
  assert.doesNotMatch(linhaDoMarco(screen('src/app/finance/goals.tsx', { goals: [metaComMarcos], milestones: { g1: [25000] }, concealed: true })), /marco/i, 'valores ocultos');
  const todos = linhaDoMarco(screen('src/app/finance/goals.tsx', { goals: [{ ...metaComMarcos, saved_cents: 80000 }], milestones: { g1: [25000, 50000, 75000] } }));
  assert.match(todos, /Faltam R\$ 200\.00 para o alvo/);
});

test('Metas: o anel recebe ícone, cor, marcos e o que falta para decidir a celebração', () => {
  const ui = screen('src/app/finance/goals.tsx', { goals: [{ ...metaComMarcos, icon: 'airplane', color: 'oceano' }], milestones: { g1: [25000] } });
  const anel = ui.nodes().find((n: any) => n.type === 'AnelDaMeta');
  assert.ok(anel, 'o card desenha o anel da meta');
  assert.equal(anel.props.icon, 'airplane');
  assert.equal(anel.props.color, 'oceano');
  assert.deepEqual([...anel.props.marcos], [25000]);
  assert.equal(anel.props.travessia, null, 'abrir a tela não é uma travessia');
});

test('Metas: criar com ícone, cor e marcos grava tudo, e o % vira centavos com o alvo final', () => {
  const ui = screen('src/app/finance/goals.tsx', { goals: [] });
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'HeaderActions').props.actions[0].onPress());
  const marcos = () => ui.nodes().find((n: any) => n.type === 'MarcosDaMeta');
  assert.deepEqual(JSON.parse(JSON.stringify(marcos().props.linhas.map((l: any) => l.pct))), ['25', '50', '75'], 'sugestão ao criar');
  ui.fill('Nome', 'Viagem');
  ui.fill('Quanto quer juntar', 100001);
  ui.interact(() => ui.nodes().find((n: any) => n.type === 'AparenciaDaMeta').props.onIcon('airplane'));
  ui.interact(() => ui.nodes().find((n: any) => n.type === 'AparenciaDaMeta').props.onColor('oceano'));
  ui.interact(() => marcos().props.onChange([{ key: 'a', cents: 0, pct: '33,3' }, { key: 'b', cents: 50000, pct: null }]));
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'TaskHeader').props.action.props.onPress());
  const escrita = ui.writes.at(-1);
  assert.equal(escrita.operation, 'saveGoal');
  assert.deepEqual(JSON.parse(JSON.stringify(escrita.value)), {
    name: 'Viagem', target_cents: 100001, deadline: null, icon: 'airplane', color: 'oceano', marcos: [33300, 50000],
  });
});

test('Metas: editar com os marcos ainda sem chegar não os mostra nem os envia (não apaga os que existem)', () => {
  const ui = screen('src/app/finance/goals.tsx', { goals: [metaComMarcos], marcosPendentes: true });
  const card = deslizaveis(ui)[0];
  ui.interact(() => card.props.acoes.find((a: any) => a.label === 'Editar').onPress());
  assert.ok(!ui.nodes().some((n: any) => n.type === 'MarcosDaMeta'), 'sem marcos carregados o formulário não finge uma lista vazia');
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'TaskHeader').props.action.props.onPress());
  const valor = ui.writes.at(-1).value;
  assert.equal(valor.id, 'g1');
  assert.equal(valor.marcos, undefined, 'marcos ausentes = a sincronização não mexe no banco');
});

test('Metas: marco repetido ou no alvo trava o Salvar e diz por quê', () => {
  const ui = screen('src/app/finance/goals.tsx', { goals: [] });
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'HeaderActions').props.actions[0].onPress());
  ui.fill('Nome', 'Viagem');
  ui.fill('Quanto quer juntar', 100000);
  const salvar = () => ui.nodes().find((n: any) => n.type === 'TaskHeader').props.action.props;
  assert.equal(salvar().disabled, false);
  ui.interact(() => ui.nodes().find((n: any) => n.type === 'MarcosDaMeta').props.onChange([{ key: 'a', cents: 25000, pct: null }, { key: 'b', cents: 0, pct: '25' }]));
  assert.equal(salvar().disabled, true);
  assert.match(linhaDoMarco(ui), /marco repetido/);
  ui.interact(() => ui.nodes().find((n: any) => n.type === 'MarcosDaMeta').props.onChange([{ key: 'a', cents: 100000, pct: null }]));
  assert.equal(salvar().disabled, true);
  assert.match(linhaDoMarco(ui), /abaixo do alvo/);
});

test('Nota: arrasta Fixar à direita e Arquivar à esquerda (os dois até o fim); o resto no Mais', () => {
  const vazio = () => {};
  const ui = screen('src/components/notes/note-card.tsx', {
    componente: 'NoteCard',
    props: {
      note: { id: 'n1', content: 'Ideias para o app', pinned: false, source: 'app', updated_at: '2026-09-01T12:00:00Z', created_at: '2026-09-01T12:00:00Z', color: null, folder_id: null, tags: [] },
      actions: { onPin: vazio, onColor: vazio, onMove: vazio, onArchive: vazio, onTrash: vazio },
    },
  });
  const [link] = itemLinks(ui);
  assert.ok(link, 'a nota está num ItemLink');
  assert.deepEqual(ladosDoLink(link), { direita: ['Fixar'], esquerda: ['Arquivar'], mais: true, pontaDireita: 'Fixar', pontaEsquerda: 'Arquivar' });
});

test('Nota colorida: o cartão INTEIRO é da cor, e sem cor própria herda a da pasta', () => {
  // 25/09/2026: *"o card inteiro tem que ficar daquela cor e não somente um detalhe quase
  // imperceptível"*. Era um trilho de 3px.
  const vazio = () => {};
  const cartao = (color: string | null, folderColor: string | null = null, pressed = false) => {
    const ui = screen('src/components/notes/note-card.tsx', {
      componente: 'NoteCard',
      props: {
        note: { id: 'n1', content: 'Mercado', pinned: false, source: 'app', updated_at: '2026-09-01T12:00:00Z', created_at: '2026-09-01T12:00:00Z', color, folder_id: null, tags: [] },
        folderColor,
        actions: { onPin: vazio, onColor: vazio, onMove: vazio, onArchive: vazio, onTrash: vazio },
      },
    });
    const [link] = itemLinks(ui);
    const view = link.props.children({ onLongPress: vazio }).props.children({ pressed });
    const estilo = Object.assign({}, ...view.props.style.flat().filter(Boolean));
    const tingida = [view.props.children].flat().find((n: any) => n?.type === 'PaletaTingida');
    return { fundo: estilo.backgroundColor, borda: estilo.borderColor, tingida: tingida?.props.cores ?? null };
  };
  assert.deepEqual(cartao('oceano'), { fundo: 'fundo-oceano', borda: 'borda-oceano', tingida: { surface: 'fundo-oceano', backgroundSelected: 'forte-oceano', cardBorder: 'borda-oceano', accentSoft: 'forte-oceano' } });
  assert.equal(cartao('oceano', null, true).fundo, 'forte-oceano', 'tocado: o tom forte da mesma cor, não o cinza');
  assert.equal(cartao(null, 'musgo').fundo, 'fundo-musgo', 'sem cor própria, a da pasta');
  assert.equal(cartao(null).tingida, null, 'sem cor nenhuma, o tema comum');
});

test('Pasta: arrasta Fixar à direita e Arquivar à esquerda (os dois até o fim); o resto no Mais', () => {
  const ui = screen('src/app/notes/folders.tsx', { folders: [{ id: 'f1', name: 'trabalho', icon: 'folder', color: null, pinned: false, parent_id: null, notes_count: 2, tags: [] }] });
  const [card] = deslizaveis(ui);
  assert.ok(card, 'a pasta está num Deslizavel');
  assert.deepEqual(ladosDe(card), { direita: ['Fixar'], esquerda: ['Arquivar'], mais: true, pontaDireita: 'Fixar', pontaEsquerda: 'Arquivar' });
});

test('Lixeira: Restaurar à direita, Apagar de vez à esquerda (Ver conteúdo é o toque)', () => {
  const ui = screen('src/app/notes/trash.tsx', { notes: [{ id: 'n1', content: 'Teste', deleted_at: '2026-09-20T12:00:00Z', updated_at: '2026-09-20T12:00:00Z', pinned: false }] });
  const [card] = deslizaveis(ui).length ? deslizaveis(ui) : itemLinks(ui).map((l: any) => ({ props: { acoes: l.props.actions } }));
  assert.ok(card, 'a nota da lixeira arrasta');
  assert.deepEqual(ladosDe(card), { direita: ['Restaurar'], esquerda: ['Apagar de vez'], mais: false, pontaDireita: 'Restaurar', pontaEsquerda: 'Apagar de vez' });
});

test('Arquivadas das notas: Desarquivar à direita, apagar à esquerda', () => {
  const ui = screen('src/app/notes/archived.tsx', { notes: [{ id: 'n1', content: 'Teste', archived_at: '2026-09-20T12:00:00Z', updated_at: '2026-09-20T12:00:00Z', pinned: false }] });
  const [card] = deslizaveis(ui);
  assert.ok(card, 'a nota arquivada arrasta');
  assert.deepEqual(ladosDe(card), { direita: ['Desarquivar'], esquerda: ['Lixeira'], mais: false, pontaDireita: 'Desarquivar', pontaEsquerda: 'Lixeira' });
});

test('Conversa: arrasta Renomear à direita e Apagar à esquerda', () => {
  const ui = screen('src/app/agent/history.tsx', { conversations: [{ id: 'c1', title: 'gastei 45 no mercado', last_message: 'Ok', updated_at: '2026-09-21T12:00:00Z' }] });
  const [card] = deslizaveis(ui);
  assert.ok(card, 'a conversa está num Deslizavel');
  assert.deepEqual(ladosDe(card), { direita: ['Renomear'], esquerda: ['Apagar'], mais: false, pontaDireita: 'Renomear', pontaEsquerda: 'Apagar' });
  assert.equal(card.props.fundo, 'groupedBackground', 'lista chapada: a linha tem o fundo da tela');
});

test('Importação: arrasta só Apagar registro à esquerda (retomar é o toque)', () => {
  const ui = screen('src/app/import-history.tsx', { batches: [{ id: 'b1', filename: 'nubank.ofx', source: 'ofx', created_at: '2026-09-20T12:00:00Z', account_id: null, pendentes: 0, aprovados: 3, total: 3, status: 'done' }] });
  const [card] = deslizaveis(ui);
  assert.ok(card, 'o lote está num Deslizavel');
  assert.deepEqual(ladosDe(card), { direita: [], esquerda: ['Apagar registro'], mais: false, pontaDireita: null, pontaEsquerda: 'Apagar registro' });
});

test('Orçamento: arrasta Editar limite à direita; o resto no Mais', () => {
  const ui = screen('src/app/finance/budgets.tsx', { budgets: [{ category: 'mercado', limit_cents: 100_00, base_limit_cents: 100_00, rollover_cents: 0, spent_cents: 40_00, committed_cents: 0, month: null }] });
  const [card] = deslizaveis(ui);
  assert.ok(card, 'o orçamento está num Deslizavel');
  assert.deepEqual(ladosDe(card), { direita: ['Editar limite'], esquerda: [], mais: true, pontaDireita: 'Editar limite', pontaEsquerda: null });
});

test('Aporte: no extrato da meta arrasta Apagar à esquerda, e ele confirma antes de mover dinheiro', () => {
  const ui = screen('src/app/finance/goals.tsx', {
    goals: [{ id: 'g1', name: 'Viagem', target_cents: 500000, saved_cents: 100000, deadline: null, archived: false }],
    contributions: [{ id: 'c1', goal_id: 'g1', amount_cents: 100000, occurred_at: '2026-09-01', note: null }],
  });
  const meta = deslizaveis(ui)[0];
  ui.interact(() => meta.props.acoes.find((x: any) => x.label === 'Ver extrato').onPress());
  const aporte = deslizaveis(ui).find((d: any) => d.props.acoes.some((x: any) => x.label === 'Apagar o aporte'));
  assert.ok(aporte, 'o aporte do extrato está num Deslizavel');
  // Editar à direita (26/09/2026, "tudo que se cria se edita"), Apagar à esquerda.
  assert.deepEqual(ladosDe(aporte), { direita: ['Editar'], esquerda: ['Apagar o aporte'], mais: false, pontaDireita: 'Editar', pontaEsquerda: 'Apagar o aporte' });
  ui.interact(() => aporte.props.acoes.find((x: any) => x.label === 'Apagar o aporte').onPress());
  assert.deepEqual(ui.writes, [], 'nada move antes da confirmação');
  assert.equal(ui.confirmations.length, 1);

  // Editar abre DENTRO da folha do extrato e salva AQUELE aporte, com a data escolhida
  const doExtrato = () => deslizaveis(ui).find((d: any) => d.props.acoes.some((x: any) => x.label === 'Apagar o aporte'));
  ui.interact(() => doExtrato().props.acoes.find((x: any) => x.label === 'Editar').onPress());
  assert.ok(ui.nodes().some((n: any) => n.type === 'TaskHeader' && n.props.title === 'Editar aporte'));
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'MoneyField').props.onChangeCents(120000));
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'DatePickerField' && n.props.accessibilityLabel === 'Data do aporte').props.onChange('02/09/2026'));
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'TaskHeader').props.action.props.onPress());
  assert.deepEqual(JSON.parse(JSON.stringify(ui.pedidos.at(-1).value)), { id: 'c1', amountCents: 120000, occurredAt: '2026-09-02', note: null });
});

test('Parcelada: arrasta Editar a compra à direita e Apagar a compra inteira à esquerda; o resto no Mais', () => {
  const parcelas = [1, 2, 3].map((n) => ({ id: `t${n}`, installment_no: n, amount_cents: 30000, occurred_at: `2026-0${6 + n}-10`, status: n === 1 ? 'cleared' : 'pending', invoice_id: null }));
  const ui = screen('src/app/finance/installments.tsx', {
    plans: [{ id: 'p1', title: 'tv', description: 'tv', merchant: null, category: 'casa', account_id: null, total_cents: 90000, installments: 3, installment_cents: 30000, first_occurred_at: '2026-07-10', active: true, paid: 1, remaining_cents: 60000, locked: 1, locked_cents: 30000, locked_paid: 1, parcels: parcelas }],
  });
  const [card] = deslizaveis(ui);
  assert.ok(card, 'a compra está num Deslizavel');
  assert.deepEqual(ladosDe(card), { direita: ['Editar a compra'], esquerda: ['Apagar a compra inteira'], mais: true, pontaDireita: 'Editar a compra', pontaEsquerda: 'Apagar a compra inteira' });
});

/**
 * Na linha de extrato o valor sobe para a linha do título e, sem espaço, desce para baixo dele.
 * Ele NÃO encolhe a fonte: no iOS o `adjustsFontSizeToFit` que encolhe numa passada de layout
 * estreita (a troca de tema re-layouta a lista) não cresce de volta — "pc gamer (6/8)" ficou com
 * o valor minúsculo até sair da tela (medido no simulador em 23/09/2026).
 */
test('Lançamentos: a linha é componente memoizado, sem entrada animada, com separador e ações estáveis', () => {
  // 06/10/2026: cada linha tinha `entering={FadeInDown…delay}` (refeita a cada "Ver mais") e o
  // `renderItem` recriava o separador e as ações a cada render da tela.
  const fonte = readFileSync(transacoesFile, 'utf8');
  assert.doesNotMatch(fonte, /entering=|FadeInDown/, 'lista que se lê não se move por estética (design §5)');
  assert.match(fonte, /const LinhaDoExtrato = memo\(/);
  assert.match(fonte, /ItemSeparatorComponent=\{Separador\}/);
  const ui = screen(transacoesFile);
  const linhas = ui.nodes().filter((n: any) => n.type?.name === 'LinhaDoExtrato');
  assert.ok(linhas.length > 0, 'as linhas gravadas são o componente');
  for (const linha of linhas) {
    assert.equal(typeof linha.props.onPagar, 'function');
    assert.equal(typeof linha.props.onApagar, 'function');
  }
});

test('Lançamentos: o valor da linha não encolhe a fonte', () => {
  const [link] = itemLinks(screen(transacoesFile));
  const linha = link.props.children({ onLongPress() {} });
  assert.equal(linha.props.inlineValue, true, 'a linha do extrato usa o valor na linha do título');
  // Não encolher é o padrão do `Money` desde 24/09/2026; a linha só não pode LIGAR o encolher.
  assert.notEqual(linha.props.trailing.props.encolhe, true);
});

test('Row: extrato deixa dinheiro quebrar de linha sem herdar ajuste de fonte do trailing', () => {
  for (const inlineValue of [true, false]) {
    const ui = screen('src/components/ui/row.tsx', { componente: 'Row', props: {
      title: 'QA F04 IOS Pix 20261002', inlineValue,
      trailing: { type: 'Money', props: { cents: -1235 } },
    } });
    assert.equal(ui.nodes().find(n => n.type === 'DinheiroEncolhe.Provider').props.value, false, 'nada encolhe antes de a linha ser medida');
    const row = ui.nodes().find(n => n.type === 'View' && n.props.onLayout);
    ui.interact(() => row.props.onLayout({ nativeEvent: { layout: { width: 370 } } }));
    const context = ui.nodes().find(n => n.type === 'DinheiroEncolhe.Provider');
    assert.ok(context, 'testar a fronteira real entre Row e Money, além dos props da tela');
    // Nenhum dos dois encolhe numa linha comum: a coluna medida estreita deixava o valor minúsculo no iPhone.
    assert.equal(context.props.value, false, 'o ajuste só existe sobre a linha inteira reservada ao valor');
    assert.equal(ui.nodes().find(n => n.type === 'Money').props.cents, -1235);
  }
});

test('Row: fonte de acessibilidade reserva uma linha completa antes de ajustar dinheiro grande', () => {
  const ui = screen('src/components/ui/row.tsx', { componente: 'Row', fontScale: 3.12, props: {
    title: 'Extrato com valor grande', inlineValue: true, icon: 'banknote', chevron: true,
    trailing: { type: 'Money', props: { cents: -99999999999 } },
  } });
  const row = ui.nodes().find(n => n.type === 'View' && n.props.onLayout);
  ui.interact(() => row.props.onLayout({ nativeEvent: { layout: { width: 402 } } }));
  const context = ui.nodes().find(n => n.type === 'DinheiroEncolhe.Provider');
  assert.equal(context.props.value, true, 'o ajuste só pode ocorrer sobre a linha inteira');
  const value = ui.nodes().find(n => n.type === 'View' && n.props.style?.some?.((s: any) => typeof s?.width === 'number' && s.width > 200));
  assert.ok(value, 'largura explícita para a linha do valor, sem disputar com o título');
});

/**
 * Quem já está no Pro via o card do Pro marcado e, embaixo, "Começar 7 dias grátis" — oferta de
 * teste para o plano que a pessoa já tem (visto no iPhone em 24/09/2026). O botão diz o que é.
 */
test('Paywall: no plano que a pessoa já tem, o botão não oferece dias grátis', () => {
  const noPro = screen('src/app/paywall.tsx', { plan: 'pro' });
  const botaoPro = noPro.nodes().find((n: any) => n.type === 'Button');
  assert.ok(botaoPro, 'o botão existe');
  assert.equal(botaoPro.props.label, 'Seu plano atual');
  const noFree = screen('src/app/paywall.tsx', { plan: 'free' });
  assert.match(String(noFree.nodes().find((n: any) => n.type === 'Button').props.label), /dias grátis/);
});

test('Ciclo: dentro de cada grupo, do mais recente para o mais antigo, e 20 por vez com "Ver mais"', () => {
  const linhas = Array.from({ length: 25 }, (_, i) => ({
    day: `2026-09-${String(11 + i).padStart(2, '0')}`.replace(/-(3[2-9]|4\d)$/, (m) => `-${m.slice(1)}`),
    in_cents: 0, out_cents: 1000 + i, title: `gasto ${i + 1}`, origin: 'transaction', ref_id: `t${i}`,
    method_label: null, atrasada: false,
  })).map((l, i) => ({ ...l, day: i < 20 ? `2026-09-${String(11 + i)}` : `2026-10-0${i - 19}` }));
  const ui = screen('src/app/finance/cycle.tsx', { cycleLines: linhas });
  const dias = () => ui.nodes().filter((n: any) => typeof n.type === 'function' && n.type.name === 'Linha').map((n: any) => n.props.linha.day);
  assert.equal(dias().length, 20, 'só o primeiro passo');
  assert.equal(dias()[0], '2026-10-05', 'o mais recente primeiro');
  assert.deepEqual([...dias()].sort().reverse(), dias(), 'em ordem decrescente');
  const mais = ui.nodes().find((n: any) => n.type === 'VerMais');
  assert.equal(mais.props.restantes, 5);
  ui.interact(() => mais.props.onPress());
  assert.equal(dias().length, 25);
  assert.equal(dias().at(-1), '2026-09-11', 'o mais antigo por último');
});

test('Importar: a prévia desenha cada grupo aos poucos, e "Marcar todos" continua valendo para o grupo inteiro', () => {
  const itens = Array.from({ length: 45 }, (_, i) => ({
    id: `i${i}`, status: 'pending', kind: 'expense', nature: 'compra', amount_cents: 1000 + i,
    occurred_at: `2026-09-${String((i % 28) + 1).padStart(2, '0')}`, description: `compra ${i}`, suggested_category: 'mercado',
  }));
  const ui = screen(importFile, { params: { batch: 'b1' }, forecastAccounts: contasDoImport, importItems: itens });
  const linhas = () => ui.nodes().filter((n: any) => n.type === 'ImportRow');
  assert.equal(linhas().length, 20);
  const cabecalho = ui.nodes().find((n: any) => n.type === 'SectionHead' && /^Novos/.test(n.props.title));
  assert.match(cabecalho.props.title, /45$/, 'o título conta o grupo inteiro');
  const mais = ui.nodes().find((n: any) => n.type === 'VerMais');
  assert.equal(mais.props.restantes, 25);
  ui.interact(() => mais.props.onPress());
  assert.equal(linhas().length, 40);
});

test('Importar: a linha se edita antes de importar — título, tipo e categoria', () => {
  // 26/09/2026, "tudo que se cria se edita": o título que a importação vai gravar muda na prévia.
  const itens = [{ id: 'i1', status: 'pending', kind: 'expense', nature: 'compra', amount_cents: 1990, occurred_at: '2026-09-10', description: 'PAG*IFOOD 123', suggested_category: 'restaurante' }];
  const ui = screen(importFile, { params: { batch: 'b1' }, forecastAccounts: contasDoImport, importItems: itens });
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'ImportRow').props.onLongPress('i1'));
  ui.interact(() => ui.actions.find((a: any) => a.label === 'Editar').onPress());
  const campo = () => ui.nodes().find((n: any) => n.type === 'TextField' && n.props.accessibilityLabel === 'Título');
  assert.equal(campo().props.value, 'PAG*IFOOD 123');
  ui.interact(() => campo().props.onChangeText('iFood'));
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'Sheet').props.onClose());
  const gravou = ui.writes.find((w: any) => w.operation === 'updateImportItem');
  assert.deepEqual(JSON.parse(JSON.stringify(gravou.value)), { id: 'i1', description: 'iFood' });
});

test('Importar: "Está no app e não veio no arquivo" vem do mais recente para o mais antigo, aos poucos', () => {
  const sobrando = Array.from({ length: 25 }, (_, i) => ({
    id: `t${i}`, description: `lanç ${i}`, category: null, amount_cents: 100,
    occurred_at: `2026-09-${String(i + 1).padStart(2, '0')}`,
  }));
  const ui = screen(importFile, {
    params: { batch: 'b1' }, forecastAccounts: contasDoImport,
    importBatch: { status: 'done', account_id: 'conta-1', accounts: { type: 'checking' } }, unmatched: sobrando,
  });
  const linhas = ui.nodes().filter((n: any) => n.type === 'Row' && /^lanç /.test(n.props.title));
  assert.equal(linhas.length, 20);
  assert.equal(linhas[0].props.title, 'lanç 24', 'o mais recente primeiro');
  assert.ok(ui.nodes().some((n: any) => n.type === 'VerMais' && n.props.restantes === 5));
});

test('Projeção: "Atrasado" e os meses aparecem aos poucos, com "Ver mais"', () => {
  const atrasadas = Array.from({ length: 25 }, (_, i) => ({
    kind: 'bill', ref_id: `b${i}`, title: `conta ${i}`, amount_cents: 1000, due_date: `2026-08-${String(i + 1).padStart(2, '0')}`, overdue: true,
  }));
  const ui = screen(forecastFile, { forecastAccounts: [{ id: 'conta-1' }], bills: atrasadas });
  assert.equal(ui.nodes().filter((n: any) => n.type === 'Deslizavel').length, 20);
  assert.ok(ui.nodes().some((n: any) => n.type === 'VerMais' && n.props.restantes === 5));

  const meses = Array.from({ length: 30 }, (_, i) => ({
    mes: `${2026 + Math.floor((8 + i) / 12)}-${String(((8 + i) % 12) + 1).padStart(2, '0')}-01`,
    entra: 0, sai: 0, saldo: 1000, parcial: false, primeiroNegativo: null, de: '2026-09-01', ate: '2026-09-30',
  }));
  const ui2 = screen(forecastFile, { forecastAccounts: [{ id: 'conta-1' }], forecastMonths: meses });
  ui2.interact((nodes: any[]) => nodes.find((n) => n.type === 'Segmented' && n.props.options.some((o: any) => o.value === 'mes')).props.onChange('mes'));
  const mais = ui2.nodes().find((n: any) => n.type === 'VerMais' && n.props.restantes === 10);
  assert.ok(mais, 'os 30 meses em passos de 20');
});

test('Recorrentes: cada seção aparece aos poucos, com "Ver mais"', () => {
  const series = Array.from({ length: 25 }, (_, i) => ({
    id: `rec-${i}`, description: `série ${i}`, kind: 'expense', amount_cents: 1000, rrule: 'FREQ=MONTHLY;BYMONTHDAY=15',
    dtstart: '2026-01-15', next_run_at: '2026-10-15T12:00:00Z', active: true, account_id: null, category: 'casa',
  }));
  const ui = screen('src/app/finance/recurring.tsx', { recurring: series });
  assert.equal(ui.nodes().filter((n: any) => n.type === 'Deslizavel').length, 20);
  const mais = ui.nodes().find((n: any) => n.type === 'VerMais' && n.props.restantes === 5);
  assert.ok(mais);
  ui.interact(() => mais.props.onPress());
  assert.equal(ui.nodes().filter((n: any) => n.type === 'Deslizavel').length, 25);
});

test('Metas: o extrato vem aos poucos, e o total do mês continua sendo o do mês inteiro', () => {
  // 25 aportes em setembro, do mais recente para o mais antigo (a consulta já ordena assim).
  const aportes = Array.from({ length: 25 }, (_, i) => ({
    id: `c${i}`, goal_id: 'g1', amount_cents: 1000, occurred_at: `2026-09-${String(25 - i).padStart(2, '0')}`, note: null,
  }));
  const ui = screen('src/app/finance/goals.tsx', {
    goals: [{ id: 'g1', name: 'Viagem', target_cents: 500000, saved_cents: 25000, deadline: null, archived: false }],
    contributions: aportes,
  });
  ui.interact(() => deslizaveis(ui)[0].props.acoes.find((x: any) => x.label === 'Ver extrato').onPress());
  const doExtrato = () => deslizaveis(ui).filter((d: any) => d.props.acoes.some((x: any) => x.label === 'Apagar o aporte'));
  assert.equal(doExtrato().length, 20);
  const secao = ui.nodes().find((n: any) => n.type === 'Section' && /setembro/.test(n.props.title ?? ''));
  assert.match(secao.props.title, /R\$ 250\.00$/, 'o total do mês conta os 25');
  const mais = ui.nodes().find((n: any) => n.type === 'VerMais' && n.props.restantes === 5);
  ui.interact(() => mais.props.onPress());
  assert.equal(doExtrato().length, 25);
});

test('Parcelada aberta: "A seguir" a partir da próxima, e "Pagas" da mais recente para a mais antiga', () => {
  const parcelas = [1, 2, 3, 4].map((n) => ({ id: `t${n}`, installment_no: n, amount_cents: 30000, occurred_at: `2026-0${6 + n}-10`, status: n <= 2 ? 'cleared' : 'pending', invoice_id: null }));
  const ui = screen('src/app/finance/installments.tsx', {
    plans: [{ id: 'p1', title: 'tv', description: 'tv', merchant: null, category: 'casa', account_id: null, total_cents: 120000, installments: 4, installment_cents: 30000, first_occurred_at: '2026-07-10', active: true, paid: 2, remaining_cents: 60000, locked: 2, locked_cents: 60000, locked_paid: 2, parcels: parcelas }],
  });
  ui.interact((nodes: any[]) => nodes.find((n) => (n.type === 'Pressable' || n.type === 'PressableScale') && n.props.accessibilityState?.expanded === false).props.onPress());
  const ordem = ui.nodes()
    .filter((n: any) => n.type === 'Pressable' && /^Parcela \d/.test(n.props.accessibilityLabel ?? ''))
    .map((n: any) => Number(n.props.accessibilityLabel.match(/^Parcela (\d+)/)[1]));
  assert.deepEqual(JSON.parse(JSON.stringify(ordem)), [3, 4, 2, 1]);
});

test('Regras: a lista vem aos poucos, com "Ver mais"', () => {
  const regras = Array.from({ length: 23 }, (_, i) => ({ id: `r${i}`, pattern: `loja ${i}`, category: 'casa', priority: i, hits: 0, active: true }));
  const ui = screen('src/app/finance/rules.tsx', { rules: regras });
  assert.equal(ui.nodes().filter((n: any) => n.type === 'Deslizavel').length, 20);
  assert.ok(ui.nodes().some((n: any) => n.type === 'VerMais' && n.props.restantes === 3));
});

test('Categoria: a folha de "Todas…" mostra aos poucos, e a busca recomeça', () => {
  const usadas = Array.from({ length: 30 }, (_, i) => ({ category: `categoria ${String(i).padStart(2, '0')}`, uses: 30 - i }));
  const ui = screen('src/components/finance/category-picker.tsx', { componente: 'CategoryPicker', props: { value: null, onChange: () => {} }, categoriasUsadas: usadas });
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'Chip' && n.props.label === 'Todas…').props.onPress());
  // pelo nome: o ícone agora é o da categoria (`useAparencia`), não um `tag` fixo
  const opcoes = () => ui.nodes().filter((n: any) => n.type === 'Row' && String(n.props.title).startsWith('categoria '));
  assert.equal(opcoes().length, 20);
  const mais = ui.nodes().find((n: any) => n.type === 'VerMais');
  assert.ok(mais.props.restantes > 0);
});

test('Lembretes: vêm do servidor em páginas; "Ver mais" busca a próxima', () => {
  const ui = screen('src/app/reminders.tsx', {
    reminders: [{ id: 'r1', title: 'Aluguel', active: true, next_run_at: '2026-10-05T12:00:00Z', recurrence: null }],
    maisPaginas: true,
  });
  const mais = ui.nodes().find((n: any) => n.type === 'VerMais');
  assert.ok(mais, 'tem mais no servidor: o botão aparece');
  ui.interact(() => mais.props.onPress());
  assert.ok(ui.refetches.includes('proxima-pagina'));
});

test('Alertas e importações: o servidor manda 20; "Ver mais" pede mais 20', () => {
  const alertas = Array.from({ length: 20 }, (_, i) => ({ id: `a${i}`, workspace_id: 'w', kind: 'bill_due', ref: `r${i}`, sent_on: '2026-09-20', channel: 'push', created_at: `2026-09-20T10:${String(i).padStart(2, '0')}:00Z` }));
  const ui = screen('src/app/profile/alerts.tsx', { alerts: alertas });
  assert.equal(ui.pedidosDeLimite.at(-1)?.[1], 20);
  const mais = ui.nodes().find((n: any) => n.type === 'VerMais');
  assert.equal(mais.props.restantes, null, 'veio a página cheia: pode ter mais');
  ui.interact(() => mais.props.onPress());
  assert.equal(ui.pedidosDeLimite.at(-1)?.[1], 40);

  const lotes = Array.from({ length: 20 }, (_, i) => ({ id: `b${i}`, filename: `f${i}.ofx`, source: 'ofx', account_id: null, status: 'done', error: null, created_at: '2026-09-20T10:00:00Z', total: 1, pendentes: 0, aprovados: 1, descartados: 0, duplicados: 0 }));
  const ui2 = screen('src/app/import-history.tsx', { batches: lotes });
  const mais2 = ui2.nodes().find((n: any) => n.type === 'VerMais');
  assert.equal(mais2.props.restantes, null);
  ui2.interact(() => mais2.props.onPress());
  assert.equal(ui2.pedidosDeLimite.filter((p: any) => p[0] === 'batches').at(-1)?.[1], 40);
});

test('Notas arquivadas: com mais no servidor, "Ver mais" busca a próxima página', () => {
  const notas = [{ id: 'n1', content: 'Reunião', archived_at: '2026-09-20T10:00:00Z', pinned: false, color: null }];
  const ui = screen('src/app/notes/archived.tsx', { notes: notas, maisPaginas: true });
  const mais = ui.nodes().find((n: any) => n.type === 'VerMais');
  assert.equal(mais.props.restantes, null);
  ui.interact(() => mais.props.onPress());
  assert.ok(ui.refetches.includes('proxima-pagina'));
});

test('Arquivadas: segurar a pasta apaga (com confirmação), segurar a nota manda à lixeira', () => {
  // 25/09/2026: *"Eu não consigo apagar uma pasta?"* — arquivada, ela só voltava.
  const ui = screen('src/app/notes/archived.tsx', {
    notes: [{ id: 'n1', content: 'Reunião', archived_at: '2026-09-20T10:00:00Z', pinned: false, color: null }],
    pastasArquivadas: [{ id: 'f1', name: 'viagem', icon: 'folder', color: null, pinned: false, archived_at: '2026-09-20T10:00:00Z', tags: [], notes_count: 0 }],
  });
  const linha = (titulo: string) => ui.nodes().find((n: any) => n.type === 'Row' && n.props.title === titulo);
  ui.interact(() => linha('viagem').props.onLongPress());
  assert.deepEqual(ui.actions.map((a: any) => a.label), ['Desarquivar', 'Apagar']);
  ui.interact(() => ui.actions.find((a: any) => a.label === 'Apagar').onPress());
  assert.equal(ui.writes.length, 0, 'nada sai sem confirmar');
  assert.equal(ui.avisos.at(-1), 'apagar viagem: null', 'arquivada não sabe quantas notas tem: não diz "vazia"');
  ui.interact(() => ui.confirmations.at(-1)());
  assert.deepEqual(ui.writes.at(-1), { operation: 'useDeleteFolder', value: 'f1' });

  ui.actions.length = 0;
  ui.interact(() => linha('Reunião').props.onLongPress());
  assert.deepEqual(ui.actions.map((a: any) => a.label), ['Desarquivar', 'Lixeira']);
  ui.interact(() => ui.actions.find((a: any) => a.label === 'Lixeira').onPress());
  assert.deepEqual(ui.writes.at(-1), { operation: 'useTrashNote', value: 'n1' });
});

test('Hoje: muito atrasado vira UMA linha que abre no lugar, aos poucos, com "Ver mais"', () => {
  const contas = Array.from({ length: 25 }, (_, i) => ({ ref_id: `c${i}`, title: `conta ${i}`, due_date: `2026-08-${String(i + 1).padStart(2, '0')}`, amount_cents: 1000, kind: 'transaction', overdue: true }));
  const ui = screen(hojeFile, { bills: contas });
  const resumo = ui.nodes().find((n: any) => n.type === 'LinhaDoAtrasado');
  assert.deepEqual(copia(resumo.props.resumo), { contas: 25, contasCents: 25_000, entradas: 0, entradasCents: 0, desde: '2026-08-01' });
  assert.equal(ui.nodes().filter((n: any) => n.type === 'AgendaItem').length, 0, 'recolhido: nada de 25 linhas vermelhas');
  ui.interact(() => resumo.props.onAlternar());
  assert.equal(ui.nodes().filter((n: any) => n.type === 'AgendaItem').length, 20);
  const verMais = ui.nodes().find((n: any) => n.type === 'VerMais');
  assert.equal(verMais.props.restantes, 5);
  ui.interact(() => verMais.props.onPress());
  assert.equal(ui.nodes().filter((n: any) => n.type === 'AgendaItem').length, 25);
});

test('Busca: em "Tudo" cada tipo mostra 5 e "Ver mais" abre o tipo; dentro dele, "Ver mais" pede mais 20', () => {
  // 21 = o limite (20) + 1: o servidor tem mais.
  const notas = Array.from({ length: 21 }, (_, i) => ({ id: `n${i}`, content: `mercado ${i}`, folder_id: null, source: 'app', updated_at: '2026-09-20T10:00:00Z' }));
  const ui = screen('src/app/search.tsx', { buscaNotas: notas });
  const linhas = () => ui.nodes().filter((n: any) => n.type === 'Row' && /^mercado /.test(n.props.title));
  assert.equal(linhas().length, 5);
  const chip = ui.nodes().find((n: any) => n.type === 'Chip' && /^Notas/.test(n.props.label));
  assert.equal(chip.props.label, 'Notas 20+', 'o chip não finge que 20 é o total');
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'VerMais').props.onPress());
  assert.equal(linhas().length, 20, 'abriu o tipo');
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'VerMais').props.onPress());
  assert.equal(ui.pedidosDeLimite.at(-1)?.[1], 40);
});

test('Contas: dentro de cada seção, a conta mais recente primeiro', () => {
  const saldo = (id: string, name: string) => ({ account_id: id, name, type: 'checking', balance_cents: 0, cleared_cents: 0, pending_in_cents: 0, pending_out_cents: 0 });
  const ui = screen('src/app/finance/accounts.tsx', {
    // `useAccounts` vem por ordem de criação (a mais antiga primeiro); o saldo vem sem ordem.
    forecastAccounts: [
      { id: 'velha', name: 'Beta', type: 'checking', created_at: '2026-08-01T10:00:00Z' },
      // No empate a POSIÇÃO diz Zeta antes de Alfa; quem decide é o nome.
      { id: 'empate', name: 'Alfa', type: 'checking', created_at: '2026-09-01T10:00:00Z' },
      { id: 'nova', name: 'Zeta', type: 'checking', created_at: '2026-09-01T10:00:00Z' },
    ],
    balances: [saldo('velha', 'Beta'), saldo('nova', 'Zeta'), saldo('empate', 'Alfa')],
  });
  const ordem = ui.nodes().filter((n: any) => n.type === 'ItemLink').map((n: any) => n.props.title);
  // A mais recente primeiro; no empate (criadas juntas), o nome.
  assert.deepEqual(JSON.parse(JSON.stringify(ordem)), ['Alfa', 'Zeta', 'Beta']);
});

test('Faturas: fatura FUTURA sem compra nenhuma não aparece em "Próximas faturas"', () => {
  const fatura = (id: string, mes: string, n: number) => ({ id, reference_month: `${mes}-01`, closing_date: `${mes}-03`, due_date: `${mes}-10`, status: 'open', paid_at: null, payment_transaction_id: null, rolled_into_invoice_id: null, total_cents: n * 1000, tx_count: n });
  const ui = screen('src/app/finance/invoices.tsx', {
    forecastAccounts: [{ id: 'card-1', name: 'Nubank Cartão', type: 'credit_card' }],
    faturas: [fatura('f3', '2028-01', 0), fatura('f2', '2027-02', 2), fatura('f1', '2026-09', 3)],
  });
  const proximas = ui.nodes().find((n: any) => n.type === 'Section' && n.props.title === 'Próximas faturas');
  const titulos = ui.nodes().filter((n: any) => n.type === 'Row' && n.props.icon === 'calendar').map((n: any) => n.props.title);
  assert.ok(proximas);
  assert.equal(titulos.length, 1, 'só a que tem compra');
});

test('Dinheiro não encolhe por padrão; encolhe só onde o bloco tem geometria fixa (24/09/2026)', () => {
  // No iPhone o `adjustsFontSizeToFit` encolhe numa passada de layout estreita e não volta a
  // crescer: "Comecei com" e a parcela do macbook ficaram minúsculos no ciclo.
  const solto = screen('src/components/ui/money.tsx', { componente: 'Money', props: { cents: 4890500 } });
  assert.equal(solto.nodes().find((n: any) => n.type === 'ThemedText').props.adjustsFontSizeToFit, false);
  const noBloco = screen('src/components/ui/money.tsx', { componente: 'Money', props: { cents: 4890500, encolhe: true } });
  assert.equal(noBloco.nodes().find((n: any) => n.type === 'ThemedText').props.adjustsFontSizeToFit, true);
  // Quem tem geometria fixa liga o encolher para o valor que recebe.
  for (const arquivo of ['src/components/ui/tile.tsx', 'src/components/ui/hero-panel.tsx', 'src/components/finance/card-face.tsx']) {
    assert.match(readFileSync(arquivo, 'utf8'), /DinheiroEncolhe\.Provider value|<Money[^>]*\bencolhe\b/, arquivo);
  }
});

test('Importações: apagar o registro diz o que fica no financeiro sem "Os 0 lançamentos"', () => {
  const lote = (aprovados: number) => ({ id: `b${aprovados}`, filename: 'f.csv', source: 'csv', account_id: null, status: 'done', error: null, created_at: '2026-09-20T10:00:00Z', total: 3, pendentes: 0, aprovados, descartados: 3 - aprovados, duplicados: 0 });
  for (const [n, esperado] of [[0, /Nada desta importação entrou no financeiro/], [1, /^O lançamento que você confirmou continua/], [3, /^Os 3 lançamentos que você confirmou continuam/]] as const) {
    const ui = screen('src/app/import-history.tsx', { batches: [lote(n)] });
    const linha = ui.nodes().find((x: any) => x.type === 'Deslizavel');
    ui.interact(() => linha.props.acoes.find((a: any) => a.label === 'Apagar registro').onPress());
    assert.match(ui.avisos.at(-1), esperado, `com ${n} confirmados`);
  }
});

test('Orçamentos: "Sem limite definido" mostra 5 e o resto vem pelo "Ver mais" (era corte calado)', () => {
  const gastos = Array.from({ length: 8 }, (_, i) => ({ category: `cat ${i}`, kind: 'expense', total_cents: 10000 - i * 100, count: 1 }));
  const ui = screen('src/app/finance/budgets.tsx', { saiuNoCiclo: gastos });
  const sugestoes = () => ui.nodes().filter((n: any) => n.type === 'Button' && n.props.label === 'Definir limite');
  assert.equal(sugestoes().length, 5);
  const mais = ui.nodes().find((n: any) => n.type === 'VerMais');
  assert.equal(mais?.props.restantes, 3);
  ui.interact(() => mais.props.onPress());
  assert.equal(sugestoes().length, 8);
});

test('Últimos lançamentos: a linha recebe o toque do Link do iOS (24/09/2026)', () => {
  // No iOS o `ItemLink` é `<Link asChild>`, que INJETA `onPress` no filho, e o filho vem sem
  // `onLongPress` (quem abre o menu lá é o `Link.Menu`). O `LedgerRow` desenhava uma `View` sem
  // `onLongPress` e jogava o `onPress` fora: tocar no lançamento não abria nada.
  let tocou = 0;
  const ui = screen('src/components/ui/ledger-row.tsx', {
    componente: 'LedgerRow',
    props: { title: 'Ferramentas', icon: 'house', cents: -44300, signed: true, tone: 'text', date: '11/09/2026', accessibilityLabel: 'Ferramentas', onPress: () => { tocou += 1; } },
  });
  const tocavel = ui.nodes().find((n: any) => n.type === 'Pressable' && typeof n.props.onPress === 'function');
  assert.ok(tocavel, 'a linha é tocável quando o Link injeta onPress');
  tocavel.props.onPress();
  assert.equal(tocou, 1);
});

test('Todo filho de ItemLink repassa o onPress que o Link do iOS injeta', () => {
  // Contrato de `ItemLink` (iOS): o filho recebe `onPress` do `<Link asChild>`. Componente novo
  // que não o repassa fica mudo no iPhone e funciona no Android — foi o `LedgerRow`.
  const repassam = new Set(['Row', 'Pressable', 'LedgerRow']);
  const arquivos = ['src/app/(tabs)/finance/index.tsx', 'src/app/finance/accounts.tsx', 'src/app/finance/transactions.tsx', 'src/app/finance/invoice/[id].tsx', 'src/components/notes/note-card.tsx'];
  for (const arquivo of arquivos) {
    const fonte = readFileSync(arquivo, 'utf8');
    for (const m of fonte.matchAll(/\{\(\{ onLongPress \}\) => \(\s*<([A-Z][A-Za-z]*)/g)) {
      assert.ok(repassam.has(m[1]), `${arquivo}: <${m[1]}> como filho de ItemLink precisa repassar onPress`);
    }
  }
  for (const [comp, arquivo] of [['Row', 'src/components/ui/row.tsx'], ['LedgerRow', 'src/components/ui/ledger-row.tsx']]) {
    assert.match(readFileSync(arquivo, 'utf8'), /\bonPress\b[\s\S]*<Pressable[\s\S]*onPress=\{onPress\}/, `${comp} repassa onPress ao Pressable`);
  }
});

test('Row: fonte máxima e painel estreito conservam título e valor dentro da largura medida', () => {
  for (const { fontScale, ajustes } of [
    { fontScale: 1, ajustes: [false, true, false, false] },
    { fontScale: 1.3, ajustes: [true, true, false, true] },
    { fontScale: 3.12, ajustes: [true, true, true, true] },
  ]) {
    const ui = screen('src/components/ui/row.tsx', { componente: 'Row', fontScale, props: {
      title: 'macbook (12/12)', subtitle: 'compra em 01/09/2026', inlineValue: true,
      trailing: { type: 'Money', props: { cents: 78000 } },
    } });
    const flat = (style: any) => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
    for (const [index, width] of [370, 260, 600, 370].entries()) {
      const row = ui.nodes().find(n => n.type === 'View' && n.props.onLayout);
      assert.ok(row, 'medir a linha real: largura da janela não é a largura de um painel');
      ui.interact(() => row.props.onLayout({ nativeEvent: { layout: { width } } }));
      const title = ui.nodes().find(n => n.type === 'ThemedText' && n.props.children === 'macbook (12/12)');
      assert.equal(flat(title.props.style).minWidth, Math.min(134 * Math.max(1, fontScale), width - 32));
      assert.ok(flat(title.props.style).minWidth <= width - 32);
      const boundedMoney = ui.nodes().find(n => n.type === 'DinheiroEncolhe.Provider');
      assert.equal(boundedMoney?.props.value, ajustes[index], 'extrato normal conserva a fonte; painel sem espaço para duas colunas ajusta o valor na linha inteira');
      assert.ok(ui.nodes().some(n => n.type === 'View' && flat(n.props.style).maxWidth === '100%' && flat(n.props.style).marginLeft === 'auto'));
    }
  }
});

test('Lançamentos: a linha diz a data da COMPRA, nunca o vencimento da fatura (24/09/2026)', () => {
  // "o wardogs mostra na data que vai entrar na fatura ao invés de mostrar a data que o
  // lançamento foi feito de fato" — a linha escrevia "na fatura de 10/10" e nada da compra.
  const base = { kind: 'expense', amount_cents: 5250, category: 'jogos', account_id: 'c1', status: 'pending', invoice_id: 'f1', source: 'app' };
  const ui = screen('src/app/finance/transactions.tsx', {
    txs: [
      { ...base, id: 'w1', description: 'wardogs (1/2)', occurred_at: '2026-09-14', due_at: '2026-10-10', installment_no: 1, installment_plan_id: 'p', installment_plans: { first_occurred_at: '2026-09-14' } },
      { ...base, id: 'w2', description: 'wardogs (2/2)', occurred_at: '2026-10-14', due_at: '2026-11-10', installment_no: 2, installment_plan_id: 'p', installment_plans: { first_occurred_at: '2026-09-14' } },
      { ...base, id: 'b1', description: 'Boleto', occurred_at: '2026-10-08', due_at: '2026-10-08', invoice_id: null, installment_no: null, installment_plans: null },
    ],
  });
  // A linha mora no render prop do `ItemLink`, que o harness não desce sozinho.
  const legenda = (titulo: string) => {
    const link = ui.nodes().find((n: any) => n.type === 'ItemLink' && n.props.title === titulo);
    assert.ok(link, `linha ${titulo}`);
    return link.props.children({}).props.subtitle as string;
  };
  for (const t of ['wardogs (1/2)', 'wardogs (2/2)']) assert.doesNotMatch(legenda(t), /fatura/, t);
  const parcela = ui.nodes().find((n: any) => n.type === 'ItemLink' && n.props.title === 'wardogs (1/2)');
  ui.interact(() => parcela.props.actions.find((a: any) => a.label === 'Editar').onPress());
  assert.deepEqual(copia(ui.navigations.at(-1)), {
    pathname: '/finance/lancar', params: { tipo: 'uma', id: 'w1', origem: 'transacao', papel: 'parcela', month: '2026-09' },
  }, 'Editar a parcela abre a linha, cujo Salvar pergunta o alcance');
  assert.match(legenda('wardogs (2/2)'), /compra em 14\/09/);
  assert.doesNotMatch(legenda('wardogs (1/2)'), /compra em/, 'a parcela 1 já está no dia da compra');
  // Conta a pagar fora do cartão: o vencimento É a data dela.
  // (o `formatDateBR` do harness é um dublê de data fixa — o que se prende aqui é o rótulo)
  assert.match(legenda('Boleto'), /^vence /);
});

test('Lista principal vazia com seção secundária: a secundária em cima e o vazio COMPACTO embaixo', () => {
  // "A tela de arquivadas quando não tem nenhum financiamento e tem uma arquivada está horrível…
  // tem que mostrar o arquivadas em cima e depois embaixo mostrar que não tem nenhuma dívida
  // ativa. Esse layout tem que ser em todas as telas que tiver coisas assim." (24/09/2026)
  const ordem = (ui: any, secundaria: (n: any) => boolean) => {
    const nos = ui.nodes();
    const iSec = nos.findIndex(secundaria);
    const iVazio = nos.findIndex((n: any) => n.type === 'EmptyState');
    assert.ok(iSec >= 0, 'seção secundária na tela');
    assert.ok(iVazio >= 0, 'a tela diz que não há nada ativo');
    assert.ok(iSec < iVazio, 'secundária antes do vazio');
    assert.equal(nos[iVazio].props.compacto, true, 'o vazio é compacto quando há outra coisa na tela');
  };
  const carro = { id: 'd1', name: 'Carro', kind: 'financing', calculation_mode: 'fixed_installments', principal_cents: 100, remaining_cents: 100, installments: 10, installments_paid: 0, installment_cents: 10, due_day: 10, archived: true };
  ordem(screen(debtsFile, { create: false, debts: [], archivedDebts: [carro] }), (n: any) => n.type === 'Row' && /^Arquivadas/.test(n.props.title ?? ''));
  const meta = { id: 'g1', name: 'Viagem', target_cents: 1000, saved_cents: 1000, deadline: null, archived: false };
  ordem(screen('src/app/finance/goals.tsx', { goals: [meta] }), (n: any) => n.type === 'SectionHead' && /^Concluídas/.test(n.props.title ?? ''));
  const plano = { id: 'p1', title: 'tv', description: 'tv', merchant: null, category: null, account_id: null, total_cents: 1000, installments: 2, installment_cents: 500, first_occurred_at: '2026-01-01', active: false, paid: 2, remaining_cents: 0, locked: 2, locked_cents: 1000, locked_paid: 2, parcels: [] };
  ordem(screen('src/app/finance/installments.tsx', { plans: [plano] }), (n: any) => n.type === 'Section' && n.props.title === 'Terminadas');
  const serie = { id: 's1', description: 'Academia', kind: 'expense', amount_cents: 100, rrule: 'FREQ=MONTHLY;BYMONTHDAY=5', active: false, next_run_at: '2026-10-05T12:00:00Z', dtstart: '2026-01-05', category: null, account_id: null };
  ordem(screen('src/app/finance/recurring.tsx', { recurring: [serie] }), (n: any) => n.type === 'SectionHead' && n.props.title === 'Pausadas');
  ordem(screen('src/app/reminders.tsx', { reminders: [{ id: 'r1', title: 'Remédio', active: false, next_run_at: null, rrule: null }] }), (n: any) => n.type === 'Section' && n.props.title === 'Pausados');
  // Organizar pastas sem pasta nenhuma: "Sem pasta" é a linha que existe (25/09/2026).
  ordem(screen('src/app/notes/folders.tsx', { folders: [] }), (n: any) => n.type === 'Row' && n.props.title === 'Sem pasta');
});

const dicas = (ui: ReturnType<typeof screen>) =>
  ui.nodes().filter((n: any) => n.type === 'Dica').map((n: any) => n.props.id);

test('Hoje: a dica do painel mora no card do dinheiro, e tocar no valor a encerra', () => {
  const ui = screen(hojeFile, { balances: [saldo('Nubank', 'checking', 120_00)] });
  assert.deepEqual(dicas(ui), ['hoje-painel']);
  ui.nodes().find((n: any) => n.type === 'DinheiroDoDia').props.onAbrirMenu();
  assert.deepEqual(copia(ui.writes.at(-1)), { operation: 'usarDica', value: 'hoje-painel' });
  // A das contas só existe com as contas abertas na tela.
  ui.interact(() => ui.nodes().find((n: any) => n.type === 'DinheiroDoDia').props.onAlternarContas());
  assert.deepEqual(dicas(ui), ['hoje-painel', 'conta-extrato']);
});

test('Hoje: sem conta na tela, a dica das contas não é montada', () => {
  assert.deepEqual(dicas(screen(hojeFile)), ['hoje-painel']);
});

test('Lançamentos: a dica do arrasto aponta para a primeira linha, e some com a lista vazia', () => {
  assert.deepEqual(dicas(screen(transacoesFile)), ['lista-arrasto']);
  assert.deepEqual(dicas(screen(transacoesFile, { txs: [] })), []);
});

const guiaFile = 'src/app/guia.tsx';

test('Guia: "Mostrar" de um gesto acende a dica e leva à tela dela', () => {
  const ui = screen(guiaFile);
  const pilha = ui.nodes().find((n: any) => n.type === 'Row' && n.props.title === 'Todos os cartões');
  assert.ok(pilha, 'o item precisa estar no guia');
  pilha.props.onPress();
  assert.deepEqual(copia(ui.writes.at(-1)), { operation: 'reacenderDica', value: 'fin-pilha' });
  assert.equal(ui.navigations.at(-1), '/finance');
});

test('Guia: item sem dica só leva à tela, sem acender nada', () => {
  const ui = screen(guiaFile);
  ui.nodes().find((n: any) => n.type === 'Row' && n.props.title === 'Importar fatura ou extrato').props.onPress();
  assert.equal(ui.writes.length, 0);
  assert.equal(ui.navigations.at(-1), '/import');
});

const notasFile = 'src/app/(tabs)/notes/index.tsx';
const nota = (id: string, pinned = false) => ({ id, content: `Nota ${id}`, pinned, updated_at: '2026-09-20T12:00:00Z', folder_id: null, color: null });

test('Notas: a dica do arrasto aparece com notas na tela, e some com a lista vazia', () => {
  assert.deepEqual(dicas(screen(notasFile, { notes: [nota('n1')] })), ['lista-arrasto']);
  assert.deepEqual(dicas(screen(notasFile, { notes: [] })), []);
});

test('Notas: o arquivado tem porta no fim da aba, com a contagem, e ela some sem nada arquivado', () => {
  const ui = screen(notasFile, { notes: [nota('n1')], arquivadas: 2 });
  const porta = ui.nodes().find((n: any) => n.type === 'Row' && n.props.title === 'Arquivadas · 2');
  assert.ok(porta, 'a linha "Arquivadas · 2" precisa aparecer');
  porta.props.onPress();
  assert.equal(ui.navigations.at(-1), '/notes/archived');
  const sem = screen(notasFile, { notes: [nota('n1')] });
  assert.ok(!sem.nodes().some((n: any) => n.type === 'Row' && String(n.props.title).startsWith('Arquivadas')));
});

test('Card: os filhos têm respiro entre si — o texto e o botão não colam (design.md §2)', () => {
  // "É pagamento de uma dívida." colado no "Ver dívidas" (24/09/2026): o `Card` não punha espaço
  // entre filhos, e cada tela que esquecia do `gap` no próprio estilo saía assim.
  const ui = screen('src/components/ui/card.tsx', { componente: 'Card', props: { children: ['a', 'b'] } });
  const caixa = ui.nodes().find((n: any) => n.type === 'View');
  assert.ok(caixa, 'o card desenha uma View');
  const base = [caixa.props.style].flat(Infinity).find((s: any) => s && 'padding' in s);
  assert.ok(base && 'gap' in base, 'a base do Card tem `gap`');
});

test('Dívidas: parcela fixa paga com outro valor conta uma parcela e diz o encargo; fora do limite o botão espera', () => {
  // 25/09/2026: *"às vezes eu posso ter pago menos ou mais em uma parcela"*. O valor era só
  // leitura na parcela fixa, e o banco recusava qualquer outro.
  const ui = screen(debtsFile, {
    create: false, debts: [carro], params: { id: 'd1' },
    debtSchedule: [{ installment_no: 9, due_date: '2026-10-05', payment_cents: 147000, interest_cents: null, principal_cents: null, balance_cents: 0 }],
  });
  ui.press('Paguei esta parcela');
  const campo = () => ui.nodes().find((n: any) => n.type === 'Field' && n.props.label === 'Quanto você pagou');
  assert.ok(campo(), 'o valor é editável, como na dívida com juros');
  assert.equal(ui.nodes().find((n: any) => n.type === 'MoneyField').props.valueCents, 147000, 'nasce na parcela');
  assert.equal(campo().props.hint, undefined, 'no valor da parcela não há o que explicar');
  assert.ok(!ui.nodes().some((n: any) => n.type === 'SwitchRow'));

  ui.fill('Quanto você pagou', 150000);
  assert.equal(campo().props.hint.replace(/\s/g, ' '), 'Conta como 1 parcela; R$ 30,00 de encargo.');
  ui.fill('Quanto você pagou', 145000);
  assert.equal(campo().props.hint.replace(/\s/g, ' '), 'Conta como 1 parcela; R$ 20,00 de desconto.');

  ui.fill('Quanto você pagou', 300000);
  assert.match(campo().props.error, /passa de uma parcela/);
  assert.equal(ui.button('Registrar pagamento').props.disabled, true, 'o banco recusaria: o botão espera e o campo diz por quê');
  assert.ok(!ui.nodes().some((n: any) => n.type === 'SwitchRow'));

  // Pagar diferente, só este: vai direto, a diferença é encargo.
  ui.fill('Quanto você pagou', 150000);
  ui.press('Registrar pagamento');
  assert.deepEqual(JSON.parse(JSON.stringify(ui.writes.map((w: any) => w.operation))), ['payDebt']);
  assert.equal(ui.writes[0].value.amountCents, 150000);
});

test('Dívidas: "Usar este valor nas próximas" muda o contrato ANTES de pagar, e a parcela sai inteira no valor novo', () => {
  const ui = screen(debtsFile, {
    create: false, debts: [{ ...carro, updated_at: 'v1' }], params: { id: 'd1' },
    debtSchedule: [{ installment_no: 9, due_date: '2026-10-05', payment_cents: 147000, interest_cents: null, principal_cents: null, balance_cents: 0 }],
  });
  ui.press('Paguei esta parcela');
  ui.fill('Quanto você pagou', 150000);
  const chave = ui.nodes().find((n: any) => n.type === 'SwitchRow' && n.props.label === 'Usar este valor nas próximas');
  assert.ok(chave);
  ui.interact(() => chave.props.onValueChange(true));
  assert.equal(
    ui.nodes().find((n: any) => n.type === 'Field' && n.props.label === 'Quanto você pagou').props.hint.replace(/\s/g, ' '),
    'Esta e as próximas parcelas passam a R$ 1.500,00.',
  );
  ui.press('Registrar pagamento');
  assert.equal(ui.writes.length, 1, 'o pagamento espera o contrato mudar');
  const contrato = JSON.parse(JSON.stringify(ui.writes[0]));
  assert.equal(contrato.operation, 'saveDebt');
  assert.equal(contrato.value.id, 'd1');
  assert.equal(contrato.value.versao, 'v1', 'um pagamento pelo WhatsApp no meio não é sobrescrito');
  assert.equal(contrato.value.installment_cents, 150000);
  assert.equal(contrato.value.principal_cents, 150000 * 48);
  assert.equal(contrato.value.remaining_cents, 150000 * 40);
  assert.equal(contrato.value.installments_paid, 8);
  ui.interact(() => ui.pedidos[0].opts.onSuccess());
  assert.equal(ui.writes[1].operation, 'payDebt');
  assert.equal(ui.writes[1].value.amountCents, 150000);
});

test('a prestação da agenda abre A dívida dela, na Hoje e na Projeção — não a lista', () => {
  // `upcoming_bills` traz o id da dívida em `ref_id`; mandar para a lista fazia quem tem cinco
  // financiamentos caçar qual era (a mesma correção de `cycle-routes`).
  const prestacao = { ref_id: 'd1', title: 'Parcela Carro', due_date: '2026-09-10', amount_cents: 147000, kind: 'debt', overdue: false };
  const hoje = screen(hojeFile, { bills: [prestacao] });
  // Vence daqui a dois dias: está nos próximos dias, e a linha abre a dívida.
  hoje.interact(() => agendaItem(hoje, 'Parcela Carro').props.onPress());
  assert.deepEqual(copia(hoje.navigations.at(-1)), { pathname: '/finance/debts', params: { id: 'd1' } });

  const projecao = screen(forecastFile, { forecastAccounts: [{ id: 'conta-1' }], bills: [prestacao] });
  const linha = projecao.nodes().find((n: any) => n.type === 'Row' && n.props.title === 'Parcela Carro');
  assert.ok(linha, 'a prestação aparece na Projeção');
  projecao.interact(() => linha.props.onPress());
  assert.deepEqual(copia(projecao.navigations.at(-1)), { pathname: '/finance/debts', params: { id: 'd1' } });
});

test('Lançamento de parcela de dívida: embaixo do total, a parcela + o encargo; e o vínculo com a dívida', () => {
  // "quando eu clicar no lançamento, em baixo do valor total tem que mostrar o valor da parcela
  // mais desconto ou mais encargo" (25/09/2026). A frase sai da LINHA: corrigido o valor, muda.
  const pagamento = (amount: number) => ({
    id: 'pg-1', kind: 'expense', amount_cents: amount, occurred_at: '2026-09-15', description: 'Parcela Carro',
    category: 'dívidas', account_id: null, status: 'cleared', source: 'app', created_at: '2026-09-15T12:00:00Z',
    recurring_id: null, installment_plan_id: null, invoice_id: null,
    debt_id: 'd1', debt_payment_no: 3, debt_principal_cents: 10500, debt_balance_after_cents: 0,
    debts: { name: 'Carro', kind: 'financing', calculation_mode: 'fixed_installments', installments: 12 },
  });
  const textos = (amount: number) => {
    const ui = screen('src/app/finance/[txId].tsx', { txs: [pagamento(amount)], params: { txId: 'pg-1' } });
    return { ui, t: JSON.stringify(ui.nodes().filter((n: any) => n.type === 'ThemedText').map((n: any) => n.props.children)) };
  };
  assert.match(textos(11000).t.replace(/\s/g, ' '), /Parcela de R\$ 105[.,]00 \+ R\$ 5[.,]00 de encargo/);
  assert.match(textos(10000).t.replace(/\s/g, ' '), /Parcela de R\$ 105[.,]00 − R\$ 5[.,]00 de desconto/);
  assert.doesNotMatch(textos(10500).t, /encargo|desconto/, 'pago igual à parcela: nada a detalhar');
  const { ui } = textos(11000);
  const divida = ui.nodes().find((n: any) => n.type === 'Row' && n.props.title === 'Parcela 3 de 12');
  assert.ok(divida, 'Faz parte de: a dívida');
  assert.equal(divida.props.subtitle, 'Carro');
  // "Duplicar" criaria um gasto "Parcela Carro" solto, sem baixar a dívida: pagar é em Dívidas.
  const menu = ui.nodes().find((n: any) => n.type === 'HeaderActions')?.props.menu;
  assert.ok(menu, 'o "…" existe');
  assert.ok(!menu.actions.some((a: any) => a.label === 'Duplicar'), 'sem Duplicar no pagamento de dívida');
  ui.interact(() => menu.actions.find((a: any) => a.label === 'Mudar categoria').onPress());
  assert.deepEqual(copia(ui.navigations.at(-1)), {
    pathname: '/finance/lancar', params: { tipo: 'uma', id: 'pg-1', origem: 'transacao', papel: 'pagamento', month: '2026-09' },
  }, 'a categoria de um pagamento parcelado passa pela escolha de alcance');
});

test('Agente: as conversas recentes não desenham texto nem esqueleto enquanto carregam', () => {
  // "quando eu abro a tela e fica carregando o skeleton, ele aparece 'recentes' e se não tiver
  // nada, ele aparece como carregando e depois some" (25/09/2026). O bloco fica no fim da entrada,
  // abaixo do compositor e dos atalhos: chegar depois não empurra nada.
  const arquivo = 'src/components/agent/agent-recent-conversations.tsx';
  const carregando = screen(arquivo, { componente: 'AgentRecentConversations', conversationsPending: true });
  assert.deepEqual(carregando.nodes(), [], 'carregando: nada na tela');
  const vazio = screen(arquivo, { componente: 'AgentRecentConversations', conversations: [] });
  assert.deepEqual(vazio.nodes(), [], 'sem conversa: o bloco não existe');
  const com = screen(arquivo, {
    componente: 'AgentRecentConversations',
    conversations: [{ id: 'c1', title: 'Mercado', preview: null, last_message_at: '2026-09-25T10:00:00Z' }],
  });
  assert.ok(JSON.stringify(com.nodes().map((n: any) => n.props.children)).includes('Recentes'));
});

// "texto nunca deve aparecer em skeleton" (25/09/2026): enquanto um bloco carrega, ele é só
// forma — título, rótulo, contagem e legenda incluídos. Fica o controle que a pessoa tocou.
test('Financeiro: carregando o período, o rótulo do herói é forma — "Atualizando período" saiu', () => {
  const buscando = screen(financeiroFile, { rangePending: true });
  const heroi = buscando.nodes().find((n: any) => n.type === 'HeroPanel');
  assert.equal(heroi.props.label?.type, 'Skeleton', 'o rótulo vira forma junto com o valor');
  assert.equal(heroi.props.value.type, 'Skeleton');
  assert.ok(!JSON.stringify(buscando.nodes().map((n: any) => n.props)).includes('Atualizando'));
  const pronto = screen(financeiroFile);
  assert.equal(typeof pronto.nodes().find((n: any) => n.type === 'HeroPanel').props.label, 'string', 'sem este, o de cima não distinguiria nada');
});

test('Financeiro: com a série do mês chegando, Entra e Sai não deixam o rótulo sobre um vazio', () => {
  const chegando = screen(financeiroFile, { cycleSeriesPending: true });
  for (const lado of ['Entra', 'Sai']) {
    const tile = chegando.nodes().find((n: any) => n.type === 'Tile' && n.props.label === lado);
    assert.equal(tile.props.value?.type, 'Skeleton', `${lado}: o valor é forma enquanto o ciclo chega`);
  }
  // O número do herói sai da série: sem ela, "Saldo projetado · R$ 0,00" pintava e depois trocava.
  assert.equal(chegando.nodes().find((n: any) => n.type === 'HeroPanel').props.label?.type, 'Skeleton');
  const pronto = screen(financeiroFile);
  assert.equal(pronto.nodes().find((n: any) => n.type === 'Tile' && n.props.label === 'Entra').props.value.type, 'Money');
});

test('Orçamentos: com os limites chegando, nem o rótulo do destaque nem "Sem limite definido"', () => {
  // Sem os limites, `semLimite` era TODA categoria com gasto — a lista errada, que sumia depois.
  const gastos = [{ category: 'mercado', kind: 'expense', total_cents: 5000, count: 1 }];
  const ui = screen('src/app/finance/budgets.tsx', { budgetsPending: true, saiuNoCiclo: gastos });
  assert.ok(!JSON.stringify(ui.nodes().map((n: any) => n.props.children)).includes('Ainda dá para gastar'), 'o rótulo do destaque é forma');
  assert.ok(!ui.nodes().some((n: any) => n.type === 'SectionHead' && n.props.title === 'Sem limite definido'));
  assert.ok(!ui.nodes().some((n: any) => n.type === 'Button' && n.props.label === 'Definir limite'));
  assert.ok(tipos(ui).includes('Skeleton'));
  const pronto = screen('src/app/finance/budgets.tsx', { saiuNoCiclo: gastos });
  assert.ok(pronto.nodes().some((n: any) => n.type === 'SectionHead' && n.props.title === 'Sem limite definido'), 'sem este, o de cima não distinguiria nada');
});

test('Busca: na primeira busca, só o esqueleto até as três responderem — nada de seção pela metade', () => {
  const notas = [{ id: 'n1', content: 'mercado', folder_id: null, source: 'app', updated_at: '2026-09-20T10:00:00Z' }];
  const chegando = screen('src/app/search.tsx', { buscaPendente: true, buscaNotas: notas });
  assert.ok(tipos(chegando).includes('SkeletonRow'));
  assert.ok(!chegando.nodes().some((n: any) => n.type === 'Section'), 'as notas que já chegaram esperam as outras');
  assert.ok(!chegando.nodes().some((n: any) => n.type === 'VerMais'));
  assert.ok(chegando.nodes().some((n: any) => n.type === 'Chip'), 'os chips são o controle e ficam');
  const pronta = screen('src/app/search.tsx', { buscaNotas: notas });
  assert.ok(pronta.nodes().some((n: any) => n.type === 'Section' && n.props.title === 'Notas'));
});

test('Financeiro: a série do mês falhando mostra o erro no herói e refaz a série — nunca "R$ 0,00"', () => {
  // O número do herói e o Entra/Sai saem do `cycle_series`. Falhando, o herói pintava
  // "Saldo projetado · R$ 0,00" e os blocos ficavam com o rótulo sobre um vazio (25/09/2026).
  const ui = screen('src/app/(tabs)/finance/index.tsx', { cycleSeriesError: true });
  const erro = ui.nodes().find((n: any) => n.type === 'ErrorCard');
  assert.ok(erro, 'card de erro no lugar do herói');
  assert.ok(!ui.nodes().some((n: any) => n.type === 'HeroPanel'), 'sem herói com número inventado');
  assert.ok(!ui.nodes().some((n: any) => n.type === 'Tile' && ['Entra', 'Sai'].includes(n.props.label)), 'sem Entra/Sai vazios');
  erro.props.onRetry();
  assert.ok(ui.refetches.includes('serie'), 'o "Tentar de novo" refaz a série');
});

test('Orçamentos: o resumo chegando não segura a tela — só "Sem limite definido" espera ele', () => {
  // 25/09/2026: o resumo vem no fim de uma cadeia (ciclo → bordas → resumo) e só serve à seção do
  // fim. No portão, a tela inteira ficava no esqueleto esperando as três em série.
  const budgets = [{ category: 'mercado', limit_cents: 100000, spent_cents: 20000, committed_cents: 0, budget_id: 'b1', month: null }];
  const ui = screen('src/app/finance/budgets.tsx', { budgets, resumoPendente: true });
  assert.equal(telaPronta(...ui.gates.at(-1)!), true, 'o resumo buscando não segura o portão');
  const textos = JSON.stringify(ui.nodes().filter((n: any) => n.type === 'ThemedText').map((n: any) => n.props.children));
  assert.match(textos, /mercado/, 'a lista de limites já aparece');
  assert.doesNotMatch(textos, /Sem limite definido/, 'a seção do resumo espera sem texto');
});

test('Notas: "Nova pasta" no "…" abre a folha ali mesmo, com e sem pastas, e o cabeçalho não leva botão', () => {
  // 25/09/2026: *"eu tenho que entrar na tela de organizar pasta para criar uma pasta?"* e, com a
  // pílula no cabeçalho, *"assim fica muito feio, é só colocar adicionar pasta nos três pontos"*.
  const pasta = { id: 'f1', name: 'trabalho', icon: 'folder', color: null, pinned: false, parent_id: null, notes_count: 2, tags: [] };
  for (const folders of [[pasta], []]) {
    const ui = screen('src/app/(tabs)/notes/index.tsx', { folders, notes: [] });
    const cabecalho = ui.nodes().find((n: any) => n.type === 'BlockHeader' && n.props.title === 'Pastas');
    if (folders.length) assert.equal(cabecalho?.props.action, undefined, 'sem pílula no cabeçalho de Pastas');
    else assert.equal(cabecalho, undefined, 'sem pasta, nada de título sobre nada');
    const folha = () => ui.nodes().find((n: any) => n.type?.name === 'NovaPastaSheet');
    assert.equal(folha()?.props.visible, false, 'fechada até o toque');
    ui.interact((nodes) => nodes.find((n) => n.type === 'HeaderIconButton' && n.props.label === 'Mais opções').props.onPress());
    const labels = ui.actions.map((a: any) => a.label);
    // As duas no "…": criar, e a árvore inteira para organizar (que ficou sem porta — 25/09/2026).
    assert.ok(labels.includes('Nova pasta') && labels.includes('Organizar pastas'), labels.join(', '));
    ui.interact(() => ui.actions.find((a: any) => a.label === 'Nova pasta').onPress());
    assert.equal(folha()?.props.visible, true, 'a folha "Nova pasta" abriu na própria aba');
  }
});

test('Nova pasta: cria com o nome normalizado, recusa nome repetido e, dentro de uma pasta, cria subpasta', async () => {
  const pasta = { id: 'f1', name: 'trabalho', icon: 'folder', color: null, pinned: false, parent_id: null, notes_count: 2, tags: [] };
  const folha = (props: any) => screen('src/components/notes/nova-pasta.tsx', { componente: 'NovaPastaSheet', props: { visible: true, onClose: () => {}, pastas: [pasta], ...props } });
  const digitarECriar = async (ui: any, nome: string) => {
    ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'TextField' && n.props.accessibilityLabel === 'Nome da pasta').props.onChangeText(nome));
    ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'TaskHeader').props.action.props.onPress());
    await new Promise((r) => setTimeout(r, 0));
    ui.interact(() => {});
  };
  const repetida = folha({});
  await digitarECriar(repetida, 'Trabalho');
  assert.equal(repetida.writes.filter((w: any) => w.operation === 'useSaveFolder').length, 0, 'nome repetido não grava');
  const nova = folha({});
  await digitarECriar(nova, 'Mercado ');
  assert.deepEqual(copia(nova.writes.at(-1)), { operation: 'useSaveFolder', value: { name: 'mercado', icon: 'folder', parentId: null } });
  const sub = folha({ paiId: 'f1' });
  assert.ok(sub.nodes().some((n: any) => n.type === 'TaskHeader' && n.props.title === 'Nova subpasta'));
  await digitarECriar(sub, 'viagem');
  assert.equal(sub.writes.at(-1).value.parentId, 'f1', 'a subpasta nasce dentro da pasta aberta');
});

/**
 * "Cadastrar conta" de um formulário sem conta abre o FORMULÁRIO da conta, não a lista
 * (25/09/2026): a pessoa ainda tinha que achar o "+" lá, e fechar a largava em Contas.
 */
test('Contas: ?create=1 abre "Nova conta" direto, e fechar ou salvar devolve para quem abriu', () => {
  const folhaAberta = (ui: any) => ui.nodes().some((n: any) => n.type === 'Sheet' && n.props.visible);
  assert.equal(folhaAberta(screen('src/app/finance/accounts.tsx', { params: {} })), false, 'pela lista, fechada');
  const ui = screen('src/app/finance/accounts.tsx', { params: { create: '1' } });
  assert.equal(folhaAberta(ui), true, 'o formulário já abre');
  ui.interact((nodes) => nodes.find((n) => n.type === 'TaskHeader').props.onClose());
  assert.equal(folhaAberta(ui), false);
  assert.deepEqual(copia(ui.navigations.at(-1)), { back: true }, 'volta para o formulário que pediu a conta');
});

/** Todo "Cadastrar conta/cartão" e "Novo cartão" leva ao FORMULÁRIO, nunca à lista de Contas. */
test('Cadastrar conta ou cartão, de qualquer tela, abre o formulário já no tipo certo', () => {
  const arquivos = (readdirSync('src/app', { recursive: true }) as string[]).filter((f) => f.endsWith('.tsx')).map((f) => `src/app/${f}`);
  const soltos: string[] = [];
  for (const f of arquivos) {
    const linhas = readFileSync(f, 'utf8').split('\n');
    linhas.forEach((l, i) => {
      if (!l.includes("'/finance/accounts'")) return;
      // `edit:` já abre o formulário daquela conta (o "Cadastrar o limite" do detalhe da hipótese)
      if (/params: \{ edit: /.test(l)) return;
      if (/Cadastr|Novo cartão/.test(linhas.slice(Math.max(0, i - 6), i + 1).join('\n'))) soltos.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(soltos, [], 'botão de cadastrar que cai na lista');
  const cartao = screen('src/app/finance/accounts.tsx', { params: { create: 'cartao' } });
  assert.ok(cartao.nodes().some((n: any) => n.type === 'Sheet' && n.props.visible), 'o formulário abre');
  assert.ok(cartao.nodes().some((n: any) => n.props?.value === 'credit_card'), 'o tipo já nasce Cartão de crédito');
  assert.ok(cartao.nodes().some((n: any) => n.type === 'TaskHeader' && n.props.title === 'Novo cartão'), 'o título diz cartão');
});

/** A compra que nasceu SEM conta continua editável, como o banco já permite (`finance.md`). */
test('Parcelada sem conta: editar o nome salva sem exigir conta; com conta, a conta continua obrigatória', () => {
  const plano = (account_id: string | null) => ({ id: 'p1', title: 'tv', description: 'tv', merchant: null, category: 'casa', account_id, total_cents: 90000, installments: 3, installment_cents: 30000, first_occurred_at: '2026-10-10', active: true, paid: 0, remaining_cents: 90000, locked: 0, locked_cents: 0, locked_paid: 0, locked_in_invoice: 0, last_locked_no: 0, paid_floor: 0, parcels: [] });
  const salvar = (ui: any) => ui.nodes().find((n: any) => n.type === 'TaskHeader' && n.props.action)?.props.action.props;
  const semConta = screen('src/app/finance/installments.tsx', { params: { edit: 'p1' }, plans: [plano(null)], forecastAccounts: [] });
  assert.ok(salvar(semConta) && !salvar(semConta).disabled, 'sem conta nenhuma, a compra sem conta salva');
  const comConta = screen('src/app/finance/installments.tsx', { params: { edit: 'p1' }, plans: [plano('c1')], forecastAccounts: [{ id: 'c1', name: 'Nubank', type: 'credit_card' }] });
  assert.ok(salvar(comConta) && !salvar(comConta).disabled, 'com a conta dela, salva');
});

/**
 * O limite se põe em QUALQUER categoria que a pessoa usa (25/09/2026): a folha tinha só as 13
 * sugeridas, e "roupa" ou "despesas eventuais" não davam para escolher — a mesma lista fechada que
 * o `CategoryPicker` resolveu no lançamento. E a categoria que chega pelo "Definir limite" aparece
 * escolhida.
 */
test('Orçamentos: a categoria do limite é o seletor de categorias, com as do usuário e a que já veio', () => {
  const ui = screen('src/app/finance/budgets.tsx', { params: {} });
  ui.press('Novo limite');
  const campo = () => ui.nodes().find((n: any) => n.type === 'Field' && n.props.label === 'Categoria');
  const seletor = () => {
    const achados: any[] = [];
    const andar = (n: any) => { if (Array.isArray(n)) return n.forEach(andar); if (n?.props) { if (n.type === 'CategoryPicker' || n.type?.name === 'CategoryPicker') achados.push(n); andar(n.props.children); } };
    andar(campo());
    return achados[0];
  };
  assert.ok(seletor(), 'Categoria usa o CategoryPicker');
  ui.interact(() => seletor().props.onChange('roupa'));
  assert.equal(seletor().props.value, 'roupa', 'a categoria própria fica escolhida');
});

/**
 * Apagar que o BANCO recusa diz o motivo (25/09/2026, em produção): o pagamento do financiamento
 * não apagava e o aviso era só "Não deu para apagar. Tenta de novo." — tentar de novo falhava sempre.
 */
/**
 * Toda parcela da dívida abre (25/09/2026, *"se eu clicar em qualquer uma dessas parcelas, tem que
 * abrir os detalhes dela… e as pagas também, na tela que eu posso editar, deletar"*): a paga com
 * lançamento abre o LANÇAMENTO; a futura e a só contada abrem a tela da parcela — por cima da
 * ficha, que é uma tela.
 */
test('Dívida: tocar numa parcela paga abre o lançamento; numa futura, a tela da parcela', () => {
  const ui = screen(debtsFile, {
    create: false, debts: [carro], params: { id: 'd1' },
    debtPayments: [{ id: 'tx-8', debt_payment_no: 8, occurred_at: '2026-09-05', amount_cents: 147000 }],
    debtSchedule: [{ installment_no: 9, due_date: '2026-10-05', payment_cents: 147000, interest_cents: null, principal_cents: null, balance_cents: 5733000 }],
  });
  const linhas = () => ui.nodes().filter((n: any) => n.type === 'DebtTimeline');
  assert.ok(linhas().length >= 2, 'A seguir e Já pagas');
  const itemDe = (n: number) => linhas().flatMap((l: any) => l.props.anos.flatMap((a: any) => a.itens)).find((i: any) => i.n === n);
  const abrir = (n: number) => ui.interact(() => linhas().find((l: any) => l.props.anos.some((a: any) => a.itens.some((i: any) => i.n === n))).props.onItemPress(itemDe(n)));
  abrir(8);
  assert.deepEqual(copia(ui.navigations.at(-1)), { pathname: '/finance/[txId]', params: { txId: 'tx-8' } });
  abrir(9);
  assert.deepEqual(copia(ui.navigations.at(-1)), { pathname: '/finance/debt-installment', params: { debt: 'd1', n: '9' } });
  // A ficha é uma tela: a parcela empilha por cima, nada fecha nem reabre.
  assert.ok(linhas().length >= 2, 'a ficha continua montada por baixo');
});

test('Parcela da dívida: a próxima mostra valor e vencimento, e "Paguei esta parcela" volta para pagar', () => {
  const tela = (n: string) => screen('src/app/finance/debt-installment.tsx', {
    debts: [carro], params: { debt: 'd1', n },
    debtPayments: [],
    debtSchedule: [
      { installment_no: 9, due_date: '2026-10-05', payment_cents: 147000, interest_cents: null, principal_cents: null, balance_cents: 5733000 },
      { installment_no: 10, due_date: '2026-11-05', payment_cents: 147000, interest_cents: null, principal_cents: null, balance_cents: 5586000 },
    ],
  });
  const proxima = tela('9');
  const textos = JSON.stringify(proxima.nodes().filter((n: any) => n.type === 'ThemedText' || n.type === 'Row').map((n: any) => [n.props.children, n.props.title, n.props.subtitle]));
  assert.match(textos, /05\/10\/2026/);
  proxima.press('Paguei esta parcela');
  assert.deepEqual(copia(proxima.navigations.at(-1)), { back: true });
  assert.throws(() => tela('10').button('Paguei esta parcela'), 'só a próxima se paga — pagamento é em ordem');
});

test('Parcela da dívida: "Lembrar" abre o formulário com Só esta / Todas, e a parcela paga não tem', () => {
  const schedule = [
    { installment_no: 9, due_date: '2026-10-05', payment_cents: 147000, interest_cents: null, principal_cents: null, balance_cents: 5733000 },
    { installment_no: 10, due_date: '2026-11-05', payment_cents: 147000, interest_cents: null, principal_cents: null, balance_cents: 5586000 },
  ];
  const tela = (n: string, billReminders: any[] = []) => screen('src/app/finance/debt-installment.tsx', {
    debts: [carro], params: { debt: 'd1', n }, debtPayments: [], debtSchedule: schedule, billReminders,
  });
  const ui = tela('10');
  const lembrar = ui.nodes().find((n: any) => n.type === 'Row' && n.props.icon === 'bell');
  assert.equal(lembrar?.props.title, 'Lembrar');
  ui.interact(() => lembrar.props.onPress());
  assert.deepEqual(copia(ui.navigations.at(-1)), {
    pathname: '/reminder-form',
    params: { conta: 'debt_id:d1:10', todas: 'debt_id:d1', nome: `${carro.name} · 10ª parcela` },
  });
  // Só o da dívida inteira: a linha mostra os avisos e diz que vale para todas
  const todas = tela('10', [{ alvo: { debt_id: 'd1' }, title: carro.name, channel: 'push', avisos: [{ days_before: 2, at_time: '09:00' }], next_due: null }]);
  const linha = todas.nodes().find((n: any) => n.type === 'Row' && n.props.icon === 'bell');
  assert.equal(linha?.props.subtitle, 'Todas as parcelas');
  // O desta parcela vence o da dívida
  const so = tela('10', [
    { alvo: { debt_id: 'd1' }, title: carro.name, channel: 'push', avisos: [{ days_before: 2, at_time: '09:00' }], next_due: null },
    { alvo: { debt_id: 'd1', debt_installment_no: 10 }, title: carro.name, channel: 'push', avisos: [{ days_before: 0, at_time: '08:00' }], next_due: null },
  ]);
  const linhaSo = so.nodes().find((n: any) => n.type === 'Row' && n.props.icon === 'bell');
  assert.equal(linhaSo?.props.subtitle, undefined);
  assert.match(String(linhaSo?.props.title), /no dia/);
  // Parcela já paga (só contada): nada a lembrar
  const paga = screen('src/app/finance/debt-installment.tsx', {
    debts: [carro], params: { debt: 'd1', n: '3' }, debtPayments: [], debtSchedule: schedule,
  });
  assert.ok(!paga.nodes().some((n: any) => n.type === 'Row' && n.props.icon === 'bell'), 'parcela paga não tem lembrete');
});

test('Parcela antiga apenas declarada conserva seu valor no detalhe após editar parcelas futuras', () => {
  const ui = screen('src/app/finance/debt-installment.tsx', {
    debts: [{ ...carro, installments: 4, installments_paid: 3, installment_cents: 11000 }],
    params: { debt: 'd1', n: '1' },
    debtSchedule: [{ installment_no: 4, due_date: '2026-10-05', payment_cents: 11000, interest_cents: null, principal_cents: null, balance_cents: 0 }],
    debtPayments: [
      { id: 'p2', debt_payment_no: 2, occurred_at: '2026-08-05', amount_cents: 11000 },
      { id: 'p3', debt_payment_no: 3, occurred_at: '2026-09-05', amount_cents: 11000 },
    ],
    declaredEstimates: [{ installment_no: 1, amount_cents: 10000 }],
  });
  const valor = ui.nodes().find((n: any) => n.type === 'Money' && n.props.variant === 'money');
  assert.equal(valor?.props.cents, 10000);
});

/** Editar um cartão de fora (Carteira, fatura) abre o formulário DELE e devolve ao fechar. */
test('Contas: ?edit=<id> abre a edição daquela conta, com o título do tipo, e fechar devolve', () => {
  const nubank = { id: 'c1', name: 'Nubank Cartão', type: 'credit_card', initial_balance_cents: 0, closing_day: 3, due_day: 10, credit_limit_cents: 500000, payment_account_id: null, closing_day_inclusive: false, rotativo_auto: false, rotativo_rate_monthly: null, created_at: '2026-01-01' };
  const ui = screen('src/app/finance/accounts.tsx', { params: { edit: 'c1' }, forecastAccounts: [nubank] });
  const cabeca = ui.nodes().find((n: any) => n.type === 'TaskHeader');
  assert.equal(cabeca?.props.title, 'Editar cartão');
  assert.ok(ui.nodes().some((n: any) => n.props?.value === 'Nubank Cartão'), 'o nome dele no campo');
  ui.interact(() => cabeca.props.onClose());
  assert.deepEqual(copia(ui.navigations.at(-1)), { back: true });
});

test('Carteira: o cartão escolhido se edita e um novo se cria ali mesmo', () => {
  const fonte = readFileSync('src/app/finance/wallet.tsx', 'utf8');
  assert.ok(/\/finance\/accounts\?edit=\$\{ativo\.account_id\}/.test(fonte), 'Editar este cartão abre o formulário DELE');
  assert.ok(/<HeaderIconButton\s+icon="plus"\s+label="Novo cartão"[\s\S]{0,120}\/finance\/accounts\?create=cartao/.test(fonte), 'Novo cartão é o "+" do topo, e abre o formulário já como cartão');
  assert.ok(!/title="Novo cartão"/.test(fonte), 'sem linha "Novo cartão" no corpo');
});

/** Criar e editar onde a coisa está (25/09/2026, *"verifique todas as telas que estão assim"*). */
test('Fatura: "+" cria compra NESTE cartão; o "…" edita o cartão e leva às faturas dele', () => {
  const ui = screen('src/app/finance/invoice/[id].tsx');
  const cabeca = ui.nodes().find((n: any) => n.type === 'HeaderActions');
  const mais = cabeca?.props.actions.find((a: any) => a.label === 'Nova compra');
  assert.equal(mais?.icon, 'plus', 'criar é o "+" do topo');
  const menu = cabeca.props.menu?.actions ?? [];
  const acao = (label: string) => menu.find((a: any) => a.label === label);
  assert.ok(acao('Editar cartão') && acao('Ver todas as faturas'), menu.map((a: any) => a.label).join(', '));
  ui.interact(() => mais.onPress());
  const nova = copia(ui.navigations.at(-1));
  assert.equal(nova.pathname, '/finance/lancar');
  assert.equal(nova.params.tipo, 'uma');
  assert.ok(nova.params.conta, 'a compra nasce no cartão da fatura');
  ui.interact(() => acao('Ver todas as faturas').onPress());
  assert.equal(copia(ui.navigations.at(-1)).params.account, nova.params.conta, 'as faturas DESTE cartão');
});

test('Lançamentos de uma conta: o "…" edita a conta, e Lançar e Importar já vão para ela', () => {
  const conta = { id: 'c1', name: 'Nubank', type: 'checking' };
  const ui = screen(transacoesFile, { params: { accountId: 'c1' }, forecastAccounts: [conta] });
  const header = ui.nodes().find((n: any) => n.type === 'HeaderActions');
  const menu = header?.props.menu?.actions ?? [];
  const editar = menu.find((a: any) => a.label === 'Editar conta');
  assert.ok(editar, menu.map((a: any) => a.label).join(', '));
  ui.interact(() => editar.onPress());
  assert.equal(ui.navigations.at(-1), '/finance/accounts?edit=c1');
  ui.interact(() => menu.find((a: any) => a.label === 'Importar extrato').onPress());
  assert.deepEqual(copia(ui.navigations.at(-1)), { pathname: '/import', params: { conta: 'c1' } });
  ui.interact(() => header.props.actions.find((a: any) => a.label === 'Lançar').onPress());
  assert.deepEqual(copia(ui.navigations.at(-1)), {
    pathname: '/finance/lancar', params: { tipo: 'uma', month: '2026-09', conta: 'c1' },
  });
});

test('Hoje: "Lançar" cria lançamento, lembrete ou nota ali mesmo', () => {
  const ui = screen(hojeFile);
  const fab = ui.nodes().find((n: any) => n.type === 'ExtendedFab' && n.props.label === 'Lançar');
  assert.ok(fab, 'a Hoje tem o Lançar');
  ui.interact(() => fab.props.onPress());
  // Os MESMOS tipos de lançamento das Finanças (29/09/2026, "padronize no app inteiro"), cada um
  // com o seu ícone, e o que é da Hoje: lembrete e nota.
  assert.deepEqual(ui.actions.map((a: any) => a.label), ['Gasto ou receita', 'Recorrente', 'Financiamento', 'Por voz', 'Lembrete', 'Nota']);
  assert.ok(ui.actions.every((a: any) => a.icon));
  ui.interact(() => ui.actions.find((a: any) => a.label === 'Recorrente').onPress());
  assert.deepEqual(JSON.parse(JSON.stringify(ui.navigations.at(-1))), { pathname: '/finance/lancar', params: { tipo: 'recorrente' } }, 'o formulário único, por cima da Hoje');
  ui.interact(() => ui.actions.find((a: any) => a.label === 'Financiamento').onPress());
  assert.deepEqual(JSON.parse(JSON.stringify(ui.navigations.at(-1))), { pathname: '/finance/lancar', params: { tipo: 'financiamento' } });
  ui.interact(() => ui.actions.find((a: any) => a.label === 'Gasto ou receita').onPress());
  assert.deepEqual(JSON.parse(JSON.stringify(ui.navigations.at(-1))), { pathname: '/finance/lancar', params: { tipo: 'uma' } });
  ui.interact(() => ui.actions.find((a: any) => a.label === 'Por voz').onPress());
  assert.deepEqual(ui.navigations.at(-1), { porVoz: true }, 'abre a folha por voz, não uma rota');
});

/** Organizar pastas não cria (25/09/2026): renomear abre a MESMA folha de "Nova pasta". */
test('Organizar pastas: sem criar; Renomear abre a folha da pasta, que salva sem mexer na pasta-mãe', async () => {
  const pasta = { id: 'f1', name: 'trabalho', icon: 'briefcase', color: null, pinned: false, parent_id: 'p0', notes_count: 2, tags: [] };
  const ui = screen('src/app/notes/folders.tsx', { folders: [pasta] });
  const textos = JSON.stringify(ui.nodes().map((n: any) => [n.props?.label, n.props?.title]));
  assert.doesNotMatch(textos, /Criar pasta|Nova pasta/, 'nada de criar aqui');
  const card = deslizaveis(ui)[0];
  ui.interact(() => card.props.acoes.find((a: any) => a.label === 'Renomear ou trocar ícone').onPress());
  const folha = ui.nodes().find((n: any) => n.type?.name === 'NovaPastaSheet');
  assert.equal(folha.props.visible, true);
  assert.equal(folha.props.pasta.id, 'f1');

  const editar = screen('src/components/notes/nova-pasta.tsx', { componente: 'NovaPastaSheet', props: { visible: true, onClose: () => {}, pastas: [pasta], pasta } });
  assert.ok(editar.nodes().some((n: any) => n.type === 'TaskHeader' && n.props.title === 'Editar pasta'));
  assert.ok(editar.nodes().some((n: any) => n.type === 'TextField' && n.props.value === 'trabalho'), 'o nome dela no campo');
  editar.interact((nodes: any[]) => nodes.find((n) => n.type === 'TextField' && n.props.accessibilityLabel === 'Nome da pasta').props.onChangeText('trabalho 2'));
  editar.interact((nodes: any[]) => nodes.find((n) => n.type === 'TaskHeader').props.action.props.onPress());
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(copia(editar.writes.at(-1)), { operation: 'useSaveFolder', value: { id: 'f1', name: 'trabalho 2', icon: 'briefcase' } }, 'sem parentId: a pasta fica onde está');
});

/** Dentro da pasta, "Renomear" e "Mover para dentro de…" fazem o que dizem, ali (25/09/2026). */
test('Pasta: o "…" renomeia na folha da pasta e move sem ir a Organizar pastas', () => {
  const pasta = { id: 'f1', name: 'trabalho', icon: 'folder', color: null, pinned: false, parent_id: null, notes_count: 0, tags: [] };
  const ui = screen('src/app/notes/folder/[id].tsx', { folders: [pasta], notes: [], params: { id: 'f1' } });
  const menu = ui.nodes().find((n: any) => n.type === 'HeaderActions')?.props.menu?.actions ?? [];
  const labels = menu.map((a: any) => a.label);
  assert.ok(labels.includes('Renomear') && labels.includes('Mover para dentro de…') && !labels.includes('Renomear e mover'), labels.join(', '));
  ui.interact(() => menu.find((a: any) => a.label === 'Renomear').onPress());
  const folha = ui.nodes().find((n: any) => n.type?.name === 'NovaPastaSheet' && n.props.pasta);
  assert.equal(folha?.props.visible, true);
  assert.equal(folha.props.pasta.id, 'f1');
  assert.equal(ui.navigations.length, 0, 'nada de navegar para Organizar pastas');
});

test('Série: editar tem os campos da criação, e só o calendário mexido vai com regra e vencimento', async () => {
  // 26/09/2026: *"ao clicar nele e em editar, eu não consigo editar a data de vencimento?? … ter
  // todos os campos de quando eu crio ao editar"*. Repete, a cada, vencimento, tipo e estabelecimento.
  const hoje = new fixtureDate();
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const br = (d: Date) => iso(d).split('-').reverse().join('/');
  const proxima = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 4, 12);
  const serie = {
    id: 'rec-1', description: 'Fundacred', merchant: null, kind: 'expense', amount_cents: 119885,
    rrule: 'FREQ=MONTHLY;BYMONTHDAY=4', dtstart: '2026-09-01T12:00:00Z', next_run_at: proxima.toISOString(),
    active: true, account_id: null, category: 'estudo', end_date: null, auto_confirm: false, edit_revision: 4,
  };
  // Editar abre o formulário único (Task 8); o corpo da série é quem edita.
  const abrir = () => screen('src/components/finance/formulario-da-serie.tsx', { componente: 'FormularioDaSerie', recurring: [serie], props: {
    comum: { kind: 'expense', descricao: '', valorCents: 0, contaId: null, dataBR: br(hoje), categoria: null },
    editandoId: 'rec-1', registrarComum: () => {}, registrarEstado: () => {}, onSalvo: () => {}, onFechar: () => {},
  } });
  const salvar = (ui: any) => ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'TaskHeader').props.action.props.onPress());
  const campo = (ui: any, label: string) => ui.nodes().find((n: any) => n.type === 'Field' && n.props.label === label);

  const peloMenu = screen('src/app/finance/recurring.tsx', { recurring: [serie], params: {} });
  peloMenu.interact(() => deslizaveis(peloMenu)[0].props.acoes.find((a: any) => a.label === 'Editar').onPress());
  assert.equal(peloMenu.actions.length, 0, 'Editar abre o formulário sem pedir o escopo');
  // a lista não sabe se a série tem passado: sem `passado`, o hospedeiro assume que tem
  assert.deepEqual(copia(peloMenu.navigations.at(-1)), { pathname: '/finance/lancar', params: { tipo: 'recorrente', id: 'rec-1', origem: 'serie' } });
  peloMenu.press('Nova recorrência');
  assert.deepEqual(copia(peloMenu.navigations.at(-1)), { pathname: '/finance/lancar', params: { tipo: 'recorrente' } });

  const ui = abrir();
  for (const label of ['Tipo', 'Título', 'Estabelecimento', 'Repete', 'A cada quantos meses', 'Próximo vencimento', 'Termina em']) {
    assert.ok(campo(ui, label), `"${label}" na edição`);
  }
  const data = () => ui.nodes().find((n: any) => n.type === 'DatePickerField' && n.props.accessibilityLabel === 'Próximo vencimento da série');
  assert.equal(data().props.value, br(proxima), 'a data é o PRÓXIMO vencimento, não o início da série');

  // Só o valor: a regra não vai (uma série do WhatsApp não muda de calendário sem a pessoa pedir).
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'MoneyField').props.onChangeCents(120000));
  salvar(ui);
  assert.equal(ui.pedidos.length, 0, 'Salvar pergunta o alcance antes de escrever');
  // a série, não uma ocorrência: "Das próximas em diante" ou "Todas" — sem "Só esta" (28/09/2026)
  assert.ok(!ui.actions.some((a: any) => a.label === 'Só esta parcela'));
  ui.interact(() => ui.actions.at(-2).onPress());
  const soValor = ui.pedidos.at(-1).value.patch;
  assert.equal(ui.pedidos.at(-1).operation, 'saveRecurringSeries');
  assert.equal(soValor.amount_cents, 120000);
  assert.equal('rrule' in soValor, false);

  // Tocar o número do último dia escolhe dia fixo. A ação própria escolhe -1.
  const ui2 = abrir();
  const ultimo = new Date(hoje.getFullYear(), hoje.getMonth() + 2, 0);
  ui2.interact((nodes: any[]) => nodes.find((n) => n.type === 'DatePickerField' && n.props.accessibilityLabel === 'Próximo vencimento da série').props.onChange(br(ultimo)));
  ui2.interact((nodes: any[]) => nodes.find((n) => n.type === 'Field' && n.props.label === 'Estabelecimento').props.children.props.onChangeText('Fundacred SA'));
  salvar(ui2);
  ui2.interact(() => ui2.actions.at(-1).onPress());
  const all = ui2.pedidos.at(-1);
  assert.equal(all.operation, 'saveRecurringAll');
  assert.equal(all.value.expectedRevision, 4);
  assert.equal(all.value.requestId, '00000000-0000-4000-8000-000000000001');
  assert.equal(all.value.linePatch.merchant, 'Fundacred SA');
  const calendario = all.value.seriesPatch;
  assert.equal(calendario.rrule, `FREQ=MONTHLY;BYMONTHDAY=${ultimo.getDate()}`);
  assert.equal(iso(new Date(calendario.next_run_at)), iso(ultimo));
  assert.equal(calendario.merchant, 'Fundacred SA');

  const uiFim = abrir();
  uiFim.interact((nodes: any[]) => nodes.find((n) => n.type === 'DatePickerField' && n.props.accessibilityLabel === 'Próximo vencimento da série').props.onSelectLastDay(br(ultimo)));
  salvar(uiFim);
  uiFim.interact(() => uiFim.actions.at(-2).onPress());
  assert.equal(uiFim.pedidos.at(-1).value.patch.rrule, 'FREQ=MONTHLY;BYMONTHDAY=-1');

  const semMudanca = abrir();
  salvar(semMudanca);
  assert.equal(semMudanca.pedidos.length, 0);
  assert.ok(!semMudanca.actions.some((a: any) => a.label === 'Todas'), 'sem alteração não pergunta o alcance');
  assert.equal(semMudanca.pedidos.length, 0, 'sem alteração fecha sem escrever');

  // A ficha é a SÉRIE: não há "Só esta" (28/09/2026). Uma ocorrência se edita pelo lançamento dela.
  const uiSemEsta = abrir();
  uiSemEsta.interact((nodes: any[]) => nodes.find((n) => n.type === 'MoneyField').props.onChangeCents(125000));
  salvar(uiSemEsta);
  assert.deepEqual(uiSemEsta.actions.slice(-2).map((a: any) => a.label), ['Esta e próximas', 'Todas']);
  assert.ok(!uiSemEsta.actions.some((a: any) => a.label === 'Só esta parcela'));

  // Vencimento no passado não salva, e diz por quê.
  const ui3 = abrir();
  const ontem = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 1);
  ui3.interact((nodes: any[]) => nodes.find((n) => n.type === 'DatePickerField' && n.props.accessibilityLabel === 'Próximo vencimento da série').props.onChange(br(ontem)));
  assert.equal(ui3.nodes().find((n: any) => n.type === 'TaskHeader').props.action.props.disabled, true);
  assert.ok(ui3.nodes().some((n: any) => n.type === 'Field' && n.props.label === 'Próximo vencimento' && n.props.error));
});

test('Dívida de parcela fixa também tem "Tipo" (e grava o escolhido)', () => {
  // 26/09/2026: o campo só existia no modo "com juros"; a parcela fixa não trocava de tipo nunca.
  const ui = formDivida();
  const tipo = ui.nodes().find((n: any) => n.type === 'Field' && n.props.label === 'Tipo');
  assert.ok(tipo, '"Tipo" no modo parcela fixa');
  assert.ok(ui.nodes().some((n: any) => n.type === 'SelectField' && n.props.value === 'fixed_installments'), 'é o modo parcela fixa');
  const select = ui.nodes().find((n: any) => n.type === 'SelectField' && n.props.options.some((o: any) => o.id === 'loan'));
  ui.interact(() => select.props.onChange('loan'));
  assert.equal(ui.nodes().find((n: any) => n.type === 'SelectField' && n.props.options.some((o: any) => o.id === 'loan')).props.value, 'loan');
});

test('Organizar pastas: "Sem pasta" abre as notas soltas (a aba Notas)', () => {
  // A linha tinha ícone e contagem como as outras e não fazia nada ao toque.
  const ui = screen('src/app/notes/folders.tsx', { folders: [] });
  const semPasta = ui.nodes().find((n: any) => n.type === 'Row' && n.props.title === 'Sem pasta');
  ui.interact(() => semPasta.props.onPress());
  assert.equal(ui.navigations.at(-1), '/notes');
});

test('Editar a compra: as já pagas se editam, o número muda com parcela paga, e data e conta só prendem pela fatura', () => {
  // 26/09/2026: *"parcelas já pagas ele deve poder alterar no editar também"*.
  const plano = (extra: Record<string, unknown> = {}) => ({
    id: 'p1', title: 'tv', description: 'tv', merchant: null, category: 'casa', account_id: 'c1', total_cents: 100000,
    installments: 10, installment_cents: 10000, first_occurred_at: '2026-06-05', active: true, paid: 2, remaining_cents: 80000,
    locked: 2, locked_cents: 20000, locked_paid: 2, locked_in_invoice: 0, last_locked_no: 2, paid_floor: 0,
    parcels: Array.from({ length: 10 }, (_, i) => ({ id: `t${i + 1}`, installment_no: i + 1,
      status: i < 2 ? 'cleared' : 'pending', amount_cents: 10000,
      occurred_at: new Date(Date.UTC(2026, 5 + i, 5)).toISOString().slice(0, 10) })), ...extra,
  });
  const abrir = (extra?: Record<string, unknown>) =>
    screen('src/app/finance/installments.tsx', { params: { edit: 'p1' }, plans: [plano(extra)], forecastAccounts: [{ id: 'c1', name: 'Conta', type: 'checking' }] });
  const quantidade = (ui: any, rotulo: string) => ui.nodes().find((n: any) => n.type === 'QuantityField' && n.props.accessibilityLabel === rotulo);

  const ui = abrir();
  assert.equal(quantidade(ui, 'Número de parcelas').props.min, 2, 'com 2 pagas o número muda, só não fica abaixo delas');
  assert.ok(ui.nodes().some((n: any) => n.type === 'DatePickerField' && n.props.accessibilityLabel === 'Data da primeira parcela'), 'fora do cartão a data muda');
  ui.interact(() => quantidade(ui, 'Parcelas já pagas').props.onChange(4));
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'TaskHeader').props.action.props.onPress());
  // as pagas são da compra toda: nada de "próximas ou todas", direto à confirmação do contrato
  assert.equal(ui.pedidos.length, 0, 'mudar pagas passa pela confirmação do contrato');
  assert.ok(!ui.actions.some((a: any) => a.label === 'Todas'), 'sem pergunta de alcance');
  assert.equal(ui.actions.at(-1).label, 'Aplicar ao contrato');
  ui.interact(() => ui.actions.at(-1).onPress());
  assert.equal(ui.pedidos.at(-1).value.paidInstallments, 4);

  const naFatura = abrir({ locked_in_invoice: 1, paid_floor: 1 });
  assert.ok(naFatura.nodes().some((n: any) => n.type === 'TextField' && n.props.accessibilityLabel === 'Data da primeira parcela' && n.props.editable === false), 'parcela paga na fatura prende a data');
  assert.equal(quantidade(naFatura, 'Parcelas já pagas').props.min, 1, 'a paga com a fatura não reabre por aqui');
});

test('Dívidas: o "Paguei" tem a data do pagamento, e ela vai para o banco', () => {
  // 26/09/2026: a data era sempre hoje — pagou ontem e lançou hoje ficava errado.
  const ui = screen(debtsFile, {
    create: false, debts: [carro], params: { id: 'd1' },
    debtSchedule: [{ installment_no: 9, due_date: '2026-10-05', payment_cents: 147000, interest_cents: null, principal_cents: null, balance_cents: 0 }],
  });
  ui.press('Paguei esta parcela');
  const data = () => ui.nodes().find((n: any) => n.type === 'DatePickerField' && n.props.accessibilityLabel === 'Data do pagamento');
  assert.ok(data(), 'a folha pergunta quando');
  ui.interact(() => data().props.onChange('20/09/2026'));
  ui.press('Registrar pagamento');
  assert.equal(ui.writes[0].value.paidAt, '2026-09-20');
});

test('Orçamento: editar muda AQUELE limite — a categoria também, pela chave de quando abriu', () => {
  // 26/09/2026: a categoria era só texto na edição, e trocar "Vale para" criava outro limite.
  const ui = screen('src/app/finance/budgets.tsx', { budgets: [{ category: 'mercado', limit_cents: 100_00, base_limit_cents: 100_00, rollover_cents: 0, spent_cents: 40_00, committed_cents: 0, month: null }] });
  const card = deslizaveis(ui)[0];
  ui.interact(() => card.props.acoes.find((x: any) => x.label === 'Editar limite').onPress());
  const seletor = ui.nodes().find((n: any) => n.type === 'CategoryPicker' || n.type?.name === 'CategoryPicker');
  assert.ok(seletor, 'a categoria é o seletor, não texto');
  ui.interact(() => seletor.props.onChange('supermercado'));
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'TaskHeader').props.action.props.onPress());
  const gravado = ui.pedidos.at(-1).value;
  assert.equal(gravado.category, 'supermercado');
  assert.deepEqual(JSON.parse(JSON.stringify(gravado.antes)), { category: 'mercado', month: null });
});

test('Conta: com lançamentos, o tipo só troca na mesma família; editando o cartão, os dias refazem as faturas abertas', () => {
  // 26/09/2026: a troca cartão ↔ conta deixava as faturas órfãs; e "Fecha dia" só valia para compras novas.
  const cartao = { id: 'c1', name: 'Nubank', type: 'credit_card', initial_balance_cents: 0, closing_day: 3, due_day: 10, credit_limit_cents: 500000, payment_account_id: null, archived: false };
  const ui = screen('src/app/finance/accounts.tsx', { params: { edit: 'c1' }, forecastAccounts: [cartao], contaTemLancamentos: true });
  const tipo = ui.nodes().find((n: any) => n.type === 'SelectField' && n.props.options.some((o: any) => o.id === 'credit_card'));
  assert.deepEqual(JSON.parse(JSON.stringify(tipo.props.options.map((o: any) => o.id))), ['credit_card'], 'o cartão com lançamento não vira conta');
  assert.equal(ui.nodes().find((n: any) => n.type === 'Field' && n.props.label === 'Fecha dia').props.hint, 'Mudar os dias refaz as faturas em aberto');
  assert.equal(ui.nodes().find((n: any) => n.type === 'Field' && n.props.label === 'Compra no dia do fechamento').props.hint, undefined, 'a dica aparece uma vez');
});

test('Dívida arquivada: Desarquivar à direita, Apagar por completo à esquerda', () => {
  const ui = screen('src/app/finance/debts.tsx', {
    archivedDebts: [{ id: 'd1', name: 'Carro', archived: true, remaining_cents: 100000, principal_cents: 100000, kind: 'financing', calculation_mode: 'fixed_installments', interest_rate_monthly: 0, installments: 10, installments_paid: 0 }],
  });
  ui.interact(() => ui.nodes().find((n: any) => n.type === 'Row' && /^Arquivadas/.test(n.props.title)).props.onPress());
  const card = deslizaveis(ui).find((d: any) => d.props.titulo === 'Carro');
  assert.ok(card, 'a dívida arquivada arrasta');
  assert.deepEqual(ladosDe(card), { direita: ['Desarquivar'], esquerda: ['Apagar por completo'], mais: false, pontaDireita: 'Desarquivar', pontaEsquerda: 'Apagar por completo' });
});

test('Arquivados (contas, cartões, metas, bens): Desarquivar à direita, Apagar à esquerda, e apagar confirma', () => {
  const ui = screen('src/components/ui/secao-de-arquivados.tsx', {
    componente: 'SecaoDeArquivados',
    props: { tabela: 'goals', titulo: 'Arquivadas', subtitulo: () => 'meta arquivada' },
    arquivados: [{ id: 'g1', name: 'Viagem' }],
  });
  ui.interact(() => ui.nodes().find((n: any) => n.type === 'Row' && /^Arquivadas/.test(n.props.title)).props.onPress());
  const [card] = deslizaveis(ui);
  assert.ok(card, 'o arquivado arrasta');
  assert.deepEqual(ladosDe(card), { direita: ['Desarquivar'], esquerda: ['Apagar'], mais: false, pontaDireita: 'Desarquivar', pontaEsquerda: 'Apagar' });
  ui.interact(() => card.props.acoes.find((a: any) => a.label === 'Apagar').onPress());
  assert.equal(ui.writes.length, 0, 'nada sai sem confirmar');
  ui.interact(() => ui.confirmations.at(-1)());
  assert.deepEqual(ui.writes.at(-1), { operation: 'excluir:goals', value: 'g1' });
});

test('Editar a conta abre no saldo ATUAL e grava a diferença no inicial (28/09/2026)', () => {
  // O Nubank de produção: a lista mostrava 162,51 e a edição abria no inicial, 867,86.
  const ui = screen('src/app/finance/accounts.tsx', {
    balances: [{ account_id: 'a1', name: 'Nubank', type: 'checking', balance_cents: 16251, cleared_cents: 16251, pending_in_cents: 0, pending_out_cents: 0 }],
    forecastAccounts: [{ id: 'a1', name: 'Nubank', type: 'checking', archived: false, initial_balance_cents: 86786 }],
  });
  ui.interact(() => itemLinks(ui)[0].props.actions.find((a: any) => a.label === 'Editar').onPress());
  const campo = () => ui.nodes().find((n: any) => n.type === 'Field' && n.props.label === 'Saldo atual');
  assert.ok(campo(), 'o campo se chama Saldo atual');
  const dinheiro = () => ui.nodes().find((n: any) => n.type === 'MoneyField');
  assert.equal(dinheiro().props.valueCents, 16251, 'abre no que a lista mostra');

  // Sem mexer, o inicial não anda.
  ui.interact(() => ui.nodes().find((n: any) => n.type === 'TaskHeader').props.action.props.onPress());
  assert.equal(ui.writes.at(-1).value.initial_balance_cents, 86786);

  // Digitando 200,00, o inicial anda 37,49 e o atual passa a ser 200,00.
  ui.interact(() => itemLinks(ui)[0].props.actions.find((a: any) => a.label === 'Editar').onPress());
  ui.interact(() => dinheiro().props.onChangeCents(20000));
  ui.interact(() => ui.nodes().find((n: any) => n.type === 'TaskHeader').props.action.props.onPress());
  assert.equal(ui.writes.at(-1).value.initial_balance_cents, 90535);

  // No vermelho: o sinal vem do seletor, porque o campo de dinheiro só digita positivo.
  ui.interact(() => itemLinks(ui)[0].props.actions.find((a: any) => a.label === 'Editar').onPress());
  ui.interact(() => dinheiro().props.onChangeCents(5000));
  ui.interact(() => ui.nodes().find((n: any) => n.type === 'Segmented' && n.props.options.some((o: any) => o.label === 'No vermelho')).props.onChange('negativo'));
  ui.interact(() => ui.nodes().find((n: any) => n.type === 'TaskHeader').props.action.props.onPress());
  assert.equal(ui.writes.at(-1).value.initial_balance_cents, 86786 - 21251);
});

test('Histórico de alertas: não lido até a pessoa marcar; Lida à direita, Limpar à esquerda, e o menu faz todas', () => {
  // 28/09/2026: "o sino tem que ter os números, limpar todas as notificações e marcar como lida"
  const alertas = [
    { id: 'a1', workspace_id: 'w', kind: 'negative_forecast', ref: 'r', sent_on: '2026-09-28', channel: 'whatsapp', created_at: '2026-09-28T15:00:00Z' },
    { id: 'a2', workspace_id: 'w', kind: 'negative_forecast', ref: 'r', sent_on: '2026-09-27', channel: 'whatsapp', created_at: '2026-09-27T15:00:00Z' },
  ];
  const ui = screen('src/app/profile/alerts.tsx', { alerts: alertas });
  const cards = () => deslizaveis(ui);
  assert.equal(cards().length, 2, 'abrir a tela não marca nem some nada');
  assert.deepEqual(ladosDe(cards()[0]), { direita: ['Marcar como lida'], esquerda: ['Limpar'], mais: false, pontaDireita: 'Marcar como lida', pontaEsquerda: 'Limpar' });

  // lida: some o "Lida" do arrasto, o card fica
  ui.interact(() => cards()[0].props.acoes.find((a: any) => a.label === 'Marcar como lida').onPress());
  assert.deepEqual(ladosDe(cards()[0]).direita, []);
  assert.equal(cards().length, 2);

  // limpar uma: some da lista, e o "Desfazer" traz de volta
  ui.interact(() => cards()[1].props.acoes.find((a: any) => a.label === 'Limpar').onPress());
  assert.equal(cards().length, 1);
  ui.interact(() => ui.toasts.at(-1).action.onPress());
  assert.equal(cards().length, 2);

  // o menu do cabeçalho: marcar todas, e limpar todas
  const menu = () => ui.nodes().find((n: any) => n.type === 'HeaderActions').props.menu.actions;
  ui.interact(() => menu().find((a: any) => a.label === 'Marcar todas como lidas').onPress());
  assert.ok(cards().every((c: any) => ladosDe(c).direita.length === 0), 'todas lidas');
  ui.interact(() => menu().find((a: any) => a.label === 'Limpar todas').onPress());
  assert.equal(cards().length, 0);
  assert.ok(ui.nodes().some((n: any) => n.type === 'EmptyState'));
});

test('Ciclo aberto pela Projeção com um adiantamento: o pagamento e a parcela que deixa de sair entram na lista, sem salvar', () => {
  // 28/09/2026: "tem que mostrar com aqueles valores da projeção de hipótese (sem salvar)… como se fosse real"
  const rascunho = JSON.stringify({ versao: 2, hipoteses: [], adiantamentos: [
    { kind: 'expense', amount_cents: 157000, start: '2026-09-28', installments: 1, mode: 'total', grupo: 'g', rotulo: 'adianta 2 parcelas de Carro' },
    { kind: 'expense', amount_cents: 124500, start: '2026-10-05', installments: 1, mode: 'cancel', grupo: 'g' },
  ] });
  const ui = screen('src/app/finance/cycle.tsx', {
    params: { month: '2026-10', view: 'cycle', hipoteses: '1' },
    preferencias: { 'projecao:rascunho': rascunho },
    cycleRow: { mes: '2026-10-01', ini: '2026-09-11', fim: '2026-10-10', estado: 'aberto', comecei_com: 100000, entrou: 500000, saiu: 400000, resultado: 200000, caixa_no_fim: 200000, faltou_pagar: 0, confere: true },
    draftLines: { antes: 0, linhas: [
      { i: 0, day: '2026-09-28', kind: 'expense', cents: 157000 },
      { i: 1, day: '2026-10-05', kind: 'expense', cents: -124500 },
    ] },
  });
  assert.ok(ui.nodes().some((n: any) => n.type === 'SectionHead' && /^Hipóteses do rascunho/.test(n.props.title)), 'o grupo das hipóteses');
  const titulos = ui.nodes().filter((n: any) => typeof n.type === 'function' && n.type.name === 'Linha').map((n: any) => n.props.linha.title);
  assert.ok(titulos.includes('Adianta 2 parcelas de Carro'));
  assert.ok(titulos.includes('Parcela adiantada'));
  const fechamento = ui.nodes().find((n: any) => typeof n.type === 'function' && n.type.name === 'Fechamento');
  assert.equal(fechamento.props.hipoteses, 1, 'um adiantamento é UMA hipótese');
  assert.equal(ui.writes.length, 0, 'nada é salvo');
});

test('Ciclo aberto de outro lugar não usa o rascunho do aparelho', () => {
  const rascunho = JSON.stringify({ versao: 2, adiantamentos: [], hipoteses: [
    { id: 'h', kind: 'expense', forma: 'uma', valor_cents: 5000, parcelas: 1, repete: 'monthly', conta: null, data: '2026-10-01' }] });
  const ui = screen('src/app/finance/cycle.tsx', {
    params: { month: '2026-10', view: 'cycle' },
    preferencias: { 'projecao:rascunho': rascunho },
    cycleRow: { mes: '2026-10-01', ini: '2026-09-11', fim: '2026-10-10', estado: 'aberto', comecei_com: 100000, entrou: 500000, saiu: 400000, resultado: 200000, caixa_no_fim: 200000, faltou_pagar: 0, confere: true },
  });
  const fechamento = ui.nodes().find((n: any) => typeof n.type === 'function' && n.type.name === 'Fechamento');
  assert.equal(fechamento.props.hipoteses, 0);
  assert.equal(Number(fechamento.props.ciclo.saiu), 400000, 'o ciclo real');
});

test('Projeção: com hipótese no rascunho, o erro da simulação aparece na linha; ela arrasta Aplicar e Tirar', () => {
  const hipoteses = [{ id: 'h1', kind: 'expense', forma: 'parcelado', valor_cents: 300000, parcelas: 10, repete: 'monthly', conta: 'c', data: '2026-10-01' }];
  const ui = screen(forecastFile, { forecastAccounts: [{ id: 'c', name: 'Nubank', type: 'credit_card' }], preferencias: { 'projecao:rascunho': JSON.stringify({ versao: 2, hipoteses: hipoteses, adiantamentos: [] }) }, simulacao: { forecast: [{ day: '2026-09-28', in_cents: 0, out_cents: 0, balance_cents: 100 }], erros: [{ indice: 0, mensagem: 'conta arquivada', codigo: 'P0001' }] } });
  const linha = ui.nodes().find((n: any) => n.type === 'Row' && String(n.props.accessibilityLabel).startsWith('Hipótese:'));
  assert.equal(linha.props.title, 'Sai R$ 3000.00 em 10× · Nubank · a partir de 01/10/2026');
  assert.match(linha.props.subtitle, /conta arquivada/, 'o erro da simulação aparece na linha');
  const card = deslizaveis(ui)[0];
  assert.deepEqual(ladosDe(card), { direita: ['Aplicar'], esquerda: ['Tirar'], mais: true, pontaDireita: 'Aplicar', pontaEsquerda: 'Tirar' });
});

test('Rascunho da versão 1: a parcelada sem conta não aplica (o formulário ficaria sem a conta); o adiantamento nunca aplica', () => {
  const ui = screen(forecastFile, { forecastAccounts: [{ id: 'conta-1' }], preferencias: { 'projecao:rascunho': JSON.stringify({ versao: 1, rapidas: [
    { kind: 'expense', amount_cents: 300000, start: '2026-10-01', installments: 6, mode: 'total', grupo: 'h1' },
    { kind: 'expense', amount_cents: 50000, start: '2026-10-01', installments: 1, mode: 'total', grupo: 'h2', rotulo: 'adianta a tv' },
    { kind: 'expense', amount_cents: 20000, start: '2026-11-10', installments: 1, mode: 'cancel', grupo: 'h2' },
  ], detalhadas: [] }) } });
  const aplicar = (d: any) => d.props.acoes.find((a: any) => a.label === 'Aplicar');
  const [parcelada, adiantamento] = deslizaveis(ui);
  assert.equal(aplicar(parcelada).disabled, true);
  assert.equal(aplicar(adiantamento), undefined);
  // e a v1 de um valor só vira hipótese completa, sem conta
  const simples = screen(forecastFile, { forecastAccounts: [{ id: 'conta-1' }], preferencias: { 'projecao:rascunho': JSON.stringify({ versao: 1, rapidas: [{ kind: 'income', amount_cents: 5000, start: '2026-10-01', installments: 1, mode: 'total', grupo: 'g' }], detalhadas: [] }) } });
  simples.interact(() => aplicar(deslizaveis(simples)[0]).onPress());
  assert.deepEqual(JSON.parse(JSON.stringify(simples.navigations.at(-1))), { pathname: '/finance/lancar', params: { tipo: 'uma', deHipotese: 'g', kind: 'income', amount: '5000', data: '01/10/2026', parcelas: '1' } });
});

test('Recorrente aberta pelo Aplicar: conta e frequência chegam, e salvar tira a hipótese PELO ID', async () => {
  const rascunho = JSON.stringify({ versao: 2, adiantamentos: [], hipoteses: [
    { id: 'x', kind: 'expense', forma: 'uma', valor_cents: 1, parcelas: 1, repete: 'monthly', conta: null, data: '2026-10-01' },
    { id: 'r', kind: 'expense', forma: 'repete', valor_cents: 5000, parcelas: 1, repete: 'weekly', conta: 'cc', data: '2026-10-06' } ] });
  // O que o formulário único entrega ao corpo da série vindo do "Aplicar" (o hospedeiro tem teste próprio).
  const ui = screen('src/components/finance/formulario-da-serie.tsx', { componente: 'FormularioDaSerie', segurarMutacoes: true, preferencias: { 'projecao:rascunho': rascunho },
    props: { comum: { kind: 'expense', descricao: 'Academia', valorCents: 5000, contaId: 'cc', dataBR: '06/10/2026', categoria: null }, preset: 'weekly', deHipotese: 'r',
      registrarComum: () => {}, registrarEstado: () => {}, onSalvo: () => {}, onFechar: () => {} } });
  const header = ui.nodes().find((n: any) => n.type === 'TaskHeader' && n.props.action);
  assert.equal(header.props.action.props.label, 'Criar', 'o formulário é o real');
  ui.interact(() => header.props.action.props.onPress());
  assert.equal(ui.writes.at(-1).operation, 'createRecurring');
  assert.equal(ui.writes.at(-1).value.account_id, 'cc');
  assert.match(ui.writes.at(-1).value.rrule, /^FREQ=WEEKLY/);
  assert.ok(!('projecao:rascunho' in ui.preferenciasGravadas), 'antes do sucesso o rascunho não muda');
  // Pela promessa: o `onSuccess` por chamada não roda com a tela já fechada (revisão final).
  (ui.pedidos.at(-1) as any).resolver('rec-1');
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(JSON.parse(ui.preferenciasGravadas['projecao:rascunho']).hipoteses.map((h: any) => h.id), ['x']);
});

test('Financiamento aberto pelo Aplicar: parcela, parcelas, conta e a próxima parcela preenchidas; salvar tira a hipótese', async () => {
  const rascunho = JSON.stringify({ versao: 2, adiantamentos: [], hipoteses: [
    { id: 'f', kind: 'expense', forma: 'financiamento', valor_cents: 147000, parcelas: 48, repete: 'monthly', conta: 'cc', data: '2026-10-31' } ] });
  // O que o formulário único entrega ao corpo da dívida vindo do "Aplicar" (o hospedeiro tem teste próprio).
  const ui = formDivida({ segurarMutacoes: true, forecastAccounts: [{ id: 'cc', name: 'Itaú', type: 'checking' }], preferencias: { 'projecao:rascunho': rascunho } }, {
    comum: { kind: 'expense', descricao: '', valorCents: 0, contaId: 'cc', dataBR: '31/10/2026', categoria: null },
    deHipotese: 'f', dadosDoAplicar: { parcela: '147000', parcelas: '48', conta: 'cc', data: '31/10/2026' },
  });
  assert.ok(ui.nodes().some((n: any) => n.type === 'MoneyField' && n.props.valueCents === 147000), 'a parcela vem da hipótese');
  const campo = (label: string) => ui.nodes().find((n: any) => n.type === 'Field' && n.props.label === label);
  assert.ok(campo('Total de parcelas'));
  // o nome é o que falta: o formulário pede, e com ele o Salvar liga
  assert.equal(ui.button('Salvar').props.disabled, true);
  ui.fill('Nome', 'Carro');
  ui.press('Salvar');
  const escrita = ui.writes.at(-1);
  assert.equal(escrita.value.installment_cents, 147000);
  assert.equal(escrita.value.installments, 48);
  assert.equal(escrita.value.account_id, 'cc');
  assert.equal(escrita.value.first_due_date, '2026-10-31');
  assert.ok(!('projecao:rascunho' in ui.preferenciasGravadas), 'antes do sucesso o rascunho não muda');
  (ui.pedidos.at(-1) as any).resolver('divida-1');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(ui.preferenciasGravadas['projecao:rascunho'], '', 'a única hipótese saiu');
});

test('Ciclo pela Projeção com hipótese: lê por simular e marca a linha que veio dela', () => {
  const rascunho = JSON.stringify({ versao: 2, adiantamentos: [], hipoteses: [
    { id: 'h1', kind: 'expense', forma: 'repete', valor_cents: 5000, parcelas: 1, repete: 'weekly', conta: 'nu', data: '2026-10-05' }] });
  const ui = screen('src/app/finance/cycle.tsx', {
    params: { month: '2026-10', view: 'cycle', hipoteses: '1' },
    preferencias: { 'projecao:rascunho': rascunho },
    cicloSimulado: {
      ciclo: { mes: '2026-10-01', ini: '2026-09-11', fim: '2026-10-10', estado: 'aberto', comecei_com: 0, entrou: 0, saiu: 5000, resultado: -5000, caixa_no_fim: -5000, faltou_pagar: 0, confere: true },
      linhas: [
        { day: '2026-10-05', in_cents: 0, out_cents: 5000, title: 'Academia', origin: 'recurring_projection', ref_id: 'r1', method_label: null, realizado: false, atrasada: false },
        { day: '2026-10-10', in_cents: 0, out_cents: 90000, title: 'Fatura Nubank', origin: 'invoice', ref_id: 'f1', method_label: 'Nubank', realizado: false, atrasada: false },
      ],
      idsHipotese: ['r1'], faturasComHipotese: ['f1'], erros: [],
    },
  });
  const heads = ui.nodes().filter((n: any) => n.type === 'SectionHead').map((n: any) => n.props.title);
  assert.ok(heads.some((t: string) => /^Hipóteses do rascunho/.test(t)), 'a linha da hipótese vai ao grupo próprio');
  // a fatura que já existia continua no grupo dela, dizendo que inclui a hipótese
  const fatura = ui.nodes().find((n: any) => typeof n.type === 'function' && n.type.name === 'Linha' && n.props.linha.ref_id === 'f1');
  assert.match(fatura.props.linha.method_label, /inclui hipótese/);
});

test('Ciclo com hipótese: leitura que falhou DENTRO do simular mostra o erro, não esqueleto para sempre', () => {
  // Revisão final, 29/09/2026: a leitura do ciclo que falha volta em `erros` (a RPC responde 200),
  // `ciclo` chega nulo e a tela ficava no esqueleto, sem card de erro — a regra do portão.
  const rascunho = JSON.stringify({ versao: 2, adiantamentos: [], hipoteses: [
    { id: 'h1', kind: 'expense', forma: 'uma', valor_cents: 1000, parcelas: 1, repete: 'monthly', conta: null, data: '2026-10-01' }] });
  const ui = screen('src/app/finance/cycle.tsx', {
    params: { month: '2026-10', view: 'cycle', hipoteses: '1' },
    preferencias: { 'projecao:rascunho': rascunho },
    cicloSimulado: { ciclo: null, linhas: null, idsHipotese: [], faturasComHipotese: [], erros: [{ leitura: 'ciclo', mensagem: 'canceling statement due to statement timeout' }] },
  });
  assert.ok(ui.nodes().some((n: any) => n.type === 'ErrorCard'), 'a falha aparece com "Tentar de novo"');
});

test('Desfazer o "Tirar" devolve SÓ o que saiu — não traz de volta o que saiu depois (já aplicado)', () => {
  // Revisão final, 29/09/2026: o Desfazer regravava a cópia INTEIRA de antes; tirar A, aplicar B
  // e tocar no Desfazer de A punha B de volta — contado duas vezes e pronto para duplicar.
  const h = (id: string, valor: number) => ({ id, kind: 'expense', forma: 'uma', valor_cents: valor, parcelas: 1, repete: 'monthly', conta: null, data: '2026-10-01' });
  const ui = screen(forecastFile, { forecastAccounts: [{ id: 'conta-1' }], preferencias: { 'projecao:rascunho': JSON.stringify({ versao: 2, hipoteses: [h('a', 1000), h('b', 2000)], adiantamentos: [] }) } });
  const tirar = (t: RegExp) => ui.interact(() => deslizaveis(ui).find((d: any) => t.test(d.props.titulo)).props.acoes.find((a: any) => a.label === 'Tirar').onPress());
  tirar(/10\.00/);
  const desfazerA = ui.toasts.at(-1).action;
  tirar(/20\.00/); // o mesmo efeito, no rascunho, de B ter sido aplicada
  ui.interact(() => desfazerA.onPress());
  assert.deepEqual(JSON.parse(ui.preferenciasGravadas['projecao:rascunho']).hipoteses.map((x: any) => x.id), ['a']);
});

test('Projeção mês a mês: os dois "hoje" dizem o que são, e o rodapé nomeia o fim real do horizonte', () => {
  // 29/09/2026, *"setembro não seria o mês atual? A conta tá correta?"*: a conta estava, a tela
  // não dizia. "tenho hoje" (depois do que vence hoje, atrasados inclusive) e "hoje você tem" (o
  // que está na conta) tinham números diferentes; e "Projeção até 01/12" era o começo do mês que
  // a lista esconde, não o fim dos 90 dias.
  const meses = [
    { mes: '2026-09-01', de: '2026-09-01', ate: '2026-09-30', entra: 0, sai: 1049730, saldo: 3465769, parcial: true, primeiroNegativo: null },
    { mes: '2026-10-01', de: '2026-10-01', ate: '2026-10-31', entra: 0, sai: 372500, saldo: 3093269, parcial: false, primeiroNegativo: null },
    { mes: '2026-11-01', de: '2026-11-01', ate: '2026-11-30', entra: 0, sai: 308000, saldo: 2785269, parcial: false, primeiroNegativo: null },
    { mes: '2026-12-01', de: '2026-12-01', ate: '2026-12-31', entra: 0, sai: 308000, saldo: 2477269, parcial: true, primeiroNegativo: null },
  ];
  const ui = screen(forecastFile, { forecastAccounts: [{ id: 'conta-1' }], forecastMonths: meses });
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'Segmented' && n.props.options.some((o: any) => o.value === 'mes')).props.onChange('mes'));
  const textos = JSON.stringify(ui.nodes().map((n: any) => [n.props?.children, n.props?.subtitle]));
  assert.match(textos, /no fim de hoje/);
  assert.doesNotMatch(textos, /tenho hoje|hoje você tem/);
  assert.match(textos, /em conta hoje R\$/);
  assert.match(textos, /A projeção vai até \d{2}\/\d{2}\/\d{4}; Dezembro de 2026 está incompleto/);
});

test('Dinheiro de DESTAQUE (money, heroMoney) encolhe sozinho: ocupa a linha e não tem para onde descer', () => {
  // 29/09/2026, accessibility-large: o "Vou fechar em +R$ 32.22…" do ciclo — e o mesmo risco em
  // onze telas (total da fatura, das dívidas, das metas…). O valor de linha continua sem encolher.
  const destaque = screen('src/components/ui/money.tsx', { componente: 'Money', props: { cents: 3222769, variant: 'money' } });
  assert.equal(destaque.nodes().find((n: any) => n.type === 'ThemedText').props.adjustsFontSizeToFit, true);
  const heroi = screen('src/components/ui/money.tsx', { componente: 'Money', props: { cents: 3222769, variant: 'heroMoney' } });
  assert.equal(heroi.nodes().find((n: any) => n.type === 'ThemedText').props.adjustsFontSizeToFit, true);
  const linha = screen('src/components/ui/money.tsx', { componente: 'Money', props: { cents: 3222769, variant: 'ticker' } });
  assert.equal(linha.nodes().find((n: any) => n.type === 'ThemedText').props.adjustsFontSizeToFit, false);
});

test('Hipótese que o banco recusou: a linha diz o motivo NOSSO e nunca o texto cru do Postgres', () => {
  // Revisão final, 29/09/2026: "new row for relation debts violates check constraint…" aparecia na
  // linha. Só a frase de `raise exception` (P0001) é para a pessoa ler — a régua de financeErrorMessage.
  const h = (id: string, valor: number) => ({ id, kind: 'expense', forma: 'uma', valor_cents: valor, parcelas: 1, repete: 'monthly', conta: null, data: '2026-10-01' });
  // a incompleta do meio fica fora da simulação: o índice do erro é o das COMPLETAS
  const hipoteses = [h('a', 1000), h('x', 0), h('b', 2000)];
  const ui = screen(forecastFile, {
    forecastAccounts: [{ id: 'conta-1' }],
    preferencias: { 'projecao:rascunho': JSON.stringify({ versao: 2, hipoteses: hipoteses, adiantamentos: [] }) },
    simulacao: { forecast: [], erros: [
      { indice: 0, mensagem: 'new row for relation "transactions" violates check constraint "x"', codigo: '23514' },
      { indice: 1, mensagem: 'A conta foi arquivada.', codigo: 'P0001' },
    ] },
  });
  const linhas = ui.nodes().filter((n: any) => n.type === 'Row' && String(n.props.accessibilityLabel).startsWith('Hipótese:')).map((n: any) => n.props.subtitle);
  assert.deepEqual(linhas, ['Não dá para aplicar: o banco recusou esta hipótese. Abra e confira os campos.', 'Digite o valor', 'Não dá para aplicar: A conta foi arquivada.']);
});

test('E se: no teto de 30 hipóteses, "Nova hipótese" diz o limite em vez de abrir a folha', () => {
  // Revisão final, 29/09/2026: a 31ª derrubava a simulação inteira com um erro genérico.
  const hipoteses = Array.from({ length: 30 }, (_, i) => ({ id: `h${i}`, kind: 'expense', forma: 'uma', valor_cents: 100, parcelas: 1, repete: 'monthly', conta: null, data: '2026-10-01' }));
  const ui = screen(forecastFile, { forecastAccounts: [{ id: 'conta-1' }], preferencias: { 'projecao:rascunho': JSON.stringify({ versao: 2, hipoteses: hipoteses, adiantamentos: [] }) } });
  ui.press('Nova hipótese');
  assert.equal(ui.nodes().some((n: any) => n.type === 'Sheet' && n.props.visible), false);
  assert.match(ui.toasts.at(-1).message, /30 hipóteses/);
});

test('E se: o erro da simulação ANTERIOR não aparece enquanto a nova calcula (o índice já mudou)', () => {
  // Revisão final, 29/09/2026: depois de um Tirar, o erro do índice 1 da resposta velha caía na
  // linha que agora é a 1 — outra hipótese.
  const hipoteses = [{ id: 'a', kind: 'expense', forma: 'uma', valor_cents: 100, parcelas: 1, repete: 'monthly', conta: null, data: '2026-10-01' }];
  const ui = screen(forecastFile, {
    forecastAccounts: [{ id: 'conta-1' }],
    preferencias: { 'projecao:rascunho': JSON.stringify({ versao: 2, hipoteses: hipoteses, adiantamentos: [] }) },
    simulacao: { forecast: [], erros: [{ indice: 0, mensagem: 'x', codigo: 'P0001' }], placeholder: true },
  });
  const linha = ui.nodes().find((n: any) => n.type === 'Row' && String(n.props.accessibilityLabel).startsWith('Hipótese:'));
  assert.equal(linha.props.subtitle, undefined);
});

test('Folha da hipótese: Sai oferece as quatro formas; Entra só "Uma vez" e "Repete"; financiamento sem cartão', () => {
  const h = { id: 'h1', kind: 'expense', forma: 'uma', valor_cents: 0, parcelas: 2, repete: 'monthly', conta: null, data: '2026-10-05' };
  let atual: any = h;
  const contas = [{ id: 'cc', name: 'Itaú', type: 'checking' }, { id: 'nu', name: 'Nubank Cartão', type: 'credit_card', closing_day: 3 }];
  const props = (valor: any) => ({ valor, onChange: (n: any) => { atual = n; }, contas, max: '2036-10-05' });
  const ui = screen('src/components/finance/campos-da-hipotese.tsx', { componente: 'CamposDaHipotese', props: props(h) });
  const rotulos = (n: any) => JSON.parse(JSON.stringify(n.props.options.map((o: any) => o.label)));
  // A forma é um SelectField, nunca Segmented: "Financiamento" num quarto da largura saía
  // "Financiame…" no iPhone já na fonte padrão (29/09/2026). Cada opção tem o seu glifo.
  const como = (u: any) => u.nodes().find((n: any) => n.type === 'SelectField');
  assert.deepEqual(rotulos(como(ui)), ['Uma vez', 'Parcelado', 'Repete', 'Financiamento']);
  assert.ok(como(ui).props.options.every((o: any) => o.icon));
  assert.equal(ui.nodes().filter((n: any) => n.type === 'Segmented').length, 1, 'só o Tipo é Segmented');
  // trocar para Entra com uma forma que Entra não tem volta a "Uma vez"
  const parcelado = screen('src/components/finance/campos-da-hipotese.tsx', { componente: 'CamposDaHipotese', props: props({ ...h, forma: 'parcelado' }) });
  parcelado.interact(() => parcelado.nodes().filter((n: any) => n.type === 'Segmented')[0].props.onChange('income'));
  assert.deepEqual(JSON.parse(JSON.stringify([atual.kind, atual.forma])), ['income', 'uma']);
  const entra = screen('src/components/finance/campos-da-hipotese.tsx', { componente: 'CamposDaHipotese', props: props({ ...h, kind: 'income' }) });
  assert.deepEqual(rotulos(como(entra)), ['Uma vez', 'Repete']);
  // escolher financiamento com um cartão escolhido tira o cartão (cartão não paga financiamento)
  const noCartao = screen('src/components/finance/campos-da-hipotese.tsx', { componente: 'CamposDaHipotese', props: props({ ...h, conta: 'nu' }) });
  noCartao.interact(() => como(noCartao).props.onChange('financiamento'));
  assert.deepEqual(JSON.parse(JSON.stringify([atual.forma, atual.conta])), ['financiamento', null]);
  const fin = screen('src/components/finance/campos-da-hipotese.tsx', { componente: 'CamposDaHipotese', props: props({ ...h, forma: 'financiamento' }) });
  const picker = fin.nodes().find((n: any) => n.type === 'AccountPicker');
  assert.deepEqual(JSON.parse(JSON.stringify(picker.props.accounts.map((a: any) => a.id))), ['cc']);
  assert.equal(picker.props.emptyLabel, undefined, 'financiamento exige a conta');
  const cal = fin.nodes().find((n: any) => n.type === 'Calendar');
  assert.equal(cal.props.max, '2036-10-05');
  assert.ok(cal.props.min, 'o calendário não deixa escolher antes de hoje');
  // uma vez aceita "Sem conta" e diz o que isso significa
  const semConta = screen('src/components/finance/campos-da-hipotese.tsx', { componente: 'CamposDaHipotese', props: props(h) });
  assert.equal(semConta.nodes().find((n: any) => n.type === 'AccountPicker').props.emptyLabel, 'Sem conta');
  assert.ok(semConta.nodes().some((n: any) => n.type === 'Note'));
});

test('Onde muda: conta negativa, cartão acima do limite e cartão sem limite, cada um com a frase', () => {
  const conta = (fim: number) => ({ account_id: 'cc', nome: 'Itaú', tipo: 'checking', saldo_hoje: 0, menor: fim, dia_do_menor: '2026-11-12', saldo_fim: fim, negativa_em: null });
  const mudancas = [
    { tipo: 'conta', account_id: 'cc', nome: 'Itaú', antes: conta(420000), depois: conta(-10000), ficaNegativaEm: '2026-11-12' },
    { tipo: 'cartao', account_id: 'nu', nome: 'Nubank Cartão', semLimite: false, livreAntes: 20000, livreDepois: -10000, passaDoLimiteEm: 10000, faturas: [{ vencimento: '2026-11-10', antes: 135000, depois: 165000 }] },
    { tipo: 'cartao', account_id: 'd', nome: 'Cartão D', semLimite: true, livreAntes: null, livreDepois: null, passaDoLimiteEm: null, faturas: [{ vencimento: '2026-11-10', antes: 0, depois: 5000 }] },
  ];
  const abertos: string[] = [];
  const ui = screen('src/components/finance/onde-muda.tsx', { componente: 'OndeMuda', props: { mudancas, onAbrir: (id: string) => abertos.push(id) } });
  const linhas = ui.nodes().filter((n: any) => n.type === 'Row');
  assert.deepEqual(linhas.map((l: any) => l.props.title), ['Itaú', 'Nubank Cartão', 'Cartão D']);
  assert.match(linhas[0].props.subtitle, /No fim: R\$ 4200\.00 → R\$ -100\.00 · Fica negativa em 12\/11/);
  assert.match(linhas[1].props.subtitle, /Fatura de 10\/11: R\$ 1350\.00 → R\$ 1650\.00 · Passa do limite em R\$ 100\.00/);
  assert.match(linhas[2].props.subtitle, /Sem limite cadastrado/);
  assert.equal(linhas[0].props.destructive, true);
  assert.equal(linhas[2].props.destructive, false);
  ui.interact(() => linhas[1].props.onPress());
  assert.deepEqual(abertos, ['nu']);
  assert.equal(screen('src/components/finance/onde-muda.tsx', { componente: 'OndeMuda', props: { mudancas: [], onAbrir: () => {} } }).nodes().length, 0);
});

test('E se: UM botão "Nova hipótese"; nada de "Adicionar como…" nem "Aplicar todas"', () => {
  const ui = screen(forecastFile, { forecastAccounts: [{ id: 'conta-1' }] });
  const botoes = ui.nodes().filter((n: any) => n.type === 'Button').map((n: any) => n.props.label);
  assert.ok(botoes.includes('Nova hipótese'));
  assert.ok(!botoes.includes('Adicionar como…') && !botoes.includes('Aplicar todas') && !botoes.includes('Supor um lançamento'));
});

test('E se: a linha da hipótese aplica pelo formulário com tudo e tira PELO ID', () => {
  const hipoteses = [
    { id: 'a', kind: 'expense', forma: 'parcelado', valor_cents: 300000, parcelas: 10, repete: 'monthly', conta: 'nu', data: '2026-10-05' },
    { id: 'b', kind: 'expense', forma: 'uma', valor_cents: 1000, parcelas: 1, repete: 'monthly', conta: null, data: '2026-10-06' },
  ];
  const ui = screen(forecastFile, { forecastAccounts: [{ id: 'nu', name: 'Nubank Cartão', type: 'credit_card' }], preferencias: { 'projecao:rascunho': JSON.stringify({ versao: 2, hipoteses, adiantamentos: [] }) } });
  const linha = (t: RegExp) => deslizaveis(ui).find((d: any) => t.test(d.props.titulo));
  ui.interact(() => linha(/10×/).props.acoes.find((a: any) => a.label === 'Aplicar').onPress());
  assert.deepEqual(JSON.parse(JSON.stringify(ui.navigations.at(-1))), { pathname: '/finance/lancar', params: { tipo: 'uma', deHipotese: 'a', kind: 'expense', amount: '300000', data: '05/10/2026', parcelas: '10', conta: 'nu' } });
  ui.interact(() => linha(/sem conta/).props.acoes.find((a: any) => a.label === 'Tirar').onPress());
  assert.deepEqual(JSON.parse(ui.preferenciasGravadas['projecao:rascunho']).hipoteses.map((h: any) => h.id), ['a']);
  // o Desfazer devolve a que saiu
  ui.interact(() => ui.toasts.at(-1).action.onPress());
  assert.deepEqual(JSON.parse(ui.preferenciasGravadas['projecao:rascunho']).hipoteses.map((h: any) => h.id), ['a', 'b']);
});

test('E se: as hipóteses completas vão à simulação com o detalhe por conta; a incompleta não', () => {
  const hipoteses = [
    { id: 'a', kind: 'expense', forma: 'uma', valor_cents: 1000, parcelas: 1, repete: 'monthly', conta: 'cc', data: '2026-10-05' },
    { id: 'b', kind: 'expense', forma: 'parcelado', valor_cents: 900, parcelas: 3, repete: 'monthly', conta: null, data: '2026-10-05' },
  ];
  const ui = screen(forecastFile, { forecastAccounts: [{ id: 'cc', name: 'Itaú', type: 'checking' }], preferencias: { 'projecao:rascunho': JSON.stringify({ versao: 2, hipoteses, adiantamentos: [] }) } });
  const o = ui.simulacoes.at(-1);
  assert.equal(o.porConta, true);
  assert.deepEqual(JSON.parse(JSON.stringify(o.hipoteses.map((h: any) => h.id))), ['a', 'b'], 'o hook recebe todas e descarta a incompleta');
  const incompleta = ui.nodes().find((n: any) => n.type === 'Row' && /Escolha a conta/.test(n.props.subtitle ?? ''));
  assert.ok(incompleta, 'a linha incompleta diz o que falta');
});

test('E se: com hipótese, "Onde muda" aparece com as contas que mudam e leva ao detalhe', () => {
  const hipoteses = [{ id: 'a', kind: 'expense', forma: 'uma', valor_cents: 50000, parcelas: 1, repete: 'monthly', conta: 'cc', data: '2026-10-05' }];
  const conta = (fim: number, neg: string | null) => ({ account_id: 'cc', nome: 'Itaú', tipo: 'checking', saldo_hoje: 100, menor: fim, dia_do_menor: '2026-10-05', saldo_fim: fim, negativa_em: neg });
  const ui = screen(forecastFile, {
    forecastAccounts: [{ id: 'cc', name: 'Itaú', type: 'checking' }],
    preferencias: { 'projecao:rascunho': JSON.stringify({ versao: 2, hipoteses, adiantamentos: [] }) },
    horizonte: { contas: [conta(40000, null)], cartoes: [] },
    simulacao: { forecast: [], contas: [conta(-10000, '2026-10-05')], cartoes: [], erros: [] },
  });
  const bloco = ui.nodes().find((n: any) => n.type === 'OndeMuda');
  assert.equal(bloco.props.mudancas.length, 1);
  ui.interact(() => bloco.props.onAbrir('cc'));
  // o horizonte vai junto: o detalhe mostra a MESMA janela que a Projeção (esticada pela hipótese)
  assert.deepEqual(JSON.parse(JSON.stringify(ui.navigations.at(-1))), { pathname: '/finance/hipotese', params: { conta: 'cc', dias: '90' } });
});

test('E se: rascunho da versão 1 no aparelho continua abrindo; a parcelada sem conta pede a conta', () => {
  const ui = screen(forecastFile, { forecastAccounts: [{ id: 'cc' }], preferencias: { 'projecao:rascunho': JSON.stringify({ versao: 1, detalhadas: [], rapidas: [{ kind: 'expense', amount_cents: 900, start: '2026-10-02', installments: 3, mode: 'total', grupo: 'g2' }] }) } });
  assert.ok(ui.nodes().find((n: any) => n.type === 'Row' && /Escolha a conta/.test(n.props.subtitle ?? '')));
});

test('E se: a folha cria a hipótese com conta, forma e data, e "Ver resultado" só com ela completa', () => {
  const ui = screen(forecastFile, { forecastAccounts: [{ id: 'cc', name: 'Itaú', type: 'checking' }] });
  ui.interact(() => ui.nodes().find((n: any) => n.type === 'Button' && n.props.label === 'Nova hipótese').props.onPress());
  const campos = () => ui.nodes().find((n: any) => n.type === 'CamposDaHipotese');
  const ver = () => ui.nodes().find((n: any) => n.type === 'TaskHeader').props.action;
  assert.equal(ver().props.disabled, true, 'sem valor, não dá');
  ui.interact(() => campos().props.onChange({ ...campos().props.valor, valor_cents: 25000, forma: 'parcelado', parcelas: 5, conta: 'cc', data: '2026-11-03' }));
  assert.equal(ver().props.disabled, false);
  ui.interact(() => ver().props.onPress());
  const gravado = JSON.parse(ui.preferenciasGravadas['projecao:rascunho']);
  assert.deepEqual([gravado.hipoteses[0].forma, gravado.hipoteses[0].conta, gravado.hipoteses[0].data, gravado.hipoteses[0].parcelas], ['parcelado', 'cc', '2026-11-03', 5]);
});

test('E se: "Ver o ciclo" leva as hipóteses pelo aparelho, não pela rota', () => {
  const hipoteses = [{ id: 'a', kind: 'expense', forma: 'uma', valor_cents: 1000, parcelas: 1, repete: 'monthly', conta: 'cc', data: '2026-10-05' }];
  const meses = [{ mes: '2026-10-01', de: '2026-10-01', ate: '2026-10-31', entra: 0, sai: 1000, saldo: 9000, parcial: false, primeiroNegativo: null }];
  const ui = screen(forecastFile, { forecastAccounts: [{ id: 'cc' }], forecastMonths: meses, simulacao: { meses: { hoje: 10000, meses }, erros: [] }, preferencias: { 'projecao:rascunho': JSON.stringify({ versao: 2, hipoteses, adiantamentos: [] }) } });
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'Segmented' && n.props.options.some((o: any) => o.value === 'mes'))?.props.onChange('mes'));
  ui.interact(() => ui.nodes().find((n: any) => n.type === 'Row' && /Outubro/.test(n.props.title ?? '')).props.onPress());
  ui.interact(() => ui.nodes().find((n: any) => n.type === 'Button' && n.props.label === 'Ver o ciclo').props.onPress());
  const nav = JSON.parse(JSON.stringify(ui.navigations.at(-1)));
  assert.equal(nav.params.hipoteses, '1');
  assert.equal(nav.params.rascunho, undefined);
  assert.equal(nav.params.detalhadas, undefined);
});

const hipoteseFile = 'src/app/finance/hipotese.tsx';
const textoDa = (ui: any) => JSON.stringify(ui.nodes().map((n: any) => [n.props?.children, n.props?.title, n.props?.subtitle, n.props?.label]));

test('Detalhe da hipótese — conta: hoje, menor (e o dia) e fim, antes → depois; e as hipóteses dela', () => {
  const c = (hoje: number, menor: number, fim: number, neg: string | null) => ({ account_id: 'cc', nome: 'Itaú', tipo: 'checking', saldo_hoje: hoje, menor, dia_do_menor: '2026-11-12', saldo_fim: fim, negativa_em: neg });
  const ui = screen(hipoteseFile, { params: { conta: 'cc', dias: '90' }, forecastAccounts: [{ id: 'cc', name: 'Itaú', type: 'checking' }],
    preferencias: { 'projecao:rascunho': JSON.stringify({ versao: 2, adiantamentos: [], hipoteses: [
      { id: 'a', kind: 'expense', forma: 'uma', valor_cents: 50000, parcelas: 1, repete: 'monthly', conta: 'cc', data: '2026-11-12' },
      { id: 'b', kind: 'expense', forma: 'uma', valor_cents: 7000, parcelas: 1, repete: 'monthly', conta: 'outra', data: '2026-11-12' }] }) },
    horizonte: { contas: [c(100000, 40000, 40000, null)], cartoes: [] }, simulacao: { contas: [c(100000, -10000, -10000, '2026-11-12')], cartoes: [], erros: [] } });
  const t = textoDa(ui);
  assert.match(t, /Fica negativa em 12\/11\/2026/);
  assert.match(t, /Sai R\$ 500\.00 · Itaú · em 12\/11\/2026/);
  assert.doesNotMatch(t, /R\$ 70\.00/, 'só as hipóteses DESTA conta');
  // os três pares, antes → depois
  const pares = ui.nodes().filter((n: any) => typeof n.type === 'function' && n.type.name === 'AntesDepois').map((n: any) => [n.props.rotulo, n.props.antes, n.props.depois]);
  assert.deepEqual(JSON.parse(JSON.stringify(pares.map((p: any) => [p[1], p[2]]))), [[100000, 100000], [40000, -10000], [40000, -10000]]);
  assert.equal(pares[1][0], 'Menor saldo · 12/11/2026', 'com o ano: o horizonte vai a 10 anos');
  // quem lê a simulação é o hook de sempre, com o detalhe por conta e a janela da Projeção
  const o = ui.simulacoes.at(-1);
  assert.equal(o.porConta, true);
  assert.equal(o.dias, 90);
});

test('Detalhe da hipótese — cartão sem limite: diz e oferece cadastrar; com limite estourado: quanto', () => {
  const k = (limite: number | null, livre: number | null, faturas: any[]) => ({ account_id: 'nu', nome: 'Nubank Cartão', limite, livre, faturas });
  const base = { params: { conta: 'nu' }, forecastAccounts: [{ id: 'nu', name: 'Nubank Cartão', type: 'credit_card' }],
    preferencias: { 'projecao:rascunho': JSON.stringify({ versao: 2, adiantamentos: [], hipoteses: [{ id: 'a', kind: 'expense', forma: 'uma', valor_cents: 50000, parcelas: 1, repete: 'monthly', conta: 'nu', data: '2026-10-05' }] }) } };
  const fatura = [{ invoice_id: 'f', vencimento: '2026-11-10', total: 50000, aberto: 50000 }];
  const sem = screen(hipoteseFile, { ...base, horizonte: { contas: [], cartoes: [k(null, null, [])] }, simulacao: { contas: [], cartoes: [k(null, null, fatura)], erros: [] } });
  assert.match(textoDa(sem), /Sem limite cadastrado/);
  sem.press('Cadastrar o limite');
  assert.deepEqual(JSON.parse(JSON.stringify(sem.navigations.at(-1))), { pathname: '/finance/accounts', params: { edit: 'nu' } });
  // a fatura que muda: vence quando, antes → depois
  const linha = sem.nodes().find((n: any) => n.type === 'Row' && n.props.title === 'Vence 10/11/2026');
  assert.ok(linha, 'a fatura que muda');
  const estoura = screen(hipoteseFile, { ...base, horizonte: { contas: [], cartoes: [k(100000, 20000, [])] }, simulacao: { contas: [], cartoes: [k(100000, -30000, fatura)], erros: [] } });
  assert.match(textoDa(estoura), /Passa do limite em R\$ 300\.00/);
  assert.doesNotMatch(textoDa(estoura), /Cadastrar o limite/);
  // 72× são 72 faturas: 20 por vez, com "Ver mais" (frontend.md, "aos poucos")
  const muitas = Array.from({ length: 25 }, (_, i) => ({ invoice_id: `f${i}`, vencimento: `20${27 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-10`, total: 1000, aberto: 1000 }));
  const longa = screen(hipoteseFile, { ...base, horizonte: { contas: [], cartoes: [k(100000, 20000, [])] }, simulacao: { contas: [], cartoes: [k(100000, -5000, muitas)], erros: [] } });
  assert.equal(longa.nodes().filter((n: any) => n.type === 'Row' && /^Vence /.test(n.props.title)).length, 20);
  assert.equal(longa.nodes().find((n: any) => n.type === 'VerMais').props.restantes, 5);
});

test('Detalhe da hipótese — conta que não existe mais, rascunho vazio e erro da leitura', () => {
  const nada = screen(hipoteseFile, { params: { conta: 'sumiu' }, forecastAccounts: [], horizonte: { contas: [], cartoes: [] }, simulacao: { contas: [], cartoes: [], erros: [] } });
  assert.ok(nada.nodes().some((n: any) => n.type === 'EmptyState' && n.props.compacto));
  const rascunho = JSON.stringify({ versao: 2, adiantamentos: [], hipoteses: [{ id: 'a', kind: 'expense', forma: 'uma', valor_cents: 1, parcelas: 1, repete: 'monthly', conta: 'cc', data: '2026-10-05' }] });
  const erro = screen(hipoteseFile, { params: { conta: 'cc' }, forecastAccounts: [{ id: 'cc', name: 'Itaú', type: 'checking' }], preferencias: { 'projecao:rascunho': rascunho }, horizonte: { contas: [], cartoes: [] }, simulacao: { contas: null, cartoes: [], erros: [{ leitura: 'contas', mensagem: 'x', codigo: 'XX000' }] } });
  assert.ok(erro.nodes().some((n: any) => n.type === 'ErrorCard'));
});

test('E se: só com hipótese incompleta nada é simulado e o "Onde muda" não fica em esqueleto (revisão final)', () => {
  // A parcelada da v1 sem conta fica fora da simulação: a consulta desligada fica `isPending`
  // para sempre, e o bloco desenhava esqueleto eterno (frontend.md, consulta desligada).
  const ui = screen(forecastFile, { forecastAccounts: [{ id: 'cc' }], preferencias: { 'projecao:rascunho': JSON.stringify({ versao: 1, rapidas: [{ kind: 'expense', amount_cents: 900, start: '2026-10-02', installments: 3, mode: 'total', grupo: 'g' }], detalhadas: [] }) } });
  assert.equal(ui.simulacoes.at(-1).enabled, false);
  assert.equal(ui.nodes().some((n: any) => n.type === 'SkeletonList'), false);
  // e a leitura que falha DENTRO do simular vira faixa de erro, não esqueleto ao lado dela
  const hipoteses = [{ id: 'a', kind: 'expense', forma: 'uma', valor_cents: 1000, parcelas: 1, repete: 'monthly', conta: 'cc', data: '2026-10-05' }];
  const erro = screen(forecastFile, { forecastAccounts: [{ id: 'cc' }], preferencias: { 'projecao:rascunho': JSON.stringify({ versao: 2, hipoteses, adiantamentos: [] }) }, simulacao: { forecast: [], contas: null, cartoes: null, erros: [{ leitura: 'contas', mensagem: 'x', codigo: 'XX000' }] } });
  assert.equal(erro.nodes().some((n: any) => n.type === 'SkeletonList'), false);
  assert.ok(erro.nodes().some((n: any) => n.type === 'ErrorBand' || (typeof n.type === 'function' && n.type.name === 'ErrorBand')));
});

test('Aplicar recorrente e financiamento abre o formulário único no tipo certo, com a hipótese nos corpos', () => {
  // 29/09/2026, *"devo conseguir criar tudo direto ali… e não ser redirecionado para a tela deles"*:
  // o formulário único é um modal por cima de quem abriu, sem lista por trás.
  const rec = screen(lancarFile, { params: { tipo: 'recorrente', deHipotese: 'r', kind: 'expense', amount: '5000', start: '06/10/2026', account: 'cc', repete: 'weekly' } });
  const serie = rec.nodes().find((n: any) => n.type === 'FormularioDaSerie');
  assert.equal(serie.props.preset, 'weekly');
  assert.equal(serie.props.deHipotese, 'r');
  assert.deepEqual(copia([serie.props.comum.valorCents, serie.props.comum.contaId, serie.props.comum.dataBR]), [5000, 'cc', '06/10/2026']);
  const div = screen(lancarFile, { params: { tipo: 'financiamento', deHipotese: 'f', parcela: '147000', parcelas: '48', conta: 'cc', data: '31/10/2026' } });
  const divida = div.nodes().find((n: any) => n.type === 'FormularioDaDivida');
  assert.equal(divida.props.deHipotese, 'f');
  assert.deepEqual(copia(divida.props.dadosDoAplicar), { parcela: '147000', parcelas: '48', conta: 'cc', data: '31/10/2026' });
  // as rotas "só a folha" saíram do registro: os arquivos são cascas que redirecionam
  const layout = readFileSync('src/app/_layout.tsx', 'utf8');
  assert.equal(/name="finance\/(nova-recorrente|novo-financiamento)"/.test(layout), false);
});

test('Hoje: o Seu dia mostra a MESMA contagem da aba — é dele que o número fala', () => {
  const hoje = '2026-09-08';
  const ui = screen(hojeFile, {
    bills: [
      { ref_id: 'luz', kind: 'transaction', title: 'Luz', due_date: hoje, amount_cents: 1000, overdue: false },
      { ref_id: 'agua', kind: 'transaction', title: 'Água', due_date: '2026-09-11', amount_cents: 1000, overdue: false },
      { ref_id: 'pix', kind: 'income', title: 'Pix', due_date: hoje, amount_cents: 1000, overdue: false },
    ],
    reminders: [{ id: 'r1', title: 'Remédio', next_run_at: `${hoje}T15:00:00.000Z`, done: false }],
    budgets: [{ category: 'lazer', limit_cents: 100, spent_cents: 900 }],
  });
  const seuDia = ui.nodes().find((n: any) => n.type === 'BlockHeader' && n.props.title === 'Seu dia');
  assert.equal(seuDia.props.count, 2, 'a luz de hoje e o lembrete de hoje; nem a água (próximos dias), nem o Pix, nem o orçamento');
});

test('FormularioDaSerie: cria, e "Salvar e criar outro" avisa o hospedeiro sem fechar', async () => {
  const salvos: boolean[] = [];
  const comum = { kind: 'expense', descricao: 'Academia', valorCents: 5000, contaId: 'cc', dataBR: '06/10/2026', categoria: null };
  const ui = screen('src/components/finance/formulario-da-serie.tsx', { componente: 'FormularioDaSerie', segurarMutacoes: true,
    props: { comum, registrarComum: () => {}, onSalvo: (outro: boolean) => salvos.push(outro), onFechar: () => {} } });
  ui.interact(() => ui.nodes().find((n: any) => n.type === 'Button' && n.props.label === 'Salvar e criar outro').props.onPress());
  assert.equal(ui.writes.at(-1).operation, 'createRecurring');
  (ui.pedidos.at(-1) as any).resolver('rec-1');
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(salvos, [true]);
  // editando não há "criar outro"
  const edit = screen('src/components/finance/formulario-da-serie.tsx', { componente: 'FormularioDaSerie', recurring: [{ id: 'r1', kind: 'expense', amount_cents: 5000, description: 'Academia', rrule: 'FREQ=MONTHLY;BYMONTHDAY=6', next_run_at: '2026-10-06T12:00:00Z', dtstart: '2026-10-06T12:00:00Z', active: true, account_id: null, category: null, merchant: null, end_date: null, auto_confirm: false }],
    props: { comum, registrarComum: () => {}, editandoId: 'r1', onSalvo: () => {}, onFechar: () => {} } });
  assert.equal(edit.nodes().some((n: any) => n.props?.label === 'Salvar e criar outro'), false);
});

test('FormularioDaSerie: editando com a série ainda não carregada, espera — nunca vira criação', () => {
  const comum = { kind: 'expense', descricao: 'Academia', valorCents: 5000, contaId: 'cc', dataBR: '06/10/2026', categoria: null };
  const props = { comum, registrarComum: () => {}, registrarEstado: () => {}, editandoId: 'r1', onSalvo: () => {}, onFechar: () => {} };
  const botoes = (ui: any) => ui.nodes().filter((n: any) => n.type === 'Button').map((n: any) => n.props.label);
  const vazio = screen('src/components/finance/formulario-da-serie.tsx', { componente: 'FormularioDaSerie', recurring: [], props });
  assert.equal(botoes(vazio).some((l: string) => l === 'Criar' || l === 'Salvar e criar outro'), false, 'sem a série não há como criar');
  vazio.interact((nodes: any[]) => nodes.forEach((n) => n.props?.onPress?.()));
  assert.equal(vazio.writes.length, 0, 'nenhum toque grava');
  assert.ok(vazio.nodes().some((n: any) => n.type === 'SkeletonList'), 'espera com esqueleto');
  const serie = { id: 'r1', kind: 'expense', amount_cents: 5000, description: 'Academia', rrule: 'FREQ=MONTHLY;BYMONTHDAY=6', next_run_at: '2026-10-06T12:00:00Z', dtstart: '2026-10-06T12:00:00Z', active: true, account_id: null, category: null, merchant: null, end_date: null, auto_confirm: false };
  const pronto = screen('src/components/finance/formulario-da-serie.tsx', { componente: 'FormularioDaSerie', recurring: [serie], props });
  assert.ok(pronto.nodes().some((n: any) => n.type === 'TaskHeader' && n.props.title === 'Editar recorrência'));
  assert.deepEqual(botoes(pronto), ['Salvar']);
});

test('FormularioDaDivida: o comum vira Nome, Conta que paga e Valor da parcela; criar outro avisa o hospedeiro', async () => {
  const salvos: boolean[] = [];
  const comum = { kind: 'expense', descricao: 'Carro 2', valorCents: 147000, contaId: 'cc', dataBR: '31/10/2026', categoria: null };
  const ui = screen('src/components/finance/formulario-da-divida.tsx', { componente: 'FormularioDaDivida', segurarMutacoes: true, forecastAccounts: [{ id: 'cc', name: 'Itaú', type: 'checking' }],
    props: { comum, registrarComum: () => {}, onSalvo: (o: boolean) => salvos.push(o), onFechar: () => {} } });
  assert.ok(ui.nodes().some((n: any) => n.type === 'MoneyField' && n.props.valueCents === 147000));
  ui.fill('Total de parcelas', '48');
  ui.interact(() => ui.nodes().find((n: any) => n.type === 'Button' && n.props.label === 'Salvar e criar outro').props.onPress());
  assert.equal(ui.writes.at(-1).value.name, 'Carro 2');
  (ui.pedidos.at(-1) as any).resolver('d1');
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(salvos, [true]);
});

test('FormularioDaDivida: editando com a dívida ainda não carregada, espera — nunca vira criação', () => {
  const comum = { kind: 'expense', descricao: '', valorCents: 0, contaId: null, dataBR: '', categoria: null };
  const props = { comum, registrarComum: () => {}, registrarEstado: () => {}, editandoId: 'd1', onSalvo: () => {}, onFechar: () => {} };
  const botoes = (ui: any) => ui.nodes().filter((n: any) => n.type === 'Button').map((n: any) => n.props.label);
  const vazio = screen('src/components/finance/formulario-da-divida.tsx', { componente: 'FormularioDaDivida', debts: [], props });
  assert.equal(botoes(vazio).includes('Salvar e criar outro'), false, 'sem a dívida não há como criar');
  vazio.interact((nodes: any[]) => nodes.forEach((n) => n.props?.onPress?.()));
  assert.equal(vazio.writes.length, 0, 'nenhum toque grava');
  assert.ok(vazio.nodes().some((n: any) => n.type === 'SkeletonList'), 'espera com esqueleto');
  assert.ok(vazio.nodes().some((n: any) => n.type === 'TaskHeader' && n.props.title === 'Editar financiamento'), 'o esqueleto já diz o que é');
  const pronto = screen('src/components/finance/formulario-da-divida.tsx', { componente: 'FormularioDaDivida', debts: [carro], props });
  assert.ok(pronto.nodes().some((n: any) => n.type === 'TaskHeader' && n.props.title === 'Editar financiamento'));
  assert.deepEqual(botoes(pronto), ['Salvar']);
  assert.ok(pronto.nodes().some((n: any) => n.type === 'TextField' && n.props.value === 'Carro'), 'o formulário é o da dívida');
});

test('FormularioDaDivida: convertendo, Salvar entrega o financiamento ao hospedeiro com as pagas SEM a linha convertida', () => {
  const destinos: any[] = [];
  const comum = { kind: 'expense', descricao: 'Carro', valorCents: 147000, contaId: 'cc', dataBR: '05/09/2026', categoria: null };
  const ui = screen('src/components/finance/formulario-da-divida.tsx', { componente: 'FormularioDaDivida', forecastAccounts: [{ id: 'cc', name: 'Itaú', type: 'checking' }],
    props: { comum, registrarComum: () => {}, registrarEstado: () => {}, converter: (d: any) => destinos.push(d), onSalvo: () => {}, onFechar: () => {} } });
  assert.equal(ui.nodes().some((n: any) => n.props?.label === 'Salvar e criar outro'), false, 'convertendo não há "criar outro"');
  assert.ok(ui.nodes().some((n: any) => n.type === 'TaskHeader' && n.props.title === 'Novo financiamento'));
  ui.fill('Total de parcelas', '48');
  ui.press('Salvar');
  assert.equal(ui.writes.length, 0, 'quem grava é o hospedeiro');
  assert.equal(destinos.length, 1);
  const { tipo, dados } = JSON.parse(JSON.stringify(destinos[0]));
  assert.equal(tipo, 'financiamento');
  assert.equal(dados.installments_paid, 0, 'o banco adota a linha como 1º pagamento: não se conta aqui');
  assert.equal(dados.first_due_date, '2026-09-05');
  assert.equal(dados.installment_cents, 147000);
  assert.equal(dados.account_id, 'cc');
  assert.equal('id' in dados || 'versao' in dados, false);
});

const lancarFile = 'src/app/finance/lancar.tsx';

test('F01: detalhe da taxa encaminha edição à compra e não cria taxa avulsa pelo menu', () => {
  const fee = { id: 'fee', kind: 'expense', status: 'cleared', amount_cents: 500, description: 'Juros do Pix no crédito',
    category: 'juros', account_id: 'card', counterparty_account_id: null, occurred_at: '2026-10-02', created_at: '2026-10-02T12:00:00Z',
    payment_method: 'pix', pix_fee_for_transaction_id: 'purchase', invoice_id: null, installment_plan_id: null, recurring_id: null, debt_id: null };
  const ui = screen('src/app/finance/[txId].tsx', { txs: [fee], params: { txId: 'fee' } });
  const header = ui.nodes().find((n: any) => n.type === 'HeaderActions');
  ui.interact(() => header.props.actions.find((a: any) => a.label === 'Editar').onPress());
  assert.equal(ui.navigations.at(-1).params.id, 'purchase');
  assert.equal(header.props.menu.actions.some((a: any) => ['Duplicar', 'Mudar categoria'].includes(a.label)), false);
});

test('F01: o link da hipótese entrega a forma de pagamento ao formulário único', () => {
  const ui = screen(lancarFile, { params: { tipo: 'uma', paymentMethod: 'pix' } });
  const form = ui.nodes().find((n: any) => n.type === 'FormularioDoLancamento');
  assert.equal(form.props.comum.paymentMethod, 'pix');
});

test('F01: aplicar hipótese de financiamento conserva a forma no inicializador específico', () => {
  const ui = screen(lancarFile, { params: { tipo: 'financiamento', deHipotese: 'h1', parcela: '5000', parcelas: '12', paymentMethod: 'boleto' } });
  const form = ui.nodes().find((n: any) => n.type === 'FormularioDaDivida');
  assert.equal(form.props.dadosDoAplicar.paymentMethod, 'boleto');
});

test('F01: financiamento conserva a forma entre formatos e grava o padrão do contrato', () => {
  const comum = { kind: 'expense', descricao: 'Carro', valorCents: 5000, contaId: 'cc', dataBR: '06/10/2026', categoria: null, paymentMethod: 'boleto' };
  const registrados: any[] = [];
  const ui = formDivida({ executarEfeitos: true, forecastAccounts: [{ id: 'cc', name: 'Itaú', type: 'checking' }] },
    { comum, registrarComum: (ler: () => any) => registrados.push(ler()) });
  const escolha = ui.nodes().find((n: any) => n.type === 'PaymentMethodField');
  assert.equal(escolha?.props.value, 'boleto');
  ui.fill('Total de parcelas', '12');
  ui.press('Salvar');
  assert.equal(ui.writes.at(-1)?.value.payment_method, 'boleto');
  assert.equal(registrados.at(-1)?.paymentMethod, 'boleto');
});

test('F01: trocar a forma em financiamento não apaga campos; origem incompatível impede gravação', () => {
  const comum = { kind: 'expense', descricao: 'Carro', valorCents: 5000, contaId: 'cc', dataBR: '06/10/2026', categoria: null, paymentMethod: 'boleto' };
  const ui = formDivida({ forecastAccounts: [{ id: 'cc', name: 'Itaú', type: 'checking' }] }, { comum });
  ui.fill('Total de parcelas', '12');
  const escolha = ui.nodes().find((n: any) => n.type === 'PaymentMethodField');
  assert.ok(escolha, 'forma de pagamento disponível');
  ui.interact(() => escolha.props.onChange('cash'));
  assert.equal(ui.button('Salvar').props.disabled, true);
  ui.interact(() => ui.button('Salvar').props.onPress());
  assert.equal(ui.writes.length, 0);
  assert.ok(ui.nodes().some((n: any) => n.type === 'TextField' && n.props.value === 'Carro'));
  assert.ok(ui.nodes().some((n: any) => n.type === 'MoneyField' && n.props.valueCents === 5000));
  assert.equal(ui.nodes().find((n: any) => n.type === 'AccountPicker')?.props.value, 'cc');
});

test('Formato do lançamento: abre as três escolhas acessíveis e devolve a escolha ao recolher o menu', () => {
  const escolhas: string[] = [];
  const ui = screen('src/components/finance/formato-do-lancamento.tsx', {
    componente: 'FormatoDoLancamento', props: { value: 'uma', onChange: (tipo: string) => escolhas.push(tipo) },
  });
  const controle = () => ui.nodes().find((n: any) => n.type === 'PressableScale');
  const radios = () => ui.nodes().filter((n: any) => n.props.accessibilityRole === 'radio');
  assert.equal(controle().props.accessibilityState.expanded, false);
  assert.match(controle().props.accessibilityLabel, /Uma vez/);
  assert.equal(radios().length, 0);
  ui.interact(() => controle().props.onPress());
  assert.equal(controle().props.accessibilityState.expanded, true);
  assert.equal(radios().length, 3);
  assert.deepEqual(radios().map((n: any) => n.props.accessibilityLabel.split(',')[0]), ['Uma vez', 'Recorrente', 'Financiamento']);
  assert.deepEqual(radios().map((n: any) => n.props.accessibilityState.selected), [true, false, false]);
  assert.ok(ui.nodes().some((n: any) => n.props.accessibilityRole === 'radiogroup'));
  ui.interact(() => radios().find((n: any) => n.props.accessibilityLabel.startsWith('Recorrente,')).props.onPress());
  assert.deepEqual(escolhas, ['recorrente']);
  assert.equal(radios().length, 0, 'fecha mesmo enquanto o hospedeiro ainda não trocou o valor');
  assert.equal(controle().props.accessibilityState.expanded, false);
});

test('Formato do lançamento: a opção escolhida e o controle fecham sem solicitar mudança', () => {
  for (const value of ['uma', 'recorrente', 'financiamento']) {
    const escolhas: string[] = [];
    const ui = screen('src/components/finance/formato-do-lancamento.tsx', {
      componente: 'FormatoDoLancamento', props: { value, onChange: (tipo: string) => escolhas.push(tipo) },
    });
    const controle = () => ui.nodes().find((n: any) => n.type === 'PressableScale');
    ui.interact(() => controle().props.onPress());
    ui.interact((nodes) => nodes.find((n: any) => n.props.accessibilityRole === 'radio' && n.props.accessibilityState.selected).props.onPress());
    assert.deepEqual(escolhas, []);
    assert.equal(controle().props.accessibilityState.expanded, false);
    ui.interact(() => controle().props.onPress());
    ui.interact(() => controle().props.onPress());
    assert.equal(controle().props.accessibilityState.expanded, false);
    assert.deepEqual(escolhas, []);
  }
});

test('Formato do lançamento: cada alternativa devolve seu tipo ao hospedeiro', () => {
  for (const [value, destino, nome] of [['uma', 'recorrente', 'Recorrente'], ['recorrente', 'financiamento', 'Financiamento'], ['financiamento', 'uma', 'Uma vez']]) {
    const escolhas: string[] = [];
    const ui = screen('src/components/finance/formato-do-lancamento.tsx', {
      componente: 'FormatoDoLancamento', props: { value, onChange: (tipo: string) => escolhas.push(tipo) },
    });
    ui.interact((nodes) => nodes.find((n: any) => n.type === 'PressableScale').props.onPress());
    ui.interact((nodes) => nodes.find((n: any) => n.props.accessibilityRole === 'radio' && n.props.accessibilityLabel.startsWith(`${nome},`)).props.onPress());
    assert.deepEqual(escolhas, [destino]);
    assert.equal(ui.nodes().some((n: any) => n.props.accessibilityRole === 'radio'), false);
  }
});

test('Formato do lançamento: a escolha muda imediatamente uma vez, sem aguardar o menu', () => {
  for (const destino of ['Recorrente', 'Uma vez']) {
    const escolhas: string[] = [];
    const ui = screen('src/components/finance/formato-do-lancamento.tsx', {
      componente: 'FormatoDoLancamento', reduzirMovimento: false, executarEfeitos: true,
      props: { value: 'uma', onChange: (tipo: string) => escolhas.push(tipo) },
    });
    const controle = () => ui.nodes().find((n: any) => n.type === 'PressableScale');
    ui.interact(() => controle().props.onPress());
    const escolher = ui.nodes().find((n: any) => n.props.accessibilityRole === 'radio' && n.props.accessibilityLabel.startsWith(`${destino},`)).props.onPress;
    ui.interact(() => {
      escolher();
      assert.deepEqual(escolhas, destino === 'Recorrente' ? ['recorrente'] : [], 'o callback acontece dentro do toque');
      escolher();
    });
    assert.equal(controle().props.accessibilityState.expanded, false);
    assert.deepEqual(escolhas, destino === 'Recorrente' ? ['recorrente'] : [], 'toque repetido não duplica a mudança');
    assert.equal(ui.animacoes().filter((a) => a.concluir).length, 0, 'o seletor não agenda callback financeiro na conclusão de animação');
  }
});

test('Formato do lançamento: pode reabrir logo após escolher e mudar novamente, sem escolhas duplicadas', () => {
  const escolhas: string[] = [];
  const props: any = { value: 'uma', onChange: (tipo: string) => { escolhas.push(tipo); props.value = tipo; } };
  const ui = screen('src/components/finance/formato-do-lancamento.tsx', {
    componente: 'FormatoDoLancamento', reduzirMovimento: false, executarEfeitos: true, props,
  });
  const controle = () => ui.nodes().find((n: any) => n.type === 'PressableScale');
  const abrir = () => ui.interact(() => controle().props.onPress());
  const escolher = (nome: string) => ui.interact((nodes) => nodes.find((n: any) => n.props.accessibilityRole === 'radio' && n.props.accessibilityLabel.startsWith(`${nome},`)).props.onPress());
  abrir(); escolher('Recorrente');
  assert.deepEqual(escolhas, ['recorrente']);
  abrir();
  assert.equal(controle().props.accessibilityState.expanded, true);
  assert.equal(ui.nodes().filter((n: any) => n.props.accessibilityRole === 'radio').length, 3);
  escolher('Financiamento');
  assert.deepEqual(escolhas, ['recorrente', 'financiamento']);
  assert.match(controle().props.accessibilityLabel, /Financiamento/);
  abrir(); escolher('Financiamento');
  assert.deepEqual(escolhas, ['recorrente', 'financiamento'], 'manter a escolha fecha sem recriar o formulário');
  assert.equal(controle().props.accessibilityState.expanded, false);
});

test('Campos da série: Tipo mantém o padrão de confirmação da criação e o escolhido na edição', () => {
  for (const id of [undefined, 'serie-1']) {
    const props: any = { form: { id, kind: 'expense', description: 'Aluguel', merchant: '', amountCents: 1000,
      category: null, accountId: null, preset: 'monthly', intervalo: '1', inicio: '06/10/2026', fim: '', autoConfirm: true },
      contas: [], onChange: (form: any) => { props.form = form; } };
    const ui = screen('src/components/finance/serie-form.tsx', { componente: 'CamposDaSerie', props });
    // Abas à vista (06/10/2026): o lado do dinheiro não fica escondido numa lista fechada.
    const tipo = () => ui.nodes().find((n: any) => n.type === 'Segmented' && n.props.options.some((o: any) => o.value === 'income'));
    ui.interact(() => tipo().props.onChange('income'));
    assert.equal(props.form.kind, 'income');
    assert.equal(props.form.autoConfirm, Boolean(id), 'editar preserva a escolha; criar acompanha o tipo');
    ui.interact(() => tipo().props.onChange('expense'));
    assert.equal(props.form.autoConfirm, true);
  }
});

test('Campos da série: Repete preserva campos e marca apenas a agenda que foi alterada', () => {
  const props: any = { form: { id: 'serie-1', kind: 'expense', description: 'Aluguel', merchant: '', amountCents: 1000,
    category: null, accountId: null, preset: 'monthly', intervalo: '2', inicio: '06/10/2026', fim: '', autoConfirm: true },
    contas: [], onChange: (form: any) => { props.form = form; } };
  const ui = screen('src/components/finance/serie-form.tsx', { componente: 'CamposDaSerie', props });
  const repete = () => ui.nodes().find((n: any) => n.type === 'SelectField' && n.props.options.some((o: any) => o.id === 'weekly'));
  ui.interact(() => repete().props.onChange('weekly'));
  assert.equal(props.form.preset, 'weekly');
  assert.equal(props.form.agendaMudou, true);
  assert.equal(props.form.intervalo, '2');
  assert.equal(props.form.inicio, '06/10/2026');
  assert.equal(props.form.description, 'Aluguel');
  ui.interact(() => repete().props.onChange('yearly'));
  assert.equal(props.form.preset, 'yearly');
  props.form = { ...props.form, regraPropria: 'FREQ=DAILY' };
  ui.interact(() => {});
  assert.equal(repete(), undefined, 'regra própria não aparece como uma frequência que o app não sabe representar');
  assert.ok(ui.nodes().some((n: any) => n.type === 'Button' && n.props.label === 'Substituir'));
});

test('Campos da série: tocar no Tipo atual preserva a confirmação escolhida na criação', () => {
  for (const kind of ['expense', 'income']) {
    const mudancas: any[] = [];
    const form = { kind, description: 'Aluguel', merchant: '', amountCents: 1000, category: null,
      accountId: null, preset: 'monthly', intervalo: '1', inicio: '06/10/2026', fim: '', autoConfirm: kind === 'income' };
    const campos = screen('src/components/finance/serie-form.tsx', {
      componente: 'CamposDaSerie', props: { form, contas: [], onChange: (novo: any) => mudancas.push(novo) },
    });
    const tipo = campos.nodes().find((n: any) => n.type === 'Segmented' && n.props.options.some((o: any) => o.value === 'income'));
    campos.interact(() => tipo.props.onChange(kind));
    assert.equal(mudancas.length, 0, 'a aba atual não redefine o padrão de confirmação');
    assert.equal(form.autoConfirm, kind === 'income');
  }
});

test('Campos da série: fechar Repete pela frequência atual não refaz a agenda na edição', () => {
  for (const preset of ['monthly', 'weekly', 'yearly']) {
    const mudancas: any[] = [];
    const form = { id: 'serie-1', kind: 'expense', description: 'Aluguel', merchant: '', amountCents: 1000,
      category: null, accountId: null, preset, intervalo: '2', inicio: '06/10/2026', fim: '', autoConfirm: true, agendaMudou: false };
    const campos = screen('src/components/finance/serie-form.tsx', {
      componente: 'CamposDaSerie', props: { form, contas: [], onChange: (novo: any) => mudancas.push(novo) },
    });
    const repete = campos.nodes().find((n: any) => n.type === 'SelectField' && n.props.options.some((o: any) => o.id === 'weekly'));
    const seletor = screen('src/components/ui/select-field.tsx', { componente: 'SelectField', props: repete.props });
    seletor.interact((nodes) => nodes.find((n: any) => n.props.accessibilityRole === 'button').props.onPress());
    seletor.interact((nodes) => nodes.find((n: any) => n.props.accessibilityRole === 'radio' && n.props.accessibilityState.selected).props.onPress());
    assert.equal(seletor.nodes().some((n: any) => n.props.accessibilityRole === 'radio'), false, 'a lista fecha');
    assert.equal(mudancas.length, 0, 'fechar não marca agendaMudou nem regrava a regra');
    assert.equal(form.agendaMudou, false);
  }
});

test('Lançar: abre no tipo pedido, o seletor troca o corpo e leva os campos comuns', () => {
  const ui = screen(lancarFile, { params: { tipo: 'recorrente' } });
  const seletor = () => ui.nodes().find((n: any) => n.type === 'FormatoDoLancamento');
  assert.equal(seletor().props.value, 'recorrente');
  assert.ok(ui.nodes().some((n: any) => n.type === 'FormularioDaSerie'));
  // o corpo registra o comum; trocar de tipo o entrega ao outro corpo
  const serie = ui.nodes().find((n: any) => n.type === 'FormularioDaSerie');
  ui.interact(() => serie.props.registrarComum(() => ({ kind: 'expense', descricao: 'Academia', valorCents: 5000, contaId: 'cc', dataBR: '06/10/2026', categoria: 'saude' })));
  ui.interact(() => seletor().props.onChange('uma'));
  const lanc = ui.nodes().find((n: any) => n.type === 'FormularioDoLancamento');
  assert.equal(lanc.props.comum.descricao, 'Academia');
  assert.equal(lanc.props.comum.valorCents, 5000);
});

test('Lançar por voz: o formulário abre pré-preenchido e as perguntas do agente vão numa Note no topo', () => {
  const ui = screen(lancarFile, { params: { tipo: 'uma', amount: '30000', parcelas: '3', perguntas: 'Qual cartão?\nValor total ou por parcela?' } });
  const lanc = ui.nodes().find((n: any) => n.type === 'FormularioDoLancamento');
  assert.equal(lanc.props.comum.valorCents, 30000);
  assert.equal(lanc.props.parcelas, 3);
  const notas = ui.nodes().filter((n: any) => n.type === 'Note');
  assert.deepEqual(notas.map((n: any) => n.props.children), ['Qual cartão?', 'Valor total ou por parcela?']);
  assert.equal(screen(lancarFile, { params: { tipo: 'uma' } }).nodes().filter((n: any) => n.type === 'Note').length, 0);
});

test('Lançar: voltar a um tipo devolve TUDO que foi digitado nele, não só os campos comuns', () => {
  const ui = screen(lancarFile, { params: { tipo: 'recorrente' } });
  const seletor = () => ui.nodes().find((n: any) => n.type === 'FormatoDoLancamento');
  const serie = () => ui.nodes().find((n: any) => n.type === 'FormularioDaSerie');
  const digitado = { preset: 'weekly', description: 'Academia', amountCents: 5000 };
  ui.interact(() => serie().props.registrarEstado(() => digitado));
  ui.interact(() => seletor().props.onChange('uma'));
  ui.interact(() => seletor().props.onChange('recorrente'));
  assert.deepEqual(serie().props.estadoGuardado, digitado);
  // "Salvar e criar outro" esvazia o guardado
  ui.interact(() => serie().props.onSalvo(true));
  assert.equal(serie().props.estadoGuardado, undefined);
});

test('Lançar: "Salvar e criar outro" remonta o corpo limpo, mantendo tipo, conta e data', () => {
  const ui = screen(lancarFile, { params: { tipo: 'recorrente' } });
  const serie = () => ui.nodes().find((n: any) => n.type === 'FormularioDaSerie');
  ui.interact(() => serie().props.registrarComum(() => ({ kind: 'income', descricao: 'Freela', valorCents: 90000, contaId: 'cc', dataBR: '10/10/2026', categoria: 'freela' })));
  ui.interact(() => serie().props.onSalvo(true));
  assert.deepEqual(JSON.parse(JSON.stringify(serie().props.comum)), { kind: 'income', descricao: '', valorCents: 0, contaId: 'cc', dataBR: '10/10/2026', categoria: null });
  assert.equal(ui.navigations.length, 0, 'não fechou');
  ui.interact(() => serie().props.onSalvo(false));
  assert.deepEqual(JSON.parse(JSON.stringify(ui.navigations.at(-1))), { back: true });
});

test('Lançar: editando e trocando o tipo, o salvar PERGUNTA o alcance e converte; voltar ao tipo original é edição comum', async () => {
  // `passado: '0'`: a entrada SABE que a série não tem passado (sem o parâmetro, assume que tem).
  const ui = screen(lancarFile, { segurarMutacoes: true, params: { tipo: 'recorrente', id: 'r1', origem: 'serie', passado: '0' },
    recurring: [{ id: 'r1', kind: 'expense', amount_cents: 5000, description: 'Academia', rrule: 'FREQ=MONTHLY;BYMONTHDAY=6', next_run_at: '2026-10-06T12:00:00Z', dtstart: '2026-09-06T12:00:00Z', active: true, account_id: null, category: null, merchant: null, end_date: null, auto_confirm: false }] });
  const seletor = () => ui.nodes().find((n: any) => n.type === 'FormatoDoLancamento');
  // no tipo original o corpo recebe editandoId e NÃO recebe converter
  assert.equal(ui.nodes().find((n: any) => n.type === 'FormularioDaSerie').props.editandoId, 'r1');
  assert.equal(ui.nodes().find((n: any) => n.type === 'FormularioDaSerie').props.converter, undefined);
  ui.interact(() => seletor().props.onChange('uma'));
  const lanc = ui.nodes().find((n: any) => n.type === 'FormularioDoLancamento');
  ui.interact(() => lanc.props.converter({ tipo: 'lancamento', dados: { linhas: [] } }));
  assert.deepEqual(ui.actions.map((a: any) => a.label), ['Converter', 'Manter o atual e criar um novo'], 'série sem passado');
  ui.interact(() => ui.actions[0].onPress());
  assert.equal(ui.writes.at(-1).operation, 'converterRegistro');
  assert.equal(ui.writes.at(-1).value.alcance, 'todas');
  (ui.pedidos.at(-1) as any).resolver({ ids: ['t9'] });
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(JSON.parse(JSON.stringify(ui.navigations)), [
    { dismissAll: true }, { pathname: '/finance/[txId]', params: { txId: 't9' } },
  ]);
  // volta ao original antes de salvar: sem converter
  const volta = screen(lancarFile, { params: { tipo: 'recorrente', id: 'r1', origem: 'serie' }, recurring: [] });
  const s2 = () => volta.nodes().find((n: any) => n.type === 'FormatoDoLancamento');
  volta.interact(() => s2().props.onChange('uma'));
  volta.interact(() => s2().props.onChange('recorrente'));
  assert.equal(volta.nodes().find((n: any) => n.type === 'FormularioDaSerie').props.converter, undefined);
});

test('Lançar: converter Só esta em financiamento abre a nova ficha e remove o detalhe antigo da pilha', async () => {
  const ui = screen(lancarFile, { segurarMutacoes: true, txStatus: 'pending',
    params: { tipo: 'uma', id: 'ocorrencia-antiga', origem: 'transacao', papel: 'ocorrencia' } });
  ui.interact(() => ui.nodes().find((n: any) => n.type === 'FormatoDoLancamento').props.onChange('financiamento'));
  ui.interact(() => ui.nodes().find((n: any) => n.type === 'FormularioDaDivida').props.converter({ tipo: 'financiamento', dados: {} }));
  assert.equal(ui.navigations.length, 0, 'cancelar a pergunta mantém o formulário');
  ui.interact(() => ui.actions.find((a: any) => a.label === 'Só esta').onPress());
  assert.equal(ui.writes.at(-1).value.alcance, 'so_esta');
  assert.equal(ui.navigations.length, 0, 'espera o sucesso do banco');
  (ui.pedidos.at(-1) as any).resolver({ ids: ['financiamento-novo'] });
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(JSON.parse(JSON.stringify(ui.navigations)), [
    { dismissAll: true }, { pathname: '/finance/debts', params: { id: 'financiamento-novo' } },
  ]);
});

test('Lançar: cada alcance bem-sucedido abre a série de resultado, inclusive Manter', async () => {
  for (const label of ['Só esta', 'Desta em diante', 'Todas, apagando as anteriores', 'Manter o atual e criar um novo']) {
    const ui = screen(lancarFile, { segurarMutacoes: true,
      params: { tipo: 'uma', id: 'ocorrencia-antiga', origem: 'transacao', papel: 'ocorrencia' } });
    ui.interact(() => ui.nodes().find((n: any) => n.type === 'FormatoDoLancamento').props.onChange('recorrente'));
    ui.interact(() => ui.nodes().find((n: any) => n.type === 'FormularioDaSerie').props.converter({ tipo: 'recorrente', dados: { dtstart: '2026-12-22T12:00:00Z' } }));
    ui.interact(() => ui.actions.find((a: any) => a.label === label).onPress());
    if (label.startsWith('Todas')) ui.interact(() => ui.confirmations.at(-1)!());
    (ui.pedidos.at(-1) as any).resolver({ ids: ['serie-nova'] });
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(JSON.parse(JSON.stringify(ui.navigations)), [
      { dismissAll: true }, { pathname: '/finance/transactions', params: { recurringId: 'serie-nova', month: '2026-12' } },
    ], label);
  }
});

test('Lançar: parcelada convertida abre um lançamento do resultado, e não o ID do plano', async () => {
  const ui = screen(lancarFile, { segurarMutacoes: true, params: { tipo: 'recorrente', id: 'serie-antiga', origem: 'serie', passado: '0' } });
  ui.interact(() => ui.nodes().find((n: any) => n.type === 'FormatoDoLancamento').props.onChange('uma'));
  ui.interact(() => ui.nodes().find((n: any) => n.type === 'FormularioDoLancamento').props.converter({ tipo: 'parcelada', dados: {} }));
  ui.interact(() => ui.actions.find((a: any) => a.label === 'Converter').onPress());
  (ui.pedidos.at(-1) as any).resolver({ ids: ['plano-novo', 'parcela-nova'] });
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(JSON.parse(JSON.stringify(ui.navigations)), [
    { dismissAll: true }, { pathname: '/finance/[txId]', params: { txId: 'parcela-nova' } },
  ]);
});

test('Lançar: a dívida CARREGADA com parcela paga tem passado, mesmo com `passado=0` na rota', () => {
  // Logo depois do "Paguei", a linha da lista ainda pode dizer 0: a rota é palpite, a dívida é a
  // verdade. Sem isso, "Converter" (sem confirmação) vira `todas` e apaga os pagamentos.
  const ui = screen(lancarFile, { params: { tipo: 'financiamento', id: 'd1', origem: 'divida', passado: '0' },
    debts: [{ id: 'd1', name: 'Carro', kind: 'financing', calculation_mode: 'fixed_installments', installments: 48, installments_paid: 2, installment_cents: 147000, remaining_cents: 6762000, principal_cents: 7056000, interest_rate_monthly: 0, account_id: null, due_day: 10, archived: false, first_due_date: null }] });
  const seletor = () => ui.nodes().find((n: any) => n.type === 'FormatoDoLancamento');
  ui.interact(() => seletor().props.onChange('recorrente'));
  ui.interact(() => ui.nodes().find((n: any) => n.type === 'FormularioDaSerie').props.converter({ tipo: 'recorrente', dados: {} }));
  const labels = ui.actions.map((a: any) => a.label);
  assert.ok(labels.includes('Todas, apagando as anteriores'), labels.join(' | '));
  assert.equal(labels.includes('Converter'), false);
  assert.equal(ui.actions.find((a: any) => a.label === 'Todas, apagando as anteriores').destructive, true);
});

test('Lançar: a conversão que o banco recusa mostra a frase dele e não fecha', async () => {
  const ui = screen(lancarFile, { segurarMutacoes: true, params: { tipo: 'uma', id: 'tx-1', origem: 'transacao' } });
  const seletor = () => ui.nodes().find((n: any) => n.type === 'FormatoDoLancamento');
  ui.interact(() => seletor().props.onChange('recorrente'));
  ui.interact(() => ui.nodes().find((n: any) => n.type === 'FormularioDaSerie').props.converter({ tipo: 'recorrente', dados: {} }));
  ui.interact(() => ui.actions.find((a: any) => a.label === 'Converter').onPress());
  (ui.pedidos.at(-1) as any).rejeitar({ code: 'P0001', message: 'Há lançamento numa fatura paga ou adiada. Desfaça o pagamento da fatura antes.' });
  await new Promise((r) => setTimeout(r, 0));
  assert.match(ui.toasts.at(-1).message, /fatura paga/);
  assert.equal(ui.navigations.length, 0);
});

test('Lançar: editando um lançamento, o corpo é o que espera o registro; a opção destrutiva confirma antes', () => {
  const ui = screen(lancarFile, { params: { tipo: 'uma', id: 'tx-1', origem: 'transacao', papel: 'ocorrencia' } });
  const editando = ui.nodes().find((n: any) => n.type === 'LancamentoEditando');
  assert.equal(editando.props.editandoId, 'tx-1');
  assert.equal(editando.props.converter, undefined);
  const seletor = () => ui.nodes().find((n: any) => n.type === 'FormatoDoLancamento');
  ui.interact(() => seletor().props.onChange('recorrente'));
  ui.interact(() => ui.nodes().find((n: any) => n.type === 'FormularioDaSerie').props.converter({ tipo: 'recorrente', dados: {} }));
  assert.deepEqual(ui.actions.map((a: any) => a.label), ['Só esta', 'Desta em diante', 'Todas, apagando as anteriores', 'Manter o atual e criar um novo']);
  ui.interact(() => ui.actions.find((a: any) => a.label === 'Todas, apagando as anteriores').onPress());
  assert.equal(ui.writes.length, 0, 'nada antes de confirmar');
  ui.interact(() => ui.confirmations.at(-1)!());
  assert.equal(ui.writes.at(-1).value.alcance, 'todas');
});

test('Lançar: o "Aplicar" de uma compra parcelada abre "Uma vez" com as parcelas dela; sem parcelas, à vista', () => {
  const ui = screen(lancarFile, { params: { tipo: 'uma', deHipotese: 'h1', kind: 'expense', amount: '300000', data: '05/10/2026', parcelas: '10', conta: 'nu' } });
  const lanc = ui.nodes().find((n: any) => n.type === 'FormularioDoLancamento');
  assert.equal(lanc.props.parcelas, 10);
  assert.equal(lanc.props.deHipotese, 'h1');
  assert.deepEqual([lanc.props.comum.valorCents, lanc.props.comum.contaId, lanc.props.comum.dataBR], [300000, 'nu', '05/10/2026']);
  const avista = screen(lancarFile, { params: { tipo: 'uma' } });
  assert.equal(avista.nodes().find((n: any) => n.type === 'FormularioDoLancamento').props.parcelas, undefined);
  // "Salvar e criar outro" não repete a hipótese: o próximo é um lançamento limpo
  ui.interact(() => ui.nodes().find((n: any) => n.type === 'FormularioDoLancamento').props.onSalvo(true));
  const outro = ui.nodes().find((n: any) => n.type === 'FormularioDoLancamento');
  assert.equal(outro.props.parcelas, undefined);
  assert.equal(outro.props.deHipotese, undefined);
  assert.equal(outro.props.comum.contaId, 'nu');
});

test('Lançar: o estabelecimento viaja entre os tipos e a série nasce com ele', () => {
  const ui = screen(lancarFile, { params: { tipo: 'uma' } });
  const seletor = () => ui.nodes().find((n: any) => n.type === 'FormatoDoLancamento');
  ui.interact(() => ui.nodes().find((n: any) => n.type === 'FormularioDoLancamento').props.registrarComum(() => ({ kind: 'expense', descricao: 'Pão', valorCents: 1200, contaId: null, dataBR: '06/10/2026', categoria: null, estabelecimento: 'Padaria' })));
  ui.interact(() => seletor().props.onChange('recorrente'));
  const comum = ui.nodes().find((n: any) => n.type === 'FormularioDaSerie').props.comum;
  assert.equal(comum.estabelecimento, 'Padaria');
  const serie = screen('src/components/finance/formulario-da-serie.tsx', { componente: 'FormularioDaSerie',
    props: { comum, registrarComum: () => {}, registrarEstado: () => {}, onSalvo: () => {}, onFechar: () => {} } });
  assert.equal(serie.nodes().find((n: any) => n.type?.name === 'CamposDaSerie').props.form.merchant, 'Padaria');
  // o lançamento lê e devolve o estabelecimento pelo mesmo `comum`
  const lanc = readFileSync('src/components/finance/formulario-do-lancamento.tsx', 'utf8');
  assert.match(lanc, /merchant: editing \? \(editing\.merchant \?\? null\) : \(comum\.estabelecimento \|\| null\)/);
  assert.match(lanc, /estabelecimento: v\.merchant \?\? undefined/);
});

test('Lançar: convertendo um lançamento PAGO em financiamento, "Parcelas já pagas" avisa que ele já conta', () => {
  const ui = screen(lancarFile, { params: { tipo: 'uma', id: 'tx-1', origem: 'transacao' } });
  const seletor = () => ui.nodes().find((n: any) => n.type === 'FormatoDoLancamento');
  ui.interact(() => seletor().props.onChange('financiamento'));
  assert.equal(ui.nodes().find((n: any) => n.type === 'FormularioDaDivida').props.pagamentoConvertido, true);
  const emAberto = screen(lancarFile, { txStatus: 'pending', params: { tipo: 'uma', id: 'tx-1', origem: 'transacao' } });
  emAberto.interact(() => emAberto.nodes().find((n: any) => n.type === 'FormatoDoLancamento').props.onChange('financiamento'));
  assert.equal(emAberto.nodes().find((n: any) => n.type === 'FormularioDaDivida').props.pagamentoConvertido, false);

  const comum = { kind: 'expense', descricao: 'Carro', valorCents: 147000, contaId: null, dataBR: '05/09/2026', categoria: null };
  const corpo = (extra: any) => screen('src/components/finance/formulario-da-divida.tsx', { componente: 'FormularioDaDivida',
    props: { comum, registrarComum: () => {}, registrarEstado: () => {}, onSalvo: () => {}, onFechar: () => {}, ...extra } });
  const dica = (u: any) => u.nodes().find((n: any) => n.type === 'Field' && n.props.label === 'Parcelas já pagas').props.hint;
  assert.match(dica(corpo({ converter: () => {}, pagamentoConvertido: true })), /já conta/);
  assert.equal(dica(corpo({ converter: () => {}, pagamentoConvertido: false })), undefined);
  assert.equal(dica(corpo({})), undefined, 'criando, sem aviso');
});

test('Lançar: converter de novo enquanto a primeira conversão está no banco não grava duas vezes, e os corpos esperam', async () => {
  const ui = screen(lancarFile, { segurarMutacoes: true, params: { tipo: 'uma', id: 'tx-1', origem: 'transacao' } });
  const seletor = () => ui.nodes().find((n: any) => n.type === 'FormatoDoLancamento');
  const serie = () => ui.nodes().find((n: any) => n.type === 'FormularioDaSerie');
  const conversoes = () => ui.writes.filter((w: any) => w.operation === 'converterRegistro').length;
  ui.interact(() => seletor().props.onChange('recorrente'));
  assert.equal(serie().props.salvando, false);
  ui.interact(() => serie().props.converter({ tipo: 'recorrente', dados: {} }));
  const primeira = ui.actions.find((a: any) => a.label === 'Manter e criar um novo');
  ui.interact(() => primeira.onPress());
  assert.equal(conversoes(), 1);
  assert.equal(serie().props.salvando, true, 'o corpo trava o Salvar enquanto converte');
  const perguntas = ui.actions.length;
  ui.interact(() => serie().props.converter({ tipo: 'recorrente', dados: {} }));
  assert.equal(ui.actions.length, perguntas, 'nem pergunta de novo');
  ui.interact(() => primeira.onPress());
  assert.equal(conversoes(), 1, 'um toque de novo na pergunta aberta também não grava');
  (ui.pedidos.at(-1) as any).rejeitar({ code: 'P0001', message: 'Não deu.' });
  await new Promise((r) => setTimeout(r, 0));
  ui.interact(() => {});
  assert.equal(serie().props.salvando, false, 'recusada, dá para tentar de novo');
  ui.interact(() => serie().props.converter({ tipo: 'recorrente', dados: {} }));
  assert.ok(ui.actions.length > perguntas);
});

test('Lançar: com "salvando" do hospedeiro, a série e a dívida desligam Salvar e "Salvar e criar outro"', () => {
  const liga = (ui: any, rotulo: string) => !ui.nodes().find((n: any) => n.type === 'Button' && n.props.label === rotulo).props.disabled;
  const base = { registrarComum: () => {}, registrarEstado: () => {}, onSalvo: () => {}, onFechar: () => {} };
  const comumSerie = { kind: 'expense', descricao: 'Academia', valorCents: 5000, contaId: null, dataBR: '06/10/2026', categoria: null };
  const serie = (salvando: boolean) => screen('src/components/finance/formulario-da-serie.tsx', { componente: 'FormularioDaSerie', props: { ...base, comum: comumSerie, salvando } });
  assert.deepEqual([liga(serie(false), 'Criar'), liga(serie(false), 'Salvar e criar outro')], [true, true]);
  assert.deepEqual([liga(serie(true), 'Criar'), liga(serie(true), 'Salvar e criar outro')], [false, false]);
  const comumDivida = { kind: 'expense', descricao: 'Carro', valorCents: 147000, contaId: null, dataBR: '05/09/2026', categoria: null };
  const divida = (salvando: boolean) => {
    const ui = screen('src/components/finance/formulario-da-divida.tsx', { componente: 'FormularioDaDivida', props: { ...base, comum: comumDivida, salvando } });
    ui.fill('Total de parcelas', '48');
    return ui;
  };
  assert.deepEqual([liga(divida(false), 'Salvar'), liga(divida(false), 'Salvar e criar outro')], [true, true]);
  assert.deepEqual([liga(divida(true), 'Salvar'), liga(divida(true), 'Salvar e criar outro')], [false, false]);
  const lanc = readFileSync('src/components/finance/formulario-do-lancamento.tsx', 'utf8');
  assert.match(lanc, /const saving =\s*props\.salvando \|\|/);
});

test('Lançar: os três corpos têm a MESMA moldura na tela — calha, largura, laterais e pé seguros', () => {
  const host = readFileSync(lancarFile, 'utf8');
  assert.match(host, /<Screen scroll=\{false\}>/, 'laterais seguras: o contêiner da pilha, pelo Screen');
  assert.match(host, /<FormularioEmTela\.Provider value>/, 'a série e a dívida sabem que estão numa tela, não numa folha');
  const folha = readFileSync('src/components/ui/sheet.tsx', 'utf8');
  assert.match(folha, /export function molduraEmTela\(abaixo: number\)[\s\S]{0,400}paddingHorizontal: Space\.lg[\s\S]{0,200}paddingBottom: abaixo \+ Space\.xxl[\s\S]{0,200}maxWidth: MaxContentWidth/);
  assert.match(folha, /if \(emTela\)[\s\S]{0,600}molduraEmTela\(insets\.bottom\)/, 'SheetScroll na tela soma o pé seguro');
  const lanc = readFileSync('src/components/finance/formulario-do-lancamento.tsx', 'utf8');
  assert.match(lanc, /contentContainerStyle=\{\[styles\.body, molduraEmTela\(insets\.bottom\)\]\}/, 'o lançamento usa a mesma moldura');
  for (const f of ['formulario-da-serie.tsx', 'formulario-da-divida.tsx']) {
    assert.match(readFileSync(`src/components/finance/${f}`, 'utf8'), /<SheetScroll contentContainerStyle=/, f);
  }
});

test('Lançar: os formatos entram completos numa moldura comum sem fade independente do formulário', () => {
  const corpos = { uma: 'FormularioDoLancamento', recorrente: 'FormularioDaSerie', financiamento: 'FormularioDaDivida' };
  for (const [tipo, corpo] of Object.entries(corpos)) {
    const ui = screen(lancarFile, { params: { tipo }, reduzirMovimento: false, executarEfeitos: true });
    const envelope = ui.nodes().find((n: any) => n.type === 'TrocaSuave');
    assert.ok(envelope, 'há uma única fronteira para o corpo completo');
    assert.equal(envelope.props.estado, `${tipo}:0`);
    assert.equal(envelope.props.preencher, true);
    assert.equal(envelope.props.children.type.name ?? envelope.props.children.type, corpo);
    const formulario = ui.nodes().find((n: any) => n.type === corpo);
    assert.equal(formulario.props.estiloDoConteudo, undefined, 'os campos não recebem uma segunda linha de tempo de opacidade');
    assert.equal([formulario.props.topo.props.children].flat()[0].type, 'FormatoDoLancamento');
    assert.equal(formulario.props.focarAoAbrir, true, 'a abertura inicial continua pronta para escrever');
    assert.equal(ui.animacoes().filter((a) => a.concluir).length, 0, 'a montagem inicial não aguarda nenhuma saída');
  }
});

test('Toda entrada de criar/editar lançamento, recorrente e dívida abre o formulário único', () => {
  const arquivos = (readdirSync('src', { recursive: true }) as string[]).filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes('.test.'));
  const fora: string[] = [];
  for (const f of arquivos) {
    const t = readFileSync(`src/${f}`, 'utf8');
    if (/pathname: '\/finance\/(transaction-form|nova-recorrente|novo-financiamento)'/.test(t)) fora.push(f);
    if (/pathname: '\/finance\/(recurring|debts)', params: \{ (create|edit)/.test(t)) fora.push(f);
  }
  assert.deepEqual(fora, []);
});

test('Links antigos continuam abrindo o formulário certo', () => {
  for (const [arquivo, tipo] of [['transaction-form', 'uma'], ['nova-recorrente', 'recorrente'], ['novo-financiamento', 'financiamento']] as const) {
    const ui = screen(`src/app/finance/${arquivo}.tsx`, { params: { id: 'x1' } });
    const r = ui.nodes().find((n: any) => n.type === 'Redirect');
    assert.equal(r.props.href.pathname, '/finance/lancar', arquivo);
    assert.equal(r.props.href.params.tipo, tipo, arquivo);
    assert.equal(r.props.href.params.id, 'x1', 'os parâmetros viajam');
  }
});

test('Lançar: link sem `papel` (o antigo, a Projeção) usa o do próprio lançamento na conversão', () => {
  const ocorrencia = { id: 'o1', kind: 'expense', amount_cents: 5000, occurred_at: '2026-10-06', description: 'Academia', category: null, account_id: null, status: 'pending', recurring_id: 'r1', installment_plan_id: null };
  const ui = screen(lancarFile, { params: { tipo: 'uma', id: 'o1', origem: 'transacao' }, txs: [ocorrencia] });
  ui.interact((nodes) => nodes.find((n: any) => n.type === 'FormatoDoLancamento').props.onChange('recorrente'));
  ui.interact(() => ui.nodes().find((n: any) => n.type === 'FormularioDaSerie').props.converter({ tipo: 'recorrente', dados: {} }));
  assert.equal(ui.actions[0].label, 'Só esta', 'é uma ocorrência de série, não um avulso');
});

// ── Categorias personalizáveis (29/09/2026) ─────────────────────────────────────────────────────
const categoriasFile = 'src/app/finance/categories.tsx';
const CATS = [
  { category: 'mercado', uses: 9, icon: 'cart', color: 'musgo', budgets: 1 },
  { category: 'roupa', uses: 2, icon: null, color: null, budgets: 1 },
  { category: 'roupas', uses: 1, icon: null, color: null, budgets: 1 },
];

test('Categorias: uso e cor, cria pelo "+" e oferece detalhes e edição no toque', () => {
  const ui = screen(categoriasFile, { categoriasUsadas: CATS });
  const linha = ui.nodes().find((n: any) => n.type === 'Row' && n.props.title === 'mercado');
  assert.equal(linha.props.subtitle, '9 lançamentos');
  assert.equal(linha.props.icon, 'cart');
  assert.equal(linha.props.tinta, 'musgo');
  assert.equal(ui.nodes().find((n: any) => n.type === 'Row' && n.props.title === 'roupas').props.subtitle, '1 lançamento');
  const folha = () => ui.nodes().find((n: any) => n.type === 'CategoriaSheet');
  assert.equal(folha().props.visible, false);
  ui.interact(() => linha.props.onPress());
  assert.deepEqual(ui.actions.map((a: any) => a.label), ['Detalhes', 'Editar', 'Apagar']);
  ui.interact(() => ui.actions.find((a: any) => a.label === 'Editar')!.onPress());
  assert.equal(folha().props.visible, true);
  assert.equal(folha().props.categoria.category, 'mercado');
  ui.interact(() => folha().props.onClose());
  ui.press('Nova categoria');
  assert.equal(folha().props.visible, true);
  assert.equal(folha().props.categoria, null, 'o "+" abre a folha vazia');
});

test('Categorias: apagar diz quantos lançamentos ficam sem categoria e quantos orçamentos saem', () => {
  const ui = screen(categoriasFile, { categoriasUsadas: CATS });
  const d = ui.nodes().find((n: any) => n.type === 'Deslizavel' && n.props.titulo === 'mercado');
  ui.interact(() => d.props.acoes.find((a: any) => a.destructive).onPress());
  assert.equal(ui.avisos.at(-1), '9 lançamentos ficam sem categoria e 1 orçamento sai.');
  assert.equal(ui.writes.length, 0, 'nada sai antes de confirmar');
  ui.interact(() => ui.confirmations.at(-1)!());
  assert.equal(ui.writes.at(-1)?.operation, 'apagarCategoria');
  assert.equal(ui.writes.at(-1)?.value, 'mercado');
});

test('Folha de categoria: renomear para um nome que existe pergunta antes de juntar, e só junta com o sim', async () => {
  const salvas: string[] = [];
  const ui = screen('src/components/finance/categoria-sheet.tsx', { componente: 'CategoriaSheet', categoriasUsadas: CATS, segurarMutacoes: true,
    props: { visible: true, categoria: CATS[1], onClose: () => {}, onSalva: (n: string) => salvas.push(n) } });
  ui.fill('Nome', 'Roupas');
  ui.press('Salvar');
  assert.deepEqual({ ...ui.writes.at(-1)?.value }, { name: 'roupas', icon: 'circle', color: null, renomearDe: 'roupa',
    default_expense_pattern: null, default_expense_necessity: null, configurationId: null, expectedRevision: null, backfill: null,
    requestId: '00000000-0000-4000-8000-000000000001' });
  (ui.pedidos.at(-1) as any).rejeitar(Object.assign(new Error('CATEGORIA_EXISTE: roupas'), { code: 'CATEGORIA_EXISTE', existente: 'roupas' }));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(ui.avisos.at(-1), 'Tudo que está em roupa passa para roupas. Os padrões de roupas prevalecem; as classificações dos gastos ficam como estão. No mês em que as duas têm orçamento, fica o de roupas.');
  assert.equal(ui.writes.length, 1, 'não junta sem a resposta');
  ui.interact(() => ui.confirmations.at(-1)!());
  assert.equal(ui.writes.at(-1)?.value.juntar, true);
  assert.equal(ui.writes.at(-1)?.value.renomearDe, 'roupa');
  (ui.pedidos.at(-1) as any).resolver({ category: 'roupas', juntou: true, backfill_updated: 0 });
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(salvas, ['roupas'], 'o seletor recebe o nome que ficou');
});

test('Folha de categoria: sem nome não salva; criando um nome que já existe, conserva a aparência dela', () => {
  const ui = screen('src/components/finance/categoria-sheet.tsx', { componente: 'CategoriaSheet', categoriasUsadas: CATS,
    props: { visible: true, categoria: null, onClose: () => {}, onSalva: () => {} } });
  assert.equal(ui.button('Salvar').props.disabled, true);
  ui.fill('Nome', 'Mércado ');
  assert.ok(ui.nodes().find((n: any) => n.type === 'Field' && n.props.label === 'Nome').props.hint, 'avisa que a categoria já existe');
  ui.press('Salvar');
  // grava na que EXISTE: com o nome digitado, nasceria uma segunda aparência para a mesma categoria
  assert.equal(ui.writes.at(-1)?.operation, 'salvarCategoria');
  assert.deepEqual({ ...ui.writes.at(-1)?.value }, { name: 'mercado', icon: 'cart', color: 'musgo', renomearDe: null,
    default_expense_pattern: null, default_expense_necessity: null, configurationId: null, expectedRevision: null, backfill: null,
    requestId: '00000000-0000-4000-8000-000000000001' });
});

// F06 uses the real editor and pure configuration/classification domains. Query and native
// boundaries remain inert: these assertions prove JS behavior, not a rendered device flow.
const F06_CATS = CATS.map((c, index) => ({ ...c, configuration_id: `configuration-${index}`,
  edit_revision: index + 7, default_expense_pattern: index === 0 ? 'variable' : 'fixed',
  default_expense_necessity: index === 0 ? 'essential' : 'discretionary' }));
const categoriaF06 = (categoria: any = F06_CATS[0], extra: Parameters<typeof screen>[1] = {}) =>
  screen('src/components/finance/categoria-sheet.tsx', { componente: 'CategoriaSheet', categoriasUsadas: F06_CATS,
    executarEfeitos: true, segurarMutacoes: true, ...extra,
    props: { visible: true, categoria, onClose: () => {}, onSalva: () => {}, ...extra.props } });
const abrirPadroesCategoria = (ui: ReturnType<typeof screen>) => ui.interact((nodes) => {
  const row = nodes.find((n) => n.type === 'Row' && n.props.title === 'Padrões de gastos');
  assert.ok(row, 'o editor existente oferece os padrões');
  row.props.onPress();
});
const selecionarCategoria = (ui: ReturnType<typeof screen>, label: string, value: string | null) =>
  ui.interact((nodes) => {
    const field = nodes.find((n) => n.type === 'Field' && n.props.label === label);
    assert.ok(field, `campo visível: ${label}`);
    assert.equal(field.props.children.type, 'SelectField');
    field.props.children.props.onChange(value);
  });
const dadosDaCategoria = (ui: ReturnType<typeof screen>) => JSON.parse(JSON.stringify(ui.writes.at(-1)?.value));
const aguardarCategoria = async (ui: ReturnType<typeof screen>) => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  ui.interact(() => {});
};

test('F06 categoria: padrões independentes salvam com CAS e só novos cadastros não pede histórico', () => {
  for (const [dimension, chosen, pattern, necessity] of [
    ['Previsibilidade', 'fixed', 'fixed', 'essential'],
    ['Necessidade', null, 'variable', null],
  ] as const) {
    const ui = categoriaF06();
    assert.equal(ui.nodes().some((n) => n.type === 'Field' && n.props.label === 'Previsibilidade'), false,
      'a revelação começa recolhida');
    abrirPadroesCategoria(ui);
    selecionarCategoria(ui, dimension, chosen);
    const scope = ui.nodes().find((n) => n.type === 'Field' && n.props.label === 'Aplicar padrões');
    assert.equal(scope.props.children.props.value, 'new');
    assert.equal(ui.nodes().some((n) => n.type === 'DatePickerField'), false);
    ui.press('Salvar');
    assert.equal(ui.confirmations.length, 0);
    assert.deepEqual(dadosDaCategoria(ui), { name: 'mercado', icon: 'cart', color: 'musgo', renomearDe: 'mercado',
      default_expense_pattern: pattern, default_expense_necessity: necessity,
      configurationId: 'configuration-0', expectedRevision: 7, backfill: null,
      requestId: '00000000-0000-4000-8000-000000000001' });
    assert.deepEqual(ui.writes.map((w) => w.operation), ['salvarCategoria'], 'uma escrita atômica');
  }
});

test('F06 categoria: nome existente adota configuração própria e aparência externa não prova padrões', () => {
  const ui = categoriaF06(null);
  ui.fill('Nome', 'Mércado');
  abrirPadroesCategoria(ui);
  ui.press('Salvar');
  const input = dadosDaCategoria(ui);
  assert.equal(input.configurationId, 'configuration-0');
  assert.equal(input.expectedRevision, 7);
  assert.equal(input.icon, 'cart');
  assert.equal(input.color, 'musgo');
  assert.equal(input.default_expense_pattern, 'variable');
  assert.equal(input.default_expense_necessity, 'essential');
  const external = { ...F06_CATS[0], configuration_id: null, edit_revision: null };
  const outside = categoriaF06(external, { categoriasUsadas: [external] });
  abrirPadroesCategoria(outside);
  outside.press('Salvar');
  assert.equal(dadosDaCategoria(outside).default_expense_pattern, null);
  assert.equal(dadosDaCategoria(outside).default_expense_necessity, null);
  assert.equal(dadosDaCategoria(outside).icon, 'cart');
});

test('F06 categoria: histórico parcial, impossível ou invertido impede salvar', () => {
  for (const [from, to] of [['', ''], ['01/10/2026', ''], ['', '31/10/2026'],
    ['31/02/2026', '31/10/2026'], ['20/10/2026', '01/10/2026']]) {
    const ui = categoriaF06();
    abrirPadroesCategoria(ui);
    selecionarCategoria(ui, 'Previsibilidade', 'fixed');
    selecionarCategoria(ui, 'Aplicar padrões', 'period');
    ui.fill('De', from); ui.fill('Até', to);
    assert.equal(ui.button('Salvar').props.disabled, true, `${from} → ${to}`);
    ui.interact(() => ui.button('Salvar').props.onPress());
    assert.equal(ui.writes.length, 0);
    assert.equal(ui.confirmations.length, 0);
  }
});

test('F06 categoria: confirma período, explica manuais e anuncia contagem real do backfill', async () => {
  const salvas: string[] = []; let fechou = 0;
  const ui = categoriaF06(undefined, { props: { onSalva: (name: string) => salvas.push(name), onClose: () => { fechou++; } } });
  abrirPadroesCategoria(ui);
  selecionarCategoria(ui, 'Necessidade', 'discretionary');
  selecionarCategoria(ui, 'Aplicar padrões', 'period');
  ui.fill('De', '01/10/2026'); ui.fill('Até', '31/10/2026');
  ui.press('Salvar');
  assert.equal(ui.writes.length, 0, 'o período só segue depois da confirmação');
  assert.match(ui.avisos.at(-1)!, /Ajustes manuais, inclusive Não classificar, ficam/);
  assert.match(ui.avisos.at(-1)!, /Recorrências, compras e dívidas conservam seus padrões/);
  ui.interact(() => ui.confirmations.at(-1)!());
  assert.deepEqual(dadosDaCategoria(ui).backfill, { from: '2026-10-01', to: '2026-10-31' });
  assert.equal(dadosDaCategoria(ui).default_expense_pattern, 'variable');
  assert.equal(dadosDaCategoria(ui).default_expense_necessity, 'discretionary');
  (ui.pedidos.at(-1) as any).resolver({ category: 'mercado', juntou: false, backfill_updated: 23 });
  await aguardarCategoria(ui);
  assert.equal(ui.toasts.at(-1).message, '23 gastos atualizados.');
  assert.deepEqual(salvas, ['mercado']); assert.equal(fechou, 1);
});

test('F06 categoria: erro conserva rascunho e intenção; alteração do payload gera nova intenção', async () => {
  const ui = categoriaF06();
  ui.fill('Nome', 'Mercado da semana');
  abrirPadroesCategoria(ui);
  selecionarCategoria(ui, 'Previsibilidade', 'fixed');
  ui.press('Salvar');
  const first = dadosDaCategoria(ui);
  (ui.pedidos.at(-1) as any).rejeitar(new Error('Sem conexão'));
  await aguardarCategoria(ui);
  assert.equal(ui.nodes().find((n) => n.type === 'Field' && n.props.label === 'Nome').props.children.props.value, 'Mercado da semana');
  assert.equal(ui.nodes().find((n) => n.type === 'Field' && n.props.label === 'Previsibilidade').props.children.props.value, 'fixed');
  ui.press('Salvar');
  assert.deepEqual(dadosDaCategoria(ui), first, 'retry reusa nonce, CAS e todo o payload');
  (ui.pedidos.at(-1) as any).rejeitar(new Error('Sem conexão'));
  await aguardarCategoria(ui);
  selecionarCategoria(ui, 'Necessidade', null);
  ui.press('Salvar');
  assert.notEqual(dadosDaCategoria(ui).requestId, first.requestId);
  assert.equal(dadosDaCategoria(ui).default_expense_necessity, null);
});

test('F06 categoria: juntar descarta backfill, explica receptor e reusa intenção de merge no retry', async () => {
  const salvas: string[] = [];
  const ui = categoriaF06(F06_CATS[1], { props: { onSalva: (name: string) => salvas.push(name) } });
  ui.fill('Nome', 'Mercado');
  abrirPadroesCategoria(ui);
  selecionarCategoria(ui, 'Necessidade', 'essential');
  selecionarCategoria(ui, 'Aplicar padrões', 'period');
  ui.fill('De', '01/10/2026'); ui.fill('Até', '31/10/2026');
  ui.press('Salvar');
  ui.interact(() => ui.confirmations.at(-1)!());
  const beforeMerge = dadosDaCategoria(ui);
  (ui.pedidos.at(-1) as any).rejeitar(Object.assign(new Error('CATEGORIA_EXISTE: mercado'), { code: 'CATEGORIA_EXISTE', existente: 'mercado' }));
  await aguardarCategoria(ui);
  assert.match(ui.avisos.at(-1)!, /Os padrões de mercado prevalecem/);
  assert.match(ui.avisos.at(-1)!, /classificações dos gastos ficam como estão/);
  assert.match(ui.avisos.at(-1)!, /O período escolhido não será aplicado/);
  ui.interact(() => ui.confirmations.at(-1)!());
  const merged = dadosDaCategoria(ui);
  assert.equal(merged.juntar, true); assert.equal(merged.backfill, null);
  assert.equal(merged.configurationId, 'configuration-1');
  assert.notEqual(merged.requestId, beforeMerge.requestId, 'merge é outra intenção atômica');
  (ui.pedidos.at(-1) as any).rejeitar(new Error('Sem conexão'));
  await aguardarCategoria(ui);
  const confirmations = ui.confirmations.length;
  ui.press('Salvar');
  assert.equal(ui.confirmations.length, confirmations, 'a intenção de junção já foi confirmada');
  assert.deepEqual(dadosDaCategoria(ui), merged);
  (ui.pedidos.at(-1) as any).resolver({ category: 'mercado', juntou: true, backfill_updated: 0,
    default_expense_pattern: 'variable', default_expense_necessity: 'essential' });
  await aguardarCategoria(ui);
  assert.deepEqual(salvas, ['mercado']);
  assert.equal(ui.toasts.length, 1, 'somente o erro transitório: merge não anuncia backfill');
});

test('Seletor de categoria: chips com ícone e cor, "Nova" cria e já escolhe, "Gerenciar categorias" leva à tela', () => {
  const escolhidas: (string | null)[] = [];
  const ui = screen('src/components/finance/category-picker.tsx', { componente: 'CategoryPicker', categoriasUsadas: CATS,
    props: { value: null, onChange: (c: string | null) => escolhidas.push(c) } });
  const chip = ui.nodes().find((n: any) => n.type === 'Chip' && n.props.label === 'mercado');
  assert.equal(chip.props.icon, 'cart');
  assert.equal(chip.props.tinta, 'musgo');
  const folha = () => ui.nodes().find((n: any) => n.type === 'CategoriaSheet');
  assert.equal(folha().props.visible, false);
  ui.interact(() => ui.nodes().find((n: any) => n.type === 'Chip' && n.props.label === 'Nova').props.onPress());
  assert.equal(folha().props.visible, true);
  assert.equal(folha().props.categoria, null);
  ui.interact(() => folha().props.onSalva('viagem'));
  assert.deepEqual(escolhidas, ['viagem'], 'a categoria criada já volta escolhida');
  ui.interact(() => ui.nodes().find((n: any) => n.type === 'Chip' && n.props.label === 'Todas…').props.onPress());
  const linha = ui.nodes().find((n: any) => n.type === 'Row' && n.props.title === 'mercado');
  assert.equal(linha.props.tinta, 'musgo', 'a lista inteira também mostra a cor');
  ui.interact(() => ui.nodes().find((n: any) => n.type === 'Row' && n.props.title === 'Gerenciar categorias').props.onPress());
  assert.equal(ui.navigations.at(-1), '/finance/categories');
});

test('Categorias se alcança pelo Gerenciar, pelo Perfil e pelo menu das Finanças', () => {
  for (const f of ['src/app/finance/manage.tsx', 'src/app/(tabs)/profile/index.tsx', 'src/app/(tabs)/finance/index.tsx']) {
    assert.match(readFileSync(f, 'utf8'), /'\/finance\/categories'/, f);
  }
});

test('Formato do lançamento: fechar pelo controle conserva o tipo e não espera uma barreira do corpo', () => {
  const escolhas: string[] = [];
  const ui = screen('src/components/finance/formato-do-lancamento.tsx', {
    componente: 'FormatoDoLancamento', reduzirMovimento: false, executarEfeitos: true,
    props: { value: 'recorrente', onChange: (tipo: string) => escolhas.push(tipo) },
  });
  const controle = () => ui.nodes().find((n) => n.type === 'PressableScale');
  ui.interact(() => controle().props.onPress());
  ui.interact(() => controle().props.onPress());
  assert.deepEqual(escolhas, []);
  assert.equal(controle().props.accessibilityState.expanded, false);
  assert.equal(ui.animacoes().filter((a) => a.concluir).length, 0, 'abrir/fechar não agenda troca ou fade do corpo');
});

test('Formato do lançamento: reduzir movimento mantém o callback imediato e uma opção por tipo', () => {
  const escolhas: string[] = [];
  const ui = screen('src/components/finance/formato-do-lancamento.tsx', {
    componente: 'FormatoDoLancamento', executarEfeitos: true,
    props: { value: 'uma', onChange: (tipo: string) => escolhas.push(tipo) },
  });
  ui.interact((nodes) => nodes.find((n) => n.type === 'PressableScale').props.onPress());
  const radios = ui.nodes().filter((n) => n.props.accessibilityRole === 'radio');
  assert.equal(radios.length, 3);
  assert.equal(new Set(radios.map((n) => n.props.accessibilityLabel)).size, 3);
  ui.interact(() => radios.find((n) => n.props.accessibilityLabel.startsWith('Recorrente,')).props.onPress());
  assert.deepEqual(escolhas, ['recorrente']);
  assert.equal(ui.nodes().find((n) => n.type === 'PressableScale').props.accessibilityState.expanded, false);
});

test('Lançar: formato muda no toque, preserva os campos comuns e evita refocar ao montar o corpo seguinte', () => {
  for (const reduzirMovimento of [false, true]) {
    const ui = screen(lancarFile, { params: { tipo: 'uma' }, reduzirMovimento, executarEfeitos: true });
    const lancamento = ui.nodes().find((n) => n.type === 'FormularioDoLancamento');
    assert.equal(lancamento.props.focarAoAbrir, true, 'primeira abertura conserva foco inicial');
    const digitado = { kind: 'expense', descricao: 'Academia', valorCents: 5000, contaId: 'a1', dataBR: '06/10/2026', categoria: 'saúde', estabelecimento: 'Clube' };
    const rascunho = { description: 'Academia', amountCents: 5000, installmentCount: 3 };
    ui.interact(() => { lancamento.props.registrarComum(() => digitado); lancamento.props.registrarEstado(() => rascunho); });
    ui.interact((nodes) => nodes.find((n) => n.type === 'FormatoDoLancamento').props.onChange('recorrente'));
    const serie = ui.nodes().find((n) => n.type === 'FormularioDaSerie');
    assert.ok(serie, 'o corpo seguinte já está montado sem concluir nenhuma animação');
    assert.equal(serie.props.comum.descricao, digitado.descricao);
    assert.equal(serie.props.comum.valorCents, digitado.valorCents);
    assert.equal(serie.props.comum.contaId, digitado.contaId);
    assert.equal(serie.props.comum.categoria, digitado.categoria);
    assert.equal(serie.props.focarAoAbrir, false, 'o toque no formato não reabre o teclado');
    assert.equal(ui.nodes().find((n) => n.type === 'TrocaSuave').props.preencher, true, 'os corpos dividem a mesma moldura de tela');
    assert.equal(ui.animacoes().filter((a) => a.concluir).length, 0, 'o hospedeiro não aguarda fades para transferir os campos');
    ui.interact((nodes) => nodes.find((n) => n.type === 'FormatoDoLancamento').props.onChange('uma'));
    const voltou = ui.nodes().find((n) => n.type === 'FormularioDoLancamento');
    assert.deepEqual(voltou.props.estadoGuardado, rascunho, 'voltar devolve o estado completo do tipo');
    assert.equal(voltou.props.focarAoAbrir, false);
  }
});

test('Lançar: leitores do corpo que saiu não sobrescrevem o rascunho ativo durante o crossfade', () => {
  const ui = screen(lancarFile, { params: { tipo: 'uma' }, executarEfeitos: true });
  const antigo = ui.nodes().find((n) => n.type === 'FormularioDoLancamento').props;
  ui.interact((nodes) => nodes.find((n) => n.type === 'FormatoDoLancamento').props.onChange('recorrente'));
  const serie = ui.nodes().find((n) => n.type === 'FormularioDaSerie').props;
  const atual = { kind: 'expense', descricao: 'Internet', valorCents: 9000, contaId: 'a2', dataBR: '08/10/2026', categoria: 'casa' };
  const estadoDaSerie = { description: 'Internet', preset: 'weekly', amountCents: 9000 };
  ui.interact(() => {
    serie.registrarComum(() => atual); serie.registrarEstado(() => estadoDaSerie);
    antigo.registrarComum(() => ({ ...atual, descricao: 'Leitor antigo', valorCents: 1 }));
    antigo.registrarEstado(() => ({ invalid: 'old' }));
  });
  ui.interact((nodes) => nodes.find((n) => n.type === 'FormatoDoLancamento').props.onChange('financiamento'));
  const divida = ui.nodes().find((n) => n.type === 'FormularioDaDivida');
  assert.equal(divida.props.comum.descricao, 'Internet');
  assert.equal(divida.props.comum.valorCents, 9000);
  ui.interact((nodes) => nodes.find((n) => n.type === 'FormatoDoLancamento').props.onChange('recorrente'));
  assert.deepEqual(ui.nodes().find((n) => n.type === 'FormularioDaSerie').props.estadoGuardado, estadoDaSerie);
});

test('Lançar: escolher o tipo atual não relê nem remonta, e callback após desmontagem não troca o corpo', () => {
  const ui = screen(lancarFile, { params: { tipo: 'uma' }, executarEfeitos: true });
  const corpo = ui.nodes().find((n) => n.type === 'FormularioDoLancamento');
  let leituras = 0;
  ui.interact(() => { corpo.props.registrarComum(() => { leituras++; return corpo.props.comum; }); });
  const seletor = ui.nodes().find((n) => n.type === 'FormatoDoLancamento').props;
  ui.interact(() => seletor.onChange('uma'));
  assert.equal(leituras, 0);
  assert.equal(ui.nodes().find((n) => n.type === 'FormularioDoLancamento').key, corpo.key);
  assert.equal(ui.nodes().find((n) => n.type === 'FormularioDoLancamento').props.focarAoAbrir, true);
  ui.desmontar(); seletor.onChange('recorrente');
  assert.equal(leituras, 0, 'callback guardado após desmontagem não toca leitores nem estado');
});

test('F18 série: editar o fim para antes do próximo vencimento ENCERRA — prévia, confirmação e um comando', () => {
  const hoje = new fixtureDate();
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const br = (d: Date) => iso(d).split('-').reverse().join('/');
  const proxima = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 15, 12);
  const serie = {
    id: 'rec-1', description: 'ChatGPT', merchant: null, kind: 'expense', amount_cents: 12000,
    rrule: 'FREQ=MONTHLY;BYMONTHDAY=15', dtstart: '2026-01-15T12:00:00Z', next_run_at: proxima.toISOString(),
    active: true, account_id: null, category: 'assinaturas', end_date: null, auto_confirm: true, edit_revision: 3,
  };
  const ui = screen('src/components/finance/formulario-da-serie.tsx', { componente: 'FormularioDaSerie', recurring: [serie], props: {
    comum: { kind: 'expense', descricao: '', valorCents: 0, contaId: null, dataBR: br(hoje), categoria: null },
    editandoId: 'rec-1', registrarComum: () => {}, registrarEstado: () => {}, onSalvo: () => {}, onFechar: () => {},
  } });
  const fim = () => ui.nodes().find((n: any) => n.type === 'DatePickerField' && n.props.accessibilityLabel === 'Data em que a série termina');
  assert.equal(fim().props.min, '2026-01-15', 'o piso é o início ORIGINAL, não o próximo vencimento');
  ui.interact(() => fim().props.onChange(br(hoje)));
  const campoFim = ui.nodes().find((n: any) => n.type === 'Field' && n.props.label === 'Termina em');
  assert.match(campoFim.props.hint, /encerra a série/);
  assert.equal(campoFim.props.error, undefined, 'fim antes do próximo vencimento não é erro');
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'TaskHeader').props.action.props.onPress());
  assert.equal(ui.actions.length, 0, 'só o fim mudou: sem pergunta de alcance');
  const previa = ui.pedidos.at(-1);
  assert.equal(previa.operation, 'previewEndRecurring');
  assert.deepEqual(copia(previa.value), { id: 'rec-1', lastDate: iso(hoje) });
  assert.equal(ui.pedidos.some((p: any) => p.operation === 'saveRecurringSeries' || p.operation === 'saveRecurringAll'), false,
    'o fim NÃO vai pelo patch da série: a limpeza das futuras é do comando de encerrar');
  ui.interact(() => previa.opts.onSuccess({ removed_count: 2, removed_cents: 24000, kept_locked_count: 0, kept_paid_count: 3, kept_overdue_count: 0, kept_upcoming_count: 0, end_date: iso(hoje) }));
  assert.match(ui.avisos.at(-1), /Ficam 3 pagas e 0 atrasadas\. Saem 2 cobranças futuras/);
  ui.interact(() => ui.confirmations.at(-1)());
  assert.equal(ui.pedidos.at(-1).operation, 'endRecurring');
  assert.deepEqual(copia(ui.pedidos.at(-1).value), { id: 'rec-1', lastDate: iso(hoje) });
});

test('F18 série: transferência tem "Da conta" e logo depois "Para a conta", sem categoria nem forma de pagamento', () => {
  const props: any = {
    form: { kind: 'transfer', description: 'Reserva', merchant: '', amountCents: 20000, category: null, accountId: 'a', counterpartyId: null,
      preset: 'monthly', intervalo: '1', inicio: '06/10/2026', fim: '', autoConfirm: true },
    contas: [
      { id: 'a', name: 'Conta A', type: 'checking' }, { id: 'b', name: 'Poupança', type: 'savings' },
      { id: 'c', name: 'Cartão', type: 'credit_card' },
    ],
    onChange: (form: any) => { props.form = form; },
  };
  const ui = screen('src/components/finance/serie-form.tsx', { componente: 'CamposDaSerie', props });
  const rotulos = ui.nodes().filter((n: any) => n.type === 'Field').map((n: any) => n.props.label);
  assert.ok(rotulos.includes('Da conta') && rotulos.includes('Para a conta'));
  assert.equal(rotulos.indexOf('Para a conta'), rotulos.indexOf('Da conta') + 1, 'o destino vem logo depois da origem');
  assert.equal(rotulos.includes('Categoria'), false);
  assert.equal(rotulos.includes('Estabelecimento'), false);
  const destino = ui.nodes().find((n: any) => n.type === 'AccountPicker' && n.props.placeholder === 'Escolher a conta de destino');
  assert.deepEqual(copia(destino.props.accounts.map((c: any) => c.id)), ['b'], 'sem cartão e sem repetir a origem');
  ui.interact(() => destino.props.onChange('b'));
  assert.equal(props.form.counterpartyId, 'b');
  // editando, o tipo da transferência não troca por gasto/receita (conversão é explícita)
  const editando = screen('src/components/finance/serie-form.tsx', { componente: 'CamposDaSerie', props: { ...props, form: { ...props.form, id: 's1', counterpartyId: 'b' } } });
  const tipo = editando.nodes().find((n: any) => n.type === 'SelectField' && n.props.value === 'transfer');
  assert.equal(tipo.props.disabled, true);
  assert.deepEqual(copia(tipo.props.options.map((o: any) => o.id)), ['transfer']);
});

test('F18: "Encerrar" abre a folha da série ativa; a encerrada oferece "Reabrir", que só tira o fim', () => {
  const ativa = { id: 'rec-1', description: 'ChatGPT', kind: 'expense', amount_cents: 12000, rrule: 'FREQ=MONTHLY;BYMONTHDAY=15', dtstart: '2026-01-15', next_run_at: '2026-10-15T12:00:00Z', active: true, account_id: null, category: null, edit_revision: 4 };
  const ui = screen('src/app/finance/recurring.tsx', { recurring: [ativa] });
  const acoes = deslizaveis(ui)[0].props.acoes;
  assert.ok(acoes.some((a: any) => a.label === 'Encerrar'), 'a série ativa se encerra');
  assert.equal(acoes.find((a: any) => a.label === 'Reabrir'), undefined);
  ui.interact(() => acoes.find((a: any) => a.label === 'Encerrar').onPress());
  assert.deepEqual(copia(ui.writes.at(-1)), { operation: 'encerrarSerie', value: 'rec-1' });

  const encerrada = { ...ativa, id: 'rec-2', next_run_at: '2099-12-22T12:00:00Z', end_date: '2099-12-21' };
  const ui2 = screen('src/app/finance/recurring.tsx', { recurring: [encerrada] });
  const historico = ui2.nodes().find((n: any) => n.type === 'Row' && n.props.title === 'Encerradas · 1');
  ui2.interact(() => historico.props.onPress());
  const reabrir = deslizaveis(ui2)[0].props.acoes.find((a: any) => a.label === 'Reabrir');
  assert.ok(reabrir, 'a encerrada se reabre');
  assert.equal(deslizaveis(ui2)[0].props.acoes.some((a: any) => a.label === 'Encerrar' || a.label === 'Editar'), false);
});

const dia = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const pausaSerie = () => {
  const hoje = new fixtureDate();
  const proxima = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 15, 12);
  const serie = { id: 'rec-1', description: 'ChatGPT', kind: 'expense', amount_cents: 12000, rrule: 'FREQ=MONTHLY;BYMONTHDAY=15',
    dtstart: '2026-01-15', next_run_at: proxima.toISOString(), active: true, account_id: null, category: null, edit_revision: 4,
    paused_from: null, paused_until: null };
  return { hoje, proxima, serie };
};
const abrirPausa = (ui: any) => ui.interact(() => deslizaveis(ui)[0].props.acoes.find((a: any) => a.label === 'Pausar por um tempo…').onPress());
const folhaDePausa = (ui: any) => ui.nodes().find((n: any) => n.type?.name === 'PausaSheet');
/** A folha sozinha: o harness não desce em componente aninhado, então ela se renderiza direto. */
const pausaSheet = (alvo: any, inicioPadrao: string, opts: Parameters<typeof screen>[1] = {}) =>
  screen('src/components/finance/pausa-sheet.tsx', { componente: 'PausaSheet', ...opts, props: { visivel: true, onClose: () => {}, alvo, inicioPadrao } });
const botaoPausar = (ui: any) => ui.nodes().find((n: any) => n.type === 'TaskHeader').props.action;
const trocaModo = (ui: any, modo: string) => ui.interact(() => ui.nodes().find((n: any) => n.type === 'Segmented').props.onChange(modo));
const alvoSerie = { tipo: 'recurring', id: 'rec-1', titulo: 'ChatGPT' };

test('Pausar…: o menu da série abre a folha no próximo vencimento, ao lado do Pausar sem prazo', () => {
  const { proxima, serie } = pausaSerie();
  const ui = screen('src/app/finance/recurring.tsx', { recurring: [serie] });
  assert.ok(deslizaveis(ui)[0].props.acoes.some((a: any) => a.label === 'Pausar'), 'o Pausar sem prazo continua');
  abrirPausa(ui);
  const folha = folhaDePausa(ui);
  assert.equal(folha.props.inicioPadrao, dia(proxima));
  assert.deepEqual(copia(folha.props.alvo), { tipo: 'recurring', id: 'rec-1', titulo: 'ChatGPT' });
  assert.equal(ui.writes.length, 0, 'abrir a folha não grava');
});

test('Pausar…: próximo vencimento dentro da pausa não aparece como "próximo"', () => {
  const { proxima, serie } = pausaSerie();
  const depois = dia(new Date(proxima.getFullYear(), proxima.getMonth() + 2, 15));
  const texto = (s: any) => ui0(s).nodes().filter((n: any) => n.type === 'ThemedText').map((n: any) => [].concat(n.props.children).join('')).join('|');
  const ui0 = (s: any) => screen('src/app/finance/recurring.tsx', { recurring: [s] });
  assert.match(texto(serie), /próximo /, 'sem pausa mostra o próximo');
  assert.doesNotMatch(texto({ ...serie, paused_from: dia(proxima), paused_until: depois }), /próximo /, 'o próximo está pausado');
});

test('Pausar…: a frase conta as datas que saem, não só as linhas já gravadas', () => {
  // Série ainda não materializada: nenhuma linha gravada (removed_count 0), mas a data da regra sai.
  const ui = pausaSheet(alvoSerie, '2026-11-05', { pausaPrevia: { dates: ['2026-11-05'], removed_count: 0, cents: 12000, until: '2026-11-12' } });
  const frase = ui.nodes().find((n: any) => n.type === 'ThemedText' && /^Saem 1 cobrança/.test(String(n.props.children)));
  assert.ok(frase, 'a data da regra entra na frase');
  assert.match(String(frase.props.children), /05\/11/);
});

test('Pausar…: a prévia vem do banco e "Pausar" manda o período', () => {
  const { proxima } = pausaSerie();
  const ui = pausaSheet(alvoSerie, dia(proxima), { pausaPrevia: { dates: [dia(proxima)], removed_count: 1, cents: 12000, until: '' } });
  assert.equal(ui.nodes().find((n: any) => n.type === 'DatePickerField' && n.props.accessibilityLabel === 'Início da pausa').props.value,
    dia(proxima).split('-').reverse().join('/'));
  trocaModo(ui, 'meses');
  ui.interact(() => ui.nodes().find((n: any) => n.type === 'QuantityField').props.onChange(2));
  const dois = new Date(proxima.getFullYear(), proxima.getMonth() + 2, proxima.getDate());
  assert.deepEqual(copia(ui.previasDePausa.at(-1)), ['rec-1', dia(proxima), dia(dois)]);
  const frase = ui.nodes().find((n: any) => n.type === 'ThemedText' && /^Saem 1 cobrança/.test(String(n.props.children)));
  assert.ok(frase, 'a frase da prévia aparece');
  assert.match(String(frase.props.children), /R\$ 120\.00/);
  ui.interact(() => botaoPausar(ui).props.onPress());
  assert.deepEqual(copia(ui.writes.at(-1)), { operation: 'pauseRecurring', value: { id: 'rec-1', from: dia(proxima), until: dia(dois) } });
});

test('Pausar…: sem prévia a frase some e o botão espera; "Até uma data" exige a data', () => {
  const ui = pausaSheet(alvoSerie, '2026-11-15');
  assert.equal(botaoPausar(ui).props.disabled, true, 'sem prévia não grava');
  assert.equal(ui.nodes().some((n: any) => n.type === 'ThemedText' && /^Saem|^Nenhuma/.test(String(n.props.children))), false);
  trocaModo(ui, 'ate');
  assert.equal(botaoPausar(ui).props.disabled, true);
  assert.ok(ui.nodes().find((n: any) => n.type === 'Field' && n.props.label === 'Até').props.error, 'a razão aparece no campo');
  ui.interact(() => ui.nodes().find((n: any) => n.type === 'DatePickerField' && n.props.accessibilityLabel === 'Último dia da pausa').props.onChange('20/11/2026'));
  assert.deepEqual(copia(ui.previasDePausa.at(-1)), ['rec-1', '2026-11-15', '2026-11-21'], 'a data escolhida é o último dia pausado');
});

test('Pausar…: "Sem prazo" é o Pausar de sempre (active = false), sem o comando de prazo', () => {
  const ui = pausaSheet(alvoSerie, '2026-11-15');
  trocaModo(ui, 'sem_prazo');
  ui.interact(() => botaoPausar(ui).props.onPress());
  assert.deepEqual(copia(ui.writes.at(-1)), { operation: 'toggleRecurring', value: { id: 'rec-1', active: false } });
  assert.equal(ui.writes.some((w: any) => w.operation === 'pauseRecurring'), false);
});

test('Pausar…: série dentro do período fica em Pausadas com "Pausada até" e "Retomar agora" a retoma', () => {
  const { hoje, serie } = pausaSerie();
  const ontem = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 1);
  const fim = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + 10);
  const ui = screen('src/app/finance/recurring.tsx', { recurring: [{ ...serie, paused_from: dia(ontem), paused_until: dia(fim) }] });
  assert.ok(ui.nodes().some((n: any) => n.type === 'SectionHead' && n.props.title === 'Pausadas'));
  const ultimo = dia(new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + 9)).split('-').reverse().join('/');
  assert.ok(ui.nodes().some((n: any) => n.type === 'ThemedText' && String(n.props.children).includes(`Pausada até ${ultimo}`)));
  const acoes = deslizaveis(ui)[0].props.acoes;
  assert.equal(acoes.some((a: any) => a.label === 'Pausar por um tempo…' || a.label === 'Pausar'), false);
  ui.interact(() => acoes.find((a: any) => a.label === 'Retomar agora').onPress());
  assert.deepEqual(copia(ui.writes.at(-1)), { operation: 'resumeRecurring', value: { id: 'rec-1' } });
});

test('Pausar…: a ocorrência pausa a partir do VENCIMENTO (no cartão, da data); só com a série ativa e fora de pausa', () => {
  const base = { kind: 'expense', status: 'pending', amount_cents: 500, description: 'Conta', category: 'x', account_id: 'a',
    counterparty_account_id: null, occurred_at: '2026-10-15', due_at: '2026-10-20', created_at: '2026-10-02T12:00:00Z', invoice_id: null,
    installment_plan_id: null, debt_id: null, pays_invoice_id: null, pix_fee_for_transaction_id: null };
  const ativa = { id: 'rec-1', rrule: 'FREQ=MONTHLY', amount_cents: 500, active: true, paused_from: null, paused_until: null };
  const menu = (extra: object, recurring: any[] = [ativa]) => {
    const ui = screen('src/app/finance/[txId].tsx', { recurring, txs: [{ id: 't', ...base, recurring_id: null, ...extra }], params: { txId: 't' } });
    return { ui, acoes: ui.nodes().find((n: any) => n.type === 'HeaderActions').props.menu.actions };
  };
  assert.equal(menu({}).acoes.some((a: any) => a.label === 'Pausar por um tempo…'), false, 'avulso não tem');
  const { ui, acoes } = menu({ recurring_id: 'rec-1' });
  ui.interact(() => acoes.find((a: any) => a.label === 'Pausar por um tempo…').onPress());
  assert.equal(folhaDePausa(ui).props.inicioPadrao, '2026-10-20');
  assert.equal(folhaDePausa(ui).props.alvo.id, 'rec-1');
  assert.equal(ui.writes.length, 0, 'abrir a folha não grava');
  const cartao = menu({ recurring_id: 'rec-1', invoice_id: 'f1' });
  cartao.ui.interact(() => cartao.acoes.find((a: any) => a.label === 'Pausar por um tempo…').onPress());
  assert.equal(folhaDePausa(cartao.ui).props.inicioPadrao, '2026-10-15');
  for (const serie of [[], [{ ...ativa, active: false }], [{ ...ativa, paused_from: '2026-09-01', paused_until: '2099-01-01' }]]) {
    assert.equal(menu({ recurring_id: 'rec-1' }, serie).acoes.some((a: any) => a.label === 'Pausar por um tempo…'), false);
  }
});

test('Pausar…: lembrete que repete abre a folha; sem repetição só o Pausar de hoje', () => {
  const lembrete = { id: 'r1', title: 'Aluguel', active: true, next_run_at: '2026-10-05T12:00:00Z', recurrence: 'FREQ=MONTHLY' };
  const ui = screen('src/app/reminders.tsx', { reminders: [lembrete, { ...lembrete, id: 'r2', recurrence: null }] });
  const [repete, unico] = deslizaveis(ui);
  assert.equal(unico.props.acoes.some((a: any) => a.label === 'Pausar por um tempo…'), false);
  assert.ok(unico.props.acoes.some((a: any) => a.label === 'Pausar'));
  ui.interact(() => repete.props.acoes.find((a: any) => a.label === 'Pausar por um tempo…').onPress());
  assert.deepEqual(copia(folhaDePausa(ui).props.alvo), { tipo: 'reminder', id: 'r1', titulo: 'Aluguel' });
  assert.equal(ui.writes.length, 0, 'abrir a folha não grava');
});

test('Pausar…: lembrete grava o período, com a frase local (sem prévia do banco)', () => {
  const ui = pausaSheet({ tipo: 'reminder', id: 'r1', titulo: 'Aluguel' }, '2026-10-05');
  ui.interact(() => ui.nodes().find((n: any) => n.type === 'QuantityField').props.onChange(10));
  const frase = ui.nodes().find((n: any) => n.type === 'ThemedText' && /^Não toca de/.test(String(n.props.children)));
  assert.equal(String(frase.props.children), 'Não toca de 05/10 a 14/10.');
  ui.interact(() => botaoPausar(ui).props.onPress());
  assert.deepEqual(copia(ui.writes.at(-1)), { operation: 'pauseReminder', value: { id: 'r1', from: '2026-10-05', until: '2026-10-15' } });
});

test('Pausar…: prévia recarregando esconde a frase e segura o botão', () => {
  const ui = pausaSheet(alvoSerie, '2026-11-15', { pausaBuscando: true, pausaPrevia: { dates: ['2026-11-15'], removed_count: 1, cents: 100, until: '' } });
  assert.equal(ui.nodes().some((n: any) => n.type === 'ThemedText' && /^Saem|^Nenhuma/.test(String(n.props.children))), false);
  assert.equal(botaoPausar(ui).props.disabled, true);
});

test('Pausar…: "Sem prazo" não mostra o início; trocar de unidade volta a quantidade ao padrão', () => {
  const ui = pausaSheet(alvoSerie, '2026-11-15');
  ui.interact(() => ui.nodes().find((n: any) => n.type === 'QuantityField').props.onChange(30));
  trocaModo(ui, 'meses');
  assert.equal(ui.nodes().find((n: any) => n.type === 'QuantityField').props.value, 1);
  trocaModo(ui, 'sem_prazo');
  assert.equal(ui.nodes().some((n: any) => n.type === 'DatePickerField'), false, 'o início não grava, então não aparece');
  assert.equal(botaoPausar(ui).props.disabled, false);
});

test('Pausar…: pausa marcada para depois se cancela (série e lembrete); lembrete em pausa conta como pausado no filtro', () => {
  const { hoje, serie } = pausaSerie();
  const amanha = dia(new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + 2));
  const fim = dia(new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + 9));
  const ui = screen('src/app/finance/recurring.tsx', { recurring: [{ ...serie, paused_from: amanha, paused_until: fim }] });
  const acoes = deslizaveis(ui)[0].props.acoes;
  assert.ok(acoes.some((a: any) => a.label === 'Pausar'), 'ainda não começou: pausa normal disponível');
  ui.interact(() => acoes.find((a: any) => a.label === 'Cancelar pausa').onPress());
  assert.deepEqual(copia(ui.writes.at(-1)), { operation: 'resumeRecurring', value: { id: 'rec-1' } });
  const l = { id: 'r1', title: 'Aluguel', active: true, next_run_at: '2026-10-05T12:00:00Z', recurrence: 'FREQ=MONTHLY', paused_from: amanha, paused_until: fim };
  const ui2 = screen('src/app/reminders.tsx', { reminders: [l] });
  ui2.interact(() => deslizaveis(ui2)[0].props.acoes.find((a: any) => a.label === 'Cancelar pausa').onPress());
  assert.deepEqual(copia(ui2.writes.at(-1)), { operation: 'pauseReminder', value: { id: 'r1', from: null, until: null } });
  const dentro = { ...l, paused_from: dia(hoje) };
  const ui3 = screen('src/app/reminders.tsx', { reminders: [dentro], params: {} });
  ui3.interact(() => ui3.nodes().find((n: any) => n.type === 'ListFilters').props.onApply({ selections: { status: 'active' } }));
  assert.equal(ui3.nodes().some((n: any) => n.type === 'Section'), false, 'em pausa não é "Ativo"');
  ui3.interact(() => ui3.nodes().find((n: any) => n.type === 'ListFilters').props.onApply({ selections: { status: 'paused' } }));
  assert.ok(ui3.nodes().some((n: any) => n.type === 'Section' && n.props.title === 'Pausados'));
});

test('Pausar…: lembrete cujo próximo cai dentro da pausa não mostra "próximo"', () => {
  const l = { id: 'r1', title: 'Aluguel', active: true, next_run_at: '2026-10-05T12:00:00Z', recurrence: 'FREQ=MONTHLY',
    paused_from: '2026-10-01', paused_until: '2026-10-20' };
  const sub = (r: any) => screen('src/app/reminders.tsx', { reminders: [r] }).nodes().find((n: any) => n.type === 'Row').props.subtitle;
  assert.match(sub({ ...l, paused_from: null, paused_until: null }), /próximo /, 'sem pausa mostra o próximo');
  assert.doesNotMatch(sub(l), /próximo /, 'o próximo está pausado');
});

test('Pausar…: o filtro de estado do lembrete vai ao servidor, em PostgREST', () => {
  assert.equal(filtroDeEstadoDoLembrete('paused', '2026-10-07'), 'active.eq.false,and(paused_from.lte.2026-10-07,paused_until.gt.2026-10-07)');
  assert.equal(filtroDeEstadoDoLembrete('active', '2026-10-07'),
    'and(active.eq.true,or(paused_from.is.null,paused_until.is.null,paused_from.gt.2026-10-07,paused_until.lte.2026-10-07))');
});

test('Pausar…: lembrete dentro do período vai para Pausados e "Retomar agora" limpa os dois campos', () => {
  const hoje = new fixtureDate();
  const lembrete = { id: 'r1', title: 'Aluguel', active: true, next_run_at: '2026-10-05T12:00:00Z', recurrence: 'FREQ=MONTHLY',
    paused_from: dia(hoje), paused_until: dia(new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + 3)) };
  const ui = screen('src/app/reminders.tsx', { reminders: [lembrete] });
  assert.ok(ui.nodes().some((n: any) => n.type === 'Section' && n.props.title === 'Pausados'));
  assert.equal(ui.nodes().some((n: any) => n.type === 'Section' && n.props.title === 'Ativos'), false);
  ui.interact(() => deslizaveis(ui)[0].props.acoes.find((a: any) => a.label === 'Retomar agora').onPress());
  assert.deepEqual(copia(ui.writes.at(-1)), { operation: 'pauseReminder', value: { id: 'r1', from: null, until: null } });
});

test('Recorrente encerrada não anuncia próxima cobrança, nem oferece editar ou retomar', () => {
  const serie = { id: 'rec-encerrada', description: 'Aluguel encerrado', kind: 'expense', amount_cents: 65000,
    active: true, rrule: 'FREQ=MONTHLY;BYMONTHDAY=22', next_run_at: '2099-12-22T12:00:00Z',
    end_date: '2099-12-21', last_error: 'erro antigo', category: null };
  const ui = screen('src/app/finance/recurring.tsx', { recurring: [serie] });
  assert.equal(deslizaveis(ui).length, 0, 'histórico recolhido não se passa por recorrência ativa');
  const historico = ui.nodes().find((n: any) => n.type === 'Row' && n.props.title === 'Encerradas · 1');
  assert.ok(historico);
  ui.interact(() => historico.props.onPress());
  const item = deslizaveis(ui)[0];
  assert.deepEqual(copia(item.props.acoes.map((a: any) => a.label)), ['Ver ocorrências', 'Reabrir', 'Apagar']);
  const linha = ui.nodes().find((n: any) => n.type === 'Row' && n.props.title === serie.description);
  assert.equal(linha.props.subtitle, 'Encerrada em 21/12/2099');
  assert.doesNotMatch(linha.props.accessibilityLabel, /próximo|pausad/i);
  ui.interact(() => item.props.acoes[0].onPress());
  assert.deepEqual(copia(ui.navigations.at(-1)), { pathname: '/finance/transactions', params: { recurringId: serie.id, month: '2099-12' } });
});

test('Link antigo da recorrência encerrada mostra histórico, sem montar edição ou oferecer conversão', () => {
  let fechou = false;
  const serie = { id: 'rec-encerrada', active: true, next_run_at: '2099-12-22T12:00:00Z', end_date: '2099-12-21' };
  const ui = screen('src/components/finance/formulario-da-serie.tsx', { componente: 'FormularioDaSerie', recurring: [serie], props: {
    editandoId: serie.id, onFechar: () => { fechou = true; },
  } });
  assert.equal(ui.nodes().find((n: any) => n.type === 'TaskHeader')?.props.title, 'Recorrência encerrada');
  assert.equal(ui.nodes().some((n: any) => ['TextField', 'DatePickerField', 'CamposDaSerie'].includes(n.type)), false);
  const vazio = ui.nodes().find((n: any) => n.type === 'EmptyState');
  assert.ok(vazio);
  ui.interact(() => vazio.props.action.onPress());
  assert.equal(fechou, true);
  assert.equal(ui.writes.length, 0);
});


const filterScreenText = (ui: ReturnType<typeof screen>) => JSON.stringify(ui.nodes().map(n =>
  [n.props.label, n.props.title, n.props.titulo, n.props.accessibilityLabel, n.props.subtitle, typeof n.props.children === 'string' ? n.props.children : null]));

const applyListFilters = (ui: ReturnType<typeof screen>, value: Record<string, unknown>) =>
  ui.interact(nodes => nodes.find(n => n.type === 'ListFilters').props.onApply(value));

test('F06: grupos independentes combinam pagamento e previsões, contam um critério por grupo e ocultam total global', () => {
  for (const tablet of [false, true]) {
    const base = { origin: 'recurring', ref_id: 'r', due_date: '2026-09-20', amount_cents: 1200, kind: 'expense',
      description: 'Fixa essencial', category: null, account_id: null, payment_method: 'pix', status: 'pending', inferred_start: false,
      expense_pattern: 'fixed', expense_pattern_source: 'explicit', expense_necessity: 'essential', expense_necessity_source: 'explicit' };
    const ui = screen(transacoesFile, { tablet, txs: [], expectedLines: [base,
      { ...base, ref_id: 'other-pattern', description: 'Variável essencial', expense_pattern: 'variable' },
      { ...base, ref_id: 'other-necessity', description: 'Fixa não essencial', expense_necessity: 'discretionary' },
      { ...base, ref_id: 'other-payment', description: 'Fixa essencial boleto', payment_method: 'boleto' },
      { ...base, ref_id: 'legacy', description: 'Legado', expense_pattern: null, expense_necessity: null }],
    expectedInTransit: [{ ...base, ref_id: 'transit-yes', description: 'Em trânsito compatível' },
      { ...base, ref_id: 'transit-no', description: 'Em trânsito fora do filtro', expense_pattern: 'variable' }] });
    applyListFilters(ui, { multiSelections: { paymentMethods: ['pix'], expensePatterns: ['not_informed', 'fixed', 'fixed'], expenseNecessities: ['essential', 'not_informed'] } });
    const query = ui.transactionQueries.at(-1);
    assert.deepEqual(copia(query?.expensePatterns ?? null), ['fixed', 'not_informed']);
    assert.deepEqual(copia(query?.expenseNecessities ?? null), ['essential', 'not_informed']);
    assert.deepEqual(copia(query?.paymentMethods), ['pix']);
    const sheet = ui.nodes().find(n => n.type === 'ListFilters');
    assert.deepEqual(copia(sheet.props.value.multiSelections.expensePatterns), ['fixed', 'not_informed']);
    assert.deepEqual(copia(sheet.props.value.multiSelections.expenseNecessities), ['essential', 'not_informed']);
    assert.match(filterScreenText(ui), /Filtros · 3/);
    assert.match(filterScreenText(ui), /Previsibilidade dos gastos: Fixo, Não informado/);
    assert.match(filterScreenText(ui), /Necessidade dos gastos: Essencial, Não informado/);
    assert.ok(!ui.nodes().some(n => n.type === 'PeriodSummaryCard'));
    assert.deepEqual(ui.nodes().filter(n => n.type === 'LinhaPrevista').map(n => n.props.line.description).sort(),
      ['Em trânsito compatível', 'Fixa essencial', 'Legado']);
    applyListFilters(ui, {});
    assert.deepEqual(copia(ui.transactionQueries.at(-1)?.expensePatterns ?? null), []);
    assert.deepEqual(copia(ui.transactionQueries.at(-1)?.expenseNecessities ?? null), []);
  }
});

test('F06: links atualizam cada dimensão na tela montada; ausência conserva e vazio limpa só seu grupo', () => {
  const params: Record<string, string> = { expensePatterns: 'variable,fixed', expenseNecessities: 'essential', paymentMethods: 'pix' };
  const ui = screen(transacoesFile, { params });
  assert.deepEqual(copia(ui.transactionQueries.at(-1)?.expensePatterns ?? null), ['fixed', 'variable']);
  assert.deepEqual(copia(ui.transactionQueries.at(-1)?.expenseNecessities ?? null), ['essential']);
  delete params.expensePatterns; delete params.expenseNecessities; params.month = '2026-10'; ui.interact(() => {});
  assert.deepEqual(copia(ui.transactionQueries.at(-1)?.expensePatterns ?? null), ['fixed', 'variable']);
  params.expensePatterns = ''; params.expenseNecessities = 'discretionary,not_informed'; ui.interact(() => {});
  assert.deepEqual(copia(ui.transactionQueries.at(-1)?.expensePatterns ?? null), []);
  assert.deepEqual(copia(ui.transactionQueries.at(-1)?.expenseNecessities ?? null), ['discretionary', 'not_informed']);
  assert.deepEqual(copia(ui.transactionQueries.at(-1)?.paymentMethods), ['pix']);
});

test('F06: dimensão inválida bloqueia leitura, cache e refresh; cancelar preserva erro e Aplicar recupera', () => {
  for (const params of [{ expensePatterns: 'fixed,mystery' }, { expenseNecessities: 'essential,fixed' }]) {
    const ui = screen(transacoesFile, { params, maisPaginas: true, expectedLines: [assinaturaPrevista], expectedInTransit: [assinaturaPrevista] });
    assert.equal(ui.transactionQueries.at(-1)?.pronto, false);
    assert.equal(ui.expectedQueries.at(-1)?.pronto, false);
    assert.match(filterScreenText(ui), /Classificação de gasto inválida no link/);
    const validation = ui.nodes().find(n => n.type === 'EmptyState');
    assert.ok(validation, 'link inválido usa o estado de validação do kit');
    assert.equal(validation.props.action.label, 'Ajustar filtros');
    assert.ok(!ui.nodes().some(n => n.type === 'ErrorCard'), 'validação não é falha de carga');
    assert.ok(!ui.nodes().some(n => ['SkeletonRow', 'LinhaPrevista', 'PeriodSummaryCard', 'LedgerRow'].includes(n.type)));
    ui.interact(() => validation.props.action.onPress());
    assert.equal(ui.nodes().find(n => n.type === 'ListFilters').props.visible, true);
    ui.interact(nodes => nodes.find(n => n.type === 'ListFilters').props.onClose());
    assert.equal(ui.transactionQueries.at(-1)?.pronto, false);
    ui.interact(nodes => nodes.find(n => n.type === 'SectionList').props.onRefresh());
    assert.ok(!ui.refetches.includes('list'));
    applyListFilters(ui, { multiSelections: { expensePatterns: ['fixed'], expenseNecessities: ['essential'] } });
    assert.equal(ui.transactionQueries.at(-1)?.pronto, true);
    assert.doesNotMatch(filterScreenText(ui), /Classificação de gasto inválida no link/);
  }
});

test('F06: classificar com Receitas ou Transferências conserva Tipo e exclui previstas', () => {
  for (const kind of ['income', 'transfer']) {
    const ui = screen(transacoesFile, { txs: [], expectedLines: [assinaturaPrevista, { ...assinaturaPrevista, ref_id: 'income', kind: 'income' }] });
    applyListFilters(ui, { selections: { kind }, multiSelections: { expensePatterns: ['not_informed'] } });
    assert.equal(ui.transactionQueries.at(-1)?.kind, kind);
    assert.equal(ui.nodes().find(n => n.type === 'ListFilters').props.value.selections.kind, kind);
    assert.ok(!ui.nodes().some(n => n.type === 'LinhaPrevista'));
    assert.ok(!ui.nodes().some(n => n.type === 'PeriodSummaryCard'));
  }
});

test('F05: métodos múltiplos seguem query, folha, previstas e resumo sem exibir total global', () => {
  const base = { origin: 'recurring', ref_id: 'r', due_date: '2026-09-20', amount_cents: 1200, kind: 'expense',
    description: 'Prevista Pix', category: null, account_id: null, payment_method: 'pix', status: 'pending', inferred_start: false };
  const ui = screen(transacoesFile, { txs: [], expectedLines: [base,
    { ...base, ref_id: 'legacy', description: 'Prevista histórica', payment_method: null },
    { ...base, ref_id: 'boleto', description: 'Prevista boleto', payment_method: 'boleto' }],
    expectedInTransit: [{ ...base, ref_id: 'transit', description: 'Em trânsito boleto', payment_method: 'boleto' }] });
  applyListFilters(ui, { multiSelections: { paymentMethods: ['not_informed', 'pix', 'pix'] } });
  assert.deepEqual(copia(ui.transactionQueries.at(-1)?.paymentMethods), ['pix', 'not_informed']);
  const sheet = ui.nodes().find(n => n.type === 'ListFilters');
  assert.deepEqual(copia(sheet.props.value.multiSelections.paymentMethods), ['pix', 'not_informed']);
  assert.ok(sheet.props.multiSelects[0].options.some((o: any) => o.id === 'not_informed' && o.label === 'Não informado'));
  assert.match(filterScreenText(ui), /Filtros · 1/);
  assert.match(filterScreenText(ui), /Pix, Não informado/);
  assert.ok(!ui.nodes().some(n => n.type === 'PeriodSummaryCard'));
  const shown = ui.nodes().filter(n => n.type === 'LinhaPrevista').map(n => n.props.line.description);
  assert.deepEqual(shown.sort(), ['Prevista Pix', 'Prevista histórica'].sort());
  applyListFilters(ui, {});
  assert.deepEqual(copia(ui.transactionQueries.at(-1)?.paymentMethods), []);
  assert.ok(!ui.nodes().find(n => n.type === 'ListFilters').props.value.multiSelections);
});

test('F05: link altera tela montada; ausência conserva método e vazio limpa somente este grupo', () => {
  const params: Record<string, string> = { paymentMethods: 'pix,not_informed' };
  const ui = screen(transacoesFile, { params });
  assert.deepEqual(copia(ui.transactionQueries.at(-1)?.paymentMethods), ['pix', 'not_informed']);
  applyListFilters(ui, { q: 'salário', selections: { status: 'pending' }, multiSelections: { paymentMethods: ['boleto'] } });
  delete params.paymentMethods; params.month = '2026-10';
  ui.interact(() => {});
  assert.deepEqual(copia(ui.transactionQueries.at(-1)?.paymentMethods), ['boleto']);
  params.paymentMethods = 'credit,pix'; ui.interact(() => {});
  assert.deepEqual(copia(ui.transactionQueries.at(-1)?.paymentMethods), ['pix', 'credit']);
  params.paymentMethods = ''; ui.interact(() => {});
  assert.deepEqual(copia(ui.transactionQueries.at(-1)?.paymentMethods), []);
  assert.equal(ui.transactionQueries.at(-1)?.q, 'salário');
  assert.equal(ui.transactionQueries.at(-1)?.status, 'pending');
});

test('F05: link malformado mostra recuperação e bloqueia leitura ampliada, Aplicar resolve', () => {
  const ui = screen(transacoesFile, { params: { paymentMethods: 'pix,mystery' }, expectedLines: [
    { origin: 'recurring', ref_id: 'r', due_date: '2026-09-20', amount_cents: 1200, kind: 'expense',
      description: 'Cache anterior', category: null, account_id: null, status: 'pending', inferred_start: false },
  ] });
  assert.equal(ui.transactionQueries.at(-1)?.pronto, false);
  assert.equal(ui.expectedQueries.at(-1)?.pronto, false);
  assert.match(filterScreenText(ui), /Forma de pagamento inválida no link/);
  assert.ok(!ui.nodes().some(n => ['SkeletonRow', 'LinhaPrevista', 'PeriodSummaryCard'].includes(n.type)));
  ui.interact(nodes => nodes.find(n => n.type === 'SectionList').props.onRefresh());
  assert.ok(!ui.refetches.includes('list'), 'puxar para atualizar não consulta um filtro inválido');
  applyListFilters(ui, { multiSelections: { paymentMethods: ['pix'] } });
  assert.equal(ui.transactionQueries.at(-1)?.pronto, true);
  assert.deepEqual(copia(ui.transactionQueries.at(-1)?.paymentMethods), ['pix']);
  assert.doesNotMatch(filterScreenText(ui), /Forma de pagamento inválida no link/);
});

test('F05: método combina com datas abertas e erro continua erro, sem previstas de cache', () => {
  const ui = screen(transacoesFile, { listError: true });
  applyListFilters(ui, { from: '2026-08-01', minCents: 0, selections: { accountId: 'none', status: 'pending' },
    multiSelections: { paymentMethods: ['not_informed'] } });
  assert.equal(ui.transactionQueries.at(-1)?.accountId, null);
  assert.equal(ui.transactionQueries.at(-1)?.from, '2026-08-01');
  assert.deepEqual(copia(ui.transactionQueries.at(-1)?.paymentMethods), ['not_informed']);
  assert.equal(ui.expectedQueries.at(-1)?.pronto, false);
  assert.ok(ui.nodes().some(n => n.type === 'ErrorCard'));
  assert.ok(!ui.nodes().some(n => n.type === 'EmptyState'));
});

for (const [scope, file, defaultLabel] of [
  ['arquivadas', 'src/app/notes/archived.tsx', 'Notas arquivadas'],
  ['lixeira', 'src/app/notes/trash.tsx', 'Notas na lixeira'],
  ['pasta', 'src/app/notes/folder/[id].tsx', 'Notas desta pasta'],
]) test(`Notas ${scope}: resumo único conserva busca/data e a limpeza restaura o contexto`, () => {
  for (const tablet of [false, true]) {
    const ui = screen(file, { tablet, params: { id: 'f1' },
      folders: [{ id: 'f1', name: 'Casa', parent_id: null, tags: ['casa'], notes_count: 1 }],
      notes: [{ id: 'n1', content: 'Aluguel', tags: [], folder_id: 'f1' }],
    });
    ui.press('Filtros');
    applyListFilters(ui, { q: 'aluguel', from: '2026-09-30', to: '2026-09-30' });
    assert.match(filterScreenText(ui), /Filtros · 2/);
    assert.match(filterScreenText(ui), /Atualização: 30\/09\/2026 · Busca: aluguel/);
    assert.ok(!ui.nodes().some(n => n.type === 'Button' && n.props.label === 'Limpar filtros'));
    applyListFilters(ui, {});
    assert.ok(filterScreenText(ui).includes(defaultLabel));
  }
});

test('Notas: abrir filtros antes do debounce conserva busca atual; aplicar/limpar cancela termos antigos', () => {
  for (const tablet of [false, true]) {
    const ui = screen(notasFile, { tablet, executarEfeitos: true, controlarTimers: true,
      folders: [{ id: 'f1', name: 'Casa', parent_id: null, tags: ['casa'], notes_count: 0 }],
      noteTags: [{ tag: 'trabalho', count: 2 }],
    });
    const typeSearch = (text: string) => ui.interact(nodes => nodes.find(n => n.type === 'SearchField').props.onChangeText(text));
    const sheet = () => ui.nodes().find(n => n.type === 'ListFilters');
    typeSearch('  aluguel  ');
    ui.press('Filtros');
    assert.equal(sheet().props.value.q, 'aluguel', 'rascunho deve receber a última digitação sem esperar o timer');
    assert.equal(sheet().props.showSearch, false, 'busca tem um único campo');
    assert.deepEqual(copia(sheet().props.selects[0].options.map((t: any) => t.label)), ['#trabalho', '#casa']);
    assert.ok(!ui.nodes().some(n => n.type === 'Chip'), 'tags são critérios na folha, pastas continuam na grade');
    ui.interact(() => sheet().props.onClose());
    ui.interact(() => ui.flushTimers());
    assert.equal(sheet().props.value.q, 'aluguel', 'cancelar mantém a busca viva');
    ui.press('Filtros · 1');
    applyListFilters(ui, { q: '  aluguel  ', selections: { tag: 'casa' } });
    assert.equal(ui.nodes().find(n => n.type === 'SearchField').props.value, 'aluguel');
    assert.match(filterScreenText(ui), /Busca: aluguel · Tag: #casa/);
    typeSearch('termo antigo pendente');
    applyListFilters(ui, {});
    ui.interact(() => ui.flushTimers());
    assert.equal(sheet().props.value.q, '');
    assert.equal(ui.nodes().find(n => n.type === 'SearchField').props.value, '');
    assert.match(filterScreenText(ui), /Notas soltas/);
    typeSearch('   ');
    ui.press('Filtros');
    assert.equal(sheet().props.value.q, '');
    assert.ok(!filterScreenText(ui).includes('Filtros ·'));
    ui.desmontar();
  }
});

test('Barra compacta revela todos os critérios ao leitor de tela, conserva nomes e esconde dinheiro', () => {
  let opened = 0;
  for (const concealed of [false, true]) {
    const ui = screen('src/components/ui/filter-bar.tsx', { componente: 'FilterBar', concealed, props: {
      value: { q: 'aluguel', from: '2026-09-30', to: '2026-09-30', minCents: 0, maxCents: 20000,
        selections: { conta: 'c1', estado: 'paused' } }, defaultLabel: 'Todos', onPress: () => opened++,
      selects: [{ key: 'conta', label: 'Conta', options: [{ id: 'c1', label: 'Conta com nome completo e longo' }] },
        { key: 'estado', label: 'Estado', options: [{ id: 'paused', label: 'Pausados' }] }],
    } });
    const summary = ui.nodes().find(n => n.type === 'ThemedText');
    assert.equal(summary.props.children, 'Data: 30/09/2026 · Busca: aluguel · mais 3');
    assert.match(summary.props.accessibilityLabel, /Conta com nome completo e longo.*Pausados/);
    assert.match(summary.props.accessibilityLabel, concealed ? /•••••• a ••••••/ : /R\$ 0.00 a R\$ 200.00/);
    assert.equal(summary.props.numberOfLines, undefined);
    assert.equal(ui.nodes().find(n => n.type === 'MudancaSuave').key, String(concealed));
    ui.press('Filtros · 5');
    assert.equal(ui.nodes().filter(n => n.type === 'Button').length, 1);
  }
  assert.equal(opened, 2);
});

test('Lembretes: critérios têm uma entrada única e resumo; limpar no vazio continua sendo contextual', () => {
  for (const tablet of [false, true]) {
    const ui = screen('src/app/reminders.tsx', { tablet, reminders: [{ id: 'r1', title: 'Reunião', active: false, next_run_at: '2026-09-30T15:00:00Z' }] });
    ui.press('Filtros');
    assert.equal(ui.nodes().find(n => n.type === 'ListFilters').props.visible, true);
    applyListFilters(ui, { selections: { status: 'paused', channel: 'whatsapp' } });
    assert.match(filterScreenText(ui), /Filtros · 2/);
    assert.match(filterScreenText(ui), /Estado: Pausados · Canal: WhatsApp/);
    assert.ok(!ui.nodes().some(n => n.type === 'Button' && n.props.label === 'Limpar filtros'));
    const sheet = ui.nodes().find(n => n.type === 'ListFilters');
    assert.deepEqual(copia(sheet.props.selects), copia(ui.nodes().find(n => n.type?.name === 'FilterBar').props.selects));
    applyListFilters(ui, {});
    assert.match(filterScreenText(ui), /Todos os lembretes/);
  }
});

test('Importações: barra compacta conserva formato/conta e aplicar reinicia a paginação', () => {
  const batch = { id: 'b1', filename: 'extrato.csv', source: 'csv', account_id: null,
    created_at: '2026-09-30T15:00:00Z', pendentes: 0, total: 2, aprovados: 2 };
  const ui = screen('src/app/import-history.tsx', { batches: Array.from({ length: 20 }, (_, i) => ({ ...batch, id: `b${i}` })) });
  ui.interact(nodes => nodes.find(n => n.type === 'VerMais' && n.props.restantes === null).props.onPress());
  assert.equal(ui.pedidosDeLimite.at(-1)[1], 40);
  applyListFilters(ui, { selections: { source: 'csv', accountId: 'none' } });
  assert.equal(ui.pedidosDeLimite.at(-1)[1], 20);
  assert.match(filterScreenText(ui), /Filtros · 2/);
  assert.match(filterScreenText(ui), /Formato: CSV · Conta ou cartão: Sem conta/);
  assert.ok(!ui.nodes().some(n => n.type === 'Button' && n.props.label === 'Limpar filtros'));
  applyListFilters(ui, {});
  assert.match(filterScreenText(ui), /Todas as importações/);
});

test('Lançamentos: um único editor conserva todos os critérios e resume o recorte sem repetir controles', () => {
  for (const tablet of [false, true]) {
    const ui = screen(transacoesFile, { tablet, forecastAccounts: [{ id: 'c1', name: 'Nubank Cartão', type: 'credit_card' }] });
    ui.press('Filtros');
    assert.equal(ui.nodes().find(n => n.type === 'ListFilters').props.visible, true);
    const value = { q: 'hotel', from: '2026-09-01', to: '2026-09-30', minCents: 0, maxCents: 20000,
      selections: { kind: 'expense', status: 'cleared', category: 'viagem', accountId: 'c1', source: 'import' } };
    applyListFilters(ui, value);
    assert.deepEqual(copia(ui.nodes().find(n => n.type === 'ListFilters').props.value), value);
    assert.match(filterScreenText(ui), /Filtros · 8/);
    const summary = ui.nodes().find(n => n.props.accessibilityLabel?.includes('Gastos · Concluído'));
    assert.match(summary.props.accessibilityLabel, /Nubank Cartão.*Gastos.*Concluído.*viagem.*Importado.*R\$ 0.00 a R\$ 200.00.*hotel/);
    assert.equal(summary.props.children, 'Nubank Cartão · Gastos · mais 5', 'resumo revela a quantidade de critérios adicionais sem truncar os nomes');
    assert.ok(!ui.nodes().some(n => ['Chip', 'Segmented'].includes(n.type)), 'critérios são editados na folha');
    assert.ok(!ui.nodes().some(n => n.type === 'PeriodSummaryCard'), 'total global não é exibido sobre um recorte');
    const menu = ui.nodes().find(n => n.type === 'HeaderActions').props.menu.actions;
    assert.ok(!menu.some((a: any) => ['Conta', 'Origem'].includes(a.label)), 'menu não duplica o editor');
    applyListFilters(ui, {});
    assert.match(filterScreenText(ui), /Todos os lançamentos/);
    assert.ok(ui.nodes().some(n => n.type === 'PeriodBar'), 'limpeza restaura navegação mês/ciclo');
    assert.equal(ui.nodes().find(n => n.type === 'ListFilters').props.value.selections.accountId, '');
  }
});

test('Lançamentos: resumo financeiro e rótulo acessível respeitam ocultação de valores', () => {
  const ui = screen(transacoesFile, { concealed: true });
  applyListFilters(ui, { minCents: 0, maxCents: 20000 });
  const summary = ui.nodes().find(n => n.props.accessibilityLabel?.includes('•••••• a ••••••'));
  assert.ok(summary);
  assert.equal(summary.props.children, '•••••• a ••••••');
  assert.match(filterScreenText(ui), /Filtros · 1/);
});

test('F05: ocultar valores protege o rótulo acessível das linhas gravadas e previstas', () => {
  const tx = { id: 'privacy-payment', kind: 'expense', amount_cents: 1001, description: 'Compra privada',
    payment_method: 'pix', occurred_at: '2026-10-01', due_at: null, status: 'cleared',
    category: null, merchant: null, account_id: null, source: 'app', invoice_id: null };
  for (const concealed of [false, true]) {
    const ui = screen(transacoesFile, { concealed, txs: [tx], params: { paymentMethods: 'pix' } });
    const link = ui.nodes().find(n => n.type === 'ItemLink' && n.props.title === tx.description);
    assert.ok(link);
    const row = link.props.children({ onLongPress() {} });
    assert.match(row.props.accessibilityLabel, concealed ? /Compra privada, ••••••, despesa/ : /Compra privada, R\$\s10[.,]01, despesa/);
    const prevista = screen('src/components/finance/expected-ledger-lines.tsx', {
      componente: 'LinhaPrevista', concealed,
      props: { line: { ...assinaturaPrevista, description: 'Prevista privada', amount_cents: 1001 },
        hoje: '2026-10-01', acoes: [], onAbrir() {} },
    }).nodes().find(n => n.type === 'Row');
    assert.ok(prevista);
    assert.match(prevista.props.accessibilityLabel, concealed ? /Prevista privada, ••••••, despesa/ : /Prevista privada, R\$\s10[.,]01, despesa/);
  }
});

test('F05: ocultar valores protege o rótulo acessível do destaque no detalhe', () => {
  for (const concealed of [false, true]) {
    const ui = screen('src/app/finance/[txId].tsx', { concealed, params: { txId: 'privacy-detail' }, txs: [{ id: 'privacy-detail', kind: 'expense',
      amount_cents: 1001, description: 'Compra privada', occurred_at: '2026-10-01', category: null,
      account_id: null, status: 'cleared', source: 'app', payment_method: 'pix' }] });
    const hero = ui.nodes().find(n => n.type === 'HeroLabel');
    assert.ok(hero);
    assert.match(hero.props.accessibilityLabel, concealed ? /^Despesa de ••••••$/ : /^Despesa de R\$\s10[.,]01$/);
  }
});

test('Ocorrências usam o mês civil para retornar de um período personalizado', () => {
  const ui = screen(transacoesFile, { params: { recurringId: 'r1' } });
  assert.equal(ui.nodes().find(n => n.type === 'ListFilters').props.resetDatesLabel, 'Voltar ao mês');
});

for (const tablet of [false, true]) {
  for (const [boundary, value, label] of [
    ['inicial', { from: '2026-08-01' }, 'A partir de 01/08/2026'],
    ['final', { to: '2026-10-31' }, 'Até 31/10/2026'],
  ] as const) {
    test(`Lançamentos: data ${boundary} sozinha consulta intervalo aberto (${tablet ? 'tablet' : 'celular'})`, () => {
      const ui = screen(transacoesFile, { tablet, datasReais: true });
      applyListFilters(ui, value);
      const pedido = ui.transactionQueries.at(-1);
      assert.equal(pedido.from, 'from' in value ? value.from : undefined);
      assert.equal(pedido.to, 'to' in value ? value.to : undefined);
      assert.equal(pedido.pronto, true, 'data escolhida não espera as bordas do mês');
      assert.ok(ui.nodes().some(n => n.props.accessibilityLabel === `Período: ${label}`));
      assert.ok(!ui.nodes().some(n => ['PeriodBar', 'MonthPicker', 'PeriodSummaryCard'].includes(n.type)));
      assert.equal(ui.expectedQueries.at(-1)?.pronto, false, 'sem duas datas não calcula previsões');
      assert.equal(ui.summaryQueries.at(-1)?.pronto, false, 'resumo financeiro oculto não faz consulta');
      const folha = ui.nodes().find(n => n.type === 'ListFilters');
      assert.deepEqual(copia(folha.props.dateLabels), { from: 'Lançamento a partir de', to: 'Lançamento até' });
      const explicacao = `${filterScreenText(ui)} ${JSON.stringify(folha.props)}`;
      assert.match(explicacao, /registrados/i);
      assert.match(explicacao, /previsões/i);
    });
  }
}

test('Lançamentos: intervalo aberto ignora previsões em cache e em trânsito; duas datas restauram cálculo', () => {
  for (const tablet of [false, true]) {
    const ui = screen(transacoesFile, { tablet, expectedLines: [assinaturaPrevista],
      expectedInTransit: [{ ...assinaturaPrevista, ref_id: 'in-flight' }] });
    assert.ok(ui.nodes().some(n => n.type === 'LinhaPrevista'), 'mês normal conserva suas previsões');
    const mes = ui.transactionQueries.at(-1);
    applyListFilters(ui, { from: '2026-08-01' });
    assert.ok(!ui.nodes().some(n => n.type === 'LinhaPrevista'), 'desligar consulta não pode vazar dados em cache');
    applyListFilters(ui, { from: '2026-08-01', to: '2026-10-31' });
    assert.deepEqual(ui.expectedQueries.at(-1), { from: '2026-08-01', to: '2026-10-31', pronto: true, recurringId: undefined });
    assert.ok(ui.nodes().some(n => n.type === 'LinhaPrevista' && n.props.line.ref_id === 'in-flight'));
    applyListFilters(ui, {});
    assert.equal(ui.transactionQueries.at(-1)?.from, mes.from);
    assert.equal(ui.transactionQueries.at(-1)?.to, mes.to);
    assert.equal(ui.expectedQueries.at(-1)?.pronto, true);
    assert.equal(ui.summaryQueries.at(-1)?.pronto, true);
    assert.ok(ui.nodes().some(n => n.type === 'PeriodBar'));
  }
});

for (const recurringId of [undefined, 'serie-anos']) {
  test(`Lançamentos: período personalizado distingue anos nos dias e rótulos acessíveis (${recurringId ? 'ocorrências' : 'extrato'})`, () => {
    for (const tablet of [false, true]) {
      const txs = ['2027-08-01', '2026-08-01'].map((occurred_at, index) => ({
        id: `ano-${index}`, description: `Parcela ${index + 1}`, kind: 'expense', amount_cents: 5250,
        category: 'compras', account_id: null, status: 'pending', invoice_id: 'f1', source: 'app',
        occurred_at, due_at: occurred_at, installment_plan_id: null, recurring_id: recurringId ?? null,
      }));
      const ui = screen(transacoesFile, { tablet, datasReais: true, txs, params: recurringId ? { recurringId } : {} });
      const list = () => ui.nodes().find(n => n.type === 'SectionList');
      const sections = () => list().props.sections;
      for (const value of [
        { from: '2026-08-01' },
        { to: '2027-08-01' },
        { from: '2026-08-01', to: '2027-08-01' },
      ]) {
        applyListFilters(ui, value);
        const titles = sections().map((s: any) => s.title);
        assert.ok(titles.some((title: string) => title.includes('01/08/2026')));
        assert.ok(titles.some((title: string) => title.includes('01/08/2027')));
        const header = list().props.renderSectionHeader({ section: sections()[0] }).props.children[1];
        const headerStyle = Object.assign({}, ...header.props.style);
        assert.equal(headerStyle.flexWrap, 'wrap', 'total do dia deve ceder uma linha quando a fonte cresce');
        assert.ok(header.props.children[0].props.style.minWidth >= 180, 'data não vira uma coluna de dígitos ao lado do total');
        for (const tx of txs) {
          const link = ui.nodes().find(n => n.type === 'ItemLink' && n.props.title === tx.description);
          const row = link.props.children({ onLongPress() {} });
          assert.match(row.props.accessibilityLabel, new RegExp(`01/08/${tx.occurred_at.slice(0, 4)}`));
        }
      }
      applyListFilters(ui, {});
      assert.ok(sections().every((s: any) => !/202[67]/.test(s.title)), 'limpar conserva a apresentação do mês/ciclo');
      assert.ok(sections().every((s: any) => /agosto/.test(s.title)));
      if (recurringId) assert.deepEqual(copia(sections().map((s: any) => s.grupo).filter(Boolean)), ['A seguir', 'Anteriores']);
    }
  });
}

test('Lançamentos: consulta aberta não aguarda mês, ciclo ou resumo de outra janela', () => {
  for (const tablet of [false, true]) {
    const ui = screen(transacoesFile, { tablet, rangePending: true, cycleSeriesPending: true, resumoPendente: true });
    assert.equal(telaPronta(...ui.gates.at(-1)!), false, 'mês pendente é relevante antes de abrir intervalo');
    applyListFilters(ui, { to: '2026-10-31' });
    assert.equal(ui.transactionQueries.at(-1)?.pronto, true);
    assert.equal(telaPronta(...ui.gates.at(-1)!), true, 'consultas de outra janela não bloqueiam registros abertos');
    assert.ok(!ui.nodes().some(n => n.type === 'SkeletonRow'));
  }
});

test('Lançamentos: erro antigo de previsão não esconde vazio aberto nem cria retry; refresh consulta só registros', () => {
  for (const tablet of [false, true]) {
    for (const [value, wording] of [
      [{ from: '2026-08-01' }, /a partir de 01\/08\/2026/i],
      [{ to: '2026-10-31' }, /até 31\/10\/2026/i],
    ] as const) {
      const ui = screen(transacoesFile, { tablet, datasReais: true, txs: [], expectedError: true, rangeError: true });
      applyListFilters(ui, value);
      assert.ok(!ui.nodes().some(n => n.type === 'ErrorCard'), 'erro de consulta inativa não pertence à lista aberta');
      assert.ok(ui.nodes().some(n => n.type === 'EmptyState'));
      assert.match(filterScreenText(ui), wording);
      assert.doesNotMatch(filterScreenText(ui), /em A partir|em Até/);
      ui.nodes().find(n => n.type === 'SectionList').props.onRefresh();
      assert.deepEqual(ui.refetches, ['list'], 'refetch ignora enabled: não chamar resumo/previsões desativados');
    }
  }
});

test('Parceladas: filtrar quitadas expande resultados e oculta o resumo global; limpar restaura', () => {
  const ui = screen('src/app/finance/installments.tsx', { plans: [
    { id: 'active-filter', title: 'Computador ativo', account_id: null, active: true, total_cents: 10000, remaining_cents: 5000, first_occurred_at: '2026-09-01', parcels: [], installments: 5, paid: 0, installment_cents: 2000 },
    { id: 'done-filter', title: 'Geladeira quitada', account_id: null, active: false, total_cents: 30000, remaining_cents: 0, first_occurred_at: '2026-08-01', parcels: [], installments: 5, paid: 0, installment_cents: 2000 },
  ] });
  applyListFilters(ui, { selections: { estado: 'quitada' } });
  assert.match(filterScreenText(ui), /Filtros · 1/);
  assert.match(filterScreenText(ui), /Estado: Quitada/);
  assert.match(filterScreenText(ui), /Geladeira quitada/);
  assert.doesNotMatch(filterScreenText(ui), /Computador ativo/);
  assert.ok(!ui.nodes().some(n => n.props.label?.startsWith('Ver ') && n.props.label?.includes('terminada')));
  assert.doesNotMatch(filterScreenText(ui), /Nenhuma compra em andamento/);
  applyListFilters(ui, {});
  assert.match(filterScreenText(ui), /Computador ativo/);
});

test('Parceladas: busca e intervalo mostram compra terminada sem exigir expansão manual', () => {
  const ui = screen('src/app/finance/installments.tsx', { plans: [
    { id: 'done-text', title: 'Geladeira quitada', account_id: null, active: false, total_cents: 30000, remaining_cents: 0, first_occurred_at: '2026-08-01', parcels: [], installments: 5, paid: 0, installment_cents: 2000 },
  ] });
  applyListFilters(ui, { q: 'geladeira', from: '2026-08-01', to: '2026-08-01' });
  assert.match(filterScreenText(ui), /Geladeira quitada/);
  assert.doesNotMatch(filterScreenText(ui), /Ver 1 terminada/);
});

test('Recorrentes: encerrada e pausada têm resultados sem vazio de ativas nem resumo global', () => {
  const ui = screen('src/app/finance/recurring.tsx', { recurring: [
    { id: 'pause-filter', description: 'Seguro pausado', category: 'seguro', active: false, next_run_at: '2026-09-05T15:00:00Z' },
    { id: 'end-filter', description: 'Plano encerrado', category: 'saúde', active: false, end_date: '2026-08-01', next_run_at: '2026-08-01T15:00:00Z' },
  ] });
  applyListFilters(ui, { selections: { estado: 'encerrada' } });
  assert.match(filterScreenText(ui), /Filtros · 1/);
  assert.match(filterScreenText(ui), /Estado: Encerrada/);
  assert.match(filterScreenText(ui), /Plano encerrado/);
  assert.doesNotMatch(filterScreenText(ui), /Seguro pausado|Nada ativo se repetindo|Próximos 30 dias/);
  applyListFilters(ui, { selections: { estado: 'pausada' } });
  assert.match(filterScreenText(ui), /Seguro pausado/);
  assert.doesNotMatch(filterScreenText(ui), /Plano encerrado|Nada ativo se repetindo|Próximos 30 dias/);
});

test('Dívidas: busca, conta e primeiro vencimento filtram arquivos e abrem resultados; data nula não casa', () => {
  const base = { kind: 'financing', calculation_mode: 'fixed_installments', installments: 5, installments_paid: 0, installment_cents: 20000, remaining_cents: 100000, principal_cents: 100000, interest_rate_monthly: 0, account_id: null, due_day: 30, archived: false, first_due_date: '2026-09-30' };
  const ui = screen(debtsFile, { debts: [{ ...base, id: 'active-debt', name: 'Ativa' }], archivedDebts: [
    { ...base, id: 'archive-match', name: 'Carro arquivado', archived: true },
    { ...base, id: 'archive-legacy', name: 'Carro sem âncora', archived: true, first_due_date: null },
  ] });
  applyListFilters(ui, { q: 'Carro', from: '2026-09-30', to: '2026-09-30', selections: { conta: 'none', estado: 'arquivada' } });
  assert.match(filterScreenText(ui), /Filtros · 4/);
  assert.match(filterScreenText(ui), /Primeiro vencimento: 30\/09\/2026 · Busca: Carro · mais 2/);
  assert.ok(ui.nodes().some(n => /Conta: Sem conta · Estado: Arquivada/.test(n.props.accessibilityLabel ?? '')));
  assert.match(filterScreenText(ui), /Carro arquivado/);
  assert.doesNotMatch(filterScreenText(ui), /Carro sem âncora|Nenhuma dívida encontrada/);
  assert.ok(!ui.nodes().some(n => n.type === 'HeroLabel' && n.props.children === 'Devo no total'));
  applyListFilters(ui, { from: '2026-10-01' });
  assert.doesNotMatch(filterScreenText(ui), /Carro arquivado|Carro sem âncora/);
  assert.match(filterScreenText(ui), /Nenhuma dívida encontrada/);
});


test('Lançar: entrada paga é passado mesmo com zero prestações e rota passado=0', () => {
  for (const origem of ['divida', 'plano', 'transacao']) {
    const ui = screen(lancarFile, { params: { tipo: origem === 'divida' ? 'financiamento' : 'uma', id: 'origem', origem, passado: '0' },
      downPayment: { id: 'entrada', amount_cents: 20000, occurred_at: '2026-09-01', account_id: 'cc', status: 'cleared', description: 'Entrada' },
      txs: [{ id: 'origem', installment_plan_id: origem === 'transacao' ? 'plano' : null, status: 'pending' }], plans: [{ id: origem === 'plano' ? 'origem' : 'plano', paid: 0, locked: 0 }],
      debts: [{ id: 'origem', installments_paid: 0 }] });
    ui.interact(() => ui.nodes().find(n => n.type === 'FormatoDoLancamento').props.onChange('recorrente'));
    ui.interact(() => ui.nodes().find(n => n.type === 'FormularioDaSerie').props.converter({ tipo: 'recorrente', dados: {} }));
    assert.equal(ui.actions.some(a => a.label === 'Converter'), false, origem);
    ui.interact(() => ui.actions.find(a => a.label === 'Todas, apagando as anteriores')!.onPress());
    assert.equal(ui.writes.length, 0, 'aguarda confirmação destrutiva');
    assert.equal(ui.confirmations.length, 1);
    assert.match(ui.avisos[0], /entrada/i);
  }
});

test('Lançar: consulta da entrada pendente ou com erro não permite converter sem conhecer o histórico', () => {
  for (const state of [{ downPaymentPending: true }, { downPaymentError: true }]) {
    const ui = screen(lancarFile, { ...state, params: { tipo: 'financiamento', id: 'd1', origem: 'divida', passado: '0' }, debts: [{ id: 'd1', installments_paid: 0 }] });
    ui.interact(() => ui.nodes().find(n => n.type === 'FormatoDoLancamento').props.onChange('recorrente'));
    const body = ui.nodes().find(n => n.type === 'FormularioDaSerie');
    ui.interact(() => body.props.converter({ tipo: 'recorrente', dados: {} }));
    assert.equal(ui.actions.length, 0);
    assert.equal(ui.writes.length, 0);
    if (state.downPaymentPending) assert.equal(body.props.salvando, true);
    else { assert.equal(ui.toasts.length, 1); assert.deepEqual(ui.refetches, ['down-payment']); }
  }
});


test('Lançar: dívida/transação/plano ainda pendentes ou com erro não autorizam apagar histórico', () => {
  for (const [origem, flag, consulta] of [
    ['divida', 'debtsPending', 'debts'], ['divida', 'debtsError', 'debts'],
    ['transacao', 'txPending', 'transaction'], ['transacao', 'txError', 'transaction'],
    ['plano', 'plansPending', 'plan'], ['plano', 'plansError', 'plan'],
  ]) {
    const ui = screen(lancarFile, { [flag]: true, params: { tipo: origem === 'divida' ? 'financiamento' : 'uma', id: 'origem', origem, passado: '0' }, debts: [{ id: 'origem', installments_paid: 0 }], txs: [{ id: 'origem', status: 'cleared' }], plans: [{ id: 'origem', locked: 0 }] });
    ui.interact(() => ui.nodes().find(n => n.type === 'FormatoDoLancamento').props.onChange('recorrente'));
    const body = ui.nodes().find(n => n.type === 'FormularioDaSerie');
    ui.interact(() => body.props.converter({ tipo: 'recorrente', dados: {} }));
    assert.equal(ui.actions.length, 0, flag);
    assert.equal(ui.writes.length, 0);
    if (flag.endsWith('Pending')) assert.equal(body.props.salvando, true);
    else { assert.equal(ui.toasts.length, 1); assert.ok(ui.refetches.includes(consulta)); }
  }
});

test('Lançar: parcela histórica carregada supera passado=0 mesmo sem entrada', () => {
  for (const origem of ['plano', 'transacao']) {
    const ui = screen(lancarFile, { params: { tipo: 'uma', id: 'origem', origem, passado: '0', papel: origem === 'plano' ? 'registro' : 'parcela' }, plans: [{ id: origem === 'plano' ? 'origem' : 'plano', paid: 1, locked: 1 }], txs: [{ id: 'origem', installment_plan_id: 'plano' }] });
    ui.interact(() => ui.nodes().find(n => n.type === 'FormatoDoLancamento').props.onChange('recorrente'));
    ui.interact(() => ui.nodes().find(n => n.type === 'FormularioDaSerie').props.converter({ tipo: 'recorrente', dados: {} }));
    assert.equal(ui.actions.some(a => a.label === 'Converter'), false);
    ui.interact(() => ui.actions.find(a => a.label === 'Todas, apagando as anteriores')!.onPress());
    assert.equal(ui.writes.length, 0);
    assert.equal(ui.confirmations.length, 1);
  }
});

test('conta recusa centavos fracionários, não finitos e acima do inteiro seguro antes de gravar', () => {
  const ui = screen('src/app/finance/accounts.tsx', { params: { create: '1' } });
  ui.fill('Nome', 'Conta segura');
  for (const value of [1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, -1]) {
    ui.fill('Saldo atual', value);
    assert.equal(ui.button('Salvar').props.disabled, true, `saldo inválido ${value}`);
  }
  ui.fill('Saldo atual', 0);
  assert.equal(ui.button('Salvar').props.disabled, false);
});

test('editar cartão com dívida não altera o saldo inicial pelo saldo negativo da fatura', () => {
  const card = { id: 'c1', name: 'Cartão', type: 'credit_card', initial_balance_cents: 0, closing_day: 3, due_day: 10, credit_limit_cents: 500000, payment_account_id: null };
  const ui = screen('src/app/finance/accounts.tsx', {
    params: { edit: 'c1' }, forecastAccounts: [card],
    balances: [{ account_id: 'c1', name: 'Cartão', type: 'credit_card', balance_cents: -45000, cleared_cents: 0, pending_in_cents: 0, pending_out_cents: 45000 }],
  });
  ui.press('Salvar');
  assert.equal(ui.writes.at(-1).value.initial_balance_cents, 0);
});


test('campos compartilhados respeitam tipos elegíveis e travam todos os valores sem criar conta pagadora', () => {
  const changes: any[] = [];
  const form = { name: 'Card', type: 'credit_card', saldoCents: 0, negativo: false, base: null, originalInitialBalanceCents: null, closingDay: '3', dueDay: '10', limitCents: 50000, payerId: null, fechamentoInclusivo: false, rotativoAuto: false, rotativoRate: '' };
  const ui = screen('src/components/finance/account-form.tsx', { componente: 'AccountFormFields', props: {
    form, onChange: (next: any) => changes.push(next), accounts: [
      { id: 'payer', name: 'Bank', type: 'checking' }, { id: 'card', name: 'Other card', type: 'credit_card' },
    ], allowedTypes: ['credit_card'], disabled: true, autoFocus: false,
  } });
  const fields = ui.nodes().filter((n: any) => n.type === 'Field');
  assert.deepEqual(fields.map((n: any) => n.props.label), ['Nome', 'Tipo', 'Limite do cartão', 'Fecha dia', 'Vence dia', 'Compra no dia do fechamento', 'Juros do rotativo (% ao mês)', 'Conta que paga a fatura']);
  assert.ok(ui.nodes().filter((n: any) => n.type === 'TextField').every((n: any) => n.props.editable === false));
  assert.equal(ui.nodes().find((n: any) => n.type === 'MoneyField').props.readOnly, true);
  const type = ui.nodes().find((n: any) => n.type === 'SelectField');
  assert.equal(type.props.disabled, true);
  assert.deepEqual(JSON.parse(JSON.stringify(type.props.options.map((o: any) => o.id))), ['credit_card']);
  const payer = ui.nodes().find((n: any) => n.type === 'AccountPicker');
  assert.equal(payer.props.disabled, true);
  assert.equal(payer.props.creationActions, undefined);
  assert.deepEqual(Array.from(payer.props.accounts, (a: any) => a.id), ['payer']);
  ui.fill('Nome', 'Ignored');
  ui.interact((nodes: any[]) => nodes.find((n: any) => n.type === 'SwitchRow').props.onValueChange(true));
  assert.equal(changes.length, 0);
});

test('contas usa criação idempotente e recusa toque duplo no mesmo formulário', () => {
  const ui = screen('src/app/finance/accounts.tsx', { params: { create: '1' } });
  ui.fill('Nome', 'Bank');
  const save = ui.button('Salvar').props.onPress;
  ui.interact(() => { save(); save(); });
  assert.equal(ui.pedidos.length, 1);
  assert.equal(ui.pedidos[0].operation, 'createAccount');
  assert.equal(ui.pedidos[0].value.name, 'Bank');
});

test('sucesso de uma criação fechada não fecha nem anuncia sucesso de uma nova abertura', () => {
  const ui = screen('src/app/finance/accounts.tsx', { params: {} });
  ui.press('Nova conta');
  ui.fill('Nome', 'Original');
  ui.press('Salvar');
  const first = ui.pedidos.at(-1);
  ui.interact((nodes: any[]) => nodes.find((n: any) => n.type === 'TaskHeader').props.onClose());
  ui.press('Nova conta');
  ui.fill('Nome', 'New');
  ui.interact(() => first.opts.onSuccess({ id: 'first', availability: 'active' }));
  assert.ok(ui.nodes().some((n: any) => n.type === 'Sheet' && n.props.visible));
  assert.equal(ui.nodes().find((n: any) => n.type === 'TextField').props.value, 'New');
  assert.equal(ui.toasts.length, 0);
});


test('cadastro de origem bloqueia salvar dos três corpos sem anunciar mutação em andamento', () => {
  const base = { registrarComum: () => {}, registrarEstado: () => {}, onSalvo: () => {}, onFechar: () => {}, salvarBloqueado: true };
  const comum = { kind: 'expense', descricao: 'Academia', valorCents: 5000, contaId: null, dataBR: '06/10/2026', categoria: null };
  for (const [file, componente, topLabel] of [
    ['formulario-do-lancamento', 'FormularioDoLancamento', 'Salvar'],
    ['formulario-da-serie', 'FormularioDaSerie', 'Criar'],
    ['formulario-da-divida', 'FormularioDaDivida', 'Salvar'],
  ]) {
    const ui = screen(`src/components/finance/${file}.tsx`, { componente, props: { ...base, comum } });
    if (componente === 'FormularioDaDivida') ui.fill('Total de parcelas', '48');
    for (const label of [topLabel, 'Salvar e criar outro']) {
      const button = ui.button(label);
      assert.equal(button.props.disabled, true, `${componente}: ${label} bloqueado`);
      assert.ok(!button.props.loading, `${componente}: cadastro aberto não é gravação`);
      ui.interact(() => button.props.onPress());
    }
    assert.equal(ui.writes.length, 0, `${componente}: handler bloqueado não grava`);
  }
});

test('callback capturado antes do cadastro não grava enquanto salvarBloqueado estiver ativo', () => {
  const comum = { kind: 'expense', descricao: 'Academia', valorCents: 5000, contaId: null, dataBR: '06/10/2026', categoria: null };
  const base = { comum, registrarComum: () => {}, registrarEstado: () => {}, onSalvo: () => {}, onFechar: () => {}, salvarBloqueado: false };
  for (const [file, componente, topLabel] of [
    ['formulario-do-lancamento', 'FormularioDoLancamento', 'Salvar'],
    ['formulario-da-serie', 'FormularioDaSerie', 'Criar'],
    ['formulario-da-divida', 'FormularioDaDivida', 'Salvar'],
  ]) {
    const options = { componente, executarEfeitos: true, props: { ...base } };
    const ui = screen(`src/components/finance/${file}.tsx`, options);
    if (componente === 'FormularioDaDivida') ui.fill('Total de parcelas', '48');
    const captured = [ui.button(topLabel), ui.button('Salvar e criar outro')];
    assert.ok(captured.every((button) => !button.props.disabled), `${componente}: fixture habilitada`);
    options.props = { ...options.props, salvarBloqueado: true };
    ui.interact(() => {});
    for (const button of captured) ui.interact(() => button.props.onPress());
    assert.equal(ui.writes.length, 0, `${componente}: callback anterior respeita o bloqueio atual`);
    options.props = { ...options.props, salvarBloqueado: false };
    ui.interact(() => {});
    ui.press(topLabel);
    assert.equal(ui.writes.length, 1, `${componente}: desbloqueado volta a salvar`);
  }
});

test('gravação real continua carregando nos três corpos, separada do bloqueio do cadastro', () => {
  const comum = { kind: 'expense', descricao: 'Academia', valorCents: 5000, contaId: null, dataBR: '06/10/2026', categoria: null };
  for (const [file, componente, label] of [
    ['formulario-do-lancamento', 'FormularioDoLancamento', 'Salvando…'],
    ['formulario-da-serie', 'FormularioDaSerie', 'Criar'],
    ['formulario-da-divida', 'FormularioDaDivida', 'Salvar'],
  ]) {
    const ui = screen(`src/components/finance/${file}.tsx`, { componente, props: {
      comum, registrarComum: () => {}, registrarEstado: () => {}, onSalvo: () => {}, onFechar: () => {},
      salvando: true, salvarBloqueado: false,
    } });
    assert.equal(ui.button(label).props.loading, true, `${componente}: mutação real mantém o progresso`);
    assert.equal(ui.button(label).props.disabled, true);
    assert.equal(ui.button('Salvar e criar outro').props.disabled, true);
  }
});
// The real series editor must bind its diff and CAS to the record opened by the user.
const f06SeriesBaselineFixture = () => ({
  id: 'f06-series', workspace_id: 'workspace-1', kind: 'expense', amount_cents: 5000,
  description: 'Academia', merchant: null, category: null, account_id: null, payment_method: null,
  rrule: 'FREQ=MONTHLY;BYMONTHDAY=6', next_run_at: '2026-10-06T12:00:00Z',
  dtstart: '2026-09-06T12:00:00Z', active: true, end_date: null, auto_confirm: false,
  edit_revision: 7, expense_pattern: 'fixed', expense_pattern_source: 'explicit',
  expense_necessity: 'essential', expense_necessity_source: 'explicit',
});

function f06SeriesBaselineOptions(recurring = [f06SeriesBaselineFixture()], extraProps: Record<string, unknown> = {}) {
  return { componente: 'FormularioDaSerie', executarEfeitos: true, recurring, props: {
    comum: { kind: 'expense', descricao: '', valorCents: 0, contaId: null, dataBR: '', categoria: null },
    editandoId: 'f06-series', registrarComum: () => {}, registrarEstado: () => {},
    onSalvo: () => {}, onFechar: () => {}, ...extraProps,
  } };
}

const f06SaveSeriesScope = (ui: ReturnType<typeof screen>, scope: 'future' | 'all') => {
  ui.press('Salvar');
  const action = ui.actions.findLast(a => a.label === (scope === 'all' ? 'Todas' : 'Esta e próximas'));
  assert.ok(action, 'edição de série oferece o alcance solicitado');
  ui.interact(() => action.onPress());
  assert.equal(ui.writes.at(-1)?.operation, scope === 'all' ? 'saveRecurringAll' : 'saveRecurringSeries');
  return copia(ui.writes.at(-1)!.value);
};

test('F06 baseline da série: aceita estadoGuardado legado com campos planos', () => {
  const legacy = { id: 'f06-series', kind: 'expense', amountCents: 5000,
    description: 'Rascunho legado', merchant: '', category: null, accountId: null, paymentMethod: null,
    preset: 'monthly', intervalo: '1', inicio: '06/10/2026', fim: '', autoConfirm: false,
    expenseClassification: { expense_pattern: 'fixed', expense_pattern_source: 'explicit',
      expense_necessity: 'essential', expense_necessity_source: 'explicit' },
  };
  const ui = screen('src/components/finance/formulario-da-serie.tsx', f06SeriesBaselineOptions(undefined, { estadoGuardado: legacy }));
  const value = f06SaveSeriesScope(ui, 'future');
  assert.deepEqual(value.patch, { description: 'Rascunho legado' });
  assert.equal(value.expectedRevision, 7);
});

for (const scope of ['future', 'all'] as const) {
  test(`F06 baseline da série: realtime não transforma classificação concorrente em edição (${scope})`, () => {
    const options = f06SeriesBaselineOptions();
    const ui = screen('src/components/finance/formulario-da-serie.tsx', options);
    options.recurring = [{ ...f06SeriesBaselineFixture(), edit_revision: 8,
      expense_necessity: 'discretionary', amount_cents: 9000, merchant: 'Outra unidade' }];
    ui.interact(() => {});
    ui.fill('Título', 'Academia corrigida');
    const value = f06SaveSeriesScope(ui, scope);
    assert.deepEqual(scope === 'all' ? value.seriesPatch : value.patch, { description: 'Academia corrigida' });
    if (scope === 'all') assert.deepEqual(value.linePatch, { description: 'Academia corrigida' });
    assert.equal(value.expectedRevision, 7, 'CAS usa a revisão aberta, para recusar a edição concorrente');
  });

  test(`F06 baseline da série: resposta perdida e realtime conservam intenção no retry (${scope})`, () => {
    const options = f06SeriesBaselineOptions();
    const ui = screen('src/components/finance/formulario-da-serie.tsx', options);
    ui.fill('Título', 'Academia corrigida');
    const first = f06SaveSeriesScope(ui, scope);
    ui.interact(() => ui.pedidos.at(-1)!.opts.onError(new Error('Resposta perdida')));
    options.recurring = [{ ...f06SeriesBaselineFixture(), description: 'Academia corrigida',
      edit_revision: 8, expense_necessity: 'discretionary' }];
    ui.interact(() => {});
    const retry = f06SaveSeriesScope(ui, scope);
    assert.deepEqual(retry, first, 'mesmos patch, revisão e requestId, mesmo que o realtime reflita a gravação');
    assert.equal(retry.expectedRevision, 7);
  });

  test(`F06 baseline da série: estadoGuardado preserva o registro inicial depois de remontar (${scope})`, () => {
    let readSaved: (() => unknown) | undefined;
    const options = f06SeriesBaselineOptions(undefined, { registrarEstado: (read: () => unknown) => { readSaved = read; } });
    const ui = screen('src/components/finance/formulario-da-serie.tsx', options);
    ui.fill('Título', 'Academia corrigida');
    assert.ok(readSaved, 'o corpo registra seu estado no hospedeiro');
    const estadoGuardado = readSaved();
    ui.desmontar();
    const updated = { ...f06SeriesBaselineFixture(), edit_revision: 8, expense_necessity: 'discretionary' };
    const reopened = screen('src/components/finance/formulario-da-serie.tsx', f06SeriesBaselineOptions([updated], { estadoGuardado }));
    const value = f06SaveSeriesScope(reopened, scope);
    assert.deepEqual(scope === 'all' ? value.seriesPatch : value.patch, { description: 'Academia corrigida' });
    assert.equal(value.expectedRevision, 7);
  });
}

// A format-switch draft carries classification separately from the new debt's category UI.
const f06DebtCategory = 'qa f06 ios padrão';
const f06DebtDefaultClassification = {
  expense_pattern: 'variable', expense_pattern_source: 'category_default',
  expense_necessity: 'discretionary', expense_necessity_source: 'category_default',
};
const f06DebtDefaults = [{ category: f06DebtCategory,
  default_expense_pattern: 'variable', default_expense_necessity: 'discretionary' }];
const f06DebtCommon = (expenseClassification = f06DebtDefaultClassification) => ({
  kind: 'expense', descricao: 'Financiamento após trocar formato', valorCents: 5000,
  contaId: null, dataBR: '06/10/2026', categoria: f06DebtCategory, expenseClassification,
});
const f06DebtClassification = (ui: ReturnType<typeof screen>) =>
  copia(ui.nodes().find(n => n.type === 'ExpenseClassificationField').props.value);
const f06DebtPreview = (ui: ReturnType<typeof screen>) =>
  copia(ui.nodes().find(n => n.type === 'FinanceWritePreview').props.write);
const f06ReadClassification = (value: Record<string, unknown>) => Object.fromEntries(
  ['expense_pattern', 'expense_pattern_source', 'expense_necessity', 'expense_necessity_source'].map(k => [k, value[k]]));

for (const [name, expenseClassification] of [
  ['padrões da categoria', f06DebtDefaultClassification],
  ['previsibilidade manual sem classificação', { ...f06DebtDefaultClassification, expense_pattern: null, expense_pattern_source: 'explicit' }],
  ['necessidade manual sem classificação', { ...f06DebtDefaultClassification, expense_necessity: null, expense_necessity_source: 'explicit' }],
  ['previsibilidade explícita', { ...f06DebtDefaultClassification, expense_pattern: 'fixed', expense_pattern_source: 'explicit' }],
] as const) {
  test(`F06 formato financiamento: conserva ${name} no campo, prévia e salvar`, () => {
    let readCommon: (() => unknown) | undefined;
    const ui = formDivida({ executarEfeitos: true, categoryDefaults: f06DebtDefaults, categoryDefaultsCached: true }, {
      comum: f06DebtCommon(expenseClassification as any),
      registrarComum: (read: () => unknown) => { readCommon = read; },
    });
    assert.deepEqual(f06DebtClassification(ui), expenseClassification);
    ui.fill('Total de parcelas', '12');
    const preview = f06DebtPreview(ui);
    assert.deepEqual(f06ReadClassification(preview.args.p_dados), expenseClassification);
    assert.ok(readCommon);
    assert.deepEqual(copia((readCommon() as any).expenseClassification), expenseClassification, 'retornar a outro formato recebe o mesmo snapshot');
    ui.press('Salvar');
    assert.equal(ui.writes.at(-1)!.operation, 'saveDebt');
    assert.deepEqual(f06ReadClassification(copia(ui.writes.at(-1)!.value)), expenseClassification);
    assert.equal(ui.nodes().filter(n => n.type === 'Field').map(n => n.props.label).includes('Categoria'), false);
  });
}

for (const failure of ['pending', 'error'] as const) {
  test(`F06 formato financiamento: consulta de padrões ${failure} bloqueia criação e prévia`, () => {
    const options = { componente: 'FormularioDaDivida', categoryDefaults: f06DebtDefaults,
      categoryDefaultsPending: failure === 'pending', categoryDefaultsError: failure === 'error',
      props: { comum: f06DebtCommon(), registrarComum: () => {}, registrarEstado: () => {}, onSalvo: () => {}, onFechar: () => {} } };
    const ui = screen('src/components/finance/formulario-da-divida.tsx', options);
    ui.fill('Total de parcelas', '12');
    assert.equal(ui.button('Salvar').props.disabled, true);
    assert.equal(ui.button('Salvar e criar outro').props.disabled, true);
    assert.equal(f06DebtPreview(ui), null);
    ui.interact(() => ui.button('Salvar').props.onPress());
    assert.equal(ui.writes.length, 0, 'handler também não grava enquanto padrões não estão conferidos');
    if (failure === 'error') {
      const band = ui.nodes().find(n => n.type?.name === 'ErrorBand');
      assert.ok(band, 'falha de padrões oferece uma recuperação visível');
      ui.interact(() => band.props.onRetry());
      assert.deepEqual(ui.refetches, ['category-defaults']);
    }
    options.categoryDefaultsPending = false;
    options.categoryDefaultsError = false;
    ui.interact(() => {});
    assert.equal(ui.button('Salvar').props.disabled, false);
    assert.deepEqual(f06ReadClassification(f06DebtPreview(ui).args.p_dados), f06DebtDefaultClassification);
  });
}

for (const proof of ['sem categoria', 'sem workspace', 'com workspace próprio'] as const) {
  test(`F06 formato financiamento: editar ${proof} nunca adota categoria comum implicitamente`, () => {
    const original = { ...carro, installments_paid: 0, payment_category: proof === 'sem categoria' ? null : f06DebtCategory,
      ...(proof === 'sem workspace' ? {} : { workspace_id: 'contract-workspace' }) };
    const ui = formDivida({ executarEfeitos: true, debts: [original], categoryDefaults: f06DebtDefaults,
      categoryDefaultsCached: true, categoryDefaultsError: proof === 'com workspace próprio' },
    { editandoId: original.id, comum: f06DebtCommon() });
    assert.deepEqual(f06DebtClassification(ui), { expense_pattern: null, expense_pattern_source: null,
      expense_necessity: null, expense_necessity_source: null });
    assert.deepEqual(ui.categoryDefaultsQueries.at(-1), { workspaceId: proof === 'sem workspace' ? undefined : 'contract-workspace',
      enabled: proof === 'com workspace próprio' }, 'consulta usa somente a prova de categoria e workspace do contrato');
    assert.equal(ui.nodes().find(n => n.type === 'ExpenseClassificationField').props.defaults, undefined,
      'cache do workspace padrão não pode oferecer adoção sem prova do workspace original');
    ui.fill('Nome', 'Contrato corrigido');
    ui.press('Salvar');
    assert.equal(ui.writes.at(-1)!.operation, 'saveDebtContractScoped');
    assert.ok(!Object.keys(ui.writes.at(-1)!.value.patch).some(k => k.startsWith('expense_')), 'erro de defaults não impede edição nem preenche legado');
  });
}

// Round-trip uses the real host plus separately mounted real form bodies. This retains
// each React mount's own hook state while native components/queries stay isolated.
const f06RoundTripPreviewInput = (ui: ReturnType<typeof screen>) => {
  const write = f06DebtPreview(ui);
  assert.ok(write, 'rascunho válido apresenta prévia financeira');
  return write.args.p_input ?? write.args.p_dados;
};
const f06RoundTripFormats = {
  uma: { file: 'formulario-do-lancamento', component: 'FormularioDoLancamento', title: 'Título', save: 'Salvar' },
  recorrente: { file: 'formulario-da-serie', component: 'FormularioDaSerie', title: 'Título', save: 'Criar' },
  financiamento: { file: 'formulario-da-divida', component: 'FormularioDaDivida', title: 'Nome', save: 'Salvar' },
};
function f06RoundTripHost(initial: keyof typeof f06RoundTripFormats, extra: Parameters<typeof screen>[1] = {}) {
  const host = screen(lancarFile, { executarEfeitos: true,
    params: { tipo: initial, description: 'Compra', amount: '5000', data: '06/10/2026', category: f06DebtCategory }, ...extra });
  let readCommon: () => any;
  const mount = () => {
    const body = host.nodes().find(n => Object.values(f06RoundTripFormats).some(f => f.component === n.type || n.type === 'LancamentoEditando'));
    assert.ok(body, 'host publica um corpo ativo');
    const format = Object.entries(f06RoundTripFormats).find(([, f]) => f.component === body.type)?.[0] as keyof typeof f06RoundTripFormats
      ?? 'uma';
    const spec = f06RoundTripFormats[format];
    const ui = screen(`src/components/finance/${spec.file}.tsx`, { executarEfeitos: true,
      categoryDefaults: f06DebtDefaults, categoryDefaultsCached: true, ...extra,
      componente: spec.component, props: { ...body.props, registrarComum: (read: () => any) => {
        readCommon = read; body.props.registrarComum(read);
      } } });
    return { ui, spec, common: () => copia(readCommon()) };
  };
  let active = mount();
  return {
    get active() { return active; },
    switchTo(format: keyof typeof f06RoundTripFormats) {
      host.interact(() => host.nodes().find(n => n.type === 'FormatoDoLancamento').props.onChange(format));
      active.ui.desmontar();
      active = mount();
      return active;
    },
  };
}

const f06RoundTripChoices = [
  ['previsibilidade NULL explícita', { ...f06DebtDefaultClassification, expense_pattern: null, expense_pattern_source: 'explicit' }],
  ['necessidade NULL explícita', { ...f06DebtDefaultClassification, expense_necessity: null, expense_necessity_source: 'explicit' }],
  ['previsibilidade explícita', { ...f06DebtDefaultClassification, expense_pattern: 'fixed', expense_pattern_source: 'explicit' }],
  ['necessidade explícita', { ...f06DebtDefaultClassification, expense_necessity: 'essential', expense_necessity_source: 'explicit' }],
] as const;
for (const initial of Object.keys(f06RoundTripFormats) as (keyof typeof f06RoundTripFormats)[]) {
  for (const [choice, wanted] of f06RoundTripChoices) {
    test(`F06 volta de formato: ${initial} conserva ${choice} em todos os formatos visitados`, () => {
      const order = [initial, ...Object.keys(f06RoundTripFormats).filter(f => f !== initial)] as (keyof typeof f06RoundTripFormats)[];
      const flow = f06RoundTripHost(initial);
      for (const [index, format] of order.entries()) {
        const { ui, spec } = index ? flow.switchTo(format) : flow.active;
        ui.fill(spec.title, `Título próprio ${format}`);
        if (format === 'financiamento') ui.fill('Total de parcelas', '12');
      }
      flow.active.ui.interact(nodes => { const field = nodes.find(n => n.type === 'ExpenseClassificationField');
        field.props.onChange(Object.assign(field.props.value, wanted)); });
      for (const format of order) {
        const { ui, spec, common } = flow.switchTo(format);
        assert.deepEqual(f06DebtClassification(ui), wanted, 'campo conserva a intenção mais recente');
        assert.deepEqual(common().expenseClassification, wanted, 'próxima troca lê a mesma intenção');
        assert.equal(common().descricao, `Título próprio ${format}`, 'campos próprios conservam a precedência anterior');
        assert.deepEqual(f06ReadClassification(f06RoundTripPreviewInput(ui)), wanted, 'prévia usa o snapshot exibido');
        ui.press(spec.save);
        assert.equal(ui.writes.length, 1, 'formulário realmente submete o rascunho');
        assert.deepEqual(f06ReadClassification(copia(ui.writes.at(-1)!.value)), wanted, 'gravação usa o snapshot exibido');
      }
    });
  }
}

for (const format of ['uma', 'recorrente'] as const) {
  test(`F06 volta de formato: ${format} recalcula apenas sugestões para a categoria própria restaurada`, () => {
    const flow = f06RoundTripHost(format, { categoryDefaults: [...f06DebtDefaults, { category: 'Outra categoria',
      default_expense_pattern: 'fixed', default_expense_necessity: 'essential' }] });
    flow.switchTo(format === 'uma' ? 'recorrente' : 'uma');
    flow.active.ui.interact(nodes => nodes.find(n => n.type === 'CategoryPicker').props.onChange('Outra categoria'));
    const wanted = { expense_pattern: null, expense_pattern_source: 'explicit',
      expense_necessity: 'essential', expense_necessity_source: 'category_default' };
    flow.active.ui.interact(nodes => { const field = nodes.find(n => n.type === 'ExpenseClassificationField');
        field.props.onChange(Object.assign(field.props.value, wanted)); });
    const restored = flow.switchTo(format);
    assert.equal(restored.common().categoria, f06DebtCategory, 'restauração mantém a categoria própria');
    const expected = { ...wanted, expense_necessity: 'discretionary' };
    assert.deepEqual(f06DebtClassification(restored.ui), expected, 'NULL manual vence; sugestão pertence à categoria exibida');
    assert.deepEqual(f06ReadClassification(f06RoundTripPreviewInput(restored.ui)), expected);
  });
}

for (const scope of ['future', 'all'] as const) {
  test(`F06 volta de formato: série adota último padrão escolhido sem substituir baseline congelado (${scope})`, () => {
    let readSaved: () => any;
    const ui = screen('src/components/finance/formulario-da-serie.tsx', f06SeriesBaselineOptions(undefined,
      { registrarEstado: (read: () => any) => { readSaved = read; } }));
    ui.fill('Título', 'Academia corrigida');
    const saved = readSaved();
    ui.desmontar();
    const latest = { expense_pattern: 'variable', expense_pattern_source: 'category_default',
      expense_necessity: null, expense_necessity_source: 'explicit' };
    const reopened = screen('src/components/finance/formulario-da-serie.tsx', f06SeriesBaselineOptions(
      [{ ...f06SeriesBaselineFixture(), edit_revision: 8, expense_pattern: 'variable' }],
      { estadoGuardado: saved, comum: { ...f06DebtCommon(), expenseClassification: latest } }));
    assert.deepEqual(f06DebtClassification(reopened), latest, 'ação explícita de adotar padrão também viaja');
    const write = f06SaveSeriesScope(reopened, scope);
    assert.equal(write.expectedRevision, 7);
    const expected = { description: 'Academia corrigida', ...latest };
    assert.deepEqual(scope === 'all' ? write.seriesPatch : write.patch, expected);
    if (scope === 'all') assert.deepEqual(write.linePatch, expected);
  });
}


test('F06 extracted controls preserve labels, options and whitelist each independent dimension', () => {
  const patterns: any[] = []; const necessities: any[] = [];
  const ui = screen('src/components/finance/expense-classification-controls.tsx', {
    componente: 'ExpenseClassificationControls', props: { pattern: 'variable', necessity: 'essential',
      onPatternChange: (value: any) => patterns.push(value), onNecessityChange: (value: any) => necessities.push(value) },
  });
  const fields = ui.nodes().filter((n: any) => n.type === 'Field');
  assert.deepEqual(fields.map((n: any) => n.props.label), ['Previsibilidade', 'Necessidade']);
  assert.equal(fields[0].props.hint, 'Fixo é previsível; variável pode mudar. Isso não define a repetição.');
  assert.equal(fields[1].props.hint, 'Essencial ou não essencial depende das suas necessidades, não da frequência.');
  const selects = fields.map((n: any) => n.props.children.props);
  assert.deepEqual(JSON.parse(JSON.stringify(selects[0].options)), [{ id: null, label: 'Não classificar', neutral: true }, { id: 'fixed', label: 'Fixo' }, { id: 'variable', label: 'Variável' }]);
  assert.deepEqual(JSON.parse(JSON.stringify(selects[1].options)), [{ id: null, label: 'Não classificar', neutral: true }, { id: 'essential', label: 'Essencial' }, { id: 'discretionary', label: 'Não essencial' }]);
  for (const id of ['essential', 'discretionary', 'income', undefined, 0, {}]) selects[0].onChange(id);
  for (const id of ['fixed', 'variable', 'income', undefined, 0, {}]) selects[1].onChange(id);
  assert.deepEqual(patterns, []); assert.deepEqual(necessities, []);
  for (const id of [null, 'fixed', 'variable']) selects[0].onChange(id);
  assert.deepEqual(patterns, [null, 'fixed', 'variable']); assert.deepEqual(necessities, []);
  for (const id of [null, 'essential', 'discretionary']) selects[1].onChange(id);
  assert.deepEqual(necessities, [null, 'essential', 'discretionary']);
});


const f07Workspace = '10000000-0000-4000-8000-000000000001';
const f07Account = '10000000-0000-4000-8000-000000000002';
function f07State(configured = false): any {
  return {
    workspace_id: f07Workspace, workspace_name: 'QA reserva', as_of: '2026-10-03',
    config: configured ? { base_mode: 'manual', manual_monthly_cents: 10000, target_months: 6, edit_revision: 4 } : null,
    sources: [{ kind: 'account', id: f07Account, name: 'Conta QA reserva', eligible: true, archived: false,
      available_cents: 100000, other_allocated_cents: 0, allocated_cents: configured ? 30000 : 0,
      effective_cents: configured ? 30000 : 0, liquidity_confirmed: configured, valuation_date: null }],
    months: ['2026-07-01','2026-08-01','2026-09-01'].map(month => ({ month, expense_count: 0,
      essential_cents: 0, unclassified_count: 0, unclassified_cents: 0, fingerprint: 'a'.repeat(32), reviewed: false })),
    unassigned_goals_cents: 0,
  };
}
const f07Screen = 'src/app/finance/net-worth.tsx';
test('F07: reserva nova explica configuração, base zero não salva e cancelamento não cria saldo', () => {
  const ui = screen(f07Screen, { reserveState: f07State() });
  ui.press('Configurar reserva');
  assert.equal(ui.button('Salvar reserva').props.disabled, true);
  ui.fill('Essenciais por mês', 10000);
  ui.press('Salvar reserva');
  assert.deepEqual(copia(ui.writes.at(-1)), { operation: 'saveEmergencyReserve', value: {
    workspace_id: f07Workspace, expected_revision: null, base_mode: 'manual', manual_monthly_cents: 10000,
    target_months: 6, unassigned_goals_ack_cents: 0, allocations: [], reviewed_months: [],
  } });
  const cancel = screen(f07Screen, { reserveState: f07State() });
  cancel.press('Configurar reserva'); cancel.fill('Essenciais por mês', 10000);
  const header = cancel.nodes().find(n => n.type === 'TaskHeader' && n.props.title === 'Reserva de emergência');
  assert.ok(header);cancel.interact(() => header.props.onClose());assert.equal(cancel.writes.length,0);
});
test('F07: erro de reserva com cache anterior oculta cobertura e refaz somente sua consulta', async () => {
  const ui = screen(f07Screen, { reserveState: f07State(true), reserveError: true });
  assert.equal(ui.nodes().filter(n => n.type === 'Money' && n.props.cents === 30000).length,0);
  const error = ui.nodes().find(n => n.type === 'ErrorCard');assert.ok(error);
  await error.props.onRetry();assert.ok(ui.refetches.includes('emergency-reserve'));
  assert.equal(ui.nodes().some(n => n.type === 'Button' && n.props.label === 'Editar reserva'),false);
});
test('F07: atualização em background não substitui revisão e valores do editor aberto', () => {
  const state = f07State(true);const ui = screen(f07Screen,{reserveState:state});
  ui.press('Editar reserva');ui.fill('Essenciais por mês',12000);
  state.config.manual_monthly_cents=19000;state.config.edit_revision=5;
  ui.interact(() => {});ui.press('Salvar reserva');
  assert.equal(ui.writes.at(-1)?.value.expected_revision,4);
  assert.equal(ui.writes.at(-1)?.value.manual_monthly_cents,12000);
  assert.equal(ui.writes.at(-1)?.value.allocations[0].amount_cents,30000);
});

const f07Header = (ui: ReturnType<typeof screen>) => {
  const header = ui.nodes().find(n => n.type === 'TaskHeader' && n.props.title === 'Reserva de emergência');
  assert.ok(header, 'editor real está aberto');
  return header;
};
const f07Flush = async (ui: ReturnType<typeof screen>) => {
  await new Promise<void>(resolve => setImmediate(resolve));
  ui.interact(() => {});
};
const f07Select = (ui: ReturnType<typeof screen>, label: string) => {
  const field = ui.nodes().find(n => n.type === 'Field' && n.props.label === label);
  assert.ok(field, `campo real ${label}`);
  return field.props.children;
};
const f07Toggle = (ui: ReturnType<typeof screen>, label: string, value: boolean) => {
  ui.interact(nodes => {
    const control = nodes.find(n => n.type === 'SwitchRow' && n.props.label === label);
    assert.ok(control, `confirmação real ${label}`);
    control.props.onValueChange(value);
  });
};
const f07AddSource = (ui: ReturnType<typeof screen>, kind: string, id: string) => {
  const picker = f07Select(ui, 'Adicionar fonte');
  const option = picker.props.options.find((item: any) => item.id === `${kind}:${id}`);
  assert.ok(option, 'somente fonte oferecida pelo seletor é escolhida');
  ui.interact(() => picker.props.onChange(option.id));
  ui.press('Adicionar à reserva');
};
const f07Asset = '10000000-0000-4000-8000-000000000003';
const f07Section = (state: any, concealed = false) => {
  const ui = screen(f07Screen, { reserveState: state, concealed });
  return { ...ui, nodes: () => {
    // Inspect only the real reserve subtree/modal: the incumbent health bar is unrelated.
    const nodes = ui.nodes();
    const start = nodes.findIndex(n => n.type?.name === 'EmergencyReserveSection');
    const end = nodes.findIndex((n, i) => i > start && n.type === 'Button'
      && ['Editar reserva', 'Configurar reserva'].includes(n.props.label));
    const modal = nodes.findIndex(n => n.type?.name === 'EmergencyReserveSheet');
    return [...nodes.slice(start, end + 1), ...nodes.slice(modal)];
  } };
};

test('F07: conta e investimento separam só os valores escolhidos após confirmar disponibilidade', () => {
  const state = f07State();
  state.sources[0].other_allocated_cents = 40000;
  state.sources.push({ kind: 'asset', id: f07Asset, name: 'Investimento QA', eligible: true, archived: false,
    available_cents: 90000, other_allocated_cents: 10000, allocated_cents: 0, effective_cents: 0,
    liquidity_confirmed: false, valuation_date: '2026-10-02' });
  const ui = screen(f07Screen, { reserveState: state });
  ui.press('Configurar reserva');
  ui.fill('Essenciais por mês', 10000);
  f07AddSource(ui, 'account', f07Account);
  ui.fill('Separar em Conta QA reserva', 25000);
  assert.equal(ui.button('Salvar reserva').props.disabled, true, 'valor sem liquidez confirmada ainda não salva');
  f07Toggle(ui, 'Disponível para imprevistos em Conta QA reserva', true);
  f07AddSource(ui, 'asset', f07Asset);
  ui.fill('Separar em Investimento QA', 15000);
  assert.equal(ui.button('Salvar reserva').props.disabled, true, 'investimento exige sua própria confirmação');
  f07Toggle(ui, 'Disponível para imprevistos em Investimento QA', true);
  ui.fill('Meses de proteção', 9);
  ui.press('Salvar reserva');
  assert.deepEqual(copia(ui.writes), [{ operation: 'saveEmergencyReserve', value: {
    workspace_id: f07Workspace, expected_revision: null, base_mode: 'manual', manual_monthly_cents: 10000,
    target_months: 9, unassigned_goals_ack_cents: 0, reviewed_months: [], allocations: [
      { kind: 'account', id: f07Account, amount_cents: 25000, liquidity_confirmed: true },
      { kind: 'asset', id: f07Asset, amount_cents: 15000, liquidity_confirmed: true },
    ],
  } }], 'grava somente vínculos parciais, sem criar gasto, transferência ou nova avaliação');
  assert.equal(state.sources[0].available_cents, 100000, 'saldo da origem permanece intocado');
  assert.equal(state.sources[1].available_cents, 90000, 'marcação do investimento permanece intocada');
});

test('F07: retirar disponibilidade confirmada bloqueia salvar sem alterar o valor digitado', () => {
  const ui = screen(f07Screen, { reserveState: f07State(true) });
  ui.press('Editar reserva');
  assert.equal(ui.button('Salvar reserva').props.disabled, false);
  f07Toggle(ui, 'Disponível para imprevistos em Conta QA reserva', false);
  assert.equal(ui.button('Salvar reserva').props.disabled, true);
  ui.interact(() => ui.button('Salvar reserva').props.onPress());
  assert.equal(ui.writes.length, 0, 'handler também valida a disponibilidade');
  assert.equal(f07Select(ui, 'Separar em Conta QA reserva').props.valueCents, 30000);
  f07Toggle(ui, 'Disponível para imprevistos em Conta QA reserva', true);
  assert.equal(ui.button('Salvar reserva').props.disabled, false);
});

test('F07: alocação acima do saldo livre explica limite e só libera ao corrigir o valor', () => {
  const state = f07State(true);
  state.sources[0].other_allocated_cents = 40000;
  const ui = screen(f07Screen, { reserveState: state });
  ui.press('Editar reserva');
  ui.fill('Separar em Conta QA reserva', 60001);
  const field = ui.nodes().find(n => n.type === 'Field' && n.props.label === 'Separar em Conta QA reserva');
  assert.match(field.props.error, /ultrapassa.*disponível/i);
  assert.equal(field.props.children.props.valueCents, 60001, 'valor monetário digitado não sofre ajuste silencioso');
  assert.equal(ui.button('Salvar reserva').props.disabled, true);
  ui.interact(() => ui.button('Salvar reserva').props.onPress());
  assert.equal(ui.writes.length, 0);
  ui.fill('Separar em Conta QA reserva', 60000);
  assert.equal(ui.button('Salvar reserva').props.disabled, false);
  ui.press('Salvar reserva');
  assert.equal(ui.writes.at(-1)?.value.allocations[0].amount_cents, 60000);
});

test('F07: adicionar fonte exclui cartão, arquivada, saldo vazio, saldo comprometido e vínculo duplicado', () => {
  const state = f07State(true);
  state.sources.push(...[
    { suffix: '003', name: 'Cartão QA', eligible: false, available_cents: 20000 },
    { suffix: '004', name: 'Arquivada QA', archived: true, available_cents: 20000 },
    { suffix: '005', name: 'Vazia QA', available_cents: 0 },
    { suffix: '006', name: 'Comprometida QA', available_cents: 20000, other_allocated_cents: 20000 },
    { suffix: '007', name: 'Conta livre QA', available_cents: 20000 },
  ].map(({ suffix, ...extra }) => ({ ...state.sources[0], id: `10000000-0000-4000-8000-000000000${suffix}`,
    allocated_cents: 0, effective_cents: 0, liquidity_confirmed: false, other_allocated_cents: 0, ...extra })));
  const ui = screen(f07Screen, { reserveState: state });
  ui.press('Editar reserva');
  assert.deepEqual(copia(f07Select(ui, 'Adicionar fonte').props.options.map((item: any) => item.label)), ['Conta livre QA']);
  const freeOption = f07Select(ui, 'Adicionar fonte').props.options[0];
  assert.match(freeOption.detail, /200[.,]00.*sem alocação identificada/);
  assert.match(freeOption.detailHidden, /••••••.*sem alocação identificada/);
  f07AddSource(ui, 'account', '10000000-0000-4000-8000-000000000007');
  assert.deepEqual(copia(f07Select(ui, 'Adicionar fonte').props.options), [], 'segunda seleção não oferece a mesma origem');
  assert.equal(ui.nodes().some(n => n.type === 'Button' && n.props.label === 'Adicionar à reserva'), false);
});

test('F07: retirar vínculo libera apenas a reserva e preserva conta e saldo existentes', () => {
  const state = f07State(true);
  const ui = screen(f07Screen, { reserveState: state });
  ui.press('Editar reserva');
  ui.press('Retirar vínculo de Conta QA reserva');
  assert.equal(f07Select(ui, 'Adicionar fonte').props.options[0].id, `account:${f07Account}`);
  assert.equal(ui.nodes().some(n => n.type === 'Field' && n.props.label === 'Separar em Conta QA reserva'), false);
  ui.press('Salvar reserva');
  assert.deepEqual(copia(ui.writes), [{ operation: 'saveEmergencyReserve', value: {
    workspace_id: f07Workspace, expected_revision: 4, base_mode: 'manual', manual_monthly_cents: 10000,
    target_months: 6, unassigned_goals_ack_cents: 0, allocations: [], reviewed_months: [],
  } }]);
  assert.equal(state.sources[0].allocated_cents, 30000, 'rascunho não altera cache ou ledger antes da confirmação');
  assert.equal(state.sources[0].available_cents, 100000);
});

test('F07: histórico com gasto sem necessidade não oferece revisão nem envia mês como revisado', () => {
  const state = f07State();
  state.months[0] = { ...state.months[0], expense_count: 1, unclassified_count: 1, unclassified_cents: 8000 };
  const ui = screen(f07Screen, { reserveState: state });
  ui.press('Configurar reserva');
  ui.interact(() => f07Select(ui, 'Base mensal').props.onChange('observed'));
  const reviews = ui.nodes().filter(n => n.type === 'SwitchRow' && n.props.label.startsWith('Revisei '));
  assert.equal(reviews.length, 2, 'mês sem classificação não pode ser marcado como revisado');
  assert.ok(ui.nodes().some(n => n.type === 'ThemedText' && String(n.props.children).includes('gastos sem necessidade classificada')));
  for (const control of reviews) f07Toggle(ui, control.props.label, true);
  ui.press('Salvar reserva');
  assert.deepEqual(copia(ui.writes.at(-1)?.value.reviewed_months), [
    { month: '2026-08-01', fingerprint: 'a'.repeat(32) }, { month: '2026-09-01', fingerprint: 'a'.repeat(32) },
  ]);
  assert.equal(ui.writes.at(-1)?.value.manual_monthly_cents, null);
});

for (const scenario of ['revisão incompleta', 'base revisada zero', 'necessidade sem classificação'] as const) {
  test(`F07: histórico com ${scenario} nunca afirma cobertura ou alvo coberto`, () => {
    const state = f07State(true);
    state.config.base_mode = 'observed'; state.config.manual_monthly_cents = null;
    for (const month of state.months) month.reviewed = true;
    if (scenario === 'revisão incompleta') {
      state.months[0].reviewed = false; state.months[1].expense_count = 1; state.months[1].essential_cents = 12000;
    }
    if (scenario === 'necessidade sem classificação') {
      state.months[0].reviewed = false; state.months[0].expense_count = 1;
      state.months[0].unclassified_count = 1; state.months[0].unclassified_cents = 12000;
    }
    const ui = f07Section(state);
    const coverage = ui.nodes().find(n => n.type === 'Row' && n.props.title === 'Cobertura');
    assert.ok(coverage);
    assert.equal(coverage.props.trailing.props.children, 'Base a definir');
    assert.equal(ui.nodes().some(n => n.type === 'ProgressBar'), false);
    assert.equal(ui.nodes().some(n => n.type === 'Row' && ['Alvo coberto', 'Falta para o alvo'].includes(n.props.title)), false);
  });
}

test('F07: meta sem origem exige confirmação consciente e envia o total exato conferido', () => {
  const state = f07State(true); state.unassigned_goals_cents = 45678;
  const ui = screen(f07Screen, { reserveState: state });
  ui.press('Editar reserva');
  assert.equal(ui.button('Salvar reserva').props.disabled, true);
  ui.interact(() => ui.button('Salvar reserva').props.onPress());
  assert.equal(ui.writes.length, 0, 'metas legadas não são ignoradas pelo handler');
  f07Toggle(ui, 'Estes valores não estão também nas metas sem origem', true);
  assert.equal(ui.button('Salvar reserva').props.disabled, false);
  ui.press('Salvar reserva');
  assert.equal(ui.writes.at(-1)?.value.unassigned_goals_ack_cents, 45678);
  assert.equal(ui.writes.length, 1);
});

test('F07: ocultar valores mascara cobertura, textos, acessibilidade e todos os Money reais da reserva', () => {
  const state = f07State(true); state.sources[0].effective_cents = 15000; state.sources[0].available_cents = 15000;
  state.unassigned_goals_cents = 45678;
  const ui = f07Section(state, true);
  ui.interact(nodes => nodes.find(n => n.type === 'Row' && n.props.title === 'Base e fontes').props.onPress());
  const rows = ui.nodes().filter(n => n.type === 'Row');
  const coverage = rows.find(n => n.props.title === 'Cobertura');
  assert.equal(coverage.props.trailing.props.children, '••••••', 'meses derivados também são privados');
  assert.equal(ui.nodes().some(n => n.type === 'ProgressBar'), false, 'barra não revela fração do alvo');
  assert.match(rows.find(n => n.props.title === 'Separado para imprevistos').props.accessibilityLabel, /••••••/);
  const source = rows.find(n => n.props.title === 'Conta QA reserva');
  assert.match(source.props.subtitle, /••••••/);
  assert.match(source.props.accessibilityLabel, /•••••• com lastro, •••••• separado/);
  const moneyValues = rows.map(n => n.props.trailing).filter(n => n?.type === 'Money');
  assert.ok(moneyValues.some(n => n.props.cents === 15000));
  assert.ok(moneyValues.some(n => n.props.cents === 60000));
  assert.ok(moneyValues.some(n => n.props.cents === 45000));
  for (const money of moneyValues) {
    const rendered = screen('src/components/ui/money.tsx', { componente: 'Money', concealed: true, props: money.props });
    const text = rendered.nodes().find(n => n.type === 'ThemedText');
    assert.equal(text.props.children, '••••••', 'valor atual ou derivado usa ocultação do primitivo real');
  }
  ui.press('Editar reserva');
  const displayedText = ui.nodes().filter(n => n.type === 'ThemedText')
    .map(n => [n.props.children].flat(Infinity).join('')).join(' ');
  assert.match(displayedText, /metas têm •••••• sem origem/);
  assert.match(ui.nodes().find(n => n.type === 'Field' && n.props.label === 'Separar em Conta QA reserva').props.hint, /••••••/);
  assert.doesNotMatch(displayedText, /R\$/);
});

test('F07: salvar pendente impede fechamento, edição e segunda gravação antes da confirmação', async () => {
  const ui = screen(f07Screen, { reserveState: f07State(true), segurarMutacoes: true });
  ui.press('Editar reserva'); ui.fill('Essenciais por mês', 12000); ui.press('Salvar reserva');
  assert.equal(ui.button('Salvar reserva').props.loading, true);
  ui.interact(() => f07Header(ui).props.onClose());
  ui.interact(nodes => nodes.find(n => n.type === 'Sheet' && n.props.visible).props.onClose());
  ui.fill('Essenciais por mês', 18000);
  ui.fill('Meses de proteção', 12);
  ui.press('Retirar vínculo de Conta QA reserva');
  assert.equal(f07Select(ui, 'Essenciais por mês').props.valueCents, 12000);
  assert.equal(f07Select(ui, 'Meses de proteção').props.value, 6);
  assert.ok(ui.nodes().some(n => n.type === 'Field' && n.props.label === 'Separar em Conta QA reserva'));
  ui.interact(() => ui.button('Salvar reserva').props.onPress());
  assert.equal(ui.writes.length, 1, 'guarda de intenção impede toque duplo');
  (ui.pedidos.at(-1) as any).resolver({ workspace_id: f07Workspace, edit_revision: 5 });
  await f07Flush(ui);
  assert.equal(ui.nodes().some(n => n.type === 'Sheet' && n.props.visible), false);
  assert.equal(ui.toasts.at(-1)?.tone, 'success');
});

test('F07: tentativa ambígua mantém editor travado e Confirmar tentativa reenvia entrada exata', async () => {
  const options = { reserveState: f07State(true), segurarMutacoes: true, reserveUnconfirmed: null as any };
  const ui = screen(f07Screen, options);
  ui.press('Editar reserva'); ui.fill('Essenciais por mês', 12000); ui.press('Salvar reserva');
  const original = ui.writes.at(-1)!.value;
  options.reserveUnconfirmed = original;
  (ui.pedidos.at(-1) as any).rejeitar(new Error('Conexão interrompida'));
  await f07Flush(ui);
  assert.equal(ui.button('Confirmar tentativa').props.disabled, false);
  ui.interact(() => f07Header(ui).props.onClose());
  ui.fill('Essenciais por mês', 18000);
  ui.press('Retirar vínculo de Conta QA reserva');
  assert.equal(f07Select(ui, 'Essenciais por mês').props.valueCents, 12000);
  assert.ok(ui.nodes().some(n => n.type === 'ThemedText' && /mesmos dados antes de editar ou fechar/.test(String(n.props.children))));
  options.reserveState.config.edit_revision = 5; options.reserveState.config.manual_monthly_cents = 19000;
  ui.interact(() => {});
  ui.press('Confirmar tentativa');
  assert.equal(ui.writes.length, 2);
  assert.equal(ui.writes[1].value, original, 'mesma identidade recebida do hook, sem reconstruir intenção');
  assert.deepEqual(copia(ui.writes[1].value), {
    workspace_id: f07Workspace, expected_revision: 4, base_mode: 'manual', manual_monthly_cents: 12000,
    target_months: 6, unassigned_goals_ack_cents: 0, reviewed_months: [],
    allocations: [{ kind: 'account', id: f07Account, amount_cents: 30000, liquidity_confirmed: true }],
  });
  options.reserveUnconfirmed = null;
  (ui.pedidos.at(-1) as any).resolver({ workspace_id: f07Workspace, edit_revision: 5 });
  await f07Flush(ui);
  assert.equal(ui.nodes().some(n => n.type === 'Sheet' && n.props.visible), false);
});

test('F07: cancelar rascunho de fontes e reabrir descarta mudanças sem qualquer mutação', () => {
  const state = f07State(true);
  const ui = screen(f07Screen, { reserveState: state });
  ui.press('Editar reserva'); ui.fill('Essenciais por mês', 12000);
  ui.fill('Separar em Conta QA reserva', 25000); ui.fill('Meses de proteção', 9);
  ui.interact(() => f07Header(ui).props.onClose());
  assert.equal(ui.writes.length, 0);
  ui.press('Editar reserva');
  assert.equal(f07Select(ui, 'Essenciais por mês').props.valueCents, 10000);
  assert.equal(f07Select(ui, 'Separar em Conta QA reserva').props.valueCents, 30000);
  assert.equal(f07Select(ui, 'Meses de proteção').props.value, 6);
  assert.equal(ui.writes.length, 0);
});
test('F07: conflito HTTP PT409 libera fechamento e orienta reabrir com revisão atual', async () => {
  const state = f07State(true);
  const ui = screen(f07Screen, { reserveState: state, segurarMutacoes: true });
  ui.press('Editar reserva');
  ui.fill('Essenciais por mês', 12000);
  ui.press('Salvar reserva');
  (ui.pedidos.at(-1) as any).rejeitar({ code: 'PT409', message: 'Reserva alterada; confira novamente' });
  await f07Flush(ui);
  const alert = ui.nodes().find(n => n.props.accessibilityRole === 'alert');
  assert.ok(alert, 'conflito conhecido mostra orientação de recuperação');
  const scroll = ui.nodes().find(n => n.type === 'SheetScroll');
  assert.ok(scroll);
  assert.equal([scroll.props.children].flat(Infinity).includes(alert), false,
    'a recuperação de uma falha global permanece visível quando o formulário está rolado');
  assert.match(String(alert.props.children), /feche.*abra novamente/i,
    'mensagem precisa explicar como recuperar a revisão, sem deixar tentativa ambígua');
  ui.interact(() => f07Header(ui).props.onClose());
  assert.equal(ui.nodes().some(n => n.type === 'Sheet' && n.props.visible), false);
  state.config.edit_revision = 5;
  state.config.manual_monthly_cents = 19000;
  ui.interact(() => {}); // A changed query result renders before its new open handler is pressed.
  ui.press('Editar reserva');
  ui.press('Salvar reserva');
  assert.equal(ui.writes.at(-1)?.value.expected_revision, 5);
  assert.equal(ui.writes.at(-1)?.value.manual_monthly_cents, 19000);
  (ui.pedidos.at(-1) as any).resolver({ workspace_id: f07Workspace, edit_revision: 6 });
  await f07Flush(ui);
});

test('F07: a folha de edição pertence à tela, fora dos painéis que desmontam ao redimensionar', () => {
  const ui = screen(f07Screen, { reserveState: f07State(true) });
  const root = ui.nodes().find(n => n.type === 'Screen');
  assert.ok(root);
  assert.ok([root.props.children].flat(Infinity).some(n => n?.type?.name === 'EmergencyReserveSheet'),
    'a folha e seu rascunho não podem pertencer aos ramos alternativos de FinanceAnalysisPanes');
});

test('F07: cobertura conserva décimos inteiros e não arredonda proteção para cima', () => {
  const state = f07State(true);
  state.config.manual_monthly_cents = 112000;
  const ui = screen(f07Screen, { reserveState: state });
  const coverage = ui.nodes().find(n => n.type === 'Row' && n.props.title === 'Cobertura');
  assert.equal(coverage.props.trailing.props.children, '0,2 meses');
  state.config.manual_monthly_cents = 1000000;
  ui.interact(() => {});
  const low = ui.nodes().find(n => n.type === 'Row' && n.props.title === 'Cobertura');
  assert.equal(low.props.trailing.props.children, 'Menos de 0,1 mês');
});

test('F07: falha de rede explica recuperação sem expor endereço e exceção nativa', async () => {
  const options = { reserveState: f07State(true), segurarMutacoes: true, reserveUnconfirmed: null as any };
  const ui = screen(f07Screen, options);
  ui.press('Editar reserva'); ui.press('Salvar reserva');
  options.reserveUnconfirmed = ui.writes.at(-1)!.value;
  (ui.pedidos.at(-1) as any).rejeitar(new Error('Error: fetch failed: java.net.UnknownHostException: staging.example.invalid'));
  await f07Flush(ui);
  const text = String(ui.nodes().find(n => n.props.accessibilityRole === 'alert')?.props.children);
  assert.match(text, /conexão.*tente novamente/i);
  assert.doesNotMatch(text, /java|Exception|staging|fetch|Error:/);
  assert.ok(ui.button('Conferir e encerrar tentativa'));
});

test('F07: conferência terminal permite encerrar sem salvar e só fecha após comprovante', async () => {
  const options = { reserveState: f07State(true), segurarMutacoes: true, reserveUnconfirmed: null as any };
  const ui = screen(f07Screen, options);
  ui.press('Editar reserva'); ui.fill('Essenciais por mês', 12000); ui.press('Salvar reserva');
  options.reserveUnconfirmed = ui.writes.at(-1)!.value;
  (ui.pedidos.at(-1) as any).rejeitar({ code: '22023', message: 'Metas sem origem mudaram; confira novamente' });
  await f07Flush(ui);
  ui.press('Conferir e encerrar tentativa');
  assert.equal(ui.writes.at(-1)?.operation, 'resolveEmergencyReserve');
  assert.equal(ui.button('Conferir e encerrar tentativa').props.loading, true,
    'a ação mantém o indicador durante a conferência, mesmo após limpar o erro anterior');
  ui.interact(() => f07Header(ui).props.onClose());
  ui.fill('Essenciais por mês', 18000);
  assert.equal(f07Select(ui, 'Essenciais por mês').props.valueCents, 12000);
  ui.interact(() => ui.button('Confirmar tentativa').props.onPress());
  assert.equal(ui.writes.length, 2, 'não envia save enquanto confere a tentativa');
  options.reserveUnconfirmed = null;
  (ui.pedidos.at(-1) as any).rejeitar(ui.cancelledReserveAttempt());
  await f07Flush(ui);
  assert.equal(ui.nodes().some(n => n.type === 'Sheet' && n.props.visible), false);
  assert.equal(ui.toasts.at(-1)?.tone, 'info');
  assert.match(String(ui.toasts.at(-1)?.message), /encerrada sem salvar/i);
  ui.press('Editar reserva');
  assert.equal(f07Select(ui, 'Essenciais por mês').props.valueCents, 10000);
  assert.equal(ui.writes.length, 2);
});

test('F07: conferir tentativa já salva recupera sucesso e falha de conferência mantém rascunho', async () => {
  const options = { reserveState: f07State(true), segurarMutacoes: true, reserveUnconfirmed: null as any };
  const ui = screen(f07Screen, options);
  ui.press('Editar reserva'); ui.press('Salvar reserva');
  options.reserveUnconfirmed = ui.writes.at(-1)!.value;
  (ui.pedidos.at(-1) as any).rejeitar(new Error('response lost'));
  await f07Flush(ui);
  ui.press('Conferir e encerrar tentativa');
  (ui.pedidos.at(-1) as any).rejeitar(new Error('resolution response lost'));
  await f07Flush(ui);
  ui.interact(() => f07Header(ui).props.onClose());
  assert.ok(ui.nodes().some(n => n.type === 'Sheet' && n.props.visible));
  ui.press('Conferir e encerrar tentativa');
  options.reserveUnconfirmed = null;
  (ui.pedidos.at(-1) as any).resolver({ workspace_id: f07Workspace, edit_revision: 5 });
  await f07Flush(ui);
  assert.equal(ui.nodes().some(n => n.type === 'Sheet' && n.props.visible), false);
  assert.equal(ui.toasts.at(-1)?.tone, 'success');
  assert.equal(ui.writes.filter(w => w.operation === 'saveEmergencyReserve').length, 1);
});


const f08UIFile = 'src/components/finance/goal-planning.tsx';
const f08Workspace = '10000000-0000-4000-8000-000000000008';
const f08GoalA = '20000000-0000-4000-8000-000000000001';
const f08GoalB = '20000000-0000-4000-8000-000000000002';
function f10UIState(state: any): any {
  if (state.horizons) return state;
  return { ...state, horizons: state.goals.map((goal: any) => {
    const item = { goal_id: goal.goal_id, included: goal.included, mode: 'legacy', monthly_cents: goal.monthly_cents,
      first_on: goal.first_on, deadline_on: null, initial_cents: 0, initial_on: null };
    return { item, result: calculateGoalContribution({ target_cents: goal.target_cents, saved_cents: goal.saved_cents,
      as_of: state.as_of, mode: 'monthly', monthly_cents: goal.monthly_cents, first_on: goal.first_on,
      deadline_on: null, initial_cents: 0, initial_on: null }) };
  }) };
}
function f08UIState(withGoals = false): any {
  return { workspace_id: f08Workspace, workspace_name: 'F08 espaço escolhido', cycle_close_day: 20,
    as_of: '2026-10-03', days: 365, view: 'cycle', mode: 'month', edit_revision: 4, goals_fingerprint: 'a'.repeat(32),
    goals: withGoals ? [{ goal_id: f08GoalA, name: 'Meta A', target_cents: 10000, saved_cents: 1000,
      deadline: null, included: true, monthly_cents: 2500, first_on: '2026-10-03', suggested_cents: null, origin: 'saved', deadline_status: 'none' },
      { goal_id: f08GoalB, name: 'Meta B', target_cents: 20000, saved_cents: 3000,
      deadline: null, included: true, monthly_cents: 4000, first_on: '2026-10-08', suggested_cents: null, origin: 'saved', deadline_status: 'none' }] : [],
    reserved_cash_cents: 321, unassigned_goals_cents: 654, income_present: false,
    incomplete_goal_ids: [], excluded_goal_ids: [], missed_deadline_goal_ids: [],
    points: [], months: [{ month: '2026-10', from: '2026-09-21', to: '2026-10-20', partial: true,
      cash_cents: 9000, planned_cents: 800, cumulative_planned_cents: 800, available_cents: 7879, first_pressure_on: '2026-10-10' },
      { month: '2026-11', from: '2026-10-21', to: '2026-11-20', partial: false,
      cash_cents: 10000, planned_cents: 200, cumulative_planned_cents: 1000, available_cents: 8679, first_pressure_on: null }],
    first_pressure_on: '2026-10-10', minimum_available_cents: -843 };
}
const f08EditorUI = (options: Parameters<typeof screen>[1] = {}) => screen(f08UIFile, Object.assign(options, {
  hook: 'useGoalPlanEditor', hookArgs: [365, 'cycle', 'month'], componente: 'GoalPlanSheet',
}));
const f08Flush = async (ui: ReturnType<typeof screen>) => { for (let i = 0; i < 6; i++) await Promise.resolve();ui.interact(() => {}); };
const f08Visible = (ui: ReturnType<typeof screen>) => ui.nodes().some(node => node.type === 'Sheet' && node.props.visible);
async function f08Open(ui: ReturnType<typeof screen>, scope = { ws: f08Workspace, goalId: f08GoalA }) {
  ui.interact(() => ui.editor().open(scope));await f08Flush(ui);
}

test('F08 editor: fresh requested workspace opens once and closing ignores a late snapshot', async () => {
  let reply!: (value: unknown) => void;
  const ui = f08EditorUI({ planningState: f08UIState(true), freshPlanning: () => new Promise(resolve => { reply = resolve; }) });
  ui.interact(() => { ui.editor().open({ ws: f08Workspace, goalId: f08GoalB });ui.editor().open({ ws: f08Workspace }); });
  assert.equal(ui.freshPlanningQueries.length, 1);assert.equal(ui.freshPlanningQueries[0][4], f08Workspace);
  assert.equal(ui.editor().opening, true);assert.equal(f08Visible(ui), true);
  ui.interact(() => ui.editor().close());assert.equal(f08Visible(ui), false);
  reply(f08UIState(true));await f08Flush(ui);
  assert.equal(ui.editor().session, null);assert.equal(f08Visible(ui), false);assert.equal(ui.writes.length, 0);
});
test('F08 editor: draft and snapshot survive query updates and width changes', async () => {
  const options = { planningState: f08UIState(true), tablet: false };const ui = f08EditorUI(options);
  await f08Open(ui);const originalSnapshot = ui.editor().session.snapshot;
  ui.interact(() => ui.editor().update(f08GoalA, { monthly_cents: 5100, first_on: '2026-11-17' }));
  options.tablet = true;options.planningState = { ...f08UIState(true), edit_revision: 5 };
  ui.interact(() => {});
  assert.equal(ui.editor().session.snapshot, originalSnapshot);
  assert.equal(ui.editor().session.snapshot.edit_revision, 4);
  assert.equal(ui.editor().session.items[0].monthly_cents, 5100);assert.equal(ui.editor().session.items[0].first_on, '2026-11-17');
  assert.equal(ui.editor().current, null);assert.equal(ui.button('Salvar').props.disabled, true);
  assert.equal(ui.writes.length, 0);
});
for (const condition of ['error', 'fetching', 'pending', 'revision', 'fingerprint'] as const) {
  test(`F08 editor: ${condition} cannot present or save a previous scenario`, async () => {
    const options = { planningState: f08UIState(true), planningError: false, planningFetching: false, planningPending: false };
    const ui = f08EditorUI(options);await f08Open(ui);assert.equal(ui.button('Salvar').props.disabled, false);
    if (condition === 'error') options.planningError = true;
    if (condition === 'fetching') options.planningFetching = true;
    if (condition === 'pending') options.planningPending = true;
    if (condition === 'revision') options.planningState.edit_revision = 5;
    if (condition === 'fingerprint') options.planningState.goals_fingerprint = 'b'.repeat(32);
    ui.interact(() => {});
    assert.equal(ui.editor().current, null);assert.equal(ui.button('Salvar').props.disabled, true);
    assert.equal(ui.nodes().some(node => node.props.children === 'Menor disponibilidade no período'), false);
    ui.interact(() => ui.editor().submit());assert.equal(ui.writes.length, 0);
    if (condition === 'error') assert.ok(ui.nodes().some(node => node.props.accessibilityRole === 'alert'));
  });
}
test('F08 editor: a confirmed CAS refusal removes the old scenario until a fresh reopening', async () => {
  const options = { planningState: f08UIState(true), segurarMutacoes: true };
  const ui = f08EditorUI(options);await f08Open(ui);ui.press('Salvar');
  (ui.pedidos.at(-1) as any).rejeitar({ code: 'PT409', message: 'Plano alterado. Confira novamente' });await f08Flush(ui);
  assert.equal(ui.editor().current, null, 'A rejected financial snapshot cannot remain authoritative');
  assert.equal(ui.button('Salvar').props.disabled, true);
  assert.equal(ui.nodes().some(node => node.props.children === 'Menor disponibilidade no período'), false);
  const alert = ui.nodes().find(node => node.props.accessibilityRole === 'alert');assert.ok(alert);
  const scroll = ui.nodes().find(node => node.type === 'SheetScroll');
  const contains = (value: any): boolean => value === alert || (Array.isArray(value) ? value.some(contains) : Boolean(value?.props && contains(value.props.children)));
  assert.equal(contains(scroll.props.children), false, 'The error remains visible above the form scroll');
  ui.interact(() => { ui.editor().update(f08GoalA, { monthly_cents: 6300 });ui.editor().submit(); });
  assert.equal(ui.writes.length, 1, 'Editing cannot clear a confirmed stale-snapshot refusal');
  options.planningState = { ...f08UIState(true), edit_revision: 5 };
  ui.press('Reabrir plano');await f08Flush(ui);
  assert.equal(ui.editor().session.snapshot.edit_revision, 5);assert.equal(ui.button('Salvar').props.disabled, false);
});
test('F08 editor: retrying a transient preview error preserves the editable draft', async () => {
  const options = { planningState: f08UIState(true), planningError: false };
  const ui = f08EditorUI(options);await f08Open(ui);
  ui.interact(() => ui.editor().update(f08GoalA, { monthly_cents: 6300 }));
  options.planningError = true;ui.interact(() => {});ui.press('Tentar de novo');
  assert.ok(ui.refetches.includes('goal-planning'));
  assert.equal(ui.editor().session.items[0].monthly_cents, 6300);
  assert.equal(ui.freshPlanningQueries.length, 1, 'A transport retry does not discard the editor snapshot');
  assert.equal(ui.writes.length, 0);
});
test('F08 result: recalculation preserves its component and measured space without showing old financial readings', async () => {
  const options = { planningState: f08UIState(true), planningFetching: false };
  const ui = f08EditorUI(options);await f08Open(ui);
  const result = () => ui.nodes().find(node => node.type?.name === 'PlanningResult');
  assert.ok(result());ui.interact(nodes => nodes.find(node => node.props.title === 'Ver períodos').props.onPress());
  options.planningFetching = true;ui.interact(() => {});
  assert.ok(result(), 'Recalculation must not unmount the expanded result');
  options.planningFetching = false;ui.interact(() => {});
  const frame = ui.nodes().find(node => node.props.testID === 'goal-plan-result');assert.ok(frame);
  ui.interact(() => frame.props.onLayout({ nativeEvent: { layout: { height: 780 } } }));
  options.planningFetching = true;ui.interact(() => {});
  assert.ok(result(), 'The same result component survives the query transition');
  assert.ok(ui.nodes().some(node => node.type === 'Skeleton' && node.props.height === 780));
  assert.equal(ui.nodes().some(node => node.props.children === 'Menor disponibilidade no período'), false);
  options.planningFetching = false;ui.interact(() => {});
  assert.ok(ui.nodes().some(node => node.props.title === 'Caixa e disponível'), 'Expanded period details survive recalculation');
  assert.equal(ui.writes.length, 0);
});
test('F08 result: a refused or failed scenario does not pretend to keep loading', async () => {
  const options = { planningState: f08UIState(true), planningError: false };
  const ui = f08EditorUI(options);await f08Open(ui);
  options.planningError = true;ui.interact(() => {});
  assert.equal(ui.nodes().some(node => node.type === 'Skeleton'), false, 'A failed query needs its retry action, not a perpetual loading placeholder');
  options.planningError = false;options.planningState.edit_revision = 5;ui.interact(() => {});
  assert.equal(ui.nodes().some(node => node.type === 'Skeleton'), false, 'A changed revision needs reopening, not a perpetual loading placeholder');
  assert.ok(ui.button('Reabrir plano'));assert.equal(ui.button('Salvar').props.disabled, true);
});
test('F08 editor: actual excluded fields disappear and retoggle preserves its own monthly draft', async () => {
  const ui = f08EditorUI({ planningState: f08UIState(true) });await f08Open(ui);
  const field = () => ui.nodes().find(node => node.type === 'MoneyField' && node.props.accessibilityLabel === 'Aporte mensal para Meta A');
  ui.interact(() => field().props.onChangeCents(6100));
  ui.interact(nodes => nodes.find(node => node.type === 'SwitchRow' && node.props.label === 'Meta A').props.onValueChange(false));
  assert.equal(field(), undefined);
  const preview = ui.planningQueries.at(-1)[3];
  assert.equal(preview.items.find((item: any) => item.goal_id === f08GoalA).monthly_cents, null);
  ui.interact(nodes => nodes.find(node => node.type === 'SwitchRow' && node.props.label === 'Meta A').props.onValueChange(true));
  assert.equal(field().props.valueCents, 6100);assert.equal(ui.editor().session.items[1].monthly_cents, 4000);
  assert.equal(ui.writes.length, 0);
});
test('F08 editor: an ambiguous attempt freezes editing and close; retry uses the confirmed immutable input', async () => {
  const options = { planningState: f08UIState(true), planningUnconfirmed: null as any, segurarMutacoes: true };
  const ui = f08EditorUI(options);await f08Open(ui);
  ui.interact(() => ui.editor().update(f08GoalA, { monthly_cents: 5100 }));ui.press('Salvar');
  options.planningUnconfirmed = ui.writes.at(-1)!.value;
  (ui.pedidos.at(-1) as any).rejeitar(new Error('lost'));await f08Flush(ui);
  ui.interact(() => { ui.editor().close();ui.editor().update(f08GoalA, { monthly_cents: 9200 }); });
  assert.equal(f08Visible(ui), true);assert.equal(ui.editor().session.items[0].monthly_cents, 5100);
  assert.ok(ui.nodes().filter(node => node.type === 'SwitchRow').every(node => node.props.disabled));
  assert.ok(ui.nodes().filter(node => node.type === 'MoneyField').every(node => node.props.readOnly));
  ui.press('Conferir');assert.equal(ui.writes.length, 2);
  assert.deepEqual(ui.writes[0].value, ui.writes[1].value);
  options.planningUnconfirmed = null;(ui.pedidos.at(-1) as any).resolver({ workspace_id: f08Workspace, edit_revision: 5 });
  await f08Flush(ui);assert.equal(f08Visible(ui), false);assert.equal(ui.toasts.at(-1)?.tone, 'success');
});
test('F08 sheet: actual workspace cycle controls the ruler, independent of default profile capability', async () => {
  const state = f08UIState(true);const options = { planningState: state };const ui = f08EditorUI(options);
  await f08Open(ui);let ruler = ui.nodes().find(node => node.type === 'MonthRuler');
  assert.equal(ruler.props.visible, true);assert.equal(ruler.props.value, 'cycle');
  ui.interact(() => ui.editor().close());state.cycle_close_day = null;await f08Open(ui);
  ruler = ui.nodes().find(node => node.type === 'MonthRuler');assert.equal(ruler.props.visible, false);
});
test('F08 result: conceal suppresses derived numbers, pressure date, comparison chart and accessibility values', async () => {
  const options = { planningState: f08UIState(true), concealed: false, realMoney: true };const ui = f08EditorUI(options);
  await f08Open(ui);
  assert.ok(ui.nodes().some(node => node.type === 'MeasuredSparkline'));
  assert.ok(ui.nodes().some(node => String(node.props.accessibilityLabel).includes('caixa R$')));
  assert.ok(ui.nodes().some(node => node.type === 'Money' || node.type?.name === 'Money'));
  options.concealed = true;ui.interact(() => {});
  assert.equal(ui.nodes().some(node => node.type === 'MeasuredSparkline'), false);
  const text = ui.nodes().filter(node => node.type === 'ThemedText').map(node => [node.props.children, node.props.accessibilityLabel].flat().join(' ')).join(' ');
  assert.doesNotMatch(text, /R\$|8[.,]43|6[.,]54|10\/10\/2026|caixa R\$/);
  assert.ok(ui.nodes().some(node => node.props.accessibilityLabel === 'Valor oculto'));
  assert.equal(ui.nodes().find(node => node.type === 'MoneyField').props.valueCents, 2500,'Own editable values remain visible while aggregate results are concealed');
});
test('F08 goals menu forwards the selected goal workspace instead of the default summary workspace', async () => {
  const state = f08UIState(true);const ui = screen('src/app/finance/goals.tsx', { planningState: state, goals: [
    { id: f08GoalB, workspace_id: f08Workspace, name: 'Meta de outro espaço', target_cents: 20000, saved_cents: 3000, deadline: null, archived: false },
  ] });
  const row = ui.nodes().find(node => typeof node.props.onLongPress === 'function' && String(node.props.accessibilityLabel).startsWith('Meta de outro espaço,'));
  assert.ok(row);ui.interact(() => row.props.onLongPress());
  const action = ui.actions.find(action => action.label === 'Simular com outras metas');assert.ok(action);
  ui.interact(() => action.onPress());await f08Flush(ui);
  assert.equal(ui.freshPlanningQueries.at(-1)[4], f08Workspace);
  const switches = ui.nodes().filter(node => node.type === 'SwitchRow');assert.equal(switches[0].props.label, 'Meta B');
});

test('F10 editor: source mode preserves monthly/deadline drafts and sends only the chosen input', async () => {
  const ui = f08EditorUI({ planningState: f08UIState(true) });await f08Open(ui);
  const segmented = () => ui.nodes().find(node => node.type === 'Segmented' && node.props.options.some((option: any) => option.value === 'deadline'));
  assert.ok(segmented(), 'The current editor must expose goal calculation modes');
  ui.interact(() => segmented().props.onChange('monthly'));
  const money = () => ui.nodes().find(node => node.type === 'MoneyField' && node.props.accessibilityLabel === 'Aporte mensal para Meta A');
  ui.interact(() => money().props.onChangeCents(5000));
  ui.interact(() => segmented().props.onChange('deadline'));
  const deadline = ui.nodes().find(node => node.type === 'DatePickerField' && node.props.accessibilityLabel === 'Prazo do plano para Meta A');
  assert.ok(deadline);ui.interact(() => deadline.props.onChange('31/01/2027'));
  const preview = ui.planningQueries.at(-1)[3].items.find((item: any) => item.goal_id === f08GoalA);
  assert.equal(preview.monthly_cents, null);assert.equal(preview.deadline_on, '2027-01-31');
  ui.interact(() => segmented().props.onChange('monthly'));assert.equal(money().props.valueCents, 5000);
  assert.ok(ui.nodes().some(node => node.type === 'Field' && node.props.label === 'Aporte por mês' && node.props.hint), 'The computed horizon stays beside the active source');
  assert.ok(ui.nodes().some(node => node.props.children === 'Conclusão em 03/11/2026 · 2 contribuições'));
  assert.equal(ui.editor().session.items[0].deadline_on, '2027-01-31');
  assert.equal(ui.writes.length, 0);
});
test('F10 editor: zero explains the missing amount and cannot save; initial-only plan can complete', async () => {
  const ui = f08EditorUI({ planningState: f08UIState(true) });await f08Open(ui);
  ui.interact(() => ui.editor().update(f08GoalA, { mode: 'monthly', monthly_cents: 0 }));
  assert.ok(ui.nodes().some(node => node.props.children === 'Informe quanto consegue guardar por mês.'));
  assert.equal(ui.button('Salvar').props.disabled, true);
  ui.interact(() => ui.editor().update(f08GoalA, { initial_cents: 9000, initial_on: '2026-10-03', first_on: null }));
  assert.equal(ui.button('Salvar').props.disabled, false);
  assert.ok(ui.nodes().some(node => node.props.title === 'Conclusão prevista' && node.props.trailing?.props.children === '03/10/2026'));
  assert.ok(ui.nodes().some(node => node.props.children === '1 contribuição · sem rendimento estimado'));
  assert.equal(ui.writes.length, 0);
});
test('F10 summary: civil 31 calendar and last exact cents come from current draft, conceal hides sensitive output', async () => {
  const options = { planningState: f08UIState(true), concealed: false, realMoney: true };const ui = f08EditorUI(options);await f08Open(ui);
  ui.interact(() => ui.editor().update(f08GoalA, { mode: 'monthly', monthly_cents: 3334, first_on: '2027-01-31', initial_cents: 0 }));
  const rows = () => ui.nodes().filter(node => node.props.title?.includes('contribuição') || node.props.title === 'Última contribuição');
  assert.ok(rows().some(node => node.props.subtitle === '28/02/2027'));
  assert.ok(rows().some(node => node.props.subtitle === '31/03/2027'));
  assert.ok(ui.nodes().some(node => (node.type === 'Money' || node.type?.name === 'Money') && node.props.cents === 2332));
  options.concealed = true;ui.interact(() => {});
  assert.equal(rows().length, 0);
  const reading = ui.nodes().filter(node => node.type === 'ThemedText').map(node => String(node.props.children)).join(' ');
  assert.doesNotMatch(reading, /31\/03\/2027|28\/02\/2027|3 contribuições/);
});

function f10CaptionReadings(ui: ReturnType<typeof screen>): string {
  const text = (child: any): string => child == null || typeof child === 'boolean' ? ''
    : Array.isArray(child) ? child.map(text).join('') : typeof child === 'object' ? text(child.props?.children) : String(child);
  return ui.nodes().filter(n => n.type === 'ThemedText').map(n => text(n.props.children)).join(' ');
}
test('F10 cards: forecast uses the chosen calendar rather than goal deadline, and concealing removes the date', () => {
  const state = f10UIState(f08UIState(true));
  state.goals[0].deadline = '2027-10-03';
  state.horizons[0].item.mode = 'monthly';
  const goal = { id: f08GoalA, workspace_id: f08Workspace, name: 'Meta A', target_cents: 10000, saved_cents: 1000, deadline: '2027-10-03' };
  const options = { goals: [goal], planningState: state, concealed: false, realMoney: true };
  const ui = screen('src/app/finance/goals.tsx', options);
  const readings = () => f10CaptionReadings(ui);
  assert.match(readings(), /previsão jan\/2027/, 'Four contributions finish in January despite the actual goal deadline in October');
  assert.doesNotMatch(readings(), /até out\/2027/);
  options.concealed = true;ui.interact(() => {});
  assert.match(readings(), /Plano oculto/);
  assert.doesNotMatch(readings(), /jan\/2027|out\/2027/);
});
test('F10 cards: initial-only intent has its own forecast, and legacy mode does not promise an uncapped conclusion', () => {
  const state = f10UIState(f08UIState(true));
  const entry = state.horizons[0];entry.item = { ...entry.item, mode: 'monthly', monthly_cents: 0, first_on: null, initial_cents: 9000, initial_on: '2026-10-03' };
  entry.result = calculateGoalContribution({ target_cents: 10000, saved_cents: 1000, as_of: state.as_of, mode: 'monthly', monthly_cents: 0, first_on: null, deadline_on: null, initial_cents: 9000, initial_on: '2026-10-03' });
  state.goals[0].monthly_cents = 0;state.goals[0].first_on = null;
  const options = { planningState: state, goals: [{ id: f08GoalA, workspace_id: f08Workspace, name: 'Meta A', target_cents: 10000, saved_cents: 1000, deadline: '2027-10-03' }], realMoney: true };
  const ui = screen('src/app/finance/goals.tsx', options);
  const readings = () => f10CaptionReadings(ui);
  assert.match(readings(), /Aporte inicial.*previsão out\/2026/);
  options.planningState = f10UIState(f08UIState(true));ui.interact(() => {});
  assert.match(readings(), /mês no plano atual/);
  assert.doesNotMatch(readings(), /previsão|até out\/2027/);
});

const f11Estado = (movements: any[] = []) => ({
  goal_id: 'g1', has_more: false, next_before: null, movements,
  accounts: [
    { account_id: 'a1', name: 'Nubank', type: 'checking', archived: false, goal_cents: '2000', cash_cents: '10000', allocated_cents: '4000', free_cents: '6000' },
    { account_id: 'a2', name: 'Caixinha', type: 'savings', archived: false, goal_cents: '0', cash_cents: '500', allocated_cents: '0', free_cents: '500' },
  ],
});
const f11Contas = [
  { id: 'a1', name: 'Nubank', type: 'checking', archived: false },
  { id: 'a2', name: 'Caixinha', type: 'savings', archived: false },
];
const f11Meta = { id: 'g1', name: 'Viagem', target_cents: 500000, saved_cents: 100000, deadline: null, archived: false };
function f11Folha() {
  const ui = screen('src/app/finance/goals.tsx', { goals: [f11Meta], forecastAccounts: f11Contas, goalMoney: f11Estado(), concealed: false });
  ui.interact(() => deslizaveis(ui)[0].props.acoes.find((x: any) => x.label === 'Guardar').onPress());
  return ui;
}
// o último: o cartão da meta também tem um "Guardar"; o da folha vem depois
const f11Botao = (ui: any, label: string) => ui.nodes().filter((n: any) => n.type === 'Button' && n.props.label === label).at(-1);

test('F11: formulário incompleto não grava nada e o botão fica desligado', () => {
  const ui = f11Folha();
  assert.equal(f11Botao(ui, 'Guardar').props.disabled, true);
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'MoneyField').props.onChangeCents(1000));
  assert.equal(f11Botao(ui, 'Guardar').props.disabled, true, 'sem conta ainda não grava');
  assert.deepEqual(ui.writes, []);
});

test('F11: separar na conta manda allocate com a conta escolhida e mostra o efeito', () => {
  const ui = f11Folha();
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'MoneyField').props.onChangeCents(1000));
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'AccountPicker').props.onChange('a1'));
  assert.equal(f11Botao(ui, 'Guardar').props.disabled, false);
  assert.ok(ui.nodes().some((n: any) => n.type === 'ThemedText' && /Nubank · Livre na conta/.test(String(n.props.children))));
  ui.interact(() => f11Botao(ui, 'Guardar').props.onPress());
  const w = ui.writes.at(-1);
  assert.equal(w.operation, 'goalMoney');
  assert.equal(w.value.op, 'allocate');
  assert.equal(w.value.account_id, 'a1');
  assert.equal(w.value.amount_cents, '1000');
});

test('F11: Transferir mostra origem e destino, origem primeiro', () => {
  const ui = f11Folha();
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'SwitchRow' && n.props.label === 'Transferir de outra conta').props.onValueChange(true));
  const rotulos = ui.nodes().filter((n: any) => n.type === 'Field').map((n: any) => n.props.label);
  assert.ok(rotulos.indexOf('Da conta') >= 0 && rotulos.indexOf('Da conta') < rotulos.indexOf('Para a conta'));
  assert.equal(ui.nodes().filter((n: any) => n.type === 'AccountPicker').length, 2);
});

test('F11: origem igual ao destino bloqueia o salvar com o motivo escrito', () => {
  const ui = f11Folha();
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'SwitchRow' && n.props.label === 'Transferir de outra conta').props.onValueChange(true));
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'MoneyField').props.onChangeCents(1000));
  const [origem, destino] = ui.nodes().filter((n: any) => n.type === 'AccountPicker');
  ui.interact(() => origem.props.onChange('a1'));
  ui.interact((nodes: any[]) => nodes.filter((n) => n.type === 'AccountPicker')[1].props.onChange('a1'));
  assert.equal(f11Botao(ui, 'Guardar').props.disabled, true);
  assert.ok(ui.nodes().some((n: any) => n.type === 'ThemedText' && /Origem e destino precisam ser contas diferentes/.test(String(n.props.children))));
  ui.interact(() => f11Botao(ui, 'Guardar').props.onPress());
  assert.deepEqual(ui.writes, []);
  void destino;
});

test('F11: com valores ocultos o efeito não mostra o dinheiro', () => {
  const ui = screen('src/app/finance/goals.tsx', { goals: [f11Meta], forecastAccounts: f11Contas, goalMoney: f11Estado(), concealed: true });
  ui.interact(() => deslizaveis(ui)[0].props.acoes.find((x: any) => x.label === 'Guardar').onPress());
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'MoneyField').props.onChangeCents(1000));
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'AccountPicker').props.onChange('a1'));
  const linha = ui.nodes().find((n: any) => n.type === 'ThemedText' && /Livre na conta/.test(String(n.props.children)));
  assert.ok(linha);
  assert.doesNotMatch(String(linha.props.children), /\d/);
});

test('F11: o extrato mostra a natureza e só oferece Desfazer na linha de uma movimentação', () => {
  const mov = { id: 'm1', kind: 'transfer_in', account_id: 'a2', account_name: 'Caixinha', other_account_id: 'a1', other_account_name: 'Nubank',
    amount_cents: '1000', occurred_on: '2026-09-01', transfer_id: 't1', created_transfer: true, revision: 1, created_at: '2026-09-01T10:00:00Z', note: null, contribution_id: 'c1' };
  const ui = screen('src/app/finance/goals.tsx', {
    goals: [f11Meta], forecastAccounts: f11Contas, goalMoney: f11Estado([mov]),
    contributions: [
      { id: 'c1', goal_id: 'g1', amount_cents: 1000, occurred_at: '2026-09-01', note: null },
      { id: 'c2', goal_id: 'g1', amount_cents: 500, occurred_at: '2026-09-02', note: null },
    ],
  });
  ui.interact(() => deslizaveis(ui)[0].props.acoes.find((x: any) => x.label === 'Ver extrato').onPress());
  const linhas = deslizaveis(ui).filter((d: any) => d.props.acoes.some((x: any) => /movimentação|aporte/.test(x.label)));
  const daMov = linhas.find((d: any) => d.props.acoes.some((x: any) => x.label === 'Desfazer a movimentação'));
  assert.ok(daMov);
  assert.deepEqual(JSON.parse(JSON.stringify(daMov.props.acoes.map((x: any) => x.label))), ['Desfazer a movimentação']);
  assert.ok(ui.nodes().some((n: any) => n.type === 'Row' && n.props.subtitle === 'Transferido de Nubank para Caixinha'));
  ui.interact(() => daMov.props.acoes[0].onPress());
  assert.deepEqual(ui.writes, [], 'confirma antes de desfazer');
  assert.equal(ui.confirmations.length, 1);
});

const f12Posicao = { account_id: 'p1', workspace_id: 'w1', name: 'Corretora', type_label: 'Conta de investimento', balance_cents: 30000, net_contributed_cents: 25000, movements_count: 2,
  value_cents: 30000, principal_cents: 25000, result_cents: null, result_quality: 'indisponível', received_cents: 0, last_valuation_on: null, opening_on: null };
const f12Opcoes = (extra: Record<string, unknown> = {}) => ({
  forecastAccounts: [{ id: 'a1', name: 'Nubank', type: 'checking', archived: false }, { id: 'p1', name: 'Corretora', type: 'investment', archived: false }],
  balances: [{ account_id: 'a1', cleared_cents: 100000 }], investments: { positions: [f12Posicao] }, ...extra,
});
const f12Folha = (direcao: 'Aplicar' | 'Resgatar' = 'Aplicar', extra: Record<string, unknown> = {}) => {
  const ui = screen('src/app/finance/net-worth.tsx', f12Opcoes(extra));
  ui.press(direcao);
  if (direcao === 'Resgatar') ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'Segmented' && n.props.options.some((o: any) => o.value === 'resgatar')).props.onChange('resgatar'));
  return ui;
};
// o último: a lista também tem os botões "Aplicar"/"Resgatar"; o da folha vem depois
const f12Botao = (ui: any, label: string) => ui.nodes().filter((n: any) => n.type === 'Button' && n.props.label === label).at(-1);
const f12Motivo = (ui: any, re: RegExp) => ui.nodes().some((n: any) => n.type === 'ThemedText' && re.test(String(n.props.children)));

test('F12: sem conta de investimento a tela diz isso numa linha e leva ao cadastro', () => {
  const ui = screen('src/app/finance/net-worth.tsx', { forecastAccounts: [{ id: 'a1', name: 'Nubank', type: 'checking', archived: false }] });
  const vazio = ui.nodes().find((n: any) => n.type === 'EmptyState' && n.props.title === 'Nenhuma conta de investimento');
  assert.ok(vazio);
  assert.equal(vazio.props.action.label, 'Cadastrar conta de investimento');
  ui.interact(() => vazio.props.action.onPress());
  assert.deepEqual(ui.navigations.at(-1), '/finance/accounts?create=1');
});

test('F12: formulário incompleto não grava nada; o Valor abre com o foco logo depois do seletor', () => {
  const ui = f12Folha();
  const campos = ui.nodes().filter((n: any) => ['Segmented', 'Field'].includes(n.type)).map((n: any) => n.type === 'Field' ? n.props.label : 'Segmented');
  assert.deepEqual(campos.slice(0, 2), ['Segmented', 'Valor']);
  assert.equal(ui.nodes().find((n: any) => n.type === 'MoneyField').props.autoFocus, true);
  assert.equal(f12Botao(ui, 'Aplicar').props.disabled, true);
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'MoneyField').props.onChangeCents(1000));
  assert.equal(f12Botao(ui, 'Aplicar').props.disabled, true, 'sem origem ainda não grava');
  ui.interact(() => f12Botao(ui, 'Aplicar').props.onPress?.());
  assert.deepEqual(ui.writes, []);
});

test('F12: aplicar manda contribute com a origem escolhida e mostra o efeito nas duas contas', () => {
  const ui = f12Folha();
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'MoneyField').props.onChangeCents(1000));
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'AccountPicker').props.onChange('a1'));
  assert.equal(f12Botao(ui, 'Aplicar').props.disabled, false);
  assert.ok(f12Motivo(ui, /Nubank · Saldo: R\$ 1000.00 → R\$ 990.00/));
  assert.ok(f12Motivo(ui, /Corretora · Saldo: R\$ 300.00 → R\$ 310.00/));
  ui.interact(() => f12Botao(ui, 'Aplicar').props.onPress());
  const w = ui.writes.at(-1);
  assert.equal(w.operation, 'investment');
  assert.equal(w.value.op, 'contribute');
  assert.equal(w.value.position_account_id, 'p1');
  assert.equal(w.value.from_account_id, 'a1');
  assert.equal(w.value.amount_cents, '1000');
});

test('F12: origem igual à posição bloqueia o salvar com o motivo escrito', () => {
  const ui = f12Folha();
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'MoneyField').props.onChangeCents(1000));
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'AccountPicker').props.onChange('p1'));
  assert.equal(f12Botao(ui, 'Aplicar').props.disabled, true);
  assert.ok(f12Motivo(ui, /Origem e destino precisam ser contas diferentes/));
  assert.deepEqual(ui.writes, []);
});

test('F12: resgatar além do disponível bloqueia dizendo quanto há; dentro do saldo grava redeem', () => {
  const ui = f12Folha('Resgatar');
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'MoneyField').props.onChangeCents(30001));
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'AccountPicker').props.onChange('a1'));
  assert.equal(f12Botao(ui, 'Resgatar').props.disabled, true);
  assert.ok(f12Motivo(ui, /Só há R\$ 300.00 disponíveis em Corretora/));
  ui.interact(() => f12Botao(ui, 'Resgatar').props.onPress?.());
  assert.deepEqual(ui.writes, []);
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'MoneyField').props.onChangeCents(30000));
  ui.interact(() => f12Botao(ui, 'Resgatar').props.onPress());
  assert.deepEqual(copia(ui.writes.at(-1).value), { op: 'redeem', position_account_id: 'p1', to_account_id: 'a1', amount_cents: '30000', occurred_on: ui.writes.at(-1).value.occurred_on, note: null });
});

test('F12: com valores ocultos o efeito não mostra o dinheiro', () => {
  const ui = f12Folha('Aplicar', { concealed: true });
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'MoneyField').props.onChangeCents(1000));
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'AccountPicker').props.onChange('a1'));
  const linha = ui.nodes().find((n: any) => n.type === 'ThemedText' && /Saldo:/.test(String(n.props.children)));
  assert.ok(linha);
  assert.doesNotMatch(String(linha.props.children), /\d/);
});

test('F12: o histórico abre ao tocar na posição, com Editar só no que o app criou e Desfazer confirmando antes', () => {
  const mov = (id: string, created: boolean) => ({ id, kind: 'contribution', amount_cents: 1000, occurred_on: '2026-09-01', status: 'cleared',
    counterparty_account_id: 'a1', counterparty_name: 'Nubank', transfer_id: `t-${id}`, created_transfer: created, revision: 2, created_at: '2026-09-01T10:00:00Z', description: null });
  const ui = screen('src/app/finance/net-worth.tsx', f12Opcoes({ investments: { positions: [f12Posicao], movements: [mov('m1', true), mov('m2', false)] } }));
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'Row' && n.props.title === 'Corretora').props.onPress());
  const linhas = deslizaveis(ui).filter((d: any) => d.props.acoes.some((x: any) => x.label === 'Desfazer o movimento'));
  assert.equal(linhas.length, 2);
  assert.deepEqual(copia(linhas[0].props.acoes.map((x: any) => x.label)), ['Editar', 'Desfazer o movimento']);
  assert.deepEqual(copia(linhas[1].props.acoes.map((x: any) => x.label)), ['Desfazer o movimento'], 'vinculado não edita valor nem data');
  ui.interact(() => linhas[0].props.acoes[1].onPress());
  assert.deepEqual(ui.writes, [], 'confirma antes de desfazer');
  assert.equal(ui.confirmations.length, 1);
  ui.interact(() => ui.confirmations[0]());
  assert.deepEqual(copia(ui.writes.at(-1).value), { op: 'undo', movement_id: 'm1', expected_revision: 2 });
});

test('F12: movimento cujo lançamento foi apagado aparece como tal e só oferece Desfazer', () => {
  const m = { id: 'm9', kind: 'redemption', amount_cents: null, occurred_on: '2026-09-01', status: null, counterparty_account_id: null,
    counterparty_name: null, transfer_id: null, deleted: true, created_transfer: true, revision: 1, created_at: '2026-09-01T10:00:00Z', description: null };
  const ui = screen('src/app/finance/net-worth.tsx', f12Opcoes({ investments: { positions: [f12Posicao], movements: [m] } }));
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'Row' && n.props.title === 'Corretora').props.onPress());
  const linha = deslizaveis(ui).find((d: any) => d.props.acoes.some((x: any) => x.label === 'Desfazer o movimento'));
  assert.deepEqual(copia(linha.props.acoes.map((x: any) => x.label)), ['Desfazer o movimento']);
  assert.ok(ui.nodes().some((n: any) => n.type === 'Row' && /Lançamento apagado/.test(String(n.props.subtitle))));
});

test('F12: editar abre a mesma folha com valor e data e manda edit com a revisão', () => {
  const m = { id: 'm1', kind: 'contribution', amount_cents: 1000, occurred_on: '2026-09-01', status: 'cleared', counterparty_account_id: 'a1',
    counterparty_name: 'Nubank', transfer_id: 't1', created_transfer: true, revision: 2, created_at: '2026-09-01T10:00:00Z', description: null };
  const ui = screen('src/app/finance/net-worth.tsx', f12Opcoes({ investments: { positions: [f12Posicao], movements: [m] } }));
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'Row' && n.props.title === 'Corretora').props.onPress());
  ui.interact(() => deslizaveis(ui).find((d: any) => d.props.acoes.some((x: any) => x.label === 'Editar')).props.acoes[0].onPress());
  assert.equal(ui.nodes().some((n: any) => n.type === 'Segmented'), false, 'a direção não muda depois de criado');
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'MoneyField').props.onChangeCents(1500));
  ui.interact(() => f12Botao(ui, 'Salvar').props.onPress());
  assert.deepEqual(copia(ui.writes.at(-1).value), { op: 'edit', movement_id: 'm1', amount_cents: '1500', occurred_on: '2026-09-01', expected_revision: 2 });
});

test('F12: a folha de bem lembra de registrar aportes na conta de investimento, só quando ela existe', () => {
  const com = screen('src/app/finance/net-worth.tsx', f12Opcoes());
  com.press('Novo bem');
  assert.match(String(com.nodes().find((n: any) => n.type === 'Field' && n.props.label === 'Tipo').props.hint), /conta de investimento, registre aportes nela/);
  const sem = screen('src/app/finance/net-worth.tsx', { forecastAccounts: [{ id: 'a1', name: 'Nubank', type: 'checking', archived: false }] });
  sem.press('Novo bem');
  assert.equal(sem.nodes().find((n: any) => n.type === 'Field' && n.props.label === 'Tipo').props.hint, undefined);
});

// ── F13: valor atual, aplicado, resultado e rendimento ────────────────────────────────────────────
const f13Posicao = { ...f12Posicao, value_cents: 33000, result_cents: 3000, result_quality: 'conhecido', received_cents: 500, last_valuation_on: '2026-10-01' };
const f13Abrir = (posicao: any = f12Posicao, extra: Record<string, unknown> = {}) => {
  const ui = screen('src/app/finance/net-worth.tsx', f12Opcoes({ ...extra, investments: { positions: [posicao], ...(extra.investments as any) } }));
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'Row' && n.props.title === 'Corretora').props.onPress());
  return ui;
};
const f13Linha = (ui: any, titulo: string) => ui.nodes().find((n: any) => n.type === 'Row' && n.props.title === titulo);
const f13Valor = (ui: any, cents: number) => ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'MoneyField').props.onChangeCents(cents));

test('F13: sem atualização de valor o resultado não tem número — só as palavras', () => {
  const ui = f13Abrir();
  const lista = f13Linha(ui, 'Corretora');
  assert.match(String(lista.props.subtitle), /sem atualização de valor/);
  assert.doesNotMatch(String(lista.props.subtitle), /Resultado/);
  const resultado = f13Linha(ui, 'Resultado');
  assert.equal(resultado.props.trailing, undefined, 'indisponível não escreve R$');
  assert.match(String(resultado.props.subtitle), /Atualize o valor para ver o resultado/);
  assert.doesNotMatch(String(resultado.props.subtitle), /R\$|\d/);
  assert.equal(f13Linha(ui, 'Recebido'), undefined);
});

test('F13: com atualização o bloco mostra valor atual, aplicado, resultado com a qualidade, recebido e a data', () => {
  const ui = f13Abrir(f13Posicao);
  assert.equal(f13Linha(ui, 'Valor atual').props.trailing.props.cents, 33000);
  assert.equal(f13Linha(ui, 'Valor atual').props.subtitle, 'atualizado em 01/10');
  assert.equal(f13Linha(ui, 'Aplicado').props.trailing.props.cents, 25000);
  assert.equal(f13Linha(ui, 'Resultado').props.trailing.props.cents, 3000);
  assert.match(String(f13Linha(ui, 'Resultado').props.subtitle), /tudo que foi aplicado e resgatado/);
  assert.equal(f13Linha(ui, 'Recebido').props.trailing.props.cents, 500);
  assert.match(String(f13Linha(ui, 'Corretora').props.subtitle), /Resultado \+/);
});

test('F13: formulário de valor incompleto não grava; data futura bloqueia com o motivo escrito', () => {
  const ui = f13Abrir();
  ui.press('Atualizar valor');
  assert.equal(f12Botao(ui, 'Atualizar valor').props.disabled, true);
  ui.interact(() => f12Botao(ui, 'Atualizar valor').props.onPress?.());
  assert.deepEqual(ui.writes, []);
  f13Valor(ui, 6000);
  assert.equal(f12Botao(ui, 'Atualizar valor').props.disabled, false);
  const campo = ui.nodes().find((n: any) => n.type === 'DatePickerField');
  assert.match(String(campo.props.max), /^\d{4}-\d{2}-\d{2}$/, 'o seletor não oferece o futuro');
  const amanha = new Date(Date.now() + 2 * 86400000);
  const br = `${String(amanha.getDate()).padStart(2, '0')}/${String(amanha.getMonth() + 1).padStart(2, '0')}/${amanha.getFullYear()}`;
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'DatePickerField').props.onChange(br));
  assert.equal(f12Botao(ui, 'Atualizar valor').props.disabled, true);
  assert.ok(f12Motivo(ui, /não pode ser futura/));
  ui.interact(() => f12Botao(ui, 'Atualizar valor').props.onPress?.());
  assert.deepEqual(ui.writes, []);
});

test('F13: atualizar valor manda valuation com a posição e o valor em centavos', () => {
  const ui = f13Abrir();
  ui.press('Atualizar valor');
  f13Valor(ui, 6000);
  ui.interact(() => f12Botao(ui, 'Atualizar valor').props.onPress());
  const w = ui.writes.at(-1);
  assert.equal(w.operation, 'investment_value');
  assert.deepEqual([w.value.op, w.value.position_account_id, w.value.value_cents], ['valuation', 'p1', '6000']);
});

test('F13: rendimento pede a conta (a posição ou uma conta comum, nunca o cartão) e manda income', () => {
  const ui = f13Abrir(f12Posicao, { forecastAccounts: [
    { id: 'a1', name: 'Nubank', type: 'checking', archived: false }, { id: 'p1', name: 'Corretora', type: 'investment', archived: false },
    { id: 'c1', name: 'Cartão', type: 'credit_card', archived: false }, { id: 'p2', name: 'Outra', type: 'investment', archived: false }] });
  ui.press('Rendimento recebido');
  assert.equal(ui.nodes().find((n: any) => n.type === 'Segmented').props.value, 'rendimento');
  f13Valor(ui, 300);
  assert.equal(f12Botao(ui, 'Rendimento recebido').props.disabled, true, 'sem a conta não grava');
  const picker = ui.nodes().find((n: any) => n.type === 'AccountPicker');
  assert.deepEqual(copia(picker.props.accounts.map((c: any) => c.id).sort()), ['a1', 'p1']);
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'AccountPicker').props.onChange('a1'));
  ui.interact(() => f12Botao(ui, 'Rendimento recebido').props.onPress());
  const v = ui.writes.at(-1).value;
  assert.deepEqual([v.op, v.position_account_id, v.to_account_id, v.amount_cents], ['income', 'p1', 'a1', '300']);
});

test('F13: informar aplicado sobre uma abertura que já existe pede confirmação antes de substituir', () => {
  const ui = f13Abrir({ ...f12Posicao, opening_on: '2026-08-15' });
  ui.press('Informar aplicado');
  f13Valor(ui, 20000);
  ui.interact(() => f12Botao(ui, 'Informar aplicado').props.onPress());
  assert.deepEqual(ui.writes, [], 'confirma antes de substituir');
  assert.equal(ui.confirmations.length, 1);
  ui.interact(() => ui.confirmations[0]());
  const v = ui.writes.at(-1).value;
  assert.deepEqual([v.op, v.value_cents], ['opening', '20000']);
  const sem = f13Abrir();
  sem.press('Informar aplicado');
  f13Valor(sem, 20000);
  sem.interact(() => f12Botao(sem, 'Informar aplicado').props.onPress());
  assert.equal(sem.writes.at(-1).value.op, 'opening', 'sem abertura anterior grava direto');
});

test('F13: no histórico a atualização edita e apaga (confirmando); o rendimento só se desfaz', () => {
  const base = { status: null, counterparty_account_id: null, counterparty_name: null, transfer_id: null, created_transfer: false, created_at: '2026-10-01T10:00:00Z', description: null };
  const val = { ...base, id: 'v1', kind: 'valuation', nature: 'valuation', amount_cents: 33000, occurred_on: '2026-10-01', revision: 3 };
  const ren = { ...base, id: 'm5', kind: 'income', nature: 'income', amount_cents: 500, occurred_on: '2026-09-30', status: 'cleared', transfer_id: 't5', created_transfer: true, revision: 1 };
  const ui = f13Abrir(f13Posicao, { investments: { movements: [val, ren] } });
  const rotulos = (d: any) => copia(d.props.acoes.map((x: any) => x.label));
  const linhaVal = deslizaveis(ui).find((d: any) => d.props.acoes.some((x: any) => x.label === 'Apagar'));
  assert.deepEqual(rotulos(linhaVal), ['Editar', 'Apagar']);
  const linhaRen = deslizaveis(ui).find((d: any) => d.props.acoes.some((x: any) => x.label === 'Desfazer o movimento'));
  assert.deepEqual(rotulos(linhaRen), ['Desfazer o movimento']);
  assert.ok(ui.nodes().some((n: any) => n.type === 'Row' && n.props.subtitle === 'Valor informado'));
  assert.ok(ui.nodes().some((n: any) => n.type === 'Row' && /Rendimento recebido na posição/.test(String(n.props.subtitle))));
  ui.interact(() => linhaVal.props.acoes[1].onPress());
  assert.deepEqual(ui.writes, [], 'confirma antes de apagar');
  ui.interact(() => ui.confirmations[0]());
  assert.deepEqual(copia(ui.writes.at(-1)), { operation: 'investment_value', value: { op: 'delete', valuation_id: 'v1', expected_revision: 3 } });
  ui.interact(() => linhaVal.props.acoes[0].onPress());
  f13Valor(ui, 34000);
  ui.interact(() => f12Botao(ui, 'Salvar').props.onPress());
  assert.deepEqual(copia(ui.writes.at(-1).value), { op: 'edit', valuation_id: 'v1', value_cents: '34000', as_of: '2026-10-01', expected_revision: 3 });
});

test('F13: a folha do bem lista as marcações, apaga com confirmação e não oferece apagar a única', () => {
  const bem = { id: 'b1', name: 'Casa', class: 'real_estate', is_liability: false, current_value_cents: 500000, acquired_at: null, archived: false };
  const duas = [
    { id: 'm2', value_cents: 500000, as_of: '2026-10-01', created_at: '2026-10-01T10:00:00Z' },
    { id: 'm1', value_cents: 450000, as_of: '2026-06-01', created_at: '2026-06-01T10:00:00Z' },
  ];
  const abre = (marcas: any[]) => {
    const ui = screen('src/app/finance/net-worth.tsx', { assets: [bem], assetValuations: marcas });
    ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'Row' && n.props.title === 'Casa').props.onPress());
    return ui;
  };
  const ui = abre(duas);
  assert.ok(ui.nodes().some((n: any) => n.type === 'Section' && n.props.title === 'Marcações de valor'));
  assert.equal(f13Linha(ui, '01/10/2026').props.subtitle, 'Valor atual');
  const apagar = deslizaveis(ui).find((d: any) => d.props.acoes.some((x: any) => x.label === 'Apagar'));
  ui.interact(() => apagar.props.acoes[0].onPress());
  assert.deepEqual(ui.writes, [], 'confirma antes de apagar');
  ui.interact(() => ui.confirmations[0]());
  assert.deepEqual(copia(ui.writes.at(-1)), { operation: 'deleteAssetValuation', value: 'm2' });
  const so = abre([duas[0]]);
  assert.equal(deslizaveis(so).some((d: any) => d.props.acoes.some((x: any) => x.label === 'Apagar')), false);
});

// ── F14: planejar por percentual ─────────────────────────────────────────────
const f14Estado = (plan: any = null) => ({
  revision: plan ? 1 : 0, month: '2026-09-01', period_start: '2026-09-01', period_end: '2026-09-30', income_cents: 500000, applications: [], plan,
});
const f14Plano = {
  version: 1, base_income_cents: 1000000, total_bp: 4500, total_cents: 450000, undistributed_bp: 5500, undistributed_cents: 550000,
  lines: [
    { position: 0, group: 'Essenciais', category: 'moradia', share_bp: 3000, amount_cents: 300000, current_default_cents: 250000, current_month_cents: null, spent_cents: 120000 },
    { position: 1, group: 'Essenciais', category: 'mercado', share_bp: 1500, amount_cents: 150000, current_default_cents: null, current_month_cents: null, spent_cents: 0 },
  ],
};
// o "servidor" da prévia: a mesma aritmética, devolvida no formato do banco
const f14Previa = (input: any) => {
  const a = allocateF14(Number(input.base_income_cents), input.lines.map((l: any) => l.share_bp));
  return { ok: true, errors: [], lines: input.lines.map((l: any, i: number) => ({ position: i, ...l, amount_cents: a.amounts[i] })),
    total_bp: a.totalBp, total_cents: a.totalCents, undistributed_bp: a.undistributedBp, undistributed_cents: a.undistributedCents };
};
const f14Abrir = (plan: any = null, extra: Record<string, unknown> = {}) => {
  const ui = screen('src/app/finance/budgets.tsx', { budgetPlan: { state: f14Estado(plan), preview: f14Previa }, ...extra });
  const menu = ui.nodes().find((n: any) => n.type === 'HeaderActions').props.menu.actions;
  ui.interact(() => menu.find((a: any) => a.label === 'Planejar por percentual').onPress());
  return ui;
};
const f14Botao = (ui: any, label: string) => ui.nodes().filter((n: any) => n.type === 'Button' && n.props.label === label).at(-1);
const f14Percentuais = (ui: any) => ui.nodes().filter((n: any) => n.type === 'TextField' && String(n.props.accessibilityLabel).startsWith('Percentual de'));
const f14Seletores = (ui: any) => ui.nodes().filter((n: any) => n.type === 'CategoryPicker' || n.type?.name === 'CategoryPicker');
const f14Texto = (ui: any, re: RegExp) => ui.nodes().some((n: any) => n.type === 'ThemedText' && re.test(String(n.props.children)));

test('F14: Planejar por percentual fica no menu de Orçamentos e abre o editor com a renda-base primeiro', () => {
  const ui = f14Abrir();
  const campos = ui.nodes().filter((n: any) => n.type === 'Field').map((n: any) => n.props.label);
  assert.deepEqual(campos.slice(0, 3), ['Renda-base', 'Grupo', 'Categoria']);
  assert.ok(f14Texto(ui, /Entrou R\$ 5000.00 em .* \(lançado, inclui previsto\)/), 'o denominador dito em palavras');
});

test('F14: formulário incompleto não grava nada e o Salvar fica desligado', () => {
  const ui = f14Abrir();
  assert.equal(f14Botao(ui, 'Salvar plano').props.disabled, true);
  assert.ok(f14Texto(ui, /Informe uma renda-base maior que zero/));
  ui.interact(() => f14Botao(ui, 'Salvar plano').props.onPress());
  assert.deepEqual(ui.writes, []);
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'MoneyField').props.onChangeCents(100000));
  assert.equal(f14Botao(ui, 'Salvar plano').props.disabled, true, 'sem percentuais ainda não grava');
  assert.deepEqual(ui.writes, []);
});

test('F14: 100,01% bloqueia o salvar com o motivo escrito', () => {
  const ui = f14Abrir();
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'MoneyField').props.onChangeCents(100000));
  ['50', '50', '0,01'].forEach((pct, i) => ui.interact(() => f14Percentuais(ui)[i].props.onChangeText(pct)));
  assert.equal(f14Botao(ui, 'Salvar plano').props.disabled, true);
  assert.ok(f14Texto(ui, /A soma dos percentuais é 100,01%: passa de 100%/));
  ui.interact(() => f14Botao(ui, 'Salvar plano').props.onPress());
  assert.deepEqual(ui.writes, []);
});

test('F14: a mesma categoria em duas linhas bloqueia o salvar', () => {
  const ui = f14Abrir();
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'MoneyField').props.onChangeCents(100000));
  ['10', '10', '10'].forEach((pct, i) => ui.interact(() => f14Percentuais(ui)[i].props.onChangeText(pct)));
  ui.interact(() => f14Seletores(ui)[0].props.onChange('Mercado'));
  ui.interact(() => f14Seletores(ui)[1].props.onChange('mercado'));
  assert.equal(f14Botao(ui, 'Salvar plano').props.disabled, true);
  assert.ok(f14Texto(ui, /A categoria mercado aparece em mais de uma linha/));
  assert.deepEqual(ui.writes, []);
});

test('F14: plano válido grava save com a revisão, os percentuais em pontos-base e mostra os reais do servidor', () => {
  const ui = f14Abrir();
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'MoneyField').props.onChangeCents(100100));
  ['33,33', '33,33', '33,34'].forEach((pct, i) => ui.interact(() => f14Percentuais(ui)[i].props.onChangeText(pct)));
  assert.equal(f14Botao(ui, 'Salvar plano').props.disabled, false);
  assert.ok(f14Texto(ui, /= R\$ 333.74 por mês/), 'o centavo que sobra vai à linha de maior resto');
  assert.ok(f14Texto(ui, /= R\$ 333.63 por mês/));
  assert.ok(f14Texto(ui, /Distribuído 100% da renda-base: R\$ 1001.00/));
  assert.ok(f14Texto(ui, /Não distribuído: 0% \(R\$ 0.00\)/));
  ui.interact(() => f14Botao(ui, 'Salvar plano').props.onPress());
  const w = ui.writes.at(-1);
  assert.equal(w.operation, 'budgetPlan');
  assert.equal(w.value.op, 'save');
  assert.equal(w.value.expected_revision, 0);
  assert.equal(w.value.base_income_cents, '100100');
  assert.deepEqual(copia(w.value.lines.map((l: any) => l.share_bp)), [3333, 3333, 3334]);
});

test('F14: aplicar lista antes → depois por categoria, marca o conflito e só manda o que está marcado', () => {
  const ui = f14Abrir(f14Plano);
  ui.interact(() => f14Botao(ui, 'Aplicar aos orçamentos').props.onPress());
  assert.ok(f14Texto(ui, /moradia: R\$ 2500.00 → R\$ 3000.00/));
  assert.ok(f14Texto(ui, /mercado: sem limite → R\$ 1500.00/));
  assert.ok(f14Texto(ui, /Já tem limite de R\$ 2500.00 para todo mês/), 'conflito marcado');
  const interruptores = ui.nodes().filter((n: any) => n.type === 'SwitchRow');
  ui.interact(() => interruptores[1].props.onValueChange(false));
  ui.interact(() => f14Botao(ui, 'Aplicar').props.onPress());
  assert.deepEqual(copia(ui.writes.at(-1).value), { op: 'apply', version: 1, categories: ['moradia'], scope: 'default', month: null });
});

test('F14: aplicar só no mês manda o mês e o alcance tem no máximo quatro opções', () => {
  const ui = f14Abrir(f14Plano);
  ui.interact(() => f14Botao(ui, 'Aplicar aos orçamentos').props.onPress());
  const alcance = ui.nodes().find((n: any) => n.type === 'Segmented');
  assert.ok(alcance.props.options.length <= 4);
  ui.interact(() => alcance.props.onChange('month'));
  ui.interact(() => f14Botao(ui, 'Aplicar').props.onPress());
  const v = ui.writes.at(-1).value;
  assert.equal(v.scope, 'month');
  assert.match(v.month, /^\d{4}-\d{2}-01$/);
});

test('F14: com valores ocultos a sugestão de renda não mostra dinheiro', () => {
  const ui = f14Abrir(null, { concealed: true });
  const linha = ui.nodes().find((n: any) => n.type === 'ThemedText' && /Entrou/.test(String(n.props.children)));
  assert.ok(linha);
  assert.match(String(linha.props.children), /Entrou •{6} em /);
});

const f15Params = { curFrom: '2026-10-01', curTo: '2026-10-31', prevFrom: '2026-09-01', prevTo: '2026-09-30', curLabel: 'outubro', prevLabel: 'setembro' };
const f15Dados = (previous: number, linhas: [string | null, string, number, number][]) => {
  const rows = linhas.map(([key, label, previous, current]) => ({ key, label, previous, current, delta: current - previous }));
  const cur = rows.reduce((s, r) => s + r.current, 0), prev = rows.reduce((s, r) => s + r.previous, 0);
  return { current: cur, previous: previous === -1 ? prev : previous, delta: cur - prev, percentBp: prev > 0 ? Math.round((cur - prev) * 10000 / prev) : null, rows };
};
const f15Tela = (spending: any) => screen('src/app/finance/why.tsx', { params: f15Params, spending });
const f15Linhas = (ui: any) => ui.nodes().filter((n: any) => n.type === 'Row' && n.props.onPress);

test('F15: a soma das linhas mostradas fecha a diferença do topo, com a linha sem categoria', () => {
  const dados = f15Dados(-1, [['lazer', 'lazer', 40000, 0], [null, 'Sem categoria', 0, 30000], ['mercado', 'mercado', 20000, 150000]]);
  const ui = f15Tela(dados);
  const soma = f15Linhas(ui).reduce((s: number, r: any) => s + r.props.trailing.props.cents, 0);
  assert.equal(soma, dados.delta);
  assert.ok(f15Linhas(ui).some((r: any) => r.props.title === 'Sem categoria'));
  assert.deepEqual(copia(f15Linhas(ui).map((r: any) => r.props.title)), ['mercado', 'lazer', 'Sem categoria']);
});

test('F15: sem gasto no período anterior não aparece percentual', () => {
  const ui = f15Tela(f15Dados(-1, [['mercado', 'mercado', 0, 5000]]));
  const textos = ui.nodes().filter((n: any) => n.type === 'ThemedText').map((n: any) => JSON.stringify(n.props.children));
  assert.ok(textos.some((x: string) => /sem gasto em setembro/.test(x)));
  assert.ok(!textos.some((x: string) => /%/.test(x)));
});

test('F15: tocar numa linha oferece os dois períodos com as bordas exatas e o "sem X" da dimensão', () => {
  const ui = f15Tela(f15Dados(-1, [[null, 'Sem categoria', 1000, 3000]]));
  ui.interact(() => f15Linhas(ui)[0].props.onPress());
  assert.deepEqual(copia(ui.actions.map((a: any) => a.label)), ['Ver em setembro', 'Ver em outubro']);
  ui.interact(() => ui.actions[0].onPress());
  ui.interact(() => ui.actions[1].onPress());
  const [antes, depois] = ui.navigations.slice(-2).map((n: any) => copia(n));
  assert.equal(antes.pathname, '/finance/transactions');
  assert.deepEqual(antes.params, { from: '2026-09-01', to: '2026-09-30', kind: 'expense', lente: 'gasto', category: 'none' });
  assert.deepEqual(depois.params, { from: '2026-10-01', to: '2026-10-31', kind: 'expense', lente: 'gasto', category: 'none' });
});

test('F15: linhas sem mudança só aparecem em "Ver todas"', () => {
  const ui = f15Tela(f15Dados(-1, [['mercado', 'mercado', 0, 5000], ['lazer', 'lazer', 700, 700]]));
  assert.equal(f15Linhas(ui).length, 1);
  assert.ok(ui.nodes().some((n: any) => n.type === 'Button' && /Ver todas/.test(String(n.props.label))));
});

test('F17: aviso de fatura e de conta abre o ITEM; ref que não é uuid cai na lista de antes', () => {
  const U = '6f1c2a3e-1b2c-4d5e-8f90-a1b2c3d4e5f6';
  const alertas = [
    { id: 'a1', workspace_id: 'w', kind: 'invoice_due', ref: U, sent_on: '2026-10-05', channel: 'push', created_at: '2026-10-05T12:00:00Z' },
    { id: 'a2', workspace_id: 'w', kind: 'bill_due', ref: U, sent_on: '2026-10-05', channel: 'push', created_at: '2026-10-05T11:00:00Z' },
    { id: 'a3', workspace_id: 'w', kind: 'bill_due', ref: 'texto-cru', sent_on: '2026-10-05', channel: 'push', created_at: '2026-10-05T10:00:00Z' },
    { id: 'a4', workspace_id: 'w', kind: 'negative_forecast', ref: 'x', sent_on: '2026-10-05', channel: 'push', created_at: '2026-10-05T09:00:00Z' },
  ];
  const ui = screen('src/app/profile/alerts.tsx', { alerts: alertas });
  const linhas = () => ui.nodes().filter((n: any) => n.type?.name === 'Row' || n.type === 'Row');
  const abrir = (i: number) => ui.interact(() => linhas()[i].props.onPress());
  abrir(0);
  assert.deepEqual(copia(ui.navigations.at(-1)), { pathname: '/finance/invoice/[id]', params: { id: U } });
  abrir(1);
  assert.deepEqual(copia(ui.navigations.at(-1)), { pathname: '/finance/[txId]', params: { txId: U } });
  abrir(2);
  assert.deepEqual(copia(ui.navigations.at(-1)), { pathname: '/' }, 'ref inválido nunca vira rota montada');
  const antes = ui.navigations.length;
  abrir(3);
  assert.equal(ui.navigations.length, antes, 'aviso sem item não navega');
});

test('F17: fatura que não existe mais mostra "Isto não existe mais" com o caminho para as faturas', () => {
  const ui = screen('src/app/finance/invoice/[id].tsx', { invoiceMissing: true });
  const vazio = ui.nodes().find((n: any) => n.type === 'EmptyState');
  assert.equal(vazio.props.title, 'Isto não existe mais');
  assert.equal(ui.nodes().some((n: any) => n.type === 'ErrorBand'), false, 'não é erro genérico');
  ui.interact(() => vazio.props.action.onPress());
  assert.deepEqual(copia(ui.navigations.at(-1)), { replace: '/finance/invoices' });
});

test('Começar: pular não grava nada e salvar cria exatamente uma conta pela RPC do hook', () => {
  const doTipo = (ui: any, nome: string) => ui.nodes().find((n: any) => n.type === nome || n.type?.name === nome);
  const pular = screen('src/app/finance/comecar.tsx', { params: {}, forecastAccounts: [] });
  pular.interact(() => doTipo(pular, 'FormularioDeConta').props.onPular());
  assert.equal(pular.writes.length, 0);
  assert.deepEqual(copia(pular.navigations.at(-1)), { back: true });

  const ui = screen('src/components/finance/formulario-de-conta.tsx', { componente: 'FormularioDeConta', forecastAccounts: [], props: {
    tipo: 'checking', contas: [], payerId: null, onCriada: () => {}, onPular: () => {}, rotuloPular: 'Agora não',
  } });
  assert.equal(ui.button('Salvar').props.disabled, true, 'sem nome não salva');
  ui.interact(() => { const f = doTipo(ui, 'AccountFormFields').props; f.onChange({ ...f.form, name: 'Conta do banco', saldoCents: 12345 }); });
  ui.interact(() => { const salvar = ui.button('Salvar').props.onPress; salvar(); salvar(); });
  assert.equal(ui.writes.length, 1, 'duplo toque é uma escrita só');
  assert.equal(ui.writes[0].operation, 'createAccount');
  assert.equal(ui.writes[0].value.name, 'Conta do banco');
  assert.equal(ui.writes[0].value.initial_balance_cents, 12345);
  assert.equal(ui.writes[0].value.type, 'checking');
});

test('F22: duplicar uma parcela paga no cartão abre o formulário à vista, sem vínculo e sem gravar', () => {
  const tx = {
    id: 'p3', kind: 'expense', amount_cents: 5249, occurred_at: '2026-08-10', description: 'Fone (3/10)', merchant: 'Loja',
    category: 'lazer', account_id: 'cartao', status: 'cleared', source: 'import', created_at: '2026-08-10T12:00:00Z',
    recurring_id: null, installment_plan_id: 'plano', installment_no: 3, invoice_id: 'fatura', due_at: '2026-09-10',
    debt_id: null, pays_invoice_id: null, payment_method: 'credit', edit_revision: 4,
  };
  const ui = screen('src/app/finance/[txId].tsx', { txs: [tx], params: { txId: 'p3' } });
  const menu = ui.nodes().find((n: any) => n.type === 'HeaderActions')?.props.menu;
  ui.interact(() => menu.actions.find((a: any) => a.label === 'Duplicar').onPress());
  const destino = copia(ui.navigations.at(-1));
  assert.equal(destino.pathname, '/finance/lancar');
  assert.equal(destino.params.tipo, 'uma');
  assert.equal(destino.params.description, 'Fone');
  assert.equal(destino.params.amount, '5249');
  assert.equal(destino.params.conta, 'cartao');
  assert.match(destino.params.nota, /Cópia da parcela 3.* à vista/);
  const vinculos = ['id', 'origem', 'papel', 'plano', 'fatura', 'invoice', 'recurring', 'debt', 'status', 'due_at', 'source'];
  assert.deepEqual(Object.keys(destino.params).filter((k) => vinculos.includes(k)), [], 'nenhum parâmetro de vínculo viaja');
  assert.ok(!JSON.stringify(destino).includes('fatura') && !JSON.stringify(destino).includes('plano'));
  assert.equal(ui.writes.length, 0, 'duplicar só abre o formulário: quem grava é o Salvar');
});

test('F22: usar um favorito preenche o formulário de criação e não grava lançamento nenhum', () => {
  const favorito = { id: 'f1', name: 'Café', use_count: 2, archived: false,
    modelo: { kind: 'expense', description: 'Café', amount_cents: 1500, category: 'alimentação', account_id: 'a1', merchant: 'Padaria', payment_method: 'pix' } };
  const ui = screen(lancarFile, { params: { tipo: 'uma' }, favoritos: [favorito] });
  const fileira = ui.nodes().find((n: any) => n.type === 'FavoritosDoLancamento');
  assert.ok(fileira, 'a fileira de favoritos está no topo do formulário de criação');
  ui.interact(() => fileira.props.aoUsar(ui.inRealm(favorito)));
  const corpo = ui.nodes().find((n: any) => n.type === 'FormularioDoLancamento');
  assert.equal(corpo.props.comum.descricao, 'Café');
  assert.equal(corpo.props.comum.valorCents, 1500);
  assert.equal(corpo.props.comum.contaId, 'a1');
  assert.equal(corpo.props.comum.estabelecimento, 'Padaria');
  assert.match(corpo.props.comum.dataBR, /^\d{2}\/\d{2}\/\d{4}$/, 'a data é a de hoje, explícita');
  assert.deepEqual(ui.writes.map((w: any) => w.operation), ['usouFavorito'], 'só conta o uso; nenhum lançamento é gravado');
});

test('F22: Salvar como favorito pede o nome e grava o modelo, não um lançamento', () => {
  const ui = screen('src/components/finance/formulario-do-lancamento.tsx', { componente: 'FormularioDoLancamento',
    props: { comum: { kind: 'expense', descricao: 'Café', valorCents: 1500, contaId: null, dataBR: '05/10/2026', categoria: 'alimentação' },
      registrarComum() {}, registrarEstado() {}, onSalvo() {}, onFechar() {} } });
  const botao = ui.nodes().find((n: any) => n.type === 'Button' && n.props.label === 'Salvar como favorito');
  assert.ok(botao, 'o botão existe na criação');
  ui.interact(() => botao.props.onPress());
  assert.equal(ui.nomesPedidos[0]?.padrao, 'Café', 'o nome padrão é o título');
  ui.interact(() => ui.nomesPedidos[0].aoConfirmar('Café da manhã'));
  assert.deepEqual(ui.writes.map((w: any) => w.operation), ['salvarFavorito']);
  assert.equal(ui.writes[0].value.name, 'Café da manhã');
  assert.equal(ui.writes[0].value.modelo.amount_cents, 1500);
  assert.ok(!('occurred_at' in ui.writes[0].value.modelo) && !('invoice_id' in ui.writes[0].value.modelo), 'o modelo não leva data nem vínculo');
});

test('Row: no iPhone o valor que encolheu numa medida estreita remonta ao mudar a largura (05/10/2026)', () => {
  // "−R$ 1.202,67" do Fundacred ficou minúsculo numa busca: `adjustsFontSizeToFit` encolhido numa
  // passada estreita não volta a crescer. A fronteira remonta o valor (key) quando o modo ou a
  // largura mudam, e não encolhe nada antes da primeira medida.
  const ui = screen('src/components/ui/row.tsx', { componente: 'Row', fontScale: 3.12, props: {
    title: 'Fundacred', subtitle: 'contas · Nubank Conta', inlineValue: true, chevron: true,
    trailing: { type: 'Money', props: { cents: -120267 } },
  } });
  const chave = () => ui.nodes().find(n => n.type === 'View' && n.props.children?.type === 'DinheiroEncolhe.Provider')?.key;
  const valor = () => ui.nodes().find(n => n.type === 'DinheiroEncolhe.Provider').props.value;
  assert.equal(valor(), false, 'antes da medida, sem ajuste de fonte');
  const medir = (width: number) => {
    const row = ui.nodes().find(n => n.type === 'View' && n.props.onLayout);
    ui.interact(() => row.props.onLayout({ nativeEvent: { layout: { width } } }));
  };
  medir(120);
  const estreita = chave();
  assert.equal(valor(), true);
  medir(402);
  assert.notEqual(chave(), estreita, 'a largura nova remonta o valor e zera a escala nativa');
});

test('F22: favorito ou cópia com a conta arquivada abre com o campo vazio, o aviso e o Salvar livre (05/10/2026)', () => {
  // QA iOS: o seletor mostrava "Sem conta" e o Salvar seguia travado pelo id escondido da conta
  // arquivada ("Esta conta não está disponível"), até a pessoa escolher a conta de novo.
  const ui = screen('src/components/finance/formulario-do-lancamento.tsx', { componente: 'FormularioDoLancamento', executarEfeitos: true,
    forecastAccounts: [{ id: 'ativa', name: 'Nubank Conta', type: 'checking' }],
    props: { comum: { kind: 'expense', descricao: 'Café', valorCents: 1500, contaId: 'arquivada', dataBR: '05/10/2026', categoria: 'alimentação' },
      registrarComum() {}, registrarEstado() {}, onSalvo() {}, onFechar() {} } });
  ui.interact(() => {});
  const campo = ui.nodes().find((n: any) => n.type === 'Field' && n.props.label === 'Conta');
  assert.equal(campo.props.hint, 'A conta original não está mais ativa: escolha outra.');
  assert.equal(ui.nodes().find((n: any) => n.type === 'PaymentMethodField')?.props.error, undefined, 'a conta que saiu não vira erro escondido');
  const salvar = ui.nodes().find((n: any) => n.type === 'Button' && n.props.label === 'Salvar');
  assert.notEqual(salvar?.props.disabled, true, 'o Salvar não fica preso a uma conta que a pessoa não vê');
});

test('detalhe do lançamento: sem fatura, compra nem série as consultas desligadas não prendem o esqueleto', () => {
  const ui = screen('src/app/finance/[txId].tsx', { params: { txId: 'tx-1' } });
  assert.ok(ui.nodes().find((n: any) => n.type === 'HeaderActions'), 'o detalhe abre, sem esqueleto à espera das três');
  assert.ok(!ui.nodes().some((n: any) => n.type === 'Skeleton'));
  // Puxar para atualizar refaz só o item: não há fatura, compra nem série para refazer.
  ui.interact(() => ui.nodes().find((n: any) => n.type === 'Screen').props.onRefresh());
  assert.deepEqual(ui.refetches, ['transaction']);
});

test('detalhe do lançamento: fatura e série enxutas desenham o "Faz parte de" e entram no refresh', () => {
  const tx = { id: 'tx-9', kind: 'expense', amount_cents: 4500, occurred_at: '2026-09-15', description: 'Assinatura', category: 'lazer', account_id: null, status: 'cleared', source: 'app', created_at: '2026-09-15T12:00:00Z', recurring_id: 's1', installment_plan_id: null, invoice_id: 'inv-1', debt_id: null };
  const ui = screen('src/app/finance/[txId].tsx', { txs: [tx], params: { txId: 'tx-9' }, recurring: [{ id: 's1', rrule: 'FREQ=MONTHLY', amount_cents: 4500 }] });
  const rows = ui.nodes().filter((n: any) => n.type === 'Row').map((n: any) => n.props.title);
  assert.ok(rows.some((t: string) => /^Fatura de /.test(t)), 'fatura pelo cabeçalho enxuto');
  assert.ok(rows.some((t: string) => /^Repete /.test(t)), 'série pelo id');
  ui.interact(() => ui.nodes().find((n: any) => n.type === 'Screen').props.onRefresh());
  assert.deepEqual(ui.refetches.sort(), ['invoice-head', 'serie-do-lancamento', 'transaction']);
});

// O harness não expande componentes aninhados: o ramo `?conta=` de `reminder-form` só devolve
// `<BillReminderForm/>`, então o formulário é renderizado direto, com as props que o ramo passa.
const lembreteDeConta = (props: { conta: string; todas?: string; nome: string }) =>
  screen('src/components/reminders/bill-reminder-form.tsx', { componente: 'BillReminderForm', props });
const LEMBRETE_ID = '11111111-1111-1111-1111-111111111111';

test('Lembrete de conta: salva os avisos no alvo escolhido, com o padrão no dia às 9h', () => {
  const ui = lembreteDeConta({ conta: `transaction_id:${LEMBRETE_ID}`, nome: 'Aluguel' });
  ui.press('Salvar');
  assert.deepEqual(copia(ui.writes.at(-1)), { operation: 'saveBillReminder',
    value: { alvo: { transaction_id: LEMBRETE_ID }, avisos: [{ days_before: 0, at_time: '09:00' }], channel: 'push' } });
});

test('Lembrete de conta: "Só esta | Todas as próximas" só aparece quando há série', () => {
  const opcoes = (ui: any) => ui.nodes().find((n: any) => n.type === 'Segmented')?.props.options.map((o: any) => o.label);
  const sem = lembreteDeConta({ conta: `transaction_id:${LEMBRETE_ID}`, nome: 'Aluguel' });
  assert.equal(opcoes(sem)?.includes('Todas as próximas'), false);
  const com = lembreteDeConta({ conta: `transaction_id:${LEMBRETE_ID}`, todas: `recurring_id:${LEMBRETE_ID}`, nome: 'Academia' });
  assert.ok(opcoes(com).includes('Todas as próximas'));
  com.interact((nodes: any[]) => nodes.find((n) => n.type === 'Segmented' && n.props.value === 'so').props.onChange('todas'));
  com.press('Salvar');
  assert.deepEqual(copia(com.writes.at(-1)?.value.alvo), { recurring_id: LEMBRETE_ID });
});

test('Lembrete de conta: ocorrência de série com lembrete da série abre em "Todas" com os avisos salvos', () => {
  const com = screen('src/components/reminders/bill-reminder-form.tsx', { componente: 'BillReminderForm',
    props: { conta: `transaction_id:${LEMBRETE_ID}`, todas: `recurring_id:${LEMBRETE_ID}`, nome: 'Academia' },
    billReminders: [{ alvo: { recurring_id: LEMBRETE_ID }, title: 'Academia', channel: 'push', avisos: [{ days_before: 3, at_time: '08:00' }], next_due: null }] });
  assert.equal(com.nodes().find((n: any) => n.type === 'Segmented' && n.props.options.length === 2).props.value, 'todas');
  assert.ok(com.nodes().some((n: any) => n.type === 'Button' && n.props.label === 'Remover lembrete'));
  com.press('Salvar');
  assert.deepEqual(copia(com.writes.at(-1)?.value), { alvo: { recurring_id: LEMBRETE_ID }, avisos: [{ days_before: 3, at_time: '08:00' }], channel: 'push' });
});

test('Lembrete de conta: Salvar espera os lembretes carregarem (não troca o conjunto pelo padrão)', () => {
  const ui = screen('src/components/reminders/bill-reminder-form.tsx', { componente: 'BillReminderForm', billRemindersPending: true,
    props: { conta: `transaction_id:${LEMBRETE_ID}`, nome: 'Aluguel' } });
  assert.ok(ui.nodes().some((n: any) => n.type === 'Button' && n.props.label === 'Salvar' && n.props.disabled));
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'Button' && n.props.label === 'Salvar').props.onPress());
  assert.equal(ui.writes.filter((w: any) => w.operation === 'saveBillReminder').length, 0);
});

test('Recorrentes: "Lembrar" só em série de despesa', () => {
  const serie = (kind: string) => ({ id: 'rec-1', description: 'Algo', kind, amount_cents: 12000, rrule: 'FREQ=MONTHLY;BYMONTHDAY=15', dtstart: '2026-01-15', next_run_at: '2026-10-15T12:00:00Z', active: true, account_id: null, category: 'x' });
  const acoes = (kind: string) => {
    const ui = screen('src/app/finance/recurring.tsx', { recurring: [serie(kind)] });
    ui.interact((nodes: any[]) => nodes.find((n) => (n.type === 'Pressable' || n.type === 'PressableScale') && n.props.onLongPress).props.onLongPress());
    return ui.actions.map((a: any) => a.label);
  };
  assert.ok(acoes('expense').includes('Lembrar'));
  assert.ok(!acoes('income').includes('Lembrar'));
});

test('Lembrete de conta: cada aviso é Quando + Hora em linhas, e o campo abre no lugar', () => {
  const ui = lembreteDeConta({ conta: `transaction_id:${LEMBRETE_ID}`, nome: 'Aluguel' });
  const linha = (titulo: string) => ui.nodes().find((n: any) => n.type === 'Row' && n.props.title === titulo);
  const valor = (titulo: string) => linha(titulo).props.trailing.props.children;
  assert.equal(valor('Quando'), 'No dia');
  assert.equal(valor('Hora'), '09:00');
  assert.equal(ui.nodes().some((n: any) => n.type === 'QuantityField'), false, 'fechado: só o valor');
  assert.equal(ui.nodes().some((n: any) => n.type === 'Row' && n.props.title === 'Tirar este aviso'), false, 'um aviso só não se tira');
  ui.interact(() => linha('Quando').props.onPress());
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'QuantityField').props.onChange(1));
  assert.equal(valor('Quando'), '1 dia antes');
  ui.press('Adicionar aviso');
  assert.equal(ui.nodes().filter((n: any) => n.type === 'Row' && n.props.title === 'Tirar este aviso').length, 2);
  ui.interact((nodes: any[]) => nodes.find((n) => n.type === 'Row' && n.props.title === 'Tirar este aviso').props.onPress());
  ui.press('Salvar');
  assert.deepEqual(copia(ui.writes.at(-1)?.value.avisos), [{ days_before: 0, at_time: '09:00' }]);
});

test('Lançamento: "Lembrar" só em despesa (receita e transferência ficam fora)', () => {
  const base = { kind: 'expense', status: 'pending', amount_cents: 500, description: 'Conta', category: 'x', account_id: 'a',
    counterparty_account_id: null, occurred_at: '2026-10-02', created_at: '2026-10-02T12:00:00Z', invoice_id: null,
    installment_plan_id: null, recurring_id: null, debt_id: null, pays_invoice_id: null, pix_fee_for_transaction_id: null };
  const rotulos = (extra: object) => {
    const ui = screen('src/app/finance/[txId].tsx', { txs: [{ id: 't', ...base, ...extra }], params: { txId: 't' } });
    return ui.nodes().find((n: any) => n.type === 'HeaderActions').props.menu.actions.map((a: any) => a.label);
  };
  assert.ok(rotulos({}).includes('Lembrar'));
  for (const extra of [{ kind: 'income' }, { kind: 'transfer', counterparty_account_id: 'b' }]) {
    assert.ok(!rotulos(extra).some((l: string) => l.startsWith('Lembrar')), JSON.stringify(extra));
  }
});

test('Lembretes: a seção Contas lista cada conta lembrada e abre a edição', () => {
  const ID = '11111111-1111-1111-1111-111111111111';
  const ui = screen('src/app/reminders.tsx', { billReminders: [
    { alvo: { debt_id: ID }, title: 'Carro', channel: 'push', avisos: [{ days_before: 1, at_time: '09:00' }], next_due: '2026-10-10' },
    { alvo: { transaction_id: ID }, title: 'Aluguel', channel: 'push', avisos: [{ days_before: 0, at_time: '09:00' }], next_due: null },
  ] });
  assert.ok(ui.nodes().some((n: any) => n.type === 'Section' && n.props.title === 'Contas'));
  const linha = (t: string) => ui.nodes().find((n: any) => n.type === 'Row' && n.props.title === t);
  assert.ok(linha('Aluguel').props.subtitle.includes('sem próximo vencimento'));
  ui.interact(() => linha('Carro').props.onPress());
  assert.deepEqual(copia(ui.navigations.at(-1)),
    { pathname: '/reminder-form', params: { conta: `debt_id:${ID}`, nome: 'Carro' } });
});

test('Lembretes: só com lembrete de conta, mostra Contas e não o vazio', () => {
  const ID = '11111111-1111-1111-1111-111111111111';
  const ui = screen('src/app/reminders.tsx', { reminders: [], billReminders: [
    { alvo: { debt_id: ID }, title: 'Carro', channel: 'push', avisos: [{ days_before: 1, at_time: '09:00' }], next_due: '2026-10-10' },
  ] });
  assert.ok(ui.nodes().some((n: any) => n.type === 'Section' && n.props.title === 'Contas'));
  assert.ok(!ui.nodes().some((n: any) => n.type === 'EmptyState'));
});

test('Apagar: ocorrência, parcela e pagamento perguntam o alcance; avulso confirma como antes', () => {
  const base = { kind: 'expense', status: 'pending', amount_cents: 500, description: 'Conta', category: 'x', account_id: 'a',
    counterparty_account_id: null, occurred_at: '2026-10-02', created_at: '2026-10-02T12:00:00Z', invoice_id: null,
    installment_plan_id: null, recurring_id: null, debt_id: null, pays_invoice_id: null, pix_fee_for_transaction_id: null };
  const apagarDe = (extra: object) => {
    const ui = screen('src/app/finance/[txId].tsx', { txs: [{ id: 't', ...base, ...extra }], params: { txId: 't' } });
    const acoes = ui.nodes().find((n: any) => n.type === 'HeaderActions').props.menu.actions;
    assert.equal(acoes.filter((a: any) => a.label.startsWith('Apagar')).length, 1, 'um "Apagar" só no menu');
    ui.interact(() => acoes.find((a: any) => a.label === 'Apagar').onPress());
    return ui;
  };
  for (const [extra, tipo] of [[{ recurring_id: 's' }, 'occurrence'], [{ installment_plan_id: 'p', installment_no: 2 }, 'installment'], [{ debt_id: 'd' }, 'debt_payment']] as const) {
    const ui = apagarDe(extra);
    assert.deepEqual({ ...ui.writes.find((w: any) => w.operation === 'apagarComAlcance')?.value }, { tipo, id: 't', nome: 'Conta' }, tipo);
    assert.equal(ui.confirmations.length, 0, 'a pergunta é do hook, sem confirmação avulsa');
  }
  for (const extra of [{}, { pix_fee_for_transaction_id: 'x' }, { pays_invoice_id: 'f' }]) {
    const avulso = apagarDe(extra);
    assert.ok(!avulso.writes.some((w: any) => w.operation === 'apagarComAlcance'), 'avulso não pergunta alcance');
    assert.equal(avulso.confirmations.length, 1, 'avulso confirma');
  }
});

test('Apagar pelo contrato: Recorrentes, Parceladas e Dívidas perguntam o alcance no hook', () => {
  const abrirApagar = (ui: any) => {
    ui.interact((nodes: any[]) => nodes.find((n) => (n.type === 'Pressable' || n.type === 'PressableScale') && n.props.onLongPress).props.onLongPress());
    ui.interact(() => ui.actions.find((a: any) => a.label === 'Apagar' || a.label === 'Apagar por completo' || a.label === 'Apagar a compra inteira').onPress());
    return { ...ui.writes.find((w: any) => w.operation === 'apagarComAlcance')?.value };
  };
  const serie = screen('src/app/finance/recurring.tsx', { recurring: [{ id: 'rec-1', description: 'Academia', kind: 'expense', amount_cents: 12000, rrule: 'FREQ=MONTHLY;BYMONTHDAY=15', dtstart: '2026-01-15', next_run_at: '2026-10-15T12:00:00Z', active: true, account_id: null, category: 'saúde' }] });
  assert.deepEqual(abrirApagar(serie), { tipo: 'recurring', id: 'rec-1', nome: 'Academia' });
  assert.equal(serie.confirmations.length, 0);
  const parcelas = [1, 2, 3].map((n) => ({ id: `t${n}`, installment_no: n, amount_cents: 30000, occurred_at: `2026-0${6 + n}-10`, status: n === 1 ? 'cleared' : 'pending', invoice_id: null }));
  const compra = screen('src/app/finance/installments.tsx', {
    plans: [{ id: 'p1', title: 'tv', description: 'tv', merchant: null, category: 'casa', account_id: null, total_cents: 90000, installments: 3, installment_cents: 30000, first_occurred_at: '2026-07-10', active: true, paid: 1, remaining_cents: 60000, locked: 1, locked_cents: 30000, locked_paid: 1, parcels: parcelas }],
  });
  const plano = abrirApagar(compra);
  assert.equal(plano.tipo, 'plan');
  assert.equal(plano.id, 'p1');
  const divida = abrirApagar(screen(debtsFile, { debts: [carro] }));
  assert.equal(divida.tipo, 'debt');
  assert.equal(divida.id, carro.id);
});

test('Prevista: "Só esta" pula a data; "Todas" apaga a série pela âncora', () => {
  const linha = { origin: 'recurring', ref_id: 'rec-1', due_date: '2026-10-15', description: 'Academia', amount_cents: 12000, kind: 'expense', status: 'pending' };
  const apagar = (escolha: string) => {
    const ui = screen('src/components/finance/expected-ledger-lines.tsx', { hook: 'useAcoesDaPrevista', hookArgs: [{ month: '2026-10', pagar() {} }] });
    ui.interact(() => ui.editor().acoes(linha).find((a: any) => a.label === 'Apagar').onPress());
    ui.interact(() => ui.actions.find((a: any) => a.label === escolha).onPress());
    return ui;
  };
  const so = apagar('Só esta');
  assert.ok(so.writes.some((w: any) => w.operation === 'skipOccurrence'));
  assert.ok(!so.writes.some((w: any) => w.operation === 'apagarComAlcance'));
  const todas = apagar('Todas');
  assert.deepEqual({ ...todas.writes.find((w: any) => w.operation === 'apagarComAlcance')?.value },
    { tipo: 'recurring', id: 'rec-1', nome: 'Academia', ancora: '2026-10-15', alcance: 'all' });
});

test('Lembrete aberto como ocorrência: Apagar pergunta o alcance; pela lista, confirma como antes', () => {
  const lembrete = { id: 'r1', title: 'Remédio', active: true, next_run_at: '2026-10-05T12:00:00Z', recurrence: { freq: 'DAILY' }, parent_reminder_id: null };
  const apagar = (umaOcorrenciaAberta: boolean) => {
    const ui = screen('src/app/reminder-form.tsx', { componente: 'ReminderForm', props: { editing: lembrete, umaOcorrenciaAberta, tablet: false } });
    ui.interact(() => ui.button('Apagar').props.onPress());
    return ui;
  };
  const ocorrencia = apagar(true);
  assert.deepEqual({ ...ocorrencia.writes.find((w: any) => w.operation === 'apagarComAlcance')?.value }, { tipo: 'reminder', id: 'r1', nome: 'Remédio' });
  assert.equal(ocorrencia.confirmations.length, 0);
  const lista = apagar(false);
  assert.ok(!lista.writes.some((w: any) => w.operation === 'apagarComAlcance'));
  assert.equal(lista.confirmations.length, 1);
});

// ---- Carência na ficha da dívida ----
const carenciaSheet = (divida: any, opts: Parameters<typeof screen>[1] = {}) =>
  screen('src/components/finance/carencia-sheet.tsx', { componente: 'CarenciaSheet', ...opts, props: { visivel: true, onClose: () => {}, divida } });
const qtd = (ui: any, rotulo: string) => ui.nodes().find((n: any) => n.type === 'QuantityField' && n.props.accessibilityLabel === rotulo);
const botaoConfirmar = (ui: any) => ui.nodes().find((n: any) => n.type === 'TaskHeader').props.action;
const previaFixa = { next_before: '2026-11-05', next_after: '2027-02-05', installment_before: 147000, installment_after: 156240,
  balance_before: 100000, balance_after: 110000, end_before: '2029-09-05', end_after: '2029-12-05', with_interest: false };

test('Carência: o menu da ficha tem "Pausar pagamentos…" e a dívida quitada não', () => {
  const ui = screen(debtsFile, { create: false, debts: [carro], params: { id: 'd1' } });
  const menu = ui.nodes().find((n: any) => n.type === 'HeaderActions').props.menu.actions;
  assert.ok(menu.some((a: any) => a.label === 'Pausar pagamentos…'));
  const quitada = screen(debtsFile, { create: false, debts: [{ ...carro, remaining_cents: 0 }], params: { id: 'd1' } });
  assert.ok(!quitada.nodes().find((n: any) => n.type === 'HeaderActions').props.menu.actions.some((a: any) => a.label === 'Pausar pagamentos…'));
  ui.interact(() => menu.find((a: any) => a.label === 'Pausar pagamentos…').onPress());
  assert.ok(ui.nodes().some((n: any) => n.type?.name === 'CarenciaSheet'), 'a folha abre');
});

test('Carência: a folha abre na próxima em aberto com 1 mês e mostra o antes/depois (parcela fixa sem parcela e saldo)', () => {
  const ui = carenciaSheet(carro, { carenciaPrevia: previaFixa });
  assert.deepEqual(copia(ui.previasDeCarencia.at(-1)), ['d1', 9, 1]);
  assert.equal(qtd(ui, 'Parcela em que a carência começa').props.min, 9);
  const textos = ui.nodes().filter((n: any) => n.type === 'ThemedText').map((n: any) => String(n.props.children));
  assert.ok(textos.includes('Próxima parcela: 05/11/2026 → 05/02/2027'));
  assert.ok(textos.includes('Termina em 09/2029 → 12/2029'));
  assert.ok(!textos.some((t: string) => /^Parcela:|^Saldo:/.test(t)));
  ui.interact(() => qtd(ui, 'Meses de carência').props.onChange(3));
  assert.deepEqual(copia(ui.previasDeCarencia.at(-1)), ['d1', 9, 3]);
});

test('Carência: com juros mostra parcela e saldo e a parcela inicial fica fixa; "Confirmar" grava', () => {
  const comJuros = { ...carro, calculation_mode: 'amortized', interest_rate_monthly: 0.0199 };
  const ui = carenciaSheet(comJuros, { carenciaPrevia: { ...previaFixa, with_interest: true } });
  assert.equal(qtd(ui, 'Parcela em que a carência começa'), undefined, 'sem campo editável');
  const textos = ui.nodes().filter((n: any) => n.type === 'ThemedText').map((n: any) => String(n.props.children));
  assert.ok(textos.some((t: string) => /^Parcela: R\$ 1470\.00 → R\$ 1562\.40$/.test(t)), textos.join('|'));
  assert.ok(textos.some((t: string) => /^Saldo:/.test(t)));
  assert.equal(ui.writes.length, 0, 'abrir a folha não grava');
  ui.interact(() => botaoConfirmar(ui).props.onPress());
  assert.deepEqual(copia(ui.writes.at(-1)), { operation: 'debtPause', value: { debtId: 'd1', fromNo: 9, months: 1 } });
});

test('Carência: sem prévia (ou buscando) o Confirmar espera e não há frase velha', () => {
  const ui = carenciaSheet(carro, { carenciaPrevia: previaFixa, carenciaBuscando: true });
  assert.equal(botaoConfirmar(ui).props.disabled, true);
  assert.ok(!ui.nodes().some((n: any) => n.type === 'ThemedText' && /^Próxima parcela/.test(String(n.props.children))));
});

test('Carência: a ficha lista as carências; só a mais recente tem "Desfazer", e a recusa do banco aparece', () => {
  const ui = screen(debtsFile, { create: false, debts: [carro], params: { id: 'd1' },
    carencias: [{ id: 'p2', seq: 2, from_installment_no: 12, months: 1, created_at: '' }, { id: 'p1', seq: 1, from_installment_no: 9, months: 3, created_at: '' }] });
  const rows = ui.nodes().filter((n: any) => n.type === 'Row' && /^Carência de/.test(String(n.props.title)));
  assert.deepEqual(copia(rows.map((r: any) => r.props.title)), ['Carência de 1 mês a partir da 12ª', 'Carência de 3 meses a partir da 9ª']);
  assert.ok(rows[0].props.trailing && !rows[1].props.trailing, 'Desfazer só na primeira');
  ui.interact(() => rows[0].props.trailing.props.onPress());
  assert.deepEqual(copia(ui.writes.at(-1)), { operation: 'undoDebtPause', value: { pauseId: 'p2' } });
  const pedido = ui.pedidos.at(-1);
  ui.interact(() => pedido.opts.onError({ code: 'P0001', message: 'Já houve pagamento depois dessa carência.' }));
  assert.match(String(ui.toasts.at(-1).message), /Já houve pagamento/);
});

test('Carência: o formulário mostra a data deslocada e a salva sem deslocar duas vezes', () => {
  const carencias = [{ id: 'p1', seq: 1, from_installment_no: 9, months: 3, created_at: '' }];
  const ui = editarDivida({ debts: [carro], carencias });
  const campo = () => ui.nodes().find((n: any) => n.type === 'DatePickerField');
  assert.equal(campo().props.value, '05/01/2027', 'a 9ª seria 05/10/2026; com 3 meses de carência, 05/01/2027');
  ui.interact(() => campo().props.onChange('05/02/2027'));
  ui.press('Salvar');
  ui.interact(() => ui.actions.find((a: any) => a.label === 'Esta e próximas').onPress());
  assert.equal(ui.writes[0].value.patch.first_due_date, '2026-03-05', 'âncora = escolhida − pagas − carência');
});

test('Dívidas: com principal menor que o restante (capitalizou) a barra do card fica em zero', () => {
  const ui = screen(debtsFile, { debts: [{ ...carro, principal_cents: 100000, remaining_cents: 150000 }] });
  const barra = ui.nodes().find((n: any) => n.type === 'ProgressBar');
  assert.equal(barra.props.value, 0);
});

test('Carência (fix): sem saber as carências o Salvar do formulário espera; erro mostra a faixa com retry', () => {
  const salvar = (ui: any) => ui.button('Salvar');
  const base = { debts: [carro] };
  assert.equal(salvar(editarDivida({ ...base, carenciasPendentes: true })).props.disabled, true, 'carregando bloqueia');
  const erro = editarDivida({ ...base, carenciasErro: true });
  assert.equal(salvar(erro).props.disabled, true, 'erro bloqueia');
  const faixa = erro.nodes().find((n: any) => typeof n.type === 'function' && n.type.name === 'ErrorBand' && /carência/.test(String(n.props.message)));
  assert.ok(faixa, 'faixa de erro');
  erro.interact(() => faixa.props.onRetry());
  assert.ok(erro.refetches.includes('carencias'));
  assert.equal(salvar(editarDivida(base)).props.disabled, false, 'sucesso libera');
});

test('Carência (fix): a ficha com falha ao carregar as carências mostra erro com retry', () => {
  const ui = screen(debtsFile, { create: false, debts: [carro], params: { id: 'd1' }, carenciasErro: true });
  const faixa = ui.nodes().find((n: any) => typeof n.type === 'function' && n.type.name === 'ErrorBand' && /carência/.test(String(n.props.message)));
  assert.ok(faixa);
});

test('Carência (fix): prévia com erro bloqueia o Confirmar e mostra o erro; nada grava antes', () => {
  const ui = carenciaSheet(carro, { carenciaPrevia: previaFixa, carenciaErro: true });
  assert.equal(ui.writes.length, 0);
  assert.equal(botaoConfirmar(ui).props.disabled, true);
  assert.ok(ui.nodes().some((n: any) => n.type === 'ThemedText' && n.props.children === 'Já houve pagamento.'));
});

test('Carência (fix): sem parcela em aberto o menu não oferece a pausa; sem total o campo usa o máximo natural', () => {
  const feita = { ...carro, installments_paid: 48 };
  const ui = screen(debtsFile, { create: false, debts: [feita], params: { id: 'd1' } });
  assert.ok(!ui.nodes().find((n: any) => n.type === 'HeaderActions').props.menu.actions.some((a: any) => a.label === 'Pausar pagamentos…'));
  const sem = carenciaSheet({ ...carro, installments: null }, { carenciaPrevia: previaFixa });
  assert.equal(qtd(sem, 'Parcela em que a carência começa').props.max, undefined);
});
