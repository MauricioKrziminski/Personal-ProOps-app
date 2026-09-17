import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { AgentHomeComposer } from '@/components/agent/agent-home-composer';
import { AgentPromptList } from '@/components/agent/agent-prompt-list';
import { ThemedText } from '@/components/themed-text';
import { Space } from '@/design/tokens';

interface Props {
  onPrompt: (prompt: string) => void;
}

/**
 * A entrada é uma conversa pronta para começar. O histórico é independente e
 * pode carregar depois sem atrasar o campo nem apagar um texto em edição.
 */
export const AgentHomeHeader = memo(function AgentHomeHeader({ onPrompt }: Props) {
  return (
    <View style={styles.root}>
      <View style={styles.intro}>
        <ThemedText type="title" accessibilityRole="header">
          Como posso ajudar?
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.description}>
          Anote um gasto, crie um lembrete ou pergunte sobre suas finanças.
        </ThemedText>
      </View>

      <AgentHomeComposer />
      <AgentPromptList onSelect={onPrompt} />
    </View>
  );
});

const styles = StyleSheet.create({
  root: { width: '100%', maxWidth: 620, gap: Space.xl },
  intro: { gap: Space.sm },
  description: { maxWidth: 340 },
});
