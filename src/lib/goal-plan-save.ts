import type { GoalPlanInput } from './goal-planning.ts';
import { createSealedSaveController } from './sealed-save.ts';

export interface GoalPlanSaveResult { workspace_id: string; edit_revision: number }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function invalid(field: string): never { throw new Error(`Planejamento de metas: ${field} inválido. Confira os dados e tente novamente.`); }
function record(value: unknown, keys: string[], field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid(field);
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).length !== keys.length || keys.some(key => !Object.hasOwn(raw, key))) invalid(field);
  return raw;
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) return invalid('identificação');
  return value.toLowerCase();
}
function integer(value: unknown, field: string, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > max) return invalid(field);
  return value;
}
function date(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return invalid('primeira data');
  const year = Number(value.slice(0, 4));const month = Number(value.slice(5, 7));const day = Number(value.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > lengths[month - 1]) invalid('primeira data');
  return value;
}
/** The controller validates independently of the draft builder before retaining an intent. */
function normalize(value: GoalPlanInput): GoalPlanInput {
  const raw = record(value, ['workspace_id', 'expected_revision', 'goals_fingerprint', 'items'], 'gravação');
  if (typeof raw.goals_fingerprint !== 'string' || !/^[a-f0-9]{32}$/.test(raw.goals_fingerprint)) invalid('versão das metas');
  if (!Array.isArray(raw.items)) invalid('itens do plano');
  const seen = new Set<string>();
  const items = raw.items.map(value => {
    const item = record(value, ['goal_id', 'included', 'monthly_cents', 'first_on'], 'item do plano');
    const goal_id = id(item.goal_id);
    if (seen.has(goal_id)) invalid('meta repetida');seen.add(goal_id);
    if (typeof item.included !== 'boolean') invalid('inclusão da meta');
    if (!item.included) {
      if (item.monthly_cents !== null || item.first_on !== null) invalid('meta excluída');
      return { goal_id, included: false, monthly_cents: null, first_on: null };
    }
    return { goal_id, included: true, monthly_cents: integer(item.monthly_cents, 'aporte mensal'), first_on: date(item.first_on) };
  }).sort((a, b) => a.goal_id < b.goal_id ? -1 : a.goal_id > b.goal_id ? 1 : 0);
  return { workspace_id: id(raw.workspace_id),
    expected_revision: raw.expected_revision === null ? null : integer(raw.expected_revision, 'revisão', Number.MAX_SAFE_INTEGER - 1),
    goals_fingerprint: raw.goals_fingerprint, items };
}
function definitiveRefusal(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error) || typeof error.code !== 'string') return false;
  return /^(22|23)[0-9A-Z]{3}$/.test(error.code) || ['42501', 'P0001', '40001', '40P01', 'PT409'].includes(error.code);
}
function confirmedRefusal(error: unknown, mode: 'save' | 'resolve'): boolean {
  return mode === 'save' && !!error && typeof error === 'object' && 'code' in error && error.code === 'PT409'
    && 'message' in error && (error.message === 'Plano alterado. Confira novamente' || error.message === 'As metas mudaram. Confira o plano novamente');
}
/** Only a matching, closed command-owned terminal receipt constructs this error. */
export class GoalPlanAttemptCancelledError extends Error {
  constructor() { super('Esta tentativa não foi salva. Confira o plano antes de ajustar.');this.name = 'GoalPlanAttemptCancelledError'; }
}
export function goalPlanWriteError(failure: unknown): string {
  const error = failure && typeof failure === 'object' ? failure : {};
  const code = 'code' in error ? error.code : null;
  const message = 'message' in error && typeof error.message === 'string' ? error.message : '';
  if (code === 'PT409') return 'As metas ou o plano mudaram. Feche e abra novamente para conferir.';
  if (code === '42501') return 'Não consegui autorizar esta alteração. Confira sua sessão e o espaço selecionado.';
  if (failure instanceof GoalPlanAttemptCancelledError) return failure.message;
  if (message.startsWith('Planejamento de metas:')) return message;
  return 'Não consegui confirmar o plano. Confira sua conexão e tente novamente.';
}
export function createGoalPlanSaveController(
  send: (input: GoalPlanInput, requestId: string) => Promise<unknown>, newId: () => string,
  publish?: (input: GoalPlanInput | null) => void,
  resolveAttempt?: (input: GoalPlanInput, requestId: string) => Promise<unknown>,
): { submit: (input: GoalPlanInput) => Promise<GoalPlanSaveResult>; resolve: () => Promise<GoalPlanSaveResult> } {
  return createSealedSaveController(send, newId, {
    normalize, requestId: id, definitiveRefusal, confirmedRefusal,
    terminalRefusal: error => error instanceof GoalPlanAttemptCancelledError,
    decode(value, input) {
      if (value && typeof value === 'object' && 'cancelled' in value) {
        const result = record(value, ['workspace_id', 'cancelled'], 'encerramento da tentativa');
        if (id(result.workspace_id) !== input.workspace_id || result.cancelled !== true) invalid('encerramento da tentativa');
        throw new GoalPlanAttemptCancelledError();
      }
      const result = record(value, ['workspace_id', 'edit_revision'], 'confirmação da gravação');
      const receipt = { workspace_id: id(result.workspace_id), edit_revision: integer(result.edit_revision, 'revisão confirmada') };
      if (receipt.workspace_id !== input.workspace_id || receipt.edit_revision !== (input.expected_revision ?? 0) + 1) invalid('confirmação da tentativa');
      return receipt;
    },
  }, publish, resolveAttempt);
}
