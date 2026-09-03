import { router, useSegments } from 'expo-router';
import { TabList, TabSlot, TabTrigger, Tabs } from 'expo-router/ui';
import { StyleSheet } from 'react-native';

import { CurvedTabBar, type CurvedTab } from '@/components/ui/curved-tab-bar';
import { useBudgetsStatus, useUpcomingBills } from '@/hooks/use-finance';
import { useTodayReminders } from '@/hooks/use-items';
import { useTheme } from '@/hooks/use-theme';

const TABS: CurvedTab[] = [
  { name: 'today', label: 'Hoje', icon: 'sun.max' },
  { name: 'notes', label: 'Notas', icon: 'note.text' },
  { name: 'finance', label: 'Financeiro', icon: 'chart.pie' },
  { name: 'profile', label: 'Perfil', icon: 'person' },
];

const HREFS = ['/today', '/notes', '/finance', '/profile'] as const;

/**
 * A tab bar do **Android** — a pílula com berço deslizante (`CurvedTabBar`).
 *
 * Arquivo por plataforma porque o que muda é a IMPLEMENTAÇÃO inteira, não um valor: o iOS usa
 * `NativeTabs` (Liquid Glass do sistema, `app-tabs.tsx`) e aqui a árvore é outra — o `Tabs`
 * headless de `expo-router/ui`, que é o único que deixa desenhar a barra do zero. É o mecanismo
 * nº 1 de `frontend.md`, e o Metro nem inclui este arquivo no bundle do iOS.
 *
 * A `TabList` precisa ser renderizada mesmo invisível: é ela que registra as rotas e os `href`.
 * Escondê-la com `display: 'none'` é o padrão documentado pelo Expo para barra customizada.
 *
 * A aba ativa sai dos SEGMENTOS da rota, não de um estado local: assim uma navegação vinda de
 * qualquer outro lugar (notificação, link do WhatsApp, `router.push` de uma tela) move o berço
 * junto. Estado próprio dessincronizaria em silêncio.
 */
export default function AppTabs() {
  const theme = useTheme();
  const segments = useSegments();

  // As mesmas queries das telas — o TanStack Query dedupe e serve do cache, então o badge não
  // custa requisição a mais.
  const bills = useUpcomingBills(7);
  const reminders = useTodayReminders();
  const budgets = useBudgetsStatus();

  const pendentes =
    (bills.data ?? []).length +
    (reminders.data ?? []).length +
    (budgets.data ?? []).filter(
      (b) => Number(b.limit_cents) > 0 && Number(b.spent_cents) / Number(b.limit_cents) >= 1
    ).length;

  const atual = Math.max(
    0,
    TABS.findIndex((t) => (segments as string[]).includes(t.name))
  );

  const tabs = TABS.map((t) => (t.name === 'today' ? { ...t, badge: pendentes } : t));

  return (
    <Tabs style={{ backgroundColor: theme.background }}>
      <TabSlot />

      <CurvedTabBar
        tabs={tabs}
        activeIndex={atual}
        onSelect={(i) => router.navigate(HREFS[i])}
      />

      <TabList style={styles.hidden}>
        {TABS.map((tab, i) => (
          <TabTrigger key={tab.name} name={tab.name} href={HREFS[i]} />
        ))}
      </TabList>
    </Tabs>
  );
}

const styles = StyleSheet.create({
  /** Registra as rotas sem ocupar espaço — o padrão do Expo para barra customizada. */
  hidden: { display: 'none' },
});
