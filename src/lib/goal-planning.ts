/** F08 boundary: the server owns financial projection; this module validates and copies it. */
export interface GoalPlanItem {
  goal_id: string;
  included: boolean;
  monthly_cents: number | null;
  first_on: string | null;
}
export interface GoalPlanPreview { goals_fingerprint: string; items: GoalPlanItem[] }
export interface GoalPlanInput extends GoalPlanPreview { workspace_id: string; expected_revision: number | null }
export interface GoalPlanningGoal extends GoalPlanItem {
  name: string;
  target_cents: number;
  saved_cents: number;
  deadline: string | null;
  suggested_cents: number | null;
  origin: 'saved' | 'suggested' | 'draft';
  deadline_status: 'none' | 'future' | 'past';
}
export interface GoalPlanningDailyPoint {
  day: string;
  cash_cents: number;
  planned_cents: number;
  cumulative_planned_cents: number;
  available_cents: number;
}
export interface GoalPlanningMonth extends Omit<GoalPlanningDailyPoint, 'day'> {
  month: string;
  from: string;
  to: string;
  partial: boolean;
  first_pressure_on: string | null;
}
export interface GoalPlanningState {
  workspace_id: string;
  workspace_name: string;
  cycle_close_day: number | null;
  as_of: string;
  days: number;
  view: 'civil' | 'cycle';
  mode: 'month' | 'day';
  edit_revision: number | null;
  goals_fingerprint: string;
  goals: GoalPlanningGoal[];
  reserved_cash_cents: number;
  unassigned_goals_cents: number;
  income_present: boolean;
  incomplete_goal_ids: string[];
  excluded_goal_ids: string[];
  missed_deadline_goal_ids: string[];
  points: GoalPlanningDailyPoint[];
  months: GoalPlanningMonth[];
  first_pressure_on: string | null;
  minimum_available_cents: number;
}
type MoneyFields = 'cash_cents' | 'planned_cents' | 'cumulative_planned_cents' | 'available_cents';
export interface GoalPlanningGoalDTO extends Omit<GoalPlanningGoal, 'target_cents' | 'saved_cents' | 'monthly_cents' | 'suggested_cents'> {
  target_cents: string;
  saved_cents: string;
  monthly_cents: string | null;
  suggested_cents: string | null;
}
export interface GoalPlanningDailyPointDTO extends Omit<GoalPlanningDailyPoint, MoneyFields> {
  cash_cents: string; planned_cents: string; cumulative_planned_cents: string; available_cents: string;
}
export interface GoalPlanningMonthDTO extends Omit<GoalPlanningMonth, MoneyFields> {
  cash_cents: string; planned_cents: string; cumulative_planned_cents: string; available_cents: string;
}
export interface GoalPlanningStateDTO extends Omit<GoalPlanningState, 'goals' | 'points' | 'months' | 'reserved_cash_cents' | 'unassigned_goals_cents' | 'minimum_available_cents'> {
  goals: GoalPlanningGoalDTO[];
  points: GoalPlanningDailyPointDTO[];
  months: GoalPlanningMonthDTO[];
  reserved_cash_cents: string;
  unassigned_goals_cents: string;
  minimum_available_cents: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function invalid(field: string): never { throw new Error(`Planejamento de metas: ${field} inválido. Confira os dados e tente novamente.`); }
function record(value: unknown, fields: string[], field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid(field);
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).length !== fields.length || fields.some(key => !Object.hasOwn(raw, key))) return invalid(field);
  return raw;
}
function list(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) return invalid(field);
  return value;
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) return invalid('identificação');
  return value.toLowerCase();
}
function hash(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{32}$/.test(value)) return invalid('versão das metas');
  return value;
}
function integer(value: unknown, field: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) return invalid(field);
  return value;
}
function cents(value: unknown, field: string, signed = false): number {
  if (typeof value !== 'string' || !(signed ? /^-?(0|[1-9]\d*)$/ : /^(0|[1-9]\d*)$/).test(value)) return invalid(field);
  const exact = BigInt(value); const limit = BigInt(Number.MAX_SAFE_INTEGER);
  if (exact < -limit || exact > limit) return invalid(`${field}: valor excede o limite seguro`);
  return Number(exact);
}
function boolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') return invalid(field);
  return value;
}
function enumeration<T extends string>(value: unknown, values: readonly T[], field: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) return invalid(field);
  return value as T;
}
function date(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return invalid(field);
  const year = Number(value.slice(0, 4)); const month = Number(value.slice(5, 7)); const day = Number(value.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > lengths[month - 1]) return invalid(field);
  return value;
}
function nullableDate(value: unknown, field: string): string | null { return value === null ? null : date(value, field); }
function month(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}$/.test(value)) return invalid('mês');
  date(`${value}-01`, 'mês'); return value;
}
function unique(value: string, seen: Set<string>, field: string): void {
  if (seen.has(value)) invalid(`${field} repetido`);
  seen.add(value);
}
function financialPoint(raw: Record<string, unknown>): Omit<GoalPlanningDailyPoint, 'day'> {
  return { cash_cents: cents(raw.cash_cents, 'saldo de caixa', true), planned_cents: cents(raw.planned_cents, 'aporte planejado'),
    cumulative_planned_cents: cents(raw.cumulative_planned_cents, 'aportes acumulados'), available_cents: cents(raw.available_cents, 'disponibilidade', true) };
}

export function decodeGoalPlanningState(value: unknown): GoalPlanningState {
  const raw = record(value, ['workspace_id', 'workspace_name', 'cycle_close_day', 'as_of', 'days', 'view', 'mode', 'edit_revision', 'goals_fingerprint', 'goals',
    'reserved_cash_cents', 'unassigned_goals_cents', 'income_present', 'incomplete_goal_ids', 'excluded_goal_ids',
    'missed_deadline_goal_ids', 'points', 'months', 'first_pressure_on', 'minimum_available_cents'], 'leitura');
  const seenGoals = new Set<string>();
  const goals = list(raw.goals, 'metas').map(value => {
    const g = record(value, ['goal_id', 'name', 'target_cents', 'saved_cents', 'deadline', 'included', 'monthly_cents', 'first_on',
      'suggested_cents', 'origin', 'deadline_status'], 'meta');
    const goal_id = id(g.goal_id); unique(goal_id, seenGoals, 'meta');
    if (typeof g.name !== 'string' || !g.name.trim()) invalid('nome da meta');
    const target_cents = cents(g.target_cents, 'alvo'); if (target_cents === 0) invalid('alvo');
    return { goal_id, name: g.name, target_cents, saved_cents: cents(g.saved_cents, 'valor guardado'),
      deadline: nullableDate(g.deadline, 'prazo'), included: boolean(g.included, 'inclusão da meta'),
      monthly_cents: g.monthly_cents === null ? null : cents(g.monthly_cents, 'aporte mensal'),
      first_on: nullableDate(g.first_on, 'primeiro aporte'), suggested_cents: g.suggested_cents === null ? null : cents(g.suggested_cents, 'sugestão'),
      origin: enumeration(g.origin, ['saved', 'suggested', 'draft'] as const, 'origem do plano'),
      deadline_status: enumeration(g.deadline_status, ['none', 'future', 'past'] as const, 'situação do prazo') };
  });
  function goalIds(value: unknown, field: string): string[] {
    const seen = new Set<string>();
    return list(value, field).map(value => { const goal = id(value); unique(goal, seen, field); if (!seenGoals.has(goal)) invalid(field); return goal; });
  }
  const seenDays = new Set<string>(); const seenMonths = new Set<string>();
  const points = list(raw.points, 'dias').map(value => {
    const p = record(value, ['day', 'cash_cents', 'planned_cents', 'cumulative_planned_cents', 'available_cents'], 'dia');
    const day = date(p.day, 'dia'); unique(day, seenDays, 'dia'); return { day, ...financialPoint(p) };
  });
  const months = list(raw.months, 'meses').map(value => {
    const m = record(value, ['month', 'from', 'to', 'partial', 'cash_cents', 'planned_cents', 'cumulative_planned_cents', 'available_cents', 'first_pressure_on'], 'mês');
    const label = month(m.month); unique(label, seenMonths, 'mês');
    const from = date(m.from, 'início do período'); const to = date(m.to, 'fim do período');
    if (from > to) invalid('período');
    return { month: label, from, to, partial: boolean(m.partial, 'período parcial'), ...financialPoint(m), first_pressure_on: nullableDate(m.first_pressure_on, 'primeira pressão') };
  });
  const mode = enumeration(raw.mode, ['month', 'day'] as const, 'modo');
  if (typeof raw.workspace_name !== 'string' || !raw.workspace_name.trim()) invalid('nome do espaço');
  if ((mode === 'month' && points.length) || (mode === 'day' && months.length)) invalid('períodos do modo');
  return { workspace_id: id(raw.workspace_id), workspace_name: raw.workspace_name,
    cycle_close_day: raw.cycle_close_day === null ? null : integer(raw.cycle_close_day, 'fechamento do ciclo', 1, 31),
    as_of: date(raw.as_of, 'data da leitura'), days: integer(raw.days, 'horizonte', 1, 3650),
    view: enumeration(raw.view, ['civil', 'cycle'] as const, 'régua'), mode,
    edit_revision: raw.edit_revision === null ? null : integer(raw.edit_revision, 'revisão', 1), goals_fingerprint: hash(raw.goals_fingerprint), goals,
    reserved_cash_cents: cents(raw.reserved_cash_cents, 'valor reservado em caixa'), unassigned_goals_cents: cents(raw.unassigned_goals_cents, 'metas sem origem'),
    income_present: boolean(raw.income_present, 'renda do período'), incomplete_goal_ids: goalIds(raw.incomplete_goal_ids, 'metas incompletas'),
    excluded_goal_ids: goalIds(raw.excluded_goal_ids, 'metas excluídas'), missed_deadline_goal_ids: goalIds(raw.missed_deadline_goal_ids, 'metas fora do prazo'),
    points, months, first_pressure_on: nullableDate(raw.first_pressure_on, 'primeira pressão'),
    minimum_available_cents: cents(raw.minimum_available_cents, 'mínimo disponível', true) };
}

function copyItems(state: GoalPlanningState, values: GoalPlanItem[], saving: boolean): GoalPlanItem[] {
  const current = new Set(state.goals.map(g => id(g.goal_id))); const seen = new Set<string>();
  const items = list(values, 'itens do plano').map(value => {
    const raw = record(value, ['goal_id', 'included', 'monthly_cents', 'first_on'], 'item do plano');
    const goal_id = id(raw.goal_id); unique(goal_id, seen, 'meta');
    if (!current.has(goal_id)) invalid('meta fora do plano atual');
    const included = boolean(raw.included, 'inclusão da meta');
    if (!included) return { goal_id, included, monthly_cents: null, first_on: null };
    const monthly_cents = raw.monthly_cents === null ? null : integer(raw.monthly_cents, 'aporte mensal', 1);
    const first_on = nullableDate(raw.first_on, 'primeiro aporte');
    if (saving && (monthly_cents === null || first_on === null)) invalid('complete o aporte mensal e a primeira data');
    return { goal_id, included, monthly_cents, first_on };
  });
  if (seen.size !== current.size) invalid('lista de metas incompleta');
  return items.sort((a, b) => a.goal_id < b.goal_id ? -1 : a.goal_id > b.goal_id ? 1 : 0);
}
export function goalPlanPreview(state: GoalPlanningState, items: GoalPlanItem[]): GoalPlanPreview {
  return { goals_fingerprint: hash(state.goals_fingerprint), items: copyItems(state, items, false) };
}
export function goalPlanInput(state: GoalPlanningState, items: GoalPlanItem[]): GoalPlanInput {
  return { workspace_id: id(state.workspace_id), expected_revision: state.edit_revision === null ? null : integer(state.edit_revision, 'revisão', 1),
    goals_fingerprint: hash(state.goals_fingerprint), items: copyItems(state, items, true) };
}
