import { StyleSheet, View } from 'react-native';
import type { SymbolViewProps } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Space } from '@/design/tokens';

interface EmptyStateProps {
  /** SF Symbol. Emoji é proibido aqui — era o padrão antigo em 15 telas. */
  icon: SymbolViewProps['name'];
  title: string;
  /** A dica ACIONÁVEL. Normalmente o atalho do WhatsApp que preenche esta tela. */
  hint?: string;
  action?: { label: string; onPress: () => void };
}

/**
 * Empty state composto.
 *
 * Regra: cada causa de vazio tem o seu. "Nunca teve nada" e "o filtro não achou" são telas
 * diferentes — dizer "nada anotado ainda" para quem tem 200 notas filtradas é mentira.
 */
export function EmptyState({ icon, title, hint, action }: EmptyStateProps) {
  return (
    <View style={styles.container}>
      <Icon name={icon} size="xl" color="textSecondary" />
      <ThemedText type="headline" style={styles.centered}>
        {title}
      </ThemedText>
      {hint ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.centered}>
          {hint}
        </ThemedText>
      ) : null}
      {action ? (
        <Button label={action.label} onPress={action.onPress} size="sm" />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: Space.md,
    paddingVertical: Space.xxxl,
    paddingHorizontal: Space.xl,
  },
  centered: {
    textAlign: 'center',
  },
});
