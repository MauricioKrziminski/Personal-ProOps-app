import { calculateGoalContribution, goalMonthOn, type GoalContributionInput, type GoalContributionResult } from './goal-contribution.ts';
import { decodeGoalPlanningState, type GoalPlanningGoal, type GoalPlanningState } from './goal-planning.ts';

export interface GoalHorizonItem {
  goal_id: string; included: boolean; mode: 'legacy' | 'monthly' | 'deadline';
  monthly_cents: number | null; first_on: string | null; deadline_on: string | null;
  initial_cents: number; initial_on: string | null;
}
export interface GoalHorizonPreview { goals_fingerprint: string; items: GoalHorizonItem[] }
export interface GoalHorizonInput extends GoalHorizonPreview { workspace_id: string; expected_revision: number | null }
export interface GoalHorizonEntry { item: GoalHorizonItem; result: GoalContributionResult }
export interface GoalHorizonState extends GoalPlanningState { horizons: GoalHorizonEntry[] }
const itemKeys = ['goal_id', 'included', 'mode', 'monthly_cents', 'first_on', 'deadline_on', 'initial_cents', 'initial_on'];
const moneyKeys = ['remaining_cents', 'initial_applied_cents', 'monthly_cents', 'last_cents'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function invalid(field: string): never { throw new Error(`Planejamento de metas: ${field}. Confira os dados e tente novamente.`); }
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('campos inválidos');
  const raw = value as Record<string, unknown>;
  if (Reflect.ownKeys(raw).length !== keys.length || keys.some(key => !Object.hasOwn(raw, key))) invalid('campos inválidos');
  return raw;
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) invalid('identificação inválida');
  return value.toLowerCase();
}
function integer(value: unknown, field: string, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > maximum) invalid(`${field} inválido`);
  return value;
}
function cents(value: unknown): number {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) invalid('centavos inválidos');
  const exact = BigInt(value);
  if (exact > BigInt(Number.MAX_SAFE_INTEGER)) invalid('centavos ultrapassam o limite seguro');
  return Number(exact);
}
function date(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') invalid('data inválida');
  try { goalMonthOn(value, 0); } catch { invalid('data inválida'); }
  return value;
}
function fingerprint(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{32}$/.test(value)) invalid('versão das metas inválida');
  return value;
}
function item(value: unknown, wire = false): GoalHorizonItem {
  const raw = record(value, itemKeys);
  if (typeof raw.included !== 'boolean' || typeof raw.mode !== 'string' || !['legacy', 'monthly', 'deadline'].includes(raw.mode)) invalid('modo ou inclusão inválidos');
  const money = (value: unknown, field: string) => wire ? cents(value) : integer(value, field);
  const normalized: GoalHorizonItem = { goal_id: id(raw.goal_id), included: raw.included,
    mode: raw.mode as GoalHorizonItem['mode'], monthly_cents: raw.monthly_cents === null ? null : money(raw.monthly_cents, 'aporte mensal'),
    first_on: date(raw.first_on), deadline_on: date(raw.deadline_on), initial_cents: money(raw.initial_cents, 'aporte inicial'), initial_on: date(raw.initial_on) };
  if ((normalized.mode === 'deadline' && normalized.monthly_cents !== null)
    || (normalized.mode !== 'deadline' && normalized.deadline_on !== null)
    || (normalized.initial_cents === 0 && normalized.initial_on !== null)) invalid('fonte inativa inválida');
  if (!normalized.included && (normalized.mode !== 'monthly' || normalized.monthly_cents !== null || normalized.first_on !== null
    || normalized.deadline_on !== null || normalized.initial_cents !== 0 || normalized.initial_on !== null)) invalid('meta excluída inválida');
  return normalized;
}
export function goalContributionInput(goal: GoalPlanningGoal, asOf: string, item: GoalHorizonItem): GoalContributionInput {
  return { target_cents: goal.target_cents, saved_cents: goal.saved_cents, as_of: asOf,
    mode: item.mode === 'deadline' ? 'deadline' : 'monthly', monthly_cents: item.mode === 'deadline' ? null : item.monthly_cents,
    first_on: item.first_on, deadline_on: item.mode === 'deadline' ? item.deadline_on : null,
    initial_cents: item.initial_cents, initial_on: item.initial_cents > 0 ? item.initial_on : null };
}
function result(value: unknown, expected: GoalContributionResult): GoalContributionResult {
  const raw = record(value, Object.keys(expected));
  for (const key of Object.keys(expected) as (keyof GoalContributionResult)[]) {
    const actual = moneyKeys.includes(key) && raw[key] !== null ? cents(raw[key]) : raw[key];
    if (key === 'flags') {
      if (!Array.isArray(actual) || actual.length !== expected.flags.length || actual.some((flag, index) => flag !== expected.flags[index])) invalid('avisos do calendário divergentes');
    } else if (actual !== expected[key]) invalid(`calendário divergente (${key})`);
  }
  return { ...expected, flags: [...expected.flags] };
}
/** Independently checks the calendar while keeping financial capacity server-owned. */
export function decodeGoalHorizonState(value: unknown): GoalHorizonState {
  const raw = record(value, ['state', 'horizons']);const state = decodeGoalPlanningState(raw.state);
  if (!Array.isArray(raw.horizons) || raw.horizons.length !== state.goals.length) invalid('lista de calendários incompleta');
  const seen = new Set<string>();
  const horizons = raw.horizons.map(value => {
    const entry = record(value, ['item', 'result']);const source = item(entry.item, true);
    const goal = state.goals.find(goal => goal.goal_id === source.goal_id);
    if (!goal || seen.has(source.goal_id)) invalid('meta fora do calendário ou repetida');
    seen.add(source.goal_id);
    const calculated = calculateGoalContribution(goalContributionInput(goal, state.as_of, source));
    if (goal.included !== source.included || goal.first_on !== source.first_on || goal.monthly_cents !== calculated.monthly_cents) invalid('fonte divergente da projeção');
    return { item: source, result: result(entry.result, calculated) };
  });
  return { ...state, horizons };
}
/** Syntax is independent of live goals, allowing the same intent to be resolved later. */
export function normalizeGoalHorizonInput(value: unknown): GoalHorizonInput {
  const raw = record(value, ['workspace_id', 'expected_revision', 'goals_fingerprint', 'items']);
  if (!Array.isArray(raw.items)) invalid('lista de metas inválida');
  const seen = new Set<string>();const items = raw.items.map(value => {
    const source = item(value);if (seen.has(source.goal_id)) invalid('meta repetida');seen.add(source.goal_id);return source;
  }).sort((a, b) => a.goal_id.localeCompare(b.goal_id));
  const revision = raw.expected_revision === null ? null : integer(raw.expected_revision, 'revisão', Number.MAX_SAFE_INTEGER - 1);
  if (revision === 0) invalid('revisão inválida');
  return { workspace_id: id(raw.workspace_id), expected_revision: revision, goals_fingerprint: fingerprint(raw.goals_fingerprint), items };
}
function sources(state: GoalHorizonState, drafts: GoalHorizonItem[], saving: boolean): GoalHorizonItem[] {
  if (!Array.isArray(drafts)) invalid('lista de metas inválida');
  const current = new Map(state.goals.map(goal => [goal.goal_id, goal]));const seen = new Set<string>();
  const items = drafts.map(value => {
    const raw = record(value, itemKeys);const gid = id(raw.goal_id);
    const goal = current.get(gid);if (!goal || seen.has(gid)) invalid('lista de metas divergente');seen.add(gid);
    const source = item(raw.included === false ? { goal_id: gid, included: false, mode: 'monthly', monthly_cents: null,
      first_on: null, deadline_on: null, initial_cents: 0, initial_on: null } : { ...raw,
      monthly_cents: raw.mode === 'deadline' ? null : raw.monthly_cents,
      deadline_on: raw.mode === 'deadline' ? raw.deadline_on : null, initial_on: raw.initial_cents === 0 ? null : raw.initial_on });
    if (source.included && saving) {
      const calculated = calculateGoalContribution(goalContributionInput(goal, state.as_of, source));
      if (calculated.status !== 'ready') {
        const labels = { monthly_amount: 'complete o aporte mensal', first_date: 'complete o primeiro aporte',
          initial_date: 'complete a data do aporte inicial', initial_after_first: 'antecipe a data do aporte inicial',
          initial_after_deadline: 'aporte inicial deve caber no prazo', deadline: 'confira o prazo do plano', calendar_range: 'prazo excede o calendário disponível' };
        invalid(calculated.reason ? labels[calculated.reason] : 'confira o calendário');
      }
    }
    return source;
  }).sort((a, b) => a.goal_id.localeCompare(b.goal_id));
  if (seen.size !== current.size) invalid('lista de metas incompleta');
  return items;
}
export function goalHorizonPreview(state: GoalHorizonState, items: GoalHorizonItem[]): GoalHorizonPreview {
  return { goals_fingerprint: fingerprint(state.goals_fingerprint), items: sources(state, items, false) };
}
export function goalHorizonInput(state: GoalHorizonState, items: GoalHorizonItem[]): GoalHorizonInput {
  return normalizeGoalHorizonInput({ workspace_id: state.workspace_id, expected_revision: state.edit_revision,
    goals_fingerprint: state.goals_fingerprint, items: sources(state, items, true) });
}
/** Inactive fields live only in the editor draft, never in the serialized source. */
export function goalHorizonDrafts(state: GoalHorizonState): GoalHorizonItem[] {
  return state.horizons.map(({ item, result }) => ({ ...item,
    monthly_cents: item.mode === 'deadline' ? result.monthly_cents : item.monthly_cents,
    deadline_on: item.mode === 'deadline' ? item.deadline_on : result.estimated_on ?? state.goals.find(goal => goal.goal_id === item.goal_id)?.deadline ?? null }));
}
