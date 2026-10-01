import { AccountPicker } from '@/components/finance/account-picker';
import { DatePickerField } from '@/components/finance/date-picker-field';
import { Presenca } from '@/components/motion/presenca';
import { Field, MoneyField } from '@/components/ui/field';
import { SwitchRow } from '@/components/ui/switch-row';
import { localISODate } from '@/lib/dates';
import { downPaymentError, type DownPaymentForm } from '@/lib/down-payment';
import { View } from 'react-native';
import { Space } from '@/design/tokens';

export function DownPaymentFields({ enabled, onEnabled, value, onChange, accounts, error, showToggle = true }: {
  enabled: boolean;
  onEnabled: (enabled: boolean) => void;
  value: DownPaymentForm;
  onChange: (value: DownPaymentForm) => void;
  accounts: Parameters<typeof AccountPicker>[0]['accounts'];
  error?: string;
  showToggle?: boolean;
}) {
  const invalid = enabled ? downPaymentError(value, localISODate()) : undefined;
  return <>
    {showToggle ? <SwitchRow label="Paguei uma entrada" value={enabled} onValueChange={onEnabled} /> : null}
    <Presenca visivel={enabled}>
      <View style={{ gap: Space.lg }}>
      <Field label="Entrada" error={error && error !== invalid ? error : (invalid === 'Informe o valor da entrada' ? invalid : undefined)}>
        <MoneyField valueCents={value.amountCents} onChangeCents={(amountCents) => onChange({ ...value, amountCents })}
          accessibilityLabel="Valor da entrada" invalid={Boolean(error) || value.amountCents <= 0} />
      </Field>
      <Field label="Conta da entrada" error={!value.accountId ? 'Escolha a conta da entrada' : undefined}>
        <AccountPicker accounts={accounts} value={value.accountId} onChange={(accountId) => onChange({ ...value, accountId })}
          placeholder="Escolher a conta da entrada" />
      </Field>
      <Field label="Data da entrada" error={value.accountId && value.amountCents > 0 ? invalid : undefined}>
        <DatePickerField value={value.dateBR} onChange={(dateBR) => onChange({ ...value, dateBR })}
          max={localISODate()} accessibilityLabel="Data da entrada" />
      </Field>
      </View>
    </Presenca>
  </>;
}
