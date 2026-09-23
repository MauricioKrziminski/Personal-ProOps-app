import { addMonthsISO } from './debt-history.ts';

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
export type DestinoDoSalvar = 'criarPlano' | 'converter' | 'salvar' | 'editarCompra';

export function destinoDoSalvar(
  editing: (ComContrato & { id: string }) | null | undefined,
  values: { installments: number; account_id: string | null; valorDaCompraMudou?: boolean },
): DestinoDoSalvar {
  // Parcela cujo VALOR mudou: quem reparte é a compra (`update_installment_plan`), nunca o
  // `update` de uma linha — é a regra de parcela travada que mora lá.
  if (editing?.installment_plan_id && values.valorDaCompraMudou) return 'editarCompra';
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
/**
 * O que o número digitado numa compra parcelada SIGNIFICA — o total ou cada parcela.
 *
 * ⚠️ **Era só o total, e a trava que isso exigia virou o defeito** (23/09/2026). O campo do
 * lançamento mostrava a PARCELA e só aceitava o TOTAL; para não gravar 300 como total de uma
 * compra de 3.000, ele ficou `readOnly` numa parcela — *"eu tento clicar e o campo parece ser
 * desabilitado… tinha que ter a opção de colocar o valor de cada parcela"*. A ambiguidade some
 * quando a pessoa DIZ o que o número é.
 */
export type UnidadeDoValor = 'total' | 'parcela';

/** A mesma ordem nos três lugares (criar, editar a parcela, editar a compra). */
export const UNIDADES_DO_VALOR = [
  { value: 'parcela', label: 'Cada parcela' },
  { value: 'total', label: 'Total da compra' },
] as const satisfies readonly { value: UnidadeDoValor; label: string }[];

/** Cada parcela em aberto precisa de um centavo — a recusa da RPC, dita antes dela. */
export function recusaDoValor(travadas: number): string {
  return travadas > 0
    ? 'O total precisa cobrir o que já foi pago e sobrar para as parcelas em aberto'
    : 'Informe o valor';
}

/** Criando ou convertendo em N×: nada foi pago ainda, "parcela" é cada uma das N. */
export function totalDigitado(valorCents: number, unidade: UnidadeDoValor, parcelas: number): number {
  return unidade === 'parcela' && parcelas > 1 ? valorCents * parcelas : valorCents;
}

/** Uma compra que já existe, do jeito que `update_installment_plan` a enxerga. */
export interface Contrato {
  parcelas: number;
  /** As que não mudam mais (`private.parcela_travada`) e quanto somam. */
  travadas: number;
  travadoCents: number;
}

/** Quantas parcelas o valor "por parcela" alcança: só as em aberto. */
export function parcelasAbertas(c: Contrato): number {
  return Math.max(0, c.parcelas - c.travadas);
}

/**
 * O total da compra quando o número é o de CADA parcela em aberto — a mesma conta do agente
 * (`_perguntar_unidade`): as travadas ficam como estão, as abertas passam a valer `parcela`.
 */
export function totalPorParcela(parcelaCents: number, c: Contrato): number {
  return c.travadoCents + parcelaCents * parcelasAbertas(c);
}

/** A parcela em aberto que um total produz. A RPC põe o resto na última — aqui é a típica. */
export function parcelaDoTotal(totalCents: number, c: Contrato): number {
  const n = parcelasAbertas(c);
  return n > 0 ? Math.floor(Math.max(0, totalCents - c.travadoCents) / n) : 0;
}

/**
 * O valor da compra enquanto se edita, e o que o campo mostra em cada unidade.
 *
 * ⚠️ **O total é a verdade; a parcela digitada é guardada à parte.** Converter ida e volta pela
 * divisão perderia centavo — 1000 em 3 vira 333, que volta 999 —, e trocar a unidade sem digitar
 * nada gravaria uma compra diferente. Trocar a régua não mexe no dinheiro.
 */
export interface ValorDaCompra {
  totalCents: number;
  /** O que a pessoa digitou em "cada parcela", ou `null` se o último número foi o total. */
  parcelaCents: number | null;
}

export function valorExibido(
  v: ValorDaCompra,
  unidade: UnidadeDoValor,
  c: Contrato,
  /** A parcela em aberto de hoje — o que "cada parcela" mostra antes de qualquer edição. */
  parcelaAtual: number,
  totalOriginal: number,
): number {
  if (unidade === 'total') return v.totalCents;
  if (v.parcelaCents !== null) return v.parcelaCents;
  return v.totalCents === totalOriginal ? parcelaAtual : parcelaDoTotal(v.totalCents, c);
}

export function digitarValor(valorCents: number, unidade: UnidadeDoValor, c: Contrato): ValorDaCompra {
  return unidade === 'total'
    ? { totalCents: valorCents, parcelaCents: null }
    : { totalCents: totalPorParcela(valorCents, c), parcelaCents: valorCents };
}

/** Tira o "(k/N)" que a RPC põe no nome de cada parcela — o nome da COMPRA não tem. */
export function nomeDaCompra(tituloDaParcela: string): string {
  return tituloDaParcela.replace(/\s*\(\d+\/\d+\)\s*$/, '').trim();
}

export const MAX_PARCELAS = 72;
export function faixaDeParcelas(travadas: number): { min: number; max: number } {
  return { min: travadas > 0 ? 2 : 1, max: MAX_PARCELAS };
}

// ── financiamento maleável (23/09/2026) ────────────────────────────────────

/**
 * Parcela fixa a partir do TOTAL A PAGAR (decisão do dono do produto, 23/09/2026: "total" é a
 * soma das parcelas, com os juros dentro). O `check` de parcela fixa exige `total = parcela × N`
 * em centavos inteiros, então a parcela arredonda e o total GRAVADO é `parcela × N` — a tela
 * mostra esse, não o digitado.
 */
export function parcelaDoTotalDoContrato(totalCents: number, n: number): number {
  if (!Number.isInteger(n) || n <= 0 || totalCents <= 0) return 0;
  return Math.round(totalCents / n);
}

/** A data da parcela nº 1 do contrato, dada a próxima em aberto (`pagas + 1`). */
export function ancoraDoContrato(proximaISO: string, pagas: number): string {
  return addMonthsISO(proximaISO, -pagas);
}

/**
 * A data da parcela `pagas + 1`, no dia de vencimento do contrato (clampado no mês curto) — a
 * MESMA conta de `private.debt_schedule_for`: `day_in_month(add_months(first_due_date, pagas),
 * due_day)`. O dia vem à parte porque a âncora pode estar clampada (31/03 com 1 paga ancora em
 * 28/02), e o 31 tem que voltar em março.
 */
export function proximaDoContrato(ancoraISO: string, pagas: number, dia: number): string {
  const mes = addMonthsISO(`${ancoraISO.slice(0, 7)}-01`, pagas);
  const [y, m] = mes.split('-').map(Number);
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${mes.slice(0, 7)}-${String(Math.min(dia, ultimo)).padStart(2, '0')}`;
}
