import { Stack } from 'expo-router';

import { heroHeaderOptions } from '@/components/ui/hero-panel';
import { useTheme } from '@/hooks/use-theme';

/** Pilha da aba Hoje — `NativeTabs` não tem header próprio. */
export const unstable_settings = { initialRouteName: 'index' };

export default function TodayStackLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
    </Stack>
  );
}
