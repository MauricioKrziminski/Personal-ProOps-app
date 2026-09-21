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

/**
 * O composer pode enviar agora?
 *
 * Três travas além do tamanho: enquanto um turno roda (`sending`), enquanto uma
 * pergunta espera resposta (`awaitingAction`) e com texto vazio. As duas
 * primeiras existem pela mesma razão — a conversa é serializada por lease no
 * servidor, então uma segunda escrita voltaria 409; barrar aqui evita mostrar
 * um erro que a tela já sabia que ia acontecer.
 */
export function canSubmitMessage(
  text: string,
  estado: { sending?: boolean; awaitingAction?: boolean } = {},
): boolean {
  return canSendMessage(text) && !estado.sending && !estado.awaitingAction;
}

export function canSaveTitle(title: string): boolean {
  const limpo = title.trim();
  return limpo.length > 0 && limpo.length <= MAX_TITLE_LENGTH;
}

// ---------------------------------------------------------------------------
// rota
// ---------------------------------------------------------------------------

/**
 * Para onde `new` vai depois que a conversa nasce.
 *
 * `replace`, e não `push`: a tela `new` não existe mais depois do primeiro
 * envio — voltar para ela reabriria um campo vazio que já virou conversa, e um
 * segundo envio ali criaria uma segunda conversa com a mesma pergunta.
 */
export function conversationRoute(id: string): `/agent/${string}` {
  return `/agent/${id}`;
}

// ---------------------------------------------------------------------------
// conversa nova: a tela abre no toque
// ---------------------------------------------------------------------------

/**
 * Abre a conversa nova NO TOQUE, sem esperar o servidor.
 *
 * O `id` da conversa e o `client_message_id` nascem juntos aqui e viajam juntos
 * em todo retry — regenerar um sem o outro faria o servidor ver outra conversa
 * (404) ou outro turno (duplicata). A ordem é o contrato: o cache é semeado
 * ANTES do envio (a tela chega já com a mensagem) e a navegação não espera a
 * promessa do envio — era essa espera que a queixa descrevia.
 */
export function abrirConversaNova(
  content: string,
  deps: {
    gerarId: () => string;
    semear: (id: string, turno: { clientMessageId: string; content: string }) => void;
    enviar: (v: { id: string; clientMessageId: string; content: string }) => unknown;
    navegar: (id: string) => void;
    /** Trava do toque: o segundo disparo no mesmo quadro não abre outra conversa. */
    trava?: TravaDeToque;
  },
): { id: string; clientMessageId: string } | null {
  if (deps.trava && !deps.trava.tentar()) return null;
  try {
    const id = deps.gerarId();
    const clientMessageId = deps.gerarId();
    deps.semear(id, { clientMessageId, content });
    deps.enviar({ id, clientMessageId, content });
    deps.navegar(id);
    return { id, clientMessageId };
  } finally {
    // Libera no quadro SEGUINTE — inclusive quando algo acima lança; sem isso
    // uma exceção deixaria o botão de enviar morto para sempre.
    deps.trava?.liberarNoProximoQuadro();
  }
}

export interface TravaDeToque {
  /** `true` na primeira vez; `false` até alguém `liberar`. */
  tentar: () => boolean;
  liberar: () => void;
  liberarNoProximoQuadro: () => void;
}

/**
 * Um toque, uma conversa. O `setTexto('')` só chega no próximo render, e dois
 * toques no mesmo quadro leriam o mesmo texto — duas conversas com a mesma
 * pergunta. Quem libera é a tela, no quadro seguinte.
 */
export function novaTravaDeToque(
  agendar: (fn: () => void) => unknown = (fn) => requestAnimationFrame(fn),
): TravaDeToque {
  let ocupada = false;
  const liberar = () => {
    ocupada = false;
  };
  return {
    tentar: () => {
      if (ocupada) return false;
      ocupada = true;
      return true;
    },
    liberar,
    liberarNoProximoQuadro: () => {
      agendar(liberar);
    },
  };
}

export interface MensagemLocal {
  id: string;
  client_message_id: string;
  role: 'user';
  content: string;
  status: 'processing' | 'completed' | 'failed';
  created_at: string;
  error_code?: string | null;
  /** Só na mensagem local: o status HTTP que a derrubou, para `retryPolicyFor`. */
  error_status?: number | null;
}

/**
 * O cache de mensagens de uma conversa que ainda não voltou do servidor.
 *
 * No formato REAL do `useInfiniteQuery` — outro formato quebraria a tela na
 * primeira leitura. SEM `sequence` (quem numera é o banco) e com `created_at`,
 * que ancora o teto de 5 minutos do "Pensando…".
 */
export function sementeDaConversa(clientMessageId: string, content: string, agora = new Date()) {
  const mensagem: MensagemLocal = {
    id: `local:${clientMessageId}`,
    client_message_id: clientMessageId,
    role: 'user',
    content,
    status: 'processing',
    created_at: agora.toISOString(),
  };
  return { pages: [{ items: [mensagem], next_cursor: null }], pageParams: [null] };
}

interface ComSeq {
  id: string;
  sequence?: number;
  client_message_id?: string | null;
}

/** Só mensagem local (sem `sequence`) no cache: o servidor ainda não confirmou a conversa. */
function soLocal(itens: readonly { sequence?: number }[]): boolean {
  return itens.length > 0 && itens.every((m) => m.sequence == null);
}

/**
 * O histórico deve ir ao servidor?
 *
 * Cache VAZIO busca — é a conversa aberta a frio. Cache só com a mensagem local
 * não busca: a conversa pode nem existir ainda, e um GET ali voltaria 404 ou
 * vazio por cima da mensagem que a pessoa acabou de mandar.
 */
export function historicoPrecisaBuscar(
  itens: readonly { sequence?: number; status?: string }[],
): boolean {
  // Só segura enquanto a criação está EM VOO. A local `failed` (ex.: reabrir
  // depois de um 402, que grava a conversa) deixa buscar o que o servidor tem.
  return !(soLocal(itens) && itens.every((m) => m.status === 'processing'));
}

/**
 * O compositor trava enquanto a criação está em voo ou falhou de um jeito que
 * se retenta: uma segunda mensagem iria por `enviar` para um id que talvez não
 * exista. Ali a única ação é "Tentar novamente" (que recria com o mesmo par).
 */
export function compositorTravado(
  itens: readonly {
    sequence?: number;
    status?: string;
    error_code?: string | null;
    error_status?: number | null;
  }[],
  estado: { awaitingAction: boolean },
): boolean {
  if (estado.awaitingAction) return true;
  // Falha NÃO retentável (402: o servidor grava a conversa antes de recusar o
  // turno; 422 de servidor antigo) deixa o campo livre — ali não há retry, e
  // quem volta do paywall manda de novo pelo `enviar`.
  return (
    soLocal(itens) &&
    itens.some(
      (m) => m.status === 'processing' || (m.status === 'failed' && falhaDoTurno(m).retryable),
    )
  );
}

/** "Tentar novamente": sem nada do servidor, recria (mesmo id + cmid); depois, envia. */
export function retryDoTurno(itens: readonly { sequence?: number }[]): 'criar' | 'enviar' {
  return soLocal(itens) ? 'criar' : 'enviar';
}

interface CacheDePaginas<M> {
  pages: { items: M[]; next_cursor: string | null }[];
  pageParams: unknown[];
}

/**
 * Encaixa o turno que voltou no cache, sem refetch.
 *
 * Substitui por `id` em vez de acrescentar: o retry devolve as MESMAS
 * mensagens. A mensagem local (`local:<cmid>`) sai quando a do servidor chega —
 * mas só com cmid NÃO nulo: as respostas do agente têm `client_message_id` nulo,
 * e sem essa guarda o filtro apagaria todas.
 *
 * A página que recebe é a PRIMEIRA: a paginação anda para trás, então
 * `pages[0]` é a mais nova.
 */
export function aplicarTurno<M extends ComSeq>(
  cache: CacheDePaginas<M> | undefined,
  turno: { user_message: M; assistant_message: M | null },
): CacheDePaginas<M> {
  const novas = [turno.user_message, turno.assistant_message].filter(Boolean) as M[];
  if (!cache) return { pages: [{ items: novas, next_cursor: null }], pageParams: [null] };
  const cmid = turno.user_message.client_message_id;
  const pages = cache.pages.map((p) => ({
    ...p,
    items: cmid
      ? p.items.filter((m) => !(m.client_message_id === cmid && m.id !== turno.user_message.id))
      : p.items,
  }));
  const primeira = pages[0];
  const porId = new Map(primeira.items.map((m) => [m.id, m]));
  for (const m of novas) porId.set(m.id, m);
  pages[0] = { ...primeira, items: [...porId.values()] };
  return { ...cache, pages };
}

/** Muda o estado da mensagem LOCAL daquele turno (retry → processing, erro → failed). */
export function marcarTurnoLocal<M extends ComSeq>(
  cache: CacheDePaginas<M>,
  clientMessageId: string,
  patch: {
    status: MensagemLocal['status'];
    error_code?: string | null;
    error_status?: number | null;
    /** No retry: o teto de 5 min do "Pensando…" recomeça daqui. */
    created_at?: string;
  },
): CacheDePaginas<M> {
  return {
    ...cache,
    pages: cache.pages.map((p) => ({
      ...p,
      items: p.items.map((m) =>
        m.id === `local:${clientMessageId}` ? { ...m, ...patch } : m,
      ),
    })),
  };
}

/**
 * O que a tela diz de um turno falho.
 *
 * `plan_limit` é o único código do servidor que não oferece retry: repetir daria
 * 402 de novo. Os outros são transitórios — o retry reusa o mesmo UUID e o
 * servidor recupera o turno pelo checkpoint em vez de reexecutar. Código que a
 * tabela não conhece (erro HTTP da CRIAÇÃO, gravado só na mensagem local) cai em
 * `retryPolicyFor`: 404 e 422 não têm retry, e o 404 da criação tira a pessoa da
 * conversa — ela nunca existiu para este usuário.
 */
const FALHA: Record<string, { texto: string; retryable: boolean }> = {
  plan_limit: { texto: 'Você usou todas as mensagens do plano este mês.', retryable: false },
  rate_limit: { texto: 'Muitas mensagens seguidas. Espera um pouco.', retryable: true },
  internal: { texto: 'Não consegui processar essa mensagem.', retryable: true },
};

export function falhaDoTurno(m: { error_code?: string | null; error_status?: number | null }): {
  texto: string;
  retryable: boolean;
  sair: boolean;
} {
  const conhecida = FALHA[m.error_code ?? ''];
  if (conhecida) return { ...conhecida, sair: false };
  if (m.error_code === 'not_configured') {
    return { texto: 'O agente não está configurado neste app.', retryable: false, sair: false };
  }
  if (m.error_status == null) return { ...FALHA.internal, sair: false };
  const { retryable } = retryPolicyFor({ status: m.error_status, code: m.error_code ?? undefined });
  const texto =
    m.error_status === 0 ? 'Sem conexão com o agente.' : FALHA.internal.texto;
  return { texto, retryable, sair: m.error_code === 'conversation_not_found' };
}

/** Espelho de `derive_title` do servidor: 1ª linha não vazia, espaços colapsados, 48. */
export function tituloProvisorio(content: string): string {
  const primeira = content.split(/\r\n|\r|\n/).find((l) => l.trim()) ?? '';
  const limpo = primeira.replace(/\s+/g, ' ').trim();
  return limpo ? Array.from(limpo).slice(0, 48).join('') : 'Nova conversa';
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
// texto do agente
// ---------------------------------------------------------------------------

export interface TrechoDeTexto {
  text: string;
  bold: boolean;
}

/**
 * Quebra o texto do agente nos trechos em negrito do WhatsApp (`*assim*`).
 *
 * O motor é COMPARTILHADO e os templates dele nasceram para o WhatsApp, onde
 * `*R$ 2.300,00*` é negrito. No app isso apareceria como asterisco literal em
 * volta de todo valor — foi o que a validação local mostrou. Traduzir aqui é
 * mais barato que manter dois jogos de template, e o destaque é intencional: o
 * que vem entre asteriscos é sempre o número ou a categoria da resposta.
 *
 * Um `*` solto não vira nada: "2 * 3" continua sendo "2 * 3", e um par não pode
 * atravessar quebra de linha — senão duas listas com asterisco no começo se
 * "casariam" e engoliriam o meio do texto.
 */
export function parseInlineBold(texto: string): TrechoDeTexto[] {
  const partes: TrechoDeTexto[] = [];
  const re = /\*([^*\n]+)\*/g;
  let fim = 0;
  for (let m = re.exec(texto); m; m = re.exec(texto)) {
    if (m.index > fim) partes.push({ text: texto.slice(fim, m.index), bold: false });
    partes.push({ text: m[1], bold: true });
    fim = m.index + m[0].length;
  }
  if (fim < texto.length) partes.push({ text: texto.slice(fim), bold: false });
  return partes.length ? partes : [{ text: texto, bold: false }];
}

/**
 * O mesmo texto sem a marcação — para onde negrito não cabe.
 *
 * A linha da lista de conversas é UMA linha de resumo: ali o `*R$ 45,00*` do
 * WhatsApp apareceria com os asteriscos, e destacar um pedaço de um preview
 * truncado não ajuda ninguém a escolher a conversa.
 */
export function plainText(texto: string): string {
  return parseInlineBold(texto)
    .map((t) => t.text)
    .join('');
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
  // `status 0` sem URL do agente não é rede: repetir dá o mesmo erro.
  if (erro.code === 'not_configured') return { retryable: false, paywall: false, blockComposer: false };
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
 * `draft` não é decisão de HITL: ela não passa pela rota de resolução (não há
 * `pending_actions` por trás), vai como MENSAGEM levando o id cru do botão.
 */
export type ChatDecision = 'approve' | 'reject' | 'choose' | 'draft';

/** Uma opção da pergunta, já traduzida para o que a API de resolução aceita. */
export interface UiOption {
  /** O id CRU do servidor (`pa:<pendente>:ok`). Serve de `key` e de rastro. */
  id: string;
  label: string;
  description?: string;
  decision: ChatDecision;
  /** Só em `choose`. É o id que o servidor confere contra a lista congelada. */
  candidateId?: string;
}

export interface UiPayloadShape {
  pending_id?: string;
  /** A pergunta de RASCUNHO (qual cartão, total ou parcela, criar cartão). */
  draft_id?: string;
  resolved?: string;
  body?: string;
  summary?: string;
  text?: string;
  buttons?: unknown;
  rows?: unknown;
}

/**
 * Traduz o `ui_payload` do motor para botões da tela.
 *
 * O motor foi escrito para o WhatsApp e fala a língua de lá: `buttons` é uma
 * lista de tuplas `[id, título]` e `rows` de `[id, título, descrição]`, com o id
 * no formato `pa:<pendente>:<sufixo>`. A tela precisa de `decision` +
 * `candidate_id`, que é o que a API de resolução aceita — a tradução é aqui, num
 * lugar só, e não espalhada pelo componente.
 *
 * **Duas travas de segurança**, e é por elas que esta função existe:
 *
 * 1. opção cujo `pending_id` (ou `draft_id`) não é o desta pergunta é
 *    DESCARTADA — sem isso um payload antigo ainda na tela poderia responder à
 *    pergunta nova;
 * 2. o `candidateId` sai do próprio payload, nunca de digitação. O servidor
 *    revalida contra a lista congelada, e esta é a primeira das duas cercas.
 *
 * ⚠️ **São DOIS tipos de pergunta, com prefixos diferentes, e por muito tempo
 * a tela só conhecia um.** `pa:` é HITL (`pending_actions`, rota de resolução,
 * candidato congelado); `ds:` é RASCUNHO (escolher o cartão da compra, "é o
 * total ou cada parcela?", "crio esse cartão?"). Um rascunho nunca tem
 * `pending_id`, então a saída antecipada por ele DESCARTAVA todos os botões de
 * rascunho: o mesmo payload que desenhava a lista de cartões no WhatsApp virava
 * texto solto no app — "escolha ou diga o nome do cartão", sem nada para
 * escolher. A resposta ao `ds:` não é a rota de resolução: é uma MENSAGEM com
 * `clicked_id`, e o composer continua aberto de propósito (digitar o nome de um
 * cartão que não existe é como se cria um).
 *
 * ponytail: `none` ("nenhuma dessas") vira `reject`, porque a API do app só
 * conhece approve/reject/choose. A diferença — `none_of_these` faz o motor
 * sugerir outra busca em vez de só cancelar — só existe no WhatsApp hoje;
 * quando alguém sentir falta, é um quarto valor de `decision` no endpoint.
 */
export function parseUiActions(payload: UiPayloadShape | null | undefined): {
  body: string;
  options: UiOption[];
} {
  const body = payload?.body ?? payload?.summary ?? payload?.text ?? '';
  const pendingId = payload?.pending_id;
  const draftId = payload?.draft_id;
  if (!pendingId && !draftId) return { body, options: [] };

  const linhas = [
    ...(Array.isArray(payload?.buttons) ? payload.buttons : []),
    ...(Array.isArray(payload?.rows) ? payload.rows : []),
  ];

  const options: UiOption[] = [];
  for (const linha of linhas) {
    if (!Array.isArray(linha)) continue;
    const [id, label, description] = linha as unknown[];
    if (typeof id !== 'string' || typeof label !== 'string') continue;

    const partes = id.split(':');

    let opcao: UiOption | null = null;
    if (partes[0] === 'ds') {
      // Rascunho: o app não interpreta o sufixo (`t:<centavos>`,
      // `create_card:<nome>`, `financing`, `no`) — ele devolve o id CRU e quem
      // decide o que ele significa é `draft.parse_slot_click`, no servidor.
      // Interpretar aqui seria a segunda cópia dessa tabela.
      if (!draftId || partes[1] !== draftId || !partes[2]) continue;
      // A exceção é `c:` — ela é a MESMA convenção dos dois prefixos e é o que
      // diz "esta opção é um REGISTRO, não uma saída". Sem ela a tela não
      // distingue os cartões do "Cancelar" e desenha a lista inteira como
      // pílulas empilhadas, que é o desenho recusado duas vezes em
      // `chat-actions.tsx`.
      const escolhido = partes[2] === 'c' ? partes.slice(3).join(':') : '';
      if (partes[2] === 'c' && !escolhido) continue;
      opcao = escolhido
        ? { id, label, decision: 'draft', candidateId: escolhido }
        : { id, label, decision: 'draft' };
    } else {
      // `pa` + o uuid do pendente + o sufixo. O uuid TEM que ser o desta pergunta.
      if (partes[0] !== 'pa' || !pendingId || partes[1] !== pendingId) continue;

      const sufixo = partes[2];
      // O id do candidato pode ter `:` no meio — junta o resto de volta.
      const candidateId = partes.slice(3).join(':');

      if (sufixo === 'ok') opcao = { id, label, decision: 'approve' };
      else if (sufixo === 'no' || sufixo === 'none') opcao = { id, label, decision: 'reject' };
      else if (sufixo === 'c' && candidateId) opcao = { id, label, decision: 'choose', candidateId };
    }
    if (!opcao) continue;

    // A descrição pertence à opção DESTA linha. Carimbar "a última empurrada"
    // colaria a descrição de uma linha recusada na opção anterior.
    if (typeof description === 'string' && description) opcao.description = description;
    options.push(opcao);
  }
  return { body, options };
}

/**
 * Carimba a pergunta como respondida no cache local.
 *
 * O servidor carimba `resolved` na mensagem quando a resolução dá certo, e o
 * refetch traz isso. Falta o caso em que ela NÃO dá certo por já ter passado:
 * `pending_invalid` (422) significa que aquela pergunta morreu, e sem carimbo
 * local os botões seguiriam vivos convidando o usuário a errar de novo.
 */
export function markResolved<T extends UiPayloadShape>(payload: T, resolution: string): T {
  return { ...payload, resolved: resolution };
}

/**
 * Os botões de uma pergunta estão desabilitados?
 *
 * Desabilita quando a pergunta já foi respondida (`resolved`, carimbado pelo
 * servidor), quando o balão não é uma pergunta e enquanto outro turno roda. Um
 * botão vivo numa pergunta antiga faria o usuário tocar no que a tela mostra e
 * receber um erro por isso.
 */
export function hitlControlsDisabled(
  payload: { pending_id?: string; draft_id?: string; resolved?: string } | null | undefined,
  estado: { busy?: boolean } = {},
): boolean {
  if (!payload?.pending_id && !payload?.draft_id) return true;
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
