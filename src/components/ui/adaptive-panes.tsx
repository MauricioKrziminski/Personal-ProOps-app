import { useState, type ReactNode } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { PANE_GAP, readingPaneWidths, tabletPaneWidths } from '@/design/adaptive-window';

interface AdaptivePanesProps {
  main: ReactNode;
  support?: ReactNode;
  singlePane?: 'stack' | 'main-only';
  singlePaneContent?: ReactNode;
  variant?: 'main-support' | 'library-reading';
  fill?: boolean;
  testID?: string;
}

/** Measures the space it actually owns, including when a tablet enters split screen. */
export function AdaptivePanes({
  main,
  support,
  singlePane = 'stack',
  singlePaneContent,
  variant = 'main-support',
  fill = false,
  testID,
}: AdaptivePanesProps) {
  const [containerWidth, setContainerWidth] = useState(0);
  const regular = tabletPaneWidths(containerWidth);
  const library = readingPaneWidths(containerWidth);
  const mainWidth = variant === 'library-reading' ? library.list : regular.main;
  const supportWidth = variant === 'library-reading' ? library.reading : regular.support;
  const twoPane = variant === 'library-reading' ? library.twoPane : regular.twoPane;

  const onLayout = (event: LayoutChangeEvent) => {
    const measured = event.nativeEvent.layout.width;
    setContainerWidth((previous) => previous === measured ? previous : measured);
  };

  return (
    <View onLayout={onLayout} style={[styles.container, fill && styles.fill]} testID={testID}>
      {twoPane && support ? (
        <View style={[styles.row, fill && styles.fill]}>
          <View style={[styles.pane, fill && styles.fillPane, { width: mainWidth }]}>{main}</View>
          <View style={[styles.pane, fill && styles.fillPane, { width: supportWidth }]}>{support}</View>
        </View>
      ) : singlePaneContent !== undefined ? (
        singlePaneContent
      ) : (
        <>
          <View style={[styles.pane, fill && styles.fill]}>{main}</View>
          {singlePane === 'stack' && support ? <View style={styles.pane}>{support}</View> : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%', gap: PANE_GAP },
  fill: { flex: 1 },
  fillPane: { height: '100%' },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: PANE_GAP },
  pane: { gap: PANE_GAP, minWidth: 0 },
});
