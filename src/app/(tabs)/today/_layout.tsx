import { Stack } from 'expo-router';

/** Pilha da aba Hoje — `NativeTabs` não tem header próprio. */
export const unstable_settings = { initialRouteName: 'index' };

export default function TodayStackLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
    </Stack>
  );
}
