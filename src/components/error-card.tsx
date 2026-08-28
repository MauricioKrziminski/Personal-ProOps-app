import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import * as Haptics from 'expo-haptics';

import { GlassCard } from '@/components/glass/glass-card';
import { Icon } from '@/components/ui/icon';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Estado de loading padrão das telas. */
export function LoadingCard() {
  const theme = useTheme();
  return (
    <GlassCard style={styles.card}>
      <ActivityIndicator color={theme.tint} />
      <ThemedText type="small" themeColor="textSecondary">
        Carregando…
      </ThemedText>
    </GlassCard>
  );
}

/** Estado de erro padrão das telas — obrigatório junto com loading/empty. */
export function ErrorCard({ onRetry }: { onRetry: () => void }) {
  const theme = useTheme();
  return (
    <GlassCard style={styles.card}>
      <Icon name="exclamationmark.triangle" size="xl" color="warning" />
      <ThemedText type="smallBold">Algo deu errado</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
        Não conseguimos carregar os dados agora.
      </ThemedText>
      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onRetry();
        }}
        style={({ pressed }) => [
          styles.button,
          { backgroundColor: theme.tint, opacity: pressed ? 0.8 : 1 },
        ]}>
        <ThemedText type="smallBold" themeColor="onTint">
          Tentar de novo
        </ThemedText>
      </Pressable>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.five,
  },
  hint: {
    textAlign: 'center',
  },
  button: {
    marginTop: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.three,
  },
});
