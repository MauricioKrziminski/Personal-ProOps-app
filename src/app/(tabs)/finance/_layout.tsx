import { Stack } from 'expo-router';

/**
 * Pilha da aba Financeiro — **uma tela só: a raiz**.
 *
 * ## Por que as outras 17 saíram daqui (07/09/2026)
 *
 * Aninhada dentro de `(tabs)`, toda tela empurrada continuava **por baixo da tab bar** — a dock
 * ficava visível dentro da fatura, do editor de nota, da conversa do agente. A queixa foi
 * literal: *"a navbar em baixo só deve aparecer nas telas iniciais, em nenhum momento que eu
 * entro em uma tela secundária ela deve ficar visível"*.
 *
 * **Não existe chave para esconder a barra numa tela.** No iOS a `NativeTabs` é a barra do
 * sistema e não expõe isso; no Android a `CurvedTabBar` é nossa, mas esconder só lá deixaria as
 * duas plataformas com navegação diferente. O que a doc do Expo manda fazer para "detail screen
 * overlays the tab bar" é exatamente esta mudança: a rota de detalhe vai para o `<Stack>` da
 * RAIZ (`src/app/_layout.tsx`), que fica ACIMA do grupo de abas.
 *
 * **A URL não mudou.** `(tabs)` é um GRUPO e nunca entrou no caminho, então
 * `src/app/(tabs)/finance/cards.tsx` e `src/app/finance/cards.tsx` são os dois `/finance/cards` —
 * nenhum `router.push` precisou ser reescrito.
 */
export const unstable_settings = {
  initialRouteName: 'index',
};

export default function FinanceStackLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      {/* A raiz desenha o `AppHeader` (design Stitch): sem título de tela, sem large title. */}
      <Stack.Screen name="index" />
    </Stack>
  );
}
