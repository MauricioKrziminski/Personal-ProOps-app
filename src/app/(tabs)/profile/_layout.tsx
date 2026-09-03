import { Stack } from 'expo-router';

/** Pilha da aba Perfil — `NativeTabs` não tem header próprio. */
export const unstable_settings = { initialRouteName: 'index' };

export default function ProfileStackLayout() {
  return (
    <Stack screenOptions={{ headerShadowVisible: false }}>
      {/* A raiz desenha o `AppHeader` (design Stitch): sem título de tela, sem large title. */}
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="members" options={{ title: 'Pessoas' }} />
    </Stack>
  );
}
