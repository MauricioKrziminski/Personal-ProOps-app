import { useEffect, useMemo } from 'react';
import { Canvas, Path, Skia } from '@shopify/react-native-skia';
import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Motion, Radius, Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import type { SymbolViewProps } from 'expo-symbols';

/** Altura da barra, sem o berço e sem a safe area. */
const BAR_H = 68;
/** A bolha que carrega o ícone da aba ativa, encaixada no berço. */
const BUBBLE = 52;
/** Quanto a bolha sobe acima da barra. O berço tem que ser fundo o bastante para ela caber. */
const LIFT = 22;
/** Calha lateral: a barra flutua, não encosta nas bordas. */
const SIDE = Space.lg;

/**
 * Quanto a barra ocupa por cima do conteúdo — **fora** da safe area.
 *
 * A barra é `position: absolute`, então nada reserva esse espaço sozinho: sem somar isto ao
 * padding inferior das raízes de aba, a última linha de toda lista fica embaixo dela.
 */
export const CURVED_BAR_SPACE = BAR_H + LIFT + Space.sm;

/**
 * O berço, em proporções do desenho original (viewBox 580×88), para escalar sem deformar.
 *
 * Os números vieram do path exportado pelo Stitch, lidos par a par em torno do centro: a boca
 * abre em ±64, os controles em ±49/±38/±32/±24/±13, e o fundo desce 47 de 88. Reproduzi-los é o
 * que faz a curva ter a MESMA tensão do desenho — copiar "um vale no meio" a olho dá um U, não
 * este ombro suave.
 */
const K = {
  mouth: 64 / 580,
  c1: 49 / 580,
  c2: 38 / 580,
  c3: 32 / 580,
  c4: 24 / 580,
  c5: 13 / 580,
  y1: 8.5 / 88,
  y2: 21 / 88,
  y3: 37.5 / 88,
  depth: 47 / 88,
  corner: 44 / 88,
};

export interface CurvedTab {
  name: string;
  label: string;
  icon: SymbolViewProps['name'];
  badge?: number;
}

/**
 * A barra de abas do **Android**: uma pílula com um berço que desliza até a aba ativa.
 *
 * ## Por que só no Android
 *
 * No iOS a barra é a `NativeTabs` em Liquid Glass, que é diretriz do projeto e que o sistema
 * desenha melhor do que qualquer coisa nossa — inclusive o encolhimento ao rolar. No Android não
 * existe equivalente: a barra do Material 3 é uma laje reta, e é ali que um desenho próprio paga.
 * A divisão mora no PRIMITIVO (`app-tabs.android.tsx`), nunca numa tela — regra de `frontend.md`.
 *
 * ## O berço anima, e é por isso que ele existe
 *
 * Um recorte fixo seria só um enfeite. O que comunica é o berço **viajando** até o destino: o
 * movimento carrega o olho de onde a pessoa estava para onde ela chegou, que é continuidade
 * espacial — o único propósito que justifica animar algo que ela vai ler em seguida (§5).
 * Mola, e não timing, porque teve dedo envolvido.
 *
 * O caminho é reconstruído por frame dentro de um `useDerivedValue`: é uma dúzia de operações de
 * ponto flutuante na UI thread, mais barato que interpolar entre quatro paths prontos e sem o
 * borrão que um cross-fade entre formas produz.
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
  const insets = useSafeAreaInsets();
  const { width: screenW } = useWindowDimensions();

  const barW = screenW - SIDE * 2;
  const slot = barW / tabs.length;
  const alvo = slot * (activeIndex + 0.5);

  // Uma posição só governa a curva E a bolha — se fossem duas molas, elas dessincronizariam e a
  // bolha sairia do berço no meio do caminho.
  //
  // A mola é disparada em `useEffect`, nunca no corpo do componente: escrever num shared value
  // durante o render é erro que o Reanimated avisa em dev e que, em produção, faz a animação
  // reiniciar a cada re-render do pai.
  const cx = useSharedValue(alvo);
  useEffect(() => {
    cx.set(withSpring(alvo, Motion.spring.settle));
  }, [alvo, cx]);

  const mouth = barW * K.mouth;
  const depth = BAR_H * K.depth;

  /**
   * O berço é uma LENTE: a região entre a reta do topo da barra e a curva que mergulha.
   *
   * Pintada na cor do fundo por cima da barra, ela lê exatamente como um recorte — e como a
   * forma nunca muda, o caminho é construído UMA vez, no `useMemo`, e quem anima é o
   * `translateX` da View que a carrega.
   *
   * A primeira versão remontava o caminho inteiro da barra a cada frame dentro de um
   * `useDerivedValue`. O worklet rodava (os avisos de API depreciada saíam no logcat), mas o
   * canvas não pintava nada: a barra ficava invisível e a tela aparecia por baixo dos rótulos.
   * Caminho estático + View animada não depende de o Skia aceitar objetos criados em worklet.
   */
  const berco = useMemo(() => {
    const p = Skia.Path.Make();
    const w = mouth * 2;
    const c1 = barW * K.c1;
    const c2 = barW * K.c2;
    const c3 = barW * K.c3;
    const c4 = barW * K.c4;
    const c5 = barW * K.c5;
    const y1 = BAR_H * K.y1;
    const y2 = BAR_H * K.y2;
    const y3 = BAR_H * K.y3;
    const meio = w / 2;

    p.moveTo(0, 0);
    p.cubicTo(meio - c1, 0, meio - c2, y1, meio - c3, y2);
    p.cubicTo(meio - c4, y3, meio - c5, depth, meio, depth);
    p.cubicTo(meio + c5, depth, meio + c4, y3, meio + c3, y2);
    p.cubicTo(meio + c2, y1, meio + c1, 0, w, 0);
    p.close();
    return p;
  }, [barW, mouth, depth]);

  const bercoStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: cx.get() - mouth }],
  }));

  const bolha = useAnimatedStyle(() => ({
    transform: [{ translateX: cx.get() - BUBBLE / 2 }],
  }));

  return (
    <View
      pointerEvents="box-none"
      style={[styles.raiz, { paddingBottom: insets.bottom + Space.sm, paddingHorizontal: SIDE }]}>
      <View style={{ width: barW, height: BAR_H + LIFT }}>
        <View
          style={[
            styles.barra,
            { height: BAR_H, backgroundColor: theme.surface, borderColor: theme.cardBorder },
          ]}
        />

        {/* O berço, pintado na cor do fundo por cima da barra. */}
        <Animated.View
          pointerEvents="none"
          style={[styles.berco, { width: mouth * 2, height: depth }, bercoStyle]}>
          <Canvas style={{ width: mouth * 2, height: depth }}>
            <Path path={berco} color={theme.background} />
          </Canvas>
        </Animated.View>

        <Animated.View
          pointerEvents="none"
          style={[
            styles.bolha,
            { backgroundColor: theme.tint, top: 0, width: BUBBLE, height: BUBBLE },
            bolha,
          ]}>
          <Icon name={tabs[activeIndex]?.icon ?? 'circle'} size="md" color="onTint" />
        </Animated.View>

        <View style={[styles.linha, { height: BAR_H, top: LIFT }]}>
          {tabs.map((tab, i) => (
            <Pressable
              key={tab.name}
              accessibilityRole="tab"
              accessibilityState={{ selected: i === activeIndex }}
              accessibilityLabel={tab.label}
              onPress={() => {
                if (i !== activeIndex) Haptics.selectionAsync();
                onSelect(i);
              }}
              style={[styles.slot, { width: slot }]}>
              {i === activeIndex ? null : (
                <Icon name={tab.icon} size="md" color="textSecondary" />
              )}
              <ThemedText
                type="caption"
                themeColor={i === activeIndex ? 'text' : 'textSecondary'}
                numberOfLines={1}
                style={i === activeIndex ? styles.rotuloAtivo : undefined}>
                {tab.label}
              </ThemedText>
              {tab.badge ? (
                <View style={[styles.badge, { backgroundColor: theme.danger }]}>
                  <ThemedText type="meta" themeColor="onTint">
                    {tab.badge > 9 ? '9+' : String(tab.badge)}
                  </ThemedText>
                </View>
              ) : null}
            </Pressable>
          ))}
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
  barra: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: LIFT,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  berco: { position: 'absolute', left: 0, top: LIFT },
  bolha: {
    position: 'absolute',
    left: 0,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linha: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', alignItems: 'flex-end' },
  slot: { alignItems: 'center', justifyContent: 'flex-end', gap: Space.xs, paddingBottom: Space.md },
  /** A aba ativa não desenha ícone na barra (ele está na bolha), então o rótulo sobe sozinho. */
  rotuloAtivo: { marginBottom: 0 },
  badge: {
    position: 'absolute',
    top: Space.xs,
    right: '22%',
    minWidth: 16,
    height: 16,
    borderRadius: Radius.pill,
    paddingHorizontal: Space.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
