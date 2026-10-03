import { createSealedSaveController } from './sealed-save.ts';

/** F07's pure boundary: decimal bigint DTOs become safe integer cents before use. */
export type EmergencyReserveBaseMode = 'manual' | 'observed';
export type EmergencyReserveSourceKind = 'account' | 'asset';
export interface EmergencyReserveConfig {
  base_mode: EmergencyReserveBaseMode;
  manual_monthly_cents: number | null;
  target_months: number;
  edit_revision: number;
}
export interface EmergencyReserveSource {
  kind: EmergencyReserveSourceKind;
  id: string;
  name: string;
  eligible: boolean;
  archived: boolean;
  available_cents: number;
  other_allocated_cents: number;
  allocated_cents: number;
  liquidity_confirmed: boolean;
  effective_cents: number;
  valuation_date: string | null;
}
export interface EmergencyReserveMonth {
  month: string;
  expense_count: number;
  essential_cents: number;
  unclassified_count: number;
  unclassified_cents: number;
  fingerprint: string;
  reviewed: boolean;
}
export interface EmergencyReserveState {
  workspace_id: string;
  workspace_name: string;
  as_of: string;
  config: EmergencyReserveConfig | null;
  sources: EmergencyReserveSource[];
  months: EmergencyReserveMonth[];
  unassigned_goals_cents: number;
}
export interface EmergencyReserveConfigDTO extends Omit<EmergencyReserveConfig, 'manual_monthly_cents'> {
  manual_monthly_cents: string | null;
}
export interface EmergencyReserveSourceDTO extends Omit<EmergencyReserveSource, 'available_cents' | 'other_allocated_cents' | 'allocated_cents' | 'effective_cents'> {
  available_cents: string;
  other_allocated_cents: string;
  allocated_cents: string;
  effective_cents: string;
}
export interface EmergencyReserveMonthDTO extends Omit<EmergencyReserveMonth, 'essential_cents' | 'unclassified_cents'> {
  essential_cents: string;
  unclassified_cents: string;
}
export interface EmergencyReserveStateDTO extends Omit<EmergencyReserveState, 'config' | 'sources' | 'months' | 'unassigned_goals_cents'> {
  config: EmergencyReserveConfigDTO | null;
  sources: EmergencyReserveSourceDTO[];
  months: EmergencyReserveMonthDTO[];
  unassigned_goals_cents: string;
}
export interface EmergencyReserveDraft {
  baseMode: EmergencyReserveBaseMode;
  manualMonthlyCents: number;
  targetMonths: number;
  allocations: { kind: EmergencyReserveSourceKind; id: string; amountCents: number; liquidityConfirmed: boolean }[];
  reviewedMonths: string[];
  acknowledgeUnassignedGoals: boolean;
}
export interface EmergencyReserveInput {
  workspace_id: string;
  expected_revision: number | null;
  base_mode: EmergencyReserveBaseMode;
  manual_monthly_cents: number | null;
  target_months: number;
  unassigned_goals_ack_cents: number;
  allocations: { kind: EmergencyReserveSourceKind; id: string; amount_cents: number; liquidity_confirmed: true }[];
  reviewed_months: { month: string; fingerprint: string }[];
}
export interface EmergencyReserveSummary {
  baseStatus: 'not_configured' | 'manual' | 'unreviewed' | 'incomplete_classification' | 'zero_base' | 'observed';
  monthlyCents: number | null;
  reservedCents: number;
  plannedCents: number;
  unbackedCents: number;
  targetCents: number | null;
  missingCents: number | null;
  coverageMonths: number | null;
}
export interface EmergencyReserveSaveResult { workspace_id: string; edit_revision: number }

const MAX_CENTS = BigInt(Number.MAX_SAFE_INTEGER);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function invalid(field: string): never { throw new Error(`Reserva de emergência: ${field} inválido. Confira os dados e tente novamente.`); }
function record(value: unknown, fields: string[], label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalid(label);
  const object = value as Record<string, unknown>;
  const keys = Object.keys(object);
  if (keys.length !== fields.length || fields.some(key => !Object.hasOwn(object, key)) || keys.some(key => !fields.includes(key))) return invalid(label);
  return object;
}
function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) return invalid(field);
  return value;
}
function id(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) return invalid(field);
  return value.toLowerCase();
}
function boolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') return invalid(field);
  return value;
}
function integer(value: unknown, field: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) return invalid(field);
  return value;
}
function safe(value: bigint, field: string): number {
  if (value < -MAX_CENTS || value > MAX_CENTS) return invalid(`${field}: valor excede o limite seguro`);
  return Number(value);
}
function cents(value: unknown, field: string, signed = false): number {
  if (typeof value !== 'string' || !(signed ? /^-?(0|[1-9]\d*)$/ : /^(0|[1-9]\d*)$/).test(value)) return invalid(field);
  const result = safe(BigInt(value), field);
  if (!signed && result < 0) return invalid(field);
  return result;
}
function sum(values: number[], field: string): number {
  return safe(values.reduce((total, value) => total + BigInt(value), 0n), field);
}
function date(value: unknown, field: string, firstDay = false): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return invalid(field);
  const year = Number(value.slice(0, 4)); const month = Number(value.slice(5, 7)); const day = Number(value.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1] || (firstDay && day !== 1)) return invalid(field);
  return value;
}
function hash(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{32}$/.test(value)) return invalid('revisão do mês');
  return value;
}
function list(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) return invalid(field);
  return value;
}
function mode(value: unknown): EmergencyReserveBaseMode {
  if (value !== 'manual' && value !== 'observed') return invalid('modo da base');
  return value;
}
function kind(value: unknown): EmergencyReserveSourceKind {
  if (value !== 'account' && value !== 'asset') return invalid('tipo da fonte');
  return value;
}
function unique(key: string, seen: Set<string>, field: string) {
  if (seen.has(key)) return invalid(`${field} repetido`);
  seen.add(key);
}
function sourceKey(source: { kind: string; id: string }) { return `${source.kind}:${source.id}`; }
function compareSource(a: { kind: string; id: string }, b: { kind: string; id: string }): number {
  const aa = sourceKey(a); const bb = sourceKey(b); return aa < bb ? -1 : aa > bb ? 1 : 0;
}
function closedMonths(asOf: string): string[] {
  const year = Number(asOf.slice(0, 4)); const month = Number(asOf.slice(5, 7));
  const index = year * 12 + month - 1;
  return [3, 2, 1].map(offset => {
    const previous = index - offset; const y = Math.floor(previous / 12); const m = previous % 12 + 1;
    return date(`${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-01`, 'período observado', true);
  });
}
function baseFields(baseMode: unknown, manual: unknown, target: unknown) {
  const base_mode = mode(baseMode);
  const target_months = integer(target, 'meses desejados', 1, 60);
  const manual_monthly_cents = base_mode === 'manual' ? integer(manual, 'essencial mensal', 1) : null;
  if (base_mode === 'observed' && manual !== null) return invalid('base manual no modo observado');
  if (manual_monthly_cents !== null) safe(BigInt(manual_monthly_cents) * BigInt(target_months), 'alvo');
  return { base_mode, manual_monthly_cents, target_months };
}

export function decodeEmergencyReserveState(value: unknown): EmergencyReserveState {
  const raw = record(value, ['workspace_id', 'workspace_name', 'as_of', 'config', 'sources', 'months', 'unassigned_goals_cents'], 'leitura');
  const workspace_id = id(raw.workspace_id, 'espaço'); const workspace_name = text(raw.workspace_name, 'nome do espaço');
  const as_of = date(raw.as_of, 'data da leitura');
  let config: EmergencyReserveConfig | null = null;
  if (raw.config !== null) {
    const c = record(raw.config, ['base_mode', 'manual_monthly_cents', 'target_months', 'edit_revision'], 'configuração');
    const base_mode = mode(c.base_mode); const target_months = integer(c.target_months, 'meses desejados', 1, 60);
    const manual_monthly_cents = c.manual_monthly_cents === null ? null : cents(c.manual_monthly_cents, 'base manual');
    if ((base_mode === 'manual' && (manual_monthly_cents === null || manual_monthly_cents <= 0)) || (base_mode === 'observed' && manual_monthly_cents !== null)) invalid('base manual');
    config = { base_mode, manual_monthly_cents, target_months, edit_revision: integer(c.edit_revision, 'revisão da configuração') };
  }
  const seenSources = new Set<string>();
  const sources = list(raw.sources, 'fontes').map(value => {
    const s = record(value, ['kind', 'id', 'name', 'eligible', 'archived', 'available_cents', 'other_allocated_cents', 'allocated_cents', 'liquidity_confirmed', 'effective_cents', 'valuation_date'], 'fonte');
    const source: EmergencyReserveSource = {
      kind: kind(s.kind), id: id(s.id, 'fonte'), name: text(s.name, 'nome da fonte'),
      eligible: boolean(s.eligible, 'elegibilidade'), archived: boolean(s.archived, 'arquivamento'),
      available_cents: cents(s.available_cents, 'valor disponível', true),
      other_allocated_cents: cents(s.other_allocated_cents, 'outras alocações'), allocated_cents: cents(s.allocated_cents, 'valor escolhido'),
      liquidity_confirmed: boolean(s.liquidity_confirmed, 'liquidez'), effective_cents: cents(s.effective_cents, 'lastro'),
      valuation_date: s.valuation_date === null ? null : date(s.valuation_date, 'data de avaliação'),
    };
    unique(sourceKey(source), seenSources, 'fonte');
    const totalAllocated = BigInt(sum([source.other_allocated_cents, source.allocated_cents], 'total alocado na fonte'));
    const available = BigInt(Math.max(source.available_cents, 0));
    const backing = available < totalAllocated ? available : totalAllocated;
    const effective = source.eligible && !source.archived && source.liquidity_confirmed && totalAllocated > 0n
      ? BigInt(source.allocated_cents) * backing / totalAllocated : 0n;
    if (BigInt(source.effective_cents) !== effective) invalid('lastro proporcional da fonte');
    return source;
  });
  sum(sources.map(s => s.allocated_cents), 'total escolhido'); sum(sources.map(s => s.effective_cents), 'total reservado');
  const expected = closedMonths(as_of); const seenMonths = new Set<string>();
  const months = list(raw.months, 'meses').map(value => {
    const m = record(value, ['month', 'expense_count', 'essential_cents', 'unclassified_count', 'unclassified_cents', 'fingerprint', 'reviewed'], 'mês');
    const month: EmergencyReserveMonth = {
      month: date(m.month, 'mês', true), expense_count: integer(m.expense_count, 'quantidade de gastos'),
      essential_cents: cents(m.essential_cents, 'essencial do mês'), unclassified_count: integer(m.unclassified_count, 'gastos sem classificação'),
      unclassified_cents: cents(m.unclassified_cents, 'valor sem classificação'), fingerprint: hash(m.fingerprint), reviewed: boolean(m.reviewed, 'revisão do mês'),
    };
    unique(month.month, seenMonths, 'mês');
    if (!expected.includes(month.month) || month.unclassified_count > month.expense_count
      || (month.reviewed && month.unclassified_count !== 0)
      || (month.expense_count === 0 && month.essential_cents !== 0)
      || (month.unclassified_count === 0 && month.unclassified_cents !== 0)
      || (month.expense_count === month.unclassified_count && month.essential_cents !== 0)) invalid('consumo do mês');
    return month;
  });
  if (months.length !== 3) invalid('três meses civis completos');
  const state = { workspace_id, workspace_name, as_of, config, sources, months, unassigned_goals_cents: cents(raw.unassigned_goals_cents, 'metas sem origem') };
  // Query decoding must fail before rendering if derived money exceeds safe cents.
  getEmergencyReserveSummary(state);
  return state;
}

export function getEmergencyReserveSummary(state: EmergencyReserveState): EmergencyReserveSummary {
  const plannedCents = sum(state.sources.map(s => s.allocated_cents), 'total escolhido');
  const reservedCents = sum(state.sources.map(s => s.effective_cents), 'total reservado');
  let baseStatus: EmergencyReserveSummary['baseStatus']; let monthlyCents: number | null = null;
  if (!state.config) baseStatus = 'not_configured';
  else if (state.config.base_mode === 'manual') { baseStatus = 'manual'; monthlyCents = state.config.manual_monthly_cents; }
  else if (state.months.some(m => m.unclassified_count > 0)) baseStatus = 'incomplete_classification';
  else if (state.months.length !== 3 || state.months.some(m => !m.reviewed)) baseStatus = 'unreviewed';
  else {
    const total = state.months.reduce((value, month) => value + BigInt(month.essential_cents), 0n);
    baseStatus = total === 0n ? 'zero_base' : 'observed';
    if (total > 0n) monthlyCents = safe((total + 2n) / 3n, 'média essencial');
  }
  const targetCents = monthlyCents !== null && state.config ? safe(BigInt(monthlyCents) * BigInt(state.config.target_months), 'alvo') : null;
  return {
    baseStatus, monthlyCents, reservedCents, plannedCents, unbackedCents: plannedCents - reservedCents,
    targetCents, missingCents: targetCents === null ? null : Math.max(targetCents - reservedCents, 0),
    coverageMonths: monthlyCents === null ? null : reservedCents / monthlyCents,
  };
}

export function buildEmergencyReserveInput(state: EmergencyReserveState, draft: EmergencyReserveDraft): EmergencyReserveInput {
  const expected_revision = state.config === null ? null : integer(state.config.edit_revision, 'revisão', 0, Number.MAX_SAFE_INTEGER - 1);
  const base = baseFields(draft.baseMode, draft.baseMode === 'observed' ? null : draft.manualMonthlyCents, draft.targetMonths);
  const acknowledge = boolean(draft.acknowledgeUnassignedGoals, 'confirmação das metas');
  if (state.unassigned_goals_cents > 0 && !acknowledge) invalid('confirme que os valores escolhidos não são os mesmos das metas sem origem');
  const sources = new Map(state.sources.map(source => [sourceKey(source), source])); const seenSources = new Set<string>();
  const allocations = draft.allocations.map(a => {
    const k = kind(a.kind); const sourceId = id(a.id, 'fonte escolhida'); const key = sourceKey({ kind: k, id: sourceId });
    unique(key, seenSources, 'fonte escolhida');
    const source = sources.get(key); const amount_cents = integer(a.amountCents, 'valor escolhido', 1);
    if (!source || !source.eligible || source.archived) invalid('fonte escolhida indisponível');
    if (a.liquidityConfirmed !== true) invalid('confirme a disponibilidade imediata da fonte');
    const capacity = safe(BigInt(source.available_cents) - BigInt(source.other_allocated_cents), 'capacidade da fonte');
    if (amount_cents > Math.max(capacity, 0)) invalid('valor escolhido supera o disponível da fonte');
    return { kind: k, id: sourceId, amount_cents, liquidity_confirmed: true as const };
  }).sort(compareSource);
  sum(allocations.map(a => a.amount_cents), 'total escolhido');
  const seenMonths = new Set<string>(); const months = new Map(state.months.map(month => [month.month, month]));
  const reviewed_months = draft.reviewedMonths.map(value => {
    const month = date(value, 'mês revisado', true); unique(month, seenMonths, 'mês revisado');
    const current = months.get(month);
    if (!current || current.unclassified_count !== 0) invalid('classifique os gastos antes de revisar o mês');
    return { month, fingerprint: current.fingerprint };
  }).sort((a, b) => a.month < b.month ? -1 : a.month > b.month ? 1 : 0);
  return { workspace_id: state.workspace_id, expected_revision, ...base,
    unassigned_goals_ack_cents: state.unassigned_goals_cents, allocations, reviewed_months };
}

/** Validate and copy the complete wire command, independently of caller key/array ordering. */
function copyInput(value: EmergencyReserveInput): EmergencyReserveInput {
  const raw = record(value, ['workspace_id', 'expected_revision', 'base_mode', 'manual_monthly_cents', 'target_months', 'unassigned_goals_ack_cents', 'allocations', 'reviewed_months'], 'gravação');
  const base = baseFields(raw.base_mode, raw.manual_monthly_cents, raw.target_months);
  const seenSources = new Set<string>(); const seenMonths = new Set<string>();
  const allocations = list(raw.allocations, 'fontes escolhidas').map(value => {
    const a = record(value, ['kind', 'id', 'amount_cents', 'liquidity_confirmed'], 'alocação');
    const allocation = { kind: kind(a.kind), id: id(a.id, 'fonte'), amount_cents: integer(a.amount_cents, 'valor escolhido', 1), liquidity_confirmed: true as const };
    if (a.liquidity_confirmed !== true) invalid('liquidez confirmada');
    unique(sourceKey(allocation), seenSources, 'fonte'); return allocation;
  }).sort(compareSource);
  sum(allocations.map(a => a.amount_cents), 'total escolhido');
  const reviewed_months = list(raw.reviewed_months, 'meses revisados').map(value => {
    const r = record(value, ['month', 'fingerprint'], 'revisão'); const month = date(r.month, 'mês revisado', true);
    unique(month, seenMonths, 'mês revisado'); return { month, fingerprint: hash(r.fingerprint) };
  }).sort((a, b) => a.month < b.month ? -1 : a.month > b.month ? 1 : 0);
  return { workspace_id: id(raw.workspace_id, 'espaço'), expected_revision: raw.expected_revision === null ? null : integer(raw.expected_revision, 'revisão', 0, Number.MAX_SAFE_INTEGER - 1),
    ...base, unassigned_goals_ack_cents: integer(raw.unassigned_goals_ack_cents, 'confirmação das metas'), allocations, reviewed_months };
}
/** Conservative tenths from exact cents; never display a rounded-up protection horizon. */
export function formatEmergencyReserveCoverage(summary: Pick<EmergencyReserveSummary, 'reservedCents' | 'monthlyCents'>): string {
  if (summary.monthlyCents === null) return 'Base a definir';
  const reserved = integer(summary.reservedCents, 'total reservado');
  const monthly = integer(summary.monthlyCents, 'base mensal', 1);
  if (reserved === 0) return '0 meses';
  const tenths = BigInt(reserved) * 10n / BigInt(monthly);
  if (tenths === 0n) return 'Menos de 0,1 mês';
  const fraction = tenths % 10n;
  const value = `${tenths / 10n}${fraction ? `,${fraction}` : ''}`;
  return `${value} ${tenths === 10n ? 'mês' : 'meses'}`;
}

function definitiveRefusal(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error) || typeof error.code !== 'string') return false;
  return /^(22|23)[0-9A-Z]{3}$/.test(error.code)
    || error.code === '42501' || error.code === 'P0001'
    || error.code === '40001' || error.code === '40P01';
}
/** This exact command refusal follows the sealed-receipt lookup under the workspace lock. */
function confirmedRevisionRefusal(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && 'message' in error
    && (error.code === 'PT409' || error.code === '40001') && error.message === 'Reserva alterada; confira novamente';
}
/** Only constructed after decoding a matching, command-owned terminal receipt. */
export class EmergencyReserveAttemptCancelledError extends Error {
  constructor() {
    super('Esta tentativa não foi salva. Confira a reserva antes de ajustar.');
    this.name = 'EmergencyReserveAttemptCancelledError';
  }
}

/** Errors shown to a person never expose native transport internals or server addresses. */
export function emergencyReserveWriteError(failure: unknown): string {
  const error = failure && typeof failure === 'object' ? failure : {};
  const code = 'code' in error ? error.code : null;
  const message = 'message' in error && typeof error.message === 'string' ? error.message : '';
  if ((code === 'PT409' && message === 'Reserva alterada; confira novamente') || code === '40001' || message.includes('DESATUALIZADA')) return 'Esta reserva mudou em outro lugar. Feche e abra novamente para conferir.';
  if (code === '42501') return 'Não consegui autorizar esta alteração. Confira sua sessão e o espaço selecionado.';
  if (code === '22023' && message === 'Metas sem origem mudaram; confira novamente') return 'As metas sem origem mudaram. Confira novamente antes de separar estes valores.';
  if (code === '22023' && message === 'Fonte sem lastro disponível') return 'O saldo disponível de uma fonte mudou. Confira seus vínculos.';
  if (code === '22023' && message === 'Consumo mudou ou está sem classificação') return 'Os gastos do período mudaram. Confira as classificações e revise os meses novamente.';
  if (message.startsWith('Reserva de emergência:')) return message;
  return 'Não consegui confirmar a reserva. Confira sua conexão e tente novamente.';
}

export function createEmergencyReserveSaveController(
  send: (input: EmergencyReserveInput, requestId: string) => Promise<unknown>,
  newId: () => string,
  publish?: (input: EmergencyReserveInput | null) => void,
  resolveAttempt?: (input: EmergencyReserveInput, requestId: string) => Promise<unknown>,
): { submit: (input: EmergencyReserveInput) => Promise<EmergencyReserveSaveResult>; resolve: () => Promise<EmergencyReserveSaveResult> } {
  return createSealedSaveController(send, newId, {
    normalize: copyInput,
    requestId: value => id(value, 'identidade da tentativa'),
    definitiveRefusal,
    confirmedRefusal: confirmedRevisionRefusal,
    terminalRefusal: error => error instanceof EmergencyReserveAttemptCancelledError,
    decode(value, input) {
      if (typeof value === 'object' && value !== null && 'cancelled' in value) {
        const cancellation = record(value, ['workspace_id', 'cancelled'], 'encerramento da tentativa');
        if (id(cancellation.workspace_id, 'espaço confirmado') !== input.workspace_id || cancellation.cancelled !== true) invalid('encerramento da tentativa');
        throw new EmergencyReserveAttemptCancelledError();
      }
      const receipt = record(value, ['workspace_id', 'edit_revision'], 'confirmação da gravação');
      const result = { workspace_id: id(receipt.workspace_id, 'espaço confirmado'), edit_revision: integer(receipt.edit_revision, 'revisão confirmada') };
      if (result.workspace_id !== input.workspace_id || result.edit_revision !== (input.expected_revision ?? 0) + 1) invalid('confirmação da tentativa');
      return result;
    },
  }, publish, resolveAttempt);
}
