import { Stack } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { Screen } from '@/components/ui/screen';

/**
 * Placeholder da Task 8 — a conversa em si (composer, histórico e HITL) é a
 * próxima tarefa do plano. Existe agora porque `typedRoutes` deriva as rotas dos
 * ARQUIVOS: sem ele, `router.push('/agent/new')` não compila.
 */
export default function NewConversationScreen() {
  return (
    <Screen>
      <Stack.Screen options={{ title: '' }} />
      <ThemedText type="default">Em construção.</ThemedText>
    </Screen>
  );
}
