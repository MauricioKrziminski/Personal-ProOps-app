import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { DatePickerField } from '@/components/finance/date-picker-field';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { HeaderIconButton } from '@/components/ui/app-header';
import { Field, MoneyField, TextField } from '@/components/ui/field';
import { SelectField, type SelectOption } from '@/components/ui/select-field';
import { Sheet, SheetScroll } from '@/components/ui/sheet';
import { SwitchRow } from '@/components/ui/switch-row';
import { TaskHeader } from '@/components/ui/task-header';
import { HitTarget, Space } from '@/design/tokens';
import { brToISO, isoToBR } from '@/lib/dates';
import { listFilterError, type ListFiltersValue } from '@/lib/list-filters';

export type FilterSelect = { key: string; label: string; options: readonly SelectOption[] };
type Props = {
  visible: boolean; value: ListFiltersValue; onClose: () => void; onApply: (value: ListFiltersValue) => void;
  selects?: readonly FilterSelect[];
  dateLabels?: { from: string; to: string }; showDates?: boolean; showSearch?: boolean; showValues?: boolean;
  valueLabel?: string; resetDatesLabel?: string;
};
/** Rascunho por abertura: fechar/arrastar cancela, só Aplicar altera a consulta. */
export function ListFilters(props: Props) {
  return <Sheet visible={props.visible} onClose={props.onClose}>
    {props.visible ? <FiltersEditor {...props} /> : null}
  </Sheet>;
}
function FiltersEditor({ value, onClose, onApply, selects = [], dateLabels = { from: 'Data a partir de', to: 'Data até' }, showDates = true,
  showSearch = true, showValues = false, valueLabel = 'Valor do lançamento', resetDatesLabel }: Props) {
  const [draft, setDraft] = useState<ListFiltersValue>(() => ({ ...value, selections: { ...value.selections } }));
  const dateError = listFilterError({ from: draft.from, to: draft.to });
  const valueError = listFilterError({ minCents: draft.minCents, maxCents: draft.maxCents });
  const error = dateError ?? valueError;
  const apply = () => { if (!error) { onApply(draft); onClose(); } };
  return <>
    <TaskHeader title="Filtros" onClose={onClose} action={<Button label="Aplicar" size="sm" disabled={Boolean(error)} onPress={apply} />} />
    <SheetScroll contentContainerStyle={styles.body}>
      <Button label="Limpar filtros" variant="secondary" size="sm" onPress={() => setDraft({})} />
      {showSearch ? <Field label="Buscar"><TextField value={draft.q ?? ''} onChangeText={(q) => setDraft({ ...draft, q })}
        placeholder="Buscar por texto" accessibilityLabel="Texto do filtro" autoCorrect={false} autoCapitalize="none" /></Field> : null}
      {showDates ? <View style={styles.group}>
        <FilterDateField label={dateLabels.from} value={draft.from} onChange={(from) => setDraft({ ...draft, from })}
          accessory={<View style={styles.dateReset}>{draft.from || draft.to ? <HeaderIconButton icon="arrow.counterclockwise" label={resetDatesLabel ?? 'Limpar datas'}
            hint="Remove as duas datas. Os outros filtros são mantidos."
            onPress={() => setDraft({ ...draft, from: undefined, to: undefined })} /> : null}</View>} />
        <FilterDateField label={dateLabels.to} value={draft.to} error={dateError} onChange={(to) => setDraft({ ...draft, to })} />
      </View> : null}
      {selects.map(select => <Field key={select.key} label={select.label}>
        <SelectField value={draft.selections?.[select.key] || null}
          placeholder="Escolher filtro"
          options={[{ id: null, label: 'Todos' }, ...select.options]}
          onChange={(id) => setDraft({ ...draft, selections: { ...draft.selections, [select.key]: id ?? '' } })} />
      </Field>)}
      {showValues ? <View style={styles.group}>
        <ThemedText type="small" themeColor="textSecondary">{valueLabel}</ThemedText>
        <SwitchRow label="Valor mínimo" value={draft.minCents !== undefined}
          onValueChange={(enabled) => setDraft({ ...draft, minCents: enabled ? 0 : undefined })} />
        {draft.minCents !== undefined ? <MoneyField valueCents={draft.minCents} accessibilityLabel="Valor mínimo do filtro"
          onChangeCents={(minCents) => setDraft({ ...draft, minCents })} /> : null}
        <SwitchRow label="Valor máximo" value={draft.maxCents !== undefined}
          onValueChange={(enabled) => setDraft({ ...draft, maxCents: enabled ? 0 : undefined })} />
        {draft.maxCents !== undefined ? <MoneyField valueCents={draft.maxCents} accessibilityLabel="Valor máximo do filtro"
          onChangeCents={(maxCents) => setDraft({ ...draft, maxCents })} /> : null}
      </View> : null}
      {valueError ? <ThemedText type="small" themeColor="danger" accessibilityRole="alert">{valueError}</ThemedText> : null}
    </SheetScroll>
  </>;
}
function FilterDateField({ label, value, error, onChange, accessory }: {
  label: string; value?: string; error?: string; onChange: (iso?: string) => void; accessory?: React.ReactNode;
}) {
  return <Field label={label} labelAccessory={accessory} labelGap={Space.lg}
    error={error ? <ThemedText type="footnote" themeColor="danger" accessibilityRole="alert">{error}</ThemedText> : undefined}>
    <DatePickerField value={value ? isoToBR(value) : null} accessibilityLabel={label}
      onChange={(br) => onChange(brToISO(br))} />
  </Field>;
}
const styles = StyleSheet.create({ body: { padding: Space.lg, gap: Space.xl }, group: { gap: Space.lg },
  // O reset aparece sem deslocar os campos; o texto continua crescendo com a fonte nativa.
  dateReset: { width: HitTarget - 8, minHeight: HitTarget - 8, justifyContent: 'center' },
});
