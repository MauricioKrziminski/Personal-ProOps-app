import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Radius, Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { EXEMPLOS_DO_AGENTE } from '@/lib/agent-prompts';

interface Props {
  onSelect: (prompt: string) => void;
}

/** Frases reais que o agente entende, compartilhadas pela entrada e pela conversa nova. */
export const AgentPromptList = memo(function AgentPromptList({ onSelect }: Props) {
  const theme = useTheme();

  return (
    <View style={styles.root}>
      <ThemedText type="subtitle" accessibilityRole="header">Pode começar assim</ThemedText>
      <View style={[styles.list, { borderColor: theme.separator }]}>
        {EXEMPLOS_DO_AGENTE.map((prompt, index) => (
          <Pressable
            key={prompt}
            accessibilityRole="button"
            accessibilityLabel={`Começar com: ${prompt}`}
            onPress={() => onSelect(prompt)}
            style={({ pressed }) => [
              styles.prompt,
              index > 0 && { borderTopColor: theme.separator, borderTopWidth: StyleSheet.hairlineWidth },
              pressed && { backgroundColor: theme.backgroundSelected },
            ]}>
            <ThemedText type="small" style={styles.text}>{prompt}</ThemedText>
            <Icon name="arrow.up.right" size="sm" color="textSecondary" />
          </Pressable>
        ))}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  root: { gap: Space.md },
  list: { borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  prompt: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.md,
    paddingHorizontal: Space.sm,
    paddingVertical: Space.sm,
    borderRadius: Radius.sm,
  },
  text: { flex: 1 },
});
