import { foldCategory } from './categories-merge.ts';

export interface Subcategory {
  id: string;
  workspace_id: string;
  parent_category: string;
  name: string;
  edit_revision: number;
  uses: number;
}
export interface SubcategoryState { workspace_id: string; items: Subcategory[] }
export type SubcategoryWriteInput = {
  action: 'save'; workspace_id: string; subcategory_id: string | null;
  expected_revision: number | null; parent_category: string; name: string;
  merge_into_id: string | null; expected_merge_revision: number | null;
} | { action: 'delete'; workspace_id: string; subcategory_id: string; expected_revision: number };
export interface SubcategoryWriteResult {
  workspace_id: string; subcategory_id: string; edit_revision: number | null;
  merged: boolean; deleted: boolean; affected_records: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function invalid(field: string): never {
  throw new Error(`Subcategorias: ${field} inválido. Confira os dados e tente novamente.`);
}
function record(value: unknown, fields: readonly string[], field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid(field);
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).length !== fields.length || fields.some(key => !Object.hasOwn(raw, key))) return invalid(field);
  return raw;
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) return invalid('identificação');
  return value.toLowerCase();
}
function integer(value: unknown, field: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) return invalid(field);
  return value;
}
function name(value: unknown, field: string, normalize = false): string {
  if (typeof value !== 'string') return invalid(field);
  const normalized = value.trim().toLowerCase();
  if (!normalize && normalized !== value) return invalid(field);
  const length = Array.from(normalized).length;
  if (length < 1 || length > 40) return invalid(field);
  return normalized;
}
function boolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') return invalid(field);
  return value;
}
function unique(value: string | null, seen: Set<string | null>, field: string): void {
  if (seen.has(value)) invalid(`${field} repetido`);
  seen.add(value);
}

export function decodeSubcategoryState(value: unknown): SubcategoryState {
  const raw = record(value, ['workspace_id', 'items'], 'leitura');
  const workspace_id = id(raw.workspace_id);
  if (!Array.isArray(raw.items)) return invalid('detalhes');
  const ids = new Set<string | null>(); const namespaces = new Set<string | null>();
  const items = raw.items.map(value => {
    const item = record(value, ['id', 'workspace_id', 'parent_category', 'name', 'edit_revision', 'uses'], 'detalhe');
    const childId = id(item.id); unique(childId, ids, 'detalhe');
    if (id(item.workspace_id) !== workspace_id) invalid('espaço do detalhe');
    const parent_category = name(item.parent_category, 'categoria');
    const childName = name(item.name, 'nome');
    // Tuple encoding prevents separator characters inside names from creating false collisions.
    unique(JSON.stringify([foldCategory(parent_category), foldCategory(childName)]), namespaces, 'nome no pai');
    return { id: childId, workspace_id, parent_category, name: childName,
      edit_revision: integer(item.edit_revision, 'revisão', 1), uses: integer(item.uses, 'usos') };
  });
  return { workspace_id, items };
}

export function subcategoryAfterParentChange(
  subcategoryId: string | null, previousParent: string | null, newParent: string | null,
): string | null {
  if (subcategoryId === null || !previousParent?.trim() || !newParent?.trim()) return null;
  return foldCategory(previousParent) === foldCategory(newParent) ? subcategoryId : null;
}

export function subcategoryForParent(
  state: SubcategoryState | null, subcategoryId: string | null, parent: string | null, workspace: string,
): Subcategory | null {
  if (subcategoryId === null) return null;
  const childId = id(subcategoryId); const workspaceId = id(workspace);
  if (state === null || parent === null || !parent.trim()) return invalid('referência do detalhe');
  const current = decodeSubcategoryState(state);
  if (current.workspace_id !== workspaceId) return invalid('espaço do detalhe');
  const child = current.items.find(item => item.id === childId);
  if (!child || foldCategory(child.parent_category) !== foldCategory(parent)) return invalid('referência do detalhe');
  return child;
}

export function subcategoryWriteInput(value: unknown): SubcategoryWriteInput {
  // Dispatch only chooses the exact closed shape; every field is validated below.
  const action = value && typeof value === 'object' ? (value as Record<string, unknown>).action : undefined;
  if (action === 'delete') {
    const raw = record(value, ['action', 'workspace_id', 'subcategory_id', 'expected_revision'], 'remoção');
    return { action, workspace_id: id(raw.workspace_id), subcategory_id: id(raw.subcategory_id),
      expected_revision: integer(raw.expected_revision, 'revisão', 1) };
  }
  if (action !== 'save') return invalid('ação');
  const raw = record(value, ['action', 'workspace_id', 'subcategory_id', 'expected_revision', 'parent_category', 'name',
    'merge_into_id', 'expected_merge_revision'], 'gravação');
  const subcategory_id = raw.subcategory_id === null ? null : id(raw.subcategory_id);
  const expected_revision = raw.expected_revision === null ? null : integer(raw.expected_revision, 'revisão', 1);
  if ((subcategory_id === null) !== (expected_revision === null)) return invalid('revisão do detalhe');
  const merge_into_id = raw.merge_into_id === null ? null : id(raw.merge_into_id);
  const expected_merge_revision = raw.expected_merge_revision === null ? null : integer(raw.expected_merge_revision, 'revisão do receptor', 1);
  if ((merge_into_id === null) !== (expected_merge_revision === null)
    || (merge_into_id !== null && (subcategory_id === null || merge_into_id === subcategory_id))) return invalid('junção');
  return { action, workspace_id: id(raw.workspace_id), subcategory_id, expected_revision,
    parent_category: name(raw.parent_category, 'categoria', true), name: name(raw.name, 'nome', true), merge_into_id, expected_merge_revision };
}

export function decodeSubcategoryWriteResult(value: unknown): SubcategoryWriteResult {
  const raw = record(value, ['workspace_id', 'subcategory_id', 'edit_revision', 'merged', 'deleted', 'affected_records'], 'resultado');
  const merged = boolean(raw.merged, 'junção'); const deleted = boolean(raw.deleted, 'remoção');
  const edit_revision = raw.edit_revision === null ? null : integer(raw.edit_revision, 'revisão', 1);
  if (deleted ? edit_revision !== null || merged : edit_revision === null) return invalid('resultado da revisão');
  return { workspace_id: id(raw.workspace_id), subcategory_id: id(raw.subcategory_id), edit_revision, merged, deleted,
    affected_records: integer(raw.affected_records, 'registros afetados') };
}

/** Exact cents invariant: optional null detail is an ordinary, unique breakdown line. */
export function sumSubcategoryBreakdown(
  parentCents: number, lines: readonly { subcategory_id: string | null; total_cents: number }[],
): number {
  const parent = integer(parentCents, 'total do pai');
  if (!Array.isArray(lines)) return invalid('totais dos detalhes');
  const seen = new Set<string | null>(); let total = 0n;
  for (const value of lines) {
    const line = record(value, ['subcategory_id', 'total_cents'], 'total do detalhe');
    const childId = line.subcategory_id === null ? null : id(line.subcategory_id);
    unique(childId, seen, 'detalhe no total');
    total += BigInt(integer(line.total_cents, 'centavos do detalhe'));
  }
  if (total > BigInt(Number.MAX_SAFE_INTEGER) || total !== BigInt(parent)) return invalid('soma dos detalhes');
  return Number(total);
}
