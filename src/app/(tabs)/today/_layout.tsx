import { Stack } from 'expo-router';

/** Pilha da aba Hoje — `NativeTabs` não tem header próprio. */
export const unstable_settings = { initialRouteName: 'index' };

export default function TodayStackLayout() {
  return (
    <Stack screenOptions={{ headerShadowVisible: false }}>
      <Stack.Screen name="index" options={{ title: 'Hoje', headerLargeTitle: true }} />
    </Stack>
  );
}
