import type { ReactNode } from 'react';

import { AdaptivePanes } from '@/components/ui/adaptive-panes';

interface FinanceAnalysisPanesProps {
  /** The decision or number the screen exists to explain. */
  primary: ReactNode;
  /** Evidence and controls that belong next to that decision on a wide window. */
  support: ReactNode;
  /** The original phone reading order, also used in a narrow tablet window. */
  compact: ReactNode;
}

/** Pane widths come from the measured content area, not the physical tablet size. */
export function FinanceAnalysisPanes({ primary, support, compact }: FinanceAnalysisPanesProps) {
  return <AdaptivePanes main={primary} support={support} singlePaneContent={compact} />;
}
