import { router } from 'expo-router';
import { StyleSheet } from 'react-native';

import { ConversationScreen } from '@/components/agent/conversation-screen';
import { ConversationWorkspace } from '@/components/agent/conversation-workspace';
import { AppHeader, HeaderIconButton } from '@/components/ui/app-header';
import { Screen } from '@/components/ui/screen';
import { Space } from '@/design/tokens';
import { useAdaptiveWindow } from '@/hooks/use-adaptive-window';

/** A aba abre uma conversa nova; em janelas amplas o histórico fica ao lado. */
export default function AgentTab() {
  const { windowClass } = useAdaptiveWindow();
  const tablet = windowClass !== 'compact';

  return (
    <Screen
      scroll={false}
      wide={tablet}
      contentStyle={tablet && styles.tabletFrame}
      topBar={
        <AppHeader
          title="Agente"
          action={
            <HeaderIconButton
              icon="clock.arrow.circlepath"
              label="Histórico de conversas"
              onPress={() => router.push('/agent/history')}
            />
          }
        />
      }>
      <ConversationWorkspace>
        <ConversationScreen tabMode />
      </ConversationWorkspace>
    </Screen>
  );
}

const styles = StyleSheet.create({
  tabletFrame: { paddingHorizontal: Space.lg },
});
