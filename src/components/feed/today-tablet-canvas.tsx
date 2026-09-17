import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { AdaptivePanes } from '@/components/ui/adaptive-panes';
import { PANE_GAP } from '@/design/adaptive-window';

interface TodayTabletCanvasProps {
  hero: ReactNode;
  signals: ReactNode;
  pulse: ReactNode;
  actions: ReactNode;
  accounts: ReactNode;
  coming: ReactNode;
}

/** One set of real Today blocks, arranged by decision priority at the measured pane width. */
export function TodayTabletCanvas({
  hero,
  signals,
  pulse,
  actions,
  accounts,
  coming,
}: TodayTabletCanvasProps) {
  return (
    <AdaptivePanes
      testID="today-tablet-canvas"
      main={<View style={styles.column}>{hero}{pulse}{accounts}</View>}
      support={<View style={styles.column}>{signals}{actions}{coming}</View>}
      singlePaneContent={
        <View style={styles.column}>{hero}{signals}{pulse}{actions}{accounts}{coming}</View>
      }
    />
  );
}

const styles = StyleSheet.create({
  column: { gap: PANE_GAP, minWidth: 0 },
});
