import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Radius, Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { ATALHOS_DO_AGENTE } from '@/lib/agent-prompts';

interface Props {
  onSelect: (prompt: string) => void;
}

/** Atalhos compactos, compartilhados pela entrada e pela conversa nova. */
export const AgentPromptList = memo(function AgentPromptList({ onSelect }: Props) {
  const theme = useTheme();

  return (
    <View style={styles.root}>
      <ThemedText type="smallBold" themeColor="textSecondary">Atalhos</ThemedText>
      <View style={styles.list}>
        {ATALHOS_DO_AGENTE.map(({ label, prompt, icon }) => (
          <Pressable
            key={label}
            accessibilityRole="button"
            accessibilityLabel={`${label}. Abre uma conversa com texto editável.`}
            onPress={() => onSelect(prompt)}
            style={({ pressed }) => [
              styles.prompt,
              {
                backgroundColor: pressed ? theme.backgroundSelected : theme.surface,
                borderColor: theme.cardBorder,
              },
            ]}>
            <Icon name={icon} size="xs" color="textSecondary" />
            <ThemedText type="small" style={styles.text}>{label}</ThemedText>
          </Pressable>
        ))}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  root: { gap: Space.md },
  list: { width: '100%', maxWidth: 450, flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  prompt: {
    width: '48%',
    minWidth: 0,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    paddingHorizontal: Space.md,
    paddingVertical: Space.sm,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  text: { flexShrink: 1 },
});
