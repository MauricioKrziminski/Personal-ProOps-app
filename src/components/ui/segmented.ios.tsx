import SegmentedControl from '@expo/ui/community/segmented-control';
import * as Haptics from 'expo-haptics';

import { HitTarget } from '@/design/tokens';
import { useScheme } from '@/hooks/use-theme';

type Option<T extends string> = { value: T; label: string };

interface SegmentedProps<T extends string> {
  options:
    | readonly [Option<T>, Option<T>]
    | readonly [Option<T>, Option<T>, Option<T>]
    | readonly [Option<T>, Option<T>, Option<T>, Option<T>];
  value: T;
  onChange: (value: T) => void;
}

/** Let the iOS Picker draw and animate the selection with the system's control material. */
export function Segmented<T extends string>({ options, value, onChange }: SegmentedProps<T>) {
  const scheme = useScheme();
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));

  return (
    <SegmentedControl
      values={options.map((option) => option.label)}
      selectedIndex={selectedIndex}
      appearance={scheme}
      style={{ minWidth: options.length * HitTarget, height: HitTarget }}
      onChange={({ nativeEvent }) => {
        const next = options[nativeEvent.selectedSegmentIndex];
        if (!next || next.value === value) return;
        void Haptics.selectionAsync();
        onChange(next.value);
      }}
    />
  );
}
