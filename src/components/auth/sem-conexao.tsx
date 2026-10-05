import { StyleSheet } from 'react-native';

import { ThemedView } from '@/components/themed-view';
import { EmptyState } from '@/components/ui/empty-state';

/** Abertura sem rede com a sessão ainda gravada: nunca o login (a pessoa continua logada). */
export function SemConexao({ onRetry }: { onRetry: () => void }) {
  return (
    <ThemedView style={styles.tela}>
      <EmptyState
        icon="wifi.slash"
        title="Sem conexão"
        action={{ label: 'Tentar de novo', onPress: onRetry }}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({ tela: { flex: 1, justifyContent: 'center' } });
