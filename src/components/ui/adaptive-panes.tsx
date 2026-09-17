import { useState, type ReactNode } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { PANE_GAP, tabletPaneWidths } from '@/design/adaptive-window';

interface AdaptivePanesProps {
  main: ReactNode;
  support?: ReactNode;
  singlePane?: 'stack' | 'main-only';
  singlePaneContent?: ReactNode;
  testID?: string;
}

/** Measures the space it actually owns, including when a tablet enters split screen. */
export function AdaptivePanes({
  main,
  support,
  singlePane = 'stack',
  singlePaneContent,
  testID,
}: AdaptivePanesProps) {
  const [containerWidth, setContainerWidth] = useState(0);
  const { main: mainWidth, support: supportWidth, twoPane } = tabletPaneWidths(containerWidth);

  const onLayout = (event: LayoutChangeEvent) => {
    const measured = event.nativeEvent.layout.width;
    setContainerWidth((previous) => previous === measured ? previous : measured);
  };

  return (
    <View onLayout={onLayout} style={styles.container} testID={testID}>
      {twoPane && support ? (
        <View style={styles.row}>
          <View style={[styles.pane, { width: mainWidth }]}>{main}</View>
          <View style={[styles.pane, { width: supportWidth }]}>{support}</View>
        </View>
      ) : singlePaneContent !== undefined ? (
        singlePaneContent
      ) : (
        <>
          <View style={styles.pane}>{main}</View>
          {singlePane === 'stack' && support ? <View style={styles.pane}>{support}</View> : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%', gap: PANE_GAP },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: PANE_GAP },
  pane: { gap: PANE_GAP, minWidth: 0 },
});
