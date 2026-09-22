/** The UI asks for installments remaining; the database stores the original total. */
export function debtTerm(remaining: string, paid: number): number | null {
  if (!Number.isInteger(paid) || paid < 0) throw new Error('Informe parcelas pagas inteiras e não negativas');
  if (!remaining.trim()) return null;
  const count = Number(remaining);
  if (!Number.isInteger(count) || count <= 0) throw new Error('Informe parcelas restantes positivas');
  return count + paid;
}

export function validRecurringRange(start: string, end: string, interval: string): boolean {
  const count = Number(interval);
  return (!end || end >= start) && Number.isInteger(count) && count >= 1 && count <= 99;
}

/** Show intentional database domain errors, while keeping infrastructure failures generic. */
export function financeErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'code' in error && error.code === 'P0001' && 'message' in error && typeof error.message === 'string') return error.message;
  return fallback;
}

/** Backdating is not proof of payment; blank history is only safe for a new plan. */
export function installmentHistory(text: string, total: number, firstDate: string, today: string): number {
  if (!text.trim()) {
    if (firstDate < today) throw new Error('Informe quantas parcelas iniciais já foram pagas, inclusive zero');
    return 0;
  }
  const paid = Number(text);
  if (!/^\d+$/.test(text.trim()) || !Number.isInteger(paid) || paid < 0 || paid > total) {
    throw new Error(`Informe parcelas pagas entre 0 e ${total}`);
  }
  return paid;
}

/** Contractual installments include charges; no interest breakdown is inferred. */
export function simpleDebtValues(installmentCents: number, totalText: string, paid = 0) {
  const total = Number(totalText);
  if (!/^\d+$/.test(totalText) || !Number.isSafeInteger(total) || total < 1 || total > 999 ||
      !Number.isSafeInteger(installmentCents) || installmentCents <= 0 ||
      !Number.isInteger(paid) || paid < 0 || paid > total ||
      !Number.isSafeInteger(installmentCents * total)) {
    throw new Error('Informe um valor de parcela e uma quantidade válidos.');
  }
  return {
    calculation_mode: 'fixed_installments' as const,
    principal_cents: installmentCents * total,
    remaining_cents: installmentCents * (total - paid),
    installments: total,
    installments_paid: paid,
    installment_cents: installmentCents,
    interest_rate_monthly: 0,
  };
}

/** O que já pertence a OUTRO contrato — e por isso não se parcela pelo formulário da linha. */
type ComContrato = {
  installment_plan_id?: string | null;
  recurring_id?: string | null;
  debt_id?: string | null;
  rollover_of_invoice_id?: string | null;
};

/**
 * Um lançamento que já é parcela, ocorrência de recorrência, parcela de financiamento ou o
 * principal de um saldo adiado de fatura.
 *
 * Nos quatro casos a divisão do dinheiro é de outro dono: a COMPRA (editável em
 * `/finance/installments`), a REGRA da série, o CRONOGRAMA da dívida, e o ADIAMENTO
 * (`roll_invoice`). O quarto não tem RPC de conversão: `rollover_of_invoice_id` não seria
 * copiado para as parcelas 2..N, e o principal — já contado quando as compras foram feitas —
 * voltaria como despesa NOVA em N−1 meses. As quatro recusas também existem no banco — aqui
 * elas evitam mostrar um botão que vai dar erro.
 */
export function temContrato(editing?: ComContrato | null): boolean {
  return Boolean(
    editing?.installment_plan_id || editing?.recurring_id || editing?.debt_id || editing?.rollover_of_invoice_id,
  );
}

/**
 * A fileira "Parcelas" aparece?
 *
 * ⚠️ **Vale para CRIAR e para EDITAR, e a falta disso custou uma compra duplicada.** Até
 * 19/09/2026 a condição terminava em `&& !editing`: parcelar um lançamento que já existia não
 * era possível, e o jeito de contornar era lançar de novo — a queixa foi literal, *"não consigo
 * editar o lançamento criado sem parcelar, colocando a parcela"*, e logo depois *"quando eu
 * consegui editar, ele duplicou"*.
 */
export function podeParcelar(
  kind: string,
  accountId: string | null | undefined,
  editing?: ComContrato | null,
): boolean {
  return kind === 'expense' && Boolean(accountId) && !temContrato(editing);
}

/**
 * Para onde o "Salvar" vai — e é sempre UM lugar só.
 *
 * ⚠️ **A exclusividade é o ponto.** O modo de falha desta tela não é erro na tela: é duas
 * escritas para uma intenção, que na fatura vira a mesma compra duas vezes. Por isso a decisão
 * é um valor, e não três `if` espalhados no `onSubmit`.
 *
 * `converter` chama uma RPC que ADOTA a linha existente como parcela 1 — o `id` não muda, e
 * chamar de novo é recusa, nunca um segundo plano.
 */
export type DestinoDoSalvar = 'criarPlano' | 'converter' | 'salvar';

export function destinoDoSalvar(
  editing: (ComContrato & { id: string }) | null | undefined,
  values: { installments: number; account_id: string | null },
): DestinoDoSalvar {
  if (values.installments <= 1 || !values.account_id) return 'salvar';
  if (!editing) return 'criarPlano';
  // Cinto: a fileira nem aparece para quem já tem contrato, mas converter uma parcela criaria
  // plano dentro de plano.
  return temContrato(editing) ? 'salvar' : 'converter';
}

/**
 * A faixa do número de parcelas — campo ABERTO, nunca uma lista fixa.
 *
 * ⚠️ **Era uma lista (1, 2, 3, 4, 6, 10, 12, 18, 24)**, e não havia como lançar uma compra em
 * 5x, 7x ou 8x. O dono do produto (22/09/2026): *"essas coisas assim nunca devem ser fixadas,
 * deve ser totalmente aberta"*. O teto é o do banco (`installment_plans`: 2..72).
 *
 * ⚠️ **`1` é "À vista", e no editor da compra ele DISSOLVE o plano** — a parcela 1 sobrevive com
 * o total, as outras somem. **Com qualquer parcela travada o mínimo vira 2**, porque a RPC recusa
 * (`1 <> N` cai no guarda que já protege o número de parcelas). Número que só existe para dar
 * erro é defeito.
 */
export const MAX_PARCELAS = 72;
export function faixaDeParcelas(travadas: number): { min: number; max: number } {
  return { min: travadas > 0 ? 2 : 1, max: MAX_PARCELAS };
}
