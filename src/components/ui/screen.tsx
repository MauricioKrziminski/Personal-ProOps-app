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

interface ScreenProps {
  children: React.ReactNode;
  /** `false` quando a tela é uma lista virtualizada que rola sozinha. */
  scroll?: boolean;
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
  const padding = [
    styles.content,
    {
      paddingTop: topBar ? headerHeight + Space.md : Space.md,
      paddingBottom: insets.bottom + Space.xxl + tabBarSpace,
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
        contentInsetAdjustmentBehavior="never"
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
