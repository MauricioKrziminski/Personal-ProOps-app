/**
 * A gramática da tela de Mês — só decisão de texto e de ordem, nada de soma.
 *
 * A tela existe porque o app organiza dinheiro por OBJETO (dívida, cartão, recorrente,
 * lançamento) e nenhuma tela respondia "como foi setembro". Os quatro blocos e os cortes de
 * saída vêm prontos de `month_lines` / `month_summary` / `month_breakdown`: aqui mora só o que
 * é linguagem, e por isso é testável sem banco.
 */

import { formatBRL, isoToBR } from './dates.ts';

export type Bucket = 'entrada' | 'fixa' | 'parcela' | 'variavel';
export type GroupBy = 'natureza' | 'meio' | 'categoria';

/** A ordem da planilha: o que entra, o que já estava comprometido, o que foi escolha do mês. */
export const BUCKETS: readonly Bucket[] = ['entrada', 'fixa', 'parcela', 'variavel'];

const TITULOS: Record<Bucket, string> = {
  entrada: 'Entradas',
  fixa: 'Contas fixas',
  parcela: 'Parcelas e financiamentos',
  variavel: 'Gastos do mês',
};

export function bucketTitle(bucket: Bucket): string {
  return TITULOS[bucket];
}

/** O mesmo nome no singular, para o corte por natureza. */
const NATUREZA: Record<string, string> = {
  fixa: 'Contas fixas',
  parcela: 'Parcelas e financiamentos',
  variavel: 'Gastos do mês',
  entrada: 'Entradas',
};

/**
 * O rótulo de uma fatia. `natureza` chega como a chave crua do SQL de propósito: o pt-BR mora
 * aqui, num mapa só, em vez de dividido entre uma migration e uma tela.
 */
export function groupLabel(groupBy: GroupBy, key: string, label: string): string {
  return groupBy === 'natureza' ? (NATUREZA[key] ?? label) : label;
}

export const GROUP_OPTIONS = [
  // Natureza primeiro porque é a leitura mais forte: quanto do mês já estava comprometido
  // antes de qualquer escolha.
  { value: 'natureza', label: 'Tipo' },
  { value: 'meio', label: 'Meio' },
  { value: 'categoria', label: 'Categoria' },
] as const satisfies readonly { value: GroupBy; label: string }[];

/** Pontos-base inteiros → percentual inteiro. Dinheiro não vira float em lugar nenhum. */
export function sharePercent(shareBp: number): number {
  return Math.round((shareBp ?? 0) / 100);
}

export interface LineLike {
  invoice_id?: string | null;
  invoice_due?: string | null;
  installment_no: number | null;
  installments_total: number | null;
  due_day: number | null;
  method_label: string | null;
  category: string | null;
}

/**
 * A linha secundária: `parcela 9 de 48 · dia 23 · Itaú`.
 *
 * Cada pedaço some sozinho quando não existe — parcela avulsa não tem `9 de 48`, lançamento do
 * WhatsApp pode não ter conta. Nunca sobra um `·` solto.
 */
export function lineSubtitle(line: LineLike, { comCategoria = false } = {}): string {
  const partes: string[] = [];
  if (line.installment_no && line.installments_total) {
    partes.push(`parcela ${line.installment_no} de ${line.installments_total}`);
  }
  if (line.due_day) partes.push(`dia ${line.due_day}`);
  if (line.method_label) partes.push(line.method_label);
  if (comCategoria && line.category) partes.push(line.category);
  /*
    ⚠️ **A ponte entre as duas réguas, e ela é uma frase.**

    Esta tela é COMPETÊNCIA: a compra conta no dia em que foi feita. O dinheiro dela, porém, só
    sai quando a fatura vence — e com fechamento no dia 3 e ciclo fechando no 10, TODA compra
    feita entre os dias 4 e 10 é contada num ciclo e paga no seguinte. Não é defeito, é a
    distância entre gastar e pagar; o que era defeito é a pessoa não conseguir VER isso.

    Era a dúvida literal do dono do produto (*"ele mostra essa minha compra por mais que meu
    ciclo está do dia 11 até 10?"*), e a resposta certa não era remanejar número nenhum — era
    dizer, na própria linha, para qual fatura ela vai.
  */
  if (line.invoice_due) partes.push(`cai na fatura de ${isoToBR(line.invoice_due)}`);
  return partes.join(' · ');
}

/**
 * Qual número o herói mostra, e como ele se chama.
 *
 * O dono do produto pediu DOIS números: o caixa real e o resultado do mês da planilha. O caixa é
 * o destaque — mas ele **não existe** para um mês inteiramente futuro: caixa se apura de linha
 * paga, não se projeta (para projetar existe a tela de Projeção). Num mês futuro o destaque passa
 * a ser o resultado, e o rótulo diz isso com todas as letras em vez de apresentar uma projeção
 * como se fosse saldo.
 *
 * Nos dois casos o outro número aparece logo abaixo, na seção "A conta do mês".
 */
export function heroFigure(
  { closingCashCents, resultCents }: { closingCashCents: number | null; resultCents: number },
  month: string,
  hoje: string,
  nomeDoMes: string,
): { label: string; cents: number; isCash: boolean } {
  if (closingCashCents === null) {
    return { label: `Resultado previsto de ${nomeDoMes}`, cents: resultCents, isCash: false };
  }
  return { label: cashLabel(month, hoje, nomeDoMes), cents: closingCashCents, isCash: true };
}

/**
 * Passado, presente e futuro pedem verbos diferentes para o MESMO número de caixa.
 *
 * `nomeDoMes` chega pronto (o `monthTitle` mora no `month-picker`, que importa React Native):
 * este arquivo é testado por `node --test` e por isso não depende de nada além de `dates`.
 */
export function cashLabel(month: string, hoje: string, nomeDoMes: string): string {
  if (month < hoje) return `Terminei ${nomeDoMes} com`;
  if (month === hoje) return 'Tenho hoje';
  return 'Devo terminar com';
}

/**
 * O aviso do precipício: recorrentes são materializadas 90 dias à frente e o cron **nunca** faz
 * backfill, enquanto o cronograma de financiamento não tem horizonte. Sem esta frase, o mês +4
 * mostra a parcela do carro e zero contas fixas — e o resultado daquele mês fica lindo e falso.
 */
export function horizonWarning(nomeDoMesCoberto: string | null): string {
  return nomeDoMesCoberto
    ? `As contas fixas estão geradas só até ${nomeDoMesCoberto}. Daqui para frente aparece só o que já está comprometido.`
    : 'Nenhuma conta fixa foi gerada ainda. Aparece só o que já está comprometido.';
}

/** O aviso das parcelas declaradas sem lançamento — só faz sentido olhando para trás. */
export function undocumentedWarning(n: number): string {
  return n === 1
    ? 'Uma parcela de financiamento você declarou como paga sem registrar o lançamento. Ela não entra neste total.'
    : `${n} parcelas de financiamento você declarou como pagas sem registrar o lançamento. Elas não entram neste total.`;
}

/**
 * A frase que explica por que "comecei + resultado" não dá "terminei".
 *
 * O resultado é COMPETÊNCIA (a compra conta no dia em que foi feita, como na planilha) e o caixa
 * é CAIXA (a compra no cartão sai no vencimento da fatura). A diferença não é defeito: é a
 * resposta a duas perguntas diferentes, e esconder isso é o que faz o usuário achar que a conta
 * não fecha.
 */
export function gapExplanation(openingCents: number, resultCents: number, closingCents: number): string | null {
  const diferenca = closingCents - (openingCents + resultCents);
  if (diferenca === 0) return null;
  return `São ${formatBRL(Math.abs(diferenca))} de diferença: o resultado conta tudo que aconteceu no mês, pago ou não, e o caixa conta só o dinheiro que já passou pela conta.`;
}
