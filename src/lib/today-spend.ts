/**
 * O dinheiro na escala do DIA, para a Hoje e os widgets.
 *
 * ⚠️ O "ritmo" (o gasto de hoje contra a média do ciclo, em texto) saiu em 28/09/2026: a semana
 * da Hoje mostra o gasto de cada dia contra a régua do "por dia", que é a comparação que decide
 * alguma coisa — a média do que já passou não diz quanto ainda cabe.
 */

/**
 * Quanto do livre cabe em cada dia até a próxima entrada — a ÚNICA conta de "por dia" do app.
 *
 * O card do dinheiro da Hoje e o veredito dos widgets (`vereditoDoDia`) dividem por aqui: duas
 * divisões iguais em dois lugares são duas regras que um dia arredondam diferente, e a pessoa vê
 * dois "por dia" no mesmo dia. Livre zerado ou negativo não tem "por dia".
 */
export function porDiaLivre(livreCents: number, diasLivres: number): number {
  return livreCents > 0 ? Math.floor(livreCents / Math.max(1, diasLivres)) : 0;
}

/** Abaixo disto o "por dia" é um número ridículo no lugar mais nobre do card: vale o total. */
export const POR_DIA_MINIMO = 100;

export type PainelDoDia = {
  /** `porDia`: a manchete é quanto cabe por dia. `total`: é o livre inteiro. */
  modo: 'porDia' | 'total';
  rotulo: string;
  cents: number;
  negativo: boolean;
  /** A linha de baixo, já com o dinheiro formatado por quem obedece ao "esconder saldo". */
  legenda: string;
};

/**
 * O card do dinheiro da Hoje: dinheiro na escala do DIA (28/09/2026).
 *
 * O herói antigo escrevia o livre TOTAL, e sem receita prevista ele era exatamente o resultado do
 * ciclo — o mesmo número do herói do Financeiro, na mesma tinta. Aqui a manchete é o "por dia" e
 * o total vira contexto na legenda. Quando o "por dia" não informa (livre ≤ 0, menos de R$ 1 por
 * dia, ou UM dia só — aí "por dia" e o total são o mesmo número, dito duas vezes), a manchete
 * volta a ser o total: é ele que a pessoa precisa ver.
 */
export function painelDoDia(v: {
  livreCents: number;
  /** `null` quando não se sabe até quando (sem ciclo e sem próxima entrada): aí não há "por dia". */
  diasLivres: number | null;
  /** Até quando o livre vale (a próxima entrada, ou o fim do ciclo). */
  ate: string | null;
  /** A próxima entrada de dinheiro, quando existe. */
  entrada: string | null;
  brl: (cents: number) => string;
}): PainelDoDia {
  const ddmm = v.ate ? `${v.ate.slice(8, 10)}/${v.ate.slice(5, 7)}` : null;
  const porDia = v.diasLivres === null ? 0 : porDiaLivre(v.livreCents, v.diasLivres);
  if (v.diasLivres !== null && v.diasLivres > 1 && porDia >= POR_DIA_MINIMO) {
    return {
      modo: 'porDia',
      rotulo: 'Dá para gastar por dia',
      cents: porDia,
      negativo: false,
      legenda: ddmm ? `${v.brl(v.livreCents)} livre até ${ddmm}` : `${v.brl(v.livreCents)} livre`,
    };
  }
  const dias = v.diasLivres === null ? null : `${v.diasLivres} ${v.diasLivres === 1 ? 'dia' : 'dias'}`;
  const entra = v.entrada ? `entra dinheiro ${v.entrada.slice(8, 10)}/${v.entrada.slice(5, 7)}` : null;
  return {
    modo: 'total',
    rotulo: ddmm ? `Livre até ${ddmm}` : 'Livre',
    cents: v.livreCents,
    negativo: v.livreCents < 0,
    legenda: [dias, entra].filter(Boolean).join(' · '),
  };
}
