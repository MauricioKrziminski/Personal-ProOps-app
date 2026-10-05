import { Stack } from 'expo-router';

import { CongelaForaDeFoco } from '@/components/ui/congela-fora-de-foco';

/** Pilha da aba Hoje — `NativeTabs` não tem header próprio. */
export const unstable_settings = { initialRouteName: 'index' };

export default function TodayStackLayout() {
  return (
    <CongelaForaDeFoco>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
      </Stack>
    </CongelaForaDeFoco>
  );
}
