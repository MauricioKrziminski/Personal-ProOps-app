import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { useBRL } from '@/components/ui/conceal';
import { Motion, Radius, Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { isoToBR } from '@/lib/dates';
import { entalheMaisProximo, fracaoComprometida, type Pista } from '@/lib/runway';

const ALTURA = 8;
/** O alvo do dedo é bem maior que o trilho: arrastar um fio de 8dp é impossível. */
const ALVO = 32;

function ddmm(iso: string): string {
  return isoToBR(iso).slice(0, 5);
}

/**
 * A Pista: de hoje até a próxima entrada, com um entalhe em cada saída. Arrastar o dedo mostra
 * quanto fica livre depois de cada dia, com um toque háptico ao cruzar um entalhe.
 *
 * O preenchimento é quanto do caixa já está prometido antes da entrada. Sem entalhes (usuário
 * novo, ou a soma não conferiu com o herói — ver `montarPista`), ela é só a barra, sem arraste.
 */
export function RunwayBar({ pista, ate, entrada }: { pista: Pista; ate: string; entrada: string | null }) {
  const theme = useTheme();
  const brl = useBRL();
  const reduzido = useReducedMotion();
  const [largura, setLargura] = useState(0);
  const [ativo, setAtivo] = useState(-1);

  const fracao = fracaoComprometida(pista);
  const cheio = useSharedValue(fracao);
  const anterior = useRef(fracao);
  useEffect(() => {
    if (anterior.current === fracao) return;
    anterior.current = fracao;
    cheio.set(reduzido ? fracao : withSpring(fracao, Motion.spring.encaixe));
  }, [fracao, cheio, reduzido]);
  const estiloCheio = useAnimatedStyle(() => ({ transform: [{ scaleX: cheio.get() }] }));

  const posicoes = useMemo(() => pista.entalhes.map((e) => e.posicao), [pista.entalhes]);
  const dedo = useSharedValue(-1);
  const ultimo = useSharedValue(-1);
  const estiloCursor = useAnimatedStyle(() => ({
    opacity: dedo.get() >= 0 ? 1 : 0,
    transform: [{ translateX: Math.max(0, dedo.get()) - 1 }],
  }));

  const gesto = useMemo(
    () =>
      Gesture.Pan()
        .enabled(posicoes.length > 0 && largura > 0)
        .activeOffsetX([-6, 6])
        .failOffsetY([-10, 10])
        .onUpdate((e) => {
          const x = Math.min(largura, Math.max(0, e.x));
          dedo.set(x);
          const i = entalheMaisProximo(posicoes, x / largura);
          if (i !== ultimo.get()) {
            ultimo.set(i);
            runOnJS(setAtivo)(i);
            runOnJS(Haptics.selectionAsync)();
          }
        })
        .onFinalize(() => {
          dedo.set(-1);
          ultimo.set(-1);
          runOnJS(setAtivo)(-1);
        }),
    [posicoes, largura, dedo, ultimo]
  );

  const atual = ativo >= 0 ? pista.entalhes[ativo] : null;
  const fim = entrada ? `entra ${ddmm(entrada)}` : `até ${ddmm(ate)}`;

  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={`Pista até ${fim}`}
      accessibilityValue={{
        text: atual ? `${ddmm(atual.day)}, livre ${brl(atual.livreDepois)}` : `${Math.round(fracao * 100)}% comprometido`,
      }}
      accessibilityActions={posicoes.length ? [{ name: 'increment' }, { name: 'decrement' }] : undefined}
      onAccessibilityAction={(e) => {
        const n = posicoes.length;
        if (!n) return;
        setAtivo((i) =>
          e.nativeEvent.actionName === 'increment' ? Math.min(n - 1, i + 1) : Math.max(0, i - 1)
        );
      }}>
      <GestureDetector gesture={gesto}>
        <View style={styles.alvo} onLayout={(e) => setLargura(e.nativeEvent.layout.width)}>
          <View style={[styles.trilho, { backgroundColor: theme.heroChip }]}>
            <Animated.View
              style={[
                styles.cheio,
                { backgroundColor: fracao >= 1 ? theme.onHeroDanger : theme.onHeroWarning },
                estiloCheio,
              ]}
            />
          </View>
          {pista.entalhes.map((e, i) => (
            <View
              key={e.day}
              pointerEvents="none"
              style={[
                styles.entalhe,
                { left: `${e.posicao * 100}%`, backgroundColor: i === ativo ? theme.onHero : theme.onHeroMuted },
              ]}
            />
          ))}
          <View
            pointerEvents="none"
            style={[
              styles.ponta,
              { backgroundColor: entrada ? theme.onHeroSuccess : theme.onHeroMuted, borderColor: theme.heroSurface },
            ]}
          />
          <Animated.View pointerEvents="none" style={[styles.cursor, { backgroundColor: theme.onHero }, estiloCursor]} />
        </View>
      </GestureDetector>
      <View style={styles.legenda}>
        {atual ? (
          <ThemedText type="code" themeColor={atual.livreDepois < 0 ? 'onHeroDanger' : 'onHero'}>
            {`${ddmm(atual.day)} · livre ${brl(atual.livreDepois)}`}
          </ThemedText>
        ) : (
          <>
            <ThemedText type="code" themeColor="onHeroMuted">
              hoje
            </ThemedText>
            <ThemedText type="code" themeColor={entrada ? 'onHeroSuccess' : 'onHeroMuted'}>
              {fim}
            </ThemedText>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  alvo: { height: ALVO, justifyContent: 'center' },
  trilho: { height: ALTURA, borderRadius: Radius.pill, overflow: 'hidden' },
  cheio: { width: '100%', height: '100%', borderRadius: Radius.pill, transformOrigin: 'left' },
  entalhe: {
    position: 'absolute',
    top: (ALVO - 16) / 2,
    width: 2,
    height: 16,
    marginLeft: -1,
    borderRadius: Radius.pill,
  },
  ponta: {
    position: 'absolute',
    right: -2,
    top: (ALVO - 16) / 2,
    width: 16,
    height: 16,
    borderRadius: Radius.pill,
    borderWidth: 3,
  },
  cursor: { position: 'absolute', left: 0, top: 2, width: 2, height: ALVO - 4, borderRadius: Radius.pill },
  legenda: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.sm,
  },
});
