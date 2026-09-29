import { View, StyleSheet } from 'react-native';

import { AccountPicker, type PickableAccount } from '@/components/finance/account-picker';
import { Calendar } from '@/components/finance/calendar';
import { Field, MoneyField } from '@/components/ui/field';
import { Note } from '@/components/ui/note';
import { QuantityField } from '@/components/ui/quantity-field';
import { Segmented } from '@/components/ui/segmented';
import { SelectField, type SelectOption } from '@/components/ui/select-field';
import { Space } from '@/design/tokens';
import { localISODate } from '@/lib/dates';
import type { Forma, Hipotese, Repete } from '@/lib/hipotese';

/**
 * A forma é `SelectField`, não `Segmented`: com quatro opções "Financiamento" não cabe num quarto
 * da largura e saía "Financiame…" no iPhone já na fonte padrão (29/09/2026).
 */
const FORMAS_SAI = [
  { id: 'uma', label: 'Uma vez', icon: 'calendar' },
  { id: 'parcelado', label: 'Parcelado', icon: 'list.number' },
  { id: 'repete', label: 'Repete', icon: 'arrow.triangle.2.circlepath' },
  { id: 'financiamento', label: 'Financiamento', icon: 'building.columns' },
] as const satisfies readonly (SelectOption & { id: Forma })[];
const FORMAS_ENTRA = FORMAS_SAI.filter((f) => f.id === 'uma' || f.id === 'repete');
const REPETE = [
  { value: 'weekly', label: 'Toda semana' },
  { value: 'monthly', label: 'Todo mês' },
  { value: 'yearly', label: 'Todo ano' },
] as const satisfies readonly { value: Repete; label: string }[];

/**
 * Os campos da hipótese do "E se…?" (spec 2026-09-29, §2): o que o detalhe por conta precisa
 * para estar CERTO, e nada mais — título, categoria e o resto ficam para o formulário completo do
 * "Aplicar". A ordem é a da régua (`frontend.md`): o que muda QUAIS campos existem vem antes.
 */
export function CamposDaHipotese({
  valor: h,
  onChange,
  contas,
  max,
}: {
  valor: Hipotese;
  onChange: (h: Hipotese) => void;
  contas: readonly PickableAccount[];
  /** O último dia que a projeção alcança (ISO). */
  max: string;
}) {
  const formas = h.kind === 'income' ? FORMAS_ENTRA : FORMAS_SAI;
  const set = (parcial: Partial<Hipotese>) => onChange({ ...h, ...parcial });
  // Financiamento sai de CONTA (a dívida tem a conta que paga); cartão não paga financiamento.
  const opcoesDeConta = h.forma === 'financiamento' ? contas.filter((c) => c.type !== 'credit_card') : contas;
  const contaObrigatoria = h.forma === 'parcelado' || h.forma === 'financiamento';

  return (
    <View style={styles.campos}>
      <Field label="Tipo">
        <Segmented
          options={[
            { value: 'expense', label: 'Sai' },
            { value: 'income', label: 'Entra' },
          ]}
          value={h.kind}
          onChange={(kind) =>
            // A forma que o outro lado não tem volta a "Uma vez" — nunca uma receita "parcelada".
            set({ kind, forma: (kind === 'income' ? FORMAS_ENTRA : FORMAS_SAI).some((f) => f.id === h.forma) ? h.forma : 'uma' })}
        />
      </Field>

      <Field label="Como">
        <SelectField
          options={formas}
          value={h.forma}
          placeholder="Escolher"
          onChange={(id) => {
            const forma = (id ?? 'uma') as Forma;
            set({ forma, conta: forma === 'financiamento' && contas.find((c) => c.id === h.conta)?.type === 'credit_card' ? null : h.conta });
          }}
        />
      </Field>

      <Field label={h.forma === 'parcelado' ? 'Valor total' : h.forma === 'financiamento' ? 'Valor da parcela' : h.forma === 'repete' ? 'Valor de cada vez' : 'Valor'}>
        <MoneyField valueCents={h.valor_cents} onChangeCents={(valor_cents) => set({ valor_cents })} />
      </Field>

      {h.forma === 'parcelado' || h.forma === 'financiamento' ? (
        <Field label="Parcelas">
          <QuantityField
            value={h.parcelas}
            min={h.forma === 'parcelado' ? 2 : 1}
            max={h.forma === 'parcelado' ? 72 : 480}
            accessibilityLabel="Parcelas"
            onChange={(parcelas) => set({ parcelas })}
          />
        </Field>
      ) : null}

      {h.forma === 'repete' ? (
        <Field label="Repete">
          <Segmented options={REPETE} value={h.repete} onChange={(repete) => set({ repete })} />
        </Field>
      ) : null}

      <Field label={h.forma === 'financiamento' ? 'Conta que paga' : 'Conta ou cartão'}>
        <AccountPicker
          accounts={opcoesDeConta}
          value={h.conta}
          onChange={(conta) => set({ conta })}
          emptyLabel={contaObrigatoria ? undefined : 'Sem conta'}
        />
      </Field>
      {h.conta === null && !contaObrigatoria ? (
        <Note icon="info.circle">Sem conta, a hipótese só muda a visão geral.</Note>
      ) : null}

      <Field label={h.forma === 'financiamento' ? 'Primeira parcela' : h.forma === 'uma' ? 'Data' : 'A partir de'}>
        <Calendar value={h.data} onChange={(data) => set({ data })} min={localISODate()} max={max} />
      </Field>
    </View>
  );
}

const styles = StyleSheet.create({
  campos: { gap: Space.lg },
});
