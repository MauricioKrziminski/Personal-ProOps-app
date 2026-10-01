import { AccountPicker } from '@/components/finance/account-picker';
import { DatePickerField } from '@/components/finance/date-picker-field';
import { Presenca } from '@/components/motion/presenca';
import { Field, MoneyField } from '@/components/ui/field';
import { SwitchRow } from '@/components/ui/switch-row';
import { localISODate } from '@/lib/dates';
import { downPaymentError, type DownPaymentForm } from '@/lib/down-payment';
import { View } from 'react-native';
import { Space } from '@/design/tokens';
import { useState } from 'react';

export function DownPaymentFields({ enabled, onEnabled, value, onChange, accounts, error, showToggle = true }: {
  enabled: boolean;
  onEnabled: (enabled: boolean) => void;
  value: DownPaymentForm;
  onChange: (value: DownPaymentForm) => void;
  accounts: Parameters<typeof AccountPicker>[0]['accounts'];
  error?: string;
  showToggle?: boolean;
}) {
  const [revisado, setRevisado] = useState({ enabled, amount: false, account: false, date: false });
  // Reativar mantém o rascunho, mas não trata um campo recém-aberto como já revisado.
  if (revisado.enabled !== enabled) setRevisado({ enabled, amount: false, account: false, date: false });
  const invalid = enabled ? downPaymentError(value, localISODate()) : undefined;
  // Um limite imposto pelo total precisa explicar o bloqueio, mesmo se a entrada
  // já preenchida acabou de ser reativada. Só o vazio depende da revisão do campo.
  const erroValor = revisado.amount && value.amountCents <= 0
    ? 'Informe o valor da entrada'
    : value.amountCents > 0 && error && error !== invalid ? error : undefined;
  return <View>
    {showToggle ? <SwitchRow label="Paguei uma entrada" value={enabled} onValueChange={onEnabled} /> : null}
    <Presenca visivel={enabled} preparar imediata>
      <View style={{ gap: Space.lg, paddingTop: showToggle ? Space.lg : 0 }}>
      <Field label="Entrada" error={erroValor}>
        <MoneyField valueCents={value.amountCents} onChangeCents={(amountCents) => onChange({ ...value, amountCents })}
          onBlur={() => setRevisado((r) => ({ ...r, amount: true }))}
          accessibilityLabel="Valor da entrada" invalid={Boolean(erroValor)} />
      </Field>
      <Field label="Conta da entrada" error={revisado.account && !value.accountId ? 'Escolha a conta da entrada' : undefined}>
        <AccountPicker accounts={accounts} value={value.accountId} onChange={(accountId) => {
          setRevisado((r) => ({ ...r, account: true })); onChange({ ...value, accountId });
        }}
          placeholder="Escolher a conta da entrada" />
      </Field>
      <Field label="Data da entrada" error={revisado.date && value.accountId && value.amountCents > 0 ? invalid : undefined}>
        <DatePickerField value={value.dateBR} onChange={(dateBR) => {
          setRevisado((r) => ({ ...r, date: true })); onChange({ ...value, dateBR });
        }}
          max={localISODate()} accessibilityLabel="Data da entrada" />
      </Field>
      </View>
    </Presenca>
  </View>;
}
