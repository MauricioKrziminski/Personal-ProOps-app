import { Stack } from 'expo-router';

import { stackHeaderFonts } from '@/components/ui/app-header';

/**
 * Pilha da aba Financeiro.
 *
 * `NativeTabs` não traz header nenhum — a doc do Expo é explícita: para ter title e navegação
 * dentro de uma aba é preciso aninhar um `<Stack>`. É isto que substitui o `ScreenHeader`
 * caseiro (um `‹` desenhado como texto) que as 15 telas repetiam.
 */
export const unstable_settings = {
  initialRouteName: 'index',
};

export default function FinanceStackLayout() {
  return (
    <Stack
      screenOptions={{
        // Large title + blur entram tela a tela na fase 4, quando cada uma migrar para o
        // primitivo `Screen` (o colapso exige o ScrollView como primeiro filho).
        headerShadowVisible: false,
        ...stackHeaderFonts,
      }}>
      {/* A raiz desenha o `AppHeader` (design Stitch): sem título de tela, sem large title. */}
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="transactions" options={{ title: 'Lançamentos' }} />
      <Stack.Screen name="[txId]" options={{ title: 'Lançamento' }} />
      <Stack.Screen name="accounts" options={{ title: 'Contas' }} />
      <Stack.Screen name="cards" options={{ title: 'Cartões' }} />
      <Stack.Screen name="invoice/[id]" options={{ title: 'Fatura' }} />
      <Stack.Screen name="invoices" options={{ title: 'Faturas' }} />
      <Stack.Screen name="installments" options={{ title: 'Parceladas' }} />
      <Stack.Screen name="budgets" options={{ title: 'Orçamentos' }} />
      <Stack.Screen name="goals" options={{ title: 'Metas' }} />
      <Stack.Screen name="debts" options={{ title: 'Dívidas' }} />
      <Stack.Screen name="recurring" options={{ title: 'Recorrentes' }} />
      <Stack.Screen name="forecast" options={{ title: 'Projeção' }} />
      <Stack.Screen name="reports" options={{ title: 'Relatórios' }} />
      <Stack.Screen name="net-worth" options={{ title: 'Patrimônio' }} />
      <Stack.Screen name="rules" options={{ title: 'Regras' }} />
      <Stack.Screen name="manage" options={{ title: 'Gerenciar' }} />
      <Stack.Screen name="plan" options={{ title: 'Plano e família' }} />
    </Stack>
  );
}
