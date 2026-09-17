import * as Haptics from 'expo-haptics';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { useBRL } from '@/components/ui/conceal';
import { Radius, Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { isoToBR } from '@/lib/dates';
import { degrausDaPista, entalheMaisProximo, type Pista } from '@/lib/runway';

/** A altura útil da escada: o caixa inteiro. */
const ALTURA = 40;
/** O alvo do dedo inclui um respiro acima e abaixo da escada. */
const ALVO = ALTURA + Space.md;
/** O degrau nunca some: dinheiro zerado ainda é um trecho do caminho. */
const PISO = 3;

function ddmm(iso: string): string {
  return isoToBR(iso).slice(0, 5);
}

/**
 * A Pista: de hoje até a próxima entrada, como uma ESCADA DE QUEIMA — a altura é quanto sobra
 * livre, e ela desce a cada saída (`degrausDaPista`). Arrastar o dedo mostra o dia e o livre
 * depois dele, com um toque háptico a cada saída; soltar volta à legenda.
 *
 * Sem entalhes (usuário novo, ou a soma não conferiu com o herói — `montarPista`) ela é um
 * degrau só, na altura do livre, e não se arrasta.
 */
export function RunwayBar({ pista, ate, entrada }: { pista: Pista; ate: string; entrada: string | null }) {
  const theme = useTheme();
  const brl = useBRL();
  const [largura, setLargura] = useState(0);
  const [ativo, setAtivo] = useState(-1);

  const degraus = useMemo(() => degrausDaPista(pista), [pista]);
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

  const corDoDegrau = (fracao: number, negativo: boolean, destacado: boolean) =>
    negativo
      ? theme.onHeroDanger
      : destacado
        ? theme.onHero
        : fracao < 0.2
          ? theme.onHeroWarning
          : theme.onHeroMuted;

  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={`Dinheiro livre de hoje ${entrada ? `até entrar dinheiro em ${ddmm(entrada)}` : `até ${ddmm(ate)}`}`}
      accessibilityValue={{
        text: atual ? `${ddmm(atual.day)}, livre ${brl(atual.livreDepois)}` : `livre ${brl(pista.livre)}`,
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
          <View style={[styles.base, { backgroundColor: theme.heroChip }]} />
          {degraus.map((d) => (
            <View
              key={`${d.inicio}-${d.entalhe}`}
              pointerEvents="none"
              style={[styles.faixa, { left: `${d.inicio * 100}%`, width: `${(d.fim - d.inicio) * 100}%` }]}>
              <View
                style={[
                  styles.degrau,
                  {
                    height: Math.max(PISO, d.fracao * ALTURA),
                    // O nível é o traço do topo; o corpo é só um véu para o degrau ter chão.
                    backgroundColor: ativo >= 0 && d.entalhe === ativo ? theme.heroFooterPress : theme.heroFooter,
                    borderTopColor: corDoDegrau(d.fracao, d.negativo, ativo >= 0 && d.entalhe === ativo),
                  },
                ]}
              />
            </View>
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
  alvo: { height: ALVO, justifyContent: 'flex-end' },
  base: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 2, borderRadius: Radius.pill },
  // O respiro entre degraus mora DENTRO da faixa: largura em % não aceita subtração.
  faixa: { position: 'absolute', bottom: 0, height: ALTURA, justifyContent: 'flex-end', paddingRight: 2 },
  degrau: { borderTopWidth: 2, borderTopLeftRadius: Radius.xs, borderTopRightRadius: Radius.xs },
  ponta: {
    position: 'absolute',
    right: -4,
    bottom: -5,
    width: 12,
    height: 12,
    borderRadius: Radius.pill,
    borderWidth: 2,
  },
  cursor: { position: 'absolute', left: 0, bottom: 0, width: 2, height: ALVO, borderRadius: Radius.pill },
  legenda: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.sm,
    marginTop: Space.sm,
  },
});
