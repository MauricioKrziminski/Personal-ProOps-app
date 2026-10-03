import type { Database as GeneratedDatabase } from './database.types';

type Functions = GeneratedDatabase['public']['Functions'];
type NullableArgs<Name extends keyof Functions, Keys extends keyof Functions[Name]['Args']> =
  Omit<Functions[Name], 'Args'> & { Args: {
    [Key in keyof Functions[Name]['Args']]: Key extends Keys
      ? Functions[Name]['Args'][Key] | null : Functions[Name]['Args'][Key];
  } };

/**
 * Postgres function arguments have no NOT NULL metadata for the generator to inspect.
 * Keep generated schema untouched; declare only the nullable intents proven by these RPCs:
 * - save_transaction_payment: null id creates; null fee/revision preserves/creates (F01/F06).
 * - update_recurring_future: null anchor edits the series contract (F01/F06).
 * - reminder scoped RPCs: null recurrence turns a reminder into a one-off (20260927230030).
 * - edit_budget: null previous month identifies the standing budget (20260926150000).
 * This changes types only; required argument names and all other schema still come from staging.
 */
type ContractFunctions = Omit<Functions,
  'save_transaction_payment' | 'update_recurring_future' | 'save_reminder_scoped' | 'save_reminder_child_scoped' | 'edit_budget'> & {
  save_transaction_payment: NullableArgs<'save_transaction_payment', 'p_transaction_id' | 'p_fee_cents' | 'p_expected_revision'>;
  update_recurring_future: NullableArgs<'update_recurring_future', 'p_transaction_id'>;
  save_reminder_scoped: NullableArgs<'save_reminder_scoped', 'p_recurrence'>;
  save_reminder_child_scoped: NullableArgs<'save_reminder_child_scoped', 'p_recurrence'>;
  edit_budget: NullableArgs<'edit_budget', 'p_month_antes'>;
};
export type Database = Omit<GeneratedDatabase, 'public'> & {
  public: Omit<GeneratedDatabase['public'], 'Functions'> & { Functions: ContractFunctions };
};
