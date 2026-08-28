import { Stack } from 'expo-router';

/**
 * Pilha da aba Notas.
 *
 * O Stack aninhado não é preferência: `NativeTabs` não traz header nenhum, e `<Stack.SearchBar>`
 * exige um Stack. É ele que dá large title com colapso e o "re-tap na aba volta à raiz".
 *
 * Diretório comum, NÃO grupo: `(notes)` não entraria no caminho e colidiria com a aba Hoje em `/`.
 */
export const unstable_settings = {
  initialRouteName: 'index',
};

export default function NotesStackLayout() {
  return (
    <Stack screenOptions={{ headerShadowVisible: false }}>
      <Stack.Screen name="index" options={{ title: 'Notas', headerLargeTitle: true }} />
      <Stack.Screen name="[id]" options={{ title: '' }} />
      <Stack.Screen name="folders" options={{ title: 'Pastas' }} />
      <Stack.Screen name="trash" options={{ title: 'Lixeira' }} />
    </Stack>
  );
}
