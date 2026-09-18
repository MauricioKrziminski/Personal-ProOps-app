import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { AdaptivePanes } from '@/components/ui/adaptive-panes';
import { Space } from '@/design/tokens';

interface ProfileTabletCanvasProps {
  account: ReactNode;
  settings: ReactNode;
}

/** Account context stays visible beside the controls that change it. */
export function ProfileTabletCanvas({ account, settings }: ProfileTabletCanvasProps) {
  return (
    <AdaptivePanes
      testID="profile-tablet-canvas"
      main={<View style={styles.column}>{account}</View>}
      support={<View style={styles.column}>{settings}</View>}
      singlePaneContent={<View style={styles.column}>{account}{settings}</View>}
    />
  );
}

const styles = StyleSheet.create({ column: { gap: Space.xl, minWidth: 0 } });
