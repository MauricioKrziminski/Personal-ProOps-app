import { useState, type ReactNode } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { ConversationSidebar } from '@/components/agent/conversation-sidebar';
import { PANE_GAP, readingPaneWidths } from '@/design/adaptive-window';
import { Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

/** Keeps the thread mounted while an iPad window gains or loses its conversation index. */
export function ConversationWorkspace({
  selectedId,
  children,
}: {
  selectedId?: string;
  children: ReactNode;
}) {
  const theme = useTheme();
  const [availableWidth, setAvailableWidth] = useState(0);
  const panes = readingPaneWidths(availableWidth);
  const measure = (event: LayoutChangeEvent) => {
    const measured = event.nativeEvent.layout.width;
    setAvailableWidth((previous) => previous === measured ? previous : measured);
  };

  return (
    <View style={styles.workspace} onLayout={measure}>
      {panes.twoPane ? (
        <View style={[styles.sidebar, { width: panes.list, borderRightColor: theme.separator }]}>
          <ConversationSidebar selectedId={selectedId} />
        </View>
      ) : null}
      <View style={[styles.thread, { marginLeft: panes.twoPane ? PANE_GAP : 0 }]}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  workspace: { flex: 1, flexDirection: 'row' },
  sidebar: { borderRightWidth: StyleSheet.hairlineWidth, paddingRight: Space.sm },
  thread: { flex: 1, minWidth: 0 },
});
