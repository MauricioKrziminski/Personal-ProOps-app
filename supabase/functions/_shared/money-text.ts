/**
 * Extração de valor em dinheiro a partir do texto cru da mensagem.
 *
 * Rede de segurança para quando o modelo devolve a ação certa SEM o valor —
 * acontece de verdade: "coloca 200 na meta da viagem" volta como `goal_deposit`
 * com `content: "viagem"` e sem `amount_cents`, com confiança 1.0. Escalar para
 * um modelo maior resolveria, mas ele tem 20 requisições/dia no nível gratuito;
 * um parser determinístico não depende de cota nem de humor do modelo.
 *
 * Regra deliberadamente CONSERVADORA: só devolve valor quando o texto tem
 * **exatamente um** número plausível. "parcelei 3600 em 12x" tem dois, então
 * devolve null e o executor pede para o usuário reformular — chutar qual dos
 * dois é o dinheiro seria pior que perguntar.
 *
 * TS puro, sem nada de Deno, para `node --test` conseguir importar.
 */

/** Números que claramente não são dinheiro no contexto de uma mensagem. */
const RUIDO = [
  /\b\d{1,2}\s*x\b/gi, // "12x", "3 x" — parcelas
  /\bdia\s+\d{1,2}\b/gi, // "dia 5" — recorrência
  /\b\d{1,2}[/:]\d{1,2}(?:[/:]\d{2,4})?\b/g, // 05/09, 14:30
  /\b\d{1,2}h(?:\d{2})?\b/gi, // 8h, 8h30
  /\b\d{1,2}%\b/g, // 20%
];

/**
 * "1.234,56" | "1234.56" | "45" | "2 mil" | "1,5 mil" -> centavos inteiros.
 * Devolve null se não houver exatamente um candidato.
 */
export function parseValorEmCentavos(texto: string | null | undefined): number | null {
  if (!texto) return null;

  // tira o que sabidamente não é dinheiro antes de contar candidatos
  let limpo = ` ${texto} `;
  for (const padrao of RUIDO) limpo = limpo.replace(padrao, " ");

  // "2 mil", "1,5 mil", "3 milhões"
  const multiplicadores: { re: RegExp; fator: number }[] = [
    { re: /(\d+(?:[.,]\d+)?)\s*(?:milh(?:ão|oes|ões)|mi)\b/gi, fator: 1_000_000 },
    { re: /(\d+(?:[.,]\d+)?)\s*mil\b/gi, fator: 1_000 },
  ];
  for (const { re, fator } of multiplicadores) {
    const achados = [...limpo.matchAll(re)];
    if (achados.length === 1) {
      const base = Number(achados[0][1].replace(".", "").replace(",", "."));
      if (Number.isFinite(base)) return Math.round(base * fator * 100);
    }
    if (achados.length > 1) return null; // ambíguo
  }

  // números "normais": 1.234,56 / 1234.56 / 1234 / 45,90
  const candidatos = [...limpo.matchAll(/\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?/g)]
    .map((m) => m[0]);
  if (candidatos.length !== 1) return null;

  const bruto = candidatos[0];
  const ultimaVirgula = bruto.lastIndexOf(",");
  const ultimoPonto = bruto.lastIndexOf(".");
  // quem vem por último manda: 1.234,56 (BR) vs 1,234.56 (US)
  const normalizado = ultimaVirgula > ultimoPonto
    ? bruto.replace(/\./g, "").replace(",", ".")
    : bruto.replace(/,/g, "");

  const valor = Number(normalizado);
  if (!Number.isFinite(valor) || valor <= 0) return null;
  return Math.round(valor * 100);
}
