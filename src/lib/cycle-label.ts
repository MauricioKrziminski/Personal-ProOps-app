/**
 * Como um ciclo é DESCRITO — em um lugar só.
 *
 * Toda tela que mostra um ciclo lê daqui. Escrever o rótulo solto dentro de cada tela é como
 * "cada lugar fala uma coisa" acontece: a mesma linha de dados vira "Sobrou em setembro" num
 * card e "Fechei devendo" em outro, e nada no código impede. A queixa foi literal (13/09/2026):
 * *"por que aqui está falando que sobrou em setembro sendo que na verdade faltou pagar?…
 * novamente, arrume isso, cada lugar fala uma coisa"*.
 *
 * Puro de propósito — coberto por `src/lib/cycle-label.test.ts`, sem subir tela nenhuma.
 */

export interface CycleLike {
  estado: string;
  resultado: number | string;
  caixa_no_fim: number | string | null;
  faltou_pagar: number | string | null;
}

export interface CycleLabel {
  /** O rótulo em caixa alta do painel. */
  label: string;
  /** O número grande, em centavos. */
  cents: number;
  /** `true` quando o ciclo é má notícia — governa cor e seta. */
  ruim: boolean;
  /** A segunda linha, quando o número grande não conta a história toda. */
  rodape?: { label: string; cents: number };
}

/**
 * ⚠️ **Ciclo FECHADO que terminou devendo lidera com a DÍVIDA, não com o caixa.**
 * Os dois números aparecem; o que se decide aqui é qual deles é o tamanho 32.
 *
 * ⚠️ E "devendo" inclui fatura ADIADA: `rolled` quer dizer que o dinheiro não saiu — o principal
 * foi empurrado para a fatura seguinte, com juros. Tratar adiada como resolvida fazia o ciclo
 * anunciar que sobrou dinheiro no instante em que a dívida foi rolada.
 */
export function describeCycle(c: CycleLike, nomeDoMes: string): CycleLabel {
  const faltou = Number(c.faltou_pagar ?? 0);
  const caixa = Number(c.caixa_no_fim ?? 0);
  const resultado = Number(c.resultado);

  if (c.estado === 'fechado') {
    if (faltou > 0) {
      return {
        label: `Fechei ${nomeDoMes} devendo`,
        // ⚠️ NEGATIVO. Vermelho e a palavra "devendo" não bastam: todo outro número ruim do app
        // vem com o sinal, e um `R$ 371,64` sem ele lê como valor positivo num card vermelho.
        cents: -faltou,
        ruim: true,
        rodape: { label: 'Sobrou na conta', cents: caixa },
      };
    }
    return { label: `Sobrou em ${nomeDoMes}`, cents: caixa, ruim: caixa < 0 };
  }

  return {
    label: c.estado === 'aberto' ? 'Vou fechar em' : 'Devo fechar em',
    cents: resultado,
    ruim: resultado < 0,
  };
}
