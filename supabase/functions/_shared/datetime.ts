/**
 * Datas no fuso do usuário. O runtime das Edge Functions roda em UTC, então
 * `new Date().toISOString().slice(0,10)` devolve o dia ERRADO para quem está em
 * GMT-3 depois das 21h — um gasto lançado às 22h de segunda virava terça.
 * Tudo que envolve "que dia é hoje para este usuário" passa por aqui.
 *
 * Espelha `localISODate` do app (src/hooks/use-items.ts), que resolve o mesmo
 * problema no lado do cliente.
 */

/** Data local (YYYY-MM-DD) no fuso informado. */
export function localISODate(date: Date, timezone: string): string {
  try {
    // en-CA formata como YYYY-MM-DD
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    // timezone inválido no profile: cai para UTC em vez de derrubar o job
    return date.toISOString().slice(0, 10);
  }
}

/** Offset do fuso em minutos no instante dado (ex.: -180 para America/Sao_Paulo). */
export function offsetMinutes(date: Date, timezone: string): number {
  try {
    const name = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "longOffset",
    })
      .formatToParts(date)
      .find((part) => part.type === "timeZoneName")?.value ?? "GMT";
    // "GMT-03:00" | "GMT+05:30" | "GMT" (UTC)
    const match = name.match(/GMT([+-])(\d{2}):?(\d{2})?/);
    if (!match) return 0;
    const sign = match[1] === "-" ? -1 : 1;
    return sign * (Number(match[2]) * 60 + Number(match[3] ?? 0));
  } catch {
    return 0;
  }
}

/** Offset como sufixo ISO (ex.: "-03:00"). */
export function offsetSuffix(date: Date, timezone: string): string {
  const minutes = offsetMinutes(date, timezone);
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

/**
 * Data e hora locais completas com offset (ex.: "2026-08-26T21:43:57-03:00").
 * É isso que vai no prompt do Gemini: mandar o "agora" em UTC obriga o modelo a
 * fazer a conta do fuso sozinho para resolver "hoje"/"ontem" — e ele erra perto
 * da meia-noite.
 */
export function localDateTimeISO(date: Date, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
    return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:` +
      `${get("second")}${offsetSuffix(date, timezone)}`;
  } catch {
    return date.toISOString();
  }
}

const HAS_OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/;

/**
 * Normaliza um datetime vindo do Gemini para um instante ISO absoluto.
 * O prompt pede a hora LOCAL do usuário; quando o modelo devolve sem offset
 * ("2026-08-27T09:00:00"), o Postgres interpretaria como UTC e o lembrete
 * dispararia 3h mais cedo. Aqui carimbamos o offset do fuso do usuário.
 */
export function toInstantISO(value: string | null, timezone: string, fallback: Date): string {
  const raw = value?.trim();
  if (!raw) return fallback.toISOString();

  if (HAS_OFFSET.test(raw)) {
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? fallback.toISOString() : parsed.toISOString();
  }

  const local = raw.includes("T") ? raw : `${raw}T00:00:00`;
  // offset calculado no instante aproximado (naive lido como UTC) — suficiente:
  // o Brasil não tem horário de verão desde 2019.
  const approximate = new Date(`${local}Z`);
  if (Number.isNaN(approximate.getTime())) return fallback.toISOString();
  const parsed = new Date(`${local}${offsetSuffix(approximate, timezone)}`);
  return Number.isNaN(parsed.getTime()) ? fallback.toISOString() : parsed.toISOString();
}

/**
 * Instante -> Date "naive" com a hora de parede do usuário (fingindo ser UTC).
 * Usado para expandir RRULE no calendário do usuário: "todo dia 5" tem que cair
 * no dia 5 dele, não no dia 5 em UTC.
 */
export function toNaive(instant: Date, timezone: string): Date {
  return new Date(instant.getTime() + offsetMinutes(instant, timezone) * 60_000);
}

/** Inverso de `toNaive`: hora de parede do usuário -> instante absoluto. */
export function fromNaive(naive: Date, timezone: string): Date {
  return new Date(naive.getTime() - offsetMinutes(naive, timezone) * 60_000);
}
