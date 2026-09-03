import { Canvas, Path, Skia } from '@shopify/react-native-skia';
import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
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
  const cx = useSharedValue(alvo);
  cx.set(withSpring(alvo, Motion.spring.settle));

  const path = useDerivedValue(() => {
    const x = cx.get();
    const p = Skia.Path.Make();
    const mouth = barW * K.mouth;
    const c1 = barW * K.c1;
    const c2 = barW * K.c2;
    const c3 = barW * K.c3;
    const c4 = barW * K.c4;
    const c5 = barW * K.c5;
    const y1 = BAR_H * K.y1;
    const y2 = BAR_H * K.y2;
    const y3 = BAR_H * K.y3;
    const depth = BAR_H * K.depth;
    const r = Math.min(BAR_H * K.corner, BAR_H / 2);

    p.moveTo(0, r);
    p.cubicTo(0, r / 2.2, r / 2.2, 0, r, 0);
    p.lineTo(x - mouth, 0);
    p.cubicTo(x - c1, 0, x - c2, y1, x - c3, y2);
    p.cubicTo(x - c4, y3, x - c5, depth, x, depth);
    p.cubicTo(x + c5, depth, x + c4, y3, x + c3, y2);
    p.cubicTo(x + c2, y1, x + c1, 0, x + mouth, 0);
    p.lineTo(barW - r, 0);
    p.cubicTo(barW - r / 2.2, 0, barW, r / 2.2, barW, r);
    p.lineTo(barW, BAR_H - r);
    p.cubicTo(barW, BAR_H - r / 2.2, barW - r / 2.2, BAR_H, barW - r, BAR_H);
    p.lineTo(r, BAR_H);
    p.cubicTo(r / 2.2, BAR_H, 0, BAR_H - r / 2.2, 0, BAR_H - r);
    p.close();
    return p;
  });

  const bolha = useAnimatedStyle(() => ({
    transform: [{ translateX: cx.get() - BUBBLE / 2 }],
  }));

  return (
    <View
      pointerEvents="box-none"
      style={[styles.raiz, { paddingBottom: insets.bottom + Space.sm, paddingHorizontal: SIDE }]}>
      <View style={{ width: barW, height: BAR_H + LIFT }}>
        {/* A barra desenhada. O berço é a única razão de existir um canvas aqui. */}
        <Canvas style={[styles.canvas, { width: barW, height: BAR_H }]}>
          <Path path={path} color={theme.surface} />
        </Canvas>

        {/* O contorno de 1px do sistema não sobrevive a um path com recorte; o degrau de
            superfície (`surface` sobre `background`) é o que separa a barra da tela. */}

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
  raiz: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' },
  canvas: { position: 'absolute', left: 0, top: LIFT },
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
