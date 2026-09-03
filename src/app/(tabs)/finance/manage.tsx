import { Stack, router, type Href } from 'expo-router';
import type { SymbolViewProps } from 'expo-symbols';

import { Row, Section } from '@/components/ui/row';
import { Screen } from '@/components/ui/screen';

/**
 * Gerenciar — o menu que terminava a aba Financeiro.
 *
 * Os 12 destinos empilhados no rodapé do resumo obrigavam a rolar a tela toda para alcançar
 * qualquer um deles e transformavam o fim do painel num menu de configurações. Aqui eles têm
 * tela própria, agrupados por intenção; o resumo ficou com os quatro atalhos mais abertos.
 *
 * Agrupar não é enfeite: doze linhas seguidas se leem como parede, e a pessoa que veio ver a
 * fatura não deveria passar o olho por "Relatórios e IR" no caminho.
 */
type ManageItem = { title: string; icon: SymbolViewProps['name']; href: Href };

const GROUPS: { title: string; items: ManageItem[] }[] = [
  {
    title: 'Dia a dia',
    items: [
      { title: 'Todos os lançamentos', icon: 'list.bullet', href: '/finance/transactions' },
      { title: 'Contas e carteiras', icon: 'wallet.pass', href: '/finance/accounts' },
      { title: 'Cartões e faturas', icon: 'creditcard', href: '/finance/cards' },
      { title: 'Faturas anteriores', icon: 'calendar', href: '/finance/invoices' },
      { title: 'Compras parceladas', icon: 'creditcard.and.123', href: '/finance/installments' },
    ],
  },
  {
    title: 'Planejamento',
    items: [
      { title: 'Orçamentos', icon: 'chart.pie', href: '/finance/budgets' },
      { title: 'Metas', icon: 'target', href: '/finance/goals' },
      { title: 'Dívidas', icon: 'dollarsign.circle', href: '/finance/debts' },
      { title: 'Recorrentes', icon: 'arrow.triangle.2.circlepath', href: '/finance/recurring' },
    ],
  },
  {
    title: 'Panorama',
    items: [
      { title: 'Patrimônio', icon: 'building.columns', href: '/finance/net-worth' },
      { title: 'Relatórios e IR', icon: 'chart.bar', href: '/finance/reports' },
    ],
  },
  {
    /**
     * Vieram do menu "…" do header do resumo, que sumiu quando a raiz passou a usar o
     * `AppHeader` do design Stitch. É o lugar certo: são ações de manutenção, e os irmãos
     * delas já moravam aqui.
     */
    title: 'Entrada de dados',
    items: [
      { title: 'Importar extrato', icon: 'square.and.arrow.down', href: '/import' },
      { title: 'Regras de categoria', icon: 'line.3.horizontal.decrease', href: '/finance/rules' },
    ],
  },
  {
    title: 'Conta',
    items: [{ title: 'Plano e família', icon: 'person.2', href: '/finance/plan' }],
  },
];

export default function ManageScreen() {
  return (
    <Screen grouped>
      <Stack.Screen options={{ title: 'Gerenciar', headerLargeTitle: true }} />

      {GROUPS.map((group) => (
        <Section key={group.title} title={group.title}>
          {group.items.map((item) => (
            <Row
              key={item.title}
              title={item.title}
              icon={item.icon}
              onPress={() => router.push(item.href)}
            />
          ))}
        </Section>
      ))}
    </Screen>
  );
}
