import AsyncStorage from '@react-native-async-storage/async-storage';
import { Path } from '@shopify/react-native-skia';
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
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { TileField } from '@/components/motion/tile-field';
import { SkiaCanvas } from '@/components/ui/skia-canvas';
import { markPathIn } from '@/design/mark-path';
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
/** Onde a tinta começa e termina dentro do PNG de 512 px (medido: 61..451). */
const TINTA = { de: (61 / 512) * LADO, ate: (451 / 512) * LADO };
/** Nasce no canto inferior esquerdo e termina no superior direito, onde a Fase 3 põe o canto. */
const ONDA_DA_ABERTURA: Onda = { mode: 'diagonal', origin: { x: 0, y: 1 } };
const ONDA_DO_SHOW: Onda = { mode: 'radial', origin: { x: 0.5, y: 0.5 } };
const TETO_DA_TEXTURA_MS = 300;
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
 * | 0 | splash nativo: tinta `#0D0D0C` + `mark-white.png` de 96 dp |
 * | camada pintou e o PNG carregou | `hideAsync()`: o nativo sai com a camada idêntica por cima |
 * | show (5 primeiras, 1,8 s) | um traço azul corre o contorno da espiral; em volta, uma ondulação vira os azulejos e os assenta de novo |
 * | pronto (fontes + sessão, teto 2,5 s) | a onda diagonal recolhe os azulejos, do canto inferior esquerdo ao superior direito; a marca some no primeiro quarto |
 *
 * ## Por que `cobrir` espera a textura
 *
 * O `TileField` cria a textura das peças na thread de UI, um ou dois quadros depois de montar.
 * Andar o progresso antes disso não desenha nada: a cortina "chegaria" já fechada, de uma vez.
 * O teto (300 ms) garante que ela anda mesmo se a textura atrasar.
 *
 * ## O hand-off com o splash nativo
 *
 * O primeiro quadro da camada é o splash: tinta lisa (o `cover` do campo enquanto não há
 * textura) e o MESMO PNG, no MESMO tamanho. `hideAsync()` só roda depois que a camada fez layout
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
  const [invert, setInvert] = useState(false);
  const [show, setShow] = useState<Show | null>(null);
  const [pintada, setPintada] = useState(false);
  const [aberturaFeita, setAberturaFeita] = useState(false);

  const textura = useRef<{ pronta: boolean; avisar: (() => void) | null }>({
    pronta: false,
    avisar: null,
  });
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

  const esperarTextura = useCallback(() => {
    if (reduzido || textura.current.pronta) return Promise.resolve();
    const espera = new Promise<void>((ok) => {
      textura.current.avisar = ok;
    });
    return comTeto(espera, TETO_DA_TEXTURA_MS, 'textura').catch(() => {});
  }, [reduzido]);

  const aoTexturaPronta = useCallback(() => {
    textura.current.pronta = true;
    textura.current.avisar?.();
    textura.current.avisar = null;
  }, []);

  const cobrir = useCallback(
    async (o: Onda) => {
      progresso.set(1);
      setOnda(o);
      setInvert(true);
      setFase('cobrindo');
      await doisQuadros();
      await esperarTextura();
      await animar(0, Motion.curtain.duration);
      setFase('coberta');
    },
    [animar, esperarTextura, progresso]
  );

  const descobrir = useCallback(
    async (o: Onda, duracao: number) => {
      setOnda(o);
      setInvert(false);
      setFase('revelando');
      // O React precisa aplicar a onda nova antes de o progresso andar: nos primeiros quadros a
      // ordem velha revelaria outros azulejos.
      await doisQuadros();
      await animar(1, duracao);
      textura.current.pronta = false;
      setFase('aberta');
    },
    [animar]
  );

  const abrirJa = useCallback(() => {
    cancelAnimation(progresso);
    progresso.set(1);
    textura.current.pronta = false;
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
      if (show === 'completa' && !reduzido) {
        await esperarTextura();
        setOnda(ONDA_DO_SHOW);
        await doisQuadros();
        progresso.set(
          withSequence(
            withTiming(0.16, { duration: 700, easing: Motion.easing.out }),
            withTiming(0, { duration: 700, easing: Motion.easing.inOut })
          )
        );
        await dormir(Motion.curtain.full);
      }
      await prontoOuTeto;
      await descobrir(
        ONDA_DA_ABERTURA,
        show === 'completa' ? Motion.curtain.duration : Motion.curtain.short
      );
      setAberturaFeita(true);
    })();
  }, [pintada, show, reduzido, esperarTextura, descobrir, progresso]);

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
            invert={invert}
            progresso={progresso}
            reduzido={reduzido}
            show={aberturaFeita ? null : show}
            comMarca={!aberturaFeita}
            onTextura={aoTexturaPronta}
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
  invert,
  progresso,
  reduzido,
  show,
  comMarca,
  onTextura,
  onLayout,
  onPng,
}: {
  fase: Fase;
  onda: Onda;
  invert: boolean;
  progresso: SharedValue<number>;
  reduzido: boolean;
  show: Show | null;
  comMarca: boolean;
  onTextura: () => void;
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
        <Animated.View
          style={[StyleSheet.absoluteFill, { backgroundColor: theme.tileInk }, veu]}
        />
      ) : (
        <>
          {/*
            Durante a abertura há tinta lisa POR TRÁS do campo: a ondulação do show vira os
            azulejos, e sem este fundo o app apareceria pelas frestas antes da hora.
          */}
          {fase === 'abertura' ? (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.tileInk }]} />
          ) : null}
          <TileField
            progress={progresso}
            mode={onda.mode}
            origin={onda.origin}
            invert={invert}
            cover
            onReady={onTextura}
            style={StyleSheet.absoluteFill}
          />
        </>
      )}
      {comMarca ? (
        <MarcaDaAbertura progresso={progresso} show={show} onPng={onPng} reduzido={reduzido} />
      ) : null}
    </View>
  );
}

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
  const contorno = useMemo(
    () => markPathIn(TINTA.de, TINTA.de, TINTA.ate - TINTA.de, TINTA.ate - TINTA.de),
    []
  );

  useEffect(() => {
    if (show !== 'completa' || reduzido) return;
    tracado.set(withTiming(1, { duration: 1100, easing: Motion.easing.inOut }));
  }, [show, reduzido, tracado]);

  // O traço aparece inteiro e some no último terço — ele é um gesto, não um estado.
  const brilho = useDerivedValue(() => 1 - Math.max(0, (tracado.get() - 0.7) / 0.3));

  const sai = useAnimatedStyle(() => {
    const k = Math.min(1, progresso.get() / 0.25);
    return { opacity: 1 - k, transform: [{ scale: 1 - k * 0.08 }] };
  });

  return (
    <Animated.View style={[styles.marca, sai]} pointerEvents="none">
      <Image source={MARCA_BRANCA} onLoad={onPng} fadeDuration={0} style={styles.marca} />
      {show === 'completa' && !reduzido ? (
        <SkiaCanvas style={StyleSheet.absoluteFill}>
          <Path
            path={contorno}
            style="stroke"
            strokeWidth={2}
            strokeCap="round"
            strokeJoin="round"
            color={theme.tintFill}
            start={0}
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
  marca: { width: LADO, height: LADO },
});
