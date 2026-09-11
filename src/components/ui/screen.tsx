import { useState } from 'react';
import {
  Platform,
  RefreshControl,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';

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
  onRefresh?: () => unknown;
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
 *
 * ⚠️ **A rolagem é `KeyboardAwareScrollView`, não `ScrollView`.** Toda tela que tem campo no meio
 * da página (Plano, Projeção, Membros, Pastas) tinha o mesmo defeito: o teclado abria por cima do
 * campo e a pessoa digitava sem ver. Resolver tela a tela é como o defeito volta na próxima — aqui
 * ele deixa de existir para as 21 de uma vez, e para as que vierem.
 *
 * O componente é um `ScrollView` por dentro, então `refreshControl`, `contentContainerStyle` e
 * `contentInsetAdjustmentBehavior` continuam valendo. Sem campo em foco ele é inerte.
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
  const [pulling, setPulling] = useState(false);
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
    /*
      ⚠️ **Sem `topBar`, o filho precisa ser a RAIZ da tela.** Ver o bloco `SCROLL VIEW NA RAIZ`
      abaixo: aqui o filho é a lista (SectionList/FlatList), e envolvê-la numa `View` mata o
      large title do header nativo exatamente do mesmo jeito.

      O fundo, que era o da `View` que sumiu, passa a vir do `contentStyle` do navegador — que é
      onde ele deveria estar desde sempre: quem pinta o container da tela é a pilha, não um
      retângulo nosso por dentro dela.
    */
    if (!topBar) {
      return (
        <>
          <Stack.Screen options={{ contentStyle: { backgroundColor: background } }} />
          {children}
        </>
      );
    }
    return (
      <View style={[styles.root, { backgroundColor: background }]}>
        <View style={[styles.root, { paddingTop: headerHeight }, contentStyle]}>
          {children}
        </View>
        {topBar}
      </View>
    );
  }

  /*
    ══ SCROLL VIEW NA RAIZ ═══════════════════════════════════════════════════════════════════
    ⚠️ **O `ScrollView` só pode ser embrulhado numa `View` quando a tela NÃO tem header nativo.**

    O iOS procura o scroll view da interação do título grande andando pelos PRIMEIROS SUBVIEWS a
    partir da raiz da tela, e a busca é rasa — uma `View` no meio já esconde o scroll. Sem achar,
    `prefersLargeTitles` fica ligado e o título NUNCA colapsa: ele fica cravado no lugar do large
    title enquanto o conteúdo rola por baixo, sem fundo, e os dois se sobrepõem. O
    `react-native-screens` documenta a mesma heurística no `RNSScreen.mm` ("only going through
    first subviews, as the OS does something similar e.g. when looking for scrollview for large
    header interaction").

    Isso valia para as 23 telas empurradas ao mesmo tempo e a queixa foi literal — *"o título tá
    descendo junto com a tela... isso vem sendo bastante comum"*. Provado com uma tela mínima em
    11/09/2026: `<ScrollView>` na raiz colapsa certo; o MESMO conteúdo dentro de
    `<View style={{flex:1}}>` reproduz o defeito inteiro. Não era o `headerShadowVisible`, nem a
    fonte custom do header, nem o `KeyboardAwareScrollView` — os três foram testados e
    descartados um a um.

    Quem TEM `topBar` (as raízes de aba) fica com a `View`: ali o header é o nosso `AppHeader`,
    com `headerShown: false`, e a barra precisa ser irmã do scroll para desenhar por cima dele.
    ═══════════════════════════════════════════════════════════════════════════════════════════
  */
  const conteudo = (
    <KeyboardAwareScrollView
      style={[styles.root, topBar ? null : { backgroundColor: background }]}
      contentContainerStyle={padding}
      bottomOffset={Space.xxl}
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
      alwaysBounceVertical={Boolean(onRefresh)}
      refreshControl={
        onRefresh ? <RefreshControl
          refreshing={pulling || refreshing}
          progressViewOffset={topBar ? headerHeight : 0}
          onRefresh={() => {
            setPulling(true);
            void Promise.resolve().then(onRefresh).catch(() => undefined).finally(() => setPulling(false));
          }}
        /> : undefined
      }>
      {children}
    </KeyboardAwareScrollView>
  );

  if (!topBar) return conteudo;

  return (
    <View style={[styles.root, { backgroundColor: background }]}>
      {conteudo}
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
