/**
 * Estado de servidor da aba Agente.
 *
 * Diferença que governa este arquivo: o resto do app lê o Postgres pelo
 * supabase-js e recebe Realtime. Aqui não — as tabelas de conversa são
 * infraestrutura sem policy, e a única porta é o FastAPI. Sem Realtime,
 * "chegou resposta" é o retorno da própria mutation.
 */

import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { invalidateAgentData, invalidateKeys } from '@/lib/query-invalidation';

import {
  type AgentApiError,
  AgentAuthExpiredError,
  type AgentConversation,
  type AgentDecision,
  type AgentMessage,
  type AgentTurn,
  type Page,
  createConversation,
  deleteConversation,
  isAgentConfigured,
  listConversations,
  listMessages,
  renameConversation,
  resolvePending,
  sendMessage,
} from '@/lib/agent-api';
import {
  aplicarTurno,
  historicoPrecisaBuscar,
  marcarTurnoLocal,
  markResolved,
  newClientMessageId,
} from '@/lib/agent-chat';

export const agentKeys = {
  conversations: ['agent', 'conversations'] as const,
  messages: (id: string) => ['agent', 'messages', id] as const,
};

/** A cota de IA é compartilhada com o WhatsApp: todo turno mexe nela. */
const PLAN_STATUS = ['plan-status'] as const;

// ---------------------------------------------------------------------------
// leitura
// ---------------------------------------------------------------------------

export function useAgentConversations() {
  return useInfiniteQuery({
    queryKey: agentKeys.conversations,
    enabled: isAgentConfigured,
    // A lista não precisa refazer GET em toda ida e volta entre abas. Um turno,
    // renomeação ou exclusão já invalida a chave; puxar atualiza manualmente.
    staleTime: 120_000,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => listConversations(pageParam),
    getNextPageParam: (ultima: Page<AgentConversation>) => ultima.next_cursor,
  });
}

/** De quanto em quanto tempo o histórico é relido enquanto um turno roda. */
const POLL_MS = 3_000;
/**
 * O lease do turno no servidor (`app_turn_lease_seconds`). Passado disso,
 * ninguém está rodando aquela mensagem — e continuar relendo seria acordar o
 * rádio do aparelho de 3 em 3 segundos para sempre.
 */
const LEASE_MS = 300_000;

/**
 * O histórico da conversa.
 *
 * Ele se relê sozinho enquanto existir mensagem `processing`, porque esta aba
 * não tem Realtime — as tabelas de conversa são infraestrutura sem policy — e
 * porque o turno pode terminar num worker que NÃO é o que esta tela está
 * esperando (outra aba, ou o mesmo turno reivindicado antes). **Releitura não é
 * reenvio**: nada de conteúdo volta para o servidor por tempo; quem manda de
 * novo é o dedo do usuário em "Tentar novamente".
 *
 * A condição sai do CACHE e não de um sinalizador da tela porque assim ela vale
 * também para quem reabre o app com um turno pendente de ontem.
 */
export function useAgentMessages(conversationId: string | undefined) {
  const client = useQueryClient();
  const seen = useRef(new Set<string>());
  const result = useInfiniteQuery({
    queryKey: agentKeys.messages(conversationId ?? ''),
    // Cache só com a mensagem semeada no toque não busca: a conversa pode nem
    // existir no servidor ainda. Cache VAZIO busca (conversa aberta a frio).
    enabled: (q) =>
      isAgentConfigured &&
      Boolean(conversationId) &&
      historicoPrecisaBuscar((q.state.data?.pages ?? []).flatMap((p) => p.items)),
    // Voltar rapidamente de um detalhe preserva a última página já vista.
    // Processamento continua sendo relido pelo refetchInterval abaixo.
    staleTime: 15_000,
    refetchInterval: (query) => {
      const itens = (query.state.data?.pages ?? []).flatMap((p) => p.items);
      const rodando = itens.find((m) => m.status === 'processing');
      if (!rodando) return false;
      const desde = rodando.created_at ? Date.parse(rodando.created_at) : Date.now();
      return Date.now() - desde < LEASE_MS ? POLL_MS : false;
    },
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) => listMessages(conversationId!, pageParam),
    // A paginação anda para TRÁS: o cursor é o `sequence` mais antigo já
    // carregado, e a página seguinte é mais velha que a atual.
    getNextPageParam: (ultima: Page<AgentMessage>) =>
      ultima.next_cursor ? Number(ultima.next_cursor) : null,
  });
  // A recovered/async turn can finish through history polling instead of mutation success.
  useEffect(() => {
    let changed = false;
    for (const message of result.data?.pages.flatMap((page) => page.items) ?? []) {
      if (message.role !== 'assistant' || message.status !== 'completed' || seen.current.has(message.id)) continue;
      seen.current.add(message.id);
      changed = true;
    }
    if (changed) void invalidateAgentData(client);
  }, [client, result.data]);
  return result;
}



// ---------------------------------------------------------------------------
// escrita
// ---------------------------------------------------------------------------

type CacheMensagens = InfiniteData<Page<AgentMessage>, number | null>;

function useAplicarTurno() {
  const qc = useQueryClient();
  return useCallback(
    (turno: AgentTurn) => {
      // O turno encaixa no cache e a mensagem semeada no toque (`local:<cmid>`) sai.
      qc.setQueryData<CacheMensagens>(
        agentKeys.messages(turno.conversation.id),
        (c) => aplicarTurno(c, turno) as CacheMensagens,
      );
      return Promise.all([
        invalidateKeys(qc, [agentKeys.conversations, PLAN_STATUS]),
        turno.status === 'completed' ? invalidateAgentData(qc) : Promise.resolve(),
      ]);
    },
    [qc],
  );
}

/**
 * Cria a conversa já com a primeira mensagem.
 *
 * `retry: false` em toda escrita: o TanStack retentaria com o MESMO corpo, e o
 * servidor deduplica pelo `client_message_id` — mas repetir sozinho esconde do
 * usuário que algo falhou. Quem decide tentar de novo é ele, no botão.
 *
 * ⚠️ **Tudo mora nos callbacks do HOOK, nada no `.mutate()`.** A tela navega
 * para a conversa no mesmo toque; callback do `.mutate()` não roda depois do
 * desmonte (TanStack v5), e o do hook roda sempre. O resultado vai para o CACHE
 * da conversa — é de lá que a tela de destino lê "Pensando…" ou a falha.
 */
export function useCreateAgentConversation() {
  const aplicar = useAplicarTurno();
  const qc = useQueryClient();
  const marcar = (v: NovaConversa, patch: Parameters<typeof marcarTurnoLocal>[2]) =>
    qc.setQueryData<CacheMensagens>(agentKeys.messages(v.id), (c) =>
      c ? (marcarTurnoLocal(c, v.clientMessageId, patch) as CacheMensagens) : c,
    );
  return useMutation({
    retry: false,
    mutationFn: ({ id, clientMessageId, content }: NovaConversa) =>
      createConversation(clientMessageId, content, id),
    // O retry parte de uma mensagem `failed`: sem isto a tela mostraria a falha
    // antiga, e não "Pensando…", enquanto o novo POST roda.
    onMutate: (v: NovaConversa) => {
      marcar(v, {
        status: 'processing',
        error_code: null,
        error_status: null,
        created_at: new Date().toISOString(),
      });
    },
    onSuccess: aplicar,
    onError: (e: Error, v: NovaConversa) => {
      // A sessão acabou: o portão do `_layout` já está levando ao login.
      if (e instanceof AgentAuthExpiredError) return;
      const api = e as AgentApiError;
      marcar(v, { status: 'failed', error_code: api.code, error_status: api.status });
      if (api.policy?.paywall) router.push('/paywall');
      // A conversa pode já existir mesmo com erro (o 402 grava a mensagem).
      return qc.invalidateQueries({ queryKey: agentKeys.conversations });
    },
  });
}

interface NovaConversa {
  /** O id da conversa, gerado no toque junto do `clientMessageId`. */
  id: string;
  clientMessageId: string;
  content: string;
}

export function useSendAgentMessage(conversationId: string) {
  const aplicar = useAplicarTurno();
  const qc = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: ({
      clientMessageId,
      content,
      clickedId,
    }: {
      clientMessageId: string;
      content: string;
      /** Clique num botão de rascunho: o id cru vai junto da mensagem. */
      clickedId?: string;
    }) => sendMessage(conversationId, clientMessageId, content, clickedId),
    // O "Tentar novamente" reenvia a MESMA mensagem: ela volta a "Pensando…" e o teto de 5 min
    // recomeça AGORA (a tela e a releitura contam do `created_at`). Sem isto, reenviada depois
    // do teto, a tela desistia no instante do reenvio — o mesmo que a criação já fazia.
    onMutate: ({ clientMessageId }) => {
      qc.setQueryData<CacheMensagens>(agentKeys.messages(conversationId), (c) =>
        c
          ? (marcarTurnoLocal(c, clientMessageId, {
              status: 'processing',
              error_code: null,
              error_status: null,
              created_at: new Date().toISOString(),
            }) as CacheMensagens)
          : c,
      );
    },
    onError: (e: Error, { clientMessageId }) => {
      if (e instanceof AgentAuthExpiredError) return;
      const api = e as AgentApiError;
      qc.setQueryData<CacheMensagens>(agentKeys.messages(conversationId), (c) =>
        c
          ? (marcarTurnoLocal(c, clientMessageId, {
              status: 'failed',
              error_code: api.code,
              error_status: api.status,
            }) as CacheMensagens)
          : c,
      );
    },
    onSuccess: async (turno, v) => {
      await aplicar(turno);
      // Mesma razão do HITL: o balão ANTERIOR ganhou `resolved` no servidor e
      // ele não vem no turno. Só no clique — mensagem digitada não carimba nada.
      if (v.clickedId) {
        await qc.invalidateQueries({ queryKey: agentKeys.messages(conversationId) });
      }
    },
  });
}

export function useResolveAgentPending(conversationId: string) {
  const aplicar = useAplicarTurno();
  const qc = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: (v: {
      pendingId: string;
      clientMessageId: string;
      decision: AgentDecision;
      candidateId?: string;
    }) =>
      resolvePending(
        conversationId,
        v.pendingId,
        v.clientMessageId,
        v.decision,
        v.candidateId,
      ),
    onSuccess: async (turno) => {
      await aplicar(turno);
      // O balão ANTERIOR ganhou `resolved` no servidor; ele não vem no turno.
      // Sem este refetch os botões da pergunta respondida seguiriam vivos.
      await qc.invalidateQueries({ queryKey: agentKeys.messages(conversationId) });
    },
    onError: (erro, v) => {
      // `pending_invalid` (422) é o único erro que a tela precisa GRAVAR: a
      // pergunta morreu (foi respondida em outro lugar, ou o turno expirou) e o
      // servidor não tem estado para isso na mensagem. Sem o carimbo local os
      // botões seguiriam vivos convidando ao mesmo erro.
      if ((erro as AgentApiError).status !== 422) return;
      qc.setQueryData<CacheMensagens>(agentKeys.messages(conversationId), (cache) =>
        cache ? carimbarExpirada(cache, v.pendingId) : cache,
      );
    },
  });
}

/** Marca como expirada a pergunta que o servidor acabou de recusar. */
function carimbarExpirada(cache: CacheMensagens, pendingId: string): CacheMensagens {
  return {
    ...cache,
    pages: cache.pages.map((p) => ({
      ...p,
      items: p.items.map((m) =>
        m.ui_payload?.pending_id === pendingId
          ? { ...m, ui_payload: markResolved(m.ui_payload, 'expired') }
          : m,
      ),
    })),
  };
}

export function useRenameAgentConversation() {
  const qc = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      renameConversation(id, title),
    onSuccess: () => qc.invalidateQueries({ queryKey: agentKeys.conversations }),
  });
}

export function useDeleteAgentConversation() {
  const qc = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: (id: string) => deleteConversation(id),
    onSuccess: (_r, id) => {
      qc.removeQueries({ queryKey: agentKeys.messages(id) });
      qc.invalidateQueries({ queryKey: agentKeys.conversations });
    },
  });
}

// ---------------------------------------------------------------------------
// o turno pendente da tela
// ---------------------------------------------------------------------------

export interface TurnoLocal {
  clientMessageId: string;
  content: string;
}

/**
 * Guarda o UUID do turno que está sendo enviado.
 *
 * É a peça que faz o retry ser retry: gerar um id novo criaria um SEGUNDO
 * lançamento do que já rodou no servidor. O id só é descartado quando o turno
 * termina — não quando ele falha.
 */
export function useTurnoLocal() {
  const [turno, setTurno] = useState<TurnoLocal | null>(null);

  const iniciar = useCallback((content: string) => {
    const t = { clientMessageId: newClientMessageId(), content };
    setTurno(t);
    return t;
  }, []);

  /** O mesmo UUID de antes: é isso que o servidor usa para não duplicar. */
  const retentar = useCallback(() => turno, [turno]);

  const concluir = useCallback(() => setTurno(null), []);

  /**
   * Um UUID avulso, sem virar o turno local.
   *
   * É o caso do HITL: o toque no botão é um turno novo, mas ele não precisa de
   * retry manual — se falhar, a pergunta continua aberta e o botão continua ali.
   */
  const novoId = useCallback(() => newClientMessageId(), []);

  return { turno, iniciar, retentar, concluir, novoId };
}
