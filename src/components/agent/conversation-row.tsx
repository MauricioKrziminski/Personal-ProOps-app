import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Space, tabular } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { plainText } from '@/lib/agent-chat';
import { relativeBR } from '@/lib/dates';

interface Props {
  id: string;
  title: string;
  /** Trecho da última mensagem. Sem ele, duas conversas sobre o mesmo assunto
   *  ficam indistinguíveis na lista. */
  preview: string | null;
  updatedAt: string | null;
  onOpen: (id: string) => void;
  onLongPress: (id: string) => void;
}

/**
 * Uma conversa na lista.
 *
 * `memo` com **só primitives e callbacks estáveis** nas props: a lista é uma `FlashList` e um
 * objeto novo a cada render do pai remontaria todas as linhas visíveis a cada digitação. É por
 * isso que a linha recebe `id`, `title` e `updatedAt` soltos em vez do objeto da conversa, e por
 * isso os dois callbacks recebem o ID em vez de virem já fechados sobre ele.
 */
export const ConversationRow = memo(function ConversationRow({
  id,
  title,
  preview,
  updatedAt,
  onOpen,
  onLongPress,
}: Props) {
  const theme = useTheme();
  // O motor escreve `*R$ 45,00*` (negrito do WhatsApp). Numa linha de resumo
  // truncada isso vira asterisco na tela — e no rótulo do leitor de tela.
  const resumo = preview ? plainText(preview) : null;

  return (
    <Pressable
      onPress={() => onOpen(id)}
      onLongPress={() => onLongPress(id)}
      accessibilityRole="button"
      accessibilityLabel={resumo ? `${title}. ${resumo}` : title}
      accessibilityHint="Abre a conversa"
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed ? theme.backgroundSelected : 'transparent',
          borderBottomColor: theme.separator,
        },
      ]}>
      <View style={styles.body}>
        <ThemedText type="headline" style={styles.title}>
          {title}
        </ThemedText>
        {resumo ? (
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {resumo}
          </ThemedText>
        ) : null}
        {updatedAt ? (
          <ThemedText type="meta" themeColor="textSecondary" style={tabular}>
            {relativeBR(updatedAt)}
          </ThemedText>
        ) : null}
      </View>

      <View style={styles.chevron}>
        <Icon name="arrow.up.right" size="sm" color="textSecondary" />
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.lg,
    minHeight: 74,
    paddingVertical: Space.md,
    paddingHorizontal: Space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  body: { flex: 1, gap: Space.xs },
  title: { flexShrink: 1 },
  chevron: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
