import { useCallback, useRef, useState } from 'react';

import type { IconName } from '@/components/ui/icon';
import type { NoteColorName } from '@/constants/theme';
import { aparenciaDaCategoria, nomeDaCategoria, type Categoria } from '@/lib/categorias';
import { contaNaFatura } from '@/lib/card-status';
import { assertPaymentMethod, type PaymentMethod } from '@/lib/payment-method';
import { normalizePaymentMethodFilters, paymentMethodFilterExpression, type PaymentMethodFilter } from '@/lib/payment-method-filters';
import { expenseClassificationFromRecord, type ExpenseClassification, type ExpenseClassificationDefaults } from '@/lib/expense-classification';
import { normalizeExpensePatternFilters, normalizeExpenseNecessityFilters, expensePatternFilterExpression, expenseNecessityFilterExpression, type ExpensePatternFilter, type ExpenseNecessityFilter } from '@/lib/expense-classification-filters';
import type { CategoryConfigurationInput, CategoryConfigurationResult } from '@/lib/category-configuration';
import { invalidateFinance, invalidateKeys } from '@/lib/query-invalidation';
import type { Natureza } from '@/lib/import-preview';
import { keepPreviousData, useMutation, useQueryClient } from '@tanstack/react-query';
import { useInfiniteQuery, useQuery } from '@/lib/consulta-em-foco';

import type { ProjecaoMensal } from '@/lib/forecast-months';
import { supabase } from '@/lib/supabase';
import { newClientMessageId } from '@/lib/agent-chat';
import type { DownPaymentInput } from '@/lib/down-payment';
import type { Database, Json } from '@/lib/database.types';
import { dataLocalDe, localISODate, mesmoMes, monthBounds, primeiroDiaDoMes } from '@/lib/dates';
import { avisoDeDeslize } from '@/lib/serie';
import type { PreviaDoEncerramento } from '@/lib/encerrar-serie';
import { diferencaDosMarcos } from '@/lib/goal-milestones';
import type { Consulta } from '@/lib/tela-pronta';
import type { DebtDeclaredEstimateRow, DebtPaymentRow } from '@/lib/debt-history';
import type { ExpectedLedgerLine } from '@/lib/ledger-expected';
import { agentFetch } from '@/lib/agent-api';
import { NO_CATEGORY } from '@/lib/spending-change';
import { toIlikeTerm } from '@/lib/search';
import { dateWindows, timestampDateBounds, type ListFiltersValue } from '@/lib/list-filters';
import { ACCOUNT_TYPES } from '@/lib/accounts';
import { acharLinhaNoCache } from '@/lib/linha-do-cache';
import { adiantaveisNoMes, semCancelamentoRepetido, type Adiantavel, type EscolhaDeAdiantamento } from '@/lib/anticipation';
import { useRealtimeInvalidate, workspaceId } from '@/hooks/use-items';
import { filtroDoEstado } from '@/lib/data-da-compra';
import type { HipoteseNoCiclo, OcorrenciaDaHipotese } from '@/lib/rascunho-no-ciclo';
import { registroDaHipotese, type Hipotese, type RegistroSimulado } from '@/lib/hipotese';
import type { CartaoNoHorizonte, ContaNoHorizonte } from '@/lib/onde-muda';
import type { Alcance, OrigemDaConversao } from '@/lib/lancar';
import {
  DESCRICAO_JUROS_DO_PIX,
  classificacaoDaEscrita,
  detalheDaEscrita,
  type EntradaParcelada,
  type EntradaRecorrente,
} from '@/lib/escrita';
import { escritaDaParcelada, escritaDaRecorrente, escritaDoFinanciamento, escritaDoLancamento,
  type EntradaEscritaLancamento } from '@/lib/finance-write-input';

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
type SubcategoryMetadata = { subcategory_id?: string | null };
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
  // A fatura que esta transferência paga: apagar ou mudar o valor refaz a fatura (`20260926180000`).
  | 'pays_invoice_id'
  // O razão do pagamento de dívida (escrito pelo trigger): é o que diz ao "Editar lançamento" se
  // o valor pode mudar e quanto da parcela ele quitou.
  | 'debt_payment_no'
  | 'debt_principal_cents'
  | 'debt_balance_after_cents'
  | 'edit_revision'
  // A série da recorrência: é o que diz se "esta e as futuras" faz sentido nesta linha.
  // Já vinha no select desde sempre; faltava só no tipo.
  | 'recurring_id'
  // O saldo adiado de uma fatura (`roll_invoice`): a coluna não é herdada pelas parcelas de um
  // plano, então `temContrato` (`finance-form.ts`) usa isto para esconder "Parcelas" aqui.
  | 'rollover_of_invoice_id'
  // `20260909110000`: entra sozinho na data em vez de esperar baixa. Em receita o padrão é
  // false — Pix de terceiro precisa de comprovação; salário é onde ligar faz sentido.
  | 'auto_confirm'
> & Partial<ExpenseClassification> & SubcategoryMetadata & {
  kind: TransactionKind;
  workspace_id?: string;
  payment_method?: PaymentMethod | null;
  subcategory_id?: string | null;
  subcategories?: { name: string } | null;
  /** Taxa explícita pertence a um lançamento e é editada pelo formulário dele. */
  pix_fee_for_transaction_id?: string | null;
  source: TransactionSource;
  status: TransactionStatus;
  down_payment_debt_id?: string | null;
  down_payment_plan_id?: string | null;
  /**
   * A data da COMPRA de uma parcela (`dataDaCompra`, `lib/data-da-compra.ts`): a parcela mora no
   * mês em que cai, e "Mostre sempre a data do lançamento" (24/09/2026) pede a da compra.
   * Só leitura — nenhuma escrita espalha a linha lida, então o campo embutido não vira coluna.
   */
  installment_plans?: { first_occurred_at: string } | null;
  /**
   * A dívida de um pagamento, embutida só no DETALHE (`useTransaction`): o modo diz se a diferença
   * entre o valor pago e a parcela é encargo/desconto ou juros (`detalheDoPagamento`). Só leitura.
   */
  debts?: Pick<Debt, 'name' | 'kind' | 'calculation_mode' | 'installments'> | null;
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
  | 'created_at'
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
  | 'paid_cents' | 'settled_manually' | 'rolled_into_invoice_id'
> & { status: InvoiceStatus };

/** A transferência que pagou (parte de) uma fatura — `transactions.pays_invoice_id`. */
export type PagamentoDaFatura = Pick<Tables['transactions']['Row'], 'id' | 'amount_cents' | 'occurred_at' | 'account_id'>;

export type AccountBalance = Fns['account_balances']['Returns'][number];

export type Goal = Pick<
  Tables['goals']['Row'],
  'id' | 'workspace_id' | 'name' | 'target_cents' | 'saved_cents' | 'deadline' | 'archived' | 'icon' | 'color'
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
  // Transferência recorrente (F18): o destino; nulo nas outras séries.
  | 'counterparty_account_id'
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
  | 'paused_from'
  | 'paused_until'
  // O estabelecimento da série (`20260926120000`): o "Recorrente" do lançamento o perdia.
  | 'merchant'
  | 'edit_revision'
> & Partial<ExpenseClassification> & SubcategoryMetadata & { kind: 'expense' | 'income' | 'transfer'; payment_method?: PaymentMethod | null; subcategory_id?: string | null; workspace_id?: string };

export type MonthlyCashflow = Fns['monthly_cashflow']['Returns'][number];

export type TxSummaryRow = Omit<Fns['transactions_summary']['Returns'][number], 'kind'> & {
  kind: 'expense' | 'income';
};

const TRANSACTION_COLUMNS =
  'id, workspace_id, subcategory_id, subcategories!transactions_subcategory_id_fkey(name), expense_pattern, expense_pattern_source, expense_necessity, expense_necessity_source, kind, amount_cents, currency, category, description, account_id, counterparty_account_id, payment_method, pix_fee_for_transaction_id, occurred_at, source, created_at, status, due_at, invoice_id, installment_plan_id, installment_no, merchant, recurring_id, debt_id, debt_payment_no, debt_principal_cents, debt_balance_after_cents, edit_revision, auto_confirm, rollover_of_invoice_id, pays_invoice_id, down_payment_debt_id, down_payment_plan_id, installment_plans!transactions_installment_plan_id_fkey(first_occurred_at)';

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
  from?: string;
  to?: string;
  kind?: TransactionKind;
  /** `NO_CATEGORY` ('none') = lançamentos sem categoria. */
  category?: string;
  subcategoryId?: string | null;
  /**
   * Lente "gastos lançados por data" de `spending_change` (F15): fora o principal adiado de fatura
   * e o pagamento de fatura, que a RPC também não conta. Sem isto o total da lista abriria
   * diferente do número da linha que levou até ela.
   */
  lenteGasto?: boolean;
  /** Ocorrências de uma série recorrente. */
  recurringId?: string;
  /** Extrato de uma conta ou cartão. `null` = lançamentos sem conta; `undefined` = todas. */
  accountId?: string | null;
  status?: TransactionStatus;
  source?: TransactionSource;
  /** Empty = all; `not_informed` explicitly includes historical null metadata. */
  paymentMethods?: readonly PaymentMethodFilter[];
  expensePatterns?: readonly ExpensePatternFilter[];
  expenseNecessities?: readonly ExpenseNecessityFilter[];
  /** Busca em descrição, lugar e categoria. */
  q?: string;
  minCents?: number;
  maxCents?: number;
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
  const { paymentMethods: rawPaymentMethods, expensePatterns: rawPatterns, expenseNecessities: rawNecessities, ...otherFilters } = filters;
  const paymentMethods = normalizePaymentMethodFilters(rawPaymentMethods);
  const expensePatterns = normalizeExpensePatternFilters(rawPatterns);
  const expenseNecessities = normalizeExpenseNecessityFilters(rawNecessities);
  const paymentExpression = paymentMethodFilterExpression(paymentMethods);
  const patternExpression = expensePatternFilterExpression(expensePatterns);
  const necessityExpression = expenseNecessityFilterExpression(expenseNecessities);
  const canonicalFilters = { ...otherFilters,
    ...(paymentMethods.length ? { paymentMethods } : {}),
    ...(expensePatterns.length ? { expensePatterns } : {}),
    ...(expenseNecessities.length ? { expenseNecessities } : {}),
  };
  useRealtimeInvalidate('transactions', ['transactions']);
  const { from, to } = filters;
  return useInfiniteQuery({
    // Chaveada por `from`/`to`, que é como toda leitura de período do app já se conserta sozinha
    // na troca de régua (ver `REGUA_MUDOU`). Chaveada pelo RÓTULO do mês ela não se corrigiria:
    // `2026-10` é o mesmo texto nas duas réguas.
    queryKey: ['transactions', 'list', canonicalFilters],
    initialPageParam: 0,
    queryFn: async ({ pageParam }): Promise<Transaction[]> => {
      let query = supabase.from('transactions').select(TRANSACTION_COLUMNS);
      // Borda ausente significa intervalo aberto; nunca enviar gte/lte.undefined.
      if (from) query = query.gte('occurred_at', from);
      if (to) query = query.lte('occurred_at', to);
      query = query
        .order('occurred_at', { ascending: false })
        .order('created_at', { ascending: false })
        // Desempate estável. Duas linhas com a mesma data E o mesmo `created_at` (lote de
        // importação, parcelas criadas juntas) podem trocar de ordem entre uma página e a
        // seguinte — e aí uma some da lista enquanto outra aparece duas vezes.
        .order('id', { ascending: false })
        .range(pageParam, pageParam + TRANSACTION_PAGE - 1);
      if (filters.kind) query = query.eq('kind', filters.kind);
      if (filters.category) query = filters.category === NO_CATEGORY ? query.or('category.is.null,category.eq.') : query.eq('category', filters.category);
      if (filters.lenteGasto) query = query.eq('kind', 'expense').is('rollover_of_invoice_id', null).is('pays_invoice_id', null);
      if (filters.subcategoryId !== undefined) query = filters.subcategoryId === null
        ? query.is('subcategory_id', null) : query.eq('subcategory_id', filters.subcategoryId);
      if (filters.minCents !== undefined) query = query.gte('amount_cents', filters.minCents);
      if (filters.maxCents !== undefined) query = query.lte('amount_cents', filters.maxCents);
      // "Em aberto"/"Concluído" na régua da DATA, a mesma da pílula (`filtroDoEstado`).
      if (filters.status) {
        const estado = filtroDoEstado(filters.status, localISODate());
        if (estado.status) query = query.eq('status', estado.status);
        query = query.or(estado.ou);
      }
      if (filters.source) query = query.eq('source', filters.source);
      if (paymentExpression) query = query.or(paymentExpression);
      if (patternExpression || necessityExpression) query = query.eq('kind', 'expense').is('pays_invoice_id', null);
      if (patternExpression) query = query.or(patternExpression);
      if (necessityExpression) query = query.or(necessityExpression);
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

/** Missing, calculated occurrences for the same bounded window as Lançamentos. */
export function useExpectedLedgerLines(from: string | undefined, to: string | undefined, pronto: boolean, recurringId?: string) {
  useRealtimeInvalidate('transactions', ['ledger-expected']);
  useRealtimeInvalidate('debts', ['ledger-expected']);
  useRealtimeInvalidate('recurring_transactions', ['ledger-expected']);
  return useQuery({
    enabled: pronto && Boolean(from && to),
    queryKey: ['ledger-expected', from, to, recurringId ?? ''],
    queryFn: async ({ signal }): Promise<ExpectedLedgerLine[]> => {
      // Refetch manual ignora enabled: intervalo aberto também deve ser seguro aqui.
      if (!from || !to) return [];
      const windows = dateWindows(from, to);
      const rows: ExpectedLedgerLine[] = [];
      // A RPC aceita 62 dias. Lotes de quatro limitam carga e uma falha rejeita o período inteiro.
      for (let i = 0; i < windows.length; i += 4) {
        const batches = await Promise.all(windows.slice(i, i + 4).map(window =>
          fetchPaged<ExpectedLedgerLine>((start, end) => supabase.rpc('ledger_expected_lines_transfer', {
            p_from: window.from, p_to: window.to, p_recurring_id: recurringId ?? undefined,
          }).order('due_date').order('origin').order('ref_id').range(start, end).abortSignal(signal)),
        ));
        rows.push(...batches.flat());
      }
      return rows;
    },
  });
}

/**
 * A ocorrência prevista de uma recorrente vira lançamento — a MESMA linha que o agendador
 * criaria (`materialize_recurring_occurrence`), idempotente: tocar duas vezes dá o mesmo id.
 * É o que deixa a prevista abrir o detalhe e receber "Paguei" como qualquer lançamento.
 */
export function useMaterializeOccurrence() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async ({ recurringId, date }: { recurringId: string; date: string }): Promise<string> => {
      const { data, error } = await supabase.rpc('materialize_recurring_occurrence', {
        p_recurring_id: recurringId, p_date: date,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: invalidate,
  });
}

/**
 * Apagar a ocorrência PREVISTA: só a marca de "esta data não acontece" (`skip_recurring_occurrence`),
 * que a lista e o agendador respeitam — sem gravar uma linha para apagá-la em seguida.
 */
export function useSkipOccurrence() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async ({ recurringId, date }: { recurringId: string; date: string }) => {
      const { error } = await supabase.rpc('skip_recurring_occurrence', {
        p_recurring_id: recurringId, p_date: date,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
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
export function useTransactionsSummary(fromDate: string | undefined, toDate: string | undefined, pronto = true) {
  useRealtimeInvalidate('transactions', ['tx-summary']);
  return useQuery({
    enabled: pronto && Boolean(fromDate && toDate),
    queryKey: ['tx-summary', fromDate, toDate],
    queryFn: async (): Promise<TxSummaryRow[]> => {
      if (!fromDate || !toDate) return [];
      const { data, error } = await supabase.rpc('transactions_summary', {
        from_date: fromDate,
        to_date: toDate,
      });
      if (error) throw error;
      return data as TxSummaryRow[];
    },
  });
}

export type DailySpendingRow = Fns['daily_spending']['Returns'][number];

/**
 * O gasto e a entrada de cada dia de `[from, to]` — a semana da Hoje. A MESMA régua de
 * `transactions_summary` (`20260928220000`): a barra de hoje é o "saiu hoje". Todo dia da janela
 * volta, zerado inclusive; o banco recusa janela de mais de 62 dias.
 */
export function useDailySpending(fromDate: string, toDate: string) {
  useRealtimeInvalidate('transactions', ['daily-spending']);
  return useQuery({
    queryKey: ['daily-spending', fromDate, toDate],
    queryFn: async (): Promise<DailySpendingRow[]> => {
      const { data, error } = await supabase.rpc('daily_spending', { p_from: fromDate, p_to: toDate });
      if (error) throw error;
      return (data ?? []) as DailySpendingRow[];
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

export function useAccountBalances(enabled = true) {
  useRealtimeInvalidate('transactions', ['account-balances']);
  return useQuery({
    queryKey: ['account-balances'],
    enabled,
    queryFn: async (): Promise<AccountBalance[]> => {
      const { data, error } = await supabase.rpc('account_balances');
      if (error) throw error;
      return data;
    },
  });
}

export function useAccounts(selectedId?: string | null, includeArchived = false) {
  useRealtimeInvalidate('accounts', ['accounts']);
  return useQuery({
    queryKey: selectedId || includeArchived ? ['accounts', includeArchived ? 'all' : selectedId] : ['accounts'],
    queryFn: async (): Promise<Account[]> => {
      return fetchPaged<Account>((from, to) => {
        let query = supabase
          .from('accounts')
          .select('id, name, type, initial_balance_cents, archived, closing_day, due_day, credit_limit_cents, payment_account_id, closing_day_inclusive, rotativo_auto, rotativo_rate_monthly, created_at')
          .order('created_at').order('id');
        if (!includeArchived) query = selectedId ? query.or(`archived.eq.false,id.eq.${selectedId}`) : query.eq('archived', false);
        return query.range(from, to);
      });
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
        .select('id, workspace_id, name, target_cents, saved_cents, deadline, archived, icon, color')
        .eq('archived', false)
        // A mais recente primeiro (24/09/2026: "em tudo, do mais recente para o mais antigo").
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

const RECURRING_COLUMNS =
  'id, workspace_id, subcategory_id, subcategories!recurring_transactions_subcategory_id_fkey(name), expense_pattern, expense_pattern_source, expense_necessity, expense_necessity_source, kind, amount_cents, currency, category, description, merchant, account_id, counterparty_account_id, payment_method, rrule, next_run_at, active, run_attempts, last_error, created_at, dtstart, end_date, auto_confirm, paused_from, paused_until, edit_revision';

/**
 * As categorias do espaço, mais usada primeiro: as que os lançamentos usam e as criadas no app,
 * com ícone, cor e quantos orçamentos cada uma tem.
 *
 * Categoria é texto livre (`finance.md`): quem lança pelo WhatsApp cria categoria nova, e o
 * seletor do app só conhecia as 13 sugestões. Ver `categories_used()` na `20260909100000`; a
 * aparência veio na `20260929170000`.
 */
export function useCategoriesUsed() {
  useRealtimeInvalidate('transactions', ['categories-used']);
  useRealtimeInvalidate('categories', ['categories-used']);
  return useQuery({
    queryKey: ['categories-used'],
    queryFn: async (): Promise<Categoria[]> => {
      const { data, error } = await supabase.rpc('categories_used');
      if (error) throw error;
      return (data ?? []).map((r) => ({
        category: r.category,
        uses: Number(r.uses),
        // o APK novo contra um banco sem a 20260929170000 recebe só category e uses
        icon: (r.icon ?? null) as IconName | null,
        color: (r.color ?? null) as NoteColorName | null,
        budgets: Number(r.budgets ?? 0),
        configuration_id: r.configuration_id ?? null,
        edit_revision: r.edit_revision == null ? null : Number(r.edit_revision),
        default_expense_pattern: (r.default_expense_pattern ?? null) as ExpenseClassificationDefaults['default_expense_pattern'],
        default_expense_necessity: (r.default_expense_necessity ?? null) as ExpenseClassificationDefaults['default_expense_necessity'],
      }));
    },
    staleTime: 60_000,
  });
}

/** "Que ícone e que cor este nome tem" — a tabela primeiro, o ícone adivinhado pelo nome depois. */
export function useAparencia() {
  const { data } = useCategoriesUsed();
  const categorias = data ?? SEM_CATEGORIAS;
  return useCallback(
    (nome: string | null | undefined, kind?: string | null) => aparenciaDaCategoria(nome, categorias, kind),
    [categorias]
  );
}
const SEM_CATEGORIAS: Categoria[] = [];

/** Configuration proof belongs to the record workspace, independently of global appearance. */
export function useCategoryClassificationDefaults(recordWorkspaceId?: string, enabled = true) {
  useRealtimeInvalidate('categories', ['category-classification-defaults']);
  return useQuery({
    queryKey: ['category-classification-defaults', recordWorkspaceId ?? 'default'],
    enabled,
    queryFn: async () => {
      const ws = recordWorkspaceId ?? await workspaceId();
      type Configuration = Pick<Database['public']['Tables']['categories']['Row'], 'name' | 'default_expense_pattern' | 'default_expense_necessity'>;
      const data = await fetchPaged<Configuration>((from, to) => supabase.from('categories')
        .select('name, default_expense_pattern, default_expense_necessity')
        .eq('workspace_id', ws).order('name').order('id').range(from, to));
      return data.map(row => ({ category: row.name,
        default_expense_pattern: (row.default_expense_pattern ?? null) as ExpenseClassificationDefaults['default_expense_pattern'],
        default_expense_necessity: (row.default_expense_necessity ?? null) as ExpenseClassificationDefaults['default_expense_necessity'],
      }));
    },
    staleTime: 60_000,
  });
}

/** Recusa do `rename_category` quando o nome novo já é outra categoria: a tela pergunta se junta. */
export type CategoriaExiste = Error & { code: 'CATEGORIA_EXISTE'; existente: string };

/**
 * Aparência, padrões, rename/merge e backfill têm uma única transação, revisão e intenção.
 */
export function useSalvarCategoria() {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (input: CategoryConfigurationInput): Promise<CategoryConfigurationResult> => {
      const name = nomeDaCategoria(input.name);
      const { data, error } = await supabase.rpc('save_category_configuration', {
        p_request_id: input.requestId,
        p_input: { name, icon: input.icon, color: input.color,
          rename_from: input.renomearDe ?? null, juntar: input.juntar ?? false,
          default_expense_pattern: input.default_expense_pattern,
          default_expense_necessity: input.default_expense_necessity,
          ...(input.configurationId ? { category_id: input.configurationId, expected_revision: input.expectedRevision } : {}),
          ...(input.backfill ? { backfill_from: input.backfill.from, backfill_to: input.backfill.to } : {}),
        },
      });
      if (error) {
        const m = /CATEGORIA_EXISTE: (.+)$/.exec(error.message ?? '');
        if (m) throw Object.assign(new Error(error.message), { code: 'CATEGORIA_EXISTE' as const, existente: m[1].trim() });
        throw error;
      }
      return data as unknown as CategoryConfigurationResult;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['categories-used'] });
      void queryClient.invalidateQueries({ queryKey: ['category-classification-defaults'] });
      invalidate();
    },
  });
}

/** Apaga a categoria: os registros ficam sem categoria e os orçamentos dela saem. */
export function useApagarCategoria() {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (nome: string) => {
      const { data, error } = await supabase.rpc('delete_category', { p_name: nome });
      if (error) throw error;
      return data as { lancamentos: number; orcamentos: number };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['categories-used'] });
      void queryClient.invalidateQueries({ queryKey: ['category-classification-defaults'] });
      invalidate();
    },
  });
}

/** Séries recorrentes — criadas por WhatsApp, materializadas pelo cron do send-reminders. */
export function useRecurringTransactions(enabled = true) {
  useRealtimeInvalidate('recurring_transactions', ['recurring']);
  return useQuery({
    enabled,
    queryKey: ['recurring'],
    queryFn: async (): Promise<RecurringTransaction[]> => {
      return fetchPaged<RecurringTransaction>((from, to) => supabase.from('recurring_transactions')
        .select(RECURRING_COLUMNS)
        // ativas primeiro; dentro de cada grupo, a que roda antes
        .order('active', { ascending: false })
        .order('next_run_at').order('id').range(from, to));
    },
  });
}

/** UMA série, pelo id, só com o que o detalhe do lançamento desenha (regra e valor). */
export function useRecurringSerie(id: string | null | undefined) {
  useRealtimeInvalidate('recurring_transactions', ['recurring']);
  return useQuery({
    queryKey: ['recurring', 'serie', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('recurring_transactions')
        .select('rrule, amount_cents, active, paused_from, paused_until')
        .eq('id', id!)
        .maybeSingle();
      if (error) throw error;
      return data;
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
  const client = useQueryClient();
  /*
    Nasce da lista, se a linha já veio por ela: tocar num lançamento da Hoje, do Financeiro ou de
    Lançamentos abria o detalhe do zero, com a linha a um toque de distância na memória. A
    semente leva a data de atualização da lista, então o `staleTime` decide o refetch — e o que a
    lista não traz (o join `debts`) faz `acharLinhaNoCache` recusar a semente.
  */
  const semente = () => {
    if (!id) return undefined;
    const cache = client.getQueryCache();
    const entradas = [...cache.findAll({ queryKey: ['transactions', 'list'] }), ...cache.findAll({ queryKey: ['transactions', 'recent'] })]
      .map((q) => ({ data: q.state.data, updatedAt: q.state.dataUpdatedAt, invalidada: q.state.isInvalidated }));
    return acharLinhaNoCache<Transaction>(entradas, id);
  };
  return useQuery({
    queryKey: ['transactions', 'item', id],
    enabled: !!id,
    initialData: () => semente()?.linha,
    initialDataUpdatedAt: () => semente()?.updatedAt,
    queryFn: async (): Promise<Transaction | null> => {
      // `maybeSingle`, não `single`: linha apagada é um estado NORMAL desta tela
      // (o usuário acabou de apagar e o realtime invalidou antes do `back()`).
      // Com `single` isso virava erro, e o detalhe piscava "não deu para carregar"
      // no lugar do "esse lançamento não existe mais".
      const { data, error } = await supabase
        .from('transactions')
        .select(`${TRANSACTION_COLUMNS}, debts!transactions_debt_id_fkey(name, kind, calculation_mode, installments)`)
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

export type CardLimitContext = {
  account_id: string;
  credit_limit_cents: number | null;
  available_limit_cents: number | null;
  limit_status: 'available' | 'not_set' | 'needs_review';
};

/** Canonical invoice exposure, with explicit quality instead of an invented legacy limit. */
export function useCardLimitContext(enabled = true) {
  useRealtimeInvalidate('accounts', ['card-limit-context']);
  useRealtimeInvalidate('card_invoices', ['card-limit-context']);
  useRealtimeInvalidate('transactions', ['card-limit-context']);
  return useQuery({
    queryKey: ['card-limit-context'],
    enabled,
    queryFn: async (): Promise<CardLimitContext[]> => {
      const { data, error } = await supabase.rpc('card_limit_context');
      if (error) throw error;
      return data as CardLimitContext[];
    },
  });
}

/** Fatura + as compras dela (RLS já limita ao workspace). */
/**
 * A consulta de UMA fatura, fora do hook: a Carteira pré-carrega a fatura do cartão da frente
 * (`prefetchQuery`) para o cartão pousar na fatura já com o total, em vez de num esqueleto.
 */
/** A fatura pedida não existe para quem pergunta (RLS inclusa): estado normal de um aviso antigo. */
export class FaturaInexistente extends Error {
  constructor() {
    super('Fatura inexistente');
    this.name = 'FaturaInexistente';
  }
}

export function invoiceQuery(invoiceId: string) {
  return {
    queryKey: ['invoice', invoiceId] as const,
    queryFn: async (): Promise<{ invoice: CardInvoice; transactions: Transaction[]; pagamentos: PagamentoDaFatura[] }> => {
      const [invoiceRes, txRes, pagamentosRes] = await Promise.all([
        supabase
          .from('card_invoices')
          .select('id, account_id, reference_month, closing_date, due_date, status, paid_at, paid_cents, settled_manually, rolled_into_invoice_id')
          .eq('id', invoiceId)
          .maybeSingle(),
        supabase
          .from('transactions')
          .select(TRANSACTION_COLUMNS)
          .eq('invoice_id', invoiceId)
          .order('occurred_at', { ascending: false }),
        // Os pagamentos: é por eles que o pagamento se edita e se apaga (`20260926180000`).
        supabase
          .from('transactions')
          .select('id, amount_cents, occurred_at, account_id')
          .eq('pays_invoice_id', invoiceId)
          .order('occurred_at', { ascending: false }),
      ]);
      if (invoiceRes.error) throw invoiceRes.error;
      // Apagada, de outro espaço ou sem permissão: a tela mostra "Isto não existe mais".
      if (!invoiceRes.data) throw new FaturaInexistente();
      if (txRes.error) throw txRes.error;
      if (pagamentosRes.error) throw pagamentosRes.error;
      return {
        invoice: invoiceRes.data as CardInvoice,
        transactions: txRes.data as Transaction[],
        pagamentos: pagamentosRes.data as PagamentoDaFatura[],
      };
    },
  };
}

/**
 * Só o cabeçalho da fatura (mês e vencimento) — o que o detalhe do lançamento desenha. `useInvoice`
 * traz as compras e os pagamentos inteiros, e para dizer "Fatura de agosto" isso era baixar a fatura
 * toda. Se a fatura completa já está em cache, dela nasce.
 */
export function useInvoiceHead(invoiceId: string | undefined) {
  const client = useQueryClient();
  const daFatura = () => client.getQueryState<{ invoice: CardInvoice }>(['invoice', invoiceId ?? '']);
  useRealtimeInvalidate('card_invoices', ['invoice']);
  return useQuery({
    queryKey: ['invoice', 'head', invoiceId],
    enabled: Boolean(invoiceId),
    initialData: () => {
      const i = daFatura()?.data?.invoice;
      return i ? { reference_month: i.reference_month, due_date: i.due_date, status: i.status } : undefined;
    },
    initialDataUpdatedAt: () => daFatura()?.dataUpdatedAt,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('card_invoices')
        .select('reference_month, due_date, status')
        .eq('id', invoiceId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useInvoice(invoiceId: string | undefined) {
  useRealtimeInvalidate('card_invoices', ['invoice']);
  useRealtimeInvalidate('transactions', ['invoice']);
  return useQuery({
    ...invoiceQuery(invoiceId ?? ''),
    enabled: Boolean(invoiceId),
    // Refazer não traz de volta o que não existe.
    retry: (n, erro) => !(erro instanceof FaturaInexistente) && n < 3,
  });
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

/** Desfaz o "Marcar como paga": a fatura volta a ficar em aberto, com as compras previstas. */
export function useUnsettleInvoice() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (invoiceId: string) => {
      const { error } = await supabase.rpc('unsettle_invoice', { p_invoice_id: invoiceId });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

/** Desfaz o "Jogar para a próxima": o saldo, os juros e o IOF saem da fatura seguinte. */
export function useUnrollInvoice() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (invoiceId: string) => {
      const { error } = await supabase.rpc('unroll_invoice', { p_invoice_id: invoiceId });
      if (error) throw error;
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
  const attempt = useRef<{ key: string; id: string } | null>(null);
  return useMutation({
    // A prévia e o salvar usam exatamente os mesmos argumentos da compra.
    mutationFn: async (input: EntradaParcelada) => {
      const { args } = escritaDaParcelada(input);
      const key = JSON.stringify(args.p_dados);
      if (attempt.current?.key !== key) attempt.current = { key, id: newClientMessageId() };
      const { error } = await supabase.rpc('create_purchase', {
        ...args, p_request_id: attempt.current.id,
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
  const attempt = useRef<{ key: string; id: string } | null>(null);
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
      /** "Parcelas já pagas" (`20260926130000`): só quando mudou — ausente, nada muda nelas. */
      paidInstallments?: number | null;
      paymentMethod?: PaymentMethod | null;
      expectedRevision?: number;
    } & Partial<ExpenseClassification> & SubcategoryMetadata) => {
      assertPaymentMethod(input.paymentMethod);
      const dados = {
        p_plan_id: input.planId,
        p_total_cents: input.totalCents,
        p_installments: input.installments,
        p_first_occurred_at: input.firstOccurredAt,
        p_description: input.description ?? undefined,
        p_category: input.category ?? undefined,
        p_merchant: input.merchant ?? undefined,
        p_account_id: input.accountId ?? undefined,
        p_paid_installments: input.paidInstallments ?? undefined,
        ...(input.paymentMethod !== undefined ? { p_payment_method: input.paymentMethod } : {}),
        ...(input.expectedRevision !== undefined ? { p_expected_revision: input.expectedRevision } : {}),
        ...classificacaoDaEscrita(input),
        ...detalheDaEscrita(input),
      };
      const key = JSON.stringify(dados);
      if (attempt.current?.key !== key) attempt.current = { key, id: newClientMessageId() };
      const { error } = await supabase.rpc('update_installment_plan_payment', {
        p_input: { ...dados, p_request_id: attempt.current.id } as Json,
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
  const attempt = useRef<{ key: string; id: string } | null>(null);
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
      /** "Parcelas já pagas", como na criação (`20260926130000`). */
      paidInstallments?: number | null;
      downPayment?: DownPaymentInput;
      paymentMethod?: PaymentMethod | null;
    } & Partial<ExpenseClassification> & SubcategoryMetadata) => {
      const classification = { ...classificacaoDaEscrita(input), ...detalheDaEscrita(input) };
      if (input.downPayment || input.paymentMethod !== undefined || Object.keys(classification).length) {
        const payload = {
          p_origem: { tipo: 'transacao', id: input.transactionId }, p_alcance: 'converter',
          p_destino: { tipo: 'parcelada', dados: {
            p_account_id: input.accountId, p_total_cents: input.totalCents,
            p_installments: input.installments, p_occurred_at: input.firstOccurredAt,
            p_paid_installments: input.paidInstallments ?? 0, p_description: input.description,
            p_category: input.category, p_merchant: input.merchant,
            ...(input.downPayment ? { down_payment: input.downPayment } : {}),
            ...(input.paymentMethod !== undefined ? { p_payment_method: input.paymentMethod } : {}),
            ...classification,
          } },
        };
        const key = JSON.stringify(payload);
        if (attempt.current?.key !== key) attempt.current = { key, id: newClientMessageId() };
        const { error } = await supabase.rpc('converter_registro', { ...payload, p_request_id: attempt.current.id });
        if (error) throw error;
        return;
      }
      const { error } = await supabase.rpc('convert_transaction_to_installments', {
        p_transaction_id: input.transactionId,
        p_total_cents: input.totalCents,
        p_installments: input.installments,
        p_first_occurred_at: input.firstOccurredAt,
        p_description: input.description ?? undefined,
        p_category: input.category ?? undefined,
        p_merchant: input.merchant ?? undefined,
        p_account_id: input.accountId,
        p_paid_installments: input.paidInstallments ?? undefined,
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
  // A mesma parcela cancelada por dois adiantamentos do rascunho sai uma vez só (`anticipation.ts`).
  return semCancelamentoRepetido(drafts).map(({ grupo: _g, rotulo: _r, adiantar: _a, ...d }) => d);
}

/**
 * O que dá para adiantar no "E se…" — compra parcelada, financiamento, recorrente — com o dia
 * em que cada parcela sai do caixa e o valor presente no dia do pagamento (`pagarEm`). JSON de
 * propósito: a lista passa das 1000 linhas que o PostgREST corta em silêncio.
 */
export function useAnticipationCandidates(pagarEm: string, enabled = true, porMes = true) {
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
    // `porMes: false` é a lista inteira a partir do dia: o "faltam N" da linha do adiantamento conta
    // também a parcela que ainda vence no mês do pagamento (ela não é adiantável, mas falta).
    select: (lista) => (porMes ? adiantaveisNoMes(lista, pagarEm) : lista),
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

/** Erro de uma hipótese (`indice`) ou de uma leitura (`leitura`) da simulação. */
export type ErroDaHipotese = { indice?: number; leitura?: string; mensagem: string; codigo?: string };

/**
 * A simulação do "E se…?" (spec 2026-09-29): as hipóteses viram registros de verdade dentro de
 * `simular`, as leituras correm e tudo é desfeito. Os adiantamentos seguem como `drafts` das
 * leituras de caixa. Com `porConta`, vêm junto o horizonte por conta e por cartão — o "depois"
 * do Onde muda. Uma chamada só por tela: criar e desfazer duas vezes seria pagar a escrita duas.
 *
 * `erros[].indice` aponta para as hipóteses COMPLETAS, na ordem — as incompletas não vão.
 */
export function useSimulacao(o: {
  dias: number;
  modo: 'dia' | 'mes';
  view: CycleView | undefined;
  hipoteses: Hipotese[];
  adiantamentos: Draft[];
  porConta: boolean;
  enabled: boolean;
  /** No modo `dia`, traz os meses junto — o saldo de cada período da lista do rascunho. */
  comMeses?: boolean;
  /**
   * A prévia da folha: sem o resultado anterior enquanto o novo chega (número de rascunho velho
   * embaixo do valor novo é mentira) — a mesma régua da prévia "Ao salvar".
   */
  previa?: boolean;
}) {
  const registros = o.hipoteses.map((h, i) => registroDaHipotese(h, i)).filter((r): r is RegistroSimulado => r !== null);
  const drafts = paraOBanco(o.adiantamentos);
  useRealtimeInvalidate('transactions', ['simular']);
  return useQuery({
    enabled: o.enabled && (registros.length > 0 || drafts.length > 0),
    placeholderData: o.previa ? undefined : (anterior: unknown) => anterior as never,
    queryKey: ['simular', o.modo, String(o.dias), JSON.stringify(drafts), JSON.stringify(registros), o.view ?? '', o.porConta, Boolean(o.comMeses)],
    queryFn: async (): Promise<{
      forecast?: ForecastDay[];
      meses?: ProjecaoMensal;
      contas?: ContaNoHorizonte[];
      cartoes?: CartaoNoHorizonte[];
      erros: ErroDaHipotese[];
    }> => {
      const meses = { meses: { days: o.dias, drafts, view: o.view ?? null } };
      const leitura: Record<string, unknown> = o.modo === 'mes'
        ? meses
        : { forecast: { days: o.dias, drafts }, ...(o.comMeses ? meses : {}) };
      if (o.porConta) Object.assign(leitura, { contas: { days: o.dias }, cartoes: { days: o.dias } });
      const { data, error } = await supabase.rpc('simular', { p_registros: registros as never, p_leituras: leitura as never });
      if (error) throw error;
      const r = data as { leituras?: Record<string, unknown>; erros?: ErroDaHipotese[] } | null;
      const l = r?.leituras ?? {};
      return {
        forecast: l.forecast as ForecastDay[] | undefined,
        meses: l.meses as ProjecaoMensal | undefined,
        contas: l.contas as ContaNoHorizonte[] | undefined,
        cartoes: l.cartoes as CartaoNoHorizonte[] | undefined,
        erros: r?.erros ?? [],
      };
    },
  });
}

/**
 * Mudar o tipo de um registro que existe (spec 2026-09-29, Parte 2): a origem encerra pelo alcance e
 * o destino nasce, numa transação só no banco — nunca dois passos pelo app.
 */
export function useConverterRegistro() {
  const invalidate = useInvalidateFinance();
  const attempt = useRef<{ key: string; id: string } | null>(null);
  return useMutation({
    mutationFn: async (v: { origem: OrigemDaConversao; alcance: Alcance; destino: RegistroSimulado }) => {
      const payload = { p_origem: { tipo: v.origem.tipo, id: v.origem.id }, p_alcance: v.alcance, p_destino: v.destino as never };
      const key = JSON.stringify(payload);
      if (attempt.current?.key !== key) attempt.current = { key, id: newClientMessageId() };
      const { data, error } = await supabase.rpc('converter_registro', { ...payload, p_request_id: attempt.current.id });
      if (error) throw error;
      return data as { ids: string[] };
    },
    onSuccess: invalidate,
  });
}

/** O "antes" do Onde muda: o horizonte por conta e por cartão, sem hipótese. */
export function useHorizonteReal(dias: number, enabled: boolean) {
  useRealtimeInvalidate('transactions', ['accounts-horizon']);
  useRealtimeInvalidate('transactions', ['cards-horizon']);
  const contas = useQuery({
    enabled,
    queryKey: ['accounts-horizon', String(dias)],
    queryFn: async (): Promise<ContaNoHorizonte[]> => {
      const { data, error } = await supabase.rpc('accounts_horizon', { days: dias });
      if (error) throw error;
      return (data ?? []) as unknown as ContaNoHorizonte[];
    },
  });
  const cartoes = useQuery({
    enabled,
    queryKey: ['cards-horizon', String(dias)],
    queryFn: async (): Promise<CartaoNoHorizonte[]> => {
      const { data, error } = await supabase.rpc('cards_horizon', { days: dias });
      if (error) throw error;
      return (data ?? []) as unknown as CartaoNoHorizonte[];
    },
  });
  return { contas, cartoes };
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

/** Corrige o valor com escopo e confirma a baixa na mesma transação do banco. */
export function useConfirmPaymentScoped() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      paidAt: string;
      amountCents: number;
      scope: 'one' | 'future';
    }) => {
      const { data, error } = await supabase.rpc('confirm_payment_scoped', {
        p_transaction_id: input.id,
        p_paid_at: input.paidAt,
        p_amount_cents: input.amountCents,
        p_scope: input.scope,
      });
      if (error) throw error;
      return Number(data ?? 0);
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
  workspace_id?: string;
  suggested_subcategory_id?: string | null;
  suggested_subcategory_set?: boolean;
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
> & SubcategoryMetadata & { workspace_id?: string; subcategories?: { name: string } | null;
  match_type: 'contains' | 'merchant' | 'regex'; source: 'user' | 'learned' };

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
          'id, workspace_id, batch_id, kind, amount_cents, occurred_at, description, merchant, suggested_category, suggested_subcategory_id, suggested_subcategory_set, status, transaction_id, nature, installment_no, installments, match_layer, match_note, adopt_ids, transactions!import_items_transaction_id_fkey(id, occurred_at, description, amount_cents, account_id)',
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
      subcategory_id?: string | null;
      workspaceId?: string;
      expectedCategory?: string | null;
      /**
       * ⚠️ **O sentido precisa ser EDITÁVEL porque nem todo banco o expressa.** Medido em dois
       * extratos reais do Banco do Brasil (agosto e setembro de 2026): a linha "Pagto cartão
       * crédito" sai como `TRNTYPE=CREDIT` com valor POSITIVO, apesar de ser saída — o saldo só
       * fecha tratando-a como despesa (0,07 + 1.947,10 − 1.947,06 = 0,11 = `<LEDGERBAL>`).
       * Adivinhar pelo texto da linha é a lista de palavras que `agent.md` proíbe; quem decide é
       * quem confere antes de entrar, que é o que esta tela existe para fazer.
       */
      kind?: 'income' | 'expense';
      /** O título que a linha vai gravar (a compra parcelada leva o nome do estabelecimento). */
      description?: string;
      merchant?: string;
    }) => {
      const patch: { suggested_category?: string | null; suggested_subcategory_id?: string | null;
        suggested_subcategory_set?: boolean; kind?: string; description?: string; merchant?: string } = {};
      if ('category' in input) patch.suggested_category = input.category ?? null;
      if (Object.hasOwn(input, 'subcategory_id')) {
        patch.suggested_subcategory_id = detalheDaEscrita(input).subcategory_id;
        patch.suggested_subcategory_set = true;
      }
      if (input.kind) patch.kind = input.kind;
      if (input.description !== undefined) patch.description = input.description;
      if (input.merchant !== undefined) patch.merchant = input.merchant;
      let request = supabase.from('import_items').update(patch).eq('id', input.id);
      if (input.workspaceId) request = request.eq('workspace_id', input.workspaceId);
      if (Object.hasOwn(input, 'expectedCategory')) request = input.expectedCategory === null
        ? request.is('suggested_category', null) : request.eq('suggested_category', input.expectedCategory!);
      const { data, error } = await request.select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('A linha da importação mudou. Reabra para conferir.');
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
      // A estimativa do rotativo que recebeu o valor real deixa de ser estimativa (28/09/2026): com o
      // "(estimado)" no nome, a taxa aprendida (`rotativo_rate_for`) continuaria ignorando a linha.
      for (const nome of ['Juros do rotativo', 'IOF do rotativo']) {
        const { error: e } = await supabase
          .from('transactions')
          .update({ description: nome })
          .eq('id', input.transactionId)
          .eq('description', `${nome} (estimado)`);
        if (e) throw e;
      }
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
        .select('id, workspace_id, subcategory_id, subcategories!categorization_rules_subcategory_id_fkey(name), match_type, pattern, category, account_id, priority, hits, source')
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
      workspaceId?: string;
    } & SubcategoryMetadata) => {
      if (input.id) {
        let request = supabase
          .from('categorization_rules')
          .update({
            pattern: input.pattern,
            category: input.category,
            account_id: input.accountId ?? null,
            ...detalheDaEscrita(input),
          })
          .eq('id', input.id);
        if (input.workspaceId) request = request.eq('workspace_id', input.workspaceId);
        const { data, error } = await request.select('id');
        if (error) throw error;
        if (!data?.length) throw new Error('A regra mudou. Reabra para conferir.');
      } else {
        const { error } = await supabase.from('categorization_rules').insert({
          user_id: await userId(),
          workspace_id: input.workspaceId ?? await workspaceId(),
          match_type: 'contains',
          pattern: input.pattern,
          category: input.category,
          account_id: input.accountId ?? null,
          source: 'user',
          ...detalheDaEscrita(input),
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
  | 'first_due_date'
  | 'updated_at'
  | 'edit_revision'
  | 'payment_category'
  | 'payment_description'
  | 'payment_merchant'
> & Partial<ExpenseClassification> & SubcategoryMetadata & { kind: (typeof DEBT_KINDS)[number]['value']; calculation_mode: 'amortized' | 'fixed_installments'; payment_method?: PaymentMethod | null; subcategory_id?: string | null; workspace_id?: string };

export type DebtScheduleRow = Omit<Fns['debt_schedule']['Returns'][number], 'interest_cents' | 'principal_cents'> & { interest_cents: number | null; principal_cents: number | null };
export type PayoffRow = Omit<Fns['payoff_strategy']['Returns'][number], 'interest_rate_monthly' | 'total_interest_cents'> & { interest_rate_monthly: number | null; total_interest_cents: number | null };

export function useDebts() {
  useRealtimeInvalidate('debts', ['debts']);
  return useQuery({
    queryKey: ['debts'],
    queryFn: async (): Promise<Debt[]> => {
      return fetchPaged<Debt>((from, to) => supabase.from('debts')
        .select(
          DEBT_COLUMNS,
        )
        .eq('archived', false)
        .order('remaining_cents', { ascending: false }).order('id').range(from, to));
    },
  });
}

const DEBT_COLUMNS =
  'id, workspace_id, subcategory_id, subcategories!debts_subcategory_id_fkey(name), expense_pattern, expense_pattern_source, expense_necessity, expense_necessity_source, name, kind, calculation_mode, principal_cents, remaining_cents, interest_rate_monthly, installments, installments_paid, installment_cents, account_id, payment_method, due_day, archived, first_due_date, updated_at, edit_revision, payment_category, payment_description, payment_merchant';

/**
 * As arquivadas (23/09/2026). Arquivar tirava a dívida da lista e não havia volta em lugar
 * nenhum — *"financiamento arquivado vai para onde?"*. Chave debaixo de `['debts']`, então a
 * mesma invalidação das ativas alcança esta.
 */
/** As tabelas que se arquivam com `archived` e voltam por "Desarquivar". Dívida tem hooks próprios. */
export type Arquivavel = 'accounts' | 'goals' | 'assets';

const COLUNAS_DO_ARQUIVADO: Record<Arquivavel, string> = {
  accounts: 'id, name, type, initial_balance_cents',
  goals: 'id, name, target_cents, saved_cents',
  assets: 'id, name, is_liability, current_value_cents',
};

export interface Arquivado {
  id: string;
  name: string;
  type?: string;
  initial_balance_cents?: number;
  target_cents?: number;
  saved_cents?: number;
  is_liability?: boolean;
  current_value_cents?: number;
}

/**
 * O que foi arquivado numa tabela (28/09/2026). Contas, cartões, metas e bens se arquivavam e
 * SUMIAM: não havia tela que os listasse nem um "Desarquivar" — o único caminho de volta era o
 * "Desfazer" do aviso, que dura segundos. Mesmo desenho das dívidas (`useArchivedDebts`).
 */
export function useArquivados(tabela: Arquivavel) {
  useRealtimeInvalidate(tabela, [tabela, 'archived']);
  return useQuery({
    queryKey: [tabela, 'archived'],
    queryFn: async (): Promise<Arquivado[]> => {
      const { data, error } = await supabase
        .from(tabela)
        .select(COLUNAS_DO_ARQUIVADO[tabela])
        .eq('archived', true)
        .order('name');
      if (error) throw error;
      return (data ?? []) as unknown as Arquivado[];
    },
  });
}

/** Desarquiva; `false` quando o registro não existe mais (apagado em outro aparelho). */
export function useDesarquivar(tabela: Arquivavel) {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (id: string): Promise<boolean> => {
      const { data, error } = await supabase.from(tabela).update({ archived: false }).eq('id', id).select('id');
      if (error) throw error;
      return (data ?? []).length > 0;
    },
    onSuccess: invalidate,
  });
}

/** A conta arquivada tem lançamentos: excluí-la os deixaria "Sem conta" e apagaria as faturas. */
export class ContaComLancamentos extends Error {
  constructor(public quantos: number) {
    super('conta com lançamentos');
  }
}

/**
 * Exclui de vez um arquivado (28/09/2026, o lado de "excluir" do arrasto). Meta leva os aportes e
 * bem leva o histórico de valores (`on delete cascade`) — a tela avisa antes. CONTA só sai sem
 * lançamento nenhum: com lançamentos a FK os deixaria "Sem conta" e apagaria as faturas do cartão,
 * mudando os números em silêncio; ela recusa e fica arquivada.
 *
 * ponytail: a contagem e o delete são duas chamadas; um lançamento criado entre elas vira "Sem
 * conta". Se isso importar, mover para uma RPC que confere e apaga na mesma transação.
 */
export function useExcluirArquivado(tabela: Arquivavel) {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (id: string): Promise<boolean> => {
      if (tabela === 'accounts') {
        const { count, error } = await supabase
          .from('transactions')
          .select('id', { count: 'exact', head: true })
          .or(`account_id.eq.${id},counterparty_account_id.eq.${id}`);
        if (error) throw error;
        if (count) throw new ContaComLancamentos(count);
      }
      const { data, error } = await supabase.from(tabela).delete().eq('id', id).select('id');
      if (error) throw error;
      return (data ?? []).length > 0;
    },
    onSuccess: invalidate,
  });
}

export function useArchivedDebts() {
  useRealtimeInvalidate('debts', ['debts', 'archived']);
  return useQuery({
    queryKey: ['debts', 'archived'],
    queryFn: (): Promise<Debt[]> => fetchPaged<Debt>((from, to) => supabase
        .from('debts')
        .select(DEBT_COLUMNS)
        .eq('archived', true)
        .order('name').order('id').range(from, to)),
  });
}

/**
 * Quantos pagamentos um "Excluir por completo" leva junto, e quanto voltam ao saldo — a
 * confirmação diz a consequência contada, não "tem certeza?".
 */
export async function pagamentosDaDivida(debtId: string): Promise<{ count: number; totalCents: number }> {
  const { data, error } = await supabase.from('transactions').select('amount_cents').eq('debt_id', debtId);
  if (error) throw error;
  return {
    count: data.length,
    totalCents: data.reduce((soma, t) => soma + Number(t.amount_cents), 0),
  };
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
        .select('id, debt_payment_no, occurred_at, amount_cents')
        .eq('debt_id', debtId!)
        .order('occurred_at');
      if (error) throw error;
      return data;
    },
  });
}

/** Valores excepcionais e vencimentos históricos salvos por número de parcela. */
export function useDebtDeclaredEstimates(debtId: string | undefined) {
  useRealtimeInvalidate('debt_declared_estimates', ['debt-declared-estimates']);
  useRealtimeInvalidate('debt_declared_due_dates', ['debt-declared-estimates']);
  return useQuery({
    enabled: Boolean(debtId),
    queryKey: ['debt-declared-estimates', debtId ?? ''],
    queryFn: async (): Promise<DebtDeclaredEstimateRow[]> => {
      const [amounts, dates] = await Promise.all([
        supabase.from('debt_declared_estimates')
          .select('installment_no, amount_cents').eq('debt_id', debtId!),
        supabase.from('debt_declared_due_dates')
          .select('installment_no, due_date').eq('debt_id', debtId!),
      ]);
      if (amounts.error) throw amounts.error;
      if (dates.error) throw dates.error;
      const byNumber = new Map<number, DebtDeclaredEstimateRow>();
      for (const row of amounts.data) byNumber.set(row.installment_no, row);
      for (const row of dates.data) byNumber.set(row.installment_no, {
        ...byNumber.get(row.installment_no), installment_no: row.installment_no, due_date: row.due_date,
      });
      return [...byNumber.values()].sort((a, b) => a.installment_no - b.installment_no);
    },
  });
}

/** Snapshot de TODAS as baixas para o compare-and-swap da edição com alcance. */
export function useDebtPaymentVersions(debtId: string | undefined) {
  useRealtimeInvalidate('transactions', ['debt-payment-versions']);
  return useQuery({
    enabled: Boolean(debtId),
    queryKey: ['debt-payment-versions', debtId ?? ''],
    queryFn: async () => {
      const { data, error } = await supabase.from('transactions')
        .select('id, debt_payment_no, edit_revision')
        .eq('debt_id', debtId!);
      if (error) throw error;
      return data;
    },
  });
}

/** Um único comando atômico corrige lançamentos pagos, estimativas e contrato. */
export function useSaveDebtPaymentScoped() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (input: {
      anchorId: string;
      scope: 'one' | 'from_here' | 'all';
      patch: Partial<Pick<Transaction, 'amount_cents' | 'category' | 'description' | 'merchant' | 'account_id' | 'occurred_at' | 'payment_method'>> & Partial<ExpenseClassification> & SubcategoryMetadata;
      debtRevision: number;
      anchorRevision: number;
      paymentVersions: Record<string, number>;
      requestId: string;
      /**
       * Dia de vencimento do contrato (-1 = último dia de todo mês). Só com "Este e os próximos"
       * ou "Todos": a data deste pagamento passa a ser o vencimento das próximas, na MESMA
       * transação dos outros campos (`update_debt_payment_due_day`).
       */
      dueDay?: number;
    }) => {
      if (input.dueDay !== undefined && input.scope !== 'one') {
        const { occurred_at: occurredAt, ...outros } = input.patch;
        if (!occurredAt) throw new Error('Falta a data do pagamento');
        const { data, error } = await supabase.rpc('update_debt_payment_due_day', {
          p_anchor_id: input.anchorId,
          p_scope: input.scope,
          p_payment_patch: outros,
          p_occurred_at: occurredAt,
          p_due_day: input.dueDay,
          p_expected_debt_revision: input.debtRevision,
          p_expected_anchor_revision: input.anchorRevision,
          p_expected_payment_versions: input.paymentVersions,
          p_request_id: input.requestId,
        });
        if (error) throw error;
        return data;
      }
      const { data, error } = await supabase.rpc('update_debt_payment_scoped', {
        p_anchor_id: input.anchorId,
        p_scope: input.scope,
        p_patch: input.patch,
        p_expected_debt_revision: input.debtRevision,
        p_expected_anchor_revision: input.anchorRevision,
        p_expected_payment_versions: input.paymentVersions,
        p_request_id: input.requestId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
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
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ['cycle', view ?? ''],
    queryFn: async (): Promise<Cycle> => {
      const { data, error } = await supabase.rpc('cycle_now', { p_view: view ?? undefined });
      if (error) throw error;
      const ciclo = data as unknown as Cycle;
      /*
        `cycle_now` já traz as bordas do ciclo corrente (`de`/`ate`, do MESMO `cycle_bounds` que
        `cycle_range` usa): é a resposta do banco para `cycle_range(mes)` do mês corrente. Semeá-la
        evita a segunda ida ao banco na abertura (resumo e comparação só começavam depois dela).
        Não é aritmética nova no app — só o reaproveitamento de uma resposta que o banco já deu.
      */
      if (ciclo?.mes && ciclo.de && ciclo.ate) {
        queryClient.setQueryData(['cycle-range', ciclo.mes, view ?? ''], { de: ciclo.de, ate: ciclo.ate });
      }
      return ciclo;
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
export function useCycleRange(month: string, view?: CycleView, enabled = true) {
  useRealtimeInvalidate('workspaces', ['cycle-range']);
  return useQuery({
    enabled,
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
  /*
    Espera a PRIMEIRA resposta de `cycle_now`: ela semeia as bordas do ciclo corrente (ver
    `useCycle`) e, antes dela, o `month` é só o palpite civil — buscar com ele era uma ida ao banco
    jogada fora nos dias em que o ciclo não é o mês civil. Com o ciclo falhando, busca como antes.
  */
  const corrente = useCycle(view);
  const esperaOCiclo = corrente.isPending && corrente.fetchStatus === 'fetching';
  const ciclo = useCycleRange(month, view, !esperaOCiclo);
  const bordas = ciclo.data ? { from: ciclo.data.de, to: ciclo.data.ate } : monthBounds(month);
  return {
    ...bordas,
    pronto: Boolean(ciclo.data),
    isPending: ciclo.isPending,
    // Esperando o ciclo, ALGUÉM vai buscar: o portão da tela (`telaPronta`) não pode ler "ninguém".
    fetchStatus: esperaOCiclo && !ciclo.data ? 'fetching' : ciclo.fetchStatus,
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

/**
 * As ocorrências das hipóteses do rascunho dentro de um ciclo (`draft_lines`, sobre o motor da
 * Projeção). Nada é salvo: o rascunho chega pela rota e vive só enquanto a tela está aberta.
 */
export function useDraftLines(hipoteses: readonly HipoteseNoCiclo[], de: string | undefined, ate: string | undefined) {
  const drafts = hipoteses.map(({ rotulo: _rotulo, ...d }) => d);
  return useQuery({
    queryKey: ['draft-lines', JSON.stringify(drafts), de ?? '', ate ?? ''],
    enabled: drafts.length > 0 && Boolean(de) && Boolean(ate),
    // Como o rascunho da Projeção: não sobrevive a sair da tela.
    gcTime: 0,
    queryFn: async (): Promise<{ antes: number; linhas: OcorrenciaDaHipotese[] }> => {
      const { data, error } = await supabase.rpc('draft_lines', { p_drafts: drafts, p_from: de!, p_to: ate! });
      if (error) throw error;
      const r = data as { antes?: number; linhas?: OcorrenciaDaHipotese[] } | null;
      return { antes: Number(r?.antes ?? 0), linhas: r?.linhas ?? [] };
    },
  });
}

/**
 * O ciclo COM as hipóteses detalhadas (spec 2026-09-28, seção 7): o fechamento e as linhas vêm de
 * `simular` — os registros são criados de verdade, lidos e desfeitos. `idsHipotese` são os
 * `ref_id` que a hipótese CRIOU (a linha vai ao grupo dela); `faturasComHipotese` são faturas que
 * já existiam e receberam a hipótese (continuam no grupo delas, marcadas).
 */
export function useCicloSimulado(registros: RegistroSimulado[], month: string, view?: CycleView) {
  return useQuery({
    enabled: registros.length > 0 && Boolean(month),
    gcTime: 0,
    queryKey: ['simular', 'ciclo', month, view ?? '', JSON.stringify(registros)],
    queryFn: async () => {
      const mes = primeiroDiaDoMes(month);
      const { data, error } = await supabase.rpc('simular', {
        p_registros: registros as never,
        p_leituras: { ciclo: { de: mes, ate: mes, view: view ?? null }, linhas_do_ciclo: { mes, view: view ?? null } } as never,
      });
      if (error) throw error;
      const r = data as {
        leituras?: { ciclo?: CycleRow[]; linhas_do_ciclo?: CycleLine[] };
        criados?: { ids?: string[]; faturas?: string[] }[];
        erros?: ErroDaHipotese[];
      } | null;
      return {
        ciclo: r?.leituras?.ciclo?.find((c) => mesmoMes(c.mes, month)) ?? null,
        // `null` = a leitura falhou dentro do `simular` (não é "sem linhas"): a tela mostra o erro.
        linhas: r?.leituras?.linhas_do_ciclo ?? null,
        idsHipotese: (r?.criados ?? []).flatMap((c) => c.ids ?? []),
        faturasComHipotese: (r?.criados ?? []).flatMap((c) => c.faturas ?? []),
        erros: r?.erros ?? [],
      };
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

/**
 * Criar série (movido de `recurring.tsx`, 29/09/2026: a hipótese e o "Aplicar" da Projeção usam
 * o mesmo). Editar NÃO passa por aqui: mudar a série reescreve, na mesma transação, as
 * ocorrências `pending` já materializadas — é a RPC `update_recurring_series`.
 */
export function useCreateRecurring() {
  const invalidate = useInvalidateFinance();
  const attempt = useRef<{ key: string; id: string } | null>(null);
  return useMutation({
    mutationFn: async (input: EntradaRecorrente) => {
      const { args } = escritaDaRecorrente(input);
      const key = JSON.stringify(args.p_input);
      if (attempt.current?.key !== key) attempt.current = { key, id: newClientMessageId() };
      const requestId = attempt.current.id;
      const { data, error } = await supabase.rpc('create_recurring_payment', {
        ...args,
        p_request_id: requestId,
      });
      if (error) throw error;
      if (attempt.current?.id === requestId) attempt.current = null;
      return data as { id: string; revision: number };
    },
    onSuccess: invalidate,
  });
}

export function useSaveDebt() {
  const invalidate = useInvalidateFinance();
  const attempt = useRef<{ key: string; id: string } | null>(null);
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
      payment_method?: PaymentMethod | null;
      due_day: number | null;
      payment_category?: string | null;
      /** A âncora do contrato (`debts.first_due_date`) — só vai quando a tela a conhece. */
      first_due_date?: string | null;
      down_payment?: DownPaymentInput;
      /** Pagas do ciclo atual que já saíram da conta: viram lançamento pago (sem mexer no saldo). */
      ja_sairam?: { accountId: string; numbers: number[] };
      /**
       * O `updated_at` da dívida quando o formulário abriu (24/09/2026). Um "Paguei" pelo WhatsApp
       * com o formulário aberto muda as pagas e o saldo; sem esta trava o salvar os sobrescrevia
       * com o que a tela tinha lido antes. Mudou no meio: nada é gravado, e o erro diz por quê.
       */
      versao?: string | null;
    } & Partial<ExpenseClassification> & SubcategoryMetadata) => {
      const { id, versao, down_payment, ja_sairam, ...resto } = input;
      if (id) {
        let consulta = supabase.from('debts').update(resto).eq('id', id);
        if (versao) consulta = consulta.eq('updated_at', versao);
        const { data, error } = await consulta.select('id');
        if (error) throw error;
        if (!data?.length) throw Object.assign(new Error('A dívida mudou enquanto você editava.'), { code: 'VERSAO' });
      } else {
        // O builder é o da prévia (que leva p_ja_sairam); a RPC real não o conhece e a gravação o lança depois.
        const { p_ja_sairam: _ja, ...args } = escritaDoFinanciamento(
          { ...resto, ...(down_payment ? { down_payment } : {}) }, ja_sairam).args;
        const key = JSON.stringify(args.p_dados);
        if (attempt.current?.key !== key) attempt.current = { key, id: newClientMessageId() };
        const { data, error } = await supabase.rpc('create_purchase', {
          ...args, p_request_id: attempt.current.id,
        });
        if (error) throw error;
        // Repetir é seguro: a mesma tentativa devolve o mesmo resultado e a RPC pula o já lançado.
        const novo = (data as { ids?: string[] } | null)?.ids?.[0];
        if (ja_sairam?.numbers.length && novo) await registrarPagasContadas(novo, ja_sairam.accountId, ja_sairam.numbers);
      }
    },
    onSuccess: invalidate,
  });
}

/** Lança como PAGAS (na conta) parcelas que a dívida só contava: o saldo dela não anda de novo. */
export async function registrarPagasContadas(debtId: string, accountId: string, numbers: number[]) {
  const { error } = await supabase.rpc('register_counted_debt_payments', {
    p_debt_id: debtId, p_account_id: accountId, p_numbers: numbers,
  });
  if (error) throw error;
}

export function useRegistrarPagasContadas() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: (i: { debtId: string; accountId: string; numbers: number[] }) =>
      registrarPagasContadas(i.debtId, i.accountId, i.numbers),
    onSuccess: invalidate,
  });
}

/** A ficha edita a parcela numerada com uma única transação no banco. */
export function useSaveDebtContractScoped() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (input: {
      debtId: string;
      anchorNo: number;
      scope: 'one' | 'future' | 'all';
      patch: Record<string, string | number | null>;
      debtRevision: number;
      paymentVersions: Record<string, number>;
      requestId: string;
    }) => {
      const { data, error } = await supabase.rpc('update_debt_contract_scoped', {
        p_debt_id: input.debtId,
        p_anchor_no: input.anchorNo,
        p_scope: input.scope,
        p_patch: input.patch,
        p_expected_revision: input.debtRevision,
        p_expected_payment_versions: input.paymentVersions,
        p_request_id: input.requestId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });
}

/** Paga uma parcela: a RPC cria a despesa e abate o saldo já descontando juros. */
export function usePayDebtInstallment() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (input: { debtId: string; amountCents: number; accountId?: string | null; paidAt?: string }) => {
      const { error } = await supabase.rpc('pay_debt_installment', {
        p_debt_id: input.debtId,
        p_amount_cents: input.amountCents,
        p_account_id: input.accountId ?? undefined,
        // Quando a folha não diz, hoje no relógio da pessoa (o default da assinatura é o do UTC).
        p_paid_at: input.paidAt ?? localISODate(),
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

/**
 * Devolve se a dívida VOLTOU. O "Desfazer" do toast pode chegar depois de a dívida ter sido
 * apagada por outro caminho: zero linhas, sem erro — e a tela não pode dizer que ela voltou.
 */
export function useUnarchiveDebt() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (id: string): Promise<boolean> => {
      const { data, error } = await supabase.from('debts').update({ archived: false }).eq('id', id).select('id');
      if (error) throw error;
      return Boolean(data?.length);
    },
    onSuccess: invalidate,
  });
}

/** "Excluir por completo": pagamentos lançados e dívida, numa transação (`delete_debt`). */
export function useDeleteDebt() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (id: string): Promise<number> => {
      const { data, error } = await supabase.rpc('delete_debt', { p_debt_id: id });
      if (error) throw error;
      return data;
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

export interface TransactionInput extends Partial<ExpenseClassification>, SubcategoryMetadata {
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
  /** Omitido preserva o método; null limpa a escolha explicitamente. */
  payment_method?: PaymentMethod | null;
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
/** Rótulo humano da taxa; sua propriedade é definida pelo vínculo no banco. */
export { DESCRICAO_JUROS_DO_PIX };

/**
 * Somente a taxa vinculada explicitamente a esta compra. Linhas antigas sem vínculo
 * continuam independentes: descrição, conta e data não provam a quem uma taxa pertence.
 */
export function useJurosDoPix(tx: Transaction | null | undefined) {
  // A compra no cartão OU o Pix no crédito para conta própria (transferência que sai do cartão).
  const procura = Boolean(tx?.invoice_id && contaNaFatura(tx.kind) && !tx.pix_fee_for_transaction_id && !tx.installment_plan_id);
  return useQuery({
    queryKey: ['transactions', 'juros-do-pix', tx?.id],
    enabled: procura,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transactions')
        .select('id, amount_cents')
        .eq('pix_fee_for_transaction_id', tx!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useSaveTransaction() {
  const invalidate = useInvalidateFinance();
  const attempt = useRef<{ key: string; id: string } | null>(null);
  return useMutation({
    mutationFn: async (input: EntradaEscritaLancamento) => {
      const { args: payload } = escritaDoLancamento(input);
      const key = JSON.stringify(payload);
      if (attempt.current?.key !== key) attempt.current = { key, id: newClientMessageId() };
      const requestId = attempt.current.id;
      const { data, error } = await supabase.rpc('save_transaction_payment', {
        ...payload, p_request_id: requestId,
      });
      if (error) throw error;
      if (attempt.current?.id === requestId) attempt.current = null;
      return data as unknown as { id: string; revision: number; fee_id: string | null };
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
 * Uma RPC apaga entrada e plano na mesma transação, inclusive quando já não há parcelas.
 *
 * Não tem "Desfazer": o cascade não volta. Por isso quem chama precisa
 * confirmar nomeando o estrago (`confirmDestructive`).
 */
export function useDeleteInstallmentPlan() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (planId: string) => {
      const { error } = await supabase.rpc('delete_installment_purchase', { p_plan_id: planId });
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
      patch: Partial<Pick<TransactionInput, 'amount_cents' | 'category' | 'description' | 'merchant' | 'account_id' | 'payment_method'>> & Partial<ExpenseClassification> & SubcategoryMetadata;
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

/** Uma parcela ou um intervalo do plano são salvos em uma única transação SQL. */
export function useSaveInstallmentOccurrence() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async ({ id, scope = 'one', patch, lastDay = false, expectedPlanRevision, expectedAnchorRevision, requestId }: {
      id: string;
      scope?: 'one' | 'future' | 'all';
      patch: Partial<Pick<TransactionInput,
        'amount_cents' | 'category' | 'description' | 'merchant' | 'occurred_at' |
        'status' | 'due_at' | 'auto_confirm' | 'payment_method'>> & Partial<ExpenseClassification> & SubcategoryMetadata & { total_cents?: number };
      expectedPlanRevision: number;
      expectedAnchorRevision: number;
      requestId: string;
      /** "Último dia de todo mês": depois da edição, as parcelas do alcance vão ao fim do mês. */
      lastDay?: boolean;
    }) => {
      if (!Number.isSafeInteger(expectedPlanRevision) || !Number.isSafeInteger(expectedAnchorRevision) || !requestId)
        throw new Error('Atualize a compra e a parcela antes de salvar. Não consegui conferir a versão.');
      const { data, error } = await supabase.rpc('update_installment_scope_checked', {
        p_transaction_id: id,
        p_scope: scope,
        p_patch: patch,
        p_expected_plan_revision: expectedPlanRevision,
        p_expected_anchor_revision: expectedAnchorRevision,
        p_request_id: requestId,
        p_last_day: lastDay,
      });
      if (error) throw error;
      return Number(data ?? 0);
    },
    onSuccess: invalidate,
  });
}

/**
 * Editar a série. Vai por RPC porque não é UM update: a regra manda nas ocorrências
 * que ainda não existem e as já materializadas (90 dias à frente, `pending`) precisam
 * acompanhar — senão os próximos três meses ficam com o valor velho e o quarto com o
 * novo. As passadas não mudam, que é a regra que o dono do produto pediu.
 */
export function useSaveRecurringSeries() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async ({ id, patch, expectedRevision, requestId }: {
      id: string;
      expectedRevision: number;
      requestId: string;
      patch: {
        amount_cents?: number;
        category?: string | null;
        description?: string | null;
        merchant?: string | null;
        kind?: 'expense' | 'income';
        account_id?: string | null;
        /** Só na transferência: a conta de destino. */
        counterparty_account_id?: string | null;
        payment_method?: PaymentMethod | null;
        auto_confirm?: boolean;
        end_date?: string | null;
        /** O calendário vai junto: regra nova e o próximo vencimento (`20260926120000`). */
        rrule?: string;
        next_run_at?: string;
      } & Partial<ExpenseClassification> & SubcategoryMetadata;
    }) => {
      const { data, error } = await supabase.rpc('update_recurring_future', {
        p_transaction_id: null,
        p_recurring_id: id,
        p_line_patch: {},
        p_series_patch: patch,
        p_expected_revision: expectedRevision,
        p_request_id: requestId,
      });
      if (error) throw error;
      // O calendário pedido num mês que já tem a sua cobrança desliza para o seguinte
      // (`20260927120000`): relê onde a série caiu para a tela dizer.
      let aviso: string | null = null;
      if (patch.next_run_at) {
        const { data: depois } = await supabase
          .from('recurring_transactions')
          .select('next_run_at')
          .eq('id', id)
          .maybeSingle();
        if (depois?.next_run_at) aviso = avisoDeDeslize(dataLocalDe(patch.next_run_at), dataLocalDe(depois.next_run_at));
      }
      return { quantas: Number(data ?? 0), aviso };
    },
    onSuccess: invalidate,
  });
}

/** Corrige o contrato e todas as ocorrências gravadas, inclusive as passadas, numa transação. */
export function useSaveRecurringAll() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (input: {
      recurringId: string;
      linePatch: Partial<Pick<TransactionInput,
        'amount_cents' | 'category' | 'description' | 'merchant' | 'account_id' | 'payment_method'>> & Partial<ExpenseClassification> & SubcategoryMetadata;
      seriesPatch: {
        amount_cents?: number;
        category?: string | null;
        description?: string | null;
        merchant?: string | null;
        kind?: 'expense' | 'income';
        account_id?: string | null;
        counterparty_account_id?: string | null;
        auto_confirm?: boolean;
        end_date?: string | null;
        rrule?: string;
        next_run_at?: string;
      } & Partial<ExpenseClassification> & SubcategoryMetadata;
      expectedRevision: number;
      requestId: string;
    }) => {
      const { data, error } = await supabase.rpc('update_recurring_all', {
        p_recurring_id: input.recurringId,
        p_line_patch: input.linePatch,
        p_series_patch: input.seriesPatch,
        p_expected_revision: input.expectedRevision,
        p_request_id: input.requestId,
      });
      if (error) throw error;
      return Number(data ?? 0);
    },
    onSuccess: invalidate,
  });
}

/** Uma ocorrência gravada: revisão otimista e chave de requisição evitam edições repetidas. */
export function useSaveRecurringOne() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      patch: Record<string, string | number | boolean | null>;
      expectedRevision: number;
      requestId: string;
    }) => {
      const { data, error } = await supabase.rpc('update_recurring_one', {
        p_transaction_id: input.id,
        p_patch: input.patch,
        p_expected_revision: input.expectedRevision,
        p_request_id: input.requestId,
      });
      if (error) throw error;
      return Number(data ?? 0);
    },
    onSuccess: invalidate,
  });
}

/** Edita linhas e calendário no mesmo comando SQL; falha inteira se uma parte falhar. */
export function useSaveRecurringOccurrenceAndSeries() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async ({ id, recurringId, linePatch, seriesPatch, expectedRevision, requestId }: {
      id: string;
      recurringId: string;
      expectedRevision: number;
      requestId: string;
      linePatch: Partial<Pick<TransactionInput, 'amount_cents' | 'category' | 'description' | 'merchant' | 'account_id' | 'payment_method'>> & Partial<ExpenseClassification> & SubcategoryMetadata;
      seriesPatch: {
        amount_cents?: number;
        category?: string | null;
        description?: string | null;
        merchant?: string | null;
        kind?: 'expense' | 'income';
        account_id?: string | null;
        auto_confirm?: boolean;
        end_date?: string | null;
        rrule?: string;
        next_run_at?: string;
      } & Partial<ExpenseClassification> & SubcategoryMetadata;
    }) => {
      const { data, error } = await supabase.rpc('update_recurring_future', {
        p_transaction_id: id,
        p_recurring_id: recurringId,
        p_line_patch: linePatch,
        p_series_patch: seriesPatch,
        p_expected_revision: expectedRevision,
        p_request_id: requestId,
      });
      if (error) throw error;
      let aviso: string | null = null;
      if (seriesPatch.next_run_at) {
        const { data: depois } = await supabase
          .from('recurring_transactions')
          .select('next_run_at')
          .eq('id', recurringId)
          .maybeSingle();
        if (depois?.next_run_at) aviso = avisoDeDeslize(dataLocalDe(seriesPatch.next_run_at), dataLocalDe(depois.next_run_at));
      }
      return { quantas: Number(data ?? 0), aviso };
    },
    onSuccess: invalidate,
  });
}

/**
 * A conta já tem lançamento? (26/09/2026) Com lançamento, cartão não vira conta nem o contrário
 * (`20260926170000`: as compras do cartão moram em faturas) — a tela só oferece o que vale.
 */
export function useContaTemLancamentos(id: string | null | undefined) {
  return useQuery({
    queryKey: ['accounts', 'tem-lancamentos', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { count, error } = await supabase
        .from('transactions')
        .select('id', { count: 'exact', head: true })
        .or(`account_id.eq.${id},counterparty_account_id.eq.${id}`);
      if (error) throw error;
      return (count ?? 0) > 0;
    },
  });
}

export type CreateAccountInput = {
  name: string;
  type: Account['type'];
  initial_balance_cents: number;
  closing_day?: number | null;
  due_day?: number | null;
  credit_limit_cents?: number | null;
  payment_account_id?: string | null;
  closing_day_inclusive?: boolean;
  rotativo_auto?: boolean;
  rotativo_rate_monthly?: number | null;
};

export type CreateAccountResult = {
  id: string;
  availability: 'active' | 'archived' | 'unavailable';
  account: Account | null;
};

/** An imperative write receipt has its own lifetime; React renders only its pending draft. */
function accountCreationController(publish: (input: CreateAccountInput | null) => void) {
  let attempt: { id: string; key: string; input: CreateAccountInput; ambiguous: boolean } | null = null;
  let inFlight: Promise<CreateAccountResult> | null = null;
  return {
    submit: (input: CreateAccountInput): Promise<CreateAccountResult> => {
      // All fields are scalars. Sorting also treats a different object insertion order as retry.
      const snapshot = Object.freeze(Object.fromEntries(
        Object.entries(input).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b)),
      )) as CreateAccountInput;
      const key = JSON.stringify(snapshot);
      if (attempt && attempt.key !== key) {
        return Promise.reject(new Error('Confirme a tentativa anterior antes de alterar os dados da conta.'));
      }
      if (inFlight) return inFlight;
      if (!attempt) {
        attempt = { id: newClientMessageId(), key, input: snapshot, ambiguous: false };
        publish(snapshot);
      }
      const original = attempt;
      // Defer dispatch until inFlight is assigned, including a synchronous transport exception.
      const promise = Promise.resolve().then(async () => {
        try {
          const { data: response, error } = await supabase.rpc('create_account', { p_input: original.input as Json, p_request_id: original.id });
          const data = response as CreateAccountResult | null;
          if (error) {
            // An initial SQL refusal proves rollback. A retry refusal cannot disprove an earlier commit.
            if (!original.ambiguous && error.code && (/^(22|23)/.test(error.code) || ['42501', 'P0001'].includes(error.code))) {
              attempt = null;
              publish(null);
            }
            throw error;
          }
          const current = data?.account;
          // Validate the current row's shape, not its old creation values: later edits are valid.
          // Signed seeds and nullable card days are legal in a later edit; creation rules do not apply to replay.
          const currentValid = current && current.id === data?.id
            && typeof current.name === 'string' && current.name.trim().length > 0
            && ACCOUNT_TYPES.some(type => type.value === current.type)
            && Number.isSafeInteger(current.initial_balance_cents)
            && current.archived === (data?.availability === 'archived')
            && (current.type !== 'credit_card' || [current.closing_day, current.due_day].every(
              day => day === null || typeof day === 'number' && Number.isInteger(day) && day >= 1 && day <= 31,
            ));
          if (!data || typeof data.id !== 'string' || !data.id
            || !['active', 'archived', 'unavailable'].includes(data.availability)
            || (data.availability === 'unavailable' ? data.account !== null
              : !currentValid)) {
            throw new Error('Não foi possível confirmar a criação da conta. Tente novamente.');
          }
          attempt = null;
          publish(null);
          return data;
        } catch (failure) {
          if (attempt === original) original.ambiguous = true;
          throw failure;
        } finally {
          inFlight = null;
        }
      });
      inFlight = promise;
      return promise;
    },
  };
}

/** Creation has its own receipt: a lost response must never become a second account. */
export function useCreateAccount() {
  const invalidate = useInvalidateFinance();
  const [unconfirmedInput, setUnconfirmedInput] = useState<CreateAccountInput | null>(null);
  const [controller] = useState(() => accountCreationController(setUnconfirmedInput));
  const mutation = useMutation({ mutationFn: controller.submit, onSuccess: invalidate });
  return { ...mutation, unconfirmedInput };
}

/** O espaço padrão de quem está logado — a chave do progresso do primeiro cadastro. */
export function useDefaultWorkspaceId() {
  return useQuery({ queryKey: ['default-workspace-id'], queryFn: workspaceId });
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

/**
 * Cria ou edita (mesma forma de useSaveTransaction: com `id` vira update). F19: grava ícone e cor
 * e SINCRONIZA os marcos (centavos) — insere e apaga só a diferença. Os marcos acima do alvo que
 * a pessoa não apagou ficam na lista que chega aqui e, portanto, ficam no banco.
 */
export function useSaveGoal() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async ({
      id,
      marcos,
      ...input
    }: {
      id?: string;
      name: string;
      target_cents: number;
      deadline: string | null;
      icon: string | null;
      color: string | null;
      /** Ausente = não mexer nos marcos (formulário que não os carregou). */
      marcos?: number[];
    }) => {
      let goalId = id;
      if (id) {
        const { error } = await supabase.from('goals').update(input).eq('id', id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('goals')
          .insert({ ...input, user_id: await userId() })
          .select('id')
          .single();
        if (error) throw error;
        goalId = data.id;
      }
      if (marcos) {
        const { data: gravados, error: lerErro } = await supabase
          .from('goal_milestones').select('amount_cents').eq('goal_id', goalId!);
        if (lerErro) throw lerErro;
        const { apagar, inserir } = diferencaDosMarcos(gravados.map((m) => Number(m.amount_cents)), marcos);
        if (apagar.length) {
          const { error } = await supabase
            .from('goal_milestones').delete().eq('goal_id', goalId!).in('amount_cents', apagar);
          if (error) throw error;
        }
        if (inserir.length) {
          const { error } = await supabase
            .from('goal_milestones').insert(inserir.map((amount_cents) => ({ goal_id: goalId!, amount_cents })));
          if (error) throw error;
        }
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
    mutationFn: async ({ goal, amountCents, note, occurredAt }: {
      goal: Goal;
      amountCents: number;
      note?: string;
      /** Quando (26/09/2026): era sempre hoje. Sem ela, hoje no relógio da pessoa. */
      occurredAt?: string;
    }) => {
      const { error } = await supabase.rpc('goal_deposit', {
        p_goal_id: goal.id,
        p_amount_cents: amountCents,
        p_occurred_at: occurredAt ?? localISODate(),
        p_note: note ?? undefined,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

/** Muda AQUELE aporte (`20260926160000`): valor, data e nota, com a trava de não negativar a meta. */
export function useEditGoalContribution() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (input: { id: string; amountCents: number; occurredAt: string; note: string | null }) => {
      const { error } = await supabase.rpc('edit_goal_contribution', {
        p_contribution_id: input.id,
        p_amount_cents: input.amountCents,
        p_occurred_at: input.occurredAt,
        p_note: input.note ?? undefined,
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

/**
 * Encerrar uma série (F18): a prévia diz o que fica e o que sai, e o comando faz as duas coisas
 * numa transação, idempotente pela chave da tentativa. Reabrir é editar o fim.
 */
export function useEndRecurringPreview(id: string | null, lastDate: string | null) {
  return useQuery({
    enabled: Boolean(id && lastDate),
    queryKey: ['recurring', 'end-preview', id, lastDate],
    // Os números dependem do que a série tem AGORA: nunca reaproveitar uma prévia velha.
    staleTime: 0,
    gcTime: 0,
    queryFn: async (): Promise<PreviaDoEncerramento> => {
      const { data, error } = await supabase.rpc('end_recurring_series_preview', {
        p_recurring_id: id!, p_last_date: lastDate!,
      });
      if (error) throw error;
      return data as unknown as PreviaDoEncerramento;
    },
  });
}

/** A prévia sob demanda (o editor da série confirma antes de salvar um fim que encerra). */
export function usePreviewEndRecurring() {
  return useMutation({
    mutationFn: async ({ id, lastDate }: { id: string; lastDate: string }): Promise<PreviaDoEncerramento> => {
      const { data, error } = await supabase.rpc('end_recurring_series_preview', {
        p_recurring_id: id, p_last_date: lastDate,
      });
      if (error) throw error;
      return data as unknown as PreviaDoEncerramento;
    },
  });
}

export function useEndRecurring() {
  const invalidate = useInvalidateFinance();
  const attempt = useRef<{ key: string; id: string } | null>(null);
  return useMutation({
    mutationFn: async ({ id, lastDate }: { id: string; lastDate: string }): Promise<PreviaDoEncerramento> => {
      const key = JSON.stringify([id, lastDate]);
      if (attempt.current?.key !== key) attempt.current = { key, id: newClientMessageId() };
      const requestId = attempt.current.id;
      const { data, error } = await supabase.rpc('end_recurring_series', {
        p_recurring_id: id, p_last_date: lastDate, p_request_id: requestId,
      });
      if (error) throw error;
      if (attempt.current?.id === requestId) attempt.current = null;
      return data as unknown as PreviaDoEncerramento;
    },
    onSuccess: invalidate,
  });
}

/** A data da primeira ocorrência gravada da série: parte do piso do "Termina em" (o `dtstart` é reescrito pelo calendário). */
export function useRecurringFirstDate(id: string | null) {
  return useQuery({
    enabled: Boolean(id),
    queryKey: ['recurring', 'first-date', id],
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase
        .from('transactions')
        .select('occurred_at')
        .eq('recurring_id', id!)
        .order('occurred_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data?.occurred_at as string | undefined) ?? null;
    },
  });
}

/** As datas já geradas da série, as mais recentes primeiro: o padrão da "última cobrança" sai delas. */
export function useRecurringOccurrenceDates(id: string | null) {
  return useQuery({
    enabled: Boolean(id),
    queryKey: ['recurring', 'occurrence-dates', id],
    staleTime: 0,
    gcTime: 0,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase
        .from('transactions')
        .select('occurred_at')
        .eq('recurring_id', id!)
        .lte('occurred_at', localISODate())
        .order('occurred_at', { ascending: false })
        .limit(12);
      if (error) throw error;
      return (data ?? []).map((r) => r.occurred_at as string);
    },
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
      /**
       * Editando: a chave do limite que abriu (categoria + mês do limite, nulo = todo mês). Vai por
       * `edit_budget` (`20260926150000`), que muda AQUELE limite — o upsert criava outro.
       */
      antes?: { category: string; month: string | null };
    }) => {
      if (input.antes) {
        const { error } = await supabase.rpc('edit_budget', {
          p_category_antes: input.antes.category,
          p_month_antes: input.antes.month,
          p_category: input.category,
          p_limit_cents: input.limit_cents,
          p_rollover: input.rollover ?? false,
          p_month: input.month ? primeiroDiaDoMes(input.month) : undefined,
        });
        if (error) throw error;
        return;
      }
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

/**
 * `fetchPaged` para um `in(...)` de muitos ids (24/09/2026): a lista de ids vai na URL, e com
 * centenas deles o pedido estoura o tamanho. Em lotes de 100, cada lote paginado.
 */
async function fetchPagedEmLotes<T>(
  ids: readonly string[],
  page: (lote: string[], from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const lote = ids.slice(i, i + 100);
    rows.push(...(await fetchPaged<T>((from, to) => page(lote, from, to))));
  }
  return rows;
}

export interface InstallmentParcel {
  id: string;
  edit_revision?: number;
  installment_no: number | null;
  amount_cents: number;
  occurred_at: string;
  invoice_id: string | null;
  status: 'pending' | 'cleared';
}

export interface InstallmentPlanSummary extends Partial<ExpenseClassification>, SubcategoryMetadata {
  id: string;
  workspace_id?: string;
  payment_method?: PaymentMethod | null;
  edit_revision?: number;
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
  /** Das travadas, quantas estão numa fatura de cartão: elas prendem a data e a conta da compra. */
  locked_in_invoice: number;
  /** A maior parcela travada: o número de parcelas não fica abaixo dela (`20260926130000`). */
  last_locked_no: number;
  /**
   * A última parcela paga junto com uma fatura DE VERDADE (com pagamento, adiada ou paga em parte):
   * "parcelas já pagas" não desce abaixo dela. A fatura que o app quitou à mão reabre junto.
   */
  paid_floor: number;
  /** Quais são as travadas — o formulário da parcela precisa saber se ELA ainda muda. */
  locked_ids: string[];
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
    queryFn: () => buscarPlanos(),
  });
}

/**
 * UMA compra, pelo id — o formulário da parcela. Procurá-la na lista acima (limitada a 200)
 * deixava a compra antiga de quem tem muitas sem plano, e o valor travado sem dizer por quê.
 */
export function useInstallmentPlan(id: string | null | undefined) {
  useRealtimeInvalidate('installment_plans', ['installments']);
  useRealtimeInvalidate('transactions', ['installments']);
  return useQuery({
    queryKey: ['installments', 'plan', id],
    enabled: !!id,
    queryFn: async () => (await buscarPlanos(id!))[0] ?? null,
  });
}

/**
 * O resumo da compra de uma parcela, numa ida só — o detalhe do lançamento. `useInstallmentPlan`
 * calcula pago, travadas e próxima (parcelas + faturas fechadas: três consultas em série), e o
 * detalhe só escreve "Parcela N de M", o total e a data da compra.
 */
export function useInstallmentPlanResumo(id: string | null | undefined) {
  useRealtimeInvalidate('installment_plans', ['installments']);
  return useQuery({
    queryKey: ['installments', 'resumo', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('installment_plans')
        .select('description, merchant, total_cents, installments, first_occurred_at')
        .eq('id', id!)
        .maybeSingle();
      if (error) throw error;
      return data && { ...data, title: data.description || data.merchant || 'Compra parcelada' };
    },
  });
}

/**
 * Todas as compras parceladas (24/09/2026). Era `limit(200)`: da 201ª em diante a compra sumia da
 * tela e do "Comprometido nos próximos 12 meses" — uma compra antiga em 48x ainda pesa no mês. A
 * soma precisa de todas; a tela desenha 20 por vez.
 */
async function buscarPlanos(apenas?: string): Promise<InstallmentPlanSummary[]> {
  type Plano = {
    id: string; merchant: string | null; description: string | null; category: string | null;
    account_id: string | null; total_cents: number; installments: number; first_occurred_at: string;
    payment_method: PaymentMethod | null; edit_revision: number; workspace_id: string; subcategory_id: string | null;
  } & ExpenseClassification;
  const plans = await fetchPaged<Plano>((from, to) => {
    const consulta = supabase
      .from('installment_plans')
      .select('id, merchant, description, category, subcategory_id, account_id, total_cents, installments, first_occurred_at, payment_method, edit_revision, workspace_id, expense_pattern, expense_pattern_source, expense_necessity, expense_necessity_source');
    return (apenas ? consulta.eq('id', apenas) : consulta.order('first_occurred_at', { ascending: false }).order('id')).range(from, to);
  });
  if (!plans.length) return [];

  const ids = plans.map((p) => p.id);
  const rows = await fetchPagedEmLotes<InstallmentParcel & { installment_plan_id: string | null }>(
    ids,
    (lote, from, to) =>
      supabase
        .from('transactions')
        .select('id, edit_revision, installment_plan_id, installment_no, amount_cents, occurred_at, status, invoice_id')
        .in('installment_plan_id', lote)
        .order('installment_no')
        .range(from, to),
  );

  /**
   * As faturas FECHADAS para efeito de edição. Uma consulta só, e minúscula: a alternativa
   * era perguntar o status de cada fatura por parcela.
   */
  const { data: fechadas, error: erroFaturas } = await supabase
    .from('card_invoices')
    .select('id, status, paid_cents, settled_manually')
    .or('status.in.(paid,rolled),paid_cents.gt.0');
  if (erroFaturas) throw erroFaturas;
  const faturaFechada = new Set((fechadas ?? []).map((f) => f.id));
  // Paga de verdade: a quitada à mão pelo app (histórico) não conta — ela reabre junto.
  const faturaPagaDeVerdade = new Set(
    (fechadas ?? [])
      .filter((f) => f.status === 'rolled' || f.paid_cents > 0 || (f.status === 'paid' && !f.settled_manually))
      .map((f) => f.id),
  );

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
      workspace_id: plan.workspace_id,
      ...expenseClassificationFromRecord(plan),
      title: plan.description || plan.merchant || 'Compra parcelada',
      description: plan.description,
      merchant: plan.merchant,
      category: plan.category,
      subcategory_id: plan.subcategory_id,
      account_id: plan.account_id,
      payment_method: plan.payment_method,
      edit_revision: plan.edit_revision,
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
      locked_in_invoice: travadas.filter((p) => p.invoice_id).length,
      last_locked_no: travadas.reduce((maior, p) => Math.max(maior, p.installment_no ?? 0), 0),
      paid_floor: parcels
        .filter((p) => p.status === 'cleared' && p.invoice_id && faturaPagaDeVerdade.has(p.invoice_id))
        .reduce((maior, p) => Math.max(maior, p.installment_no ?? 0), 0),
      locked_ids: travadas.map((p) => p.id),
      first_occurred_at: plan.first_occurred_at,
      last_occurred_at: parcels.reduce<string | null>(
        (maior, p) => (maior && maior > p.occurred_at ? maior : p.occurred_at),
        null,
      ),
      active: parcels.some((p) => p.status === 'pending'),
      parcels,
    };
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
/**
 * TODAS as faturas do cartão (24/09/2026). Era `limit(60)`: depois de cinco anos a fatura mais
 * antiga sumia da tela sem aviso. A tela desenha 20 por vez; o dado vem inteiro porque a série
 * e a média precisam dele, e um cartão tem uma fatura por mês.
 */
export function useCardInvoices(accountId: string | undefined) {
  useRealtimeInvalidate('card_invoices', ['card-invoices']);
  useRealtimeInvalidate('transactions', ['card-invoices']);
  return useQuery({
    enabled: Boolean(accountId),
    queryKey: ['card-invoices', accountId ?? ''],
    queryFn: async (): Promise<CardInvoiceHistory[]> => {
      type Linha = Omit<CardInvoiceHistory, 'total_cents' | 'tx_count'>;
      const invoices = await fetchPaged<Linha>((from, to) =>
        supabase
          .from('card_invoices')
          .select('id, reference_month, closing_date, due_date, status, paid_at, payment_transaction_id, rolled_into_invoice_id')
          .eq('account_id', accountId!)
          .order('reference_month', { ascending: false })
          .order('id')
          .range(from, to),
      );
      if (!invoices.length) return [];

      const ids = invoices.map((i) => i.id);
      const rows = await fetchPagedEmLotes<{ invoice_id: string | null; amount_cents: number }>(ids, (lote, from, to) =>
        supabase
          .from('transactions')
          .select('invoice_id, amount_cents')
          .in('invoice_id', lote)
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
        ...invoice,
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
        // Quem entrou por último primeiro (24/09/2026: "do mais recente para o mais antigo").
        .order('created_at', { ascending: false });
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
/**
 * `limit` cresce pelo "Ver mais" da tela (24/09/2026): era um teto fixo de 20, e da 21ª em diante
 * a importação sumia do histórico sem aviso. `keepPreviousData` segura a lista na tela enquanto a
 * página maior chega.
 */
export function useImportBatches(limit = 20, filters: ListFiltersValue = {}) {
  useRealtimeInvalidate('import_items', ['import-batches']);
  return useQuery({
    placeholderData: (previous, query) => JSON.stringify(query?.queryKey[2] ?? {}) === JSON.stringify(filters) ? previous : undefined,
    queryKey: ['import-batches', String(limit), filters],
    queryFn: async (): Promise<ImportBatchSummary[]> => {
      const bounds = timestampDateBounds(filters);
      const term = toIlikeTerm(filters.q ?? '');
      // Novo builder por página: range e predicados nunca vazam para outro pedido.
      const batches = await fetchPaged<Omit<ImportBatchSummary, 'total' | 'pendentes' | 'aprovados' | 'descartados' | 'duplicados'>>((from, to) => {
        if (from >= limit) return Promise.resolve({ data: [], error: null });
        let query = supabase.from('import_batches')
          .select('id, filename, source, account_id, status, error, created_at')
          .order('created_at', { ascending: false }).order('id', { ascending: false });
        if (bounds.from) query = query.gte('created_at', bounds.from);
        if (bounds.before) query = query.lt('created_at', bounds.before);
        if (term) query = query.ilike('filename', `%${term}%`);
        if (filters.selections?.source) query = query.eq('source', filters.selections.source);
        if (filters.selections?.accountId) query = filters.selections.accountId === NO_ACCOUNT
          ? query.is('account_id', null) : query.eq('account_id', filters.selections.accountId);
        return query.range(from, Math.min(to, limit - 1));
      });
      if (!batches.length) return [];

      const ids = batches.map((b) => b.id);
      const rows = await fetchPagedEmLotes<{ batch_id: string; status: string }>(ids, (lote, from, to) =>
        supabase.from('import_items').select('batch_id, status').in('batch_id', lote).order('id').range(from, to),
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
/** `limit` cresce pelo "Ver mais" (24/09/2026): o teto de 60 escondia o alerta mais antigo. */
export function useAlertsSent(limit = 20) {
  return useQuery({
    placeholderData: keepPreviousData,
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
