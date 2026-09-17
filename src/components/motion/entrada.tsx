import { createContext, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Easing,
  cancelAnimation,
  runOnJS,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { useCortinaSaindo } from '@/components/motion/session-curtain';
import { useLock } from '@/hooks/use-lock';

type Entrada = {
  /** Nada cobre o app: a cortina está saindo (ou saiu) e a trava está aberta (ou saindo). */
  liberada: boolean;
  /**
   * Quantas vezes o app ficou visível. Muda a cada abertura, entrada numa conta e desbloqueio —
   * é o que faz a entrada das raízes tocar DE NOVO sem remontar a tela.
   */
  geracao: number;
};

const EntradaContext = createContext<Entrada>({ liberada: true, geracao: 0 });

/**
 * O sinal único das entradas das raízes (a cascata do `Screen`, a barra de abas do Android).
 *
 * ## Por que existe
 *
 * O pedido do dono do produto (17/09/2026): a passagem que acontece ao entrar na conta — a tinta
 * sobe e a tela inicial chega — tem que acontecer SEMPRE que o app aparece: na abertura, com ou
 * sem senha, e depois de desbloquear. Antes a cascata olhava só a cortina de sessão, então com o
 * bloqueio ligado ela tocava inteira por baixo da trava e o desbloqueio revelava uma tela parada.
 *
 * "Coberto" são as duas camadas que escondem o app: a cortina (abertura e troca de conta) e a
 * trava. Quando as duas saem, a geração sobe e a entrada toca; quando alguma volta a cobrir, as
 * raízes se escondem por baixo dela para poderem entrar de novo.
 */
export function EntradaProvider({ children }: { children: ReactNode }) {
  const saindo = useCortinaSaindo();
  const { locked } = useLock();
  const liberada = saindo && !locked;

  // Ajuste de estado no render (o padrão do React para "derivar de uma mudança").
  const [anterior, setAnterior] = useState(liberada);
  const [geracao, setGeracao] = useState(liberada ? 1 : 0);
  if (anterior !== liberada) {
    setAnterior(liberada);
    if (liberada) setGeracao(geracao + 1);
  }

  const valor = useMemo(() => ({ liberada, geracao }), [liberada, geracao]);
  return <EntradaContext.Provider value={valor}>{children}</EntradaContext.Provider>;
}

export function useEntrada(): Entrada {
  return useContext(EntradaContext);
}

/** Folga depois do fim previsto antes de o conteúdo aparecer à força (ver abaixo). */
const FOLGA_DO_TETO_MS = 600;
/** Com Reduce Motion a entrada é um cross-fade curto, sem atraso nem deslocamento. */
const ENTRADA_REDUZIDA_MS = 180;

type Relogio = {
  /** 0 (escondido) → 1 (no lugar). */
  relogio: SharedValue<number>;
  /**
   * A entrada desta geração terminou: quem lê troca o estilo animado pelo FINAL, escrito pelo
   * React (ver abaixo).
   */
  assentado: boolean;
};

/**
 * O relógio de uma entrada: 0 (escondido) → 1 (no lugar), tocando a cada geração.
 *
 * - **O atraso mora no relógio** (ele parte de um valor negativo), não num `withDelay`: no
 *   Android o atraso na montagem podia não disparar (a lição do `SplitReveal`). Quem lê aplica
 *   `progressoDeEntrada` para prender e suavizar.
 * - **O repouso é do React (`assentado`).** No Android uma atualização do Reanimated já se perdeu
 *   mais de uma vez: a barra de limite parada vazia depois de voltar ao primeiro plano, e o
 *   Financeiro com o corpo inteiro invisível depois de trocar de aba (17/09/2026 — os blocos
 *   estavam na árvore, só não chegavam à tela). Mexer no valor de novo não resolve, porque ele
 *   passa pelo mesmo caminho. Quando a animação termina — ou o teto estoura —, o bloco passa a
 *   renderizar o estilo final explícito, e o React o escreve na view pelo caminho normal.
 * - **Coberto, esconde na hora** — por baixo da trava ou da cortina ninguém vê a troca.
 */
export function useRelogioDeEntrada(atrasoMs: number, duracaoMs: number): Relogio {
  const { liberada, geracao } = useEntrada();
  const reduzir = useReducedMotion();
  const relogio = useSharedValue(0);
  /*
    O tempo é o da MONTAGEM. Na cascata o atraso vem da posição do bloco, e ela muda quando um
    bloco condicional aparece acima (o fim do loading): com o atraso vivo nas dependências, os
    blocos de baixo sumiriam e entrariam de novo no meio da leitura.
  */
  const [tempo] = useState({ atrasoMs, duracaoMs });
  const [assentadoEm, setAssentadoEm] = useState<number | null>(null);

  // Layout, não passivo: o bloco nasce invisível, e o efeito passivo pode rodar bem depois da
  // pintura quando a tela que chega é pesada (o corpo ficava ~0,5 s vazio no Android).
  useLayoutEffect(() => {
    cancelAnimation(relogio);
    if (!liberada) {
      relogio.set(0);
      return;
    }
    const atraso = reduzir ? 0 : tempo.atrasoMs;
    const duracao = reduzir ? ENTRADA_REDUZIDA_MS : tempo.duracaoMs;
    relogio.set(-atraso / duracao);
    relogio.set(
      withTiming(1, { duration: atraso + duracao, easing: Easing.linear }, (fim) => {
        'worklet';
        if (fim) runOnJS(setAssentadoEm)(geracao);
      })
    );
    const teto = setTimeout(() => setAssentadoEm(geracao), atraso + duracao + FOLGA_DO_TETO_MS);
    return () => clearTimeout(teto);
  }, [liberada, geracao, reduzir, tempo, relogio]);

  return { relogio, assentado: liberada && assentadoEm === geracao };
}

/** O relógio preso em [0, 1] e com saída suave (cúbica) — a curva de toda entrada das raízes. */
export function progressoDeEntrada(relogio: number): number {
  'worklet';
  const p = Math.min(1, Math.max(0, relogio));
  return 1 - Math.pow(1 - p, 3);
}
