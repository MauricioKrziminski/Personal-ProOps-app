import { StyleSheet, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { Presenca, TrocaSuave } from '@/components/motion/presenca';
import { AccountPicker, type PickableAccount } from '@/components/finance/account-picker';
import { Field, MoneyField, TextField } from '@/components/ui/field';
import { Segmented } from '@/components/ui/segmented';
import { SelectField } from '@/components/ui/select-field';
import { SwitchRow } from '@/components/ui/switch-row';
import { Space } from '@/design/tokens';
import { ACCOUNT_TYPES } from '@/lib/accounts';
import {
  accountDayValid,
  accountFormErrors,
  type AccountFormState,
  type AccountType,
} from '@/lib/account-form';

export interface AccountFormFieldsProps {
  form: AccountFormState;
  onChange: (form: AccountFormState) => void;
  accounts: readonly PickableAccount[];
  hasTransactions?: boolean;
  allowedTypes?: readonly AccountType[];
  disabled?: boolean;
  autoFocus?: boolean;
}

/** Same controlled fields for the account sheet and inline contextual creation. */
export function AccountFormFields({
  form,
  onChange,
  accounts,
  hasTransactions = false,
  allowedTypes,
  disabled = false,
  autoFocus = true,
}: AccountFormFieldsProps) {
  const errors = accountFormErrors(form);
  const change = (next: AccountFormState) => {
    if (!disabled) onChange(next);
  };
  const pagadoras = accounts.filter((a) => a.type !== 'credit_card' && a.id !== form.id);
  const podeNegativo = form.type === 'checking';
  return (
    <View style={styles.fields}>
      <Field label="Nome" obrigatorio>
        <TextField
          value={form.name}
          onChangeText={(name) => change({ ...form, name })}
          placeholder={form.type === 'credit_card' ? 'Ex.: Cartão do banco' : 'Ex.: Conta do banco'}
          accessibilityLabel={form.type === 'credit_card' ? 'Nome do cartão' : 'Nome da conta'}
          autoFocus={autoFocus}
          editable={!disabled}
          invalid={form.name.length > 0 && Boolean(errors.name)}
        />
      </Field>

      {/*
        `SelectField`, não `Segmented`: cinco rótulos não cabem numa linha.
        Medido a 384dp × fonte 1,3 — cada célula fica com ~62pt de texto e
        "Investimento" precisa de ~117, então a palavra partia no meio
        ("Investimen/to"), o que design.md §3 proíbe. `minWidth` não
        resolveria: não existe largura que caiba cinco células num sheet.

        De quebra o campo ganha o GLIFO por tipo, que é o que separa cartão
        de conta antes de qualquer texto — o mesmo motivo do `AccountPicker`.
      */}
      <Field
        label="Tipo"
        hint={
          hasTransactions
            ? form.type === 'credit_card'
              ? 'Com lançamentos, o cartão continua cartão'
              : 'Com lançamentos, a conta não vira cartão'
            : undefined
        }>
        <SelectField
          disabled={disabled}
          options={ACCOUNT_TYPES
            // Com lançamento, só dentro da mesma família: as compras do cartão moram em
            // faturas, e a conta não tem fatura (o banco recusa, com o motivo).
            .filter((t) => !allowedTypes || allowedTypes.includes(t.value))
            .filter(
              (t) => !hasTransactions || (t.value === 'credit_card') === (form.type === 'credit_card'),
            )
            .map((t) => ({
              id: t.value,
              label: t.label,
              icon: t.icon,
            }))}
          value={form.type}
          /* Nenhuma opção tem `id: null`, então o campo nunca devolve nulo. */
          onChange={(id) => change({ ...form, type: id as AccountType })}
          placeholder="Escolher tipo"
        />
      </Field>

      <TrocaSuave
        estado={form.type === 'credit_card' ? 'cartao' : 'conta'}
        style={styles.camposDoTipo}>
        {form.type === 'credit_card' ? (
          <>
            {/*
              ⚠️ **Valores antes do cronograma** (`frontend.md`: nome → tipo → valores →
              cronograma → conta). O limite ficava lá embaixo, depois do par fecha/vence e
              de três extras — ordem invertida, e diferente do ramo não-cartão do MESMO
              sheet, que é Nome → Tipo → Saldo inicial.
            */}
            <Field label="Limite do cartão" error={errors.limitCents}>
              <MoneyField
                readOnly={disabled}
                accessibilityLabel="Limite do cartão em reais"
                valueCents={form.limitCents}
                onChangeCents={(limitCents) => change({ ...form, limitCents })}
              />
            </Field>

            <View style={styles.diaRow}>
              <View style={styles.diaCampo}>
                <Field
                  label="Fecha dia"
                  obrigatorio
                  error={form.closingDay && !accountDayValid(form.closingDay) ? 'De 1 a 31' : undefined}
                  // Editando: as faturas abertas se refazem com os dias novos (`20260926170000`);
                  // a dica vale para os dois dias e para a chave logo abaixo, e aparece UMA vez.
                  hint={form.id ? 'Mudar os dias refaz as faturas em aberto' : undefined}>
                  <TextField
                    editable={!disabled}
                    value={form.closingDay}
                    onChangeText={(v) =>
                      change({ ...form, closingDay: v.replace(/\D/g, '').slice(0, 2) })
                    }
                    placeholder="Ex.: 28"
                    keyboardType="number-pad"
                  />
                </Field>
              </View>
              <View style={styles.diaCampo}>
                <Field
                  label="Vence dia"
                  obrigatorio
                  error={form.dueDay && !accountDayValid(form.dueDay) ? 'De 1 a 31' : undefined}>
                  <TextField
                    editable={!disabled}
                    value={form.dueDay}
                    onChangeText={(v) =>
                      change({ ...form, dueDay: v.replace(/\D/g, '').slice(0, 2) })
                    }
                    placeholder="Ex.: 5"
                    keyboardType="number-pad"
                  />
                </Field>
              </View>
            </View>
            <Presenca visivel={!form.id && Boolean(errors.closingDay || errors.dueDay)}>
              <ThemedText type="footnote" themeColor="textSecondary">
                Informe fechamento e vencimento, de 1 a 31, para criar o cartão.
              </ThemedText>
            </Presenca>

            {/*
              ⚠️ **Aqui havia uma AFIRMAÇÃO, e ela era chute de um emissor só.**

              A frase era "Compra depois do fechamento cai na fatura do mês seguinte" e o
              código cravava `<` (a compra DO dia já é da próxima) desde a `20260909050000`
              — medido contra duas faturas reais do Nubank. Pesquisado em 11/09/2026, não
              é padrão: o Mobills escreve "a partir do dia de fechamento entra na
              seguinte", a Serasa escreve "antes ou NO DIA EXATO entram na fatura do mês
              atual", e diz que depende do horário e do sistema da instituição.

              Sem padrão, quem sabe é o dono do cartão. O default é o que já valia, então
              ninguém acorda com a fatura remontada.
            */}
            <Field label="Compra no dia do fechamento">
              <View pointerEvents={disabled ? 'none' : 'auto'} accessibilityState={{ disabled }}>
                <Segmented
                  value={form.fechamentoInclusivo ? 'atual' : 'seguinte'}
                  onChange={(v) =>
                    change({ ...form, fechamentoInclusivo: v === 'atual' })
                  }
                  options={[
                    { value: 'seguinte', label: 'Na próxima' },
                    { value: 'atual', label: 'Nesta fatura' },
                  ]}
                />
              </View>
            </Field>

            {/*
              O rotativo, e por que ele nasce DESLIGADO.
              Ligado para todo cartão, um que a pessoa paga em dia nunca mais apareceria
              como atrasado — o aviso que mais importa sumiria justamente de quem não
              precisa da feature. Por isso é escolha, e é aqui: junto do ciclo, que é o
              outro campo que só existe em cartão.
            */}
            <SwitchRow
              disabled={disabled}
              label="Adiar fatura vencida sozinho"
              value={form.rotativoAuto}
              onValueChange={(rotativoAuto: boolean) => change({ ...form, rotativoAuto })}
            />

            <Field
              label="Juros do rotativo (% ao mês)"
              error={
                form.rotativoRate.trim() && errors.rotativoRate
                  ? 'Use um número de 0 a 100, como 15,5'
                  : undefined
              }>
              <TextField
                editable={!disabled}
                value={form.rotativoRate}
                onChangeText={(rotativoRate) =>
                  change({ ...form, rotativoRate: rotativoRate.replace(/[^\d,.]/g, '').slice(0, 6) })
                }
                keyboardType="decimal-pad"
                placeholder="Ex.: 15,5"
              />
            </Field>

            <Field label="Conta que paga a fatura">
              {/*
                `AccountPicker`, não uma `Section` de `Row` com checkmark:
                era a sexta implementação do mesmo campo no app, e ela nasce
                ABERTA — com seis contas, meia tela antes de o usuário pedir
                qualquer coisa. O seletor é o mesmo de todo lugar que escolhe
                conta, colapsado e com o glifo por tipo.
              */}
              <AccountPicker financialContext
                disabled={disabled}
                accounts={pagadoras}
                value={form.payerId}
                onChange={(payerId) => change({ ...form, payerId })}
                emptyLabel="Escolher na hora de pagar"
              />
            </Field>
          </>
        ) : (
          <Field label={form.id && !form.base ? 'Saldo inicial' : 'Saldo atual'} error={errors.saldoCents}>
            <MoneyField
              readOnly={disabled}
              accessibilityLabel="Saldo da conta em reais"
              valueCents={form.saldoCents}
              onChangeCents={(saldoCents) => change({ ...form, saldoCents })}
            />
            <Presenca visivel={podeNegativo}>
              <View pointerEvents={disabled ? 'none' : 'auto'} accessibilityState={{ disabled }}>
                <Segmented
                  value={form.negativo ? 'negativo' : 'positivo'}
                  onChange={(v) => change({ ...form, negativo: v === 'negativo' })}
                  options={[
                    { value: 'positivo', label: 'Positivo' },
                    { value: 'negativo', label: 'No vermelho' },
                  ]}
                />
              </View>
            </Presenca>
          </Field>
        )}
      </TrocaSuave>
    </View>
  );
}

const styles = StyleSheet.create({
  fields: { gap: Space.xl },
  camposDoTipo: { gap: Space.xl },
  diaRow: { flexDirection: 'row', gap: Space.lg },
  diaCampo: { flex: 1 },
});
