import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { Platform } from 'react-native';

import { useBudgetsStatus, useUpcomingBills } from '@/hooks/use-finance';
import { useTodayReminders } from '@/hooks/use-items';
import { useTheme } from '@/hooks/use-theme';

// No iOS 26+ a NativeTabs renderiza a tab bar nativa em Liquid Glass —
// diretriz central de design do Personal ProOps app. SF Symbols no iOS; Material glyphs no Android.
const TABS = [
  { name: 'today', label: 'Hoje', sf: { default: 'sun.max', selected: 'sun.max.fill' }, md: 'today' },
  { name: 'notes', label: 'Notas', sf: { default: 'note.text', selected: 'note.text' }, md: 'description' },
  { name: 'finance', label: 'Financeiro', sf: { default: 'chart.pie', selected: 'chart.pie.fill' }, md: 'pie_chart' },
  { name: 'agent', label: 'Agente', sf: { default: 'bubble.left.and.bubble.right', selected: 'bubble.left.and.bubble.right.fill' }, md: 'forum' },
  { name: 'profile', label: 'Perfil', sf: { default: 'person', selected: 'person.fill' }, md: 'person' },
] as const;

/**
 * A tab bar.
 *
 * ## `backgroundColor` é iOS-proibido, e isso não é detalhe
 *
 * A versão anterior passava `backgroundColor` sempre. No iOS, dar cor de fundo à `NativeTabs`
 * **torna a barra opaca e desliga o Liquid Glass** — o material que é diretriz de design do
 * projeto estava sendo suprimido por uma linha que só existia para o Android. Agora cor de fundo,
 * indicador e ripple são `Platform.select` para Android; no iOS o sistema desenha o vidro.
 *
 * ## O que a deixou menos crua
 *
 * - **Badge com contagem** no Hoje: o que vence, o lembrete de hoje e o orçamento estourado. É
 *   informação, não enfeite — a mesma régua dos atalhos do painel, onde tile sem número é botão
 *   morto. Sem nada pendente o badge não aparece.
 * - **`minimizeBehavior: 'onScrollDown'`** (iOS 26): a barra encolhe ao rolar e volta ao subir.
 *   É comportamento nativo do sistema, não animação nossa.
 * - **Ícone com estado explícito** (`iconColor` default/selected): com o accent monocromático o
 *   selecionado é tinta e o resto é secundário. Antes só o rótulo mudava de cor, e o ícone ficava
 *   igual nos dois estados.
 * - **`labelVisibilityMode: 'labeled'`** (Android): o padrão do Material 3 esconde o rótulo das
 *   abas não selecionadas. Com quatro destinos e ícones que não são universais ("pie_chart" para
 *   Financeiro), esconder o texto obriga a decorar ícone.
 *
 * ## Cinco destinos desde 04/09/2026
 *
 * O Agente entrou entre Financeiro e Perfil: ele é uso, não configuração. A ordem é a mesma nas
 * TRÊS implementações, e `agent-navigation.test.ts` quebra o build se divergirem — no Android o
 * índice do slot vem da posição, então uma aba fora de ordem manda a pessoa para a tela errada
 * enquanto a barra anima para o lugar certo.
 */
export default function AppTabs() {
  const theme = useTheme();

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

  return (
    <NativeTabs
      // iOS: nada de cor de fundo — é o que preserva o Liquid Glass do sistema.
      {...Platform.select({
        android: {
          backgroundColor: theme.background,
          indicatorColor: theme.accentSoft,
          rippleColor: theme.accentSoft,
          labelVisibilityMode: 'labeled' as const,
        },
        default: { minimizeBehavior: 'onScrollDown' as const },
      })}
      iconColor={{ default: theme.textSecondary, selected: theme.tint }}
      badgeBackgroundColor={theme.danger}
      labelStyle={{
        default: { color: theme.textSecondary },
        selected: { color: theme.tint },
      }}>
      {TABS.map((tab) => (
        <NativeTabs.Trigger key={tab.name} name={tab.name}>
          <NativeTabs.Trigger.Label>{tab.label}</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf={tab.sf} md={tab.md} />
          {tab.name === 'today' ? (
            <NativeTabs.Trigger.Badge hidden={pendentes === 0}>
              {String(pendentes)}
            </NativeTabs.Trigger.Badge>
          ) : null}
        </NativeTabs.Trigger>
      ))}
    </NativeTabs>
  );
}
