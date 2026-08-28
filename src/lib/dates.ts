/**
 * Helpers puros de data e dinheiro — sem React, sem React Native, sem Supabase.
 * Ficam isolados aqui porque são a parte do app com bug de fuso mais fácil de
 * introduzir (e a única coberta por teste automatizado: src/lib/dates.test.ts).
 */

/** Data local em YYYY-MM-DD — nunca toISOString() (UTC desloca o dia em GMT-3). */
export function localISODate(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Primeiro e último dia de um mês YYYY-MM, em datas locais. */
export function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  const from = `${month}-01`;
  // dia 0 do mês seguinte = último dia deste mês (lida com 28/29/30/31)
  const to = localISODate(new Date(y, m, 0));
  return { from, to };
}

export function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Data em dd-mm-yyyy (aceita ISO string ou Date). */
/**
 * `new Date('2026-08-28')` é parseado como meia-noite **UTC**. No fuso do Brasil (-03), o
 * `getDate()` disso devolve **27** — toda data do app aparecia um dia mais cedo: vencimento,
 * lançamento, fechamento de fatura. Data pura (`YYYY-MM-DD`) precisa virar data LOCAL.
 */
function parseLocal(value: string): Date {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!dateOnly) return new Date(value);
  return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
}

/**
 * Número decimal em pt-BR: vírgula, nunca ponto.
 *
 * Existiam três versões disso — uma em `net-worth.tsx`, uma inline em `debts.tsx`, e NENHUMA em
 * `reports.tsx`, que por isso escrevia "Guardou 90.4% do que entrou" com ponto, ao lado de
 * "90,4%" na tela de patrimônio. Mesmo dado, duas grafias.
 */
export function formatNumberBR(value: number): string {
  return String(value).replace('.', ',');
}

export function formatDateBR(value: string | Date): string {
  const d = typeof value === 'string' ? parseLocal(value) : value;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  // Barra, não hífen: `isoToBR` (o que os formulários mostram e o que o usuário digita) sempre
  // usou `26/08/2026`, e esta função usava `26-08-2026`. Duas grafias para a mesma data no mesmo
  // app — e nenhuma das duas era a do Brasil na tela de leitura. Hífen aqui ainda lembrava ISO,
  // que é como o dado é ARMAZENADO, não como se lê.
  return `${dd}/${mm}/${d.getFullYear()}`;
}

// ── entrada de data/hora em texto (evita dependência nativa de picker) ────────

/** `2026-08-26` -> `26/08/2026` */
export function isoToBR(iso: string): string {
  const [y, m, d] = iso.split('-');
  return d && m && y ? `${d}/${m}/${y}` : iso;
}

/** `26/08/2026` -> `2026-08-26` */
export function brToISO(br: string): string {
  const [d, m, y] = br.split('/');
  return d && m && y ? `${y}-${m}-${d}` : br;
}

/** Valida formato E existência (31/02 não passa). */
export function isValidBRDate(br: string): boolean {
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(br)) return false;
  const [d, m, y] = br.split('/').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getDate() === d && date.getMonth() === m - 1 && date.getFullYear() === y;
}

/** Valida `HH:MM` em 24h. */
export function isValidTime(hhmm: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(hhmm)) return false;
  const [h, min] = hhmm.split(':').map(Number);
  return h >= 0 && h <= 23 && min >= 0 && min <= 59;
}

/**
 * Monta o instante a partir da data/hora digitadas, no fuso do aparelho — que é
 * o do usuário. `null` se qualquer um dos dois for inválido.
 */
export function localDateTime(brDate: string, hhmm: string): Date | null {
  if (!isValidBRDate(brDate) || !isValidTime(hhmm)) return null;
  const [d, m, y] = brDate.split('/').map(Number);
  const [h, min] = hhmm.split(':').map(Number);
  return new Date(y, m - 1, d, h, min, 0, 0);
}

/** Date -> `HH:MM` local. */
export function timeBR(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
