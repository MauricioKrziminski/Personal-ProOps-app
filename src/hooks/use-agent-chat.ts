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
import { newClientMessageId } from '@/lib/agent-chat';

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

export function useAgentMessages(conversationId: string | undefined) {
  return useInfiniteQuery({
    queryKey: agentKeys.messages(conversationId ?? ''),
    enabled: isAgentConfigured && Boolean(conversationId),
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
  });
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

  return { turno, iniciar, retentar, concluir };
}

/**
 * `processing`: o turno está rodando no servidor, ainda sem resposta.
 *
 * A tela NÃO reenvia a instrução — reenviar é o que duplica. Ela só volta a
 * buscar o histórico enquanto estiver montada, e a nova tentativa de escrita só
 * acontece quando a pessoa tocar em "Tentar novamente".
 */
export function useRefetchEnquantoProcessa(conversationId: string | undefined, ativo: boolean) {
  const qc = useQueryClient();
  return useCallback(() => {
    if (!ativo || !conversationId) return;
    qc.invalidateQueries({ queryKey: agentKeys.messages(conversationId) });
  }, [qc, conversationId, ativo]);
}
