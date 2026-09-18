import { useEffect } from 'react';
import * as Haptics from 'expo-haptics';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Mark } from '@/components/ui/mark';
import type { PillTab } from '@/components/ui/pill-tab-bar';
import { RAIL_WIDTH } from '@/design/adaptive-window';
import { railBadge } from '@/design/rail-badge';
import { Motion, Radius, Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

const ITEM_SIZE = 72;
const ITEM_GAP = Space.sm;

interface TabletNavigationRailProps {
  tabs: PillTab[];
  activeIndex: number;
  onSelect: (index: number) => void;
}

/** The tablet chrome changes shape; tab registration and route state stay in AppTabs. */
export function TabletNavigationRail({ tabs, activeIndex, onSelect }: TabletNavigationRailProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const selected = useSharedValue(activeIndex);

  useEffect(() => {
    selected.set(
      reduceMotion ? activeIndex : withSpring(activeIndex, Motion.spring.tab),
    );
  }, [activeIndex, reduceMotion, selected]);

  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: selected.get() * (ITEM_SIZE + ITEM_GAP) }],
  }));

  return (
    <View
      accessibilityRole="tablist"
      style={[styles.root, { backgroundColor: theme.heroSurface, borderRightColor: theme.heroSeparator }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + Space.xl, paddingBottom: insets.bottom + Space.xl },
        ]}>
        <Mark size={28} color="onHero" />
        <View style={styles.items}>
          <Animated.View
            pointerEvents="none"
            style={[styles.indicator, { backgroundColor: theme.onHero }, indicatorStyle]}
          />
          {tabs.map((tab, index) => {
            const active = index === activeIndex;
            const badge = railBadge(tab.badge ?? 0);
            return (
              <Pressable
                key={tab.name}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                accessibilityLabel={badge ? `${tab.label}, ${badge.accessible}` : tab.label}
                onPress={() => {
                  if (active) return;
                  selected.set(reduceMotion ? index : withSpring(index, Motion.spring.tab));
                  void Haptics.selectionAsync();
                  onSelect(index);
                }}
                style={styles.item}>
                <Icon name={tab.icon} size="md" color={active ? 'heroSurface' : 'onHeroMuted'} />
                <ThemedText
                  type="caption"
                  themeColor={active ? 'heroSurface' : 'onHeroMuted'}
                  style={styles.label}>
                  {tab.label}
                </ThemedText>
                {badge ? (
                  <View style={[styles.badge, { backgroundColor: theme.danger }]}>
                    <ThemedText type="meta" style={[styles.badgeText, { color: theme.onHero }]}>
                      {badge.visual}
                    </ThemedText>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { width: RAIL_WIDTH, borderRightWidth: StyleSheet.hairlineWidth },
  content: { alignItems: 'center', gap: Space.xxl },
  items: { gap: ITEM_GAP, width: ITEM_SIZE, position: 'relative' },
  indicator: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: ITEM_SIZE,
    height: ITEM_SIZE,
    borderRadius: Radius.lg,
    borderCurve: 'continuous',
  },
  item: {
    width: ITEM_SIZE,
    height: ITEM_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.xs,
  },
  label: { textAlign: 'center' },
  badge: {
    position: 'absolute',
    top: 6,
    right: 9,
    minWidth: 24,
    minHeight: 24,
    paddingHorizontal: Space.xs,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { textAlign: 'center', flexShrink: 0 },
});
