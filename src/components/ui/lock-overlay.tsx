/**
 * A cortina de bloqueio — abaixo da cortina de sessão (900 < 1000), acima de todo o resto.
 *
 * ⚠️ **Ela fica DEPOIS do `Stack.Protected` do `useSession`**: sem sessão não há o que trancar, e
 * a porta de entrada continua sendo o login. Esta trava protege quem já entrou.
 *
 * ⚠️ **Não há teclado aqui, e isso é o ponto.** Quem pede a senha é o SISTEMA, no prompt dele —
 * esta tela é a cortina que esconde o conteúdo enquanto isso, o objeto que conta em que ponto a
 * autenticação está, e o caminho de volta se a pessoa cancelar.
 *
 * ## O desenho
 *
 * Tinta nos dois temas — a mesma da abertura — e UM objeto: a marca num círculo suave, que é o
 * alvo do toque. Ele conta o estado sozinho: um halo respira enquanto o sistema confere; na falha
 * o círculo dá um tranco e ganha um anel vermelho. Destravar sobe a tinta como uma cortina, a
 * mesma onda da abertura.
 */

import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { WaveCurtain } from '@/components/motion/wave-curtain';
import { ThemedText } from '@/components/themed-text';
import { Mark } from '@/components/ui/mark';
import { Motion, Radius, Space } from '@/design/tokens';
import { useLock } from '@/hooks/use-lock';
import { useTheme } from '@/hooks/use-theme';

type EstadoDaTrava = ReturnType<typeof useLock>['estado'];

/** Diâmetro do círculo da marca: três vezes o alvo mínimo, sem virar herói. */
const DISCO = 112;
const MARCA = 48;

/**
 * Casca de montagem. A trava fica montada enquanto está trancada E enquanto sai — a onda de
 * saída precisa da cortina viva. Montar é ajuste de estado no render (padrão do React), não
 * efeito: o lint barra `setState` síncrono em `useEffect`, e com razão.
 */
export function LockOverlay() {
  const { locked } = useLock();
  const [montada, setMontada] = useState(locked);
  if (locked && !montada) setMontada(true);
  const aoSair = useCallback(() => setMontada(false), []);
  if (!montada) return null;
  return <Cortina saindo={!locked} onSaiu={aoSair} />;
}

/**
 * A frase conta o ESTADO e diz o que fazer; o título fica parado (design §7: identificador é
 * estável). Ela é a única coisa que ensina o gesto — por isso o verbo "Toque".
 */
const FRASES = {
  trancado: (como: string) => `Toque para usar ${como}.`,
  autenticando: () => 'Confirmando…',
  falhou: (como: string) => `Não reconheci. Toque para tentar de novo com ${como}.`,
} as const;

function Cortina({ saindo, onSaiu }: { saindo: boolean; onSaiu: () => void }) {
  const { autenticar, comoAutentica, estado } = useLock();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const reduzido = useReducedMotion();
  const progresso = useSharedValue(0);

  /*
    O prompt é pedido assim que a cortina aparece. A guarda de reentrância mora no HOOK
    (`autenticar` recusa a segunda chamada em voo) — é o que torna isto seguro sob o StrictMode.
  */
  useEffect(() => {
    void autenticar();
  }, [autenticar]);

  useEffect(() => {
    if (!saindo) {
      progresso.set(withTiming(0, { duration: Motion.duration.base }));
      return;
    }
    const duracao = reduzido ? Motion.duration.base : Motion.curtain.duration;
    progresso.set(
      withTiming(1, { duration: duracao, easing: Easing.linear }, (fim) => {
        'worklet';
        if (fim) runOnJS(onSaiu)();
      })
    );
    // Se o callback da animação não vier, a trava sai do mesmo jeito: modal preso é pior que corte.
    const teto = setTimeout(onSaiu, duracao + 400);
    return () => clearTimeout(teto);
  }, [saindo, reduzido, progresso, onSaiu]);

  const conteudo = useAnimatedStyle(() => {
    const k = Math.min(1, progresso.get() / 0.35);
    return { opacity: 1 - k, transform: [{ translateY: -k * 40 }] };
  });
  const veu = useAnimatedStyle(() => ({ opacity: 1 - progresso.get() }));

  return (
    <View
      accessibilityViewIsModal={!saindo}
      pointerEvents={saindo ? 'none' : 'auto'}
      style={[
        styles.tudo,
        {
          paddingTop: insets.top + Space.xl,
          // `Math.max`, não soma: com navegação por gestos o inset do Android volta 0.
          paddingBottom: Math.max(insets.bottom, Space.xxl),
        },
      ]}>
      {reduzido ? (
        <Animated.View
          style={[StyleSheet.absoluteFill, { backgroundColor: theme.curtain }, veu]}
        />
      ) : (
        <WaveCurtain
          progress={progresso}
          fase="revelar"
          mode="up"
          color={theme.curtain}
          style={StyleSheet.absoluteFill}
        />
      )}

      <View style={styles.folga} />

      {/* Terço ótico: 2 em cima, 3 embaixo — o centro geométrico lê baixo demais. */}
      <Animated.View style={[styles.centro, conteudo]}>
        <DiscoDaTrava estado={estado} onPress={() => void autenticar()} />
        <Animated.View
          entering={FadeIn.delay(140).duration(Motion.duration.slow)}
          style={styles.dizeres}>
          <ThemedText type="title" themeColor="onCurtain" style={styles.titulo}>
            App bloqueado
          </ThemedText>
          {/* `key={estado}`: a troca de frase é um corte com fade, não texto mudando sob o olho. */}
          <Animated.View key={estado} entering={FadeIn.duration(Motion.duration.base)}>
            <ThemedText type="small" themeColor="onCurtainMuted" style={styles.centrado}>
              {FRASES[estado](comoAutentica)}
            </ThemedText>
          </Animated.View>
        </Animated.View>
      </Animated.View>

      <View style={styles.folgaBaixa} />
    </View>
  );
}

/** O que o leitor de tela anuncia. A tela escreve a instrução; aqui fica o VERBO. */
const ROTULO: Record<EstadoDaTrava, string> = {
  trancado: 'Desbloquear',
  autenticando: 'Confirmando',
  falhou: 'Tentar de novo',
};

function DiscoDaTrava({ estado, onPress }: { estado: EstadoDaTrava; onPress: () => void }) {
  const theme = useTheme();
  const reduzido = useReducedMotion();
  const halo = useSharedValue(0);
  const tranco = useSharedValue(0);
  const alerta = useSharedValue(0);
  const toque = useSharedValue(1);

  useEffect(() => {
    if (estado !== 'autenticando' || reduzido) {
      halo.set(withTiming(0, { duration: Motion.duration.exit }));
      return;
    }
    halo.set(withRepeat(withTiming(1, { duration: 1400, easing: Motion.easing.out }), -1, false));
  }, [estado, reduzido, halo]);

  useEffect(() => {
    alerta.set(
      withTiming(estado === 'falhou' ? 1 : 0, {
        duration: estado === 'falhou' ? Motion.duration.fast : Motion.duration.base,
      })
    );
    if (estado !== 'falhou' || reduzido) return;
    // Amplitude decrescente: lê como "bateu e voltou", a física de uma porta que não abriu.
    tranco.set(
      withSequence(
        withTiming(-9, { duration: 48 }),
        withTiming(6, { duration: 60 }),
        withTiming(-3, { duration: 56 }),
        withTiming(0, { duration: 72, easing: Motion.easing.out })
      )
    );
  }, [estado, reduzido, alerta, tranco]);

  const disco = useAnimatedStyle(() => ({
    transform: [{ translateX: tranco.get() }, { scale: toque.get() }],
  }));
  // O halo nasce do tamanho do disco e cresce: é onda, não brilho.
  const onda = useAnimatedStyle(() => ({
    opacity: (1 - halo.get()) * 0.45,
    transform: [{ scale: 1 + halo.get() * 0.5 }],
  }));
  const anel = useAnimatedStyle(() => ({ opacity: alerta.get() }));

  return (
    <View style={styles.palco}>
      <Animated.View
        pointerEvents="none"
        style={[styles.circulo, { borderColor: theme.onCurtainMuted }, onda]}
      />
      <Animated.View style={disco}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={ROTULO[estado]}
          accessibilityState={{ busy: estado === 'autenticando' }}
          disabled={estado === 'autenticando'}
          onPressIn={() => toque.set(withTiming(Motion.pressScale, { duration: Motion.duration.fast }))}
          onPressOut={() => toque.set(withTiming(1, { duration: Motion.duration.fast }))}
          onPress={onPress}
          style={[styles.disco, { backgroundColor: theme.heroChip }]}>
          <Mark size={MARCA} color="onCurtain" />
        </Pressable>
        {/* O anel de falha fica PARADO enquanto o disco treme: o estado não depende do movimento. */}
        <Animated.View
          pointerEvents="none"
          style={[styles.circulo, { borderColor: theme.danger, borderWidth: 2 }, anel]}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  tudo: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    /*
      ⚠️ `zIndex` sozinho NÃO cobre a pilha nativa no Android (medido em 14/09/2026: o app
      continuava clicável por baixo). `elevation` ordena de verdade; 900 fica abaixo da cortina
      de sessão (1000), que precisa cobrir a abertura.
    */
    zIndex: 900,
    elevation: 900,
    alignItems: 'center',
    paddingHorizontal: Space.lg,
  },
  folga: { flex: 2 },
  folgaBaixa: { flex: 3 },
  centro: { alignItems: 'center', gap: Space.xl },
  dizeres: { alignItems: 'center', gap: Space.xs, maxWidth: 320 },
  centrado: { textAlign: 'center' },
  /*
    ⚠️ `flexShrink: 0`, MEDIDO no APK de release (15/09/2026): dentro de contêiner com
    `entering`, o título saía "App" — o texto medido enquanto o bloco chega encolhe e não se
    remede. Título é identificador: quem cede é o layout.
  */
  titulo: { textAlign: 'center', flexShrink: 0 },
  palco: { width: DISCO, height: DISCO, alignItems: 'center', justifyContent: 'center' },
  disco: {
    width: DISCO,
    height: DISCO,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circulo: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: DISCO,
    height: DISCO,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
});
