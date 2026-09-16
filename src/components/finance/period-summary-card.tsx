import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { HeroLabel } from '@/components/ui/section-head';
import { ProgressBar } from '@/components/ui/sparkline';
import { Motion, Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import type { CycleRow } from '@/hooks/use-finance';
import { formatBRL } from '@/hooks/use-items';
import { describeCycle } from '@/lib/cycle-label';

interface Props {
  /** Somado por COMPETÊNCIA, na mesma janela da lista logo abaixo. */
  entrou: number;
  saiu: number;
  /** Quanto de cada um ainda NÃO aconteceu (`status = 'pending'`). */
  entrouPrevisto: number;
  saiuPrevisto: number;
  /** Nome do mês já em minúsculas, ex. `outubro`. */
  nomeDoMes: string;
  /** Quantos lançamentos a lista abaixo está mostrando. */
  lancamentos: number;
  /** O mesmo período pela outra lente — vira o link do rodapé. `null` enquanto carrega. */
  ciclo: CycleRow | null;
  onAbrirCiclo: () => void;
}

/**
 * **O total do que está logo abaixo, no topo de uma lista de lançamentos.**
 *
 * ## A regra: um resumo resume o que está DEBAIXO dele
 *
 * Este card já foi dos dois jeitos, e os dois falharam:
 *
 * 1. Somando a lista, com a MESMA cara do painel da home — dois resultados idênticos em telas
 *    vizinhas, sem nada dizendo que respondiam a perguntas diferentes.
 * 2. Lendo o ciclo (`cycle_series`), para bater com a home — e aí ele parou de bater com a lista
 *    a 200px dele. Medido no staging em 13/09/2026, ciclo de outubro: o card dizia
 *    `saiu R$ 8.326,63` sobre uma lista que somava `R$ 3.842,78`.
 *
 * O erro comum aos dois é o mesmo: **um número de outra lente ocupando o topo de uma lista.**
 * Agora ele soma o que a lista soma (competência — a data da COMPRA), diz isso no rótulo, e o
 * resultado do ciclo (a data do PAGAMENTO) vira o link do rodapé, que é o que um número de outra
 * lente pode ser sem mentir.
 *
 * ⚠️ **A tela esconde este card quando há filtro ativo.** Ele soma o período inteiro, e a lista
 * filtrada soma menos — exibi-lo ali reintroduziria, com uma cara nova, exatamente o defeito que
 * ele existe para matar.
 *
 * ## As duas barras são o conteúdo, não enfeite
 *
 * `entrou` e `saiu` são **duas barras na MESMA escala**. É a leitura que nenhum número dá
 * sozinho: a de saída passando a de entrada É o período no vermelho, visível antes de ler
 * qualquer dígito. `max` é o maior dos dois de propósito — normalizar cada uma pelo próprio
 * valor encheria as duas e apagaria justamente a comparação.
 *
 * Reusa `ProgressBar`, que já anima por `scaleX` na UI thread (§5: barra que salta é bug visual).
 *
 * ## A faixa que sangra
 *
 * É o segundo padrão repetido do design (§1): superfície um degrau mais escura, sangrando até as
 * bordas por margem negativa + `overflow: 'hidden'`. Ela carrega a OUTRA régua — e por isso não
 * pode dividir espaço com o número lá em cima.
 */
export function PeriodSummaryCard({
  entrou,
  saiu,
  entrouPrevisto,
  saiuPrevisto,
  nomeDoMes,
  lancamentos,
  ciclo,
  onAbrirCiclo,
}: Props) {
  const theme = useTheme();
  const escala = Math.max(entrou, saiu, 1);

  /*
    O rodapé fala do CICLO, e quem descreve ciclo é `describeCycle` — a mesma função da home e da
    tela do ciclo. Escrever a frase aqui à mão é como "cada lugar fala uma coisa" volta: o mesmo
    dado viraria "fechei devendo" num lugar e "vou fechar em" no outro.
  */
  const d = ciclo ? describeCycle(ciclo, nomeDoMes) : null;

  return (
    <Animated.View entering={FadeIn.duration(Motion.duration.base)}>
      <Card style={styles.card}>
        {/*
          ⚠️ **"Gastei" é passado, e o número quase nunca é.** No dia 3 de um ciclo o total é
          ~98% futuro: dizia "GASTEI EM OUTUBRO R$ 3.842,78" quando R$ 83,97 tinham acontecido.
          O rótulo agora é neutro, e quem separa passado de futuro são as barras.
        */}
        <HeroLabel>{`Gastos de ${nomeDoMes}`}</HeroLabel>
        <Money cents={saiu} variant="money" />
        <ThemedText type="footnote" themeColor="textSecondary">
          {`${lancamentos === 1 ? '1 lançamento' : `${lancamentos} lançamentos`} · por data da compra`}
        </ThemedText>

        <View style={styles.barras}>
          {/*
            ⚠️ **Sem `success`/`danger` aqui.** O `CashBar` do Financeiro já decidiu o contrário
            para ESTA MESMA comparação, e com o motivo escrito: *"cor semântica aqui seria
            decoração, e é a última alavanca de cor que o app tem"*. Duas regras para o mesmo
            gráfico em telas vizinhas é como elas divergem. Quem separa as barras é a PALAVRA à
            esquerda e a claridade — que é o que funciona sem enxergar cor.
          */}
          <Fluxo rotulo="entrou" cents={entrou} previsto={entrouPrevisto} max={escala} forte />
          <Fluxo rotulo="saiu" cents={saiu} previsto={saiuPrevisto} max={escala} />
        </View>

        {d ? (
          <Pressable
            onPress={onAbrirCiclo}
            accessibilityRole="button"
            /*
              ⚠️ `cents / 100` é lido como "35196.9". Quem escreve dinheiro para leitor de tela
              é o mesmo formatador da tela — senão o número falado não é o número visto.
            */
            accessibilityLabel={`${d.label} ${formatBRL(d.cents)}, por data do pagamento. Ver tudo que fecha o ciclo`}
            accessibilityHint="Abre a lista por data do pagamento, com as faturas">
            {({ pressed }) => (
              <View
                style={[
                  styles.faixa,
                  /*
                    ⚠️ **`heroFooter`, não `backgroundElement`.** §1 pede a faixa "um degrau mais
                    ESCURA", e `backgroundElement` só é isso no tema claro: no escuro ele é
                    `#201F21` sobre um card `#1B1B1D` — 5/255 mais CLARO, ou seja, o degrau para
                    o lado errado, invisível em metade das verificações. `heroFooter` é
                    `rgba(0,0,0,.3)`: escurece o que estiver embaixo, nos dois temas. É o token
                    que a faixa irmã do Financeiro já usa.

                    O press escurece mais um degrau pelo mesmo motivo — `backgroundSelected` é
                    mais CLARO que `heroFooter` no tema claro, então ele clarearia num tema e
                    escureceria no outro.
                  */
                  { backgroundColor: pressed ? theme.heroFooterPress : theme.heroFooter },
                ]}>
                {/*
                  ⚠️ **Duas LINHAS, não uma frase que quebra.** Emendado com "·", o separador
                  caía no começo da segunda linha assim que a frase não coubesse — e "·" abrindo
                  linha lê como marcador de lista (§3, a mesma razão que devolveu o
                  `textBreakStrategy="balanced"`). Em duas linhas declaradas, onde cada parte
                  começa não depende da largura da tela.

                  O chevron fica FORA deste bloco: irmão de uma linha que quebra, ele é quem
                  desce sozinho, longe do texto que continua.
                */}
                <View style={styles.faixaTexto}>
                  <View style={styles.faixaLinha}>
                    <ThemedText type="footnote" themeColor="textSecondary">
                      {d.label.toLowerCase()}
                    </ThemedText>
                    <Money
                      cents={d.cents}
                      variant="ticker"
                      tone={d.ruim ? 'danger' : 'text'}
                      signed
                    />
                  </View>
                  {/*
                    ⚠️ **É esta linha que diz por que os dois números diferem.** Os dois somam o
                    mesmo período; o que muda é o DIA que cada um conta — a data da compra lá em
                    cima, a data em que o dinheiro sai da conta aqui (a fatura pesa quando vence).
                    Sem o par "por data da compra" / "por data do pagamento", eles viram dois
                    totais diferentes para outubro sem explicação, que é exatamente a queixa.
                  */}
                  <ThemedText type="caption" themeColor="textSecondary">
                    por data do pagamento
                  </ThemedText>
                </View>
                <Icon name="chevron.right" size="sm" color="textSecondary" />
              </View>
            )}
          </Pressable>
        ) : null}
      </Card>
    </Animated.View>
  );
}

/**
 * Uma das duas barras: o rótulo à esquerda, o total à direita, e a barra dizendo quanto disso
 * JÁ ACONTECEU.
 *
 * ## Duas perguntas numa linha só
 *
 * O comprimento da barra compara **entrou × saiu** (as duas na mesma escala, `max` é o maior dos
 * dois); a parte PREENCHIDA dela é o que já aconteceu. Por isso a barra vive dentro de uma caixa
 * de largura proporcional: a caixa carrega a comparação entre as duas linhas, o preenchimento
 * carrega o realizado dentro da própria linha. Sem a caixa, `value/total` encheria as duas
 * barras e apagaria justamente a comparação.
 *
 * ## Por que `status` e não a data
 *
 * Logo abaixo deste card estão os chips **"Já aconteceu" / "Ainda vai acontecer"**, que filtram
 * `status`. A regra desta tela é que o topo soma o que está embaixo — então tocar no chip tem
 * que devolver exatamente o número que o card mostra. Cortar por DATA aqui daria um número que
 * nenhum chip reproduz. (Na Fatura o corte É a data, porque lá a pergunta é outra — "por que o
 * app é maior que meu extrato?" — e o rótulo diz "com data à frente", não "vai acontecer".)
 */
function Fluxo({
  rotulo,
  cents,
  previsto,
  max,
  forte = false,
}: {
  rotulo: string;
  cents: number;
  previsto: number;
  max: number;
  /** A barra de "entrou" é a mais clara das duas; "saiu" fica em cinza de dado. */
  forte?: boolean;
}) {
  const jaAconteceu = Math.max(0, cents - previsto);
  // Nada pendente = a barra cheia já diz tudo, e a linha repetiria o total (§1, eco).
  const mostrarSplit = previsto > 0;

  return (
    /*
      ⚠️ **Um nó só para o leitor de tela.** Solto, o VoiceOver lia "entrou · R$ 7.566,52 ·
      0 por cento · já aconteceu · R$ 0,00" — e os "0 por cento" vêm do `accessibilityValue` da
      `ProgressBar`, chegando sem rótulo nenhum no meio da frase. É o mesmo tratamento que o
      painel do Financeiro já dá ao par dele.
    */
    <View
      style={styles.fluxo}
      accessible
      accessibilityLabel={`${rotulo} ${formatBRL(cents)}${
        mostrarSplit ? `, já aconteceu ${jaAconteceu === 0 ? 'nada ainda' : formatBRL(jaAconteceu)}` : ''
      }`}>
      <View style={styles.fluxoTopo}>
        <ThemedText type="caption" themeColor="textSecondary">
          {rotulo}
        </ThemedText>
        <Money cents={cents} variant="ticker" />
      </View>
      {/*
        ⚠️ **`track` explícito: aqui a PISTA é carga útil, não fundo.** A caixa em volta carrega
        `entrou × saiu` e o preenchimento carrega `já aconteceu` dentro da própria linha — então
        quem não enxerga a pista lê realizado contra realizado, que é outra pergunta, sem erro
        nenhum na tela. No escuro o `backgroundElement` padrão é `#201F21` sobre um card
        `#1B1B1D`: **5/255**, a mesma amplitude que este arquivo chama de invisível lá em cima. E
        no começo de um ciclo, com `jaAconteceu` perto de zero, a barra sumia inteira.

        ⚠️ **`minWidth` porque 1% não desenha.** Com R$ 50 contra R$ 5.000 a caixa fica com ~3px
        sob um raio de 4 — valor diferente de zero que aparece como nada. Zero continua sendo a
        única coisa que não desenha.
      */}
      <View
        style={{
          width: `${max > 0 ? (cents / max) * 100 : 0}%`,
          minWidth: cents > 0 ? Space.sm : 0,
        }}>
        <ProgressBar
          value={jaAconteceu}
          max={cents}
          tone={forte ? 'strong' : 'data'}
          track="backgroundSelected"
        />
      </View>
      {mostrarSplit ? (
        <View style={styles.fluxoTopo}>
          <ThemedText type="caption" themeColor="textSecondary">
            já aconteceu
          </ThemedText>
          {/*
            "já aconteceu R$ 0,00" é o mesmo defeito que `BarTrack` nomeia: escrever um zero onde
            a ausência já é a informação. A palavra diz o que o zero diria, sem parecer defeito.

            `code` e não `caption`: no mesmo bloco o total é `ticker` (mono), e `caption` é
            Jost 11 com tracking POSITIVO — tracking desenhado para caixa alta, aplicado a
            dígito.
          */}
          {jaAconteceu === 0 ? (
            <ThemedText type="caption" themeColor="textSecondary">
              nada ainda
            </ThemedText>
          ) : (
            <Money cents={jaAconteceu} variant="code" tone="textSecondary" />
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // `overflow: hidden` é o que deixa a faixa sangrar sem vazar o raio do card.
  card: { gap: Space.sm, overflow: 'hidden' },
  // §2: linhas irmãs de um card são `md`. Com `sm` (8) o agrupamento das quatro linhas se
  // apoiava em 4 contra 8 — e a 1,3× o texto cresce e o gap não.
  barras: { gap: Space.md, paddingTop: Space.xs },
  fluxo: { gap: Space.xs },
  fluxoTopo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: Space.sm,
  },
  /*
    Sangra até as bordas: `Card` tem `padding: Space.lg`, então as margens negativas são o
    simétrico exato dele. Sem o `-lg` de baixo a faixa flutuaria acima da borda inferior.
  */
  faixa: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    marginHorizontal: -Space.lg,
    marginBottom: -Space.lg,
    marginTop: Space.sm,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.sm + 2,
  },
  // Quebra em vez de truncar: nada aqui é prévia de corpo (§7).
  faixaTexto: { flex: 1, gap: Space.half },
  faixaLinha: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: Space.xs },
});
