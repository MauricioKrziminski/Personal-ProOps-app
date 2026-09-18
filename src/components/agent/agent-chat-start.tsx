import { memo, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { AgentPromptList } from '@/components/agent/agent-prompt-list';
import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth } from '@/constants/theme';
import { Space } from '@/design/tokens';

interface Props {
  onSelectPrompt: (prompt: string) => void;
  composer?: ReactNode;
  turn?: ReactNode;
}

/** Estado inicial da conversa; tocar uma frase apenas preenche o campo. */
export const AgentChatStart = memo(function AgentChatStart({ onSelectPrompt, composer, turn }: Props) {
  return (
    <View style={styles.root}>
      <View style={styles.intro}>
        <ThemedText type="title" accessibilityRole="header">
          Pode falar do seu jeito.
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Conte o que aconteceu ou pergunte o que precisa saber. O agente ajuda a organizar.
        </ThemedText>
      </View>
      {composer}
      {turn ?? <AgentPromptList onSelect={onSelectPrompt} />}
    </View>
  );
});

const styles = StyleSheet.create({
  root: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', paddingHorizontal: Space.lg, paddingTop: Space.xxxl, gap: Space.xxl },
  intro: { gap: Space.md, maxWidth: 330 },
});
