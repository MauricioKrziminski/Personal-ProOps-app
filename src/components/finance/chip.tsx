import { useLayoutEffect, useRef } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { cancelAnimation, interpolateColor, ReduceMotion, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { GlassBackdrop, supportsLiquidGlass } from '@/components/ui/glass-backdrop';
import { Icon, type IconName } from '@/components/ui/icon';
import { Fonts, type NoteColorName } from '@/constants/theme';
import { noteInk } from '@/design/note-colors';
import { Motion, Radius, Space, Type } from '@/design/tokens';
import { useScheme, useTheme } from '@/hooks/use-theme';
import { usePresencaAtiva } from '@/components/motion/presenca';
import { PressableScale } from '@/components/motion/pressable-scale';

interface ChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  /**
   * Contagem, desenhada como BADGE dentro do chip.
   *
   * Antes ela era concatenada no rótulo (`mercado · 4`), e o número disputava leitura com o nome
   * do filtro na mesma cor e no mesmo peso. Como badge ele lê como quantidade — e em mono, que é
   * o tipo que o sistema usa para dado.
   */
  count?: number;
  /** Ícone antes do rótulo (a categoria, no seletor). */
  icon?: IconName;
  /**
   * A cor da categoria (conteúdo do usuário, `design.md` §2b): pinta só o ÍCONE do chip não
   * escolhido. O escolhido continua na tinta do app — estado vence decoração.
   */
  tinta?: NoteColorName | null;
}

/** Chip de seleção (categorias, filtros, tipos de conta). */
export function Chip({ label, selected, onPress, count, icon, tinta }: ChipProps) {
  const theme = useTheme();
  const { fontScale } = useWindowDimensions();
  const scheme = useScheme();
  const ativo = usePresencaAtiva();
  const reduzir = useReducedMotion();
  const selecao = useSharedValue(selected ? 1 : 0);
  const pressao = useSharedValue(1);
  const montado = useRef(false);
  const tintaCheia = tinta ? noteInk(tinta, scheme) ?? undefined : undefined;
  const vidro = supportsLiquidGlass();
  useLayoutEffect(() => {
    if (!montado.current) { montado.current = true; return; }
    if (reduzir) {
      cancelAnimation(selecao);
      selecao.set(Number(selected));
      return;
    }
    // Substituir o destino deixa a mola aproveitar a velocidade; cancelar faria cada toque
    // recomeçar parado. A cor para no extremo, e só a geometria acompanha a ultrapassagem.
    selecao.set(withSpring(Number(selected), { ...Motion.spring.morph, reduceMotion: ReduceMotion.System }));
  }, [selected, reduzir, selecao]);
  useLayoutEffect(() => () => { cancelAnimation(selecao); cancelAnimation(pressao); }, [selecao, pressao]);
  const superficie = useAnimatedStyle(() => {
    const progresso = selecao.get();
    const limitado = Math.min(1, Math.max(0, progresso));
    return {
      backgroundColor: vidro ? 'transparent' : interpolateColor(limitado, [0, 1], [theme.backgroundElement, theme.tintFill]),
      borderColor: interpolateColor(limitado, [0, 1], [theme.cardBorder, 'transparent']),
      opacity: pressao.get(),
      transform: [{ scale: reduzir ? 1 : 1 + 0.2 * (progresso - limitado) }],
    };
  });
  const texto = useAnimatedStyle(() => ({
    color: interpolateColor(Math.min(1, Math.max(0, selecao.get())), [0, 1], [theme.text, theme.onTint]),
  }));
  const semSelecao = useAnimatedStyle(() => ({ opacity: 1 - Math.min(1, Math.max(0, selecao.get())) }));
  const comSelecao = useAnimatedStyle(() => ({ opacity: Math.min(1, Math.max(0, selecao.get())) }));
  const badge = useAnimatedStyle(() => ({ backgroundColor: interpolateColor(Math.min(1, Math.max(0, selecao.get())), [0, 1], [theme.backgroundSelected, theme.overlay]) }));
  const textoDaContagem = useAnimatedStyle(() => ({ color: interpolateColor(Math.min(1, Math.max(0, selecao.get())), [0, 1], [theme.textSecondary, theme.onTint]) }));
  return (
    <PressableScale
      scaleTo={1}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={count == null ? label : `${label}, ${count}`}
      accessibilityState={{ selected, disabled: !ativo }}
      disabled={!ativo}
      onPressIn={() => pressao.set(withTiming(0.8, { duration: Motion.duration.fast, reduceMotion: ReduceMotion.System }))}
      onPressOut={() => pressao.set(withTiming(1, { duration: Motion.duration.base, reduceMotion: ReduceMotion.System }))}
      onPress={() => {
        if (!ativo) return;
        Haptics.selectionAsync();
        onPress();
      }}>
      <Animated.View style={[styles.chip, superficie]}>
      {vidro ? (
        <>
          {/* A tinta nativa não interpola: os dois materiais ficam montados e acompanham
              o mesmo progresso do texto e do ícone, inclusive ao inverter um toque rápido. */}
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, semSelecao]}>
            <GlassBackdrop fallbackColor={theme.backgroundElement} radius={Radius.pill} />
          </Animated.View>
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, comSelecao]}>
            <GlassBackdrop fallbackColor={theme.tintFill} radius={Radius.pill} tintColor={theme.glassActionTint} />
          </Animated.View>
        </>
      ) : null}
      {/* `flexShrink: 0`: o chip já não encolhe (Pressable), então parado nada muda; dentro de um
          contêiner com `entering` o rótulo encolhido na medida não se remede (design.md §3). */}
      {icon ? (
        <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.icone}>
          <Animated.View style={semSelecao}>
            <Icon name={icon} size="sm" color="textSecondary" tint={tintaCheia} />
          </Animated.View>
          <Animated.View style={[StyleSheet.absoluteFill, comSelecao]}>
            <Icon name={icon} size="sm" color="onTint" />
          </Animated.View>
        </View>
      ) : null}
      <Animated.Text key={`rotulo:${fontScale}`} android_hyphenationFrequency="none" style={[Type.subhead, styles.rotulo, texto]}>
        {label}
      </Animated.Text>
      {count != null ? (
        <Animated.View style={[styles.badge, badge]}>
          <Animated.Text key={`contagem:${fontScale}`} android_hyphenationFrequency="none" style={[Type.code, textoDaContagem]}>
            {count}
          </Animated.Text>
        </Animated.View>
      ) : null}
      </Animated.View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    paddingHorizontal: Space.md + 2,
    paddingVertical: Space.xs + 2,
    // Pílula, como todo controle do design — `Spacing.four` (24) era um raio fora da escala.
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  icone: { flexShrink: 0 },
  rotulo: { flexShrink: 0, fontFamily: Fonts.semibold },
  badge: {
    minWidth: 20,
    paddingHorizontal: Space.xs,
    paddingVertical: 1,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
