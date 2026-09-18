import { Children, isValidElement, useState, type ReactNode } from 'react';
import {
  Platform,
  RefreshControl,
  StyleSheet,
  View,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
} from 'react-native-reanimated';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';

import { MaxContentWidth } from '@/constants/theme';
import { bottomPillInset, rootContentMaxWidth } from '@/design/adaptive-window';
import { useAppHeaderHeight } from '@/components/ui/app-header';
import { GlassReady } from '@/components/ui/glass-backdrop';
import { progressoDeEntrada, useRelogioDeEntrada } from '@/components/motion/entrada';
import { TAB_BAR_SPACE } from '@/components/ui/pill-tab-bar';
import { RolagemDaTela } from '@/components/ui/screen-scroll';

import { Motion, Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { useAdaptiveWindow } from '@/hooks/use-adaptive-window';

/**
 * Quanto um FAB come do fim do conteúdo: a altura do botão `md` (48) mais um respiro.
 * Não é `TAB_BAR_CLEARANCE` — aquele é onde o FAB COMEÇA; este é o que ele OCUPA.
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
  /**
   * Liga pull-to-refresh. O indicador é do GESTO e mora aqui (§6 do design): não existe prop
   * `refreshing`, porque a leitura óbvia (`isRefetching`) abre o spinner a cada revalidação e
   * empurra a tela — inclusive ao voltar do Face ID.
   */
  onRefresh?: () => unknown;
  /** Fundo agrupado para telas de lista; `background` para telas de conteúdo. */
  grouped?: boolean;
  /**
   * Entra em cascata: cada bloco de primeiro nível desce e aparece 60 ms depois do anterior.
   *
   * ⚠️ **Só com `scroll` (o padrão).** Sem ele o filho PRECISA ser a raiz da tela — envolvê-lo
   * mata o large title do header nativo, que é o defeito documentado no bloco `SCROLL VIEW NA
   * RAIZ` logo abaixo. Em tela sem scroll o conteúdo é uma lista, e quem escalona é a lista.
   *
   * ⚠️ **É o par do portão da Fase 5** (`useTelaPronta`). O portão faz a tela inteira montar de
   * uma vez; sem a cascata, montar de uma vez lê como um corte seco — cinco blocos surgindo no
   * mesmo quadro. Com ela, lê como a tela se montando. Ligar a cascata SEM o portão seria só
   * atrasar a pipoca.
   */
  stagger?: boolean;
  /**
   * A barra de marca das raízes de aba (`AppHeader`).
   *
   * Ela é **sobreposta** — desenha por cima do scroll para desfocar o que passa por baixo — e é
   * este slot que reserva a altura dela no `paddingTop` do conteúdo. Passar o header por fora do
   * slot deixaria a primeira linha da tela escondida atrás da faixa.
   */
  topBar?: React.ReactNode;
  /**
   * Camada por cima do conteúdo — o FAB do Financeiro. Mora aqui para ler a rolagem da tela
   * (`useRolagemDaTela`). Só vale com `topBar`: tela empurrada não tem FAB.
   */
  overlay?: React.ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  /** Let a tab root use a bounded tablet canvas; pushed routes keep their native scroll root. */
  wide?: boolean;
}

/**
 * Raiz de tela.
 *
 * Substitui a pilha `ThemedView` + `SafeAreaView` + `ScrollView` que 21 telas repetem, cada uma
 * com um padding inferior diferente. O padding vem de `useSafeAreaInsets()`, não de constante
 * fixa, e o Android ainda soma a altura da `PillTabBar`, que é absoluta.
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
  grouped = false,
  stagger = false,
  topBar,
  floatingAction = false,
  overlay,
  contentStyle,
  wide = false,
}: ScreenProps) {
  const theme = useTheme();
  const { width } = useAdaptiveWindow();
  const [pulling, setPulling] = useState(false);
  const insets = useSafeAreaInsets();
  const headerHeight = useAppHeaderHeight();
  const rolagem = useSharedValue(0);
  const aoRolar = useAnimatedScrollHandler((e) => {
    rolagem.set(e.contentOffset.y);
  });

  const background = grouped ? theme.groupedBackground : theme.background;
  /**
   * No Android a raiz de aba precisa reservar a altura da `PillTabBar`, que é absoluta e
   * desenha POR CIMA do conteúdo. `topBar` é o sinal de que esta é uma raiz de aba — telas
   * empurradas não têm barra e não devem ganhar o respiro.
   */
  const tabBarSpace = bottomPillInset(Platform.OS, Boolean(topBar), TAB_BAR_SPACE);
  /** A altura do FAB mais o respiro dele, para nenhum conteúdo terminar embaixo do botão. */
  const fabSpace = floatingAction ? FAB_CLEARANCE : 0;
  const padding = [
    styles.content,
    {
      maxWidth: wide ? rootContentMaxWidth(width, true) : MaxContentWidth,
      /*
        ⚠️ **O respiro do topo é UM número, para o app inteiro** — e ele foi calibrado no
        aparelho, nos dois sentidos: com `Space.md` o dono do produto reclamou do vazio embaixo
        do título grande; com zero, de que ficou apertado. `Space.sm` é o degrau entre os dois, e
        vale igual no iOS e no Android para o gap não mudar de tela para tela.

        Com `topBar` ele SOMA a altura do header, porque ali a barra é NOSSA (`AppHeader`,
        desenhada por cima do scroll) e ninguém reservou espaço embaixo dela. Na tela empurrada
        quem reserva é o header nativo, e o que fica aqui é só o respiro.

        Nenhuma tela sobrescreve isto: `contentStyle` existe para outras coisas e nenhuma das 23
        telas empurradas passa `paddingTop` próprio — conferido em 11/09/2026.
      */
      paddingTop: topBar ? headerHeight + Space.sm : Space.sm,
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
      <RolagemDaTela.Provider value={rolagem}>
        <View style={[styles.root, { backgroundColor: background }]}>
          <View style={[styles.root, wide ? styles.wideContent : null, { paddingTop: headerHeight }, contentStyle]}>
            {children}
          </View>
          {topBar}
          {overlay}
        </View>
      </RolagemDaTela.Provider>
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
      // O scroll por dentro é o `Reanimated.ScrollView`, que aceita o handler da UI thread; o
      // tipo público é o do `ScrollView` da RN.
      onScroll={aoRolar as unknown as ScrollViewProps['onScroll']}
      showsVerticalScrollIndicator={false}
      alwaysBounceVertical={Boolean(onRefresh)}
      refreshControl={
        onRefresh ? <RefreshControl
          refreshing={pulling}
          progressViewOffset={topBar ? headerHeight : 0}
          onRefresh={() => {
            setPulling(true);
            void Promise.resolve().then(onRefresh).catch(() => undefined).finally(() => setPulling(false));
          }}
        /> : undefined
      }>
      {stagger ? <Cascata>{children}</Cascata> : children}
    </KeyboardAwareScrollView>
  );

  if (!topBar) return <RolagemDaTela.Provider value={rolagem}>{conteudo}</RolagemDaTela.Provider>;

  return (
    <RolagemDaTela.Provider value={rolagem}>
      <View style={[styles.root, { backgroundColor: background }]}>
        {conteudo}
        {/* Depois do scroll na árvore: ele precisa desenhar POR CIMA para o desfoque existir. */}
        {topBar}
        {overlay}
      </View>
    </RolagemDaTela.Provider>
  );
}

/**
 * A cascata: uma entrada por bloco, atrasada pela POSIÇÃO.
 *
 * ⚠️ **Filho que não é elemento passa DIRETO.** `{cond ? <X/> : null}` é o padrão das telas
 * daqui, e embrulhar o `null` criaria uma `View` vazia — que o `gap` do container espaçaria,
 * abrindo um buraco do tamanho de um bloco onde não há bloco nenhum.
 *
 * ⚠️ **O embrulho REPETE o `gap` do container, e isso é bug medido.** Um filho pode ser um
 * `<>…</>` com vários blocos dentro (é como as telas agrupam o que aparece junto); embrulhado,
 * ele vira UMA caixa de layout e o espaço que o `gap` do container dava ENTRE esses blocos
 * simplesmente some. Medido no Patrimônio: a distância do herói até "O QUE FORMA ESSE NÚMERO"
 * caiu de 451px para 379px — exatamente `Space.xl` a 3×. Com o `gap` no embrulho, o resultado é
 * idêntico ao de antes da cascata; num filho de elemento único ele não custa nada.
 *
 * ⚠️ **O teto é `Motion.stagger.cap`**, o mesmo da Hoje: numa tela de oito blocos, 60 ms por
 * bloco acumularia meio segundo até o último — e aí a cascata deixa de ser "a tela montando" e
 * vira "o rodapé está demorando".
 */
function Cascata({ children }: { children: ReactNode }) {
  let i = 0;
  return (
    <>
      {Children.map(children, (filho) => {
        if (!isValidElement(filho)) return filho;
        const indice = i++;
        return <BlocoDaCascata indice={indice}>{filho}</BlocoDaCascata>;
      })}
    </>
  );
}

/** Deslocamento de entrada de cada bloco, em dp. */
const SUBIDA_DO_BLOCO = 12;

/**
 * Um bloco da cascata. A entrada toca sempre que o app FICA VISÍVEL (`useEntrada`): na abertura,
 * ao entrar numa conta e ao desbloquear — pedido do dono do produto, 17/09/2026. Não é mais um
 * `entering` (que só toca na montagem): coberto pela trava, o bloco se esconde e entra de novo
 * quando ela sai, sem remontar a tela.
 */
function BlocoDaCascata({ indice, children }: { indice: number; children: ReactNode }) {
  const reduzir = useReducedMotion();
  const { relogio, assentado } = useRelogioDeEntrada(
    Math.min(indice * 60, Motion.stagger.cap),
    Motion.duration.slow
  );
  const estilo = useAnimatedStyle(() => {
    const e = progressoDeEntrada(relogio.get());
    return {
      opacity: e,
      transform: [{ translateY: reduzir ? 0 : (1 - e) * SUBIDA_DO_BLOCO }],
    };
  });
  return (
    <Animated.View style={[styles.cascata, assentado ? styles.noLugar : estilo]}>
      {/* iOS 26 does not render GlassView mounted below an ancestor at opacity 0. */}
      <GlassReady ready={assentado}>{children}</GlassReady>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  /** O mesmo `gap` do `content` — ver `Cascata`. */
  cascata: { gap: Space.xl },
  /** O fim da entrada, escrito pelo React (ver `useRelogioDeEntrada`). */
  noLugar: { opacity: 1, transform: [{ translateY: 0 }] },
  content: {
    gap: Space.xl,
    paddingHorizontal: Space.lg,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  wideContent: { width: '100%', maxWidth: 1200, alignSelf: 'center' },
});
