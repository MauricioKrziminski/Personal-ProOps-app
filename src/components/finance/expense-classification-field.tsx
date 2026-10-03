import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ExpenseClassificationControls } from '@/components/finance/expense-classification-controls';
import { Presenca } from '@/components/motion/presenca';
import { Icon } from '@/components/ui/icon';
import { Row } from '@/components/ui/row';
import { Space } from '@/design/tokens';
import {
  EXPENSE_NECESSITY_LABELS,
  EXPENSE_PATTERN_LABELS,
  expenseClassificationSummary,
  selectExpenseClassification,
  type ExpenseClassification,
  type ExpenseClassificationDefaults,
} from '@/lib/expense-classification';

/** Controlled expense metadata; the parent owns category snapshots and writes. */
export function ExpenseClassificationField({ value, onChange, defaults, onUseCategoryDefaults }: {
  value: ExpenseClassification;
  onChange: (value: ExpenseClassification) => void;
  defaults?: ExpenseClassificationDefaults;
  onUseCategoryDefaults?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const patternLabel = value.expense_pattern === null ? 'Não classificar' : EXPENSE_PATTERN_LABELS[value.expense_pattern];
  const necessityLabel = value.expense_necessity === null ? 'Não classificar' : EXPENSE_NECESSITY_LABELS[value.expense_necessity];
  const hasCategoryDefaults = defaults?.default_expense_pattern != null || defaults?.default_expense_necessity != null;

  return (
    <View>
      {/* Row supplies its own inset; compensate so its text aligns with sibling Field labels. */}
      <View style={styles.row}>
        <Row
          title="Classificação"
          subtitle={expenseClassificationSummary(value)}
          chevron={false}
          trailing={<Icon name={expanded ? 'chevron.up' : 'chevron.down'} size="sm" color="textSecondary" />}
          accessibilityLabel={`Classificação. Previsibilidade: ${patternLabel}. Necessidade: ${necessityLabel}.`}
          accessibilityState={{ expanded }}
          onPress={() => setExpanded((current) => !current)}
        />
      </View>
      {/* Interactive fields keep natural geometry; motion never gates their availability. */}
      <Presenca visivel={expanded} imediata style={styles.fields}>
        <ExpenseClassificationControls
          pattern={value.expense_pattern}
          necessity={value.expense_necessity}
          onPatternChange={(pattern) => onChange(selectExpenseClassification(value, 'pattern', pattern))}
          onNecessityChange={(necessity) => onChange(selectExpenseClassification(value, 'necessity', necessity))}
        />
        {onUseCategoryDefaults && hasCategoryDefaults ? (
          <View style={styles.row}>
            <Row title="Usar padrão da categoria" chevron={false} onPress={onUseCategoryDefaults} />
          </View>
        ) : null}
      </Presenca>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { marginHorizontal: -Space.lg },
  fields: { gap: Space.xl, paddingTop: Space.md },
});
