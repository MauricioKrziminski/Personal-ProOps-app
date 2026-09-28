/**
 * O ritmo do dia: quanto saiu HOJE contra o que a pessoa vinha gastando por dia neste ciclo.
 *
 * Um valor sozinho ("saiu R$ 210 hoje") não muda decisão nenhuma — R$ 210 é muito ou pouco? O
 * que muda é a COMPARAÇÃO com o próprio ritmo dela.
 */

export type Ritmo = {
  hoje: number;
  /** A média por dia dos dias ANTERIORES do ciclo; `null` quando ainda não há com o que comparar. */
  media: number | null;
  acima: boolean;
};

/**
 * ⚠️ **A média exclui HOJE, e isso não é detalhe.** Incluindo o dia corrente, um gasto grande
 * levanta a própria média contra a qual ele seria medido — quanto maior o estouro, mais normal
 * ele pareceria. A comparação honesta é contra os dias que já fecharam.
 *
 * `diasDecorridos` conta hoje (primeiro dia do ciclo = 1), então não há dia anterior nenhum
 * enquanto ele for 1: ali a função devolve `media: null` e a tela mostra só o valor.
 */
export function ritmoDoDia({
  hojeCents,
  cicloCents,
  diasDecorridos,
}: {
  hojeCents: number;
  cicloCents: number;
  diasDecorridos: number;
}): Ritmo {
  const anteriores = diasDecorridos - 1;
  if (anteriores < 1) return { hoje: hojeCents, media: null, acima: false };

  // O ciclo inclui hoje; tirá-lo é o que deixa a régua independente do dia corrente.
  const media = Math.max(0, Math.round((cicloCents - hojeCents) / anteriores));
  return { hoje: hojeCents, media, acima: hojeCents > media };
}

/** Quantos dias do ciclo já passaram, contando hoje. Datas em ISO (`YYYY-MM-DD`). */
export function diasDoCiclo(de: string, hoje: string): number {
  const ms = Date.parse(`${hoje}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`);
  return Math.max(1, Math.floor(ms / 86_400_000) + 1);
}

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
