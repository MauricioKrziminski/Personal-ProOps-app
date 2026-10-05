import type { PaymentMethod } from './payment-method.ts';
import { normalizePaymentMethodFilters, type PaymentMethodFilter } from './payment-method-filters.ts';
import type { ExpenseClassification } from './expense-classification.ts';
import {
  normalizeExpensePatternFilters, normalizeExpenseNecessityFilters,
  type ExpensePatternFilter, type ExpenseNecessityFilter,
} from './expense-classification-filters.ts';

/** An occurrence calculated for the visible period but absent from the transaction ledger. */
export interface ExpectedLedgerLine extends Partial<ExpenseClassification> {
  origin: 'recurring' | 'debt_schedule' | 'debt_estimate';
  ref_id: string;
  due_date: string;
  amount_cents: number;
  kind: 'expense' | 'income' | 'transfer';
  description: string;
  category: string | null;
  subcategory_id?: string | null;
  subcategory_name?: string | null;
  account_id: string | null;
  /** Transferência recorrente: a conta de destino (a prevista aparece nas DUAS contas). */
  counterparty_account_id?: string | null;
  payment_method?: PaymentMethod | null;
  installment_no: number | null;
  installments_total: number | null;
  /** A first period inferred from legacy creation metadata rather than a saved start date. */
  inferred_start: boolean;
  /**
   * O estado que a linha terá (`20260928210040`): a recorrente com "entra como pago" que já
   * passou nasce `cleared`, e a parcela só contada como paga também é.
   */
  status: 'pending' | 'cleared';
}

interface ExpectedFilters {
  kind?: 'expense' | 'income' | 'transfer';
  status?: 'pending' | 'cleared';
  category?: string;
  subcategoryId?: string | null;
  accountId?: string | null;
  source?: 'whatsapp' | 'app' | 'import' | 'recurring';
  recurringId?: string;
  q?: string;
  minCents?: number;
  maxCents?: number;
  paymentMethods?: readonly PaymentMethodFilter[];
  expensePatterns?: readonly ExpensePatternFilter[];
  expenseNecessities?: readonly ExpenseNecessityFilter[];
}

/** Keep the separate prediction block in step with the ledger's filters. */
export function filterExpectedLines<T extends ExpectedLedgerLine>(
  lines: readonly T[], filters: ExpectedFilters,
): T[] {
  const term = filters.q?.trim().toLocaleLowerCase('pt-BR');
  const paymentMethods = normalizePaymentMethodFilters(filters.paymentMethods);
  const expensePatterns = normalizeExpensePatternFilters(filters.expensePatterns);
  const expenseNecessities = normalizeExpenseNecessityFilters(filters.expenseNecessities);
  return lines.filter((line) => {
    if (filters.status && line.status !== filters.status) return false;
    if (filters.kind && line.kind !== filters.kind) return false;
    if (filters.category && line.category !== filters.category) return false;
    if (filters.subcategoryId !== undefined && (line.subcategory_id ?? null) !== filters.subcategoryId) return false;
    // Transferência recebida: a conta de destino também a vê (como no extrato das gravadas).
    if (filters.accountId !== undefined && line.account_id !== filters.accountId
      && (filters.accountId === null || line.counterparty_account_id !== filters.accountId)) return false;
    if (filters.source && (filters.source !== 'recurring' || line.origin !== 'recurring')) return false;
    if (filters.recurringId && (line.origin !== 'recurring' || line.ref_id !== filters.recurringId)) return false;
    if (filters.minCents !== undefined && line.amount_cents < filters.minCents) return false;
    if (filters.maxCents !== undefined && line.amount_cents > filters.maxCents) return false;
    if (paymentMethods.length && !paymentMethods.includes(line.payment_method ?? 'not_informed')) return false;
    // Expected rows never pay an invoice; only consumption expenses are classifiable.
    if ((expensePatterns.length || expenseNecessities.length) && line.kind !== 'expense') return false;
    if (expensePatterns.length && !expensePatterns.includes(line.expense_pattern ?? 'not_informed')) return false;
    if (expenseNecessities.length && !expenseNecessities.includes(line.expense_necessity ?? 'not_informed')) return false;
    if (term && !`${line.description} ${line.category ?? ''} ${line.subcategory_name ?? ''}`.toLocaleLowerCase('pt-BR').includes(term)) return false;
    return true;
  }).sort((a, b) => a.due_date.localeCompare(b.due_date)
    || a.description.localeCompare(b.description, 'pt-BR')
    || a.ref_id.localeCompare(b.ref_id));
}

/** Uma linha do extrato: o lançamento gravado ou a ocorrência que só existe na regra. */
export type ItemDoExtrato<T> = { tx: T; prevista?: undefined } | { prevista: ExpectedLedgerLine; tx?: undefined };

/**
 * Mistura as previstas nas linhas gravadas, na ordem da lista (data decrescente), cada uma no
 * dia dela (28/09/2026, decisão do dono do produto: eram um bloco à parte no topo).
 *
 * ⚠️ **No dia dela, a prevista vem ANTES das gravadas** (28/09/2026). A lista ordena o dia do
 * mais recente para o mais antigo (`created_at`), e o toque cria o lançamento AGORA: no fim do
 * dia, ela pulava para o topo ao ser tocada — *"eu só toquei nele"*. No topo, o toque não a move.
 *
 * A lista é paginada: com mais páginas por vir, só entra a prevista de um dia que a página já
 * alcançou — senão ela pararia no fim da lista e pularia de lugar quando a página seguinte chegasse.
 */
export function mesclarPrevistas<T extends { occurred_at: string }>(
  rows: readonly T[], previstas: readonly ExpectedLedgerLine[], temMais: boolean,
): ItemDoExtrato<T>[] {
  const piso = temMais && rows.length ? rows[rows.length - 1].occurred_at : null;
  const entram = previstas
    .filter((p) => piso === null || p.due_date >= piso)
    .sort((a, b) => b.due_date.localeCompare(a.due_date)
      || a.description.localeCompare(b.description, 'pt-BR')
      || a.ref_id.localeCompare(b.ref_id));
  const itens: ItemDoExtrato<T>[] = [];
  let i = 0;
  for (const tx of rows) {
    while (i < entram.length && entram[i].due_date >= tx.occurred_at) itens.push({ prevista: entram[i++] });
    itens.push({ tx });
  }
  while (i < entram.length) itens.push({ prevista: entram[i++] });
  return itens;
}

/** A pílula da prevista, na régua de `estadoDaLinha`: a data diz se ela ainda vem ou se passou. */
export function estadoDaPrevista(
  line: ExpectedLedgerLine, hoje: string,
): 'previsto' | 'atrasado' | 'não caiu' | 'estimado' | null {
  if (line.status === 'cleared') return null;
  if (line.inferred_start) return 'estimado';
  if (line.due_date >= hoje) return 'previsto';
  return line.kind === 'income' ? 'não caiu' : 'atrasado';
}

const chaveDaPrevista = (p: ExpectedLedgerLine) => `${p.origin}:${p.ref_id}:${p.due_date}`;

/**
 * As previstas que a tela desenha: as lidas do banco + as tocadas que ainda estão virando
 * lançamento (`emTransito`), menos as que já têm a linha gravada na lista.
 *
 * ⚠️ **O toque não pode abrir um buraco na lista** (28/09/2026). Gravada a ocorrência, a leitura
 * das previstas voltava ANTES da lista de lançamentos, e por ~1 s a linha não estava em nenhuma
 * das duas. A tocada fica até a lista trazê-la; a lida some quando a gravada chega — na ordem que
 * as duas consultas voltarem, a linha não some nem aparece duas vezes.
 */
export function previstasNaTela<T extends { occurred_at: string; recurring_id?: string | null }>(
  lidas: readonly ExpectedLedgerLine[], emTransito: readonly ExpectedLedgerLine[], rows: readonly T[],
): ExpectedLedgerLine[] {
  const gravadas = new Set(rows.filter((r) => r.recurring_id).map((r) => `recurring:${r.recurring_id}:${r.occurred_at}`));
  const lidasChaves = new Set(lidas.map(chaveDaPrevista));
  return [...lidas, ...emTransito.filter((p) => !lidasChaves.has(chaveDaPrevista(p)))]
    .filter((p) => !gravadas.has(chaveDaPrevista(p)));
}
