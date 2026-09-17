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

/**
 * Quando o realizado não acrescenta nada, a linha fica SEM subtítulo.
 *
 * Era uma frase descritiva ("salário, pix e o que mais cai na conta"), e ela explicava o que o
 * título já diz. Saiu com o corte de texto de 16/09/2026 (*"ta muito texto, somente o
 * essencial"*): o subtítulo só existe quando diz algo que a pessoa não sabe — quanto já caiu.
 */
const PADRAO = { entra: '', sai: '' };

export interface CycleFlowLike {
  estado: string;
  entrou: number | string;
  saiu: number | string;
  entrou_realizado: number | string;
  saiu_realizado: number | string;
}

/**
 * A sub-linha de "O que entra" / "O que sai": quanto do total JÁ passou pela conta.
 *
 * O total sozinho não distingue o que foi pago do que ainda vai vencer — e é essa distinção que
 * fazia o dono do produto abrir a planilha. Sai da MESMA série do herói (`cycle_series`), então
 * o número de baixo nunca discorda do de cima.
 *
 * ⚠️ **A LENTE vai escrita, e não é preciosismo.** Estas duas linhas são CAIXA (o dia em que o
 * dinheiro sai da conta); o card de Lançamentos é COMPETÊNCIA (o dia da compra). Medido no ciclo
 * corrente em 14/09/2026: 5 despesas de R$ 355,54 entre 11 e 14/09, **as cinco no cartão** — elas
 * só viram caixa quando a fatura vencer em 10/10. Lançamentos diz "já aconteceu R$ 355,54" e esta
 * linha diz "nada saiu da conta ainda", e as duas estão certas. Sem "da conta"/"na conta"
 * escrito, viram dois números com a mesma cara — o defeito que custou dois dias em 13–14/09.
 *
 * ⚠️ **`brl` entra por PARÂMETRO.** Ele é o `useBRL()`, que obedece ao "esconder saldo"; chamar
 * `formatBRL` aqui vazaria o valor com o olho fechado — e este arquivo é puro de propósito.
 */
export function describeRealizado(
  c: CycleFlowLike | null,
  brl: (cents: number) => string,
): { entra: string; sai: string } {
  const linha = (realizado: number, total: number, verbo: string, onde: string, padrao: string) =>
    // ⚠️ **Ciclo `previsto` não ganha sub-linha**: lá o realizado é zero por definição (nada é
    // `realizado` antes de o ciclo começar), e "nada ainda" diria só que o futuro não aconteceu.
    //
    // ⚠️ **E ela some quando já aconteceu TUDO.** Num ciclo fechado e quitado o realizado é igual
    // ao total, e a sub-linha escreveria o mesmo número que o `<Money>` a 60px dela — eco, §1 do
    // design. Visto na tela antes de virar regra: "já caiu na conta R$ 6.330,62" debaixo de
    // "R$ 6.330,62". Mesma decisão que o `mostrarSplit` de `period-summary-card.tsx`.
    !c || c.estado === 'previsto' || realizado >= total
      ? padrao
      : realizado > 0
        ? `já ${verbo} ${onde} ${brl(realizado)}`
        : `nada ${verbo} ${onde} ainda`;

  return {
    entra: linha(Number(c?.entrou_realizado ?? 0), Number(c?.entrou ?? 0), 'caiu', 'na conta', PADRAO.entra),
    sai: linha(Number(c?.saiu_realizado ?? 0), Number(c?.saiu ?? 0), 'saiu', 'da conta', PADRAO.sai),
  };
}
