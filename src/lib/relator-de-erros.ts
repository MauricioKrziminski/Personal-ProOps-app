/**
 * Fila de relato de erros do app (núcleo puro, sem React Native: roda em `node --test`).
 *
 * Contrato: `POST /internal/errors` (docs/ADMIN-API.md, Observabilidade). Regras:
 * - NUNCA lança e NUNCA reporta a própria falha (nada de laço: o erro de enviar é descartado);
 * - erro esperado (rede fora, PT402/PT409, 4xx de regra, sessão expirada) não é relatado;
 * - o mesmo erro repetido dentro da janela é relatado uma vez só (dedupe local);
 * - lote de até 20, enviado depois de uma folga curta; crash sai na hora (o app pode morrer).
 *
 * ponytail: fila em memória. Um crash fatal em release pode morrer antes do POST terminar;
 * guardar em disco e reenviar na próxima abertura se a perda mostrar-se relevante.
 */

export type KindDoErro = 'crash' | 'error' | 'unhandled_rejection' | 'render';

export interface Relato {
  source: 'app';
  kind: KindDoErro;
  name: string;
  message: string;
  stack: string | null;
  route: string | null;
  platform: string | null;
  app_version: string | null;
  occurred_at: string;
  context?: Record<string, unknown>;
}

export interface MetaDoRelato {
  platform: string | null;
  app_version: string | null;
  route: string | null;
}

export interface OpcoesDoRelator {
  enviar: (lote: Relato[]) => Promise<unknown>;
  meta: () => MetaDoRelato;
  ligado: () => boolean;
  agora?: () => number;
  /** Agenda o envio; o teste troca por um disparo manual. */
  agendar?: (fn: () => void, ms: number) => unknown;
  folgaMs?: number;
  janelaDedupeMs?: number;
  pausaAposFalhaMs?: number;
}

export const MAX_POR_LOTE = 20;
const MAX_FILA = 50;
const MAX_VISTOS = 100;
const CODIGOS_ESPERADOS = new Set(['PT402', 'PT409', 'PT403']);
const REDE = /network request failed|failed to fetch|network error|timeout|timed out|aborted|offline/i;

/** Erro que faz parte do uso normal do app: não é defeito. Estrutural, para não importar nada de RN. */
export function ehEsperado(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: unknown; status?: unknown; code?: unknown; message?: unknown };
  if (e.name === 'AgentAuthExpiredError') return true;
  const status = typeof e.status === 'number' ? e.status : null;
  if (status !== null && status >= 400 && status < 500) return true;
  if (e.name === 'AgentApiError' && status === 0) return true; // sem conexão com o agente
  if (typeof e.code === 'string' && CODIGOS_ESPERADOS.has(e.code)) return true;
  return typeof e.message === 'string' && REDE.test(e.message);
}

/** Nome, mensagem e pilha de qualquer coisa que alguém tenha lançado (inclusive string solta). */
export function descrever(err: unknown): { name: string; message: string; stack: string | null } {
  if (err instanceof Error) {
    return { name: err.name || 'Error', message: err.message ?? '', stack: err.stack ?? null };
  }
  if (err && typeof err === 'object') {
    const e = err as { name?: unknown; message?: unknown; stack?: unknown };
    if (typeof e.message === 'string') {
      return {
        name: typeof e.name === 'string' ? e.name : 'Error',
        message: e.message,
        stack: typeof e.stack === 'string' ? e.stack : null,
      };
    }
  }
  let texto: string;
  try {
    texto = typeof err === 'string' ? err : JSON.stringify(err) ?? String(err);
  } catch {
    texto = String(err);
  }
  return { name: 'NonErrorThrown', message: texto.slice(0, 500), stack: null };
}

/** Chave de dedupe: sem número de linha/coluna nem query (o servidor faz o fingerprint de verdade). */
export function chaveLocal(kind: string, name: string, message: string, stack: string | null): string {
  const frames = (stack ?? '')
    .split('\n')
    .filter((l) => /^\s*at\s|@/.test(l))
    .slice(0, 3)
    .map((l) => l.replace(/\?[^)\s:]*/g, '').replace(/(:\d+){1,2}(?=\)|$|\s)/g, '').trim());
  return [kind, name, ...(frames.length ? frames : [message.replace(/\d+/g, '#')])].join('|');
}

export function criarRelator(op: OpcoesDoRelator) {
  const agora = op.agora ?? Date.now;
  const agendar = op.agendar ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const folga = op.folgaMs ?? 2000;
  const janela = op.janelaDedupeMs ?? 60_000;
  const pausa = op.pausaAposFalhaMs ?? 30_000;

  let fila: Relato[] = [];
  const vistos = new Map<string, number>();
  let agendado = false;
  let enviando = false;
  let pausadoAte = 0;

  async function esvaziar(): Promise<void> {
    if (enviando || fila.length === 0 || agora() < pausadoAte) return;
    enviando = true;
    try {
      while (fila.length > 0) {
        const lote = fila.slice(0, MAX_POR_LOTE);
        fila = fila.slice(lote.length);
        try {
          await op.enviar(lote);
        } catch {
          // Falha de envio NÃO é relatada (seria o laço) nem reenfileirada: o lote é descartado e a
          // fila para por um tempo, para um servidor fora do ar não receber rajada.
          pausadoAte = agora() + pausa;
          break;
        }
      }
    } finally {
      enviando = false;
    }
  }

  function agendarEnvio() {
    if (agendado) return;
    agendado = true;
    agendar(() => {
      agendado = false;
      void esvaziar().catch(() => undefined);
    }, folga);
  }

  function relatar(err: unknown, kind: KindDoErro = 'error', context?: Record<string, unknown>): void {
    try {
      if (!op.ligado() || ehEsperado(err)) return;
      const { name, message, stack } = descrever(err);
      const chave = chaveLocal(kind, name, message, stack);
      const t = agora();
      const visto = vistos.get(chave);
      if (visto !== undefined && t - visto < janela) return;
      vistos.set(chave, t);
      if (vistos.size > MAX_VISTOS) vistos.delete(vistos.keys().next().value as string);

      const meta = op.meta();
      fila.push({
        source: 'app', kind, name, message, stack,
        route: meta.route, platform: meta.platform, app_version: meta.app_version,
        occurred_at: new Date(t).toISOString(),
        ...(context ? { context } : {}),
      });
      if (fila.length > MAX_FILA) fila = fila.slice(-MAX_FILA);
      if (kind === 'crash') void esvaziar().catch(() => undefined);
      else agendarEnvio();
    } catch {
      // relatar nunca pode ser o motivo de um novo erro
    }
  }

  return { relatar, esvaziar, tamanhoDaFila: () => fila.length };
}
