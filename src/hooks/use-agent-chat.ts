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
import { useCallback, useState } from 'react';

import {
  type AgentApiError,
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
import { markResolved, newClientMessageId } from '@/lib/agent-chat';

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
  return useInfiniteQuery({
    queryKey: agentKeys.messages(conversationId ?? ''),
    enabled: isAgentConfigured && Boolean(conversationId),
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
}

// ---------------------------------------------------------------------------
// escrita
// ---------------------------------------------------------------------------

type CacheMensagens = InfiniteData<Page<AgentMessage>, number | null>;

/**
 * Encaixa o turno que voltou no cache, sem refetch.
 *
 * O servidor devolve as duas mensagens do turno; buscar de novo só para vê-las
 * gastaria uma viagem e deixaria a resposta piscando enquanto chega.
 */
function aplicarTurno(cache: CacheMensagens | undefined, turno: AgentTurn): CacheMensagens {
  const novas = [turno.user_message, turno.assistant_message].filter(
    Boolean,
  ) as AgentMessage[];
  if (!cache) {
    return { pages: [{ items: novas, next_cursor: null }], pageParams: [null] };
  }
  const paginas = [...cache.pages];
  const ultima = paginas[paginas.length - 1];
  // Substitui por `id` em vez de acrescentar: o retry de um turno devolve as
  // MESMAS mensagens, e um append cego duplicaria a bolha na tela.
  const porId = new Map(ultima.items.map((m) => [m.id, m]));
  for (const m of novas) porId.set(m.id, m);
  paginas[paginas.length - 1] = { ...ultima, items: [...porId.values()] };
  return { ...cache, pages: paginas };
}

function useAplicarTurno() {
  const qc = useQueryClient();
  return useCallback(
    (turno: AgentTurn) => {
      qc.setQueryData<CacheMensagens>(agentKeys.messages(turno.conversation.id), (c) =>
        aplicarTurno(c, turno),
      );
      // Só a lista de conversas (a ordem e o título podem ter mudado) e a cota.
      // Invalidar o histórico aqui desfaria o encaixe que acabou de acontecer.
      qc.invalidateQueries({ queryKey: agentKeys.conversations });
      qc.invalidateQueries({ queryKey: PLAN_STATUS });
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
 */
export function useCreateAgentConversation() {
  const aplicar = useAplicarTurno();
  return useMutation({
    retry: false,
    mutationFn: ({ clientMessageId, content }: { clientMessageId: string; content: string }) =>
      createConversation(clientMessageId, content),
    onSuccess: aplicar,
  });
}

export function useSendAgentMessage(conversationId: string) {
  const aplicar = useAplicarTurno();
  return useMutation({
    retry: false,
    mutationFn: ({ clientMessageId, content }: { clientMessageId: string; content: string }) =>
      sendMessage(conversationId, clientMessageId, content),
    onSuccess: aplicar,
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
    onSuccess: (turno) => {
      aplicar(turno);
      // O balão ANTERIOR ganhou `resolved` no servidor; ele não vem no turno.
      // Sem este refetch os botões da pergunta respondida seguiriam vivos.
      qc.invalidateQueries({ queryKey: agentKeys.messages(conversationId) });
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
