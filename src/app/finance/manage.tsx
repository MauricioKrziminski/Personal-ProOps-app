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
/**
 * ⚠️ **O `title` é o título da tela de DESTINO, palavra por palavra.**
 *
 * Nove linhas daqui prometiam um nome e entregavam outro — você tocava em "Contas e carteiras"
 * e chegava em "Contas", tocava em "Plano e família" e chegava em "Plano" (e "família" não
 * existe em lugar nenhum do app; o equivalente chama-se "Pessoas"). Para quem não construiu o
 * app isso é a dúvida "cliquei errado?" nove vezes, e quem manda é o `_layout.tsx`: é o nome
 * dele que aparece no header e no botão voltar.
 *
 * O que a linha precisa dizer A MAIS vai no `subtitle`, que é onde contexto cabe sem disputar
 * com o nome do lugar.
 */
type ManageItem = {
  title: string;
  subtitle?: string;
  icon: SymbolViewProps['name'];
  href: Href;
};

const GROUPS: { title: string; items: ManageItem[] }[] = [
  {
    title: 'Dia a dia',
    items: [
      { title: 'Lançamentos', subtitle: 'Tudo que entrou e saiu, com filtros', icon: 'list.bullet', href: '/finance/transactions' },
      { title: 'Contas', subtitle: 'Contas correntes, poupança e dinheiro', icon: 'wallet.pass', href: '/finance/accounts' },
      { title: 'Cartões', subtitle: 'Limite, fechamento e a fatura de cada um', icon: 'creditcard', href: '/finance/cards' },
      { title: 'Faturas', subtitle: 'As que já fecharam e as que estão por vir', icon: 'calendar', href: '/finance/invoices' },
      { title: 'Parceladas', subtitle: 'Suas compras parceladas e o que falta pagar', icon: 'creditcard.and.123', href: '/finance/installments' },
    ],
  },
  {
    title: 'Planejamento',
    items: [
      { title: 'Orçamentos', icon: 'chart.pie', href: '/finance/budgets' },
      { title: 'Metas', icon: 'target', href: '/finance/goals' },
      { title: 'Dívidas', subtitle: 'Empréstimos e financiamentos, com os juros', icon: 'dollarsign.circle', href: '/finance/debts' },
      { title: 'Recorrentes', icon: 'arrow.triangle.2.circlepath', href: '/finance/recurring' },
    ],
  },
  {
    title: 'Panorama',
    items: [
      { title: 'Entradas e saídas', icon: 'calendar', href: '/finance/month' },
      { title: 'Patrimônio', icon: 'building.columns', href: '/finance/net-worth' },
      { title: 'Relatórios', subtitle: 'Exportar o ano, inclusive para o IR', icon: 'chart.bar', href: '/finance/reports' },
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
      { title: 'Regras', subtitle: 'Categoria automática por palavra', icon: 'line.3.horizontal.decrease', href: '/finance/rules' },
    ],
  },
  {
    title: 'Conta',
    items: [{ title: 'Plano', subtitle: 'Assinatura e quem mais usa com você', icon: 'person.2', href: '/finance/plan' }],
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
              subtitle={item.subtitle}
              icon={item.icon}
              onPress={() => router.push(item.href)}
            />
          ))}
        </Section>
      ))}
    </Screen>
  );
}
