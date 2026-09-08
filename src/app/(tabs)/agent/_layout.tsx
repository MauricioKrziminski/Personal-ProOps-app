import { Stack } from 'expo-router';

/**
 * Pilha da aba Agente — **uma tela só: a raiz**.
 *
 * As telas empurradas saíram de `(tabs)` em 07/09/2026 e foram para o `<Stack>` da RAIZ, para a
 * tab bar não aparecer dentro delas. O motivo completo está em `(tabs)/finance/_layout.tsx`; o
 * resumo é que não existe chave para esconder a barra numa tela (a `NativeTabs` do iOS é a do
 * sistema), e a doc do Expo manda pôr a rota de detalhe no stack raiz. A URL não mudou, porque
 * `(tabs)` é um grupo e nunca entrou no caminho.
 */
export const unstable_settings = {
  initialRouteName: 'index',
};

export default function AgentStackLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      {/* A raiz desenha o `AppHeader` (design Stitch). */}
      <Stack.Screen name="index" />
    </Stack>
  );
}
