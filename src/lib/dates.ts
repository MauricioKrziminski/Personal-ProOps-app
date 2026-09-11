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

/**
 * O prefixo de sinal de um valor em dinheiro.
 *
 * ⚠️ **Negativo SEMPRE leva `−`; `signed` decide só o `+` do positivo** (10/09/2026). A regra
 * já foi "os dois são opt-in", e o resultado era um saldo projetado de −R$ 42.427,85 escrito
 * "R$ 42.427,85", com a cor `danger` como única pista de que a pessoa DEVE esse dinheiro em vez
 * de TER. Cor não é sinal: some em print, em daltonismo e em leitor de tela.
 *
 * Mora aqui, e não dentro do `<Money>`, porque é a única parte dele que dá para testar sem
 * renderizar — e é a parte que já esteve errada.
 */
export function moneySign(cents: number, signed = false): string {
  if (cents < 0) return '−';
  return signed && cents > 0 ? '+' : '';
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

/**
 * Data relativa curta: `agora`, `há 12 min`, `há 3 h`, `ontem`, `há 5 dias`, e depois de 30 dias
 * a data completa.
 *
 * Toda lista de notas de referência (Apple Notes, Bear, Keep) mostra QUANDO — é o segundo campo
 * mais consultado depois do título, e é o que dá noção de "o que é recente". Existia uma cópia
 * privada disto no detalhe da nota; agora é uma só.
 */
export function relativeBR(iso: string, now = new Date()): string {
  const minutes = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'ontem';
  if (days < 30) return `há ${days} dias`;
  return formatDateBR(iso);
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

/**
 * "Bom dia" / "Boa tarde" / "Boa noite" pela hora LOCAL do aparelho.
 *
 * As faixas são as do português falado, não as do relógio de 8h: a tarde começa ao meio-dia e a
 * noite às 18h — e a madrugada é "boa noite", não "bom dia", porque quem abre o app às 3h ainda
 * não dormiu.
 */
export function greetingBR(hour = new Date().getHours()): string {
  if (hour >= 5 && hour < 12) return 'Bom dia';
  if (hour >= 12 && hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

/**
 * Quantos dias faltam de HOJE até `iso` (negativo se já passou).
 *
 * Em UTC de propósito: as duas pontas viram meia-noite UTC antes da subtração, então o horário
 * de verão e o fuso não entram na conta — o que se quer aqui é diferença de DIAS de calendário,
 * não de instantes.
 */
export function diasAte(iso: string, hoje = localISODate()): number {
  const [ay, am, ad] = hoje.split('-').map(Number);
  const [by, bm, bd] = iso.split('-').map(Number);
  const a = Date.UTC(ay, am - 1, ad);
  const b = Date.UTC(by, bm - 1, bd);
  return Math.round((b - a) / 86400000);
}

/** `2026-09-11` + 90 → `2026-12-10`. O par de `diasAte`, para a tela escrever a data que pediu. */
export function somaDias(iso: string, dias: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10);
}

/**
 * `15032027` → `15/03/2027`, enquanto se digita.
 *
 * ⚠️ **Sem isto o campo é indigitável.** Com `keyboardType="number-pad"` o teclado do iOS não tem
 * a tecla "/", então um campo de data que espera o usuário digitar a barra só aceita texto colado.
 * A máscara põe as barras; quem digita entra só com os números.
 *
 * Apagar tem que funcionar: por isso ela reconstrói a partir dos DÍGITOS, em vez de acrescentar
 * uma barra ao que já está lá — assim o backspace atravessa a barra sozinho.
 */
export function maskBRDate(texto: string): string {
  const d = texto.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}
