import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth } from '@/constants/theme';
import { Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

/** O assunto inteiro fica legível fora do título curto da navegação nativa. */
export const AgentThreadHeading = memo(function AgentThreadHeading({ title }: { title: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.root, { borderBottomColor: theme.separator }]}>
      <View style={styles.inner}>
        <ThemedText type="subtitle" accessibilityRole="header">{title}</ThemedText>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  root: {
    paddingHorizontal: Space.lg,
    paddingTop: Space.sm,
    paddingBottom: Space.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  inner: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
});
