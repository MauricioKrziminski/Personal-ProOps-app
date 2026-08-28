import { useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, withSpring } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { ThemedText } from '@/components/themed-text';
import { Elevation, Motion, Radius, Space } from '@/design/tokens';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';

interface SegmentedProps<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}

/**
 * Seletor segmentado.
 *
 * ponytail: reconstruído em JS em vez de usar o controle nativo — o projeto tirou `@expo/ui` no
 * commit `de229d7` e nenhuma lib de segmented está aprovada. O polegar desliza com a mola de
 * `Motion.spring.settle` para ficar perto do iOS. Se a diferença de timing incomodar, o upgrade é
 * `@react-native-segmented-control/segmented-control`, e a API deste componente não muda.
 */
export function Segmented<T extends string>({ options, value, onChange }: SegmentedProps<T>) {
  const theme = useTheme();
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const [width, setWidth] = useState(0);

  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const slot = width > 0 ? (width - 4) / options.length : 0;

  const thumb = useAnimatedStyle(() => ({
    width: slot,
    transform: [{ translateX: withSpring(index * slot, Motion.spring.settle) }],
  }));

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  return (
    <View
      accessibilityRole="tablist"
      onLayout={onLayout}
      style={[styles.track, { backgroundColor: theme.backgroundElement }]}>
      {slot > 0 ? (
        <Animated.View
          style={[
            styles.thumb,
            thumb,
            { backgroundColor: theme.surface, boxShadow: Elevation[scheme].raised },
          ]}
        />
      ) : null}
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => {
              if (selected) return;
              Haptics.selectionAsync();
              onChange(option.value);
            }}
            style={styles.option}>
            <ThemedText
              type={selected ? 'smallBold' : 'small'}
              themeColor={selected ? 'text' : 'textSecondary'}
              numberOfLines={1}>
              {option.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    padding: 2,
    borderRadius: Radius.xs,
    borderCurve: 'continuous',
  },
  thumb: {
    position: 'absolute',
    top: 2,
    bottom: 2,
    left: 2,
    borderRadius: Radius.xs - 2,
    borderCurve: 'continuous',
  },
  option: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Space.sm,
    minHeight: 32,
  },
});
