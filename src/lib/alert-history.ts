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
 * Tem alerta que a pessoa ainda não viu? É a bolinha do sino da Hoje (28/09/2026).
 *
 * `vistoAte` é o `created_at` do alerta mais novo que o histórico já mostrou (vazio = nunca abriu).
 * Compara por INSTANTE, não por texto: o mesmo momento pode vir escrito com fuso diferente.
 */
export function temAlertaNovo(maisRecente: string | null | undefined, vistoAte: string): boolean {
  if (!maisRecente) return false;
  const novo = Date.parse(maisRecente);
  if (Number.isNaN(novo)) return false;
  const visto = vistoAte ? Date.parse(vistoAte) : Number.NaN;
  return Number.isNaN(visto) || novo > visto;
}

/** O `created_at` mais novo de uma lista — o que abrir o histórico marca como visto. */
export function alertaMaisNovo(rows: readonly { created_at: string }[]): string | null {
  let maior: string | null = null;
  for (const r of rows) {
    if (maior === null || Date.parse(r.created_at) > Date.parse(maior)) maior = r.created_at;
  }
  return maior;
}
