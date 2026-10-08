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
  ReduceMotion,
  cancelAnimation,
  makeMutable,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { CONSTRUCAO_MS, MarcaSeConstruindo } from '@/components/motion/marca-se-construindo';
import { WaveCurtain } from '@/components/motion/wave-curtain';
import { Motion } from '@/design/tokens';
import { progressoDaCapa } from '@/design/wave-math';
import { useTheme } from '@/hooks/use-theme';
import {
  TETO_DA_ABERTURA_MS,
  esperaDaAbertura,
  esperaDaMarca,
  origemValida,
  type FaseDaCortina,
  type Onda,
  type Ponto,
} from '@/lib/session-gate';
import { marcar } from '@/lib/trilha-da-abertura';

import type { CortinaApi } from './session-curtain.types';

/** Abertura e logout terminam na mesma curva fixa da tela de conta. */
const ONDA_DA_ABERTURA: Onda = { mode: 'up' };
/** O fade de saída da splash nativa no Android (`SplashScreen.setOptions`); a marca começa depois dele. */
const SAIDA_DO_NATIVO_ANDROID_MS = 300;
/** Tempo máximo para manter um canvas pré-montado enquanto uma confirmação nativa está aberta. */
const TETO_DO_PREPARO_MS = 4000;

/*
  ⚠️ **Toda espera da cortina tem prazo** (06/10/2026, iPhone: depois da senha a marca ficava
  pronta e a tinta não subia nunca — só matando o app). Quadro e callback de animação podem não vir
  com o app fora do primeiro plano (o prompt de senha do sistema), e a abertura esperava os dois
  sem saída. A trava (`lock-overlay.tsx`) já tinha o seu prazo; a cortina da raiz não tinha.
*/
/*
  ⚠️ **As esperas da cortina contam no relógio da UI thread, nunca em `setTimeout`/rAF**
  (08/10/2026, trilha do iPhone): voltando do Face ID, TODO timer do JS parou — o `tic` morreu no
  instante do `active` e o `dormir(0)` nunca resolveu —, enquanto o toque e o Reanimated seguiam
  vivos. Os dois timers do JS passam pelo `RCTTiming`, e é ele que fica mudo. `withTiming` com
  callback anda no relógio de quadros do Reanimated e volta ao JS por `runOnJS`, sem `RCTTiming`.
  `ReduceMotion.Never`: aqui ele é relógio, não animação — com Reduzir Movimento ele pularia ao fim.
*/
const esperarNaUi = (ms: number) =>
  new Promise<void>((ok) => {
    const relogio = makeMutable(0);
    relogio.value = withTiming(
      1,
      { duration: Math.max(ms, 0), reduceMotion: ReduceMotion.Never },
      () => {
        'worklet';
        runOnJS(ok)();
      },
    );
  });
/** Dois quadros a 60 Hz: o React aplica a onda nova antes de o progresso andar. */
const doisQuadros = () => esperarNaUi(34);
/** Folga além da duração antes de a cortina assumir que o callback da animação não vem. */
const FOLGA_DA_ANIMACAO_MS = 600;
const dormir = esperarNaUi;

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
 * | camada fez layout | `hideAsync()`: o nativo sai com a camada idêntica (tinta lisa) por cima; a marca começa já no iOS e, no Android, quando o fade do nativo (300 ms) termina |
 * | a partir daí | a marca se constrói em 1,5 s: contorno se desenha, preenchimento entra, nome "ProOps" aparece; depois fica parada |
 * | pronto (fontes + sessão + trava, teto 2,5 s; 20 s com a senha pedida) | a tinta sobe com a borda em curva e libera o app; a marca sobe e some no primeiro terço |
 * | sempre | a marca fica ao menos 1,7 s antes da tinta subir (a construção de 1,5 s cabe nisso) |
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
  /** O relógio da marca (0 → 1): mora aqui para o `aoLayout` o disparar sem esperar um render. */
  const construcao = useSharedValue(0);
  const [fase, setFase] = useState<FaseDaCortina>('abertura');
  const [onda, setOnda] = useState<Onda>(ONDA_DA_ABERTURA);
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
        const ms = reduzido ? Motion.duration.base : duracao;
        // Sem o callback (quadros parados), a cortina vai direto ao fim: tela presa é pior que corte.
        const prazo = setTimeout(() => {
          cancelAnimation(progresso);
          progresso.set(alvo);
          ok();
          marcar('animar:prazo', { alvo });
        }, ms + FOLGA_DA_ANIMACAO_MS);
        const terminou = () => {
          marcar('animar:callback', { alvo });
          clearTimeout(prazo);
          ok();
        };
        progresso.set(
          withTiming(
            alvo,
            { duration: ms, easing: Easing.linear },
            () => {
              'worklet';
              // Resolve também quando é cancelada: quem espera é o portão, e ele não pode travar.
              runOnJS(terminou)();
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
    marcar('cortina:cobrirJa');
    coberturaAtual.current = null;
    cancelAnimation(progresso);
    progresso.set(0);
    setFase('coberta');
  }, [progresso]);

  const descobrir = useCallback(
    async (o: Onda, duracao: number) => {
      marcar('cortina:descobrir', { modo: o.mode, ate: o.ate ?? null });
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
      marcar('cortina:aberta');
      setFase('aberta');
      setCamadaMontada(false);
    },
    [animar, alturaDaTela],
  );

  const abrirJa = useCallback(() => {
    marcar('cortina:abrirJa');
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

  /** Acorda a espera da abertura quando `pronto` ou o teto mudam — sem sondar a cada 50 ms. */
  const acordar = useRef<(() => void) | null>(null);

  const marcarPronto = useCallback((destino: 'app' | 'conta') => {
    marcar('abertura:marcarPronto', { destino, ja: pronto.current.valor });
    if (pronto.current.valor) return;
    pronto.current.valor = true;
    pronto.current.destino = destino;
    acordar.current?.();
  }, []);

  const segurarAbertura = useCallback(() => {
    marcar('abertura:segurar', { ja: pronto.current.segurando });
    pronto.current.segurando = true;
    acordar.current?.();
  }, []);

  /*
    A abertura roda UMA vez, no instante em que a camada fez layout — direto do `aoLayout`, sem
    passar por um render do React: com o JS ocupado montando a árvore do app, `setState` + efeito
    atrasavam o primeiro traço da marca (medido no dev: ~2 s entre o layout e o traço). O relógio da
    marca é um valor da UI thread, e o mínimo de 1,7 s conta DESTE instante (a marca está na tela).
    O teto conta daqui: com o app pronto antes da construção acabar, a marca já cabe no mínimo;
    com o app atrasado, o teto abre assim mesmo — tela de login atrasada é melhor que splash
    eterno. Com a trava pedindo a senha (`segurarAbertura`) o teto é longo: a marca fica enquanto
    o sistema pergunta e a tinta sobe direto no app desbloqueado.
  */
  const comecou = useRef(false);
  /** Quando a abertura começou: a saída por toque só vale depois do teto curto. */
  const inicioDaAbertura = useRef(0);
  /** A pessoa tocou na cortina presa e ela abriu: a espera da abertura não revela de novo. */
  const saiuPorToque = useRef(false);
  const construir = useCallback(() => {
    construcao.set(0);
    construcao.set(
      withTiming(1, {
        duration: reduzido ? Motion.duration.base : CONSTRUCAO_MS,
        easing: Easing.linear,
      }),
    );
  }, [construcao, reduzido]);

  const abertura = useCallback(() => {
    if (comecou.current) return;
    comecou.current = true;
    const desde = Date.now();
    inicioDaAbertura.current = desde;
    marcar('abertura:inicio');
    construir();

    void (async () => {
      const p = pronto.current;
      // Dorme até o teto OU até alguém avisar (pronto/segurar); o teto é relido a cada volta.
      while (!p.valor) {
        const falta = esperaDaAbertura(desde, Date.now(), p.segurando);
        marcar('abertura:espera', { falta, segurando: p.segurando });
        if (falta <= 0) break;
        await new Promise<void>((ok) => {
          const timer = setTimeout(ok, falta);
          acordar.current = () => {
            clearTimeout(timer);
            ok();
          };
        });
      }
      acordar.current = null;
      marcar('abertura:saiu-da-espera', { pronto: p.valor, destino: p.destino, ms: Date.now() - desde });
      // A marca não pode ser um lampejo: a passagem "marca → app" acontece em toda abertura
      // (também com Reduzir Movimento — ficar parada na tela não é movimento).
      await dormir(esperaDaMarca(desde, Date.now()));
      if (saiuPorToque.current) return;
      // Teto estourado deixa o destino em `app`: revelar tudo é o lado seguro.
      const capa = pronto.current.destino === 'conta';
      await descobrir(
        capa ? { ...ONDA_DA_ABERTURA, ate: 'capa' } : ONDA_DA_ABERTURA,
        Motion.curtain.duration,
      );
      setAberturaFeita(true);
      marcar('abertura:fim');
    })();
  }, [construir, descobrir]);

  /*
    A saída de emergência (08/10/2026): a cortina da abertura presa depois do teto curto abre com
    um toque. Toque é evento, não timer — chega ao JS mesmo que a espera tenha se perdido. Com a
    trava ligada, o que aparece é a trava, que pede a senha de novo.
  */
  const sairPorToque = useCallback(() => {
    if (!comecou.current || saiuPorToque.current) return;
    if (Date.now() - inicioDaAbertura.current < TETO_DA_ABERTURA_MS) return;
    marcar('abertura:saida-por-toque');
    saiuPorToque.current = true;
    abrirJa();
  }, [abrirJa]);

  /*
    Dois relógios por 60 s desde a montagem (ponytail: diagnóstico temporário): `tic` é o timer do
    JS (`RCTTiming`), `tic-ui` é o da UI thread. Um parado e o outro andando mostra a janela em que
    os timers do JS morreram — e se voltam depois de a cortina abrir.
  */
  useEffect(() => {
    let vivo = true;
    let n = 0;
    const batida = setInterval(() => {
      n += 1;
      marcar('tic', { n });
      if (n >= 60) clearInterval(batida);
    }, 1000);
    const batidaUi = (k: number) => {
      void esperarNaUi(1000).then(() => {
        if (!vivo) return;
        marcar('tic-ui', { n: k });
        if (k < 60) batidaUi(k + 1);
      });
    };
    batidaUi(1);
    return () => {
      vivo = false;
      clearInterval(batida);
    };
  }, []);

  const esconderSplash = useCallback(() => {
    const s = splash.current;
    if (!s.layout || s.escondido) return;
    s.escondido = true;
    /*
      iOS: o nosso quadro já existe quando o nativo sai (`fade: false`), então a marca começa JÁ —
      esperar a promessa era tinta parada à toa ("tem um delay para começar a animar a logo").
      Android: o nativo esmaece `SAIDA_DO_NATIVO_ANDROID_MS` por cima (com aceleração: quase opaco
      na primeira metade), e `hideAsync()` resolve NA HORA — só desliga o "segure a splash"
      (`SplashScreenManager.hide`), não espera a saída. Começando antes, o traço inteiro acontecia
      sob o fade e o release mostrava só o preenchimento surgindo (06/10/2026). Lá a marca
      começa quando a saída que nós mesmos configuramos termina.
    */
    void SplashScreen.hideAsync().catch(() => {});
    if (Platform.OS === 'android') setTimeout(abertura, SAIDA_DO_NATIVO_ANDROID_MS);
    else abertura();
  }, [abertura]);

  useEffect(() => {
    /*
      No Android o splash some com uma animação de opacidade da própria vista dele, e o conteúdo
      só começa a desenhar DEPOIS do `hideAsync()`. Com duração 0 sobravam ~150 ms de preto puro
      entre os dois (gravado em 16/09/2026). Com 300 ms a tinta do splash esmaece por cima da tinta
      da cortina, que já está desenhando — a passagem some. No iOS o nosso quadro já existe quando
      o nativo sai, e `fade: false` evita um segundo cross-fade.
    */
    SplashScreen.setOptions({
      duration: Platform.OS === 'android' ? SAIDA_DO_NATIVO_ANDROID_MS : 0,
      fade: false,
    });
  }, []);

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
    marcar('camada:layout', { ja: splash.current.layout });
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
                construcao={construcao}
                onLayout={aoLayout}
                onToque={fase === 'abertura' && !aberturaFeita ? sairPorToque : undefined}
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
  construcao,
  onLayout,
  onToque,
}: {
  fase: FaseDaCortina;
  onda: Onda;
  progresso: SharedValue<number>;
  reduzido: boolean;
  comMarca: boolean;
  construcao: SharedValue<number>;
  onLayout: () => void;
  /** Só na abertura: a saída de emergência da cortina presa. */
  onToque?: () => void;
}) {
  const theme = useTheme();
  const veu = useAnimatedStyle(() => ({ opacity: 1 - progresso.get() }));

  return (
    <View
      onLayout={onLayout}
      onStartShouldSetResponder={onToque ? () => true : undefined}
      onResponderRelease={onToque}
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
      {comMarca ? <MarcaSeConstruindo saida={progresso} t={construcao} reduzido={reduzido} /> : null}
    </View>
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
});
