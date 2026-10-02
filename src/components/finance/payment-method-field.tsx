import { Field } from '@/components/ui/field';
import { SelectField, type SelectOption } from '@/components/ui/select-field';
import { normalizePaymentMethod, PAYMENT_METHODS, paymentMethodLabel, type PaymentMethod } from '@/lib/payment-method';

const OPTIONS: readonly SelectOption[] = [
  { id: null, label: 'Não informar', neutral: true },
  ...PAYMENT_METHODS.map((id) => ({ id, label: paymentMethodLabel(id) })),
];

/** A saved payment choice uses the same inline select as the other finance fields. */
export function PaymentMethodField({ value, onChange, error, hint }: {
  value: PaymentMethod | null | undefined;
  onChange: (value: PaymentMethod | null) => void;
  error?: string;
  hint?: string;
}) {
  return (
    <Field label="Forma de pagamento" error={error} hint={hint}>
      <SelectField options={OPTIONS} value={value ?? null} onChange={(id) => onChange(normalizePaymentMethod(id))} />
    </Field>
  );
}
