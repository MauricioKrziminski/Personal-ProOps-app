import { StyleSheet } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Mark } from '@/components/ui/mark';
import { ThemedText } from '@/components/themed-text';
import { Space } from '@/design/tokens';

/**
 * Loading e erro padrão das telas.
 *
 * Passou a usar os primitivos em vez de reimplementá-los: o botão era um `Pressable` estilizado à
 * mão (sem o press-in, sem a altura de alvo, com `Spacing` legado e raio fora da escala) e o
 * spinner era o `ActivityIndicator` do sistema. Componente de estado padrão que não usa o design
 * system é o lugar mais fácil de a inconsistência entrar, porque ele aparece em dezenas de telas.
 */

/** Estado de loading padrão das telas. */
export function LoadingCard() {
  return (
    <Card style={styles.card}>
      {/* A espiral da marca, não o spinner do sistema — o mesmo carregamento do `Button`. */}
      <Mark size={28} color="textSecondary" spinning />
      <ThemedText type="small" themeColor="textSecondary">
        Carregando…
      </ThemedText>
    </Card>
  );
}

/** Estado de erro padrão das telas — obrigatório junto com loading/empty. */
export function ErrorCard({ onRetry }: { onRetry: () => void }) {
  return (
    <Card style={styles.card}>
      <Icon name="exclamationmark.triangle" size="xl" color="warning" />
      <ThemedText type="headline">Não deu para carregar</ThemedText>
      {/*
        ⚠️ `alignSelf` explícito: sem `block`, o `Button` traz `alignSelf: 'flex-start'` (para
        um pai com `alignItems: 'stretch'` não o esticar) e isso GANHA do `alignItems: 'center'`
        do card — o botão nascia colado na borda esquerda embaixo de um texto centralizado. É o
        mesmo defeito que já estava corrigido no `EmptyState` e na cortina de bloqueio; este é o
        terceiro e último lugar do app onde um `Button` mora dentro de um container centralizado.
      */}
      <Button label="Tentar de novo" onPress={onRetry} size="sm" style={styles.retry} />
    </Card>
  );
}

const styles = StyleSheet.create({
  retry: { alignSelf: 'center' },
  card: {
    alignItems: 'center',
    gap: Space.sm,
    paddingVertical: Space.xxl,
  },
});
