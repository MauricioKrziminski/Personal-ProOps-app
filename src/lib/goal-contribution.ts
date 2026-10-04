export type GoalContributionMode = 'monthly' | 'deadline';
export interface GoalContributionInput {
  target_cents: number; saved_cents: number; as_of: string; mode: GoalContributionMode;
  monthly_cents: number | null; first_on: string | null; deadline_on: string | null;
  initial_cents: number; initial_on: string | null;
}
export interface GoalContributionResult {
  status: 'ready' | 'reached' | 'incomplete' | 'unreachable' | 'out_of_range';
  reason: null | 'monthly_amount' | 'first_date' | 'initial_date' | 'initial_after_first' | 'initial_after_deadline' | 'deadline' | 'calendar_range';
  remaining_cents: number; initial_applied_cents: number; monthly_cents: number | null;
  monthly_count: number; contribution_count: number; last_cents: number;
  first_monthly_on: string | null; estimated_on: string | null; anchor_on: string | null;
  first_offset: number | null; flags: ('initial_past')[];
}
const inputKeys = new Set(['target_cents', 'saved_cents', 'as_of', 'mode', 'monthly_cents', 'first_on', 'deadline_on', 'initial_cents', 'initial_on']);
interface CivilDate { year: number; month: number; day: number }

function invalid(field: string): never { throw new TypeError(`Plano de contribuição inválido: ${field}.`); }
function integer(value: unknown, field: string, minimum = 0): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) invalid(field);
}
function monthDays(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}
function civilDate(value: unknown, field: string): CivilDate {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid(field);
  const year = Number(value.slice(0, 4)); const month = Number(value.slice(5, 7)); const day = Number(value.slice(8, 10));
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > monthDays(year, month)) invalid(field);
  return { year, month, day };
}
function nullableDate(value: unknown, field: string): void { if (value !== null) civilDate(value, field); }
function validate(input: GoalContributionInput): void {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) invalid('campos');
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) invalid('campos');
  const keys = Reflect.ownKeys(input);
  if (keys.length !== inputKeys.size || keys.some(key => typeof key !== 'string' || !inputKeys.has(key))) invalid('campos');
  integer(input.target_cents, 'alvo', 1); integer(input.saved_cents, 'guardado'); integer(input.initial_cents, 'aporte inicial');
  if (input.monthly_cents !== null) integer(input.monthly_cents, 'contribuição mensal');
  civilDate(input.as_of, 'data da simulação'); nullableDate(input.first_on, 'primeira contribuição');
  nullableDate(input.initial_on, 'data do aporte inicial'); nullableDate(input.deadline_on, 'prazo');
  if (input.mode !== 'monthly' && input.mode !== 'deadline') invalid('modo');
  if (input.mode === 'monthly' && input.deadline_on !== null) invalid('prazo inativo');
  if (input.mode === 'deadline' && input.monthly_cents !== null) invalid('contribuição mensal inativa');
  if (input.initial_cents === 0 && input.initial_on !== null) invalid('data do aporte inicial inativa');
}

function monthIndex(date: CivilDate): number { return (date.year - 1) * 12 + date.month - 1; }
function monthOn(anchor: CivilDate, offset: bigint): string | null {
  const absolute = BigInt(monthIndex(anchor)) + offset;
  // The public civil calendar is restricted to the four-digit years 0001..9999.
  if (absolute > 119987n) return null;
  const index = Number(absolute); const year = Math.floor(index / 12) + 1; const month = index % 12 + 1;
  const day = Math.min(anchor.day, monthDays(year, month));
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Civil recurrence keeps the original anchor day, rather than the previous clamped day. */
export function goalMonthOn(anchor: string, offset: number): string | null {
  integer(offset, 'índice mensal'); return monthOn(civilDate(anchor, 'âncora'), BigInt(offset));
}
function firstOffset(anchor: CivilDate, asOf: string): number {
  const offset = Math.max(0, monthIndex(civilDate(asOf, 'data da simulação')) - monthIndex(anchor));
  const candidate = monthOn(anchor, BigInt(offset));
  return candidate !== null && candidate < asOf ? offset + 1 : offset;
}
function slotCount(anchor: CivilDate, fromOffset: number, until: string): number {
  let lastOffset = monthIndex(civilDate(until, 'prazo')) - monthIndex(anchor);
  if (lastOffset < fromOffset) return 0;
  if (monthOn(anchor, BigInt(lastOffset))! > until) lastOffset--;
  return Math.max(lastOffset - fromOffset + 1, 0);
}
function ceilDivide(amount: bigint, divisor: bigint): bigint { return (amount + divisor - 1n) / divisor; }

/** Intentions only: no missed intention is deducted from the actual saved balance. */
export function calculateGoalContribution(input: GoalContributionInput): GoalContributionResult {
  validate(input);
  const remaining = Math.max(input.target_cents - input.saved_cents, 0);
  const result: GoalContributionResult = { status: 'incomplete', reason: null, remaining_cents: remaining,
    initial_applied_cents: 0, monthly_cents: input.mode === 'monthly' ? input.monthly_cents : null,
    monthly_count: 0, contribution_count: 0, last_cents: 0, first_monthly_on: null,
    estimated_on: null, anchor_on: null, first_offset: null, flags: [] };
  function finish(status: GoalContributionResult['status'], reason: GoalContributionResult['reason']): GoalContributionResult {
    result.status = status; result.reason = reason; return result;
  }
  if (remaining === 0) { result.monthly_cents = 0; return finish('reached', null); }
  if (input.initial_on !== null && input.initial_on < input.as_of) result.flags.push('initial_past');
  if (input.initial_cents > 0 && input.initial_on === null) return finish('incomplete', 'initial_date');
  if (input.mode === 'deadline' && input.deadline_on === null) return finish('incomplete', 'deadline');
  if (input.mode === 'deadline' && input.initial_on !== null && input.initial_on > input.deadline_on!) {
    return finish('incomplete', 'initial_after_deadline');
  }
  if (input.initial_on !== null && input.initial_on >= input.as_of) result.initial_applied_cents = Math.min(input.initial_cents, remaining);
  const afterInitial = remaining - result.initial_applied_cents;
  if (afterInitial === 0) {
    result.monthly_cents = 0; result.contribution_count = 1; result.last_cents = result.initial_applied_cents;
    result.estimated_on = input.initial_on; return finish('ready', null);
  }
  if (input.mode === 'monthly' && (input.monthly_cents === null || input.monthly_cents === 0)) return finish('incomplete', 'monthly_amount');
  if (input.mode === 'deadline' && input.deadline_on! < input.as_of) return finish('unreachable', 'deadline');
  if (input.first_on === null) return finish('incomplete', 'first_date');
  const anchor = civilDate(input.first_on, 'âncora'); const offset = firstOffset(anchor, input.as_of);
  result.anchor_on = input.first_on; result.first_offset = offset;
  result.first_monthly_on = monthOn(anchor, BigInt(offset));
  if (result.initial_applied_cents > 0 && result.first_monthly_on !== null && input.initial_on! > result.first_monthly_on) {
    return finish('incomplete', 'initial_after_first');
  }
  if (input.mode === 'deadline') {
    const slots = slotCount(anchor, offset, input.deadline_on!);
    if (slots === 0) return finish('unreachable', 'deadline');
    result.monthly_cents = Number(ceilDivide(BigInt(afterInitial), BigInt(slots)));
  }
  const monthly = BigInt(result.monthly_cents!); const count = ceilDivide(BigInt(afterInitial), monthly);
  result.monthly_count = Number(count);
  // With a positive initial, afterInitial <= remaining - 1, so this total also stays safe.
  result.contribution_count = result.monthly_count + (result.initial_applied_cents > 0 ? 1 : 0);
  result.last_cents = Number(BigInt(afterInitial) - (count - 1n) * monthly);
  result.estimated_on = monthOn(anchor, BigInt(offset) + count - 1n);
  if (result.estimated_on === null) return finish('out_of_range', 'calendar_range');
  return finish('ready', null);
}

/** Random access in O(1), including the separate initial intention when present. */
export function goalContributionAt(input: GoalContributionInput, index: number): { on: string; cents: number; kind: 'initial' | 'monthly' } | null {
  integer(index, 'índice de contribuição'); const result = calculateGoalContribution(input);
  if (result.status !== 'ready' || index >= result.contribution_count) return null;
  const hasInitial = result.initial_applied_cents > 0;
  if (hasInitial && index === 0) return { on: input.initial_on!, cents: result.initial_applied_cents, kind: 'initial' };
  const monthlyIndex = index - (hasInitial ? 1 : 0);
  const on = monthOn(civilDate(result.anchor_on!, 'âncora'), BigInt(result.first_offset!) + BigInt(monthlyIndex))!;
  return { on, cents: monthlyIndex === result.monthly_count - 1 ? result.last_cents : result.monthly_cents!, kind: 'monthly' };
}
