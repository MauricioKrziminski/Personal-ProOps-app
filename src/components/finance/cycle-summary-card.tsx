import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { HeroLabel } from '@/components/ui/section-head';
import { ProgressBar } from '@/components/ui/sparkline';
import { Motion, Radius, Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import type { CycleRow } from '@/hooks/use-finance';
import { describeCycle } from '@/lib/cycle-label';

interface Props {
  ciclo: CycleRow;
  /** Nome do mês já em minúsculas, ex. `setembro`. */
  nomeDoMes: string;
  /** Quantos lançamentos a lista abaixo está mostrando. */
  lancamentos: number;
  onAbrirCiclo: () => void;
}

/**
 * **Como o ciclo fecha, no topo de uma lista de lançamentos.**
 *
 * ## O que ele substitui
 *
 * Uma pilha de texto: rótulo, uma frase `40 lançamentos · entra X · sai Y`, uma nota e um botão —
 * quatro blocos de texto do mesmo peso, sem hierarquia nenhuma. A queixa foi literal
 * (13/09/2026): *"essa informação do jeito que está ali está horrivelmente feia… quero saber o
 * saldo final do ciclo, essa informação de quanto entrou e quanto saiu não necessariamente
 * precisa ficar no card"*.
 *
 * ## As duas barras são o conteúdo, não enfeite
 *
 * `entrou` e `saiu` saíram da frase e viraram **duas barras na MESMA escala**. É a leitura que
 * nenhum número dá sozinho: a de saída passando a de entrada É o mês no vermelho, visível antes
 * de ler qualquer dígito. `max` é o maior dos dois de propósito — normalizar cada uma pelo
 * próprio valor encheria as duas e apagaria justamente a comparação.
 *
 * Reusa `ProgressBar`, que já anima por `scaleX` na UI thread (§5: barra que salta é bug visual).
 * Uma barra nova aqui seria uma segunda implementação do mesmo desenho.
 *
 * ## A faixa que sangra
 *
 * É o segundo padrão repetido do design (§1): superfície um degrau mais escura, sangrando até as
 * bordas por margem negativa + `overflow: 'hidden'`. Ela carrega o escopo da LISTA — que é outra
 * régua, e por isso não pode dividir espaço com o número do ciclo lá em cima.
 */
export function CycleSummaryCard({ ciclo, nomeDoMes, lancamentos, onAbrirCiclo }: Props) {
  const theme = useTheme();
  const d = describeCycle(ciclo, nomeDoMes);

  const entrou = Number(ciclo.entrou);
  const saiu = Number(ciclo.saiu);
  const escala = Math.max(entrou, saiu, 1);

  return (
    <Animated.View entering={FadeIn.duration(Motion.duration.base)}>
      <Card style={styles.card}>
        <HeroLabel>{d.label}</HeroLabel>
        <Money cents={d.cents} variant="money" tone={d.ruim ? 'danger' : 'text'} signed />

        <View style={styles.barras}>
          <Fluxo rotulo="entrou" cents={entrou} max={escala} tone="success" />
          <Fluxo rotulo="saiu" cents={saiu} max={escala} tone="danger" />
        </View>

        <Pressable
          onPress={onAbrirCiclo}
          accessibilityRole="button"
          accessibilityLabel="Ver tudo que fecha o ciclo"
          accessibilityHint="Abre a lista por data do pagamento, com as faturas">
          {({ pressed }) => (
            <View
              style={[
                styles.faixa,
                { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
              ]}>
              <ThemedText type="footnote" themeColor="textSecondary" style={styles.faixaTexto}>
                {`${lancamentos === 1 ? '1 lançamento' : `${lancamentos} lançamentos`} por data da compra · ver o que fecha o ciclo`}
              </ThemedText>
              <Icon name="chevron.right" size="sm" color="textSecondary" />
            </View>
          )}
        </Pressable>
      </Card>
    </Animated.View>
  );
}

/** Uma das duas barras. O rótulo à esquerda, o valor à direita, a barra ocupando o meio. */
function Fluxo({
  rotulo,
  cents,
  max,
  tone,
}: {
  rotulo: string;
  cents: number;
  max: number;
  tone: 'success' | 'danger';
}) {
  return (
    <View style={styles.fluxo}>
      <View style={styles.fluxoTopo}>
        <ThemedText type="caption" themeColor="textSecondary">
          {rotulo}
        </ThemedText>
        <Money cents={cents} variant="footnote" tone={tone} />
      </View>
      <ProgressBar value={cents} max={max} tone={tone} />
    </View>
  );
}

const styles = StyleSheet.create({
  // `overflow: hidden` é o que deixa a faixa sangrar sem vazar o raio do card.
  card: { gap: Space.sm, overflow: 'hidden' },
  barras: { gap: Space.sm, paddingTop: Space.xs },
  fluxo: { gap: Space.xs },
  fluxoTopo: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: Space.sm },
  /*
    Sangra até as bordas: `Card` tem `padding: Space.lg`, então as margens negativas são o
    simétrico exato dele. Sem o `-lg` de baixo a faixa flutuaria acima da borda inferior.
  */
  faixa: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    marginHorizontal: -Space.lg,
    marginBottom: -Space.lg,
    marginTop: Space.sm,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.sm + 2,
    borderBottomLeftRadius: Radius.md,
    borderBottomRightRadius: Radius.md,
  },
  faixaTexto: { flex: 1 },
});
