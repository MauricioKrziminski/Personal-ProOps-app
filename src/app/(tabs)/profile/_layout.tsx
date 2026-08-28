import { Stack } from 'expo-router';

/** Pilha da aba Perfil — `NativeTabs` não tem header próprio. */
export const unstable_settings = { initialRouteName: 'index' };

export default function ProfileStackLayout() {
  return (
    <Stack screenOptions={{ headerShadowVisible: false }}>
      <Stack.Screen name="index" options={{ title: 'Perfil', headerLargeTitle: true }} />
    </Stack>
  );
}
