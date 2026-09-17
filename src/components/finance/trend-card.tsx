import * as Haptics from 'expo-haptics';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue } from 'react-native-reanimated';

import { monthShort, monthTitle } from '@/components/finance/month-picker';
import { ThemedText } from '@/components/themed-text';
import { Money } from '@/components/ui/money';
import { Segmented } from '@/components/ui/segmented';
import { BarTrack } from '@/components/ui/sparkline';
import { Radius, Space } from '@/design/tokens';
import type { MonthlyCashflow } from '@/hooks/use-finance';
import { formatBRL } from '@/hooks/use-items';
import { useTheme } from '@/hooks/use-theme';

const JANELAS = [
  { value: '6', label: '6 meses' },
  { value: '12', label: '12 meses' },
] as const;
/** A altura útil e a largura da barra (traço fino, não bloco). */
const ALTURA_BARRA = 96;
const LARGURA_BARRA = 10;

/**
 * Entrou × saiu mês a mês. Tocar ou arrastar escolhe o mês, e o rodapé passa a dizer quanto
 * sobrou NAQUELE mês (antes dizia só do último). Os outros meses recuam (`dim`).
 *
 * A comparação é por CLARIDADE (tinta × cinza), nunca por cor semântica — a tampa clara é o
 * previsto que ainda não aconteceu (a pergunta de 09/09/2026: "tem que ter alguma coisa
 * explicando a diferença").
 */
export function TrendCard({
  meses,
  janela,
  onJanela,
}: {
  meses: readonly MonthlyCashflow[];
  janela: string;
  onJanela: (v: string) => void;
}) {
  const theme = useTheme();
  const [escolhido, setEscolhido] = useState<number | null>(null);
  const [largura, setLargura] = useState(0);
  const ultimo = useSharedValue(-1);
  // A escala é COMUM às duas barras: escalas separadas igualariam um mês em que uma é o dobro.
  const teto = Math.max(...meses.map((m) => Math.max(Number(m.income_cents), Number(m.expense_cents))), 1);
  const indice = escolhido !== null && escolhido < meses.length ? escolhido : meses.length - 1;
  const mes = meses[indice];

  const escolher = (i: number) => {
    setEscolhido(i);
    Haptics.selectionAsync();
  };

  const gesto = useMemo(() => {
    const noX = (x: number) => {
      'worklet';
      return Math.min(meses.length - 1, Math.max(0, Math.floor(x / (largura / meses.length))));
    };
    const arraste = Gesture.Pan()
      .enabled(largura > 0 && meses.length > 1)
      .activeOffsetX([-6, 6])
      .failOffsetY([-10, 10])
      .onUpdate((e) => {
        const i = noX(e.x);
        if (i !== ultimo.get()) {
          ultimo.set(i);
          runOnJS(escolher)(i);
        }
      })
      .onFinalize(() => ultimo.set(-1));
    const toque = Gesture.Tap()
      .enabled(largura > 0)
      .onEnd((e) => runOnJS(escolher)(noX(e.x)));
    return Gesture.Race(arraste, toque);
    // `escolher` só usa setters estáveis: fica fora das dependências de propósito.
  }, [largura, meses.length, ultimo]);

  const par = (m: MonthlyCashflow, i: number) => {
    const entrou = Number(m.income_cents);
    const saiu = Number(m.expense_cents);
    const tampa = (previsto: number, total: number) => {
      const bruta = total > 0 ? previsto / total : 0;
      return Number.isFinite(bruta) ? Math.min(1, Math.max(0, bruta)) : 0;
    };
    const barra = (total: number, previsto: number, forte: boolean) => (
      <View style={styles.trilho}>
        <BarTrack ratio={total / teto} index={i} height={ALTURA_BARRA} color={forte ? theme.text : theme.surfaceRaised} dim={i !== indice}>
          {tampa(previsto, total) > 0 ? (
            <View
              style={[
                styles.tampa,
                { flex: tampa(previsto, total), backgroundColor: theme.surface, borderColor: theme.separator },
              ]}
            />
          ) : null}
        </BarTrack>
      </View>
    );
    return (
      <View
        key={m.month}
        style={styles.slot}
        accessible
        accessibilityRole="button"
        accessibilityState={{ selected: i === indice }}
        accessibilityLabel={`${monthTitle(m.month.slice(0, 7))}: entrou ${formatBRL(entrou)}, saiu ${formatBRL(saiu)}`}
        accessibilityActions={[{ name: 'activate' }]}
        onAccessibilityAction={() => escolher(i)}>
        <View style={styles.par}>
          {barra(entrou, Number(m.income_pending_cents), true)}
          {barra(saiu, Number(m.expense_pending_cents), false)}
        </View>
        <ThemedText
          type={i === indice ? 'smallBold' : 'small'}
          themeColor={i === indice ? 'text' : 'textSecondary'}
          style={styles.mes}>
          {monthShort(m.month.slice(0, 7))}
        </ThemedText>
      </View>
    );
  };

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.cardBorder }]}>
      <View style={styles.cabeca}>
        <View style={styles.legenda}>
          <View style={styles.chave}>
            <View style={[styles.amostra, { backgroundColor: theme.text }]} />
            <ThemedText type="caption" themeColor="textSecondary">entrou</ThemedText>
          </View>
          <View style={styles.chave}>
            <View style={[styles.amostra, { backgroundColor: theme.surfaceRaised, borderColor: theme.separator, borderWidth: 1 }]} />
            <ThemedText type="caption" themeColor="textSecondary">saiu</ThemedText>
          </View>
          <View style={styles.chave}>
            <View style={[styles.amostra, { backgroundColor: theme.surface, borderColor: theme.separator, borderWidth: 1 }]} />
            <ThemedText type="caption" themeColor="textSecondary">previsto</ThemedText>
          </View>
        </View>
        <Segmented options={JANELAS} value={janela} onChange={onJanela} />
      </View>

      <GestureDetector gesture={gesto}>
        <View style={styles.barras} onLayout={(e) => setLargura(e.nativeEvent.layout.width)}>
          {meses.map(par)}
        </View>
      </GestureDetector>

      <View style={[styles.rodape, { backgroundColor: theme.cardFooter }]}>
        <ThemedText type="footnote" themeColor="textSecondary">
          {`Sobrou em ${monthShort(mes.month.slice(0, 7))}`}
        </ThemedText>
        <Money cents={Number(mes.income_cents) - Number(mes.expense_cents)} variant="ticker" tone="auto" signed />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Space.lg,
    padding: Space.lg,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    borderWidth: 1,
    overflow: 'hidden',
  },
  cabeca: { gap: Space.md },
  legenda: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Space.lg },
  chave: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  amostra: { width: 10, height: 10, borderRadius: Radius.pill },
  barras: { flexDirection: 'row', alignItems: 'flex-end', gap: Space.md },
  slot: { flex: 1, gap: Space.xs },
  // Respiro interno menor que o `gap` entre meses: as duas barras leem como um par.
  par: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: Space.xs },
  trilho: { width: LARGURA_BARRA, height: ALTURA_BARRA, justifyContent: 'flex-end' },
  tampa: { width: '100%', borderTopLeftRadius: Radius.xs, borderTopRightRadius: Radius.xs, borderWidth: 1 },
  mes: { textAlign: 'center' },
  rodape: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.sm,
    marginHorizontal: -Space.lg,
    marginBottom: -Space.lg,
    paddingHorizontal: Space.lg,
    paddingVertical: Space.sm + 2,
  },
});
