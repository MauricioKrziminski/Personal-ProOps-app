import AsyncStorage from '@react-native-async-storage/async-storage';
import { Canvas, Group, Path } from '@shopify/react-native-skia';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { Motion, Space } from '@/design/tokens';
import { markPath } from '@/design/mark-path';
import { useTheme } from '@/hooks/use-theme';

/**
 * Duração total da abertura, num lugar só.
 *
 * ~2 s é a versão "show", pedida de propósito. A recomendação de mercado é bem mais curta
 * (600–900 ms, teto de 1200), porque animação de abertura vira irritação quando roda em toda
 * abertura e quando BLOQUEIA — se os dados chegaram em 300 ms e ainda faltam 1,5 s de coreografia,
 * o usuário está esperando pela vaidade de quem fez.
 *
 * Por isso o show completo só roda nas primeiras aberturas (`SHOWS`); depois disso sobra a
 * entrada da marca e o fade. Reduzir o show para sempre é mudar este número.
 */
const SPLASH_DURATION = 2000;
/** A entrada da marca sozinha — o que roda depois que a novidade passou. */
const SHORT_DURATION = 750;
/** Quantas aberturas ganham o show completo. */
const SHOWS = 5;
const KEY = 'proops.splash.shows';

const MARK = 128;

/**
 * A abertura do app.
 *
 * ## O que havia aqui
 *
 * Um `Keyframe` de 600 ms que aplicava `Easing.elastic(0.7)` a keyframes de `scale: 1 → 1`.
 * Sem diferença de transform o easing não tem o que animar: na prática era **um cross-fade de
 * opacidade**, sem entrada, sem escala e sem rotação — o único momento de marca animada do app,
 * e ele não animava. A marca também era um PNG de 96 px, que não dá para recolorir nem escalar.
 *
 * ## A sequência
 *
 * | t | O quê |
 * |---|---|
 * | 0–700 ms | A espiral **se forma**: gira de −140° a 0° enquanto cresce e aparece. Girar é o que lê como espiral; um fade não diria nada sobre a forma. |
 * | 700–1350 ms | Três linhas escorrem da direita e **assentam** — o gesto do produto: mensagem solta virando coisa organizada. |
 * | 1350–2000 ms | Tudo sai em fade, entregando a tela pronta por baixo. |
 *
 * ## O hand-off sem flash
 *
 * Três coisas precisam bater, e as três estão aqui:
 *
 * 1. **O fundo é o mesmo hex** do `expo-splash-screen` no `app.json` (branco no claro, preto no
 *    escuro) — é a regra §9 do design, e é a causa nº 1 de flash de cor.
 * 2. **`hideAsync()` só no primeiro `onLayout`** do overlay, nunca num `useEffect` solto: assim o
 *    nativo só sai depois que já existe algo pintado por cima.
 * 3. **`setOptions({ fade: false })`**: o cross-fade do sistema somado ao nosso produzia um
 *    piscar de dessaturação. Um fade só.
 *
 * ## Warm start não vê nada
 *
 * O overlay monta uma vez, na criação do processo, e desmonta ao terminar. Voltar do background
 * não remonta — então a animação é, por construção, exclusiva do cold start.
 */
export function AnimatedSplashOverlay({ ready = true }: { ready?: boolean }) {
  const theme = useTheme();
  const [visible, setVisible] = useState(true);
  /** `null` enquanto o contador não voltou do disco — não dá para escolher a versão antes. */
  const [full, setFull] = useState<boolean | null>(null);

  const spin = useSharedValue(0);
  const lines = useSharedValue(0);

  const path = useMemo(() => markPath(MARK), []);

  useEffect(() => {
    SplashScreen.setOptions({ duration: 0, fade: false });
  }, []);

  useEffect(() => {
    let vivo = true;
    AsyncStorage.getItem(KEY)
      .then((v) => {
        const n = Number(v ?? 0);
        if (vivo) setFull(n < SHOWS);
        AsyncStorage.setItem(KEY, String(n + 1)).catch(() => {});
      })
      // Sem preferência legível, mostra a versão curta: errar para o lado de ser rápido.
      .catch(() => vivo && setFull(false));
    return () => {
      vivo = false;
    };
  }, []);

  /**
   * A animação espera **duas** condições: o overlay já pintou (`laidOut`) e o contador voltou do
   * disco (`full !== null`).
   *
   * Disparar no `onLayout` sozinho era uma corrida: em cold start o `AsyncStorage` costuma
   * resolver DEPOIS do primeiro layout, `full` ainda era `null`, a função saía no `return` e a
   * marca ficava parada até o overlay simplesmente sumir. O defeito só aparece no aparelho, com
   * disco frio — nunca em Fast Refresh, onde o valor já está em memória.
   */
  const [laidOut, setLaidOut] = useState(false);

  useEffect(() => {
    if (!laidOut || full === null) return;

    spin.set(withTiming(1, { duration: 700, easing: Motion.easing.out }));
    if (full) {
      lines.set(withDelay(700, withSpring(1, Motion.spring.settle)));
    }
  }, [laidOut, full, spin, lines]);

  /**
   * Quando o overlay sai — e por que as duas versões têm regras diferentes.
   *
   * **Show completo (primeiras aberturas): roda inteiro.** Ele existe para ser visto; cortá-lo no
   * instante em que a sessão resolve faria a versão longa nunca acontecer na prática, já que
   * sessão em cache resolve em poucas centenas de ms. Custa ~2 s, cinco vezes na vida do app.
   *
   * **Versão curta (o dia a dia): a animação é teto, não piso.** Aí sim, resolvida a sessão, o
   * overlay sai assim que a marca terminou de entrar. Segurar a tela com o app pronto embaixo é
   * exatamente o que transforma abertura bonita em abertura irritante — e é o caminho que roda
   * todo dia.
   */
  useEffect(() => {
    if (full === null) return;
    const espera = full ? SPLASH_DURATION : ready ? SHORT_DURATION : SPLASH_DURATION;
    const t = setTimeout(() => setVisible(false), espera);
    return () => clearTimeout(t);
  }, [full, ready]);

  const markStyle = useAnimatedStyle(() => ({
    opacity: spin.get(),
    transform: [
      { scale: 0.62 + spin.get() * 0.38 },
      { rotate: `${-140 + spin.get() * 140}deg` },
    ],
  }));

  if (!visible) return null;

  return (
    <Animated.View
      exiting={FadeOut.duration(Motion.duration.slow)}
      onLayout={() => {
        // O nativo só sai DEPOIS que este overlay já ocupou a tela — é o que evita o frame de
        // fundo do sistema entre os dois.
        SplashScreen.hideAsync().finally(() => setLaidOut(true));
      }}
      style={[styles.overlay, { backgroundColor: theme.background }]}>
      <Animated.View style={markStyle}>
        <Canvas style={{ width: MARK, height: MARK }}>
          <Group>
            <Path path={path} color={theme.text} />
          </Group>
        </Canvas>
      </Animated.View>

      {full ? <SettlingLines progress={lines} tint={theme.textSecondary} /> : null}
    </Animated.View>
  );
}

/**
 * Três linhas que escorrem da direita e assentam.
 *
 * É o produto em um gesto: o que o usuário joga solto no WhatsApp aparece aqui organizado. Sem
 * isso a abertura seria só um logo girando, que qualquer app tem.
 */
function SettlingLines({
  progress,
  tint,
}: {
  progress: { get: () => number };
  tint: string;
}) {
  return (
    <View style={styles.lines}>
      {[0, 1, 2].map((i) => (
        <Line key={i} index={i} progress={progress} tint={tint} />
      ))}
    </View>
  );
}

const LINE_WIDTHS = [96, 132, 72];

function Line({
  index,
  progress,
  tint,
}: {
  index: number;
  progress: { get: () => number };
  tint: string;
}) {
  const style = useAnimatedStyle(() => {
    // Stagger dentro do worklet: cada linha começa 18% depois da anterior e satura em 1.
    const p = Math.min(1, Math.max(0, (progress.get() - index * 0.18) / 0.55));
    return {
      opacity: p,
      transform: [{ translateX: (1 - p) * 40 }],
    };
  });

  return (
    <Animated.View
      style={[styles.line, { width: LINE_WIDTHS[index], backgroundColor: tint }, style]}
    />
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  lines: {
    marginTop: Space.xxl,
    gap: Space.sm,
    alignItems: 'flex-start',
  },
  line: {
    height: 6,
    borderRadius: 3,
    borderCurve: 'continuous',
  },
});
