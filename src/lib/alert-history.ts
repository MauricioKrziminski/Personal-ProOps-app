export interface AlertDeliveryRow {
  id: string;
  workspace_id: string;
  kind: string;
  ref: string;
  sent_on: string;
  channel: string | null;
  created_at: string;
}

export interface AlertHistoryItem extends Omit<AlertDeliveryRow, 'channel'> {
  channels: string[];
}

const CHANNEL_ORDER = new Map([
  ['push', 0],
  ['whatsapp', 1],
]);

/** Junta as duas entregas do mesmo aviso sem misturar workspaces diferentes. */
export function combineAlertDeliveries(rows: AlertDeliveryRow[]): AlertHistoryItem[] {
  const combined = new Map<string, AlertHistoryItem>();

  for (const row of rows) {
    const key = JSON.stringify([row.workspace_id, row.kind, row.ref, row.sent_on]);
    const existing = combined.get(key);
    if (!existing) {
      combined.set(key, {
        id: row.id,
        workspace_id: row.workspace_id,
        kind: row.kind,
        ref: row.ref,
        sent_on: row.sent_on,
        created_at: row.created_at,
        channels: row.channel ? [row.channel] : [],
      });
      continue;
    }

    if (row.channel && !existing.channels.includes(row.channel)) {
      existing.channels.push(row.channel);
    }
  }

  for (const item of combined.values()) {
    item.channels.sort(
      (a, b) => (CHANNEL_ORDER.get(a) ?? 99) - (CHANNEL_ORDER.get(b) ?? 99),
    );
  }
  return [...combined.values()];
}

/** Texto curto para a linha do histórico. */
export function alertChannelLabel(channels: string[]): string | null {
  const labels = channels.map((channel) => {
    if (channel === 'push') return 'notificação';
    if (channel === 'whatsapp') return 'WhatsApp';
    if (channel === 'legacy') return 'canal anterior';
    return channel;
  });

  if (labels.length === 0) return null;
  if (labels.length === 1) return labels[0] ?? null;
  return `${labels.slice(0, -1).join(', ')} e ${labels.at(-1)}`;
}

/**
 * O que a pessoa já leu e o que ela limpou do histórico (28/09/2026, *"o sino tem que ter os
 * números, limpar todas as notificações e marcar como lida"*). Gravado por usuário, no aparelho.
 *
 * Um MARCO + uma lista curta, nos dois: "todas lidas/limpas" anda o marco (o `created_at` do mais
 * novo) e zera a lista; "esta" entra na lista. Assim a lista não cresce sem fim.
 */
export interface EstadoDosAlertas {
  vistoAte: string;
  lidos: readonly string[];
  limpoAte: string;
  limpos: readonly string[];
}

type AlertaComData = { id: string; created_at: string };

/** Compara por INSTANTE, não por texto: o mesmo momento pode vir escrito com fuso diferente. */
function ateOMarco(criado: string, marco: string): boolean {
  const c = Date.parse(criado);
  const m = marco ? Date.parse(marco) : Number.NaN;
  return !Number.isNaN(c) && !Number.isNaN(m) && c <= m;
}

export function alertaLido(a: AlertaComData, e: EstadoDosAlertas): boolean {
  return ateOMarco(a.created_at, e.vistoAte) || e.lidos.includes(a.id);
}

export function alertaVisivel(a: AlertaComData, e: EstadoDosAlertas): boolean {
  return !ateOMarco(a.created_at, e.limpoAte) && !e.limpos.includes(a.id);
}

/** O número do sino: os visíveis que ainda não foram lidos. */
export function naoLidos(itens: readonly AlertaComData[], e: EstadoDosAlertas): number {
  return itens.filter((a) => alertaVisivel(a, e) && !alertaLido(a, e)).length;
}

export function alertaMaisNovo(rows: readonly { created_at: string }[]): string | null {
  let maior: string | null = null;
  for (const r of rows) {
    if (maior === null || Date.parse(r.created_at) > Date.parse(maior)) maior = r.created_at;
  }
  return maior;
}
