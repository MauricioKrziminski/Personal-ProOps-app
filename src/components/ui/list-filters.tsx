import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { DatePickerField } from '@/components/finance/date-picker-field';
import { Chip } from '@/components/finance/chip';
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
export type FilterMultiSelect = { key: string; label: string; options: readonly { id: string; label: string }[] };
type Props = {
  visible: boolean; value: ListFiltersValue; onClose: () => void; onApply: (value: ListFiltersValue) => void;
  selects?: readonly FilterSelect[];
  multiSelects?: readonly FilterMultiSelect[];
  dateLabels?: { from: string; to: string }; showDates?: boolean; showSearch?: boolean; showValues?: boolean;
  valueLabel?: string; resetDatesLabel?: string;
};
/** Rascunho por abertura: fechar/arrastar cancela, só Aplicar altera a consulta. */
export function ListFilters(props: Props) {
  return <Sheet visible={props.visible} onClose={props.onClose}>
    {props.visible ? <FiltersEditor {...props} /> : null}
  </Sheet>;
}
function FiltersEditor({ value, onClose, onApply, selects = [], multiSelects = [], dateLabels = { from: 'Data a partir de', to: 'Data até' }, showDates = true,
  showSearch = true, showValues = false, valueLabel = 'Valor do lançamento', resetDatesLabel }: Props) {
  const [draft, setDraft] = useState<ListFiltersValue>(() => ({ ...value, selections: { ...value.selections },
    ...(value.multiSelections ? { multiSelections: Object.fromEntries(Object.entries(value.multiSelections).map(([key, ids]) => [key, [...ids]])) } : {}),
  }));
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
      {multiSelects.map(select => <Field key={select.key} label={select.label}>
        <View style={styles.options}>
          <Chip label="Todos" selected={!draft.multiSelections?.[select.key]?.length}
            onPress={() => setDraft(current => ({ ...current, multiSelections: { ...current.multiSelections, [select.key]: [] } }))} />
          {select.options.map(option => <Chip key={option.id} label={option.label}
            selected={Boolean(draft.multiSelections?.[select.key]?.includes(option.id))}
            onPress={() => setDraft(current => {
              const selected = new Set(current.multiSelections?.[select.key]);
              if (selected.has(option.id)) selected.delete(option.id); else selected.add(option.id);
              return { ...current, multiSelections: { ...current.multiSelections,
                [select.key]: select.options.filter(item => selected.has(item.id)).map(item => item.id) } };
            })} />)}
        </View>
      </Field>)}
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
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.md },
  // O reset aparece sem deslocar os campos; o texto continua crescendo com a fonte nativa.
  dateReset: { width: HitTarget - 8, minHeight: HitTarget - 8, justifyContent: 'center' },
});
