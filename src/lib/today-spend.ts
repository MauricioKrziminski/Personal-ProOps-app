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
