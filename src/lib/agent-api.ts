/**
 * Cliente HTTP da aba Agente.
 *
 * O app fala com o FastAPI, não com o Postgres: as tabelas de conversa são
 * infraestrutura (RLS ligada, sem policy, `anon`/`authenticated` revogados), e
 * é o serviço quem valida o JWT e a propriedade. Este arquivo é a única porta.
 */

import {
  type ChatDecision,
  appendConversationPage,
  authorizedRequest,
  prependMessagePage,
  type RetryPolicy,
  retryPolicyFor,
} from '@/lib/agent-chat';
import { supabase } from '@/lib/supabase';

export { appendConversationPage, prependMessagePage };

// ---------------------------------------------------------------------------
// contrato
// ---------------------------------------------------------------------------

export interface AgentConversation {
  id: string;
  title: string;
  /** Trecho da última mensagem, já cortado e numa linha só pelo servidor. */
  preview?: string | null;
  last_message_at: string | null;
  created_at?: string | null;
}

export type AgentMessageStatus = 'processing' | 'completed' | 'failed';

/**
 * O `ui_payload` como o motor grava — que é a língua do WhatsApp.
 *
 * `buttons` e `rows` são TUPLAS (`[id, título]`, `[id, título, descrição]`), não
 * objetos: elas nascem no `_pergunta` do serviço, que foi escrito para a Meta, e
 * a rota do app devolve o payload cru. Quem traduz para o que a tela e a API de
 * resolução entendem é `parseUiActions`.
 */
export interface AgentUiPayload {
  pending_id?: string;
  resolved?: string;
  summary?: string;
  text?: string;
  body?: string;
  buttons?: string[][];
  rows?: string[][];
  [key: string]: unknown;
}

export interface AgentMessage {
  id: string;
  sequence?: number;
  client_message_id?: string | null;
  role: 'user' | 'assistant';
  content: string;
  ui_payload?: AgentUiPayload | null;
  in_reply_to?: string | null;
  status: AgentMessageStatus;
  error_code?: string | null;
  created_at?: string | null;
}

export interface AgentTurn {
  status: AgentMessageStatus;
  conversation: AgentConversation;
  user_message: AgentMessage;
  assistant_message: AgentMessage | null;
}

export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

/** A tradução dos botões mora em `agent-chat.ts`, onde ela é testável. */
export type AgentDecision = ChatDecision;

// ---------------------------------------------------------------------------
// erros
// ---------------------------------------------------------------------------

/** Erro da API, já com o que a tela precisa decidir. */
export class AgentApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly policy: RetryPolicy;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'AgentApiError';
    this.status = status;
    this.code = code;
    this.policy = retryPolicyFor({ status, code });
  }
}

/**
 * A sessão do Supabase acabou de vez.
 *
 * Separado do `AgentApiError` porque a reação é outra: não é "tenta de novo", é
 * voltar para o login. O `signOut()` já aconteceu quando isto é lançado.
 */
export class AgentAuthExpiredError extends Error {
  constructor() {
    super('Sua sessão expirou. Faça login de novo.');
    this.name = 'AgentAuthExpiredError';
  }
}

// ---------------------------------------------------------------------------
// transporte
// ---------------------------------------------------------------------------

/** Sem barra no fim: `${base}/internal/...` viraria `//internal` e 404. */
const BASE = (process.env.EXPO_PUBLIC_AGENT_URL ?? '').replace(/\/+$/, '');

export const isAgentConfigured = Boolean(BASE);

const SEM_URL =
  'O agente ainda não está configurado neste app. Defina EXPO_PUBLIC_AGENT_URL.';

async function chamar(
  caminho: string,
  init: RequestInit,
  token: string | null,
): Promise<Response> {
  return fetch(`${BASE}${caminho}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
}

/**
 * Uma requisição autenticada, com UM refresh no 401.
 *
 * Exatamente um: com o token expirado, um loop de refresh bateria no servidor
 * sem parar e a tela ficaria girando para sempre. Se o retry também der 401, a
 * sessão acabou de verdade — `signOut()` e o portão do `_layout` leva ao login.
 */
export async function agentFetch<T>(
  caminho: string,
  init: RequestInit = {},
): Promise<T> {
  if (!BASE) throw new AgentApiError(0, 'not_configured', SEM_URL);

  // A orquestração (um refresh só, nunca em loop) mora em `agent-chat.ts`, que
  // roda em `node --test`. Aqui ficam só as pontas que precisam do Supabase.
  let resultado;
  try {
    resultado = await authorizedRequest({
      send: (token) => chamar(caminho, init, token),
      getToken: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
      refresh: async () => {
        const { data, error } = await supabase.auth.refreshSession();
        return error ? null : (data.session?.access_token ?? null);
      },
      signOut: async () => {
        await supabase.auth.signOut();
      },
    });
  } catch {
    // Nem chegou ao servidor. `status: 0` é o que a política lê como "retentável".
    throw new AgentApiError(0, 'network', 'Sem conexão com o agente.');
  }

  if (resultado.kind === 'expired') throw new AgentAuthExpiredError();
  const resposta = resultado.response as Response;

  if (resposta.status === 204) return undefined as T;

  // O corpo de erro é sempre `{code, message}` — o backend registra handlers
  // para 401 e 422 também. Um corpo ilegível vira erro genérico do status.
  let corpo: unknown = null;
  try {
    corpo = await resposta.json();
  } catch {
    corpo = null;
  }

  if (!resposta.ok) {
    const { code, message } = (corpo ?? {}) as { code?: string; message?: string };
    throw new AgentApiError(
      resposta.status,
      code ?? 'error',
      message ?? 'Não consegui falar com o agente.',
    );
  }
  return corpo as T;
}

// ---------------------------------------------------------------------------
// endpoints
// ---------------------------------------------------------------------------

export function listConversations(cursor?: string | null, limit = 20) {
  const q = new URLSearchParams({ limit: String(limit) });
  if (cursor) q.set('cursor', cursor);
  return agentFetch<Page<AgentConversation>>(`/internal/chat/conversations?${q}`);
}

export function createConversation(clientMessageId: string, content: string) {
  return agentFetch<AgentTurn>('/internal/chat/conversations', {
    method: 'POST',
    body: JSON.stringify({ client_message_id: clientMessageId, content }),
  });
}

export function renameConversation(id: string, title: string) {
  return agentFetch<AgentConversation>(`/internal/chat/conversations/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  });
}

export function deleteConversation(id: string) {
  return agentFetch<void>(`/internal/chat/conversations/${id}`, { method: 'DELETE' });
}

export function listMessages(id: string, before?: number | null, limit = 40) {
  const q = new URLSearchParams({ limit: String(limit) });
  if (before != null) q.set('before', String(before));
  return agentFetch<Page<AgentMessage>>(`/internal/chat/conversations/${id}/messages?${q}`);
}

export function sendMessage(id: string, clientMessageId: string, content: string) {
  return agentFetch<AgentTurn>(`/internal/chat/conversations/${id}/messages`, {
    method: 'POST',
    body: JSON.stringify({ client_message_id: clientMessageId, content }),
  });
}

export function resolvePending(
  id: string,
  pendingId: string,
  clientMessageId: string,
  decision: AgentDecision,
  candidateId?: string,
) {
  return agentFetch<AgentTurn>(
    `/internal/chat/conversations/${id}/actions/${pendingId}`,
    {
      method: 'POST',
      body: JSON.stringify({
        client_message_id: clientMessageId,
        decision,
        // `candidate_id` só existe em `choose`: o servidor recusa nos outros.
        ...(decision === 'choose' ? { candidate_id: candidateId } : {}),
      }),
    },
  );
}
