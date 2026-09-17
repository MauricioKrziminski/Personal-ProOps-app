import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { PressableScale } from '@/components/motion/pressable-scale';
import { Icon } from '@/components/ui/icon';
import { Mark } from '@/components/ui/mark';
import { Elevation, Motion, Radius, Space } from '@/design/tokens';
import { useScheme, useTheme } from '@/hooks/use-theme';
import { EXEMPLOS_DO_AGENTE } from '@/lib/agent-prompts';

/** Tempo de cada exemplo na pílula. */
const TROCA_MS = 3500;

/**
 * "Diga ao agente…" — a ação primária da Hoje: a PORTA para uma conversa nova, não um segundo
 * compositor. Os exemplos alternam enquanto a tela está em foco e param com Reduzir Movimento.
 *
 * Só `entering`, sem `exiting`: com os dois o exemplo velho e o novo ocupam a mesma linha ao
 * mesmo tempo, e com fonte grande um deles seria cortado.
 */
export function AgentPrompt({ onPress }: { onPress: () => void }) {
  const theme = useTheme();
  const scheme = useScheme();
  const reduzido = useReducedMotion();
  const [indice, setIndice] = useState(0);

  useFocusEffect(
    useCallback(() => {
      if (reduzido) return undefined;
      const id = setInterval(() => setIndice((i) => (i + 1) % EXEMPLOS_DO_AGENTE.length), TROCA_MS);
      return () => clearInterval(id);
    }, [reduzido])
  );

  return (
    <PressableScale
      haptic="light"
      accessibilityRole="button"
      accessibilityLabel="Diga ao agente"
      accessibilityHint="Abre uma conversa nova"
      onPress={onPress}
      style={[
        styles.pilula,
        { backgroundColor: theme.surface, borderColor: theme.cardBorder, boxShadow: Elevation[scheme].raised },
      ]}>
      <View style={[styles.selo, { backgroundColor: theme.heroSurface }]}>
        <Mark size={18} color="onHero" />
      </View>
      <View style={styles.textos}>
        <ThemedText type="caption" themeColor="textSecondary">
          Diga ao agente
        </ThemedText>
        <Animated.View key={indice} entering={reduzido ? undefined : FadeInDown.duration(Motion.duration.slow)}>
          <ThemedText type="small" style={styles.semEncolher}>
            {`“${EXEMPLOS_DO_AGENTE[indice]}”`}
          </ThemedText>
        </Animated.View>
      </View>
      <View style={[styles.enviar, { backgroundColor: theme.tintFill }]}>
        <Icon name="arrow.up" size="sm" color="onTint" />
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  pilula: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    minHeight: 64,
    paddingVertical: Space.sm,
    paddingLeft: Space.sm,
    paddingRight: Space.sm,
    borderRadius: Radius.pill,
    borderCurve: 'continuous',
    borderWidth: 1,
  },
  selo: { width: 44, height: 44, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  textos: { flex: 1, minWidth: 0, gap: Space.half },
  // Texto dentro de container com `entering`: sem encolher, ou ele não se remede (§3).
  semEncolher: { flexShrink: 0, maxWidth: '100%' },
  enviar: { width: 40, height: 40, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
});
