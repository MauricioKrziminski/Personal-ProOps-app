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
import { Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
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
import { ThemedText } from '@/components/themed-text';
import { markPath } from '@/design/mark-path';
import { Motion, Space } from '@/design/tokens';
import { progressoDaCapa } from '@/design/wave-math';
import { useTheme } from '@/hooks/use-theme';
import {
  esperaDaAbertura,
  esperaDaMarca,
  origemValida,
  type FaseDaCortina,
  type Onda,
  type Ponto,
} from '@/lib/session-gate';

import type { CortinaApi } from './session-curtain.types';

/** Lado da marca (dp): a mesma caixa que o PNG do splash tinha, para ela ficar no mesmo lugar. */
const LADO = 96;
/** Abertura e logout terminam na mesma curva fixa da tela de conta. */
const ONDA_DA_ABERTURA: Onda = { mode: 'up' };
/** A marca se constrói (traço + preenchimento + nome) DENTRO de `MARCA_MINIMA_MS` (900): nunca alarga a espera. */
const CONSTRUCAO_MS = 800;
/** Tempo máximo para manter um canvas pré-montado enquanto uma confirmação nativa está aberta. */
const TETO_DO_PREPARO_MS = 4000;

const doisQuadros = () =>
  new Promise<void>((ok) => requestAnimationFrame(() => requestAnimationFrame(() => ok())));
const dormir = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));

const CortinaContext = createContext<CortinaApi | null>(null);
const FaseContext = createContext<FaseDaCortina>('abertura');
const AbertaContext = createContext(false);
const SaindoContext = createContext(false);

export function useCortina(): CortinaApi {
  const cortina = useContext(CortinaContext);
  if (!cortina) throw new Error('useCortina precisa do CortinaProvider (raiz do app)');
  return cortina;
}

export function useCortinaFase(): FaseDaCortina {
  return useContext(FaseContext);
}

/** `true` quando a abertura já revelou e nada cobre a tela. */
export function useCortinaAberta(): boolean {
  return useContext(AbertaContext);
}

/**
 * `true` desde que a tinta COMEÇA A SAIR (subindo ou descendo) e enquanto nada cobre a tela. É o
 * sinal das entradas das raízes: a cascata, a barra de abas e as telas de conta chegam junto com
 * a cortina, como no vídeo — esperar o fim da onda deixaria a tela vazia aparecendo por baixo.
 */
export function useCortinaSaindo(): boolean {
  return useContext(SaindoContext);
}

/**
 * A cortina de azulejos da raiz — a abertura do app e a passagem de toda troca de sessão.
 *
 * ## Uma camada, dona de um progresso
 *
 * `progresso` vai de 0 (coberto) a 1 (revelado) e é o único valor que anda. Aberta, a camada só
 * fica montada durante o preparo curto de uma confirmação nativa; no uso normal ela desmonta —
 * um canvas do tamanho da tela por cima do app custaria composição em todo quadro.
 *
 * ## A abertura
 *
 * | t | o quê |
 * |---|---|
 * | 0 | splash nativo: SÓ a tinta `#0B0B0C` (sem marca) |
 * | camada fez layout | `hideAsync()`: o nativo sai com a camada idêntica (tinta lisa) por cima |
 * | camada pintou | a marca se constrói em 0,8 s: contorno se desenha, preenchimento entra, nome "ProOps" aparece; depois fica parada |
 * | pronto (fontes + sessão + trava, teto 2,5 s; 20 s com a senha pedida) | a tinta sobe com a borda em curva e libera o app; a marca sobe e some no primeiro terço |
 * | sempre | a marca fica ao menos 0,9 s antes da tinta subir (a construção cabe nisso) |
 *
 * ## Por que `cobrir` espera dois quadros a mais
 *
 * O canvas do Skia pinta um ou dois quadros depois de montar. Andar o progresso antes disso não
 * desenharia nada: a cortina "chegaria" já fechada, de uma vez.
 *
 * ## O hand-off com o splash nativo
 *
 * O splash nativo é só tinta, e o primeiro quadro da camada também (o fundo da `WaveCurtain` com a
 * cortina fechada): a marca nasce DEPOIS, desenhando-se, e por isso não há marca pronta para
 * piscar. Splash sem marca é mudança NATIVA (`app.json`): entra na build 1.7.0, nunca por OTA.
 * `hideAsync()` só roda depois que a camada fez layout. `fade: false` evita um cross-fade do
 * sistema por cima do nosso no iOS.
 *
 * ## Reduce Motion
 *
 * Sem onda e sem desenho: um véu de tinta que aparece e some em 200 ms; marca e nome entram por fade.
 */
export function CortinaProvider({ children }: { children: ReactNode }) {
  const reduzido = useReducedMotion();
  const { height: alturaDaTela } = useWindowDimensions();
  const progresso = useSharedValue(0);
  const [fase, setFase] = useState<FaseDaCortina>('abertura');
  const [onda, setOnda] = useState<Onda>(ONDA_DA_ABERTURA);
  const [pintada, setPintada] = useState(false);
  const [aberturaFeita, setAberturaFeita] = useState(false);
  const [camadaMontada, setCamadaMontada] = useState(false);

  const pronto = useRef<{
    valor: boolean;
    destino: 'app' | 'conta';
    segurando: boolean;
  }>({
    valor: false,
    destino: 'app',
    segurando: false,
  });
  const origem = useRef<{ ponto: Ponto; em: number } | null>(null);
  /** A cobertura iniciada pelo gesto de logout é consumida pelo evento de sessão, sem reiniciar. */
  const coberturaAtual = useRef<Promise<void> | null>(null);
  const preparo = useRef<ReturnType<typeof setTimeout> | null>(null);
  // O splash nativo é só a tinta (sem marca): ele sai quando a camada já fez layout.
  const splash = useRef({ layout: false, escondido: false });

  const animar = useCallback(
    (alvo: number, duracao: number) =>
      new Promise<void>((ok) => {
        progresso.set(
          withTiming(
            alvo,
            {
              duration: reduzido ? Motion.duration.base : duracao,
              easing: Easing.linear,
            },
            () => {
              'worklet';
              // Resolve também quando é cancelada: quem espera é o portão, e ele não pode travar.
              runOnJS(ok)();
            },
          ),
        );
      }),
    [progresso, reduzido],
  );

  const cancelarPreparo = useCallback(() => {
    if (preparo.current !== null) {
      clearTimeout(preparo.current);
      preparo.current = null;
    }
  }, []);

  /** Monta e mede o canvas antes de uma confirmação nativa, sem interceptar toques nem aparecer. */
  const preparar = useCallback(() => {
    cancelarPreparo();
    setCamadaMontada(true);
    preparo.current = setTimeout(() => {
      preparo.current = null;
      setCamadaMontada(false);
    }, TETO_DO_PREPARO_MS);
  }, [cancelarPreparo]);

  useEffect(() => cancelarPreparo, [cancelarPreparo]);

  const cobrir = useCallback(
    (o: Onda) => {
      // O logout começa a cobrir no toque; o evento do Supabase chega depois e reutiliza esta
      // mesma promessa. Reiniciar aqui faria a onda esperar a rede duas vezes.
      if (coberturaAtual.current) {
        setOnda(o);
        return coberturaAtual.current;
      }
      cancelarPreparo();
      const cobertura = (async () => {
        progresso.set(1);
        setOnda(o);
        setFase('cobrindo');
        // A camada pode ter acabado de montar; dois quadros bastam para layout e primeiro paint.
        await doisQuadros();
        await animar(0, Motion.curtain.duration);
        setFase('coberta');
      })();
      coberturaAtual.current = cobertura;
      return cobertura;
    },
    [animar, cancelarPreparo, progresso],
  );

  const cobrirDaCapa = useCallback(async () => {
    cancelarPreparo();
    coberturaAtual.current = null;
    cancelAnimation(progresso);
    progresso.set(progressoDaCapa(alturaDaTela));
    setOnda({ mode: 'up', fromCap: true });
    setFase('cobrindo');
    // A borda parte exatamente da capa, com a marca presa à mesma curva durante a descida.
    await doisQuadros();
    await animar(0, Motion.curtain.duration);
    setFase('coberta');
  }, [alturaDaTela, animar, cancelarPreparo, progresso]);

  const cobrirJa = useCallback(() => {
    coberturaAtual.current = null;
    cancelAnimation(progresso);
    progresso.set(0);
    setFase('coberta');
  }, [progresso]);

  const descobrir = useCallback(
    async (o: Onda, duracao: number) => {
      coberturaAtual.current = null;
      setOnda(o);
      setFase('revelando');
      // O React precisa aplicar a onda nova antes de o progresso andar: nos primeiros quadros a
      // forma velha ainda estaria na tela.
      await doisQuadros();
      // A revelação da conta termina na curva da AuthCap, com a marca na mesma posição.
      // As duas metades da transição têm a mesma duração, mesmo com distâncias diferentes.
      const alvo = o.ate === 'capa' ? progressoDaCapa(alturaDaTela) : 1;
      await animar(alvo, duracao);
      setFase('aberta');
      setCamadaMontada(false);
    },
    [animar, alturaDaTela],
  );

  const abrirJa = useCallback(() => {
    cancelarPreparo();
    coberturaAtual.current = null;
    cancelAnimation(progresso);
    progresso.set(1);
    setFase('aberta');
    setCamadaMontada(false);
    setAberturaFeita(true);
  }, [cancelarPreparo, progresso]);

  const lembrarOrigem = useCallback((ponto: Ponto) => {
    origem.current = { ponto, em: Date.now() };
  }, []);

  const tomarOrigem = useCallback(() => {
    const ponto = origemValida(origem.current, Date.now());
    origem.current = null;
    return ponto;
  }, []);

  const marcarPronto = useCallback((destino: 'app' | 'conta') => {
    if (pronto.current.valor) return;
    pronto.current.valor = true;
    pronto.current.destino = destino;
  }, []);

  const segurarAbertura = useCallback(() => {
    pronto.current.segurando = true;
  }, []);

  const esconderSplash = useCallback(() => {
    const s = splash.current;
    if (!s.layout || s.escondido) return;
    s.escondido = true;
    SplashScreen.hideAsync()
      .catch(() => {})
      .finally(() => setPintada(true));
  }, []);

  useEffect(() => {
    /*
      No Android o splash some com uma animação de opacidade da própria vista dele, e o conteúdo
      só começa a desenhar DEPOIS do `hideAsync()`. Com duração 0 sobravam ~150 ms de preto puro
      entre os dois (gravado em 16/09/2026). Com 300 ms a tinta do splash esmaece por cima da tinta
      da cortina, que já está desenhando — a passagem some. No iOS o nosso quadro já existe quando
      o nativo sai, e `fade: false` evita um segundo cross-fade.
    */
    SplashScreen.setOptions({
      duration: Platform.OS === 'android' ? 300 : 0,
      fade: false,
    });
  }, []);

  /*
    A abertura roda UMA vez, quando a camada pintou. O teto conta daqui: com o app pronto
    antes da construção acabar, a marca já cabe no mínimo de 0,9 s; com o app atrasado, o teto
    abre assim mesmo — tela de login atrasada é melhor que splash eterno. Com a trava pedindo a
    senha (`segurarAbertura`) o teto é longo: a marca fica enquanto o sistema pergunta e a tinta
    sobe direto no app desbloqueado.
  */
  const comecou = useRef(false);
  useEffect(() => {
    if (!pintada || comecou.current) return;
    comecou.current = true;
    const desde = Date.now();

    void (async () => {
      // ponytail: espera por sondagem (50 ms, só durante a abertura) — o teto muda de tamanho
      // quando a trava segura, e um laço relê isso sem timer para rearmar.
      const p = pronto.current;
      while (!p.valor && esperaDaAbertura(desde, Date.now(), p.segurando) > 0) await dormir(50);
      // A marca não pode ser um lampejo: a passagem "marca → app" acontece em toda abertura
      // (também com Reduzir Movimento — ficar parada na tela não é movimento).
      await dormir(esperaDaMarca(desde, Date.now()));
      // Teto estourado deixa o destino em `app`: revelar tudo é o lado seguro.
      const capa = pronto.current.destino === 'conta';
      await descobrir(
        capa ? { ...ONDA_DA_ABERTURA, ate: 'capa' } : ONDA_DA_ABERTURA,
        Motion.curtain.duration,
      );
      setAberturaFeita(true);
    })();
  }, [pintada, descobrir]);

  const api = useMemo<CortinaApi>(
    () => ({
      preparar,
      cobrir,
      cobrirDaCapa,
      cobrirJa,
      revelar: (o) => descobrir(o, Motion.curtain.duration),
      abrirJa,
      lembrarOrigem,
      tomarOrigem,
      marcarPronto,
      segurarAbertura,
    }),
    [
      preparar,
      cobrir,
      cobrirDaCapa,
      cobrirJa,
      descobrir,
      abrirJa,
      lembrarOrigem,
      tomarOrigem,
      marcarPronto,
      segurarAbertura,
    ],
  );

  const aoLayout = useCallback(() => {
    splash.current.layout = true;
    esconderSplash();
  }, [esconderSplash]);

  return (
    <CortinaContext.Provider value={api}>
      <FaseContext.Provider value={fase}>
        <AbertaContext.Provider value={aberturaFeita && fase === 'aberta'}>
          <SaindoContext.Provider value={fase === 'revelando' || fase === 'aberta'}>
            {children}
            {fase === 'aberta' && !camadaMontada ? null : (
              <Camada
                fase={fase}
                onda={onda}
                progresso={progresso}
                reduzido={reduzido}
                comMarca={!aberturaFeita}
                pintada={pintada}
                onLayout={aoLayout}
              />
            )}
          </SaindoContext.Provider>
        </AbertaContext.Provider>
      </FaseContext.Provider>
    </CortinaContext.Provider>
  );
}

function Camada({
  fase,
  onda,
  progresso,
  reduzido,
  comMarca,
  pintada,
  onLayout,
}: {
  fase: FaseDaCortina;
  onda: Onda;
  progresso: SharedValue<number>;
  reduzido: boolean;
  comMarca: boolean;
  pintada: boolean;
  onLayout: () => void;
}) {
  const theme = useTheme();
  const veu = useAnimatedStyle(() => ({ opacity: 1 - progresso.get() }));

  return (
    <View
      onLayout={onLayout}
      // Enquanto cobre, a camada engole o toque (ela é o alvo, e não tem responder). Revelando,
      // o app de baixo já é o destino.
      pointerEvents={fase === 'aberta' || fase === 'revelando' ? 'none' : 'auto'}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.camada}
    >
      {reduzido ? (
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: theme.curtain }, veu]} />
      ) : (
        <WaveCurtain
          progress={progresso}
          fase={fase === 'cobrindo' && !onda.fromCap ? 'cobrir' : 'revelar'}
          mode={fase === 'revelando' ? (onda.revealMode ?? onda.mode) : onda.mode}
          origin={onda.origin}
          color={theme.curtain}
          style={StyleSheet.absoluteFill}
        />
      )}
      {comMarca ? <MarcaDaAbertura progresso={progresso} pintada={pintada} reduzido={reduzido} /> : null}
    </View>
  );
}

const suave = (x: number) => {
  'worklet';
  const k = Math.min(1, Math.max(0, x));
  return k * k * (3 - 2 * k);
};

/**
 * A marca no centro da abertura, SE CONSTRUINDO: o contorno da marca se desenha (trim do path, o
 * mesmo `markPath` do app), o preenchimento entra por baixo dele e o nome "ProOps" aparece
 * abaixo. É o que o splash nativo deixa de fazer — ele é só a tinta, então o primeiro quadro desta
 * camada (nada além da tinta) é idêntico ao dele e não há flash. Na saída a marca sobe e some com
 * a tinta.
 *
 * Um relógio só (`t`, 0 → 1 em `CONSTRUCAO_MS`, dentro do mínimo da marca): depois dele a marca
 * fica desenhada e PARADA, qualquer que seja a espera (rede, senha). Sem loop.
 *
 * Reduzir movimento: sem desenho progressivo, marca e nome entram por fade.
 */
function MarcaDaAbertura({
  progresso,
  pintada,
  reduzido,
}: {
  progresso: SharedValue<number>;
  pintada: boolean;
  reduzido: boolean;
}) {
  const theme = useTheme();
  const t = useSharedValue(0);
  const caminho = useMemo(() => markPath(LADO), []);

  useEffect(() => {
    if (!pintada) return;
    t.set(
      withTiming(1, {
        duration: reduzido ? Motion.duration.base : CONSTRUCAO_MS,
        easing: Easing.linear,
      }),
    );
  }, [pintada, reduzido, t]);

  // Traço 0 → 58%; o preenchimento entra de 42% a 78% e leva o contorno embora; o nome fecha.
  const fim = useDerivedValue(() => suave(t.get() / 0.58));
  const contorno = useDerivedValue(() => (reduzido ? 0 : 1 - suave((t.get() - 0.5) / 0.28)));
  // Reduzido: o canvas fica estático (opacidade 1) e o fade é da View por fora — um valor que muda
  // antes do primeiro quadro do Skia não repinta, e a marca não aparecia.
  const miolo = useDerivedValue(() => (reduzido ? 1 : suave((t.get() - 0.42) / 0.36)));
  const marcaStyle = useAnimatedStyle(() => ({
    opacity: reduzido ? t.get() : 1,
  }));
  const nome = useDerivedValue(() => (reduzido ? t.get() : suave((t.get() - 0.72) / 0.28)));
  const nomeStyle = useAnimatedStyle(() => ({
    opacity: nome.get(),
    transform: [{ translateY: (1 - nome.get()) * 4 }],
  }));

  const sai = useAnimatedStyle(() => {
    const k = Math.min(1, progresso.get() / 0.35);
    return {
      opacity: 1 - k,
      transform: [{ translateY: -k * 36 }, { scale: 1 - k * 0.06 }],
    };
  });

  return (
    <Animated.View style={[styles.palco, sai]} pointerEvents="none">
      <Animated.View style={[styles.marca, marcaStyle]}>
        <SkiaCanvas style={styles.marca}>
          <Path path={caminho} color={theme.onCurtain} opacity={miolo} />
          <Path
            path={caminho}
            style="stroke"
            strokeWidth={2}
            strokeJoin="round"
            color={theme.onCurtain}
            start={0}
            end={fim}
            opacity={contorno}
          />
        </SkiaCanvas>
      </Animated.View>
      <Animated.View style={[styles.nome, nomeStyle]}>
        <ThemedText type="title" themeColor="onCurtain">
          ProOps
        </ThemedText>
      </Animated.View>
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
  // A marca fica no centro da tela; o nome pende ABAIXO dela sem deslocá-la.
  palco: { width: LADO, height: LADO },
  marca: { width: LADO, height: LADO },
  nome: {
    position: 'absolute',
    top: LADO + Space.md,
    left: -80,
    right: -80,
    alignItems: 'center',
  },
});
