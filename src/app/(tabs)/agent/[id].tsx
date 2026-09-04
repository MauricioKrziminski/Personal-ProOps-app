import { Stack } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { Screen } from '@/components/ui/screen';

/** Placeholder da Task 8 — ver `new.tsx`. */
export default function ConversationScreen() {
  return (
    <Screen>
      <Stack.Screen options={{ title: '' }} />
      <ThemedText type="default">Em construção.</ThemedText>
    </Screen>
  );
}
