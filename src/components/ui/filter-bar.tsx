import { StyleSheet, View } from 'react-native';

import { MudancaSuave } from '@/components/motion/presenca';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { useBRL, useConceal } from '@/components/ui/conceal';
import type { FilterSelect } from '@/components/ui/list-filters';
import { Space } from '@/design/tokens';
import { listFilterCount, listFilterDetails, type ListFiltersValue } from '@/lib/list-filters';

/** Um ponto de edição; texto explica o recorte sem repetir controles da folha. */
export function FilterBar({ value, onPress, selects, dateLabel, valueLabel, defaultLabel }: {
  value: ListFiltersValue; onPress: () => void; selects?: readonly FilterSelect[];
  dateLabel?: string; valueLabel?: string; defaultLabel: string;
}) {
  const brl = useBRL();
  const { concealed } = useConceal();
  const count = listFilterCount(value);
  const details = listFilterDetails(value, { selects, dateLabel, valueLabel, formatAmount: brl });
  const summary = [...details.slice(0, 2), ...(details.length > 2 ? [`mais ${details.length - 2}`] : [])].join(' · ') || defaultLabel;
  return <View style={styles.row}>
    <View style={styles.summary}>
      {/* Ocultar valores desmonta também a camada anterior do crossfade. */}
      <MudancaSuave key={String(concealed)} valor={summary}>
        <ThemedText type="small" themeColor="textSecondary" accessibilityLabel={details.join(' · ') || defaultLabel}>
          {summary}
        </ThemedText>
      </MudancaSuave>
    </View>
    <Button label={count ? `Filtros · ${count}` : 'Filtros'} icon="line.3.horizontal.decrease"
      variant={count ? 'primary' : 'secondary'} size="sm" onPress={onPress} />
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Space.md },
  summary: { flexGrow: 1, flexShrink: 1, flexBasis: 180, minWidth: 180 },
});
