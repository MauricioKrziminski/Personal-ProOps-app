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

/**
 * Em lançamento de CARTÃO, `due_at` é o vencimento da FATURA, não do lançamento.
 * O DAS é comprado dia 20 e a fatura vence dia 10 do mês seguinte — escrever
 * "vence 10/09" numa linha de 20/08 é dizer a data errada com todas as letras,
 * e foi a queixa de 09/09/2026. São 69 linhas em produção com essa forma.
 *
 * A data continua sendo a mesma; o que muda é o de QUEM ela é.
 */
export type DueOpts = { onCard?: boolean };

/** A data de um previsto. Receita não "vence" — ela é esperada. */
export function dueLabel(
  kind: SettleKind | string | null | undefined,
  dateBR: string | null | undefined,
  opts: DueOpts = {},
): string {
  if (opts.onCard) {
    return dateBR ? `Entra na fatura de ${dateBR}` : 'Entra na próxima fatura';
  }
  if (!dateBR) {
    return kind === 'income' ? 'Sem data prevista' : 'Sem data de vencimento';
  }
  return kind === 'income' ? `Previsto para ${dateBR}` : `Vence em ${dateBR}`;
}

/** A mesma data em linha de lista, minúscula e curta. */
export function dueInline(
  kind: SettleKind | string | null | undefined,
  dateBR: string | null | undefined,
  opts: DueOpts = {},
): string {
  if (opts.onCard) return dateBR ? `na fatura de ${dateBR}` : 'na próxima fatura';
  if (!dateBR) return 'previsto';
  return kind === 'income' ? `previsto · chega ${dateBR}` : `previsto · vence ${dateBR}`;
}

/** A dica de "o que fazer com isto", que também falava só de pagar. */
export function settleHint(
  kind: SettleKind | string | null | undefined,
  opts: DueOpts = {},
): string {
  // No cartão a projeção conta a FATURA, nunca a linha: dar baixa aqui só marca
  // esta compra como já conferida, não tira nada do caixa.
  if (opts.onCard) return 'Sai do caixa quando a fatura for paga';
  return kind === 'income'
    ? 'Marque quando receber para sair da projeção'
    : 'Marque quando pagar para sair da projeção';
}

/**
 * O rótulo da data de um previsto no FORMULÁRIO. Receita não "vence" — ela é esperada,
 * e "conta a pagar" é a frase errada em cima de um Pix que você vai receber.
 */
export function dueFieldLabel(kind: SettleKind | string | null | undefined): string {
  return kind === 'income' ? 'Previsto para' : 'Vence em';
}

export function dueFieldHint(kind: SettleKind | string | null | undefined): string {
  return kind === 'income'
    ? 'Conta na projeção, mas fica fora do saldo até você confirmar que caiu.'
    : 'Fica como conta a pagar até você confirmar que pagou.';
}

/**
 * O interruptor de "entra sozinho na data" — `transactions.auto_confirm` (`20260909110000`).
 *
 * O padrão INVERTE entre os dois lados, e é isso que o dono do produto pediu: despesa
 * recorrente é boleto que você sabe que sai; receita de terceiro é Pix que pode não chegar,
 * e "precisa de comprovação". Salário é o caso em que ligar faz sentido.
 */
export function autoConfirmLabel(kind: SettleKind | string | null | undefined): string {
  return kind === 'income' ? 'Entrar como recebido na data' : 'Entrar como pago na data';
}

export function autoConfirmHint(
  kind: SettleKind | string | null | undefined,
  ligado: boolean,
): string {
  if (kind === 'income') {
    return ligado
      ? 'Entra no saldo sozinho na data — serve para salário, que cai sem falta.'
      : 'Fica esperando você confirmar que o dinheiro caiu. É o certo para Pix de terceiro.';
  }
  return ligado
    ? 'O lançamento já entra como pago na data.'
    : 'Fica esperando você dizer que pagou.';
}
