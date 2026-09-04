/**
 * Regras puras da aba Agente.
 *
 * Tudo aqui é função sem React, sem rede e sem Expo — por isso roda em
 * `node --test` e não precisa de simulador para provar que está certo. O que
 * mora neste arquivo são as decisões que a tela toma e que um bug silencioso
 * arruinaria: qual UUID vai no retry, o que pode ser enviado, como as páginas
 * se juntam e o que a tela faz com cada erro.
 */

export const MAX_MESSAGE_LENGTH = 4000;
export const MAX_TITLE_LENGTH = 80;

/** Distância do fim em que a resposta que chega ainda rola sozinha. */
export const NEAR_END_PX = 80;

// ---------------------------------------------------------------------------
// UUID do turno
// ---------------------------------------------------------------------------

/**
 * Preenche 16 bytes, preferindo o CSPRNG da plataforma.
 *
 * ⚠️ O valor gerado é uma **chave opaca de deduplicação, não um segredo**. Ele
 * só diz "esta é a mesma mensagem de antes", e o servidor sempre a restringe ao
 * usuário e à conversa — adivinhar um UUID de outra pessoa não dá acesso a
 * nada. Por isso o fallback por `Math.random` é aceitável: sem CSPRNG, a
 * alternativa seria o app não conseguir mandar mensagem nenhuma.
 *
 * O fallback existe porque o React Native não traz `crypto.getRandomValues` sem
 * polyfill, e adicionar `expo-crypto` exigiria uma instalação nativa nova — ou
 * seja, um binário novo — para dois usos.
 */
export function defaultRandomBytes(
  // `Uint8Array<ArrayBuffer>`, não `Uint8Array` cru: o tipo largo inclui
  // `SharedArrayBuffer`, que `getRandomValues` não aceita.
  bytes: Uint8Array<ArrayBuffer>,
  source: Crypto | undefined = globalThis.crypto,
): Uint8Array {
  if (source?.getRandomValues) {
    source.getRandomValues(bytes);
    return bytes;
  }
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

const hex: string[] = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

/** UUID v4 (RFC 4122) a partir de 16 bytes injetados. */
export function newClientMessageId(
  fillRandomBytes: (bytes: Uint8Array<ArrayBuffer>) => unknown = defaultRandomBytes,
): string {
  // Preenche NO LUGAR e ignora o retorno: é assim que `getRandomValues` é usado,
  // e uma fonte que esquece o `return` geraria `undefined` em vez de um id.
  const b = new Uint8Array(16);
  fillRandomBytes(b);
  // Os dois carimbos do RFC. Sem eles o servidor recusa como UUID inválido —
  // e o erro apareceria como "não consegui enviar", sem dizer por quê.
  b[6] = (b[6] & 0x0f) | 0x40; // versão 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant 10xx
  const s = Array.from(b, (byte) => hex[byte]);
  return `${s[0]}${s[1]}${s[2]}${s[3]}-${s[4]}${s[5]}-${s[6]}${s[7]}-${s[8]}${s[9]}-${s[10]}${s[11]}${s[12]}${s[13]}${s[14]}${s[15]}`;
}

// ---------------------------------------------------------------------------
// o que dá para enviar
// ---------------------------------------------------------------------------

/** O limite conta o texto TRIMADO — é o que o servidor recebe e valida. */
export function canSendMessage(text: string): boolean {
  const limpo = text.trim();
  return limpo.length > 0 && limpo.length <= MAX_MESSAGE_LENGTH;
}

export function canSaveTitle(title: string): boolean {
  const limpo = title.trim();
  return limpo.length > 0 && limpo.length <= MAX_TITLE_LENGTH;
}

// ---------------------------------------------------------------------------
// paginação
// ---------------------------------------------------------------------------

interface ComId {
  id: string;
}

/**
 * Junta a próxima página de conversas.
 *
 * De-duplica por `id` e a versão MAIS NOVA vence: a página seguinte chega
 * depois, e se a conversa recebeu mensagem no meio da rolagem é o título e a
 * data dela que valem.
 */
export function appendConversationPage<T extends ComId>(atuais: T[], proxima: T[]): T[] {
  const porId = new Map(atuais.map((c) => [c.id, c]));
  for (const item of proxima) porId.set(item.id, item);
  return [...porId.values()];
}

interface ComSequence extends ComId {
  sequence?: number;
}

/**
 * Coloca a página ANTIGA antes da atual, sem duplicar e sem reordenar.
 *
 * Mensagem local (o turno otimista) ainda não tem `sequence` — quem numera é o
 * banco. De-duplicar só por `sequence` a apagaria da tela enquanto ela é
 * enviada, então a chave é `sequence` quando existe e `id` quando não.
 */
export function prependMessagePage<T extends ComSequence>(atuais: T[], anteriores: T[]): T[] {
  const chave = (m: T) => (m.sequence != null ? `s:${m.sequence}` : `i:${m.id}`);
  const vistas = new Set(atuais.map(chave));
  return [...anteriores.filter((m) => !vistas.has(chave(m))), ...atuais];
}

// ---------------------------------------------------------------------------
// scroll
// ---------------------------------------------------------------------------

/**
 * O usuário está perto do fim da conversa?
 *
 * Serve para decidir se a resposta que chega rola sozinha. Rolar enquanto ele lê
 * uma mensagem antiga é arrancar a tela da mão dele — por isso longe do fim a
 * chegada vira um aviso, não um salto.
 */
export function isNearChatEnd(m: {
  contentOffset: number;
  layoutHeight: number;
  contentHeight: number;
}): boolean {
  return m.contentHeight - m.layoutHeight - m.contentOffset <= NEAR_END_PX;
}

// ---------------------------------------------------------------------------
// erros
// ---------------------------------------------------------------------------

export interface RetryPolicy {
  /** Oferecer "Tentar novamente"? */
  retryable: boolean;
  /** Abrir a tela de plano? */
  paywall: boolean;
  /** Manter o composer travado? */
  blockComposer: boolean;
}

/**
 * O que a tela faz com cada erro da API.
 *
 * Numa tabela e não espalhado por `if`s porque os códigos são o contrato com o
 * backend, e a diferença entre eles é o que separa "sobe de plano" de "espera um
 * pouco" — mostrar paywall para quem só mandou rápido demais é o jeito mais
 * fácil de perder um usuário.
 */
export function retryPolicyFor(erro: { status: number; code?: string }): RetryPolicy {
  switch (erro.status) {
    case 402:
      return { retryable: false, paywall: true, blockComposer: false };
    case 409:
      // A conversa está processando outra mensagem. Retentar é o certo, mas com
      // o composer travado: escrever por cima do que está rodando embaralharia
      // a ordem dos turnos.
      return { retryable: true, paywall: false, blockComposer: true };
    case 429:
    case 500:
    case 502:
    case 503:
    case 504:
    case 0: // falha de rede: nem chegou ao servidor
      return { retryable: true, paywall: false, blockComposer: false };
    default:
      // 401, 404, 422: repetir dá exatamente o mesmo erro.
      return { retryable: false, paywall: false, blockComposer: false };
  }
}

// ---------------------------------------------------------------------------
// HITL
// ---------------------------------------------------------------------------

/**
 * Os botões de uma pergunta estão desabilitados?
 *
 * Desabilita quando a pergunta já foi respondida (`resolved`, carimbado pelo
 * servidor), quando o balão não é uma pergunta e enquanto outro turno roda. Um
 * botão vivo numa pergunta antiga faria o usuário tocar no que a tela mostra e
 * receber um erro por isso.
 */
export function hitlControlsDisabled(
  payload: { pending_id?: string; resolved?: string } | null | undefined,
  estado: { busy?: boolean } = {},
): boolean {
  if (!payload?.pending_id) return true;
  if (payload.resolved) return true;
  return Boolean(estado.busy);
}

// ---------------------------------------------------------------------------
// requisição autenticada
// ---------------------------------------------------------------------------

export interface AuthDeps {
  /** Manda a requisição com o token dado (ou sem token, se null). */
  send: (token: string | null) => Promise<{ status: number }>;
  /** Token atual da sessão. */
  getToken: () => Promise<string | null>;
  /** Renova a sessão e devolve o token novo, ou null se não deu. */
  refresh: () => Promise<string | null>;
  /** Encerra a sessão local. */
  signOut: () => Promise<void>;
}

export type AuthOutcome =
  | { kind: 'response'; response: { status: number } }
  | { kind: 'expired' };

/**
 * Uma requisição autenticada com EXATAMENTE um refresh no 401.
 *
 * Exatamente um, e é o ponto do exercício: com o token expirado, renovar em
 * loop bateria no servidor sem parar e a tela ficaria girando para sempre. Se o
 * retry também der 401 a sessão acabou de verdade — `signOut()` e o portão do
 * `_layout` leva ao login.
 *
 * Separado do `agent-api.ts` porque lá o módulo importa o cliente Supabase (que
 * precisa de React Native para carregar) e esta é a parte que precisa de teste.
 */
export async function authorizedRequest(deps: AuthDeps): Promise<AuthOutcome> {
  let resposta = await deps.send(await deps.getToken());
  if (resposta.status !== 401) return { kind: 'response', response: resposta };

  const novo = await deps.refresh();
  if (novo) resposta = await deps.send(novo);

  // Sem token novo, ou o segundo 401: acabou. Não há terceira tentativa.
  if (!novo || resposta.status === 401) {
    await deps.signOut();
    return { kind: 'expired' };
  }
  return { kind: 'response', response: resposta };
}
