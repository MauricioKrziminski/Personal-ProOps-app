import {
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MaxContentWidth } from '@/constants/theme';
import { useAppHeaderHeight } from '@/components/ui/app-header';
import { CURVED_BAR_SPACE } from '@/components/ui/curved-tab-bar';

import { Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

/**
 * Quanto um FAB come do fim do conteúdo: a altura do botão `md` (48) mais um respiro.
 * Não é `CURVED_BAR_CLEARANCE` — aquele é onde o FAB COMEÇA; este é o que ele OCUPA.
 */
const FAB_CLEARANCE = 48 + 16;

interface ScreenProps {
  children: React.ReactNode;
  /** `false` quando a tela é uma lista virtualizada que rola sozinha. */
  scroll?: boolean;
  /**
   * A tela tem um botão FLUTUANTE (FAB) por cima do conteúdo.
   *
   * Conteúdo pode passar por baixo da tab bar — o desfoque dela depende disso. Por baixo do FAB,
   * não: ele é opaco e tem sombra, então o que passar embaixo fica ILEGÍVEL. Era o que acontecia
   * no Financeiro vazio, com o "Lançar" cobrindo a última linha do estado vazio.
   */
  floatingAction?: boolean;
  /** Liga pull-to-refresh. */
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Fundo agrupado para telas de lista; `background` para telas de conteúdo. */
  grouped?: boolean;
  /**
   * A barra de marca das raízes de aba (`AppHeader`).
   *
   * Ela é **sobreposta** — desenha por cima do scroll para desfocar o que passa por baixo — e é
   * este slot que reserva a altura dela no `paddingTop` do conteúdo. Passar o header por fora do
   * slot deixaria a primeira linha da tela escondida atrás da faixa.
   */
  topBar?: React.ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
}

/**
 * Raiz de tela.
 *
 * Substitui a pilha `ThemedView` + `SafeAreaView` + `ScrollView` que 21 telas repetem, cada uma
 * com um padding inferior diferente. O padding vem de `useSafeAreaInsets()`, não de constante
 * fixa, e o Android ainda soma a altura da `CurvedTabBar`, que é absoluta.
 */
export function Screen({
  children,
  scroll = true,
  onRefresh,
  refreshing = false,
  grouped = false,
  topBar,
  floatingAction = false,
  contentStyle,
}: ScreenProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const headerHeight = useAppHeaderHeight();

  const background = grouped ? theme.groupedBackground : theme.background;
  /**
   * No Android a raiz de aba precisa reservar a altura da `CurvedTabBar`, que é absoluta e
   * desenha POR CIMA do conteúdo. `topBar` é o sinal de que esta é uma raiz de aba — telas
   * empurradas não têm barra e não devem ganhar o respiro.
   */
  const tabBarSpace = topBar && Platform.OS === 'android' ? CURVED_BAR_SPACE : 0;
  /** A altura do FAB mais o respiro dele, para nenhum conteúdo terminar embaixo do botão. */
  const fabSpace = floatingAction ? FAB_CLEARANCE : 0;
  const padding = [
    styles.content,
    {
      paddingTop: topBar ? headerHeight + Space.md : Space.md,
      paddingBottom: insets.bottom + Space.xxl + tabBarSpace + fabSpace,
    },
    contentStyle,
  ];

  if (!scroll) {
    return (
      <View style={[styles.root, { backgroundColor: background }]}>
        <View style={[styles.root, { paddingTop: topBar ? headerHeight : 0 }, contentStyle]}>
          {children}
        </View>
        {topBar}
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: background }]}>
      <ScrollView
        style={styles.root}
        contentContainerStyle={padding}
        /*
          `never` só onde o header é NOSSO (`topBar`), porque ali a altura já entra no
          `paddingTop` acima — deixar o iOS ajustar por cima disso soma duas vezes.

          Nas telas EMPURRADAS quem desenha o topo é o header nativo, e é o `automatic` que faz o
          conteúdo começar embaixo do large title em vez de correr por baixo dele. Trocar isso por
          `never` para todo mundo (o que eu tinha feito) enfiava a primeira linha de Contas,
          Cartões, Orçamentos e companhia debaixo da barra de navegação.
        */
        contentInsetAdjustmentBehavior={topBar ? 'never' : 'automatic'}
        showsVerticalScrollIndicator={false}
        refreshControl={
          onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} /> : undefined
        }>
        {children}
      </ScrollView>
      {/* Depois do scroll na árvore: ele precisa desenhar POR CIMA para o desfoque existir. */}
      {topBar}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: {
    gap: Space.xl,
    paddingHorizontal: Space.lg,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
});
