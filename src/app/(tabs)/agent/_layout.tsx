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
    /*
      `headerBackTitle` é iOS: lá o botão "voltar" carrega o TÍTULO da tela
      anterior, e a raiz desta pilha esconde o header — então ela não tem título e
      o sistema caía no nome do ARQUIVO da rota. O botão dizia "index", que é o
      tipo de coisa que só aparece quando alguém abre o simulador. No Android o
      voltar é uma seta sem texto e a opção é ignorada.
    */
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        headerBackTitle: 'Agente',
        ...stackHeaderFonts,
      }}>
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
