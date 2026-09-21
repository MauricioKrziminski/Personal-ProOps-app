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

/**
 * O que o toast responde depois da baixa — o PARTICÍPIO do mesmo verbo do botão.
 *
 * As cinco telas respondiam cada uma de um jeito ("marcado como pago", "baixado", "Dei baixa
 * no lançamento"), e nenhum deles era o verbo que a pessoa tinha acabado de apertar. Pior:
 * "dar baixa" é jargão de contas a pagar e "baixado" ainda lê como download. Quem apertou
 * "Recebi" não recebe "marcado como pago" — um salário não é pago por você.
 */
export function settleDone(kind: SettleKind | string | null | undefined): string {
  return kind === 'income' ? 'recebido' : kind === 'transfer' ? 'concluído' : 'pago';
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

/**
 * O que falta num bucket do Mês. Entrada não "falta pagar" — ela falta RECEBER, e escrever
 * o verbo errado ali era o mesmo defeito que criou este arquivo. Cravado em `month.tsx` até
 * `income_unsettled_cents` existir (`20260909130000`); antes disso a entrada era zero e o
 * texto nunca aparecia, o que escondia o erro.
 */
export function unsettledLabel(bucket: string): string {
  return bucket === 'entrada' ? 'falta receber' : 'falta pagar';
}

/**
 * O interruptor "isto já se efetivou?" no formulário. Era "Já aconteceu | Ainda vai acontecer",
 * e tempo é a régua errada para `transactions.status`: a compra de cartão de ontem aconteceu e
 * continua `pending`. O que a coluna responde é se o dinheiro se MEXEU — e o verbo depende do
 * lado, como em todo o resto deste arquivo.
 */
export function caixaLabels(kind: SettleKind | string | null | undefined): {
  feito: string;
  aFazer: string;
} {
  if (kind === 'income') return { feito: 'Já caiu', aFazer: 'Ainda vai cair' };
  if (kind === 'transfer') return { feito: 'Já foi', aFazer: 'Ainda vai ser' };
  return { feito: 'Já saiu do caixa', aFazer: 'Ainda vai sair' };
}

/**
 * O estado de uma linha de lançamento — a pílula que o `Row` desenha.
 *
 * ⚠️ **O corte é a DATA, nunca o `status`.** A régua é a de `finance.md` e já estava escrita em
 * `finance/invoice/[id].tsx`: compra de cartão fica `pending` até a FATURA ser paga, então usar
 * o status chama de "previsto" a compra que a pessoa fez semana passada. A queixa foi literal
 * (19/09/2026): *"veio com a tag previsto se hoje é 19 de setembro e ali está dia 15 e 14"*.
 *
 * Três estados, e cada um responde uma coisa diferente:
 *
 * | estado | quando | o que ele diz |
 * |---|---|---|
 * | `null` | efetivado, **ou** compra de cartão que já aconteceu | nada a decidir. No cartão o subtítulo já escreve "na fatura de DD/MM", que é a informação que sobra |
 * | `previsto` | ainda vai acontecer | conta na projeção, não no saldo |
 * | `atrasado` | DESPESA que passou da data | é o que pede ação |
 * | `não caiu` | RECEITA que passou da data | ninguém "deve" um salário — e é a palavra que
 *   `finance.md` já usa para a receita prevista que some do número e fica na tela |
 *
 * ⚠️ **No cartão quem decide é `occurred_at`, e nunca `due_at`.** Ali o `due_at` é o vencimento da
 * FATURA (o trigger `set_invoice` é dono da coluna): a compra de 15/09 tem `due_at` 10/10, e
 * olhar para ele faria toda compra do mês parecer futura. Fora do cartão é o contrário —
 * `due_at` É o vencimento daquela conta, e é ele que decide.
 *
 * ⚠️ **Isto NÃO substitui o `status` na ação de dar baixa.** "Paguei"/"Recebi" continua
 * aparecendo para toda linha `pending`, inclusive a compra de cartão que já aconteceu: o dinheiro
 * ainda não saiu, e dar baixa nela continua sendo uma coisa que existe.
 */
export type EstadoDaLinha = 'previsto' | 'atrasado' | 'não caiu' | null;

export function estadoDaLinha(
  tx: {
    kind: string;
    status: string;
    occurred_at: string;
    due_at: string | null;
    invoice_id: string | null;
  },
  hoje: string,
): EstadoDaLinha {
  if (tx.status !== 'pending') return null;
  // Datas ISO (`YYYY-MM-DD`) comparam como string — é como o resto do app já compara.
  if (tx.invoice_id) return tx.occurred_at > hoje ? 'previsto' : null;
  const quando = tx.due_at ?? tx.occurred_at;
  if (quando >= hoje) return 'previsto';
  // ⚠️ Receita não ATRASA — ela não CAIU. Ninguém "deve" um salário, e este arquivo nasceu
  // justamente de quatro telas escrevendo "Paguei" em cima de uma receita.
  return tx.kind === 'income' ? 'não caiu' : 'atrasado';
}
