/**
 * F22: o favorito de lançamento guarda só `COLUNAS_COPIADAS` em `fields`. O decoder é a única
 * porta: chave desconhecida é ignorada, valor inválido zera o campo — nunca lança, porque a linha
 * veio de outro aparelho e pode ser de uma versão futura.
 */
import { COLUNAS_COPIADAS, type CamposCopiaveis } from './duplicar.ts';
import { normalizePaymentMethod } from './payment-method.ts';
import { expenseClassificationFromRecord } from './expense-classification.ts';

export type Modelo = CamposCopiaveis;

const KINDS = ['expense', 'income', 'transfer'];

export function decodeModelo(raw: unknown): Modelo {
  const r = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const texto = (k: string, max: number) => (typeof r[k] === 'string' && (r[k] as string).trim() && (r[k] as string).length <= max ? (r[k] as string) : null);
  const out: Record<string, unknown> = {
    kind: KINDS.includes(r.kind as string) ? r.kind : 'expense',
    description: texto('description', 200),
    merchant: texto('merchant', 200),
    amount_cents: Number.isSafeInteger(r.amount_cents) && (r.amount_cents as number) > 0 ? r.amount_cents : null,
    category: texto('category', 80),
    subcategory_id: texto('subcategory_id', 80),
    account_id: texto('account_id', 80),
    counterparty_account_id: texto('counterparty_account_id', 80),
    payment_method: normalizePaymentMethod(r.payment_method),
  };
  let classe;
  try { classe = expenseClassificationFromRecord(r); } catch { classe = expenseClassificationFromRecord(null); }
  Object.assign(out, classe);
  return Object.fromEntries(COLUNAS_COPIADAS.map((c) => [c, out[c] ?? null])) as Modelo;
}

/** O que vai para `fields`: só as colunas copiáveis, sem nulo à toa. */
export function encodeModelo(campos: Modelo): Record<string, unknown> {
  const m = decodeModelo(campos);
  return Object.fromEntries(Object.entries(m).filter(([, v]) => v !== null));
}
