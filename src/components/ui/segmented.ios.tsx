import { SegmentedControl } from '@expo/ui/community/segmented-control';
import { StyleSheet } from 'react-native';

import { useScheme } from '@/hooks/use-theme';
import type { SegmentedProps } from './segmented.types';

/** O Picker segmentado do sistema controla o gesto e o Liquid Glass no iOS 26. */
export function Segmented<T extends string>({ options, value, onChange }: SegmentedProps<T>) {
  const scheme = useScheme();
  return (
    <SegmentedControl
      values={options.map((option) => option.label)}
      selectedIndex={Math.max(0, options.findIndex((option) => option.value === value))}
      appearance={scheme}
      style={styles.native}
      onChange={({ nativeEvent }) => {
        const next = options[nativeEvent.selectedSegmentIndex];
        if (next && next.value !== value) onChange(next.value);
      }}
    />
  );
}

const styles = StyleSheet.create({
  native: { width: '100%', height: 50 },
});
