import { inicialParaOSaldo } from './accounts.ts';
import { formatNumberBR } from './dates.ts';
import { financeErrorMessage } from './finance-form.ts';

export type AccountType = 'checking' | 'savings' | 'credit_card' | 'cash' | 'investment';
export interface AccountFormState {
  id?: string;
  name: string;
  type: AccountType;
  /** Unsigned displayed current balance; only checking may apply the negative sign. */
  saldoCents: number;
  negativo: boolean;
  /** Changing current balance adjusts the original seed, leaving transactions intact. */
  base: { atual: number; inicial: number } | null;
  /** Existing family conversions preserve this signed seed; card debt never adjusts it. */
  originalInitialBalanceCents: number | null;
  closingDay: string;
  dueDay: string;
  limitCents: number;
  payerId: string | null;
  fechamentoInclusivo: boolean;
  rotativoAuto: boolean;
  rotativoRate: string;
}

export function emptyAccountForm(type: AccountType = 'checking'): AccountFormState {
  return { name: '', type, saldoCents: 0, negativo: false, base: null, originalInitialBalanceCents: null, closingDay: '', dueDay: '', limitCents: 0, payerId: null, fechamentoInclusivo: false, rotativoAuto: false, rotativoRate: '' };
}

export function accountFormFromAccount(account: {
  id: string; name: string; type: AccountType; initial_balance_cents: number;
  closing_day?: number | null; due_day?: number | null; credit_limit_cents?: number | null;
  payment_account_id?: string | null; closing_day_inclusive?: boolean | null;
  rotativo_auto?: boolean | null; rotativo_rate_monthly?: number | null;
}, currentBalance?: number | null): AccountFormState {
  const current = currentBalance ?? account.initial_balance_cents;
  return { id: account.id, name: account.name, type: account.type,
    saldoCents: Math.abs(current), negativo: current < 0,
    originalInitialBalanceCents: account.initial_balance_cents,
    base: currentBalance == null ? null : { atual: currentBalance, inicial: account.initial_balance_cents },
    closingDay: account.closing_day ? String(account.closing_day) : '',
    dueDay: account.due_day ? String(account.due_day) : '',
    limitCents: account.credit_limit_cents ?? 0, payerId: account.payment_account_id ?? null,
    fechamentoInclusivo: account.closing_day_inclusive ?? false, rotativoAuto: account.rotativo_auto ?? false,
    rotativoRate: account.rotativo_rate_monthly == null ? '' : formatNumberBR(account.rotativo_rate_monthly * 100),
  };
}

export const accountDayValid = (value: string) => /^\d{1,2}$/.test(value) && Number(value) >= 1 && Number(value) <= 31;
const safeMoney = (value: number) => Number.isSafeInteger(value) && value >= 0;
const signedBalance = (form: AccountFormState) => form.type === 'checking' && form.negativo ? -form.saldoCents : form.saldoCents;
const initialBalance = (form: AccountFormState) => form.type === 'credit_card'
  ? form.id ? form.originalInitialBalanceCents ?? 0 : 0
  : form.base
  ? inicialParaOSaldo(signedBalance(form), form.base.atual, form.base.inicial)
  : signedBalance(form);

export function accountFormErrors(form: AccountFormState): Partial<Record<'name' | 'type' | 'saldoCents' | 'closingDay' | 'dueDay' | 'limitCents' | 'rotativoRate', string>> {
  const errors: ReturnType<typeof accountFormErrors> = {};
  if (!form.name.trim()) errors.name = 'Informe o nome da conta';
  if (!['checking', 'savings', 'credit_card', 'cash', 'investment'].includes(form.type)) errors.type = 'Escolha um tipo de conta';
  if (!safeMoney(form.saldoCents) || !Number.isSafeInteger(initialBalance(form)) ||
      (form.base && (!Number.isSafeInteger(form.base.atual) || !Number.isSafeInteger(form.base.inicial)))) errors.saldoCents = 'Informe um saldo válido em centavos';
  // Existing negative balances must not become positive just because a type hides the sign.
  if (form.id && form.negativo && form.type !== 'checking' && form.type !== 'credit_card') {
    errors.saldoCents = 'A conta está no vermelho. Use Corrente ou ajuste o saldo antes de mudar o tipo.';
  }
  if (form.type === 'credit_card') {
    if (!accountDayValid(form.closingDay)) errors.closingDay = 'De 1 a 31';
    if (!accountDayValid(form.dueDay)) errors.dueDay = 'De 1 a 31';
    if (!safeMoney(form.limitCents)) errors.limitCents = 'Informe um limite válido';
    const rate = form.rotativoRate.trim();
    if (rate && (!/^\d+(?:[,.]\d+)?$/.test(rate) || Number(rate.replace(',', '.')) > 100)) errors.rotativoRate = 'Use um número de 0 a 100, como 15,5';
  }
  return errors;
}

export function accountFormPayload(form: AccountFormState) {
  const errors = accountFormErrors(form);
  if (Object.keys(errors).length) throw new Error(Object.values(errors)[0]);
  const card = form.type === 'credit_card';
  return { ...(form.id ? { id: form.id } : {}), name: form.name.trim(), type: form.type,
    initial_balance_cents: initialBalance(form),
    closing_day: card ? Number(form.closingDay) : null,
    due_day: card ? Number(form.dueDay) : null,
    credit_limit_cents: card ? form.limitCents : null,
    closing_day_inclusive: card ? form.fechamentoInclusivo : false,
    rotativo_auto: card ? form.rotativoAuto : false,
    rotativo_rate_monthly: card && form.rotativoRate.trim() ? Number(form.rotativoRate.trim().replace(',', '.')) / 100 : null,
    payment_account_id: card ? form.payerId : null,
  };
}

export function accountFormErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && error.code === '23505') return 'Já existe uma conta com esse nome. Escolha outro nome.';
  return financeErrorMessage(error, 'Não deu para salvar a conta. Tente de novo.');
}
