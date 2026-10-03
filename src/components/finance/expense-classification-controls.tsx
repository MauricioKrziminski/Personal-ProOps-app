import { Field } from '@/components/ui/field';
import { SelectField, type SelectOption } from '@/components/ui/select-field';
import {
  EXPENSE_NECESSITIES,
  EXPENSE_NECESSITY_LABELS,
  EXPENSE_PATTERNS,
  EXPENSE_PATTERN_LABELS,
  type ExpenseNecessity,
  type ExpensePattern,
} from '@/lib/expense-classification';

const PATTERN_OPTIONS: readonly SelectOption[] = [
  { id: null, label: 'Não classificar', neutral: true },
  ...EXPENSE_PATTERNS.map((id) => ({ id, label: EXPENSE_PATTERN_LABELS[id] })),
];

const NECESSITY_OPTIONS: readonly SelectOption[] = [
  { id: null, label: 'Não classificar', neutral: true },
  ...EXPENSE_NECESSITIES.map((id) => ({ id, label: EXPENSE_NECESSITY_LABELS[id] })),
];

/** Shared choices; parents own classification sources, category defaults and spacing. */
export function ExpenseClassificationControls({ pattern, necessity, onPatternChange, onNecessityChange }: {
  pattern: ExpensePattern | null;
  necessity: ExpenseNecessity | null;
  onPatternChange: (pattern: ExpensePattern | null) => void;
  onNecessityChange: (necessity: ExpenseNecessity | null) => void;
}) {
  return (
    <>
      <Field label="Previsibilidade" hint="Fixo é previsível; variável pode mudar. Isso não define a repetição.">
        <SelectField options={PATTERN_OPTIONS} value={pattern} onChange={(id) => {
          if (id === null || id === 'fixed' || id === 'variable') onPatternChange(id);
        }} />
      </Field>
      <Field label="Necessidade" hint="Essencial ou não essencial depende das suas necessidades, não da frequência.">
        <SelectField options={NECESSITY_OPTIONS} value={necessity} onChange={(id) => {
          if (id === null || id === 'essential' || id === 'discretionary') onNecessityChange(id);
        }} />
      </Field>
    </>
  );
}
