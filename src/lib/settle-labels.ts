/**
 * O vocabulário de um lançamento PREVISTO, derivado do que ele é.
 *
 * Quatro telas decidiam isso sozinhas a partir de `status === 'pending'` e mais
 * nada — então uma receita recorrente materializada para o mês que vem ganhava
 * o botão **"Paguei"**, como se salário fosse dívida. Ninguém paga um salário
 * que vai receber.
 *
 * A regra do projeto é a de `frontend.md`: a decisão mora no primitivo, a tela
 * declara o quê. Quatro cópias da mesma condição são quatro coisas que divergem,
 * e foi exatamente assim que três delas erraram junto.
 *
 * `transfer` não aparece como previsto no fluxo normal (transferência é
 * imediata), mas se aparecer o rótulo neutro é o certo — "Paguei" uma
 * transferência entre contas próprias não quer dizer nada.
 */

export type SettleKind = 'income' | 'expense' | 'transfer';

/** O botão que dá baixa. "Recebi" para receita, "Paguei" para o resto. */
export function settleLabel(kind: SettleKind | string | null | undefined): string {
  return kind === 'income' ? 'Recebi' : kind === 'transfer' ? 'Concluí' : 'Paguei';
}

/** O rótulo acessível da ação, com o item nomeado. */
export function settleAccessibilityLabel(
  kind: SettleKind | string | null | undefined,
  item: string,
): string {
  return `${settleLabel(kind)}: ${item}`;
}

/** A data de um previsto. Receita não "vence" — ela é esperada. */
export function dueLabel(
  kind: SettleKind | string | null | undefined,
  dateBR: string | null | undefined,
): string {
  if (!dateBR) {
    return kind === 'income' ? 'Sem data prevista' : 'Sem data de vencimento';
  }
  return kind === 'income' ? `Previsto para ${dateBR}` : `Vence em ${dateBR}`;
}

/** A mesma data em linha de lista, minúscula e curta. */
export function dueInline(
  kind: SettleKind | string | null | undefined,
  dateBR: string | null | undefined,
): string {
  if (!dateBR) return 'previsto';
  return kind === 'income' ? `previsto · chega ${dateBR}` : `previsto · vence ${dateBR}`;
}

/** A dica de "o que fazer com isto", que também falava só de pagar. */
export function settleHint(kind: SettleKind | string | null | undefined): string {
  return kind === 'income'
    ? 'Marque quando receber para sair da projeção'
    : 'Marque quando pagar para sair da projeção';
}
