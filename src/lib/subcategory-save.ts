import { decodeSubcategoryWriteResult, subcategoryWriteInput, type SubcategoryWriteInput, type SubcategoryWriteResult } from './subcategories.ts';
import { createSealedSaveController } from './sealed-save.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function invalid(field: string): never { throw new Error(`Subcategorias: ${field} inválido. Confira os dados e tente novamente.`); }
function id(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) return invalid('identificação');
  return value.toLowerCase();
}
function normalize(value: SubcategoryWriteInput): SubcategoryWriteInput {
  const input = subcategoryWriteInput(value);
  if (input.action === 'save' && (input.expected_revision === Number.MAX_SAFE_INTEGER
    || input.expected_merge_revision === Number.MAX_SAFE_INTEGER)) return invalid('próxima revisão');
  return input;
}
function definitiveRefusal(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error) || typeof error.code !== 'string') return false;
  return /^(22|23)[0-9A-Z]{3}$/.test(error.code) || ['42501', 'P0001', '40001', '40P01', 'PT409'].includes(error.code);
}
const confirmedMessages = [
  'Detalhe alterado. Abra novamente',
  'Detalhe receptor alterado. Abra novamente',
  'Já existe um detalhe com esse nome nesta categoria. Confira para juntar',
];
function confirmedRefusal(error: unknown, mode: 'save' | 'resolve'): boolean {
  return mode === 'save' && !!error && typeof error === 'object' && 'code' in error && error.code === 'PT409'
    && 'message' in error && typeof error.message === 'string' && confirmedMessages.includes(error.message);
}
/** Constructed only after a closed, workspace-matching terminal receipt. */
export class SubcategoryAttemptCancelledError extends Error {
  constructor() { super('Esta tentativa não foi salva. Confira o detalhe antes de ajustar.'); this.name = 'SubcategoryAttemptCancelledError'; }
}
export function subcategoryWriteError(failure: unknown): string {
  const error = failure && typeof failure === 'object' ? failure : {};
  const code = 'code' in error ? error.code : null;
  const message = 'message' in error && typeof error.message === 'string' ? error.message : '';
  if (code === 'PT409') return 'O detalhe mudou ou esse nome já existe. Feche e abra novamente para conferir.';
  if (code === '42501') return 'Não consegui autorizar esta alteração. Confira sua sessão e o espaço selecionado.';
  if (failure instanceof SubcategoryAttemptCancelledError) return failure.message;
  if (message.startsWith('Subcategorias:')) return message;
  return 'Não consegui confirmar o detalhe. Confira sua conexão e tente novamente.';
}
export function createSubcategorySaveController(
  send: (input: SubcategoryWriteInput, requestId: string) => Promise<unknown>, newId: () => string,
  publish?: (input: SubcategoryWriteInput | null) => void,
  resolveAttempt?: (input: SubcategoryWriteInput, requestId: string) => Promise<unknown>,
): { submit: (input: SubcategoryWriteInput) => Promise<SubcategoryWriteResult>; resolve: () => Promise<SubcategoryWriteResult> } {
  const terminalReceipts = new WeakSet<SubcategoryAttemptCancelledError>();
  return createSealedSaveController(send, newId, {
    normalize, requestId: id, definitiveRefusal, confirmedRefusal,
    terminalRefusal: error => error instanceof SubcategoryAttemptCancelledError && terminalReceipts.has(error),
    decode(value, input) {
      if (value && typeof value === 'object' && 'cancelled' in value) {
        const raw = value as Record<string, unknown>;
        if (Array.isArray(raw) || Object.keys(raw).length !== 2 || !Object.hasOwn(raw, 'workspace_id')
          || !Object.hasOwn(raw, 'cancelled') || id(raw.workspace_id) !== input.workspace_id || raw.cancelled !== true) return invalid('encerramento da tentativa');
        const cancelled = new SubcategoryAttemptCancelledError();
        terminalReceipts.add(cancelled);
        throw cancelled;
      }
      const receipt = decodeSubcategoryWriteResult(value);
      if (receipt.workspace_id !== input.workspace_id) return invalid('confirmação do espaço');
      if (input.action === 'delete') {
        if (receipt.subcategory_id !== input.subcategory_id || !receipt.deleted || receipt.merged || receipt.edit_revision !== null) return invalid('confirmação da remoção');
      } else {
        const merged = input.merge_into_id !== null;
        const expectedId = input.merge_into_id ?? input.subcategory_id;
        const expectedRevision = (merged ? input.expected_merge_revision! : input.expected_revision ?? 0) + 1;
        if (receipt.deleted || receipt.merged !== merged || receipt.edit_revision !== expectedRevision
          || (expectedId !== null && receipt.subcategory_id !== expectedId)) return invalid('confirmação da gravação');
      }
      return receipt;
    },
  }, publish, resolveAttempt);
}
