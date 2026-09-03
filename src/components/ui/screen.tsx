import { RefreshControl, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MaxContentWidth } from '@/constants/theme';
import { Radius, Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

interface ScreenProps {
  children: React.ReactNode;
  /** `false` quando a tela é uma lista virtualizada que rola sozinha. */
  scroll?: boolean;
  /** Liga pull-to-refresh. Hoje NENHUMA tela do app tem. */
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Fundo agrupado (cinza) para telas de lista; `background` para telas de conteúdo. */
  grouped?: boolean;
  /**
   * ⚠️ **SEM USUÁRIOS desde 03/09/2026.** O `HeroPanel` virou card flutuante dentro do corpo
   * (design Stitch) e nenhuma tela sangra mais o topo. O slot e a aba de costura (`joint`)
   * continuam aqui só enquanto a decisão de dark-only e do `AppHeader` não estiver confirmada —
   * **não voltar a usar**: sob o `AppHeader` o painel sangrado empilha duas superfícies escuras
   * sem costura, que é o defeito que o card resolve.
   *
   * Conteúdo colado no topo, **sem o recuo lateral** — o painel de destaque (`HeroPanel`), que
   * sangra até as bordas.
   *
   * Existe como slot em vez de a tela resolver com margem negativa: quando cada tela inventa o
   * próprio `-16`, elas divergem em um ou dois pixels e o painel deixa de encostar. Foi assim
   * que a pílula de ação do header ficou com respiro diferente entre telas.
   */
  header?: React.ReactNode;
  /**
   * Barra fixa acima do scroll — o `AppHeader` das raízes de aba.
   *
   * Fica FORA do `ScrollView` de propósito: barra desenhada dentro dele rola junto e some, que é
   * exatamente o "header caseiro" que a regra de navegação proíbe. A tela que usa este slot
   * desliga o header do navegador (`headerShown: false`) na sua entrada do `<Stack>`.
   */
  topBar?: React.ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
}

/**
 * Raiz de tela.
 *
 * Substitui a pilha `ThemedView` + `SafeAreaView` + `ScrollView` que 21 telas repetem, cada uma
 * com um padding inferior diferente.
 *
 * Duas correções embutidas:
 * - padding inferior vem de `useSafeAreaInsets()`, não da constante fixa `BottomTabInset` (50/80);
 * - `contentInsetAdjustmentBehavior="automatic"` para o header nativo grande colapsar no scroll.
 */
export function Screen({
  children,
  scroll = true,
  onRefresh,
  refreshing = false,
  grouped = false,
  header,
  topBar,
  contentStyle,
}: ScreenProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const background = grouped ? theme.groupedBackground : theme.background;
  const padding = [styles.content, { paddingBottom: insets.bottom + Space.xxl }, contentStyle];

  if (!scroll) {
    return (
      <View style={[styles.root, { backgroundColor: background }]}>
        {topBar}
        <View style={[styles.root, contentStyle]}>{children}</View>
      </View>
    );
  }

  const scroller = (
    <ScrollView
      style={[styles.root, { backgroundColor: background }]}
      contentContainerStyle={header ? styles.bleedRoot : padding}
      contentInsetAdjustmentBehavior="automatic"
      showsVerticalScrollIndicator={false}
      refreshControl={
        onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} /> : undefined
      }>
      {header ? (
        <>
          {/*
            O `paddingTop` RESERVA a altura da aba fixa (`styles.joint`), que desenha por cima
            daqui. Sem ele a aba tapava a primeira linha do painel — o rótulo "SOBRA ATÉ O FIM DO
            MÊS" ficava cortado ao meio no topo da tela. A cor é a mesma do painel, então a faixa
            reservada não aparece como faixa: ela só engorda o preto entre o header e o rótulo.
          */}
          <View style={[styles.headerSlot, { backgroundColor: theme.heroSurface }]}>{header}</View>
          <View style={padding}>{children}</View>
        </>
      ) : (
        children
      )}
    </ScrollView>
  );

  if (topBar) {
    return (
      <View style={[styles.root, { backgroundColor: background }]}>
        {topBar}
        {scroller}
      </View>
    );
  }

  if (!header) return scroller;

  return (
    <View style={[styles.root, { backgroundColor: background }]}>
      {scroller}

      {/*
        A aba do painel que NÃO rola.

        O `HeroPanel` mora dentro do scroll, então ele saía inteiro de cena — e junto ia o
        arredondado que costura o painel com a página. Rolado, sobrava a barra preta do header
        encostando na lista numa linha reta, com a primeira linha **fatiada ao meio** por ela.
        Parecia recorte, não sobreposição.

        Esta faixa fica presa embaixo do header nativo, na mesma cor e no mesmo raio do painel.
        No topo ela é invisível (preto sobre o preto do painel, e os cantos vazados revelam o
        próprio painel atrás). Rolando, é ela que segura o encaixe: o conteúdo passa por baixo de
        uma borda arredondada em vez de ser cortado por uma reta.

        Sem listener de scroll e sem `Animated` de propósito — não há estado para animar, a peça
        simplesmente está sempre lá. Rolar é a interação mais frequente do app (`design.md` §5:
        100× por dia → o padrão da plataforma e nada mais), e um worklet por frame para desenhar
        algo que não muda seria custo sem retorno.
      */}
      <View pointerEvents="none" style={styles.jointRow}>
        <View style={[styles.joint, { backgroundColor: theme.heroSurface }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  /**
   * Com `header`, o container do scroll perde o recuo e o `paddingTop`: quem os aplica é a
   * `View` interna, abaixo do painel. Sem isto o painel nasceria com 16 de margem e uma faixa
   * de fundo acima dele.
   */
  bleedRoot: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  headerSlot: {
    paddingTop: Radius.xl,
    // O MESMO arredondado do painel: o slot é pintado de `heroSurface` e, quadrado, preenchia
    // por trás os cantos vazados do `HeroPanel` — o encaixe sumia justamente no topo da tela.
    borderBottomLeftRadius: Radius.xl,
    borderBottomRightRadius: Radius.xl,
    borderCurve: 'continuous',
  },
  /** Segue o `maxWidth` do conteúdo: em tablet a aba não pode ser mais larga que o painel. */
  jointRow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  joint: {
    width: '100%',
    maxWidth: MaxContentWidth,
    height: Radius.xl,
    borderBottomLeftRadius: Radius.xl,
    borderBottomRightRadius: Radius.xl,
    borderCurve: 'continuous',
  },
  content: {
    gap: Space.xl,
    paddingHorizontal: Space.lg,
    paddingTop: Space.md,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
});
