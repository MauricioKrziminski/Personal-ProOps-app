import AsyncStorage from '@react-native-async-storage/async-storage';
import { Path, Skia } from '@shopify/react-native-skia';
import * as SplashScreen from 'expo-splash-screen';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Image, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { WaveCurtain } from '@/components/motion/wave-curtain';
import { SkiaCanvas } from '@/components/ui/skia-canvas';
import { Motion } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import { comTeto } from '@/lib/com-teto';
import { TETO_DA_ABERTURA_MS, origemValida, type Onda, type Ponto } from '@/lib/session-gate';

import type { CortinaApi } from './session-curtain.types';

// O MESMO arquivo do splash nativo (app.json): é o que faz o primeiro quadro bater.
const MARCA_BRANCA = require('@/assets/images/brand/mark-white.png');

/** Quantas aberturas ganham o show (a MESMA chave de antes: o contador de quem já usa continua). */
const SHOWS = 5;
const CHAVE_SHOWS = 'proops.splash.shows';
/** Lado da marca — é o `imageWidth` do `expo-splash-screen` no app.json. Os dois PRECISAM bater. */
const LADO = 96;
/** O anel do show: um pouco maior que a marca, com folga para o traço respirar. */
const ANEL = LADO * 1.5;
/** A abertura recolhe a tinta para cima, como nos vídeos de referência. */
const ONDA_DA_ABERTURA: Onda = { mode: 'up' };
const TETO_DO_PNG_MS = 500;

type Fase = 'abertura' | 'cobrindo' | 'coberta' | 'revelando' | 'aberta';
type Show = 'completa' | 'curta';

const doisQuadros = () =>
  new Promise<void>((ok) => requestAnimationFrame(() => requestAnimationFrame(() => ok())));
const dormir = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));

const CortinaContext = createContext<CortinaApi | null>(null);
const AbertaContext = createContext(false);

export function useCortina(): CortinaApi {
  const cortina = useContext(CortinaContext);
  if (!cortina) throw new Error('useCortina precisa do CortinaProvider (raiz do app)');
  return cortina;
}

/** `true` quando a abertura já revelou e nada cobre a tela. */
export function useCortinaAberta(): boolean {
  return useContext(AbertaContext);
}

/**
 * A cortina de azulejos da raiz — a abertura do app e a passagem de toda troca de sessão.
 *
 * ## Uma camada, dona de um progresso
 *
 * `progresso` vai de 0 (coberto) a 1 (revelado) e é o único valor que anda. A camada só existe
 * enquanto cobre alguma coisa: aberta, ela desmonta — um canvas do tamanho da tela por cima do
 * app custaria composição em todo quadro de todas as telas.
 *
 * ## A abertura
 *
 * | t | o quê |
 * |---|---|
 * | 0 | splash nativo: tinta `#0B0B0C` + `mark-white.png` de 96 dp |
 * | camada pintou e o PNG carregou | `hideAsync()`: o nativo sai com a camada idêntica por cima |
 * | show (5 primeiras, 1,8 s) | um anel fino se desenha em volta da marca e some |
 * | pronto (fontes + sessão, teto 2,5 s) | a tinta sobe com a borda em curva e libera o app; a marca sobe e some no primeiro terço |
 *
 * ## Por que `cobrir` espera dois quadros a mais
 *
 * O canvas do Skia pinta um ou dois quadros depois de montar. Andar o progresso antes disso não
 * desenharia nada: a cortina "chegaria" já fechada, de uma vez.
 *
 * ## O hand-off com o splash nativo
 *
 * O primeiro quadro da camada é o splash: tinta lisa (o fundo da `WaveCurtain` com a cortina
 * fechada) e o MESMO PNG, no MESMO tamanho. `hideAsync()` só roda depois que a camada fez layout
 * E o PNG carregou — sem isso o nativo sairia um quadro antes da marca existir, e ela piscaria.
 * `fade: false` pelo mesmo motivo: um cross-fade do sistema por cima do nosso.
 *
 * ## Reduce Motion
 *
 * Sem onda e sem show: um véu de tinta que aparece e some em 200 ms.
 */
export function CortinaProvider({ children }: { children: ReactNode }) {
  const reduzido = useReducedMotion();
  const progresso = useSharedValue(0);
  const [fase, setFase] = useState<Fase>('abertura');
  const [onda, setOnda] = useState<Onda>(ONDA_DA_ABERTURA);
  const [show, setShow] = useState<Show | null>(null);
  const [pintada, setPintada] = useState(false);
  const [aberturaFeita, setAberturaFeita] = useState(false);

  const pronto = useRef<{ valor: boolean; avisar: (() => void) | null }>({
    valor: false,
    avisar: null,
  });
  const origem = useRef<{ ponto: Ponto; em: number } | null>(null);
  const splash = useRef({ layout: false, png: false, escondido: false });

  const animar = useCallback(
    (alvo: 0 | 1, duracao: number) =>
      new Promise<void>((ok) => {
        progresso.set(
          withTiming(
            alvo,
            { duration: reduzido ? Motion.duration.base : duracao, easing: Easing.linear },
            () => {
              'worklet';
              // Resolve também quando é cancelada: quem espera é o portão, e ele não pode travar.
              runOnJS(ok)();
            }
          )
        );
      }),
    [progresso, reduzido]
  );

  const cobrir = useCallback(
    async (o: Onda) => {
      progresso.set(1);
      setOnda(o);
      setFase('cobrindo');
      // O canvas pinta um ou dois quadros depois de montar: antes disso a onda não apareceria.
      await doisQuadros();
      await doisQuadros();
      await animar(0, Motion.curtain.duration);
      setFase('coberta');
    },
    [animar, progresso]
  );

  const descobrir = useCallback(
    async (o: Onda, duracao: number) => {
      setOnda(o);
      setFase('revelando');
      // O React precisa aplicar a onda nova antes de o progresso andar: nos primeiros quadros a
      // ordem velha revelaria outros azulejos.
      await doisQuadros();
      await animar(1, duracao);
      setFase('aberta');
    },
    [animar]
  );

  const abrirJa = useCallback(() => {
    cancelAnimation(progresso);
    progresso.set(1);
    setFase('aberta');
    setAberturaFeita(true);
  }, [progresso]);

  const lembrarOrigem = useCallback((ponto: Ponto) => {
    origem.current = { ponto, em: Date.now() };
  }, []);

  const tomarOrigem = useCallback(() => {
    const ponto = origemValida(origem.current, Date.now());
    origem.current = null;
    return ponto;
  }, []);

  const marcarPronto = useCallback(() => {
    if (pronto.current.valor) return;
    pronto.current.valor = true;
    pronto.current.avisar?.();
  }, []);

  const esconderSplash = useCallback(() => {
    const s = splash.current;
    if (!s.layout || !s.png || s.escondido) return;
    s.escondido = true;
    SplashScreen.hideAsync()
      .catch(() => {})
      .finally(() => setPintada(true));
  }, []);

  useEffect(() => {
    SplashScreen.setOptions({ duration: 0, fade: false });
    // PNG que não carrega não pode segurar o app no splash.
    const t = setTimeout(() => {
      splash.current.png = true;
      esconderSplash();
    }, TETO_DO_PNG_MS);
    return () => clearTimeout(t);
  }, [esconderSplash]);

  useEffect(() => {
    let vivo = true;
    AsyncStorage.getItem(CHAVE_SHOWS)
      .then((v) => {
        const n = Number(v ?? 0);
        if (vivo) setShow(n < SHOWS ? 'completa' : 'curta');
        AsyncStorage.setItem(CHAVE_SHOWS, String(n + 1)).catch(() => {});
      })
      // Sem contador legível, a versão curta: errar para o lado de ser rápido.
      .catch(() => {
        if (vivo) setShow('curta');
      });
    return () => {
      vivo = false;
    };
  }, []);

  /*
    A abertura roda UMA vez, quando a camada pintou e o contador voltou do disco. O teto conta
    daqui: com o app pronto antes do show acabar, o show termina; com o app atrasado, o teto
    abre assim mesmo — tela de login atrasada é melhor que splash eterno.
  */
  const comecou = useRef(false);
  useEffect(() => {
    if (!pintada || show === null || comecou.current) return;
    comecou.current = true;
    const prontoOuTeto = comTeto(
      new Promise<void>((ok) => {
        if (pronto.current.valor) ok();
        else pronto.current.avisar = ok;
      }),
      TETO_DA_ABERTURA_MS,
      'abertura'
    ).catch(() => {});

    void (async () => {
      // O show é o anel se desenhando em volta da marca (`MarcaDaAbertura`); aqui só se espera.
      if (show === 'completa' && !reduzido) await dormir(Motion.curtain.full);
      await prontoOuTeto;
      await descobrir(
        ONDA_DA_ABERTURA,
        show === 'completa' ? Motion.curtain.duration : Motion.curtain.short
      );
      setAberturaFeita(true);
    })();
  }, [pintada, show, reduzido, descobrir]);

  const api = useMemo<CortinaApi>(
    () => ({
      cobrir,
      revelar: (o) => descobrir(o, Motion.curtain.duration),
      abrirJa,
      lembrarOrigem,
      tomarOrigem,
      marcarPronto,
    }),
    [cobrir, descobrir, abrirJa, lembrarOrigem, tomarOrigem, marcarPronto]
  );

  const aoLayout = useCallback(() => {
    splash.current.layout = true;
    esconderSplash();
  }, [esconderSplash]);

  const aoPng = useCallback(() => {
    splash.current.png = true;
    esconderSplash();
  }, [esconderSplash]);

  return (
    <CortinaContext.Provider value={api}>
      <AbertaContext.Provider value={aberturaFeita && fase === 'aberta'}>
        {children}
        {fase === 'aberta' ? null : (
          <Camada
            fase={fase}
            onda={onda}
            progresso={progresso}
            reduzido={reduzido}
            show={aberturaFeita ? null : show}
            comMarca={!aberturaFeita}
            onLayout={aoLayout}
            onPng={aoPng}
          />
        )}
      </AbertaContext.Provider>
    </CortinaContext.Provider>
  );
}

function Camada({
  fase,
  onda,
  progresso,
  reduzido,
  show,
  comMarca,
  onLayout,
  onPng,
}: {
  fase: Fase;
  onda: Onda;
  progresso: SharedValue<number>;
  reduzido: boolean;
  show: Show | null;
  comMarca: boolean;
  onLayout: () => void;
  onPng: () => void;
}) {
  const theme = useTheme();
  const veu = useAnimatedStyle(() => ({ opacity: 1 - progresso.get() }));

  return (
    <View
      onLayout={onLayout}
      // Enquanto cobre, a camada engole o toque (ela é o alvo, e não tem responder). Revelando,
      // o app de baixo já é o destino.
      pointerEvents={fase === 'revelando' ? 'none' : 'auto'}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.camada}>
      {reduzido ? (
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: theme.curtain }, veu]} />
      ) : (
        <WaveCurtain
          progress={progresso}
          fase={fase === 'cobrindo' || fase === 'coberta' ? 'cobrir' : 'revelar'}
          mode={onda.mode}
          origin={onda.origin}
          color={theme.curtain}
          style={StyleSheet.absoluteFill}
        />
      )}
      {comMarca ? (
        <MarcaDaAbertura progresso={progresso} show={show} onPng={onPng} reduzido={reduzido} />
      ) : null}
    </View>
  );
}

/**
 * A marca no centro da abertura: o MESMO PNG do splash nativo, no mesmo tamanho. No show, um anel
 * fino se desenha em volta dela e some; na saída, ela sobe e some junto com a tinta.
 */
function MarcaDaAbertura({
  progresso,
  show,
  onPng,
  reduzido,
}: {
  progresso: SharedValue<number>;
  show: Show | null;
  onPng: () => void;
  reduzido: boolean;
}) {
  const theme = useTheme();
  const tracado = useSharedValue(0);
  /** O anel começa no topo e corre no sentido do relógio. */
  const anel = useMemo(() => {
    const b = Skia.PathBuilder.Make();
    const r = ANEL / 2 - 2;
    b.moveTo(ANEL / 2, ANEL / 2 - r);
    b.arcToOval({ x: ANEL / 2 - r, y: ANEL / 2 - r, width: 2 * r, height: 2 * r }, -90, 359.9, false);
    return b.detach();
  }, []);

  useEffect(() => {
    if (show !== 'completa' || reduzido) return;
    tracado.set(withTiming(1, { duration: 1200, easing: Motion.easing.inOut }));
  }, [show, reduzido, tracado]);

  // O anel se fecha e some no último quarto — ele é um gesto, não um estado.
  const brilho = useDerivedValue(() => 1 - Math.max(0, (tracado.get() - 0.75) / 0.25));
  const inicio = useDerivedValue(() => Math.max(0, (tracado.get() - 0.75) / 0.25));

  const sai = useAnimatedStyle(() => {
    const k = Math.min(1, progresso.get() / 0.35);
    return { opacity: 1 - k, transform: [{ translateY: -k * 36 }, { scale: 1 - k * 0.06 }] };
  });

  return (
    <Animated.View style={[styles.palco, sai]} pointerEvents="none">
      <Image source={MARCA_BRANCA} onLoad={onPng} fadeDuration={0} style={styles.marca} />
      {show === 'completa' && !reduzido ? (
        <SkiaCanvas style={StyleSheet.absoluteFill}>
          <Path
            path={anel}
            style="stroke"
            strokeWidth={1.5}
            strokeCap="round"
            color={theme.onCurtainMuted}
            start={inicio}
            end={tracado}
            opacity={brilho}
          />
        </SkiaCanvas>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  camada: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    // Acima da trava (900). `elevation` é o que ordena de verdade no Android.
    zIndex: 1000,
    elevation: 1000,
  },
  palco: { width: ANEL, height: ANEL, alignItems: 'center', justifyContent: 'center' },
  marca: { width: LADO, height: LADO },
});
