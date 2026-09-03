import { useEffect } from 'react';
import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Motion, Radius, Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import type { SymbolViewProps } from 'expo-symbols';

/** Altura da barra, sem a bolha e sem a safe area. */
const BAR_H = 64;
/** A bolha que carrega o ícone da aba ativa. */
const BUBBLE = 52;
/**
 * O respiro entre a bolha e a borda do recorte — a mesma folga em volta inteira.
 *
 * É ele que faz o recorte "seguir o raio do ícone": a boca é um CÍRCULO concêntrico com a bolha,
 * de raio `BUBBLE/2 + GAP`. Qualquer outra forma (um vale desenhado à mão, uma lente) deixa a
 * distância variando ao longo da curva, e o olho lê isso como erro mesmo sem saber nomear.
 */
const GAP = 7;
const CUT = BUBBLE / 2 + GAP;
/** Quanto a bolha sobe acima da barra. */
const LIFT = Math.round(BUBBLE * 0.42);
/** Calha lateral: a barra flutua, não encosta nas bordas. */
const SIDE = Space.lg;

/**
 * Quanto a barra ocupa por cima do conteúdo — **fora** da safe area.
 *
 * A barra é `position: absolute`, então nada reserva esse espaço sozinho: sem somar isto ao
 * padding inferior das raízes de aba, a última linha de toda lista fica embaixo dela.
 */
export const CURVED_BAR_SPACE = BAR_H + LIFT + Space.sm;

export interface CurvedTab {
  name: string;
  label: string;
  icon: SymbolViewProps['name'];
  badge?: number;
}

/**
 * A barra de abas do **Android**: uma pílula com a boca vazada seguindo a aba ativa.
 *
 * ## Por que só no Android
 *
 * No iOS a barra é a `NativeTabs` em Liquid Glass, que é diretriz do projeto e que o sistema
 * desenha melhor do que qualquer coisa nossa — inclusive o encolhimento ao rolar. No Android não
 * existe equivalente: a barra do Material 3 é uma laje reta, e é ali que um desenho próprio paga.
 * A divisão mora no PRIMITIVO (`app-tabs.android.tsx`), nunca numa tela — regra de `frontend.md`.
 *
 * ## Como o recorte é feito, e por que NÃO é um path
 *
 * A boca é uma `View` circular pintada com a cor do FUNDO, por cima da barra. Como as duas
 * superfícies são opacas, o círculo lê como um furo — e como é a mesma primitiva do resto do app,
 * ele anima com `translateX` sem custo e sem depender de o Skia aceitar objetos criados dentro de
 * worklet.
 *
 * Duas versões anteriores falharam, e as duas deixaram marca visível:
 * 1. **Path inteiro remontado por frame** num `useDerivedValue`: o worklet rodava (os avisos de
 *    API depreciada saíam no logcat), mas o canvas não pintava nada — a barra ficava invisível e
 *    a lista aparecia por baixo dos rótulos.
 * 2. **Path estático em Skia + borda de 1px na `View` da barra**: a borda desenha o retângulo
 *    INTEIRO, inclusive atravessando a boca — era a "linha em cima do ícone". Barra com recorte
 *    não pode ter borda; quem separa a barra do fundo é o degrau de superfície.
 *
 * ## O movimento
 *
 * Uma posição só governa a boca E a bolha: com duas molas elas dessincronizariam e a bolha sairia
 * do furo no meio do caminho. Mola porque teve dedo envolvido (§5), e um agacho curto de escala
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
  const insets = useSafeAreaInsets();
  const { width: screenW } = useWindowDimensions();

  const barW = screenW - SIDE * 2;
  const slot = barW / tabs.length;
  const alvo = slot * (activeIndex + 0.5);

  const cx = useSharedValue(alvo);
  const squash = useSharedValue(1);

  useEffect(() => {
    // A mola é disparada em efeito, nunca no corpo do componente: escrever num shared value
    // durante o render reinicia a animação a cada re-render do pai.
    cx.set(withSpring(alvo, Motion.spring.settle));
    squash.set(
      withSequence(
        withTiming(0.86, { duration: Motion.duration.fast }),
        withSpring(1, Motion.spring.settle)
      )
    );
  }, [alvo, cx, squash]);

  const boca = useAnimatedStyle(() => ({ transform: [{ translateX: cx.get() - CUT }] }));
  const bolha = useAnimatedStyle(() => ({
    transform: [{ translateX: cx.get() - BUBBLE / 2 }, { scale: squash.get() }],
  }));

  return (
    <View
      pointerEvents="box-none"
      style={[styles.raiz, { paddingBottom: insets.bottom + Space.sm, paddingHorizontal: SIDE }]}>
      <View style={{ width: barW, height: BAR_H + LIFT }}>
        <View style={[styles.barra, { height: BAR_H, backgroundColor: theme.backgroundElement }]} />

        {/* O furo. Cor do fundo, raio concêntrico com a bolha. */}
        <Animated.View
          pointerEvents="none"
          style={[styles.boca, { backgroundColor: theme.background }, boca]}
        />

        <Animated.View
          pointerEvents="none"
          style={[styles.bolha, { backgroundColor: theme.tint }, bolha]}>
          <Icon name={tabs[activeIndex]?.icon ?? 'circle'} size="md" color="onTint" />
          {/*
            O badge da aba ATIVA anda com a bolha.
            Deixado no slot, ele caía dentro do furo — em cima do nada — e encostava no rótulo.
          */}
          {tabs[activeIndex]?.badge ? (
            <View style={[styles.badge, styles.badgeBolha, { backgroundColor: theme.danger }]}>
              <ThemedText type="meta" themeColor="onTint">
                {tabs[activeIndex].badge > 9 ? '9+' : String(tabs[activeIndex].badge)}
              </ThemedText>
            </View>
          ) : null}
        </Animated.View>

        <View style={[styles.linha, { height: BAR_H, top: LIFT }]}>
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
                {/* A aba ativa não desenha ícone na barra: ele está na bolha, dentro do furo. */}
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
  /** Sem borda: ela atravessaria o furo. Ver o cabeçalho do arquivo. */
  barra: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: LIFT,
    borderRadius: Radius.pill,
    borderCurve: 'continuous',
  },
  boca: {
    position: 'absolute',
    left: 0,
    top: LIFT + BUBBLE / 2 - CUT,
    width: CUT * 2,
    height: CUT * 2,
    borderRadius: CUT,
  },
  bolha: {
    position: 'absolute',
    left: 0,
    top: LIFT - BUBBLE / 2,
    width: BUBBLE,
    height: BUBBLE,
    borderRadius: Radius.pill,
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
