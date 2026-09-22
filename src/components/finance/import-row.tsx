import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { HitTarget, Space } from '@/design/tokens';
import { formatDateBR } from '@/hooks/use-items';
import { useTheme } from '@/hooks/use-theme';

interface Props {
  titulo: string;
  dia: string;
  categoria: string | null;
  kind: 'expense' | 'income';
  cents: number;
  marcado: boolean;
  /** A compra parcelada que a linha vai criar ("Parcela 2/12 · cria a compra de 12x…"). */
  parcela?: string | null;
  /** Por que ela nasceu desmarcada ("mesmo valor — «Posto»", "Pagamento da fatura"). */
  motivo?: string | null;
  onToggle: () => void;
  onLongPress: () => void;
}

/**
 * Uma linha do extrato na prévia: o check à esquerda, o que é e o motivo, o valor à direita.
 *
 * ⚠️ **Tocar MARCA, não abre nada** — é a ação feita dezenas de vezes nesta tela, então vem com
 * o highlight de linha e um `selectionAsync`, sem animação (§5 do design: frequência alta, o
 * padrão da plataforma). Trocar categoria e as outras saídas moram no toque longo, como no resto
 * do app. Mesmo desenho e mesmas medidas do `Row`, para a lista ler como as outras.
 *
 * O check é FORMA e não só cor: círculo vazio × círculo cheio com o visto — o estado continua
 * legível sem cor e é dito ao leitor de tela (`accessibilityState.checked`).
 */
export function ImportRow({
  titulo, dia, categoria, kind, cents, marcado, parcela, motivo, onToggle, onLongPress,
}: Props) {
  const theme = useTheme();
  const subtitulo = [formatDateBR(dia), categoria ?? 'sem categoria'].join(' · ');
  return (
    <Pressable
      onPress={() => {
        Haptics.selectionAsync();
        onToggle();
      }}
      onLongPress={onLongPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: marcado }}
      accessibilityLabel={[titulo, subtitulo, parcela, motivo].filter(Boolean).join(', ')}
      accessibilityHint="Toque para marcar ou desmarcar. Segure para mais opções.">
      {({ pressed }) => (
        <View style={[styles.row, { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}>
          <Icon
            name={marcado ? 'checkmark.circle.fill' : 'circle'}
            size="lg"
            color={marcado ? 'tint' : 'textSecondary'}
          />
          <View style={styles.labels}>
            <ThemedText type="default" themeColor={marcado ? 'text' : 'textSecondary'}>
              {titulo}
            </ThemedText>
            <ThemedText type="footnote" themeColor="textSecondary">
              {subtitulo}
            </ThemedText>
            {parcela ? (
              <ThemedText type="footnote" themeColor="text">
                {parcela}
              </ThemedText>
            ) : null}
            {motivo ? (
              <View style={styles.motivo}>
                <Icon name="info.circle" size="xs" color="textSecondary" />
                <ThemedText type="footnote" themeColor="textSecondary" style={styles.motivoTexto}>
                  {motivo}
                </ThemedText>
              </View>
            ) : null}
          </View>
          <Money cents={kind === 'income' ? cents : -cents} variant="ticker" tone="auto" signed />
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // As medidas do `Row` (inclusive a válvula de `flexWrap` + `minWidth` medida a 384dp).
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Space.md,
    minHeight: HitTarget,
    paddingVertical: Space.md,
    paddingHorizontal: Space.lg,
  },
  labels: { flexGrow: 1, flexShrink: 1, minWidth: 134, gap: 2 },
  motivo: { flexDirection: 'row', alignItems: 'flex-start', gap: Space.xs, marginTop: 2 },
  motivoTexto: { flexShrink: 1 },
});
