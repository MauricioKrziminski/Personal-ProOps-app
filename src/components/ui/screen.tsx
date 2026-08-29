import { RefreshControl, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MaxContentWidth } from '@/constants/theme';
import { Space } from '@/design/tokens';
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
   * Conteúdo colado no topo, **sem o recuo lateral** — o painel de destaque (`HeroPanel`), que
   * sangra até as bordas.
   *
   * Existe como slot em vez de a tela resolver com margem negativa: quando cada tela inventa o
   * próprio `-16`, elas divergem em um ou dois pixels e o painel deixa de encostar. Foi assim
   * que a pílula de ação do header ficou com respiro diferente entre telas.
   */
  header?: React.ReactNode;
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
  contentStyle,
}: ScreenProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const background = grouped ? theme.groupedBackground : theme.background;
  const padding = [styles.content, { paddingBottom: insets.bottom + Space.xxl }, contentStyle];

  if (!scroll) {
    return <View style={[styles.root, { backgroundColor: background }, contentStyle]}>{children}</View>;
  }

  return (
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
          {header}
          <View style={padding}>{children}</View>
        </>
      ) : (
        children
      )}
    </ScrollView>
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
  content: {
    gap: Space.xl,
    paddingHorizontal: Space.lg,
    paddingTop: Space.md,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
});
