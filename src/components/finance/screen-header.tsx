import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Header das telas de stack (fora das tabs): voltar + título + ação opcional. */
export function ScreenHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          router.back();
        }}
        hitSlop={12}
        accessibilityLabel="Voltar"
        style={({ pressed }) => [
          styles.back,
          { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.7 : 1 },
        ]}>
        <ThemedText type="smallBold">‹</ThemedText>
      </Pressable>
      <ThemedText type="subtitle" style={styles.title} numberOfLines={1}>
        {title}
      </ThemedText>
      {right ?? <View style={styles.back} />}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
  },
  back: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    fontSize: 26,
    lineHeight: 34,
  },
});
