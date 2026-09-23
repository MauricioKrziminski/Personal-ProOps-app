import type { Session } from '@supabase/supabase-js';
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { useCortina } from '@/components/motion/session-curtain';
import { comTeto } from '@/lib/com-teto';
import { TETO_DA_TROCA_MS, ondaDaTroca, precisaDeCortina } from '@/lib/session-gate';
import { supabase } from '@/lib/supabase';

interface SessaoMostrada {
  session: Session | null;
  loading: boolean;
}

const SessionContext = createContext<SessaoMostrada | null>(null);

const doisQuadros = () =>
  new Promise<void>((ok) => requestAnimationFrame(() => requestAnimationFrame(() => ok())));

/**
 * A sessão do app — uma assinatura só, e a sessão que ela entrega é a MOSTRADA.
 *
 * ## O portão
 *
 * O Supabase troca a sessão na hora; a tela não. Evento do mesmo usuário (refresh de token,
 * `USER_UPDATED`, os metadados que o onboarding grava) vale na hora. Usuário diferente — entrar,
 * sair, trocar de conta — cobre a tela, troca a sessão mostrada POR BAIXO da cortina (é aí que o
 * `Stack.Protected` desmonta uma pilha e monta a outra, e que o cache do TanStack é limpo), espera
 * dois quadros para a tela nova existir, e revela. A regra mora em `lib/session-gate.ts`.
 *
 * ## Nunca prende
 *
 * Cada passo tem teto de 1,5 s. A troca acontece mesmo se a animação falhar, e o revelar que
 * estoura o teto abre a cortina à força. As trocas entram numa fila: um segundo evento no meio
 * de uma troca espera a primeira terminar, em vez de mostrar a tela nova antes da hora.
 *
 * `mostrado` é atualizado na CHEGADA do evento, não no fim da troca: um `TOKEN_REFRESHED` que
 * chega com a cortina fechando é do mesmo usuário e entra na fila sem abrir outra cortina.
 *
 * ## Duas fontes para a primeira sessão, de propósito
 *
 * `getSession()` e o `INITIAL_SESSION` do `onAuthStateChange` resolvem a mesma coisa; o primeiro
 * a chegar é a abertura (direto), o segundo é o mesmo usuário (direto também). Não tire um dos
 * dois: é o `getSession()` que garante `loading: false` em versões do supabase-js que não emitem
 * `INITIAL_SESSION`. E o callback do `onAuthStateChange` só enfileira — o supabase-js segura um
 * lock enquanto ele roda, e esperar a cortina ali travaria a própria troca.
 *
 * ## Convites
 *
 * `accept_pending_invites` roda na sessão inicial e em `SIGNED_IN` — uma vez, aqui. Quando cada
 * `useSession()` assinava por conta própria, ele rodava uma vez por tela montada.
 */
export function SessionProvider({
  children,
  aoTrocarDeUsuario,
}: {
  children: ReactNode;
  /**
   * Chamado IMEDIATAMENTE ANTES de a sessão de outro usuário chegar à árvore (é onde a raiz
   * limpa o cache). ⚠️ Não num `useEffect` da raiz, depois da troca (22/09/2026): efeito de pai
   * roda DEPOIS dos filhos, e o que montava junto com a sessão nova (o sincronizador dos widgets)
   * já tinha criado as consultas dele — o `clear()` as descartava por baixo, e ele ficava preso a
   * consultas mortas até o app reabrir. O widget seguia "Entre no app" com a pessoa logada.
   */
  aoTrocarDeUsuario?: () => void;
}) {
  const cortina = useCortina();
  const [estado, setEstado] = useState<SessaoMostrada>({ session: null, loading: true });
  /** O `user.id` da sessão mostrada (ou já na fila para mostrar). `undefined` = não resolveu. */
  const mostrado = useRef<string | null | undefined>(undefined);
  const fila = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let vivo = true;

    // Convite feito para o telefone de quem entrou vira acesso na hora do login. Best-effort.
    const aceitarConvites = () => {
      supabase.rpc('accept_pending_invites').then(({ error }) => {
        if (error) console.warn('accept_pending_invites:', error.message);
      });
    };

    const trocar = async (next: Session | null, depois: string | null, antes: string | null | undefined) => {
      const onda = ondaDaTroca(depois, cortina.tomarOrigem());
      const entrandoPelaCapa = antes === null && depois !== null;
      if (entrandoPelaCapa) {
        await comTeto(cortina.cobrirDaCapa(), TETO_DA_TROCA_MS, 'cortina').catch(async () => {
          cortina.cobrirJa();
          await doisQuadros();
        });
      } else {
        await comTeto(cortina.cobrir(onda), TETO_DA_TROCA_MS, 'cortina').catch(async () => {
          // Nunca substitua a sessão mostrada com a cobertura ainda incompleta. Num tablet, o
          // canvas maior pode perder quadros; o fallback fecha a tinta e deixa-a pintar primeiro.
          cortina.cobrirJa();
          await doisQuadros();
        });
      }
      if (!vivo) return;
      if (antes !== undefined && antes !== depois) aoTrocarDeUsuario?.();
      setEstado({ session: next, loading: false });
      await doisQuadros();
      // A cobertura desce e a revelação sobe. A capa estática recebe a onda da saída.
      const revelacao = entrandoPelaCapa ? { mode: 'up' as const } : onda;
      await comTeto(cortina.revelar(revelacao), TETO_DA_TROCA_MS, 'cortina').catch(() =>
        cortina.abrirJa()
      );
    };

    const receber = (next: Session | null) => {
      const depois = next?.user.id ?? null;
      const antes = mostrado.current;
      const comCortina = precisaDeCortina(antes, depois);
      mostrado.current = depois;
      fila.current = fila.current
        .then(async () => {
          if (comCortina) await trocar(next, depois, antes);
          else if (vivo) {
            if (antes !== undefined && antes !== depois) aoTrocarDeUsuario?.();
            setEstado({ session: next, loading: false });
          }
        })
        .catch(() => {});
    };

    supabase.auth.getSession().then(({ data }) => {
      receber(data.session);
      if (data.session) aceitarConvites();
    });
    const { data: assinatura } = supabase.auth.onAuthStateChange((event, next) => {
      receber(next);
      if (event === 'SIGNED_IN' && next) aceitarConvites();
    });
    return () => {
      vivo = false;
      assinatura.subscription.unsubscribe();
    };
  }, [cortina, aoTrocarDeUsuario]);

  return <SessionContext.Provider value={estado}>{children}</SessionContext.Provider>;
}

export function useSession(): SessaoMostrada {
  const sessao = useContext(SessionContext);
  if (!sessao) throw new Error('useSession precisa do SessionProvider (raiz do app)');
  return sessao;
}
