import { router } from 'expo-router';

import { ConversationScreen } from '@/components/agent/conversation-screen';
import { AppHeader, HeaderIconButton } from '@/components/ui/app-header';
import { Screen } from '@/components/ui/screen';

/** A aba é sempre uma conversa nova. O histórico fica em uma tela independente. */
export default function AgentTab() {
  return (
    <Screen
      scroll={false}
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
      <ConversationScreen tabMode />
    </Screen>
  );
}
