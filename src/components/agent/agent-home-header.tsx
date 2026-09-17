import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';

import { AgentPromptList } from '@/components/agent/agent-prompt-list';
import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Motion, Radius, Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

interface Props {
  onNew: () => void;
  onPrompt: (prompt: string) => void;
}

/**
 * A porta de entrada do agente não depende do servidor. Ela aparece no primeiro
 * quadro, inclusive em rede lenta, e só apresenta ações que o agente já aceita.
 * O histórico é outra seção da tela e pode carregar em seu próprio ritmo.
 */
export const AgentHomeHeader = memo(function AgentHomeHeader({ onNew, onPrompt }: Props) {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const escala = useSharedValue(1);
  const press = useAnimatedStyle(() => ({ transform: [{ scale: escala.get() }] }));

  return (
    <View style={styles.root}>
      <View style={[styles.hero, { backgroundColor: theme.heroSurface }]}>
        <ThemedText type="title" style={styles.heroTitle} themeColor="onHero">
          O que você precisa resolver?
        </ThemedText>
        <ThemedText type="small" themeColor="onHeroMuted" style={styles.heroDescription}>
          Gastos, lembretes e contas em uma conversa.
        </ThemedText>

        <Animated.View style={press}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Começar uma nova conversa com o agente"
            onPress={onNew}
            onPressIn={() => {
              if (!reducedMotion) escala.set(withSpring(Motion.pressScale, Motion.spring.snap));
            }}
            onPressOut={() => {
              if (!reducedMotion) escala.set(withSpring(1, Motion.spring.snap));
            }}
            style={({ pressed }) => [
              styles.heroAction,
              { backgroundColor: pressed ? theme.heroFooterPress : theme.heroChip },
            ]}>
            <ThemedText type="smallBold" themeColor="onHero" style={styles.actionLabel}>
              Nova conversa
            </ThemedText>
            <Icon name="arrow.up.right" size="sm" color="onHero" />
          </Pressable>
        </Animated.View>
      </View>

      <AgentPromptList onSelect={onPrompt} />
    </View>
  );
});

const styles = StyleSheet.create({
  root: { gap: Space.xxl },
  hero: {
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
    padding: Space.xl,
    overflow: 'hidden',
  },
  heroTitle: { maxWidth: 270 },
  heroDescription: { marginTop: Space.sm, maxWidth: 260 },
  heroAction: {
    minHeight: 48,
    borderRadius: Radius.pill,
    paddingHorizontal: Space.lg,
    marginTop: Space.xl,
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.md,
  },
  actionLabel: { flexShrink: 0 },
});
