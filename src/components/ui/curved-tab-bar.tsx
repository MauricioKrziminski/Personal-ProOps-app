import { useEffect, useMemo } from 'react';
import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Canvas, Circle, Group, Path, Skia } from '@shopify/react-native-skia';
import Animated, {
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Elevation, Motion, Radius, Space } from '@/design/tokens';
import { useScheme, useTheme } from '@/hooks/use-theme';
import type { SymbolViewProps } from 'expo-symbols';

/** Altura da barra, sem a bolha e sem a safe area. */
const BAR_H = 64;
/** A bolha que carrega o ícone da aba ativa. */
const BUBBLE = 52;
/**
 * O respiro entre a bolha e a borda do berço — a mesma folga em volta inteira.
 *
 * É ele que faz o recorte "seguir o raio do ícone": a boca é um arco **concêntrico** com a bolha,
 * de raio `BUBBLE/2 + GAP`. Qualquer outra forma (um vale desenhado à mão, uma lente) deixa a
 * distância variando ao longo da curva, e o olho lê isso como erro mesmo sem saber nomear.
 */
const GAP = 7;
const CUT = BUBBLE / 2 + GAP;
/** Quanto a bolha sobe acima da aresta da barra. Metade dela fica de fora, como no export. */
const TOP = BUBBLE / 2;

/**
 * Quanto a barra ocupa por cima do conteúdo — **fora** da safe area.
 *
 * A barra é `position: absolute`, então nada reserva esse espaço sozinho: sem somar isto ao
 * padding inferior das raízes de aba, a última linha de toda lista fica embaixo dela.
 */
export const CURVED_BAR_SPACE = TOP + BAR_H + Space.sm;
/**
 * O piso de qualquer coisa FLUTUANTE sobre a barra (FAB, toast, sheet ancorado).
 *
 * `CURVED_BAR_SPACE` é só a altura ocupada — encostar nele deixa o botão colado na aresta da
 * pílula, e no Android o FAB tem `elevation` maior, então ele desenhava POR CIMA da barra em vez
 * de acima dela. Conteúdo de tela pode passar por baixo da barra; controle flutuante, não.
 */
export const CURVED_BAR_CLEARANCE = CURVED_BAR_SPACE + Space.lg;
/** Calha lateral: a barra flutua, não encosta nas bordas. */
const SIDE = Space.lg;

export interface CurvedTab {
  name: string;
  label: string;
  icon: SymbolViewProps['name'];
  badge?: number;
}

/**
 * A pílula da barra. **Sem o berço** — ele é subtraído por cima, não tecido no contorno.
 *
 * A primeira tentativa desenhava um path único com a mordida e ombros tangentes. Ela quebrava
 * justamente onde mais aparece: na PRIMEIRA e na ÚLTIMA aba o berço cai dentro do canto
 * arredondado, e o ombro tinha que começar antes do canto — o `Math.max(..., r)` empurrava o
 * início do ombro para DEPOIS do fim dele e o contorno se cruzava, apagando a mordida. (O próprio
 * export tem esse defeito: no estado "Home Active" o path faz `C 0 19.7 19.7 0 44 0` e em seguida
 * `L 32.7 0`, andando para trás.)
 *
 * Subtrair resolve todas as posições de uma vez e é menos código.
 */
function pillPath(w: number, h: number) {
  const r = h / 2;
  const b = Skia.PathBuilder.Make();
  b.addRRect(Skia.RRectXY(Skia.XYWHRect(0, 0, w, h), r, r));
  return b.build();
}

/**
 * A barra de abas do **Android**: uma pílula com um berço que segue a aba ativa.
 *
 * ## Por que só no Android
 *
 * No iOS a barra é a `NativeTabs` em Liquid Glass, que é diretriz do projeto e que o sistema
 * desenha melhor do que qualquer coisa nossa — inclusive o encolhimento ao rolar. No Android não
 * existe equivalente: a barra do Material 3 é uma laje reta, e é ali que um desenho próprio paga.
 * A divisão mora no PRIMITIVO (`app-tabs.android.tsx`), nunca numa tela — regra de `frontend.md`.
 *
 * ## O recorte é um PATH (03/09/2026)
 *
 * A versão anterior fazia a boca com uma `View` circular pintada da cor do fundo, por cima da
 * barra. Ela tinha três defeitos, e o primeiro era invisível na leitura do código:
 *
 * 1. **A boca estava 26px fora do lugar.** O comentário prometia um círculo concêntrico com a
 *    bolha, mas o centro dela caía em `LIFT + BUBBLE/2` e o da bolha em `LIFT` — a bolha ficava
 *    empoleirada na borda de cima de um buraco de 66px, com um vazio embaixo do ícone. Foi isso
 *    que ficou "muito diferente do que eu pedi".
 * 2. **Um círculo encontrando uma reta faz quina.** Sem ombro tangente não existe "clean".
 * 3. **Furo pintado não aceita contorno nem sombra.** A borda de 1px atravessava a boca (era a
 *    "linha em cima do ícone"), e no tema escuro é justamente o contorno que define onde a barra
 *    termina.
 *
 * Agora o berço é um CÍRCULO subtraído no Skia, recortado pela própria pílula: pinta-se a barra,
 * pinta-se o traço dela, e por cima vai um disco da cor do FUNDO com o traço do berço, ambos
 * dentro de um `Group clip={pílula}`. O disco apaga o traço da barra exatamente onde a mordida
 * passa — que era a "linha em cima do ícone" — e o arco resultante é, por construção, concêntrico
 * com a bolha.
 *
 * Isso também dispensa interpolar path: o que anda é o `cx` do círculo, um shared value que o
 * Skia aceita direto na prop. Nada é montado dentro de worklet (o erro que deixou a barra
 * invisível na tentativa mais antiga) e não há N caminhos para manter em sincronia.
 *
 * ## O movimento
 *
 * Uma posição só governa o berço E a bolha: com duas molas elas dessincronizariam e a bolha sairia
 * do berço no meio do caminho. Mola porque teve dedo envolvido (§5), e um agacho curto de escala
 * no toque — é o que dá a sensação de a bolha se TRANSFORMAR de um lugar no outro em vez de
 * simplesmente escorregar.
 */
export function CurvedTabBar({
  tabs,
  activeIndex,
  onSelect,
}: {
  tabs: CurvedTab[];
  activeIndex: number;
  onSelect: (index: number) => void;
}) {
  const theme = useTheme();
  const scheme = useScheme();
  const insets = useSafeAreaInsets();
  const { width: screenW } = useWindowDimensions();

  const barW = screenW - SIDE * 2;
  const slot = barW / tabs.length;

  /** A pílula. Não depende da aba ativa, então é calculada uma vez e nunca mais. */
  const pilula = useMemo(() => pillPath(barW, BAR_H), [barW]);

  const progresso = useSharedValue(activeIndex);
  const squash = useSharedValue(1);

  useEffect(() => {
    // A mola é disparada em efeito, nunca no corpo do componente: escrever num shared value
    // durante o render reinicia a animação a cada re-render do pai.
    progresso.set(withSpring(activeIndex, Motion.spring.settle));
    squash.set(
      withSequence(
        withTiming(0.86, { duration: Motion.duration.fast }),
        withSpring(1, Motion.spring.settle)
      )
    );
  }, [activeIndex, progresso, squash]);

  /** O centro do berço e da bolha — UMA posição para os dois, senão eles dessincronizam. */
  const centro = useDerivedValue(() => slot * (progresso.get() + 0.5));

  /**
   * O disco do berço como PATH, para servir de recorte invertido no traço da pílula.
   *
   * Sem ele, nas abas das PONTAS o canto arredondado da pílula passa por dentro do berço e o
   * traço dele aparece como um risco atrás do ícone — a mordida deixa de ler como vazada.
   *
   * O contorno correto de `pílula − disco` são duas peças: o traço da pílula FORA do disco, mais
   * o arco do disco DENTRO da pílula. Cada uma sai do seu `Group`, uma com `invertClip` e a outra
   * sem — desenhar a pílula inteira e tapar depois não funciona, porque o preenchimento do berço
   * para na borda da pílula e é justamente ali que o traço sobrevive.
   *
   * Construído em worklet de propósito (`useDerivedValue` + `PathBuilder`, o padrão documentado):
   * o centro é um shared value, e recalcular no JS traria a posição um frame atrasada — o risco
   * voltaria a piscar durante a animação.
   */
  const disco = useDerivedValue(() => {
    const b = Skia.PathBuilder.Make();
    b.addCircle(centro.get(), 0, CUT);
    return b.build();
  });

  const bolha = useAnimatedStyle(() => ({
    transform: [
      { translateX: slot * (progresso.get() + 0.5) - BUBBLE / 2 },
      { scale: squash.get() },
    ],
  }));

  return (
    <View
      pointerEvents="box-none"
      style={[styles.raiz, { paddingBottom: insets.bottom + Space.sm, paddingHorizontal: SIDE }]}>
      <View style={{ width: barW, height: TOP + BAR_H }}>
        {/*
          O canvas é deslocado `TOP` para baixo: a pílula é desenhada com a aresta em y=0, e a
          metade de cima da bolha vive fora dele.
        */}
        <Canvas style={[StyleSheet.absoluteFill, { top: TOP }]} pointerEvents="none">
          <Path path={pilula} color={theme.backgroundElement} style="fill" />
          {/* O traço da pílula, MENOS o pedaço que cai dentro do berço. */}
          <Group clip={disco} invertClip>
            <Path path={pilula} color={theme.separator} style="stroke" strokeWidth={1} />
          </Group>
          {/*
            A mordida, recortada pela própria pílula: fora dela o disco não existe, então a metade
            de cima do círculo (que fica acima da barra) some sozinha.
          */}
          <Group clip={pilula}>
            <Circle cx={centro} cy={0} r={CUT} color={theme.background} />
            <Circle cx={centro} cy={0} r={CUT} color={theme.separator} style="stroke" strokeWidth={1} />
          </Group>
        </Canvas>

        <Animated.View
          pointerEvents="none"
          style={[
            styles.bolha,
            {
              backgroundColor: theme.backgroundSelected,
              borderColor: theme.separator,
              boxShadow: Elevation[scheme].floating,
            },
            bolha,
          ]}>
          {/*
            A bolha é da COR DA BARRA com o ícone no accent — é o desenho do export. Preenchê-la
            de `tint` com o ícone invertido punha o accent inteiro num controle que a pessoa toca
            100× por dia, e queimava a única alavanca de cor que o app tem em ornamento de chrome.
          */}
          <Icon name={tabs[activeIndex]?.icon ?? 'circle'} size="md" color="tint" />
          {/*
            O badge da aba ATIVA anda com a bolha.
            Deixado no slot, ele caía dentro do berço — em cima do nada — e encostava no rótulo.
          */}
          {tabs[activeIndex]?.badge ? (
            <View style={[styles.badge, styles.badgeBolha, { backgroundColor: theme.danger }]}>
              <ThemedText type="meta" themeColor="onTint">
                {tabs[activeIndex].badge > 9 ? '9+' : String(tabs[activeIndex].badge)}
              </ThemedText>
            </View>
          ) : null}
        </Animated.View>

        <View style={[styles.linha, { height: BAR_H, top: TOP }]}>
          {tabs.map((tab, i) => {
            const ativo = i === activeIndex;
            return (
              <Pressable
                key={tab.name}
                accessibilityRole="tab"
                accessibilityState={{ selected: ativo }}
                accessibilityLabel={tab.label}
                onPress={() => {
                  if (!ativo) Haptics.selectionAsync();
                  onSelect(i);
                }}
                style={[styles.slot, { width: slot }]}>
                {/* A aba ativa não desenha ícone na barra: ele está na bolha, dentro do berço. */}
                <View style={styles.iconeSlot}>
                  {ativo ? null : <Icon name={tab.icon} size="md" color="textSecondary" />}
                  {tab.badge && !ativo ? (
                    <View style={[styles.badge, styles.badgeIcone, { backgroundColor: theme.danger }]}>
                      <ThemedText type="meta" themeColor="onTint">
                        {tab.badge > 9 ? '9+' : String(tab.badge)}
                      </ThemedText>
                    </View>
                  ) : null}
                </View>
                <ThemedText
                  type="caption"
                  themeColor={ativo ? 'tint' : 'textSecondary'}
                  numberOfLines={1}>
                  {tab.label}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  raiz: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    /**
     * No Android o cartão da tela tem `elevation` (vem do `boxShadow` do `Card`), e elevação
     * ganha de ordem de irmãos: sem declarar a nossa, a lista desenhava POR CIMA da barra e ela
     * sumia — só a bolha e os rótulos apareciam, flutuando sobre o conteúdo.
     */
    zIndex: 10,
    elevation: 10,
  },
  bolha: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: BUBBLE,
    height: BUBBLE,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linha: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', alignItems: 'flex-end' },
  slot: { alignItems: 'center', justifyContent: 'flex-end', gap: Space.xs, paddingBottom: Space.md },
  iconeSlot: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    minWidth: 16,
    height: 16,
    borderRadius: Radius.pill,
    paddingHorizontal: Space.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeIcone: { top: -4, right: -8 },
  badgeBolha: { top: 0, right: 0 },
});
