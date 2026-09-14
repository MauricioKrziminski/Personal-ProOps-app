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
        <HeroLabel>{`Gastei em ${nomeDoMes}`}</HeroLabel>
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
          <Fluxo rotulo="entrou" cents={entrou} max={escala} forte />
          <Fluxo rotulo="saiu" cents={saiu} max={escala} />
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

/** Uma das duas barras. O rótulo à esquerda, o valor à direita, a barra ocupando o meio. */
function Fluxo({
  rotulo,
  cents,
  max,
  forte = false,
}: {
  rotulo: string;
  cents: number;
  max: number;
  /** A barra de "entrou" leva o accent; "saiu" fica em cinza de dado. */
  forte?: boolean;
}) {
  return (
    <View style={styles.fluxo}>
      <View style={styles.fluxoTopo}>
        <ThemedText type="caption" themeColor="textSecondary">
          {rotulo}
        </ThemedText>
        <Money cents={cents} variant="ticker" />
      </View>
      <ProgressBar value={cents} max={max} tone={forte ? 'tint' : 'data'} />
    </View>
  );
}

const styles = StyleSheet.create({
  // `overflow: hidden` é o que deixa a faixa sangrar sem vazar o raio do card.
  card: { gap: Space.sm, overflow: 'hidden' },
  barras: { gap: Space.sm, paddingTop: Space.xs },
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
