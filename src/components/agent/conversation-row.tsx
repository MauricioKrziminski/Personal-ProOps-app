import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Radius, Space, tabular } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
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

  return (
    <Pressable
      onPress={() => onOpen(id)}
      onLongPress={() => onLongPress(id)}
      accessibilityRole="button"
      accessibilityLabel={preview ? `${title}. ${preview}` : title}
      accessibilityHint="Abre a conversa"
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement,
          // O contorno é a assinatura do design e não é enfeite: no fundo
          // quase-preto a sombra some, e sem ele a lista lê como um bloco só.
          borderColor: theme.cardBorder,
        },
      ]}>
      <View style={[styles.glyph, { backgroundColor: theme.accentSoft }]}>
        <Icon name="bubble.left.and.bubble.right" size="sm" color="tint" />
      </View>

      <View style={styles.body}>
        {/* Uma linha só: título longo é comum (ele sai da primeira frase da mensagem) e
            quebrar em duas mudaria a altura da linha item a item. */}
        <ThemedText type="default" numberOfLines={1} style={styles.title}>
          {title}
        </ThemedText>
        {preview ? (
          <ThemedText type="caption" themeColor="textSecondary" numberOfLines={1}>
            {preview}
          </ThemedText>
        ) : null}
        {updatedAt ? (
          <ThemedText type="meta" themeColor="textSecondary" style={tabular}>
            {relativeBR(updatedAt)}
          </ThemedText>
        ) : null}
      </View>

      <Icon name="chevron.right" size="sm" color="textSecondary" />
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingVertical: Space.md,
    paddingHorizontal: Space.lg,
    borderRadius: Radius.md,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
  },
  glyph: {
    width: 36,
    height: 36,
    borderRadius: Radius.sm,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: 2 },
  title: { flexShrink: 1 },
});
