import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { LARGURA_DE_DESENHO, alturaDoCartao } from '@/design/card-geometry';
import { quadroDaCaixa, quadroNoVoo, type Caixa, type Pose, type Quadro } from '@/design/flight-math';
import { Elevation, Motion, Radius } from '@/design/tokens';
import { useScheme } from '@/hooks/use-theme';

export type Voo = {
  /** A âncora de onde o cartão sai, ou a caixa já medida (o cartão arrastado). */
  de: string | Caixa;
  poseDe: Pose;
  /** O que esconder na origem — só depois que o clone está na tela, para não piscar. */
  esconderDe?: string;
  /** A âncora onde o cartão pousa. */
  para: string;
  posePara: Pose;
  /** O que esconder no destino até o pouso — já na partida, antes de a tela nova montar. */
  esconderPara?: string;
  /**
   * O cartão, DEITADO, em `LARGURA_DE_DESENHO`. Recebe o progresso do voo para trocar a base
   * no caminho (a pilha tem números, a vitrine não).
   */
  desenho: (progresso: SharedValue<number>) => React.ReactNode;
};

type Medir = () => Promise<Caixa | null>;

type Ctx = {
  /**
   * Resolve `true` quando o cartão DECOLOU (clone na tela, origem escondida) ou na hora, quando
   * não há voo; `false` quando outro voo está no ar — o toque é ignorado e ninguém navega.
   */
  voar: (v: Voo) => Promise<boolean>;
  temAncora: (chave: string) => boolean;
  registrar: (chave: string, medir: Medir) => () => void;
  ocultos: SharedValue<string[]> | null;
};

const FlightContext = createContext<Ctx>({
  voar: async () => true,
  temAncora: () => false,
  registrar: () => () => {},
  ocultos: null,
});

/** Quanto o pouso pode demorar a aparecer antes de o clone desistir e esmaecer no lugar. */
const ESPERA_DO_POUSO_MS = 900;
/** Trava de segurança: nenhum voo segura um cartão escondido por mais que isto. */
const TETO_DO_VOO_MS = 2500;
/** Se o clone não avisar que chegou à tela, a navegação não espera mais que isto. */
const TETO_DA_DECOLAGEM_MS = 300;

type Ativo = { id: number; desenho: Voo['desenho']; esconderDe?: string };

/**
 * A camada do voo do cartão — irmã do `<Stack>`, acima das telas e abaixo da trava (800 < 900).
 *
 * ## Por que na raiz, e não dentro da Carteira
 *
 * O cartão atravessa DUAS telas, e a navegação é de verdade (`push` com `fade`). Desenhado dentro
 * de uma delas, ele esmaeceria junto com ela. Aqui ele fica por cima das duas enquanto a troca
 * acontece. Provado nos dois aparelhos no início da fase 4: a camada fica acima de uma tela
 * empurrada. (Com `transparentModal` no iOS não ficaria — ver o plano da fase.)
 *
 * ## Como um voo acontece
 *
 * 1. A origem é medida na hora (`measureInWindow` é síncrono no Fabric e lê a árvore de sombra,
 *    então vale até para a tela de baixo, que o Android já desanexou).
 * 2. O destino é escondido JÁ (a tela dele ainda nem montou); o clone monta sobre a origem e só
 *    então a origem some — na ordem inversa, piscaria um quadro sem cartão.
 * 3. O clone levanta enquanto espera a âncora do pouso registrar (a tela nova precisa de um
 *    layout). Com ela, voa na mola `voo`: centro, lado e giro (`flight-math.ts`).
 * 4. No fim, o destino aparece NA UI THREAD e o clone desmonta logo depois. Um quadro com os dois
 *    é invisível (estão no mesmo lugar); o contrário seria um quadro sem nenhum.
 * 5. Sem pouso em 900 ms, o clone encolhe e esmaece onde está, e tudo reaparece.
 *
 * Um voo por vez. Com Reduce Motion não há voo: a troca de tela em `fade` é o cross-fade.
 */
export function FlightProvider({ children }: { children: React.ReactNode }) {
  const reduzir = useReducedMotion();
  const scheme = useScheme();
  const { fontScale } = useWindowDimensions();
  const ancoras = useRef(new Map<string, Medir>());
  const esperas = useRef(new Map<string, (() => void)[]>());
  const camada = useRef<View>(null);
  const deslocamento = useRef({ x: 0, y: 0 });
  const seq = useRef(0);
  const [ativo, setAtivo] = useState<Ativo | null>(null);
  const voando = useRef(false);

  const ocultos = useSharedValue<string[]>([]);
  const progresso = useSharedValue(0);
  const levantar = useSharedValue(0);
  const desistir = useSharedValue(0);
  const de = useSharedValue<Quadro>({ cx: 0, cy: 0, lado: LARGURA_DE_DESENHO, giro: 0 });
  const para = useSharedValue<Quadro>({ cx: 0, cy: 0, lado: LARGURA_DE_DESENHO, giro: 0 });

  const registrar = useCallback((chave: string, medir: Medir) => {
    ancoras.current.set(chave, medir);
    const fila = esperas.current.get(chave);
    esperas.current.delete(chave);
    fila?.forEach((acordar) => acordar());
    return () => {
      if (ancoras.current.get(chave) === medir) ancoras.current.delete(chave);
    };
  }, []);

  const medirNaCamada = useCallback(async (alvo: string | Caixa): Promise<Caixa | null> => {
    const caixa = typeof alvo === 'string' ? ((await ancoras.current.get(alvo)?.()) ?? null) : alvo;
    if (!caixa || caixa.largura <= 0) return null;
    return {
      ...caixa,
      x: caixa.x - deslocamento.current.x,
      y: caixa.y - deslocamento.current.y,
    };
  }, []);

  const esperarAncora = useCallback(
    (chave: string) =>
      new Promise<void>((resolve) => {
        if (ancoras.current.has(chave)) return resolve();
        const timer = setTimeout(resolve, ESPERA_DO_POUSO_MS);
        const fila = esperas.current.get(chave) ?? [];
        fila.push(() => {
          clearTimeout(timer);
          resolve();
        });
        esperas.current.set(chave, fila);
      }),
    []
  );

  const terminar = useCallback(
    (id: number) => {
      if (seq.current !== id) return;
      voando.current = false;
      setAtivo((a) => (a?.id === id ? null : a));
      ocultos.set([]);
    },
    [ocultos]
  );

  /**
   * O pouso pode MUDAR de lugar depois de medido, e muda: na primeira abertura da fatura o
   * seletor de meses aparece acima do cartão quando a lista de faturas chega, e no iOS o
   * cabeçalho nativo ajusta a rolagem um instante depois. Medido no simulador: o clone pousava
   * 159pt acima da doca. O voo remede a cada quadro e, se o destino andou, o alvo desliza até ele
   * em vez de saltar.
   */
  const seguirOPouso = useCallback(
    (id: number, chave: string, pose: Pose, inicial: Caixa) => {
      let ultimo = inicial;
      const passo = async () => {
        if (seq.current !== id || !voando.current) return;
        const agora = await medirNaCamada(chave);
        if (
          agora &&
          (Math.abs(agora.x - ultimo.x) > 0.5 ||
            Math.abs(agora.y - ultimo.y) > 0.5 ||
            Math.abs(agora.largura - ultimo.largura) > 0.5)
        ) {
          ultimo = agora;
          para.set(
            withTiming(quadroDaCaixa(agora, pose), {
              duration: Motion.duration.base,
              easing: Motion.easing.out,
            })
          );
        }
        requestAnimationFrame(passo);
      };
      requestAnimationFrame(passo);
    },
    [medirNaCamada, para]
  );

  const decolou = useRef<(() => void) | null>(null);

  const voo = useCallback(
    async (v: Voo) => {
      if (reduzir) return;
      const origem = await medirNaCamada(v.de);
      if (!origem) return;
      const id = ++seq.current;
      const q = quadroDaCaixa(origem, v.poseDe);
      de.set(q);
      para.set(q);
      progresso.set(0);
      desistir.set(0);
      levantar.set(0);
      ocultos.set(v.esconderPara ? [v.esconderPara] : []);
      voando.current = true;
      setAtivo({ id, desenho: v.desenho, esconderDe: v.esconderDe });
      setTimeout(() => terminar(id), TETO_DO_VOO_MS);

      await esperarAncora(v.para);
      // Um layout depois do registro: a âncora mede o que já foi posto na tela.
      await new Promise((r) => requestAnimationFrame(r));
      if (seq.current !== id) return;
      const pouso = await medirNaCamada(v.para);
      if (!pouso) {
        desistir.set(
          withTiming(1, { duration: Motion.duration.base, easing: Motion.easing.out }, () => {
            runOnJS(terminar)(id);
          })
        );
        return;
      }
      para.set(quadroDaCaixa(pouso, v.posePara));
      seguirOPouso(id, v.para, v.posePara, pouso);
      progresso.set(
        withSpring(1, Motion.spring.voo, () => {
          ocultos.set([]);
          runOnJS(terminar)(id);
        })
      );
    },
    [reduzir, medirNaCamada, esperarAncora, terminar, seguirOPouso, de, para, progresso, desistir, levantar, ocultos]
  );

  /**
   * ⚠️ **Quem navega espera a DECOLAGEM.** No iOS a tela que sai (pop, ou a de baixo num push em
   * `fade`) é congelada no começo da transição: esconder a origem depois disso não aparece, e o
   * cartão ficava duas vezes na tela — o de verdade parado e o clone voando (medido no
   * simulador, no fechar da Carteira e no "Ver fatura"). A promessa resolve um quadro depois de
   * a origem sumir, com teto, e na hora quando não há voo.
   */
  const voar = useCallback(
    (v: Voo) =>
      new Promise<boolean>((resolve) => {
        if (voando.current) return resolve(false);
        let feito = false;
        const pronto = () => {
          if (feito) return;
          feito = true;
          decolou.current = null;
          resolve(true);
        };
        decolou.current = pronto;
        setTimeout(pronto, TETO_DA_DECOLAGEM_MS);
        voo(v).then(() => {
          // Voo que nem começou (Reduce Motion, origem sem medida) não segura a navegação.
          if (!voando.current) pronto();
        });
      }),
    [voo]
  );

  // O clone chegou à tela: agora sim a origem pode sumir, e o cartão levanta da mesa.
  const clonePosto = useCallback(() => {
    const chave = ativo?.esconderDe;
    if (chave) ocultos.set([...ocultos.get(), chave]);
    levantar.set(withTiming(1, { duration: Motion.duration.fast + 40, easing: Motion.easing.out }));
    const avisar = decolou.current;
    if (avisar) requestAnimationFrame(() => requestAnimationFrame(avisar));
  }, [ativo, ocultos, levantar]);

  const alturaDoDesenho = alturaDoCartao(LARGURA_DE_DESENHO, fontScale);
  const clone = useAnimatedStyle(() => {
    const p = progresso.get();
    const q = quadroNoVoo(p, de.get(), para.get());
    const erguido = levantar.get() * (1 - Math.min(1, p));
    const d = desistir.get();
    return {
      opacity: 1 - d,
      transform: [
        { translateX: q.cx },
        { translateY: q.cy },
        { rotate: `${q.giro}deg` },
        { scale: (q.lado / LARGURA_DE_DESENHO) * (1 + 0.03 * erguido) * (1 - 0.12 * d) },
      ],
    };
  });

  const valor = useMemo<Ctx>(
    () => ({
      voar,
      temAncora: (chave) => ancoras.current.has(chave),
      registrar,
      ocultos,
    }),
    [voar, registrar, ocultos]
  );

  return (
    <FlightContext.Provider value={valor}>
      {children}
      <View
        ref={camada}
        pointerEvents="none"
        style={styles.camada}
        onLayout={() =>
          camada.current?.measureInWindow((x, y) => {
            deslocamento.current = { x, y };
          })
        }>
        {ativo ? (
          <Animated.View
            key={ativo.id}
            onLayout={clonePosto}
            style={[
              styles.clone,
              {
                width: LARGURA_DE_DESENHO,
                height: alturaDoDesenho,
                left: -LARGURA_DE_DESENHO / 2,
                top: -alturaDoDesenho / 2,
                boxShadow: Elevation[scheme].overlay,
              },
              clone,
            ]}>
            {ativo.desenho(progresso)}
          </Animated.View>
        ) : null}
      </View>
    </FlightContext.Provider>
  );
}

export function useFlight() {
  const { voar, temAncora } = useContext(FlightContext);
  return { voar, temAncora };
}

/**
 * Registra uma âncora: onde um cartão pode sair ou pousar. Só depois do primeiro layout — antes
 * disso não há caixa para medir, e o voo esperaria uma âncora que mede zero.
 *
 * Devolve `prender` (a `ref`, de callback) e `aoPosicionar` (o `onLayout`) para a `View`, e `medir` para quem precisa da
 * caixa fora de um voo (a Carteira, para fechar a partir do cartão arrastado).
 */
export function useFlightAnchor(chave: string | undefined) {
  const { registrar } = useContext(FlightContext);
  // O nó em ESTADO, não em `ref`: quem usa espalha `prender` como `ref` durante o render, e o
  // compilador do React recusa um objeto que carrega uma ref sendo lido ali.
  const [no, prender] = useState<View | null>(null);
  const [posto, setPosto] = useState(false);

  const medir = useCallback(
    () =>
      new Promise<Caixa | null>((resolve) => {
        if (!no) return resolve(null);
        no.measureInWindow((x, y, largura, altura) =>
          resolve(largura > 0 ? { x, y, largura, altura } : null)
        );
      }),
    [no]
  );

  useEffect(() => {
    if (!chave || !posto || !no) return;
    return registrar(chave, medir);
  }, [chave, posto, no, registrar, medir]);

  const aoPosicionar = useCallback(() => setPosto(true), []);
  return useMemo(() => ({ prender, aoPosicionar, medir }), [prender, aoPosicionar, medir]);
}

/** Opacidade zero enquanto um voo esconde esta chave. */
export function useFlightHidden(chave: string | undefined) {
  const { ocultos } = useContext(FlightContext);
  return useAnimatedStyle(() => ({
    opacity: chave && ocultos && ocultos.get().includes(chave) ? 0 : 1,
  }));
}

const styles = StyleSheet.create({
  camada: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 800, elevation: 800 },
  clone: { position: 'absolute', borderRadius: Radius.md, borderCurve: 'continuous' },
});
