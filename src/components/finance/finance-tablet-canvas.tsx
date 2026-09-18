import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { AdaptivePanes } from '@/components/ui/adaptive-panes';
import { PANE_GAP } from '@/design/adaptive-window';

interface FinanceTabletCanvasProps {
  cycle: ReactNode;
  actions: ReactNode;
  ledger: ReactNode;
  breakdown: ReactNode;
}

/** Keeps one instance of each finance block while the measured canvas changes shape. */
export function FinanceTabletCanvas({ cycle, actions, ledger, breakdown }: FinanceTabletCanvasProps) {
  return (
    <AdaptivePanes
      testID="finance-tablet-canvas"
      main={<View style={styles.column}>{cycle}{ledger}</View>}
      support={<View style={styles.column}>{actions}{breakdown}</View>}
      singlePaneContent={<View style={styles.column}>{cycle}{actions}{ledger}{breakdown}</View>}
    />
  );
}

const styles = StyleSheet.create({
  column: { gap: PANE_GAP, minWidth: 0 },
});
