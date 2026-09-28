import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card } from '@/components/ui/card';
import { Money } from '@/components/ui/money';
import { Row } from '@/components/ui/row';
import { Space } from '@/design/tokens';
import { formatDateBR } from '@/hooks/use-items';
import { useTheme } from '@/hooks/use-theme';
import type { ExpectedLedgerLine } from '@/lib/ledger-expected';

function expectationLabel(line: ExpectedLedgerLine, today: string): string {
  if (line.origin === 'debt_estimate') return 'Parcela informada como paga · sem lançamento';
  if (line.due_date < today) {
    return line.inferred_start
      ? 'Estimativa retroativa · sem registro'
      : 'Vencimento anterior · sem registro';
  }
  return line.origin === 'debt_schedule' ? 'Parcela prevista' : 'Ocorrência prevista';
}

/** Calculated dates are deliberately separate from the ledger and its actual totals/actions. */
export function ExpectedLedgerLines({ lines, today }: {
  lines: readonly ExpectedLedgerLine[];
  today: string;
}) {
  const theme = useTheme();
  if (!lines.length) return null;
  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <ThemedText type="headline">Previstos sem lançamento</ThemedText>
        <ThemedText type="footnote" themeColor="textSecondary">
          Calculados pela recorrência ou pelo contrato. Não são pagamentos registrados.
        </ThemedText>
      </View>
      {lines.map((line) => (
        <View
          key={`${line.origin}:${line.ref_id}:${line.due_date}`}
          style={[styles.line, { borderColor: theme.separator }]}>
          <Row
            title={line.description}
            inlineValue
            badge={{ label: line.due_date < today ? 'sem registro' : 'previsto' }}
            subtitle={`${formatDateBR(line.due_date)} · ${expectationLabel(line, today)}${line.installment_no ? ` · parcela ${line.installment_no}${line.installments_total ? `/${line.installments_total}` : ''}` : ''}`}
            trailing={<Money cents={line.kind === 'expense' ? -line.amount_cents : line.amount_cents} variant="ticker" signed />}
          />
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { paddingHorizontal: 0, paddingVertical: Space.sm, gap: 0 },
  header: { paddingHorizontal: Space.lg, paddingVertical: Space.sm, gap: Space.xs },
  line: { borderTopWidth: StyleSheet.hairlineWidth },
});
