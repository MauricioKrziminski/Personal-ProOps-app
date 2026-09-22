import { invalidateFinance, invalidateKeys } from '@/lib/query-invalidation';
import type { Natureza } from '@/lib/import-preview';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { ProjecaoMensal } from '@/lib/forecast-months';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/lib/database.types';
import { localISODate, monthBounds, primeiroDiaDoMes } from '@/lib/dates';
import type { Consulta } from '@/lib/tela-pronta';
import type { DebtPaymentRow } from '@/lib/debt-history';
import { agentFetch } from '@/lib/agent-api';
import { toIlikeTerm } from '@/lib/search';
import { ACCOUNT_TYPES } from '@/lib/accounts';
import { adiantaveisNoMes, type Adiantavel, type EscolhaDeAdiantamento } from '@/lib/anticipation';
import { useRealtimeInvalidate, workspaceId } from '@/hooks/use-items';

// Categorias vivem em @/lib/categories (fonte única, travada por teste contra o
// prompt do Gemini); reexportadas aqui para não quebrar os imports das telas.
export { INCOME_CATEGORIES, SUGGESTED_CATEGORIES } from '@/lib/categories';

// Tipos de conta vivem em @/lib/accounts (junto de `accountLabel`, que é quem
// os usa para dizer que "Nubank" é cartão); reexportados aqui para não quebrar
// os imports das telas — mesmo padrão das categorias, logo acima.
export { ACCOUNT_TYPES } from '@/lib/accounts';

/**
 * Tipos derivados do schema gerado (`src/lib/database.types.ts`): renomear ou
 * remover coluna no banco quebra o `tsc` aqui, não em runtime.
 * As colunas de domínio são `text` + CHECK no Postgres (regra do projeto), então
 * o gerador entrega `string` — o app estreita para union onde a UI depende disso.
 */
type Tables = Database['public']['Tables'];
type Fns = Database['public']['Functions'];

export type TransactionKind = 'expense' | 'income' | 'transfer';
export type TransactionSource = 'whatsapp' | 'app' | 'import' | 'recurring';
/** `pending` = ainda vai acontecer (parcela futura, conta a pagar). */
export type TransactionStatus = 'pending' | 'cleared';

export type Transaction = Pick<
  Tables['transactions']['Row'],
  | 'id'
  | 'amount_cents'
  | 'currency'
  | 'category'
  | 'description'
  | 'account_id'
  | 'counterparty_account_id'
  | 'occurred_at' // YYYY-MM-DD
  | 'created_at'
  | 'due_at' // vencimento (fatura do cartão, conta a pagar); null = à vista
  | 'invoice_id'
  | 'installment_plan_id'
  | 'installment_no'
  | 'merchant'
  | 'debt_id'
  // A série da recorrência: é o que diz se "esta e as futuras" faz sentido nesta linha.
  // Já vinha no select desde sempre; faltava só no tipo.
  | 'recurring_id'
  // O saldo adiado de uma fatura (`roll_invoice`): a coluna não é herdada pelas parcelas de um
  // plano, então `temContrato` (`finance-form.ts`) usa isto para esconder "Parcelas" aqui.
  | 'rollover_of_invoice_id'
  // `20260909110000`: entra sozinho na data em vez de esperar baixa. Em receita o padrão é
  // false — Pix de terceiro precisa de comprovação; salário é onde ligar faz sentido.
  | 'auto_confirm'
> & {
  kind: TransactionKind;
  source: TransactionSource;
  status: TransactionStatus;
};

/**
 * ⚠️ `rolled` entrou em 10/09/2026 e NÃO é sinônimo de paga.
 *
 * A fatura adiada teve o saldo movido para a seguinte: ela não cobra mais nada (sai da
 * projeção, do "atrasado" e do patrimônio) mas ninguém pagou nada. Na interface ela nunca se
 * chama "rolada" — o rótulo é "Adiada" e a linha diz para qual fatura o saldo foi.
 */
export type InvoiceStatus = 'open' | 'closed' | 'paid' | 'rolled';

export type Account = Pick<
  Tables['accounts']['Row'],
  | 'id'
  | 'name'
  | 'initial_balance_cents'
  | 'archived'
  // cartão de crédito: null nos demais tipos (check no banco)
  | 'closing_day'
  | 'due_day'
  | 'credit_limit_cents'
  | 'payment_account_id'
  // em qual fatura cai a compra feita NO dia do fechamento — varia por emissor
  | 'closing_day_inclusive'
  // rotativo: só fazem sentido em cartão
  | 'rotativo_auto'
  | 'rotativo_rate_monthly'
> & { type: (typeof ACCOUNT_TYPES)[number]['value'] };

/**
 * Uma linha por cartão. Os campos da fatura são nullable de verdade (left join
 * na RPC: cartão sem nenhuma compra não tem fatura aberta) — o gerador de types
 * não sabe disso, por isso o Omit.
 */
export type CardSummary = Omit<
  Fns['card_summary']['Returns'][number],
  'invoice_id' | 'reference_month' | 'closing_date' | 'due_date' | 'credit_limit_cents'
> & {
  invoice_id: string | null;
  reference_month: string | null;
  closing_date: string | null;
  due_date: string | null;
  credit_limit_cents: number | null;
};

export type CardInvoice = Pick<
  Tables['card_invoices']['Row'],
  | 'id' | 'account_id' | 'reference_month' | 'closing_date' | 'due_date' | 'status' | 'paid_at'
  | 'paid_cents'
> & { status: InvoiceStatus };

export type AccountBalance = Fns['account_balances']['Returns'][number];

export type Goal = Pick<
  Tables['goals']['Row'],
  'id' | 'name' | 'target_cents' | 'saved_cents' | 'deadline' | 'archived'
>;

export type BudgetStatus = Fns['budgets_status']['Returns'][number];

export type Budget = Pick<Tables['budgets']['Row'], 'id' | 'category' | 'limit_cents'>;

export type RecurringTransaction = Pick<
  Tables['recurring_transactions']['Row'],
  | 'id'
  | 'amount_cents'
  | 'currency'
  | 'category'
  | 'description'
  | 'account_id'
  | 'rrule'
  | 'next_run_at'
  | 'active'
  | 'run_attempts'
  | 'last_error'
  | 'created_at'
  // Os três que a EDIÇÃO da série precisa: a âncora (só para mostrar), o fim opcional
  // e a baixa automática. Sem eles o formulário de edição abriria com valores
  // inventados e sobrescreveria o que o usuário não tocou.
  | 'dtstart'
  | 'end_date'
  | 'auto_confirm'
> & { kind: 'expense' | 'income' };

export type MonthlyCashflow = Fns['monthly_cashflow']['Returns'][number];

export type TxSummaryRow = Omit<Fns['transactions_summary']['Returns'][number], 'kind'> & {
  kind: 'expense' | 'income';
};

const TRANSACTION_COLUMNS =
  'id, kind, amount_cents, currency, category, description, account_id, counterparty_account_id, occurred_at, source, created_at, status, due_at, invoice_id, installment_plan_id, installment_no, merchant, recurring_id, debt_id, auto_confirm, rollover_of_invoice_id';

export interface TransactionFilters {
  /**
   * As bordas do período EXIBIDO, já resolvidas — nunca um `YYYY-MM` para este hook recortar.
   *
   * ⚠️ **Isto era `month: string` e o hook chamava `monthBounds()`, ou seja, o mês CIVIL.** A
   * tela ao lado media o mesmo período por `useMonthRange`, que respeita a régua — então com
   * fechamento no dia 10 a LISTA mostrava 01/10–31/10 enquanto o card em cima dela, a
   * `PeriodBar` e o resumo falavam de 11/09–10/10. Medido no staging em 13/09/2026, ciclo de
   * outubro: a lista trazia 4 lançamentos do ciclo SEGUINTE (Meli+, DAS e salário de 20/10,
   * Carro Peças 3/3) e escondia 6 do ciclo que estava na tela (incluindo o salário de 20/09).
   * O total de receita batia por coincidência — cada janela continha um salário —, e foi isso
   * que deixou o defeito invisível.
   *
   * O botão `Mês | Ciclo` ficava bem em cima de uma lista que o ignorava.
   */
  from: string;
  to: string;
  kind?: TransactionKind;
  category?: string;
  /** Ocorrências de uma série recorrente. */
  recurringId?: string;
  /** Extrato de uma conta ou cartão. `null` = lançamentos sem conta; `undefined` = todas. */
  accountId?: string | null;
  status?: TransactionStatus;
  source?: TransactionSource;
  /** Busca em descrição, lugar e categoria. */
  q?: string;
  /**
   * `false` enquanto `from`/`to` ainda são o palpite civil de `useMonthRange`.
   *
   * Sem isto a lista busca duas vezes na abertura e mostra o período errado no meio.
   */
  pronto?: boolean;
}

/**
 * "Sem conta" como parâmetro de rota — `null` não viaja por URL, e duas cópias literais de
 * `'none'` (a tela que navega e a que lê) divergiriam na primeira renomeação.
 */
export const NO_ACCOUNT = 'none';

const TRANSACTION_PAGE = 50;

// ── queries ───────────────────────────────────────────────────────────────────

/** Lista paginada. Antes era `limit(200)` fixo, que sumia com o resto do mês sem avisar. */
export function useTransactions(filters: TransactionFilters) {
  useRealtimeInvalidate('transactions', ['transactions']);
  const { from, to } = filters;
  return useInfiniteQuery({
    // Chaveada por `from`/`to`, que é como toda leitura de período do app já se conserta sozinha
    // na troca de régua (ver `REGUA_MUDOU`). Chaveada pelo RÓTULO do mês ela não se corrigiria:
    // `2026-10` é o mesmo texto nas duas réguas.
    queryKey: ['transactions', 'list', filters],
    initialPageParam: 0,
    queryFn: async ({ pageParam }): Promise<Transaction[]> => {
      let query = supabase
        .from('transactions')
        .select(TRANSACTION_COLUMNS)
        .gte('occurred_at', from)
        .lte('occurred_at', to)
        .order('occurred_at', { ascending: false })
        .order('created_at', { ascending: false })
        // Desempate estável. Duas linhas com a mesma data E o mesmo `created_at` (lote de
        // importação, parcelas criadas juntas) podem trocar de ordem entre uma página e a
        // seguinte — e aí uma some da lista enquanto outra aparece duas vezes.
        .order('id', { ascending: false })
        .range(pageParam, pageParam + TRANSACTION_PAGE - 1);
      if (filters.kind) query = query.eq('kind', filters.kind);
      if (filters.category) query = query.eq('category', filters.category);
      if (filters.status) query = query.eq('status', filters.status);
      if (filters.source) query = query.eq('source', filters.source);
      // "Ver ocorrências" de uma recorrente passa por aqui; sem o filtro a tela abriria o mês
      // inteiro sem avisar que ignorou o pedido.
      if (filters.recurringId) query = query.eq('recurring_id', filters.recurringId);
      if (filters.accountId !== undefined) {
        query =
          filters.accountId === null
            ? query.is('account_id', null)
            : // Transferência RECEBIDA guarda a conta em `counterparty_account_id`: filtrar só
              // `account_id` esconderia do extrato o dinheiro que ENTROU na conta.
              query.or(
                `account_id.eq.${filters.accountId},counterparty_account_id.eq.${filters.accountId}`
              );
      }
      // Mesmas três colunas e o mesmo saneamento da busca global (`use-search.ts`): sem
      // `toIlikeTerm`, uma vírgula digitada vira separador de condição do PostgREST e a query
      // volta 400. Duas telas buscando lançamento têm que achar a mesma coisa.
      const safe = toIlikeTerm(filters.q ?? '');
      if (safe) {
        const like = `%${safe}%`;
        query = query.or(
          `description.ilike.${like},merchant.ilike.${like},category.ilike.${like}`
        );
      }
      const { data, error } = await query;
      if (error) throw error;
      return data as Transaction[];
    },
    getNextPageParam: (last, all) =>
      last.length < TRANSACTION_PAGE ? undefined : all.length * TRANSACTION_PAGE,
    enabled: filters.pronto !== false,
  });
}

/**
 * Ano do lançamento MAIS ANTIGO — o começo real da história do usuário.
 *
 * Relatórios oferecia três anos fixos (`anoAtual - 2`), então quem usa o app há mais tempo não
 * alcançava o próprio passado, e quem começou ontem via dois anos vazios oferecidos como se
 * tivessem conteúdo. Uma linha do banco resolve os dois.
 */
export function useFirstTransactionYear() {
  useRealtimeInvalidate('transactions', ['transactions']);
  return useQuery({
    queryKey: ['transactions', 'first-year'],
    queryFn: async (): Promise<number | null> => {
      const { data, error } = await supabase
        .from('transactions')
        .select('occurred_at')
        .order('occurred_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data ? Number((data.occurred_at as string).slice(0, 4)) : null;
    },
  });
}

/**
 * "Últimos lançamentos" é o que JÁ ACONTECEU — nunca o que ainda vai acontecer.
 *
 * ⚠️ Duas coisas erradas aqui de uma vez, e as duas só apareceram quando o materializador passou
 * de 90 para 365 dias (10/09/2026): a lista não filtrava nada e ordenava por `created_at`. O cron
 * cria as 12 ocorrências da recorrente no MESMO instante, então "Manutenção dentista" ocupava a
 * lista inteira — uma por mês, até agosto de 2027, todas com data futura.
 *
 * O corte é a DATA, não o `status`: compra no cartão fica `pending` até a fatura ser paga e
 * mesmo assim é lançamento que aconteceu. E a ordem é `occurred_at`, senão um extrato importado
 * hoje joga o mês passado para o topo.
 */
export function useRecentTransactions(limit = 5) {
  useRealtimeInvalidate('transactions', ['transactions']);
  const hoje = localISODate();
  return useQuery({
    queryKey: ['transactions', 'recent', String(limit), hoje],
    queryFn: async (): Promise<Transaction[]> => {
      const { data, error } = await supabase
        .from('transactions')
        .select(TRANSACTION_COLUMNS)
        .lte('occurred_at', hoje)
        .order('occurred_at', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data as Transaction[];
    },
  });
}

/**
 * Entradas e saídas somadas numa janela.
 *
 * `pronto` é o mesmo contrato de `useTransactions`: com bordas vindas de `useMonthRange`, passe
 * `range.pronto`, e a consulta só liga quando elas forem as definitivas. Sem isso ela buscava
 * primeiro com o palpite civil e depois de novo com o ciclo — trabalho dobrado no caminho feliz,
 * e o número do mês ERRADO no caminho em que as bordas falham.
 */
export function useTransactionsSummary(fromDate: string, toDate: string, pronto = true) {
  useRealtimeInvalidate('transactions', ['tx-summary']);
  return useQuery({
    enabled: pronto,
    queryKey: ['tx-summary', fromDate, toDate],
    queryFn: async (): Promise<TxSummaryRow[]> => {
      const { data, error } = await supabase.rpc('transactions_summary', {
        from_date: fromDate,
        to_date: toDate,
      });
      if (error) throw error;
      return data as TxSummaryRow[];
    },
  });
}

export function useMonthlyCashflow(monthsBack = 6, view?: CycleView) {
  useRealtimeInvalidate('transactions', ['monthly-cashflow']);
  return useQuery({
    queryKey: ['monthly-cashflow', String(monthsBack), view ?? ''],
    queryFn: async (): Promise<MonthlyCashflow[]> => {
      const { data, error } = await supabase.rpc('monthly_cashflow', { months_back: monthsBack, p_view: view ?? undefined });
      if (error) throw error;
      return data;
    },
  });
}

export function useAccountBalances() {
  useRealtimeInvalidate('transactions', ['account-balances']);
  return useQuery({
    queryKey: ['account-balances'],
    queryFn: async (): Promise<AccountBalance[]> => {
      const { data, error } = await supabase.rpc('account_balances');
      if (error) throw error;
      return data;
    },
  });
}

export function useAccounts() {
  useRealtimeInvalidate('accounts', ['accounts']);
  return useQuery({
    queryKey: ['accounts'],
    queryFn: async (): Promise<Account[]> => {
      const { data, error } = await supabase
        .from('accounts')
        .select('id, name, type, initial_balance_cents, archived, closing_day, due_day, credit_limit_cents, payment_account_id, closing_day_inclusive, rotativo_auto, rotativo_rate_monthly')
        .eq('archived', false)
        .order('created_at');
      if (error) throw error;
      return data as Account[];
    },
  });
}

export function useGoals() {
  useRealtimeInvalidate('goals', ['goals']);
  return useQuery({
    queryKey: ['goals'],
    queryFn: async (): Promise<Goal[]> => {
      const { data, error } = await supabase
        .from('goals')
        .select('id, name, target_cents, saved_cents, deadline, archived')
        .eq('archived', false)
        .order('created_at');
      if (error) throw error;
      return data;
    },
  });
}

const RECURRING_COLUMNS =
  'id, kind, amount_cents, currency, category, description, account_id, rrule, next_run_at, active, run_attempts, last_error, created_at, dtstart, end_date, auto_confirm';

/**
 * As categorias que o usuário realmente usa, mais usada primeiro.
 *
 * Categoria é texto livre (`finance.md`): quem lança pelo WhatsApp cria categoria nova, e o
 * seletor do app só conhecia as 13 sugestões. Ver `categories_used()` na `20260909100000`.
 */
export function useCategoriesUsed() {
  useRealtimeInvalidate('transactions', ['categories-used']);
  return useQuery({
    queryKey: ['categories-used'],
    queryFn: async (): Promise<{ category: string; uses: number }[]> => {
      const { data, error } = await supabase.rpc('categories_used');
      if (error) throw error;
      return (data ?? []).map((r) => ({ category: r.category, uses: Number(r.uses) }));
    },
    staleTime: 60_000,
  });
}

/** Séries recorrentes — criadas por WhatsApp, materializadas pelo cron do send-reminders. */
export function useRecurringTransactions() {
  useRealtimeInvalidate('recurring_transactions', ['recurring']);
  return useQuery({
    queryKey: ['recurring'],
    queryFn: async (): Promise<RecurringTransaction[]> => {
      const { data, error } = await supabase
        .from('recurring_transactions')
        .select(RECURRING_COLUMNS)
        // ativas primeiro; dentro de cada grupo, a que roda antes
        .order('active', { ascending: false })
        .order('next_run_at');
      if (error) throw error;
      return data as RecurringTransaction[];
    },
  });
}

export function useBudgets() {
  useRealtimeInvalidate('budgets', ['budgets']);
  return useQuery({
    queryKey: ['budgets'],
    queryFn: async (): Promise<Budget[]> => {
      const { data, error } = await supabase
        .from('budgets')
        .select('id, category, limit_cents')
        .order('category');
      if (error) throw error;
      return data;
    },
  });
}

/**
 * Uma transação por id.
 *
 * Existe para consertar um bug real: o form de edição garimpava o item no cache da lista do mês.
 * Cache frio ou query com erro → `editing` ficava `undefined` e o modal de EDIÇÃO virava um modal
 * de CRIAÇÃO em silêncio, gerando um lançamento duplicado.
 */
export function useTransaction(id: string | undefined) {
  return useQuery({
    queryKey: ['transactions', 'item', id],
    enabled: !!id,
    queryFn: async (): Promise<Transaction | null> => {
      // `maybeSingle`, não `single`: linha apagada é um estado NORMAL desta tela
      // (o usuário acabou de apagar e o realtime invalidou antes do `back()`).
      // Com `single` isso virava erro, e o detalhe piscava "não deu para carregar"
      // no lugar do "esse lançamento não existe mais".
      const { data, error } = await supabase
        .from('transactions')
        .select(TRANSACTION_COLUMNS)
        .eq('id', id!)
        .maybeSingle();
      if (error) throw error;
      return (data as Transaction) ?? null;
    },
  });
}


/** `month` no formato YYYY-MM; omitido = mês corrente. */
export function useBudgetsStatus(month?: string, view?: CycleView) {
  useRealtimeInvalidate('transactions', ['budgets-status']);
  useRealtimeInvalidate('budgets', ['budgets-status']);
  const refMonth = month ? primeiroDiaDoMes(month) : localISODate();
  return useQuery({
    queryKey: ['budgets-status', refMonth, view ?? ''],
    queryFn: async (): Promise<BudgetStatus[]> => {
      const { data, error } = await supabase.rpc('budgets_status', { ref_month: refMonth, p_view: view ?? undefined });
      if (error) throw error;
      return data;
    },
  });
}

// ── mutations (inserts diretos via supabase-js — RLS own-rows cobre) ──────────

export function useInvalidateFinance() {
  const queryClient = useQueryClient();
  return () => invalidateFinance(queryClient);
}

async function userId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw error ?? new Error('sem sessão');
  return data.user.id;
}

// ── cartão de crédito, fatura e parcelas ─────────────────────────────────────

/** Um cartão por linha: fatura aberta, total não pago e limite disponível. */
export function useCardSummary() {
  useRealtimeInvalidate('card_invoices', ['card-summary']);
  useRealtimeInvalidate('transactions', ['card-summary']);
  return useQuery({
    queryKey: ['card-summary'],
    queryFn: async (): Promise<CardSummary[]> => {
      const { data, error } = await supabase.rpc('card_summary');
      if (error) throw error;
      return data as CardSummary[];
    },
  });
}

/** Fatura + as compras dela (RLS já limita ao workspace). */
/**
 * A consulta de UMA fatura, fora do hook: a Carteira pré-carrega a fatura do cartão da frente
 * (`prefetchQuery`) para o cartão pousar na fatura já com o total, em vez de num esqueleto.
 */
export function invoiceQuery(invoiceId: string) {
  return {
    queryKey: ['invoice', invoiceId] as const,
    queryFn: async (): Promise<{ invoice: CardInvoice; transactions: Transaction[] }> => {
      const [invoiceRes, txRes] = await Promise.all([
        supabase
          .from('card_invoices')
          .select('id, account_id, reference_month, closing_date, due_date, status, paid_at, paid_cents')
          .eq('id', invoiceId)
          .single(),
        supabase
          .from('transactions')
          .select(TRANSACTION_COLUMNS)
          .eq('invoice_id', invoiceId)
          .order('occurred_at', { ascending: false }),
      ]);
      if (invoiceRes.error) throw invoiceRes.error;
      if (txRes.error) throw txRes.error;
      return {
        invoice: invoiceRes.data as CardInvoice,
        transactions: txRes.data as Transaction[],
      };
    },
  };
}

export function useInvoice(invoiceId: string | undefined) {
  useRealtimeInvalidate('card_invoices', ['invoice']);
  useRealtimeInvalidate('transactions', ['invoice']);
  return useQuery({ ...invoiceQuery(invoiceId ?? ''), enabled: Boolean(invoiceId) });
}

/**
 * Paga a fatura: a RPC cria a transferência e marca a fatura (regra no banco).
 *
 * `amountCents` ausente = paga o que falta e quita. Com valor menor, o banco soma em
 * `card_invoices.paid_cents` e a fatura segue em aberto — é o rotativo, e é o caso real de quem
 * paga o boleto em duas vezes no mesmo mês. Quem decide isso é `pay_invoice`, não a tela.
 */
export function usePayInvoice() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (input: {
      invoiceId: string;
      accountId: string;
      paidAt: string;
      amountCents?: number;
    }) => {
      const { error } = await supabase.rpc('pay_invoice', {
        p_invoice_id: input.invoiceId,
        p_account_id: input.accountId,
        p_paid_at: input.paidAt,
        ...(input.amountCents === undefined ? {} : { p_amount_cents: input.amountCents }),
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

/**
 * Marca a fatura como paga **sem mexer no saldo**.
 *
 * Diferente de `usePayInvoice`: aqui não nasce transferência nenhuma. É para
 * dado histórico — a fatura de junho já foi paga na vida real, antes de o app
 * existir, e "pagá-la" agora tiraria do caixa de hoje um dinheiro que saiu há
 * meses. A RPC também fecha as parcelas `pending` de dentro.
 */
/** O que `roll_invoice` devolve — serve para a tela contar o que aconteceu. */
export interface RollResult {
  principal_cents: number;
  juros_cents: number;
  iof_cents: number;
  /** A taxa usada — aprendida do histórico do cartão, ou a de partida. `null` = não havia. */
  taxa_usada: number | null;
  /** Os juros saíram de uma taxa estimada, não de um valor informado. */
  juros_estimados: boolean;
  /** Não havia taxa nenhuma: rolou só o principal, e a projeção fica otimista. */
  sem_taxa: boolean;
  /** Esta fatura já tinha recebido um saldo adiado — é o segundo ciclo seguido no rotativo. */
  segundo_ciclo: boolean;
  destino_id: string;
  destino_vence_em: string;
}

/**
 * Joga o saldo em aberto de uma fatura vencida para a próxima (o "rotativo").
 *
 * Invalida MUITO de propósito: o saldo muda de fatura, some da projeção na data antiga e
 * aparece na nova, e os juros e o IOF são gasto novo que entra no mês e no orçamento.
 */
export function useRollInvoice() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (invoiceId: string): Promise<RollResult> => {
      const { data, error } = await supabase.rpc('roll_invoice', { p_invoice_id: invoiceId });
      if (error) throw error;
      return data as unknown as RollResult;
    },
    onSuccess: invalidate,
  });
}

export function useSettleInvoice() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (input: { invoiceId: string; paidAt: string }) => {
      const { error } = await supabase.rpc('settle_invoice', {
        p_invoice_id: input.invoiceId,
        p_paid_at: input.paidAt,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

/**
 * Compra parcelada: a RPC cria N transações (uma por mês), as futuras como
 * `pending`, e o trigger do banco resolve a fatura de cada parcela.
 *
 * ⚠️ **Payload montado campo a campo é payload que ESQUECE campo, em silêncio.** Até
 * 15/09/2026 este hook não mandava `p_merchant` — o 8º parâmetro da RPC —, então o campo
 * "Estabelecimento" do formulário era preenchido pela pessoa e morria aqui. Nada quebrava:
 * a RPC tem default `null`, o insert roda, a compra aparece no valor certo e na fatura
 * certa. Só o NOME some. Medido na produção: de 311 transações, UMA tinha `merchant` (e
 * veio de `import`); dos 11 planos, ZERO.
 *
 * Foi assim que "nuuvem wardog" virou **"Compra parcelada (1/2)"** na fatura de outubro —
 * o dono do produto cadastrou, não achou no app e ainda viu o valor contando no ciclo. O
 * caminho à vista (`useSaveTransaction`) nunca teve o defeito porque ele ESPALHA o objeto
 * (`{...input}`): campo novo entra sozinho. Aqui cada parâmetro é uma linha escrita à mão,
 * e é por isso que este comentário existe — **campo novo no formulário exige linha nova
 * aqui**.
 */
export function useCreateInstallmentPlan() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (input: {
      accountId: string;
      totalCents: number;
      installments: number;
      paidInstallments: number;
      occurredAt: string;
      description: string | null;
      category: string | null;
      merchant: string | null;
    }) => {
      const { error } = await supabase.rpc('create_installment_plan_with_history', {
        p_account_id: input.accountId,
        p_total_cents: input.totalCents,
        p_installments: input.installments,
        p_paid_installments: input.paidInstallments,
        p_occurred_at: input.occurredAt,
        p_description: input.description ?? undefined,
        p_category: input.category ?? undefined,
        p_merchant: input.merchant ?? undefined,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

/**
 * Reparcelar: editar a COMPRA inteira, não uma parcela dela.
 *
 * ⚠️ **Manda o plano INTEIRO, sempre.** Campo omitido vira `null` na RPC (os parâmetros têm
 * `default null`), então isto é um `set`, nunca um `patch` — é de propósito: o sheet que chama
 * mostra todos os campos, e "não mandei" não pode significar duas coisas diferentes.
 *
 * As travas moram no banco (`update_installment_plan`), não aqui: parcela já paga — ou em
 * fatura paga/adiada — nunca muda de valor, data ou conta, e com qualquer parcela paga o
 * NÚMERO de parcelas deixa de ser editável. É a regra do nicho (o OnBalance desabilita o campo
 * depois do primeiro pagamento; o Oracle só atualiza parcela com saldo em aberto), e ela é do
 * banco porque o agente precisa da MESMA — duas cópias divergem.
 *
 * ⚠️ **`installments: 1` DISSOLVE o plano** (20/09/2026): a parcela 1 sobrevive — com o mesmo
 * `id` — virando um lançamento à vista pelo total, as outras somem e o plano é apagado. Com
 * qualquer parcela paga a RPC recusa, porque `1 <> N` cai no mesmo guarda que já protege o
 * número de parcelas. Quem chama isso é o chip "À vista" de Parceladas.
 */
export function useUpdateInstallmentPlan() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (input: {
      planId: string;
      totalCents: number;
      installments: number;
      firstOccurredAt: string;
      description: string | null;
      category: string | null;
      merchant: string | null;
      accountId: string | null;
    }) => {
      const { error } = await supabase.rpc('update_installment_plan', {
        p_plan_id: input.planId,
        p_total_cents: input.totalCents,
        p_installments: input.installments,
        p_first_occurred_at: input.firstOccurredAt,
        p_description: input.description ?? undefined,
        p_category: input.category ?? undefined,
        p_merchant: input.merchant ?? undefined,
        p_account_id: input.accountId ?? undefined,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

/**
 * Um lançamento que já existe vira compra parcelada.
 *
 * ⚠️ **A linha original é ADOTADA como parcela 1 — o `id` não muda.** Quem faz isso é a RPC; o
 * hook não tem como saber. É o que torna a operação idempotente: chamar duas vezes é RECUSA
 * (`Esse lançamento já é uma compra parcelada`), nunca um segundo plano. Sem isso, o caminho para
 * a duplicação era o próprio usuário — sem esta porta, ele lançava de novo, e ficava com as duas
 * compras na fatura (19/09/2026).
 *
 * ⚠️ **`totalCents` é o TOTAL da compra, não o valor da parcela** — a mesma convenção da criação
 * (`useCreateInstallmentPlan`) e da edição (`useUpdateInstallmentPlan`). A tela escreve isso no
 * `hint` do campo.
 *
 * ⚠️ **Payload montado campo a campo é payload que ESQUECE campo, em silêncio** — foi assim que
 * `p_merchant` sumiu por meses e "nuuvem wardog" virou "Compra parcelada (1/2)". **Campo novo no
 * formulário exige linha nova aqui.**
 */
export function useConvertToInstallments() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (input: {
      transactionId: string;
      totalCents: number;
      installments: number;
      firstOccurredAt: string;
      description: string | null;
      category: string | null;
      merchant: string | null;
      accountId: string;
    }) => {
      const { error } = await supabase.rpc('convert_transaction_to_installments', {
        p_transaction_id: input.transactionId,
        p_total_cents: input.totalCents,
        p_installments: input.installments,
        p_first_occurred_at: input.firstOccurredAt,
        p_description: input.description ?? undefined,
        p_category: input.category ?? undefined,
        p_merchant: input.merchant ?? undefined,
        p_account_id: input.accountId,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

// ── projeção de fluxo de caixa e contas a pagar ─────────────────────────────

export type ForecastDay = Fns['cash_flow_forecast']['Returns'][number];
export type UpcomingBill = Omit<Fns['upcoming_bills']['Returns'][number], 'kind'> & {
  /**
   * `debt` entrou na 20260908235000: é a prestação de um financiamento, e o
   * `ref_id` dela é o id da DÍVIDA, não de um lançamento. Quem consome tem que
   * rotear, nunca chamar a baixa de lançamento — foi a união fechada aqui que
   * fez o TypeScript exigir isso das duas telas.
   */
  /**
   * `income` entrou na 20260909150000 pelo mesmo motivo e com o mesmo efeito: a RPC deixou de
   * ser só "o que vou pagar" e a união fechada obriga as telas a decidirem o rótulo em vez de
   * cravarem "Paguei". Use `settleLabel(kind)`.
   */
  kind: 'invoice' | 'transaction' | 'debt' | 'income';
};

/**
 * Saldo projetado dia a dia. Sai pronto do banco somando saldo atual + o que
 * está `pending` + faturas não pagas (cada uma na data de vencimento).
 *
 * ⚠️ **Chama `forecast_json`, não `cash_flow_forecast`, e a diferença é CORREÇÃO.** A RPC que
 * devolve `setof` entrega uma linha por dia, e o PostgREST corta a resposta em **1000 linhas**
 * sem avisar: acima de ~2,7 anos o app somava "entra/sai", tirava o saldo do fim e procurava o
 * primeiro dia negativo sobre uma série truncada, escrevendo o rótulo do horizonte pedido em
 * cima disso. Medido: em 10 anos o saldo final aparecia **R$ 16.164,60 otimista**, e 3, 5 e 10
 * anos mostravam todos a mesma data (05/06/2029). `forecast_json` devolve UMA linha com a
 * série inteira dentro — o teto do PostgREST é por linha, não por tamanho.
 */
export function useCashFlowForecast(days = 90, enabled = true) {
  useRealtimeInvalidate('transactions', ['forecast']);
  return useQuery({
    enabled,
    queryKey: ['forecast', String(days)],
    queryFn: async (): Promise<ForecastDay[]> => {
      const { data, error } = await supabase.rpc('forecast_json', { days });
      if (error) throw error;
      return (data ?? []) as unknown as ForecastDay[];
    },
  });
}

/**
 * Uma hipótese de rascunho: "e se entrar 1.500 em novembro?", "e se eu comprar 3.000 em 6x?".
 *
 * `start` é a data da PRIMEIRA parcela; as seguintes caem de mês em mês. O resto da divisão
 * inteira vai na última, igual a `create_installment_plan` — senão 100 em 3x soma 99.
 */
export type Draft = {
  kind: 'income' | 'expense';
  amount_cents: number;
  /** ISO `YYYY-MM-DD` */
  start: string;
  installments: number;
  /**
   * O que o valor SIGNIFICA — e confundir os dois erra por um fator de N:
   *
   * - `total`: 3.000 em 6x → 500 por mês, seis vezes. Uma COMPRA repartida.
   * - `monthly`: 1.500 por mês → 1.500 todo mês, até o fim da projeção. Uma RECORRÊNCIA.
   *
   * Ausente = `total`, que é o que mantém `affordability` funcionando sem tocar nela.
   *
   * - `cancel`: DESFAZ uma saída que a projeção já tem, no dia dela (adiantar parcelas,
   *   `20260921120000`). Uma ocorrência, valor negativo; `installments` é ignorado.
   */
  mode?: 'total' | 'monthly' | 'cancel';
  /** Liga os drafts de uma hipótese composta (adiantar). Só do app — não vai ao banco. */
  grupo?: string;
  /** O texto da linha da hipótese composta. Só do app — não vai ao banco. */
  rotulo?: string;
  /** A escolha do adiantamento, para editar a hipótese. Só do app — não vai ao banco. */
  adiantar?: EscolhaDeAdiantamento;
};

/** O que vai ao banco: `grupo`/`rotulo` são da tela e mudariam a chave do cache à toa. */
function paraOBanco(drafts: Draft[]) {
  return drafts.map(({ grupo: _g, rotulo: _r, adiantar: _a, ...d }) => d);
}

/**
 * O que dá para adiantar no "E se…" — compra parcelada, financiamento, recorrente — com o dia
 * em que cada parcela sai do caixa e o valor presente no dia do pagamento (`pagarEm`). JSON de
 * propósito: a lista passa das 1000 linhas que o PostgREST corta em silêncio.
 */
export function useAnticipationCandidates(pagarEm: string, enabled = true) {
  useRealtimeInvalidate('transactions', ['anticipation-candidates']);
  return useQuery({
    enabled,
    queryKey: ['anticipation-candidates', pagarEm],
    placeholderData: (anterior) => anterior,
    queryFn: async (): Promise<Adiantavel[]> => {
      const { data, error } = await supabase.rpc('anticipation_candidates', { p_pay_on: pagarEm });
      if (error) throw error;
      return (data ?? []) as unknown as Adiantavel[];
    },
    // A régua do MÊS (`adiantaveisNoMes`) vale também sobre o placeholder: enquanto o mês novo
    // carrega, a lista do anterior já aparece recortada no mês novo, sem piscar o número velho.
    select: (lista) => adiantaveisNoMes(lista, pagarEm),
  });
}

/**
 * A projeção com hipóteses aplicadas — o Rascunho.
 *
 * ⚠️ **A conta mora no BANCO** (`private.draft_effect`), no MESMO motor que o "Posso comprar
 * isso?" usa desde `20260910170000`. Somar aqui seria a segunda cópia de uma aritmética de
 * dinheiro, e as duas telas passariam a poder discordar.
 *
 * Com a lista vazia o hook desliga: quem não está simulando não paga uma RPC a mais, e a tela
 * cai na projeção real (`useCashFlowForecast`).
 */
export function useForecastWithDrafts(days: number, drafts: Draft[], enabled = true) {
  useRealtimeInvalidate('transactions', ['forecast-drafts']);
  return useQuery({
    enabled: enabled && drafts.length > 0,
    // O rascunho é efêmero de propósito: sai da tela, some. `gcTime: 0` impede que ele
    // ressuscite do cache quando o usuário voltar — que é justamente o que ele pediu que NÃO
    // acontecesse ("se eu voltar, ele some").
    gcTime: 0,
    queryKey: ['forecast-drafts', String(days), JSON.stringify(paraOBanco(drafts))],
    queryFn: async (): Promise<ForecastDay[]> => {
      const { data, error } = await supabase.rpc('forecast_json', { days, drafts: paraOBanco(drafts) });
      if (error) throw error;
      return (data ?? []) as unknown as ForecastDay[];
    },
  });
}

/**
 * A projeção **agrupada por mês**, somada no banco.
 *
 * ⚠️ **Existe para o modo Mês NÃO baixar a série diária.** Ele desenha ~120 números e a série
 * de 10 anos tem 3.651 linhas: medido pela API, 288 KB contra **13 KB** — 22×. E o
 * agrupamento é aritmética de dinheiro, que agora mora junto da projeção que a produz
 * (`private.month_group`), com as asserções em `supabase/tests/month_forecast.sql`.
 *
 * `hoje` vem junto porque o destaque escreve "TENHO HOJE", que é o saldo do dia 0 — o primeiro
 * MÊS fecha no fim do mês corrente, e confundir os dois mostraria um número com o rótulo errado.
 *
 * `drafts` vazio devolve a projeção real: é a mesma porta para os dois casos, então o Rascunho
 * e a projeção nunca podem discordar por caminho.
 */
export function useForecastMonths(days: number, drafts: Draft[], enabled = true, view?: CycleView) {
  useRealtimeInvalidate('transactions', ['forecast-months']);
  return useQuery({
    enabled,
    // Segura o valor anterior enquanto o horizonte novo carrega: sem isso o destaque salta
    // para R$ 0,00 a cada troca, que lê como dado errado e não como carregamento.
    placeholderData: (anterior) => anterior,
    // Mesmo contrato efêmero do rascunho: sair da tela apaga.
    gcTime: drafts.length > 0 ? 0 : undefined,
    queryKey: ['forecast-months', String(days), JSON.stringify(paraOBanco(drafts)), view ?? ''],
    queryFn: async (): Promise<ProjecaoMensal> => {
      const { data, error } = await supabase.rpc('month_forecast_json', { days, drafts: paraOBanco(drafts), p_view: view ?? undefined });
      if (error) throw error;
      return (data ?? { hoje: 0, meses: [] }) as unknown as ProjecaoMensal;
    },
  });
}

/** Faturas e lançamentos previstos que vencem no período (atrasados incluídos). */
export function useUpcomingBills(days = 30) {
  useRealtimeInvalidate('transactions', ['upcoming-bills']);
  useRealtimeInvalidate('card_invoices', ['upcoming-bills']);
  return useQuery({
    queryKey: ['upcoming-bills', String(days)],
    queryFn: async (): Promise<UpcomingBill[]> => {
      const { data, error } = await supabase.rpc('upcoming_bills', { days });
      if (error) throw error;
      return data as UpcomingBill[];
    },
  });
}

/** Uma compra que ainda VAI entrar numa fatura aberta. */
export interface UpcomingCardCharge {
  id: string;
  title: string;
  occurred_at: string;
  amount_cents: number;
  card: string;
  invoice_id: string;
}

/**
 * O que ainda vai CAIR no cartão — a parcela e a assinatura com data futura.
 *
 * ⚠️ **Elas não aparecem em `upcoming_bills`, e isso é o desenho de lá, não um defeito.** O
 * ramo avulso daquela RPC exige `invoice_id is null` justamente para não contar duas vezes o
 * que já está somado dentro da fatura. O efeito colateral é que a compra que vai postar semana
 * que vem some de toda tela que lê "o que vem" — medido na conta do dono do produto em
 * 16/09/2026: `DAS` (20/09) e `Carro Peças (2/3)` (22/09) não estavam em lugar nenhum da Hoje.
 *
 * ⚠️ **A fatura em si NÃO serve de resposta** (a queixa foi literal: *"eu não quero a fatura em
 * si, quero os próximos lançamentos previstos dentro da fatura"*). O total dela é um número
 * fechado sobre o passado; o que ajuda a decidir hoje é ver o que ainda vai entrar nele.
 *
 * Duas idas, não um `!inner` com filtro embutido: o filtro de status do PostgREST sobre tabela
 * EMBUTIDA tem semântica própria e silenciosa, e aqui o preço é uma consulta a mais numa tela
 * que já espera por sete.
 */
export function useUpcomingCardCharges(limit = 4) {
  useRealtimeInvalidate('transactions', ['upcoming-card-charges']);
  useRealtimeInvalidate('card_invoices', ['upcoming-card-charges']);
  return useQuery({
    queryKey: ['upcoming-card-charges', String(limit)],
    queryFn: async (): Promise<UpcomingCardCharge[]> => {
      const hoje = localISODate();
      const { data: faturas, error: erroFaturas } = await supabase
        .from('card_invoices')
        .select('id, due_date, accounts(name)')
        .not('status', 'in', '("paid","rolled")')
        .gte('due_date', hoje);
      if (erroFaturas) throw erroFaturas;
      const abertas = (faturas ?? []) as unknown as {
        id: string;
        due_date: string;
        accounts: { name: string } | null;
      }[];
      if (abertas.length === 0) return [];

      const cartaoDe = new Map(abertas.map((f) => [f.id, f.accounts?.name ?? 'Cartão']));
      const { data, error } = await supabase
        .from('transactions')
        .select('id, description, merchant, occurred_at, amount_cents, invoice_id')
        .in('invoice_id', [...cartaoDe.keys()])
        .gte('occurred_at', hoje)
        .order('occurred_at', { ascending: true })
        .limit(limit);
      if (error) throw error;
      return (data ?? []).map((t) => ({
        id: t.id,
        // A MESMA régua da linha e do plano: `description || merchant`. Ver `finance.md`.
        title: t.description || t.merchant || 'Compra no cartão',
        occurred_at: t.occurred_at,
        amount_cents: Number(t.amount_cents),
        card: cartaoDe.get(t.invoice_id as string) ?? 'Cartão',
        invoice_id: t.invoice_id as string,
      }));
    },
  });
}

/**
 * Dá baixa num lançamento previsto (pending -> cleared).
 *
 * Escreve `paid_at`, **não** `occurred_at`. Reescrever a data do lançamento fazia
 * um boleto de agosto pago em setembro migrar de mês em todo relatório — o mês
 * fechado encolhia sozinho depois de fechado. As duas datas respondem perguntas
 * diferentes: quando a despesa aconteceu, e quando o dinheiro saiu.
 */
export function useMarkPaid() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (input: { id: string; paidAt: string }) => {
      const { data, error } = await supabase
        .from('transactions')
        .update({ status: 'cleared', paid_at: input.paidAt })
        .eq('id', input.id)
        .select('id')
        .single();
      if (error) throw error;
      if (!data || data.id !== input.id) throw new Error('Lançamento não encontrado para dar baixa.');
    },
    onSuccess: invalidate,
  });
}

// ── importação de extrato e regras de categorização ─────────────────────────

export type ImportItem = Pick<
  Tables['import_items']['Row'],
  | 'id'
  | 'batch_id'
  | 'amount_cents'
  | 'occurred_at'
  | 'description'
  | 'merchant'
  | 'suggested_category'
  | 'transaction_id'
> & {
  kind: 'expense' | 'income';
  status: 'pending' | 'approved' | 'discarded' | 'duplicate' | 'near_match' | 'uncertain';
  /** Os campos da conciliação (`20260922150000`) — ver `src/lib/import-preview.ts`. */
  nature: Natureza | null;
  installment_no: number | null;
  installments: number | null;
  match_layer: string | null;
  match_note: string | null;
  adopt_ids: (string | null)[] | null;
  /**
   * O lançamento do app que este item do extrato PARECE ser — só em `near_match`.
   *
   * Vem embutido porque a tela precisa mostrar os dois lados para a pessoa decidir: o que o app
   * tem (nome e data que ela mesma escreveu) contra o que o banco mandou. Sem isso a linha diria
   * "parece já lançado" sem dizer com o quê, e a decisão viraria um chute.
   */
  transactions: { id: string; occurred_at: string; description: string | null; amount_cents: number; account_id: string | null } | null;
};

export type CategorizationRule = Pick<
  Tables['categorization_rules']['Row'],
  'id' | 'pattern' | 'category' | 'account_id' | 'priority' | 'hits'
> & { match_type: 'contains' | 'merchant' | 'regex'; source: 'user' | 'learned' };

export interface ImportResult {
  batch_id: string;
  items: number;
  duplicates: number;
  categorized: number;
}

/**
 * Manda o extrato para a Edge Function, que parseia, aplica as regras do usuário
 * e categoriza o resto com uma única chamada de IA. Nada vira lançamento aqui —
 * o retorno é um lote para revisão.
 */
export function useImportStatement() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      content: string;
      source: 'ofx' | 'csv';
      filename: string;
      accountId: string | null;
    }): Promise<ImportResult> => {
      /*
        ⚠️ **Vai para o AGENTE, não para a Edge Function** (09/09/2026).

        A `import-statement` em Deno recebia `user_id` e `workspace_id` NO CORPO e confiava
        neles. O `verify_jwt` do Supabase provava que ALGUM usuário válido chamou, não que
        fosse aquele — qualquer autenticado importava lançamentos para o workspace de outro
        trocando duas linhas do POST. A rota Python tira o usuário do `sub` do token e checa
        a participação no workspace antes de escrever.

        `user_id` sumiu do corpo de propósito: mandar um id que o servidor ignora convida
        alguém a "consertar" o servidor para voltar a lê-lo.
      */
      return agentFetch<ImportResult>('/internal/import-statement', {
        method: 'POST',
        body: JSON.stringify({
          workspace_id: await workspaceId(),
          account_id: input.accountId,
          filename: input.filename,
          content: input.content,
          source: input.source,
        }),
      });
    },
    onSuccess: () => invalidateKeys(queryClient, [['import-items'], ['import-batches'], ['plan-status']]),
  });
}

export function useImportItems(batchId: string | undefined) {
  useRealtimeInvalidate('import_items', ['import-items']);
  return useQuery({
    enabled: Boolean(batchId),
    queryKey: ['import-items', batchId ?? ''],
    queryFn: async (): Promise<ImportItem[]> => {
      const { data, error } = await supabase
        .from('import_items')
        .select(
          'id, batch_id, kind, amount_cents, occurred_at, description, merchant, suggested_category, status, transaction_id, nature, installment_no, installments, match_layer, match_note, adopt_ids, transactions!import_items_transaction_id_fkey(id, occurred_at, description, amount_cents, account_id)',
        )
        .eq('batch_id', batchId!)
        .order('occurred_at', { ascending: false });
      if (error) throw error;
      return data as ImportItem[];
    },
  });
}

/** Confirma os itens escolhidos: a RPC cria as transações com source='import'. */
export function useApproveImportItems() {
  const invalidate = useInvalidateFinance();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.rpc('approve_import_items', { p_item_ids: ids });
      if (error) throw error;
    },
    onSuccess: () => Promise.all([invalidate(), invalidateKeys(queryClient, [['import-items'], ['import-batches'], ['plan-status']])]),
  });
}

/**
 * "Importar N" da prévia: grava os MARCADOS e descarta o resto numa transação só
 * (`finish_import_batch`). Compra parcelada nasce inteira, e chamar de novo num lote fechado
 * devolve 0 — dois toques não gravam duas vezes.
 */
export function useFinishImport() {
  const invalidate = useInvalidateFinance();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { batchId: string; itemIds: string[] }): Promise<number> => {
      const { data, error } = await supabase.rpc('finish_import_batch', {
        p_batch_id: input.batchId,
        p_item_ids: input.itemIds,
      });
      if (error) throw error;
      return data ?? 0;
    },
    onSuccess: () =>
      Promise.all([
        invalidate(),
        invalidateKeys(queryClient, [['import-items'], ['import-batch'], ['import-batches'], ['plan-status'], ['installments']]),
      ]),
  });
}

/** O lote: a CONTA decide o sentido das linhas e se "Parcela k/N" vira compra parcelada. */
export function useImportBatch(batchId: string | undefined) {
  return useQuery({
    enabled: Boolean(batchId),
    queryKey: ['import-batch', batchId ?? ''],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('import_batches')
        .select('id, status, account_id, filename, accounts(type, name)')
        .eq('id', batchId!)
        .single();
      if (error) throw error;
      return data as {
        id: string;
        status: 'parsing' | 'review' | 'done' | 'failed';
        account_id: string | null;
        filename: string | null;
        accounts: { type: string; name: string } | null;
      };
    },
  });
}

export function useDiscardImportItems() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase
        .from('import_items')
        .update({ status: 'discarded' })
        .in('id', ids);
      if (error) throw error;
    },
    onSuccess: () => invalidateKeys(queryClient, [['import-items'], ['import-batches']]),
  });
}

/** Corrige a categoria sugerida antes de aprovar. */
export function useUpdateImportItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      category?: string | null;
      /**
       * ⚠️ **O sentido precisa ser EDITÁVEL porque nem todo banco o expressa.** Medido em dois
       * extratos reais do Banco do Brasil (agosto e setembro de 2026): a linha "Pagto cartão
       * crédito" sai como `TRNTYPE=CREDIT` com valor POSITIVO, apesar de ser saída — o saldo só
       * fecha tratando-a como despesa (0,07 + 1.947,10 − 1.947,06 = 0,11 = `<LEDGERBAL>`).
       * Adivinhar pelo texto da linha é a lista de palavras que `agent.md` proíbe; quem decide é
       * quem confere antes de entrar, que é o que esta tela existe para fazer.
       */
      kind?: 'income' | 'expense';
    }) => {
      const patch: { suggested_category?: string | null; kind?: string } = {};
      if ('category' in input) patch.suggested_category = input.category ?? null;
      if (input.kind) patch.kind = input.kind;
      const { error } = await supabase.from('import_items').update(patch).eq('id', input.id);
      if (error) throw error;
    },
    onSuccess: () => invalidateKeys(queryClient, [['import-items'], ['import-batches']]),
  });
}

/**
 * "Corrigir a data no app" — o extrato é a fonte da verdade sobre QUANDO, e só sobre isso.
 *
 * ⚠️ **Não toca em categoria, conta nem descrição.** Essas a pessoa já ajustou à mão, e o extrato
 * não sabe mais do que ela sobre elas. O banco sabe o dia.
 *
 * ⚠️ **Isto pode TROCAR A FATURA da compra**, e é o comportamento certo: o trigger
 * `tg_transactions_set_invoice` roda no `update` e recalcula `invoice_id` pela data nova. A tela
 * avisa antes, porque o efeito aparece longe dali — foi assim que corrigir 6 datas mexeu no total
 * do ciclo em 14/09/2026.
 *
 * ⚠️ **`update_transaction_scoped` NÃO serve aqui**: ela recusa `occurred_at` de propósito (data
 * é de cada ocorrência; propagar empilharia a série no mesmo dia). O caminho é o mesmo
 * `update` direto que `useSaveTransaction` já usa, sob RLS.
 */
/**
 * "O extrato é a fonte da verdade": o lançamento do app que o item É passa a ter a data e o
 * valor do banco — o previsto do dentista (R$ 177,01 em 10/09) vira o que foi cobrado
 * (R$ 193,57 em 13/09). Na CONTA o banco ainda prova que aconteceu, e o previsto é baixado; no
 * cartão a baixa continua sendo da fatura. Lançamento SEM conta ganha a do lote: o extrato prova
 * onde ele foi pago, e no cartão é isso que o põe na fatura certa (`set_invoice`).
 */
export function useApplyImportToExisting() {
  const invalidate = useInvalidateFinance();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      itemId: string;
      transactionId: string;
      occurredAt: string;
      amountCents: number;
      baixar: boolean;
      /** A conta do lote, para o lançamento que não tinha conta (veio do WhatsApp sem dizer). */
      contaId?: string | null;
    }) => {
      const { error } = await supabase
        .from('transactions')
        .update({
          occurred_at: input.occurredAt,
          amount_cents: input.amountCents,
          ...(input.baixar ? { status: 'cleared' as const } : {}),
          ...(input.contaId ? { account_id: input.contaId } : {}),
        })
        .eq('id', input.transactionId);
      if (error) throw error;
      // Só depois de a correção passar: o item some da revisão porque o dinheiro já está no app.
      const { error: e2 } = await supabase
        .from('import_items')
        .update({ status: 'discarded' })
        .eq('id', input.itemId);
      if (e2) throw e2;
    },
    onSuccess: () =>
      Promise.all([invalidate(), invalidateKeys(queryClient, [['import-items'], ['import-batches']])]),
  });
}

/** "São coisas diferentes": desfaz o palpite e devolve o item para a fila normal. */
export function useUnmatchImportItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('import_items')
        .update({ status: 'pending', transaction_id: null })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => invalidateKeys(queryClient, [['import-items'], ['import-batches']]),
  });
}

export type UnmatchedTransaction = Fns['import_unmatched']['Returns'][number];

/**
 * A outra metade da conciliação: o que está no APP e não veio no extrato.
 *
 * Cada linha dessas é uma de três coisas, e a tela precisa dizer isso em vez de acusar: lançamento
 * manual que ainda não caiu no banco (normal perto do fim do período), duplicata digitada à mão,
 * ou erro de valor/data. **Nada aqui apaga sozinho.**
 *
 * ⚠️ Só faz sentido DEPOIS de o lote ser revisado — antes disso, tudo que está no extrato ainda
 * está `pending` e a lista seria o financeiro inteiro do período. Por isso `enabled` exige o
 * batch E a tela só monta a seção quando não há mais nada para revisar.
 */
export function useImportUnmatched(batchId: string | undefined, enabled: boolean) {
  return useQuery({
    enabled: Boolean(batchId) && enabled,
    queryKey: ['import-unmatched', batchId ?? ''],
    queryFn: async (): Promise<UnmatchedTransaction[]> => {
      const { data, error } = await supabase.rpc('import_unmatched', { p_batch_id: batchId! });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useRules() {
  useRealtimeInvalidate('categorization_rules', ['rules']);
  return useQuery({
    queryKey: ['rules'],
    queryFn: async (): Promise<CategorizationRule[]> => {
      const { data, error } = await supabase
        .from('categorization_rules')
        .select('id, match_type, pattern, category, account_id, priority, hits, source')
        .order('priority')
        .order('hits', { ascending: false });
      if (error) throw error;
      return data as CategorizationRule[];
    },
  });
}

/**
 * Cria ou edita uma regra.
 *
 * `account_id` existe em `categorization_rules` desde a `0017` e ficava de fora do input: dava
 * para criar a regra por SQL e não pela tela. Ele entra aqui como campo opcional — `null` é
 * "vale em qualquer conta", e o update precisa mandá-lo explicitamente para conseguir LIMPAR o
 * vínculo de uma regra que já tinha conta.
 *
 * `match_type` continua fixo em `contains` de propósito (`docs/design/regras.md` § Fora de
 * escopo): regex mal escrita categoriza errado em massa e em silêncio, que é a dor que esta tela
 * existe para curar.
 */
export function useSaveRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id?: string;
      pattern: string;
      category: string;
      accountId?: string | null;
    }) => {
      if (input.id) {
        const { error } = await supabase
          .from('categorization_rules')
          .update({
            pattern: input.pattern,
            category: input.category,
            account_id: input.accountId ?? null,
          })
          .eq('id', input.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('categorization_rules').insert({
          user_id: await userId(),
          match_type: 'contains',
          pattern: input.pattern,
          category: input.category,
          account_id: input.accountId ?? null,
          source: 'user',
        });
        if (error) throw error;
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['rules'] }),
  });
}

export function useDeleteRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('categorization_rules').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['rules'] }),
  });
}

// ── dívidas ─────────────────────────────────────────────────────────────────

/**
 * O glifo faz parte da opção, não da tela que a desenha.
 *
 * Mesma regra de `ACCOUNT_TYPES`: com o ícone morando aqui, o seletor do
 * formulário e a linha da lista mostram a MESMA forma para o mesmo tipo — e um
 * tipo novo nasce com glifo em vez de cair no `circle` genérico do Android.
 */
export const DEBT_KINDS = [
  { value: 'loan', label: 'Empréstimo', icon: 'building.columns' },
  { value: 'financing', label: 'Financiamento', icon: 'doc.text' },
  { value: 'credit_card', label: 'Rotativo', icon: 'creditcard' },
  { value: 'person', label: 'Pessoa', icon: 'person.fill' },
  { value: 'other', label: 'Outro', icon: 'shippingbox' },
] as const;

export type Debt = Pick<
  Tables['debts']['Row'],
  | 'id'
  | 'name'
  | 'principal_cents'
  | 'remaining_cents'
  | 'interest_rate_monthly'
  | 'installments'
  | 'installments_paid'
  | 'installment_cents'
  | 'account_id'
  | 'due_day'
  | 'archived'
> & { kind: (typeof DEBT_KINDS)[number]['value']; calculation_mode: 'amortized' | 'fixed_installments' };

export type DebtScheduleRow = Omit<Fns['debt_schedule']['Returns'][number], 'interest_cents' | 'principal_cents'> & { interest_cents: number | null; principal_cents: number | null };
export type PayoffRow = Omit<Fns['payoff_strategy']['Returns'][number], 'interest_rate_monthly' | 'total_interest_cents'> & { interest_rate_monthly: number | null; total_interest_cents: number | null };

export function useDebts() {
  useRealtimeInvalidate('debts', ['debts']);
  return useQuery({
    queryKey: ['debts'],
    queryFn: async (): Promise<Debt[]> => {
      const { data, error } = await supabase
        .from('debts')
        .select(
          'id, name, kind, calculation_mode, principal_cents, remaining_cents, interest_rate_monthly, installments, installments_paid, installment_cents, account_id, due_day, archived',
        )
        .eq('archived', false)
        .order('remaining_cents', { ascending: false });
      if (error) throw error;
      return data as Debt[];
    },
  });
}

/** Tabela de amortização do que ainda falta pagar (Price, calculada no banco). */
export function useDebtSchedule(debtId: string | undefined) {
  useRealtimeInvalidate('debts', ['debt-schedule']);
  return useQuery({
    enabled: Boolean(debtId),
    queryKey: ['debt-schedule', debtId ?? ''],
    queryFn: async (): Promise<DebtScheduleRow[]> => {
      const { data, error } = await supabase.rpc('debt_schedule', { p_debt_id: debtId! });
      if (error) throw error;
      return data;
    },
  });
}

/**
 * Os pagamentos JÁ REGISTRADOS de uma dívida (`pay_debt_installment` grava um
 * `transactions` com `debt_payment_no`). O histórico da tela mistura isto com as parcelas
 * apenas DECLARADAS na criação — ver `paidInstallments` em `@/lib/debt-history`.
 */
export function useDebtPayments(debtId: string | undefined) {
  useRealtimeInvalidate('transactions', ['debt-payments']);
  return useQuery({
    enabled: Boolean(debtId),
    queryKey: ['debt-payments', debtId ?? ''],
    queryFn: async (): Promise<DebtPaymentRow[]> => {
      const { data, error } = await supabase
        .from('transactions')
        .select('debt_payment_no, occurred_at, amount_cents')
        .eq('debt_id', debtId!)
        .order('occurred_at');
      if (error) throw error;
      return data;
    },
  });
}

/**
 * A conta padrão do espaço — onde cai o lançamento que não cita conta nenhuma.
 *
 * Lançamento do WhatsApp quase nunca diz de onde saiu o dinheiro, e o agente devolve `null` de
 * propósito (perder o registro é pior que registrá-lo sem conta). Sem uma conta padrão, o corte
 * "para onde o dinheiro foi" nasce com um balde só, chamado `Sem conta`.
 */
export function useDefaultAccount() {
  useRealtimeInvalidate('workspaces', ['default-account']);
  return useQuery({
    queryKey: ['default-account'],
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase
        .from('workspaces')
        .select('default_account_id')
        .eq('id', await workspaceId())
        .maybeSingle();
      if (error) throw error;
      return data?.default_account_id ?? null;
    },
  });
}

/**
 * Onde o mês financeiro do usuário começa e termina.
 *
 * ⚠️ **A aritmética do ciclo NÃO mora aqui.** Ela é `private.cycle_bounds` no banco, e o app
 * pergunta em vez de calcular — se as duas contas divergissem, o painel pediria N dias de
 * projeção enquanto o agrupamento usa outra borda, e os dois números da tela discordariam sem
 * erro nenhum. Uma chamada, cacheada; o painel já esperava a projeção de qualquer jeito.
 *
 * `closeDay` null = último dia do mês, que é o comportamento de sempre.
 */
export type CycleView = 'cycle' | 'civil';

export interface Cycle {
  /**
   * O dia CONFIGURADO, não o que está valendo.
   *
   * Ele continua preenchido quando `view` é `civil` — é o que a grade do Perfil e a do
   * onboarding mostram. Zerá-lo no modo civil apagaria a configuração na tela sem ninguém
   * ter pedido, e o caminho de volta para o ciclo deixaria de existir.
   */
  closeDay: number | null;
  /** Qual régua está valendo AGORA. `civil` ignora `closeDay` em toda leitura de mês. */
  view: CycleView;
  /** `2026-09` — o mês que dá NOME ao ciclo. É o mês em que ele termina. */
  mes: string;
  de: string;
  ate: string;
  diasAteOFim: number;
}

export function useCycle(view?: CycleView) {
  useRealtimeInvalidate('workspaces', ['cycle']);
  return useQuery({
    queryKey: ['cycle', view ?? ''],
    queryFn: async (): Promise<Cycle> => {
      const { data, error } = await supabase.rpc('cycle_now', { p_view: view ?? undefined });
      if (error) throw error;
      return data as unknown as Cycle;
    },
    /**
     * ⚠️ **Cache curto DE PROPÓSITO: o ciclo vira sozinho, e o cache não podia segurar isso.**
     *
     * Com 12 horas (o valor anterior) o app passava meia virada mostrando o ciclo velho: às
     * 00h01 do dia 11, com fechamento no dia 10, `cycle_now` no banco já responde o ciclo
     * novo e o telefone continuava desenhando o antigo até a tarde. A pergunta foi literal:
     * *"se eu já estou no dia 11 e meu ciclo fecha dia 10, os gráficos mudam automaticamente?
     * ele tem que mudar automaticamente se já passou"*.
     *
     * Cinco minutos porque a resposta é uma linha de JSON e a tela já espera a projeção de
     * qualquer jeito; `refetchOnWindowFocus` cobre o caso de o app ficar aberto atravessando
     * a virada.
     */
    staleTime: 5 * 60 * 1000,
    // São só duas respostas pequenas (Mês e Ciclo). Conservar a régua inativa
    // evita que o primeiro toque após alguns minutos volte a uma chave vazia.
    gcTime: Infinity,
    refetchOnWindowFocus: true,
  });
}

/**
 * O mês que dá NOME ao ciclo corrente — `2026-10` no dia 13/09, com fechamento no dia 10.
 *
 * ⚠️ **Não é `currentMonth()`, e a diferença dura até 20 dias por mês.** Mês civil e
 * mês-nome-de-ciclo são os dois uma `string YYYY-MM`, então nada no compilador separa os dois.
 * Quem passou o civil para `useCycleSeries` recebeu de volta o ciclo ANTERIOR, **já fechado**, e
 * carimbou nele a data de fim do corrente. Aconteceu em duas telas ao mesmo tempo: na Hoje
 * (número, sinal, cor e palavra errados de uma vez — "R$ 0,72 · Projeção positiva" onde o ciclo
 * fecha em −R$ 759,39) e em Lançamentos, a tela inteira um ciclo atrás.
 *
 * O idioma estava certo e DUPLICADO em `finance/index.tsx` e `budgets.tsx`, com a armadilha
 * descrita em prosa numa terceira. Duplicado é o que ele deixa de ser.
 *
 * ⚠️ **Tem que ser hook, não semente.** `useState(() => currentMonth())` roda uma vez, na
 * montagem, quando `cycle_now` ainda não respondeu — então ele fixaria o palpite civil e nunca
 * se corrigiria. Quem escolhe um mês guarda a ESCOLHA (`string | null`) e cai neste valor
 * enquanto ela for nula.
 *
 * Enquanto a resposta não chega, o mês civil é o palpite — e é o valor CERTO para quem nunca
 * configurou dia de fechamento, que é o padrão.
 */
export function useCycleMonth(view?: CycleView): string {
  return useCycle(view).data?.mes ?? localISODate().slice(0, 7);
}

/**
 * As bordas do ciclo de um mês QUALQUER — para as telas que navegam entre meses.
 *
 * `useCycle` responde pelo ciclo corrente e basta para o painel; a lista de lançamentos, o
 * recorte por categoria e a comparação com o mês anterior precisam das bordas do mês que o
 * usuário abriu. Enquanto a resposta não chega, o mês civil é o palpite — e é o valor certo
 * para quem não mexeu na configuração.
 */
export function useCycleRange(month: string, view?: CycleView) {
  useRealtimeInvalidate('workspaces', ['cycle-range']);
  return useQuery({
    queryKey: ['cycle-range', month, view ?? ''],
    queryFn: async (): Promise<{ de: string; ate: string }> => {
      const { data, error } = await supabase.rpc('cycle_range', { p_month: primeiroDiaDoMes(month), p_view: view ?? undefined });
      if (error) throw error;
      return data as unknown as { de: string; ate: string };
    },
    // Esta NÃO depende de "hoje" — as bordas de um mês nomeado só mudam se o usuário trocar o
    // dia de fechamento, e `useSetCycleCloseDay` invalida a chave.
    staleTime: 12 * 60 * 60 * 1000,
  });
}

/**
 * As bordas do mês exibido — e o ESTADO da consulta que as resolve.
 *
 * É uma `Consulta` de propósito: o portão da tela (`useTelaPronta`) recebe o range inteiro, e
 * não um booleano derivado dele. Ver `tela-pronta.ts` para o defeito que isso fecha.
 */
export interface MonthRange extends Consulta {
  /** Início da janela. Enquanto `pronto` é `false`, é o PALPITE civil — nunca busque com ele. */
  from: string;
  /** Fim da janela, com a mesma ressalva de `from`. */
  to: string;
  /**
   * As bordas já são as DEFINITIVAS — a única condição em que elas podem virar chave de consulta.
   *
   * ⚠️ `pronto` tem UM trabalho: decidir se uma consulta pode buscar com estas bordas
   * (`enabled`). Ele já teve dois, e o segundo — decidir se a TELA sai do skeleton — era o
   * defeito: com a consulta falhando ele fica `false` para sempre. Para o portão, passe o range.
   */
  pronto: boolean;
  /**
   * Não há bordas utilizáveis: a consulta falhou e não existe resposta anterior.
   *
   * ⚠️ **Não é o `isError` do TanStack.** Aquele continua `true` quando um REFETCH falha por
   * cima de um dado bom, e as bordas de um mês nomeado só mudam quando o usuário troca o dia de
   * fechamento — que invalida a chave. Um refetch de fundo que falhou não torna as bordas que já
   * estão na tela erradas, então não pode trocá-las por um card de erro.
   */
  isError: boolean;
  /** Refaz a consulta das bordas. É o "Tentar de novo" de todo bloco que depende delas. */
  refetch: () => Promise<unknown>;
}

/**
 * As bordas do mês exibido: o ciclo quando ele já chegou, o mês civil enquanto não.
 *
 * ⚠️ **Quem desenha a partir destas bordas espera `pronto`.** O palpite civil existe para a
 * chave de uma consulta ter um valor estável antes da resposta, não para ser buscado: uma lista
 * que buscasse com ele mostraria linhas de outro período e depois as trocaria, e um total
 * buscado com ele ficaria ERRADO para sempre se as bordas falhassem — números de setembro sob o
 * rótulo "outubro", com fechamento no dia 10. Por isso `useTransactions` e
 * `useTransactionsSummary` recebem `pronto` e só ligam com ele.
 */
export function useMonthRange(month: string, view?: CycleView): MonthRange {
  const ciclo = useCycleRange(month, view);
  const bordas = ciclo.data ? { from: ciclo.data.de, to: ciclo.data.ate } : monthBounds(month);
  return {
    ...bordas,
    pronto: Boolean(ciclo.data),
    isPending: ciclo.isPending,
    fetchStatus: ciclo.fetchStatus,
    isError: ciclo.isError && !ciclo.data,
    refetch: ciclo.refetch,
  };
}

/**
 * Tudo que uma troca de RÉGUA (dia de fechamento, ou mês civil × ciclo) invalida.
 *
 * ⚠️ `budgets-status` é a única que NÃO se conserta sozinha. As outras são chaveadas por
 * `from`/`to`, que saem de `useCycleRange` e mudam junto com a régua; a do orçamento é chaveada
 * pelo RÓTULO do mês, que é o mesmo `2026-09` nas duas — sem esta linha a tela seguiria
 * mostrando a soma da régua antiga até alguém puxar para atualizar.
 */
const REGUA_MUDOU = [
  ['cycle'],
  /*
    A chave carrega `view`, então trocar Mês↔Ciclo já se conserta sozinha — mas mudar o DIA DE
    FECHAMENTO move a janela para a MESMA view, e aí só esta linha salva.
  */
  ['spendable'],
  ['cycle-series'],
  ['cycle-lines'],
  ['cycle-range'],
  ['forecast'],
  ['forecast-drafts'],
  ['forecast-months'],
  ['monthly-cashflow'],
  ['month-summary'],
  ['month-lines'],
  ['month-breakdown'],
  ['budgets-status'],
];

export function useSetCycleCloseDay() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (day: number | null) => {
      const { error } = await supabase
        .from('workspaces')
        .update({ cycle_close_day: day })
        .eq('id', await workspaceId());
      if (error) throw error;
    },
    // Muda a borda de TODA leitura de mês: painel, tendência, mês a mês e a tela do mês.
    onSuccess: () => invalidateKeys(queryClient, REGUA_MUDOU),
  });
}


export function useSetDefaultAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (accountId: string | null) => {
      const { error } = await supabase
        .from('workspaces')
        .update({ default_account_id: accountId })
        .eq('id', await workspaceId());
      if (error) throw error;
    },
    onSuccess: () => invalidateKeys(queryClient, [['default-account']]),
  });
}

/**
 * A visão de MÊS — as três leituras da tela `Mês`.
 *
 * `month` chega como `YYYY-MM`; as RPCs recebem o primeiro dia. Cada uma invalida em
 * `transactions`, `debts`, `recurring_transactions` **e** `accounts`: o rótulo do meio de
 * pagamento É `accounts.name`, então renomear uma conta muda o que a tela escreve.
 */
function useRealtimeMonth(key: string) {
  useRealtimeInvalidate('transactions', [key]);
  useRealtimeInvalidate('debts', [key]);
  useRealtimeInvalidate('recurring_transactions', [key]);
  useRealtimeInvalidate('accounts', [key]);
}


/**
 * A linha do tempo de ciclos — a ÚNICA leitura de "como fecha o período".
 *
 * Ela substitui o par `useMonthSummary` + `useForecastMonths`, que respondiam a mesma pergunta
 * com bases diferentes: a primeira contava o cartão na data da COMPRA, a segunda na data do
 * PAGAMENTO, as duas navegavam meses, e nenhuma tela dizia qual era qual. Foi a causa medida do
 * *"eu ainda estou 100% perdido no app"* (13/09/2026).
 *
 * Aqui a base é uma só: **o dia em que o dinheiro sai da conta**. Compra no cartão entra no
 * ciclo em que a FATURA VENCE.
 *
 * ⚠️ **Série, não mês.** `comecei_com` de um ciclo futuro é o `resultado` do anterior, e isso
 * não cabe numa chamada por mês — pedir os ciclos um a um devolveria cada um partindo do caixa
 * de hoje, e a corrente (que é o produto) não existiria.
 */
export type CycleRow = Fns['cycle_series']['Returns'][number];
export type CycleLine = Fns['cycle_lines']['Returns'][number];

export function useCycleSeries(de: string, ate: string, view?: CycleView) {
  useRealtimeMonth('cycle-series');
  return useQuery({
    queryKey: ['cycle-series', de, ate, view ?? ''],
    queryFn: async (): Promise<CycleRow[]> => {
      const { data, error } = await supabase.rpc('cycle_series', {
        de: primeiroDiaDoMes(de), ate: primeiroDiaDoMes(ate), p_view: view ?? undefined,
      });
      if (error) throw error;
      return data;
    },
  });
}

export type Spendable = Fns['spendable']['Returns'][number];

/**
 * O que dá para gastar AGORA — o número da tela Hoje.
 *
 * `livre = caixa − comprometido_ate_entrada`: o dinheiro na conta menos o que vence ANTES da
 * próxima entrada prevista. É a pergunta "posso gastar isto hoje?", e ela termina no dia em que
 * entra dinheiro novo.
 *
 * ⚠️ **Não é o resultado do ciclo, e é por isso que os dois cards deixaram de dizer a mesma
 * coisa.** O Financeiro responde "como o ciclo fecha" (−R$ 759,39 em 10/10); este responde
 * "quanto está livre até a próxima entrada" (R$ 0,72 até 20/09). Mesmos dados, perguntas
 * diferentes, e a identidade
 * `caixa + a_receber_no_ciclo − comprometido_no_ciclo == cycle_series.resultado` amarra os dois
 * (`supabase/tests/da_para_gastar.sql`).
 *
 * ⚠️ `proxima_entrada` é NULL quando não há entrada prevista no ciclo — a tela trata.
 */
export function useSpendable(view?: CycleView) {
  useRealtimeMonth('spendable');
  useRealtimeInvalidate('card_invoices', ['spendable']);
  return useQuery({
    queryKey: ['spendable', view ?? ''],
    queryFn: async (): Promise<Spendable> => {
      const { data, error } = await supabase.rpc('spendable', { p_view: view ?? undefined });
      if (error) throw error;
      return (data as Spendable[])[0];
    },
  });
}

/** Um evento que forma o "livre" da Hoje (`public.spendable_path`) — a Pista. */
export type SpendablePathRow = Fns['spendable_path']['Returns'][number];

/**
 * A MESMA lista que produz `comprometido_ate_entrada`. Chaveada junto do `spendable` para as
 * duas envelhecerem juntas; `montarPista` ainda confere a soma e não desenha se não bater.
 */
export function useSpendablePath(view?: CycleView) {
  useRealtimeMonth('spendable-path');
  useRealtimeInvalidate('card_invoices', ['spendable-path']);
  return useQuery({
    queryKey: ['spendable-path', view ?? ''],
    queryFn: async (): Promise<SpendablePathRow[]> => {
      const { data, error } = await supabase.rpc('spendable_path', { p_view: view ?? undefined });
      if (error) throw error;
      return (data ?? []) as SpendablePathRow[];
    },
  });
}

export function useCycleLines(month: string, view?: CycleView) {
  useRealtimeMonth('cycle-lines');
  return useQuery({
    enabled: month.length >= 7,
    queryKey: ['cycle-lines', month, view ?? ''],
    queryFn: async (): Promise<CycleLine[]> => {
      const { data, error } = await supabase.rpc('cycle_lines', {
        p_month: primeiroDiaDoMes(month), p_view: view ?? undefined,
      });
      if (error) throw error;
      return data;
    },
  });
}

export type MonthLine = Fns['month_lines']['Returns'][number];
export type MonthSummary = Fns['month_summary']['Returns'][number];
export type MonthBreakdownRow = Fns['month_breakdown']['Returns'][number];

export function useMonthLines(month: string, view?: CycleView) {
  useRealtimeMonth('month-lines');
  return useQuery({
    queryKey: ['month-lines', month, view ?? ''],
    queryFn: async (): Promise<MonthLine[]> => {
      const { data, error } = await supabase.rpc('month_lines', { p_month: primeiroDiaDoMes(month), p_view: view ?? undefined });
      if (error) throw error;
      return data;
    },
  });
}

/**
 * `enabled` existe para o mês EXPANDIDO da Projeção: lá o mês só é conhecido quando o usuário
 * toca numa linha, e hook não pode ser condicional. Sem isto, o estado "nenhum expandido"
 * chamaria a RPC com `-01` e a tela nasceria em erro.
 */
export function useMonthSummary(month: string, enabled = true, view?: CycleView) {
  useRealtimeMonth('month-summary');
  return useQuery({
    enabled: enabled && month.length === 7,
    queryKey: ['month-summary', month, view ?? ''],
    // A RPC devolve UMA linha; o hook entrega o objeto para a tela não escrever `[0]` em toda leitura.
    queryFn: async (): Promise<MonthSummary | null> => {
      const { data, error } = await supabase.rpc('month_summary', { p_month: primeiroDiaDoMes(month), p_view: view ?? undefined });
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });
}

export function useMonthBreakdown(
  month: string,
  groupBy: 'natureza' | 'meio' | 'categoria',
  view?: CycleView,
) {
  useRealtimeMonth('month-breakdown');
  return useQuery({
    queryKey: ['month-breakdown', month, groupBy, view ?? ''],
    queryFn: async (): Promise<MonthBreakdownRow[]> => {
      const { data, error } = await supabase.rpc('month_breakdown', {
        p_month: primeiroDiaDoMes(month),
        p_group_by: groupBy,
        p_view: view ?? undefined,
      });
      if (error) throw error;
      return data;
    },
  });
}

/** Ordem de ataque: 'avalanche' (mais juros) ou 'snowball' (menor saldo). */
export function usePayoffStrategy(estrategia: 'avalanche' | 'snowball') {
  useRealtimeInvalidate('debts', ['payoff']);
  return useQuery({
    queryKey: ['payoff', estrategia],
    queryFn: async (): Promise<PayoffRow[]> => {
      const { data, error } = await supabase.rpc('payoff_strategy', { estrategia });
      if (error) throw error;
      return data;
    },
  });
}

export function useSaveDebt() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (input: {
      id?: string;
      name: string;
      kind: Debt['kind'];
      calculation_mode?: Debt['calculation_mode'];
      principal_cents: number;
      remaining_cents: number;
      interest_rate_monthly: number;
      installments: number | null;
      installments_paid?: number;
      installment_cents: number | null;
      account_id: string | null;
      due_day: number | null;
    }) => {
      const { id, ...resto } = input;
      if (id) {
        const { error } = await supabase.from('debts').update(resto).eq('id', id).select('id').single();
        if (error) throw error;
      } else {
        const { error } = await supabase.from('debts').insert({ ...resto, user_id: await userId() });
        if (error) throw error;
      }
    },
    onSuccess: invalidate,
  });
}

/** Paga uma parcela: a RPC cria a despesa e abate o saldo já descontando juros. */
export function usePayDebtInstallment() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (input: { debtId: string; amountCents: number; accountId?: string | null }) => {
      const { error } = await supabase.rpc('pay_debt_installment', {
        p_debt_id: input.debtId,
        p_amount_cents: input.amountCents,
        p_account_id: input.accountId ?? undefined,
        p_paid_at: localISODate(),
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

export function useArchiveDebt() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('debts').update({ archived: true }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

// ── patrimônio, investimentos e relatórios ──────────────────────────────────

export const ASSET_CLASSES = [
  { value: 'investment', label: 'Investimento', icon: 'chart.line.uptrend.xyaxis' },
  { value: 'real_estate', label: 'Imóvel', icon: 'house' },
  { value: 'vehicle', label: 'Veículo', icon: 'car' },
  { value: 'crypto', label: 'Cripto', icon: 'bitcoinsign.circle' },
  { value: 'equity', label: 'Participação', icon: 'chart.pie' },
  { value: 'receivable', label: 'A receber', icon: 'clock.arrow.circlepath' },
  { value: 'other', label: 'Outro', icon: 'shippingbox' },
] as const;

export type Asset = Pick<
  Tables['assets']['Row'],
  'id' | 'name' | 'is_liability' | 'current_value_cents' | 'acquired_at' | 'archived'
> & { class: (typeof ASSET_CLASSES)[number]['value'] };

export type NetWorth = Fns['net_worth']['Returns'][number];
export type NetWorthPoint = Fns['net_worth_series']['Returns'][number];
export type AnnualSummary = Fns['annual_summary']['Returns'][number];
export type AnnualCategoryRow = Omit<Fns['annual_by_category']['Returns'][number], 'kind'> & {
  kind: 'expense' | 'income';
};
export type YearEndBalance = Omit<Fns['year_end_balances']['Returns'][number], 'kind'> & {
  kind: 'account' | 'asset';
};
export type FinancialHealth = Fns['financial_health']['Returns'][number];

export function useAssets() {
  useRealtimeInvalidate('assets', ['assets']);
  return useQuery({
    queryKey: ['assets'],
    queryFn: async (): Promise<Asset[]> => {
      const { data, error } = await supabase
        .from('assets')
        .select('id, name, class, is_liability, current_value_cents, acquired_at, archived')
        .eq('archived', false)
        .order('current_value_cents', { ascending: false });
      if (error) throw error;
      return data as Asset[];
    },
  });
}

/** Patrimônio de hoje, calculado na hora (não espera o snapshot do cron). */
export function useNetWorth() {
  useRealtimeInvalidate('transactions', ['net-worth']);
  useRealtimeInvalidate('assets', ['net-worth']);
  return useQuery({
    queryKey: ['net-worth'],
    queryFn: async (): Promise<NetWorth | null> => {
      const { data, error } = await supabase.rpc('net_worth');
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });
}

/** Série histórica — vem dos snapshots diários, começa quando o app começou. */
/**
 * Saldo em caixa nos últimos N dias — o PASSADO da projeção.
 *
 * Sai das fotos diárias de `net_worth_snapshots`, cujo `cash_cents` é o mesmo
 * `private.cash_total` em que a projeção se ancora (`finance.md`: fonte única) — por isso as
 * duas pontas se encontram no valor de hoje em vez de dar um degrau.
 *
 * A soma por dia é obrigatória: quem participa de dois workspaces tem duas fotos por data, e
 * pegar "a linha do dia" traria só uma delas. É exatamente o defeito que a `0047` corrigiu na
 * série do patrimônio — não vale reintroduzi-lo aqui, no cliente.
 */
export function useCashHistory(days: number, enabled = true) {
  return useQuery({
    enabled,
    queryKey: ['cash-history', String(days)],
    queryFn: async (): Promise<{ day: string; cents: number }[]> => {
      const desde = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
      // ⚠️ **Do mais NOVO para o mais velho, com teto explícito.** O PostgREST corta em 1000
      // linhas de qualquer jeito; pedindo em ordem crescente ele devolveria as 1.000 fotos
      // MAIS ANTIGAS e jogaria fora o passado recente — que é justamente a metade que encosta
      // no dia 0 da projeção, e o degrau que o comentário acima diz não existir apareceria.
      // Com o horizonte de 10 anos este hook passou a pedir 3.650 dias, então isto deixou de
      // ser teórico: estoura com ~1.000 fotos (uma por dia, ou ~500 com dois workspaces).
      // A ordenação crescente que a curva precisa é feita no `sort` logo abaixo.
      const { data, error } = await supabase
        .from('net_worth_snapshots')
        .select('as_of, cash_cents')
        .gte('as_of', desde)
        .order('as_of', { ascending: false })
        .limit(1000);
      if (error) throw error;
      const porDia = new Map<string, number>();
      for (const row of data ?? []) {
        porDia.set(row.as_of, (porDia.get(row.as_of) ?? 0) + Number(row.cash_cents));
      }
      return Array.from(porDia, ([day, cents]) => ({ day, cents })).sort((a, b) =>
        a.day < b.day ? -1 : 1
      );
    },
  });
}

export function useNetWorthSeries(monthsBack = 12) {
  return useQuery({
    queryKey: ['net-worth-series', String(monthsBack)],
    queryFn: async (): Promise<NetWorthPoint[]> => {
      const { data, error } = await supabase.rpc('net_worth_series', { months_back: monthsBack });
      if (error) throw error;
      return data;
    },
  });
}

export function useSaveAsset() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (input: {
      id?: string;
      name: string;
      class: Asset['class'];
      is_liability: boolean;
      current_value_cents: number;
      /**
       * Edição: só marca valor novo quando ele mudou de verdade. Sem isso um rename
       * grava uma marcação de hoje no histórico com o valor antigo — dado inventado.
       */
      revalue?: boolean;
    }) => {
      const { id, revalue = true, ...resto } = input;
      if (!id) {
        const { error } = await supabase.from('assets').insert({ ...resto, user_id: await userId() });
        if (error) throw error;
        return;
      }
      // Nome, classe e passivo só existem em `assets` e a RPC de valor não os toca — antes
      // eram descartados em silêncio no modo edição (não havia como renomear nem reclassificar).
      // O valor NUNCA entra por aqui: coluna de valor só muda via update_asset_value.
      const { error: erroAtributos } = await supabase
        .from('assets')
        .update({ name: resto.name, class: resto.class, is_liability: resto.is_liability })
        .eq('id', id);
      if (erroAtributos) throw erroAtributos;

      if (!revalue) return;
      // pela RPC para o valor virar marcação no histórico, não só um update
      const { error } = await supabase.rpc('update_asset_value', {
        p_asset_id: id,
        p_value_cents: resto.current_value_cents,
        p_as_of: localISODate(),
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

export function useArchiveAsset() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('assets').update({ archived: true }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

/** Relatório do ano: totais, categorias e saldos em 31/12 (o que o IR pede). */
export function useAnnualReport(year: number) {
  return useQuery({
    queryKey: ['annual-report', String(year)],
    queryFn: async (): Promise<{
      summary: AnnualSummary | null;
      categories: AnnualCategoryRow[];
      yearEnd: YearEndBalance[];
    }> => {
      const [summary, categories, yearEnd] = await Promise.all([
        supabase.rpc('annual_summary', { p_year: year }),
        supabase.rpc('annual_by_category', { p_year: year }),
        supabase.rpc('year_end_balances', { p_year: year }),
      ]);
      if (summary.error) throw summary.error;
      if (categories.error) throw categories.error;
      if (yearEnd.error) throw yearEnd.error;
      return {
        summary: summary.data?.[0] ?? null,
        categories: (categories.data ?? []) as AnnualCategoryRow[],
        yearEnd: (yearEnd.data ?? []) as YearEndBalance[],
      };
    },
  });
}

export function useFinancialHealth() {
  useRealtimeInvalidate('transactions', ['financial-health']);
  return useQuery({
    queryKey: ['financial-health'],
    queryFn: async (): Promise<FinancialHealth | null> => {
      const { data, error } = await supabase.rpc('financial_health');
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });
}

// ── plano, família e assinatura ─────────────────────────────────────────────

export const PLANS = [
  { value: 'free', label: 'Free', price: 'grátis', pitch: '1 pessoa · 100 mensagens/mês' },
  { value: 'pro', label: 'Pro', price: 'R$ 24,90/mês', pitch: '3 pessoas · 1.000 mensagens · importação' },
  { value: 'family', label: 'Família', price: 'R$ 39,90/mês', pitch: '5 pessoas · 2.000 mensagens · importação' },
] as const;

export type PlanStatus = Fns['plan_status']['Returns'][number];

export type WorkspaceInvite = Pick<
  Tables['workspace_invites']['Row'],
  'id' | 'phone' | 'created_at'
> & { role: 'member' | 'viewer'; status: 'pending' | 'accepted' | 'revoked' };

export function usePlanStatus() {
  return useQuery({
    queryKey: ['plan-status'],
    queryFn: async (): Promise<PlanStatus | null> => {
      const { data, error } = await supabase.rpc('plan_status');
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });
}

export function useInvites() {
  return useQuery({
    queryKey: ['invites'],
    queryFn: async (): Promise<WorkspaceInvite[]> => {
      const { data, error } = await supabase
        .from('workspace_invites')
        .select('id, phone, role, status, created_at')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as WorkspaceInvite[];
    },
  });
}

/**
 * O telefone gravado em `profiles.phone` vem do login (`+55` + dígitos), então o
 * convite precisa guardar no MESMO formato — senão o match no aceite nunca casa.
 */
function normalizaTelefone(entrada: string): string {
  const digitos = entrada.replace(/\D/g, '');
  // 10 ou 11 dígitos = número BR sem DDI; qualquer coisa maior já veio com ele
  return digitos.length <= 11 ? `55${digitos}` : digitos;
}

/** Convite é por telefone: é o mesmo vínculo que o WhatsApp usa. */
export function useInviteMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { phone: string; role: 'member' | 'viewer' }) => {
      const { error } = await supabase.from('workspace_invites').insert({
        workspace_id: await workspaceId(),
        invited_by: await userId(),
        phone: normalizaTelefone(input.phone),
        role: input.role,
      });
      if (error) throw error;
    },
    onSuccess: () => invalidateKeys(queryClient, [['invites'], ['plan-status']]),
  });
}

export function useRevokeInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('workspace_invites')
        .update({ status: 'revoked' })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invites'] }),
  });
}

/** Cancelar é uma chamada, sem formulário — de propósito. */
export function useCancelSubscription() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('cancel_subscription');
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['plan-status'] }),
  });
}

export interface TransactionInput {
  kind: TransactionKind;
  amount_cents: number;
  category: string | null;
  description: string | null;
  account_id: string | null;
  counterparty_account_id: string | null;
  occurred_at: string;
  /**
   * Os três campos abaixo são OPCIONAIS de propósito. `update` recebe o objeto espalhado, então
   * chave ausente = coluna intocada — telas que só corrigem categoria (o detalhe do lançamento)
   * não podem zerar o vencimento de uma conta a pagar sem saber.
   */
  /** `pending` = ainda vai acontecer (conta a pagar); default do banco é `cleared`. */
  status?: 'pending' | 'cleared';
  /** Vencimento YYYY-MM-DD. É o que alimenta `upcoming_bills` e a projeção de caixa. */
  due_at?: string | null;
  merchant?: string | null;
  /** Só muda algo em `pending`: `_promote_due_transactions` não olha linha já baixada. */
  auto_confirm?: boolean;
}

/**
 * `fee_cents` é o **Pix no crédito**: pagar um boleto por Pix usando o limite do cartão
 * custa mais do que o boleto pedia. As duas metades viram DUAS linhas na mesma fatura,
 * porque são duas coisas diferentes — o que foi pago e o que custou pagar assim. Uma linha
 * só, no valor cobrado, esconderia o juro dentro do gasto e ele nunca apareceria num
 * orçamento nem numa soma do ano.
 *
 * Quem resolve a fatura das duas é o trigger `set_invoice`: mesma conta e mesma data caem
 * no mesmo ciclo, sem o app calcular nada.
 */
export function useSaveTransaction() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async ({ id, fee_cents, ...input }: TransactionInput & { id?: string; fee_cents?: number }) => {
      if (id) {
        const { error } = await supabase.from('transactions').update(input).eq('id', id).select('id').single();
        if (error) throw error;
        return;
      }
      const uid = await userId();
      const compra = { ...input, user_id: uid, source: 'app' as const };
      const linhas = [compra];
      // Segunda trava: juro do Pix no crédito é custo de um GASTO. Numa receita ou transferência
      // ele viraria dinheiro entrando, ou movido, com o nome de juro.
      if (fee_cents && fee_cents > 0 && input.kind === 'expense') {
        linhas.push({
          ...compra,
          amount_cents: fee_cents,
          category: 'juros',
          description: 'Juros do Pix no crédito',
          // O favorecido é da compra, não do juro: o juro é do banco.
          merchant: null,
        });
      }
      // Um insert só: meia gravação deixaria o juro sem a compra (ou o contrário) na fatura.
      const { error } = await supabase.from('transactions').insert(linhas);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

export function useDeleteTransaction() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('transactions').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

/**
 * Apaga a compra parcelada INTEIRA.
 *
 * Um `delete` só: `transactions.installment_plan_id` tem `on delete cascade`,
 * então as N parcelas caem junto. Antes disso, cancelar uma compra em 12x
 * significava apagar doze lançamentos um por um, navegando doze meses.
 *
 * Não tem "Desfazer": o cascade não volta. Por isso quem chama precisa
 * confirmar nomeando o estrago (`confirmDestructive`).
 */
export function useDeleteInstallmentPlan() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (planId: string) => {
      const { error } = await supabase.from('installment_plans').delete().eq('id', planId);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

/**
 * Editar uma parcela/ocorrência e, se o usuário escolher, as FUTURAS da mesma série.
 *
 * O escopo mora na RPC porque um laço aqui faria N chamadas sem transação: caindo no
 * meio, metade das parcelas fica com o valor novo e o total do plano com o velho. A RPC
 * também recalcula `installment_plans.total_cents` e propaga para a regra da recorrência
 * — coisas que o cliente não tem como fazer atomicamente.
 *
 * `patch` é parcial de propósito: chave ausente = não mexe, chave com `null` = limpa.
 * Mandar o objeto inteiro faria "editei só o nome" reescrever a categoria das 40 parcelas.
 */
export function useSaveTransactionScoped() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async ({
      id,
      scope,
      patch,
    }: {
      id: string;
      scope: 'one' | 'future';
      patch: Partial<Pick<TransactionInput, 'amount_cents' | 'category' | 'description' | 'merchant' | 'account_id'>>;
    }) => {
      const { data, error } = await supabase.rpc('update_transaction_scoped', {
        p_transaction_id: id,
        p_scope: scope,
        p_patch: patch,
      });
      if (error) throw error;
      return Number(data ?? 0);
    },
    onSuccess: invalidate,
  });
}

/** Cria ou edita (mesma forma de useSaveTransaction: com `id` vira update). */
export function useSaveAccount() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async ({
      id,
      ...input
    }: {
      id?: string;
      name: string;
      type: Account['type'];
      initial_balance_cents: number;
      // só para credit_card; o check do banco exige null nos outros tipos
      closing_day?: number | null;
      due_day?: number | null;
      credit_limit_cents?: number | null;
      payment_account_id?: string | null;
      closing_day_inclusive?: boolean;
      rotativo_auto?: boolean;
      rotativo_rate_monthly?: number | null;
    }) => {
      if (id) {
        const { error } = await supabase.from('accounts').update(input).eq('id', id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('accounts').insert({ ...input, user_id: await userId() });
        if (error) throw error;
      }
    },
    onSuccess: invalidate,
  });
}

export function useArchiveAccount() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('accounts').update({ archived: true }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

/** Cria ou edita (mesma forma de useSaveTransaction: com `id` vira update). */
export function useSaveGoal() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async ({
      id,
      ...input
    }: {
      id?: string;
      name: string;
      target_cents: number;
      deadline: string | null;
    }) => {
      if (id) {
        const { error } = await supabase.from('goals').update(input).eq('id', id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('goals').insert({ ...input, user_id: await userId() });
        if (error) throw error;
      }
    },
    onSuccess: invalidate,
  });
}

/**
 * Aporte (ou retirada, com valor negativo) pela RPC atômica: grava no ledger e
 * recalcula `saved_cents` a partir da soma. O += no cliente que existia aqui
 * perdia aporte quando dois dispositivos lançavam junto.
 */
export function useGoalDeposit() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async ({ goal, amountCents, note }: {
      goal: Goal;
      amountCents: number;
      note?: string;
    }) => {
      const { error } = await supabase.rpc('goal_deposit', {
        p_goal_id: goal.id,
        p_amount_cents: amountCents,
        p_occurred_at: localISODate(),
        p_note: note ?? undefined,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

export type GoalContribution = Pick<
  Tables['goal_contributions']['Row'],
  'id' | 'amount_cents' | 'occurred_at' | 'note'
>;

/** Extrato de aportes da meta. */
export function useGoalContributions(goalId: string | undefined) {
  useRealtimeInvalidate('goal_contributions', ['goal-contributions']);
  return useQuery({
    enabled: Boolean(goalId),
    queryKey: ['goal-contributions', goalId ?? ''],
    queryFn: async (): Promise<GoalContribution[]> => {
      const { data, error } = await supabase
        .from('goal_contributions')
        .select('id, amount_cents, occurred_at, note')
        .eq('goal_id', goalId!)
        .order('occurred_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useArchiveGoal() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('goals').update({ archived: true }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

/** Pausar/retomar a série. Pausada = o cron ignora, mas o histórico fica. */
export function useToggleRecurring() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      // retomar também limpa o erro anterior: a próxima tentativa começa do zero
      const patch = active ? { active: true, run_attempts: 0, last_error: null } : { active: false };
      const { error } = await supabase.from('recurring_transactions').update(patch).eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

/** Apaga a série. O trigger `recurring_drop_future` leva junto as ocorrências futuras em aberto; histórico e atrasado ficam. */
export function useDeleteRecurring() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('recurring_transactions').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

export function useSaveBudget() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (input: {
      category: string;
      limit_cents: number;
      rollover?: boolean;
      /** YYYY-MM para sobrescrever só aquele mês; omitido = limite padrão. */
      month?: string | null;
    }) => {
      // Via RPC, não upsert: os unique de `budgets` são PARCIAIS (month null vs
      // not null) e o Postgres só casa índice parcial se o ON CONFLICT repetir o
      // predicado — que o PostgREST não tem como mandar. Fazia todo salvamento
      // estourar 42P10.
      const { error } = await supabase.rpc('save_budget', {
        p_category: input.category,
        p_limit_cents: input.limit_cents,
        p_rollover: input.rollover ?? false,
        p_month: input.month ? primeiroDiaDoMes(input.month) : undefined,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

export function useDeleteBudget() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('budgets').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

// ── parceladas, faturas antigas, importações e pessoas ──────────────────────
//
// Estas quatro leituras não têm RPC de agregação (ainda): a soma acontece aqui.
// O PostgREST corta a resposta em `max_rows` (1000 por padrão) **sem erro** — um
// `.limit(5000)` volta com 1000 linhas e o total sai errado sem ninguém perceber.
// Por isso toda leitura que vira soma passa por `fetchPaged`.

const PAGE_SIZE = 1000;
/** Teto de segurança. Estourou, a agregação precisa virar RPC (padrão de `supabase.md`). */
const MAX_PAGES = 5;

async function fetchPaged<T>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let p = 0; p < MAX_PAGES; p++) {
    const { data, error } = await page(p * PAGE_SIZE, (p + 1) * PAGE_SIZE - 1);
    if (error) throw error;
    const chunk = (data ?? []) as T[];
    rows.push(...chunk);
    if (chunk.length < PAGE_SIZE) return rows;
  }
  // Estourou o teto: devolver o que veio viraria total errado, parcela "quitada" que não foi e
  // lote sadio marcado como "Falhou". Erro na tela (com "tentar de novo") é honesto; zero não é.
  throw new Error('Leitura truncada: esta agregação precisa virar RPC.');
}

export interface InstallmentParcel {
  id: string;
  installment_no: number | null;
  amount_cents: number;
  occurred_at: string;
  invoice_id: string | null;
  status: 'pending' | 'cleared';
}

export interface InstallmentPlanSummary {
  id: string;
  /**
   * O TÍTULO da compra, com o estabelecimento de reserva — `description || merchant`.
   *
   * ⚠️ **Era `merchant || description`, e essa era a segunda régua** (15/09/2026). A linha da
   * parcela lê `description ?? merchant` e o agente lê `description or merchant`; só aqui o
   * estabelecimento ganhava do título, então uma compra com os dois preenchidos aparecia com um
   * nome em Parceladas e outro na fatura. Com "Título" obrigatório no formulário, quem nomeia o
   * registro é ele — e uma intenção tem um rótulo só.
   */
  title: string;
  /** Os dois campos crus — o sheet de edição precisa saber qual é qual para reenviá-los. */
  description: string | null;
  merchant: string | null;
  category: string | null;
  account_id: string | null;
  total_cents: number;
  installments: number;
  paid: number;
  /**
   * Quanto cai POR MÊS daqui para a frente — o valor da próxima parcela em aberto.
   *
   * ⚠️ **Era `total / parcelas`, e isso deixou de ser verdade quando reparcelar existiu**
   * (15/09/2026). A divisão só descreve o plano enquanto todas as parcelas são iguais; depois de
   * `update_installment_plan` com parcela já fechada, o que sobrou se reparte apenas entre as
   * EM ABERTO. Medido no emulador: uma compra de R$ 600,00 em 3x com R$ 140,12 já fechados
   * escrevia "R$ 200,00 por mês" embaixo de parcelas de R$ 229,94. O valor vem da LINHA, e a
   * divisão fica só de reserva para um plano sem parcela nenhuma.
   */
  installment_cents: number;
  /** A última parcela — é ela que fecha os centavos da divisão. */
  last_installment_cents: number;
  remaining_cents: number;
  /**
   * Quantas parcelas **não podem mais mudar** — e não é a mesma coisa que `paid`.
   *
   * `paid` conta `status = 'cleared'`, que é o que a barra de progresso mostra. `locked` é a
   * régua de `private.parcela_travada`: cleared **ou** dentro de uma fatura paga, adiada ou
   * PARCIALMENTE paga. Medido no staging em 15/09/2026: a compra "Carro Peças" tinha `paid = 0`
   * e uma parcela travada, então o editor oferecia mudar o número de parcelas e a RPC recusava —
   * o defeito "botão habilitado que o servidor rejeita", que é o espelho do "botão desabilitado
   * sem dizer por quê".
   */
  locked: number;
  locked_cents: number;
  /**
   * Das `locked`, quantas travam por estarem PAGAS (`cleared`). As outras travam pela FATURA
   * (paga em parte, adiada ou quitada sem baixa) — a tela diz qual, porque "fechada" sozinho não
   * diz o que a pessoa pode fazer a respeito.
   */
  locked_paid: number;
  first_occurred_at: string;
  last_occurred_at: string | null;
  active: boolean;
  parcels: InstallmentParcel[];
}

/**
 * Compras parceladas com quanto já foi pago e quanto falta.
 *
 * `installment_plans` guarda só o plano — quantas parcelas já caíram sai de
 * `transactions.status`, uma linha por mês.
 */
export function useInstallmentPlans() {
  useRealtimeInvalidate('installment_plans', ['installments']);
  useRealtimeInvalidate('transactions', ['installments']);
  return useQuery({
    queryKey: ['installments', 'plans'],
    queryFn: async (): Promise<InstallmentPlanSummary[]> => {
      const { data: plans, error } = await supabase
        .from('installment_plans')
        .select('id, merchant, description, category, account_id, total_cents, installments, first_occurred_at')
        .order('first_occurred_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      if (!plans?.length) return [];

      const ids = plans.map((p) => p.id);
      const rows = await fetchPaged<InstallmentParcel & { installment_plan_id: string | null }>(
        (from, to) =>
          supabase
            .from('transactions')
            .select('id, installment_plan_id, installment_no, amount_cents, occurred_at, status, invoice_id')
            .in('installment_plan_id', ids)
            .order('installment_no')
            .range(from, to),
      );

      /**
       * As faturas FECHADAS para efeito de edição. Uma consulta só, e minúscula: a alternativa
       * era perguntar o status de cada fatura por parcela.
       */
      const { data: fechadas, error: erroFaturas } = await supabase
        .from('card_invoices')
        .select('id')
        .or('status.in.(paid,rolled),paid_cents.gt.0');
      if (erroFaturas) throw erroFaturas;
      const faturaFechada = new Set((fechadas ?? []).map((f) => f.id));

      const porPlano = new Map<string, InstallmentParcel[]>();
      for (const row of rows) {
        if (!row.installment_plan_id) continue;
        const lista = porPlano.get(row.installment_plan_id) ?? [];
        lista.push(row);
        porPlano.set(row.installment_plan_id, lista);
      }

      return plans.map((plan) => {
        const parcels = porPlano.get(plan.id) ?? [];
        const n = Math.max(1, plan.installments);
        // Derivado da MESMA divisão da RPC, não da parcela 1 (que pode nem ter vindo).
        const base = Math.floor(plan.total_cents / n);
        const pago = parcels
          .filter((p) => p.status === 'cleared')
          .reduce((soma, p) => soma + p.amount_cents, 0);
        const travadas = parcels.filter(
          (p) => p.status === 'cleared' || (p.invoice_id && faturaFechada.has(p.invoice_id)),
        );
        const emOrdem = [...parcels].sort(
          (a, b) => (a.installment_no ?? 0) - (b.installment_no ?? 0),
        );
        const proxima = emOrdem.find(
          (p) => !(p.status === 'cleared' || (p.invoice_id && faturaFechada.has(p.invoice_id))),
        );
        return {
          id: plan.id,
          title: plan.description || plan.merchant || 'Compra parcelada',
          description: plan.description,
          merchant: plan.merchant,
          category: plan.category,
          account_id: plan.account_id,
          total_cents: plan.total_cents,
          installments: n,
          paid: parcels.filter((p) => p.status === 'cleared').length,
          installment_cents: proxima?.amount_cents ?? emOrdem[0]?.amount_cents ?? base,
          last_installment_cents:
            emOrdem[emOrdem.length - 1]?.amount_cents ?? plan.total_cents - base * (n - 1),
          remaining_cents: Math.max(0, plan.total_cents - pago),
          locked: travadas.length,
          locked_cents: travadas.reduce((soma, p) => soma + p.amount_cents, 0),
          locked_paid: travadas.filter((p) => p.status === 'cleared').length,
          first_occurred_at: plan.first_occurred_at,
          last_occurred_at: parcels.reduce<string | null>(
            (maior, p) => (maior && maior > p.occurred_at ? maior : p.occurred_at),
            null,
          ),
          active: parcels.some((p) => p.status === 'pending'),
          parcels,
        };
      });
    },
  });
}

export interface CardInvoiceHistory {
  id: string;
  reference_month: string;
  closing_date: string;
  due_date: string;
  status: InvoiceStatus;
  /** Preenchido só quando a fatura foi adiada: para qual fatura o saldo foi. */
  rolled_into_invoice_id?: string | null;
  paid_at: string | null;
  payment_transaction_id: string | null;
  total_cents: number;
  tx_count: number;
}

/**
 * Histórico de faturas de um cartão.
 *
 * `card_summary()` devolve UMA fatura por cartão (a corrente). Aqui a lista vem de
 * `card_invoices` e o total de cada uma sai da soma das compras (`invoice_id`),
 * porque o total **nunca é materializado**.
 *
 * Default 60 (o teto), não 12: é esta lista que diz ao navegador de faturas quem
 * é o mês vizinho. Com janela curta, quem tem três anos de cartão pararia de
 * navegar num ponto arbitrário — sem erro e sem aviso.
 */
export function useCardInvoices(accountId: string | undefined, months = 60) {
  useRealtimeInvalidate('card_invoices', ['card-invoices']);
  useRealtimeInvalidate('transactions', ['card-invoices']);
  return useQuery({
    enabled: Boolean(accountId),
    queryKey: ['card-invoices', accountId ?? '', String(months)],
    queryFn: async (): Promise<CardInvoiceHistory[]> => {
      const limite = Math.min(60, Math.max(1, months));
      const { data: invoices, error } = await supabase
        .from('card_invoices')
        .select('id, reference_month, closing_date, due_date, status, paid_at, payment_transaction_id, rolled_into_invoice_id')
        .eq('account_id', accountId!)
        .order('reference_month', { ascending: false })
        .limit(limite);
      if (error) throw error;
      if (!invoices?.length) return [];

      const ids = invoices.map((i) => i.id);
      const rows = await fetchPaged<{ invoice_id: string | null; amount_cents: number }>((from, to) =>
        supabase
          .from('transactions')
          .select('invoice_id, amount_cents')
          .in('invoice_id', ids)
          // pagamento de fatura é transferência: entra como compra inflaria o total
          .eq('kind', 'expense')
          .range(from, to),
      );

      const totais = new Map<string, { cents: number; count: number }>();
      for (const row of rows) {
        if (!row.invoice_id) continue;
        const atual = totais.get(row.invoice_id) ?? { cents: 0, count: 0 };
        totais.set(row.invoice_id, {
          cents: atual.cents + row.amount_cents,
          count: atual.count + 1,
        });
      }

      return invoices.map((invoice) => ({
        ...(invoice as Omit<CardInvoiceHistory, 'total_cents' | 'tx_count'>),
        total_cents: totais.get(invoice.id)?.cents ?? 0,
        tx_count: totais.get(invoice.id)?.count ?? 0,
      }));
    },
  });
}

export interface WorkspaceMember {
  user_id: string;
  role: 'owner' | 'member' | 'viewer';
  created_at: string;
}

/**
 * Quem tem acesso ao workspace.
 *
 * Só ids e papéis: `profiles` é `own row`, então o telefone das outras pessoas
 * **não é legível** daqui — precisaria de RPC `security definer`. A tela diz isso
 * em vez de fingir.
 */
export function useWorkspaceMembers() {
  return useQuery({
    queryKey: ['workspace-members'],
    queryFn: async (): Promise<WorkspaceMember[]> => {
      const ws = await workspaceId();
      const { data, error } = await supabase
        .from('workspace_members')
        .select('user_id, role, created_at')
        // sem o filtro, quem estiver em dois espaços veria linhas misturadas e a
        // contagem discordaria de `plan_status`
        .eq('workspace_id', ws)
        .order('created_at');
      if (error) throw error;
      return data as WorkspaceMember[];
    },
  });
}

export interface ImportBatchSummary {
  id: string;
  filename: string | null;
  source: string;
  account_id: string | null;
  status: string;
  error: string | null;
  created_at: string;
  total: number;
  pendentes: number;
  aprovados: number;
  descartados: number;
  duplicados: number;
}

/**
 * Histórico de importações.
 *
 * `import_batches.status` é gravado como `review` na criação e nunca atualizado,
 * então o rótulo da linha sai da **contagem dos itens**, não da coluna. Lote sem
 * item nenhum é lote fantasma (o insert dos itens estourou) e a tela mostra como
 * falha.
 */
export function useImportBatches(limit = 20) {
  useRealtimeInvalidate('import_items', ['import-batches']);
  return useQuery({
    queryKey: ['import-batches', String(limit)],
    queryFn: async (): Promise<ImportBatchSummary[]> => {
      const { data: batches, error } = await supabase
        .from('import_batches')
        .select('id, filename, source, account_id, status, error, created_at')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      if (!batches?.length) return [];

      const ids = batches.map((b) => b.id);
      const rows = await fetchPaged<{ batch_id: string; status: string }>((from, to) =>
        supabase.from('import_items').select('batch_id, status').in('batch_id', ids).range(from, to),
      );

      const contagem = new Map<string, Record<string, number>>();
      for (const row of rows) {
        const atual = contagem.get(row.batch_id) ?? {};
        atual[row.status] = (atual[row.status] ?? 0) + 1;
        contagem.set(row.batch_id, atual);
      }

      return batches.map((batch) => {
        const c = contagem.get(batch.id) ?? {};
        const pendentes = c.pending ?? 0;
        const aprovados = c.approved ?? 0;
        const descartados = c.discarded ?? 0;
        const duplicados = c.duplicate ?? 0;
        return {
          ...batch,
          total: pendentes + aprovados + descartados + duplicados,
          pendentes,
          aprovados,
          descartados,
          duplicados,
        };
      });
    },
  });
}

/**
 * Apaga o registro da importação. O `on delete cascade` leva os `import_items`
 * junto; as transações já confirmadas **continuam** (o lado delas é `set null`).
 */
export function useDeleteImportBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('import_batches').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['import-batches'] }),
  });
}

/** Uma linha de `alerts_sent` — o que o cron JÁ mandou, não o que ele mandaria. */
export interface AlertSent {
  id: string;
  workspace_id: string;
  kind: string;
  ref: string;
  sent_on: string;
  channel: string | null;
  created_at: string;
}

/**
 * O histórico de alertas proativos.
 *
 * A tabela existe desde a `0024` com a policy de leitura já pronta ("own-rows read para uma
 * futura tela de histórico", diz o comentário da migration) — e ficou três meses sem ninguém
 * lendo, com a linha do Perfil respondendo "Em breve.".
 *
 * ⚠️ **A linha guarda `kind` + `ref`, nunca o texto enviado.** Título e corpo são montados em SQL
 * na hora do envio (`_alerts_to_send`) e descartados; a tela remonta um rótulo a partir do
 * `kind`. Isso é de propósito: gravar o texto duplicaria a regra e as duas cópias divergiriam no
 * primeiro ajuste de redação.
 *
 * Sem realtime e sem `useRealtimeInvalidate`: o cron escreve **uma vez por dia**, e um canal
 * aberto para isso custaria mais do que vale. O refetch ao focar a tela basta.
 */
export function useAlertsSent(limit = 60) {
  return useQuery({
    queryKey: ['alerts-sent', String(limit)],
    queryFn: async (): Promise<AlertSent[]> => {
      const { data, error } = await supabase
        .from('alerts_sent')
        .select('id, workspace_id, kind, ref, sent_on, channel, created_at')
        // `sent_on` primeiro porque é por ele que a tela agrupa: ordenar só por `created_at`
        // produziria cabeçalhos de dia fora de ordem — o mesmo defeito que os "Últimos
        // lançamentos" do Financeiro tinham.
        .order('sent_on', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data as AlertSent[];
    },
  });
}

/** O que a IA fez neste mês. Três números, todos reais. */
export interface AiMonthStats {
  /** Lançamentos criados a partir de mensagem do WhatsApp. */
  lancamentos: number;
  /** Notas capturadas pelo mesmo caminho. */
  notas: number;
}

/**
 * Contagem do que chegou pelo WhatsApp no mês corrente.
 *
 * Existe para a grade de estatísticas do Perfil. É a prova, em número, de que o canal funcionou —
 * que é o que o produto vende.
 *
 * **Duas contagens `head: true`, não duas listas.** `count: 'exact'` com `head` devolve só o
 * total no cabeçalho, sem trafegar linha nenhuma; carregar 300 transações para chamar `.length`
 * seria pagar rede por um inteiro.
 *
 * ⚠️ **A terceira coluna do desenho ("acurácia da IA") não existe aqui de propósito.** O Stitch
 * mostra "99,8%", e não há dado nenhum no banco que sustente esse número — só `ai_events`, que
 * conta chamadas, não acertos. Inventá-lo seria escrever no Perfil uma métrica que ninguém
 * mediu; o terceiro número vem de `plan_status.ai_messages_month`, que é medido de verdade.
 */
export function useAiMonthStats(month: string) {
  return useQuery({
    queryKey: ['ai-month-stats', month],
    queryFn: async (): Promise<AiMonthStats> => {
      const { from, to } = monthBounds(month);
      const ws = await workspaceId();

      const [tx, notas] = await Promise.all([
        supabase
          .from('transactions')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', ws)
          .eq('source', 'whatsapp')
          .gte('occurred_at', from)
          .lte('occurred_at', to),
        supabase
          .from('notes')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', ws)
          .eq('source', 'whatsapp')
          .is('deleted_at', null)
          .gte('created_at', `${from}T00:00:00`)
          .lte('created_at', `${to}T23:59:59`),
      ]);

      if (tx.error) throw tx.error;
      if (notas.error) throw notas.error;
      return { lancamentos: tx.count ?? 0, notas: notas.count ?? 0 };
    },
  });
}
