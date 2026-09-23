import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { HitTarget, Motion, Radius, Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { showItemActions } from '@/lib/item-actions';
import type { Proximo } from '@/lib/proximo-passo';

/**
 * Um recurso por vez, no lugar (23/09/2026, spec `2026-09-23-onboarding-hibrido-design.md`).
 *
 * Aparece quando os Primeiros passos acabam — um card de descoberta por vez na Hoje. Quando o
 * passo sai (feito ou dispensado), o próximo entra em cross-fade: a chave é o `id` do passo, e
 * saída que muda de conteúdo é cross-fade (design.md §5).
 */
export function ProximoPassoCard({
  passo,
  onAbrir,
  onDispensar,
}: {
  passo: Proximo;
  onAbrir: () => void;
  onDispensar: () => void;
}) {
  const theme = useTheme();
  return (
    <Animated.View
      key={passo.id}
      entering={FadeIn.duration(Motion.duration.base)}
      exiting={FadeOut.duration(Motion.duration.fast)}
      style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.cardBorder }]}>
      <View style={styles.topo}>
        <View style={[styles.selo, { backgroundColor: theme.backgroundElement }]}>
          <Icon name={passo.icon} size="md" color="text" />
        </View>
        <View style={styles.titulos}>
          <ThemedText type="meta" themeColor="textSecondary" style={styles.semEncolher}>
            Próximo passo
          </ThemedText>
          {/* `flexShrink: 0`: texto dentro de `entering` encolhido não se remede (design.md §3). */}
          <ThemedText type="headline" style={styles.semEncolher}>
            {passo.titulo}
          </ThemedText>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Mais opções do próximo passo"
          hitSlop={(HitTarget - 32) / 2}
          onPress={() =>
            showItemActions('Próximo passo', [
              {
                label: 'Agora não',
                icon: 'eye.slash',
                onPress: () => {
                  Haptics.selectionAsync();
                  onDispensar();
                },
              },
            ])
          }
          style={[styles.mais, { backgroundColor: theme.backgroundElement }]}>
          <Icon name="ellipsis" size="sm" color="text" />
        </Pressable>
      </View>
      <ThemedText type="small" themeColor="textSecondary" style={styles.semEncolher}>
        {passo.texto}
      </ThemedText>
      <View style={styles.acao}>
        <Button label={passo.acao} variant="secondary" size="sm" onPress={onAbrir} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Space.md,
    padding: Space.lg,
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
    borderWidth: 1,
  },
  topo: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  selo: {
    width: HitTarget,
    height: HitTarget,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titulos: { flex: 1, minWidth: 0, gap: Space.half },
  semEncolher: { flexShrink: 0, maxWidth: '100%' },
  mais: { width: 32, height: 32, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  acao: { flexDirection: 'row' },
});
