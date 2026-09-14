/**
 * O disco de vidro com a marca dentro — o único objeto da cortina de bloqueio, e a única ação.
 *
 * ## Por que um disco, por que a marca, e por que ELE é o botão
 *
 * Uma tela de bloqueio tem UMA pergunta ("é você?") e por isso pode ter UM objeto. A marca já é,
 * por decisão de design (§2b), *"o accent que sobrou"* — ela faz de spinner, de glifo de estado
 * vazio e de marca d'água. Aqui ela ganha mais um papel sem inventar nada: é a fechadura.
 *
 * ⚠️ **Uma ação só.** A primeira versão tinha o disco E um botão "Desbloquear" embaixo: dois
 * caminhos para a mesma intenção, que é exatamente a linha *"rótulos diferentes para a mesma
 * intenção: 0"* da contagem anti-slop (§10). Quem manda tocar é a frase de apoio, que muda com o
 * estado; o alvo é o disco, com 132pt — três vezes o mínimo de toque.
 *
 * O vidro é legítimo neste lugar preciso: §1 reserva glass para a **chrome**, e a cortina é
 * chrome — ela não é conteúdo, é o que cobre o conteúdo. E, com a `Aurora` atrás, ele finalmente
 * tem o que refratar.
 *
 * ## Os três estados, contados pelo mesmo objeto
 *
 * | estado | o disco |
 * |---|---|
 * | `trancado` | parado, anel em `separator` |
 * | `autenticando` | a marca GIRA — o papel de spinner que o `Button loading` já usa — e um halo sai dele |
 * | `falhou` | um tranco lateral, e um segundo anel acende em `danger` |
 *
 * ⚠️ **Um indicador só.** Uma versão tinha a marca girando E um arco varrendo o anel: dois
 * spinners para o mesmo fato, e o arco roubava a leitura da forma que É a identidade do app.
 */

import { memo, useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { GlassCard } from '@/components/glass/glass-card';
import { Mark } from '@/components/ui/mark';
import { Motion, Radius } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

/** Diâmetro do disco. Grande o bastante para a marca respirar, pequeno para não virar herói. */
const DISCO = 132;
const MARCA = 54;

export type EstadoDaTrava = 'trancado' | 'autenticando' | 'falhou';

/** O que o leitor de tela anuncia. A tela escreve a instrução; aqui fica o VERBO. */
const ROTULO: Record<EstadoDaTrava, string> = {
  trancado: 'Desbloquear',
  autenticando: 'Confirmando',
  falhou: 'Tentar de novo',
};

/**
 * ⚠️ `memo`: a cortina re-renderiza quando `comoAutentica` chega (um tique depois da montagem) e
 * o disco só depende de `estado` e de `onPress`. Sem isto, o `GlassView` nativo do iOS 26 remonta
 * o efeito de vidro fora de hora.
 */
export const Keyhole = memo(function Keyhole({
  estado,
  onPress,
}: {
  estado: EstadoDaTrava;
  onPress: () => void;
}) {
  const theme = useTheme();
  const reduzido = useReducedMotion();

  /** Abertura: o disco chega de trás, com a mola de chrome do app. */
  const entrada = useSharedValue(reduzido ? 1 : 0);
  /** O tranco do erro, em px. */
  const tranco = useSharedValue(0);
  /** Opacidade do anel de alerta, empilhado sobre o anel normal. */
  const alerta = useSharedValue(0);
  /** A respiração de quem está esperando: um halo que expande e some. */
  const halo = useSharedValue(0);
  /** Press feedback — o mesmo `Motion.pressScale` do `Button`. */
  const toque = useSharedValue(1);

  useEffect(() => {
    if (reduzido) {
      entrada.set(withTiming(1, { duration: Motion.duration.base }));
      return;
    }
    entrada.set(withDelay(60, withSpring(1, Motion.spring.snap)));
  }, [entrada, reduzido]);

  useEffect(() => {
    if (estado !== 'falhou') {
      alerta.set(withTiming(0, { duration: Motion.duration.base }));
      return;
    }
    alerta.set(withTiming(1, { duration: Motion.duration.fast }));
    if (reduzido) return;
    /*
      Amplitude decrescente: 9 → 6 → 3 → 0. Um tranco de amplitude constante lê como glitch;
      decrescente lê como "bateu e voltou", que é a física de uma porta que não abriu.
    */
    tranco.set(
      withSequence(
        withTiming(-9, { duration: 48 }),
        withTiming(6, { duration: 60 }),
        withTiming(-3, { duration: 56 }),
        withTiming(0, { duration: 72, easing: Motion.easing.out })
      )
    );
  }, [estado, alerta, tranco, reduzido]);

  useEffect(() => {
    if (estado !== 'autenticando' || reduzido) {
      halo.set(withTiming(0, { duration: Motion.duration.exit }));
      return;
    }
    halo.set(
      withRepeat(withTiming(1, { duration: 1400, easing: Easing.bezier(0.16, 1, 0.3, 1) }), -1, false)
    );
  }, [estado, halo, reduzido]);

  const discoStyle = useAnimatedStyle(() => ({
    opacity: entrada.get(),
    transform: [
      { translateX: tranco.get() },
      { scale: (0.86 + entrada.get() * 0.14) * toque.get() },
    ],
  }));

  /*
    ⚠️ **Dois anéis empilhados, NÃO um `interpolateColor`.** O anel de repouso é `separator`, que
    no tema claro é `rgba(19, 19, 21, 0.14)`; interpolar de uma string rgba para um hex saiu
    VERMELHO no quadro zero, com o estado em `autenticando` — visto na tela, não deduzido.
    Opacidade de uma `View` por cima dá o mesmo efeito sem depender de parse de cor, e é mais
    barato: uma propriedade animável contra quatro canais recalculados por quadro.
  */
  const alertaStyle = useAnimatedStyle(() => ({ opacity: alerta.get() }));

  /*
    O halo é uma `View` escalando e sumindo — não um segundo desfoque. Ele nasce no tamanho do
    disco e cresce 46%: é onda, não é brilho, e custa uma matriz por quadro.
  */
  const haloStyle = useAnimatedStyle(() => {
    const t = halo.get();
    return { opacity: (1 - t) * 0.5, transform: [{ scale: 1 + t * 0.46 }] };
  });

  return (
    <View style={styles.palco}>
      <Animated.View
        style={[styles.anelSolto, { borderColor: theme.tint }, haloStyle]}
        pointerEvents="none"
      />
      <Animated.View style={discoStyle}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={ROTULO[estado]}
          accessibilityState={{ busy: estado === 'autenticando' }}
          disabled={estado === 'autenticando'}
          onPressIn={() =>
            toque.set(withTiming(Motion.pressScale, { duration: Motion.duration.fast }))
          }
          onPressOut={() => toque.set(withTiming(1, { duration: Motion.duration.fast }))}
          onPress={onPress}>
          {/*
            ⚠️ `regular`, não `clear`. Medido na tela: sobre a aurora do tema CLARO o `clear` não
            desenha nada — o disco virava só o anel, e o vidro que esta cortina existe para mostrar
            não aparecia. `regular` é o Liquid Glass padrão e tem material suficiente para ler
            como superfície nos dois temas.
          */}
          <GlassCard variant="regular" style={styles.disco}>
            <Mark size={MARCA} color="text" spinning={estado === 'autenticando'} />
          </GlassCard>
          <View style={[styles.anel, { borderColor: theme.separator }]} pointerEvents="none" />
          <Animated.View
            style={[styles.anel, { borderColor: theme.danger }, alertaStyle]}
            pointerEvents="none"
          />
        </Pressable>
      </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  palco: { width: DISCO, height: DISCO, alignItems: 'center', justifyContent: 'center' },
  /*
    `padding: 0`, `borderRadius` de círculo e `borderWidth: 0` sobrescrevem o card do `GlassCard` —
    ele é a única porta para vidro no app (§1) e aceita `style` por último justamente para isto. A
    borda sai dele porque quem desenha o anel aqui são as duas `View`s empilhadas, e duas bordas no
    mesmo raio viram um fio duplo. Sem `overflow`, o fallback de `BlurView` no Android vazaria
    pelos cantos do quadrado.
  */
  disco: {
    width: DISCO,
    height: DISCO,
    borderRadius: Radius.pill,
    borderWidth: 0,
    padding: 0,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  anel: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  anelSolto: {
    position: 'absolute',
    width: DISCO,
    height: DISCO,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
});
