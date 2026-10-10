import { Linking, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Space } from '@/design/tokens';
import { useDecisaoDeVersao } from '@/hooks/use-app-config';

/**
 * Versão abaixo do mínimo (`app_config.min_version_*`): esta tela toma o lugar do app inteiro
 * (`_layout.tsx`). Não é rota empilhada, então não tem "voltar" nem fechar.
 */
export default function TelaAtualizar() {
  const { url } = useDecisaoDeVersao();
  const insets = useSafeAreaInsets();
  return (
    <ThemedView style={[styles.tela, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.bloco}>
        <Icon name="arrow.down.circle" size="xl" color="textSecondary" />
        <ThemedText type="title" style={styles.centro}>Atualize o ProOps</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.centro}>
          Esta versão não funciona mais. Instale a mais recente para continuar.
        </ThemedText>
        {url ? <Button label="Atualizar" style={styles.botao} onPress={() => { void Linking.openURL(url).catch(() => {}); }} /> : null}
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  tela: { flex: 1, justifyContent: 'center', paddingHorizontal: Space.xl },
  bloco: { alignItems: 'center', gap: Space.lg },
  centro: { textAlign: 'center' },
  botao: { alignSelf: 'center' },
});
