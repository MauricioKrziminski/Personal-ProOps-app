import { Stack } from 'expo-router';

import { stackHeaderFonts } from '@/components/ui/app-header';

/**
 * Pilha da aba Agente.
 *
 * Diretório comum, NÃO grupo: `(agent)` não entraria no caminho e colidiria com a aba Hoje em `/`.
 *
 * A raiz é a lista de conversas e desenha o `AppHeader` (por isso `headerShown: false`); `new` e
 * `[id]` são telas EMPURRADAS e ficam com o header nativo, que é onde o "voltar" mora.
 */
export const unstable_settings = {
  initialRouteName: 'index',
};

export default function AgentStackLayout() {
  return (
    <Stack screenOptions={{ headerShadowVisible: false, ...stackHeaderFonts }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      {/*
        Sem título nas duas: em `new` o conteúdo é o campo de texto vazio e um título
        ("Nova conversa") repetiria o que o `+` do header anterior já disse; em `[id]` o título
        é o nome da conversa, que só é conhecido depois da query — escrever um provisório faria
        a barra trocar de texto na frente do usuário.
      */}
      <Stack.Screen name="new" options={{ title: '' }} />
      <Stack.Screen name="[id]" options={{ title: '' }} />
    </Stack>
  );
}
