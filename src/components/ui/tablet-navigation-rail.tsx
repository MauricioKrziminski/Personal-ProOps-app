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
import { progressoDeEntrada, useRelogioDeEntrada } from '@/components/motion/entrada';
import { Icon } from '@/components/ui/icon';
import { Mark } from '@/components/ui/mark';
import type { PillTab } from '@/components/ui/pill-tab-bar';
import { RAIL_WIDTH } from '@/design/adaptive-window';
import { railBadge, railLabel } from '@/design/rail-badge';
import { Motion, Radius, Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

const ITEM_SIZE = 72;
const ITEM_GAP = Space.sm;
const ENTRANCE_MS = 520;

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
  const { relogio, assentado } = useRelogioDeEntrada(120, ENTRANCE_MS);

  useEffect(() => {
    selected.set(
      reduceMotion ? activeIndex : withSpring(activeIndex, Motion.spring.tab),
    );
  }, [activeIndex, reduceMotion, selected]);

  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: selected.get() * (ITEM_SIZE + ITEM_GAP) }],
  }));
  const indicatorContentsStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -selected.get() * (ITEM_SIZE + ITEM_GAP) }],
  }));
  const entranceStyle = useAnimatedStyle(() => {
    const progress = progressoDeEntrada(relogio.get());
    return {
      opacity: progress,
      transform: [{ translateX: reduceMotion ? 0 : (progress - 1) * RAIL_WIDTH }],
    };
  });

  return (
    <Animated.View
      accessibilityRole="tablist"
      style={[
        styles.root,
        { backgroundColor: theme.heroSurface, borderRightColor: theme.heroSeparator },
        assentado ? null : entranceStyle,
      ]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + Space.xl, paddingBottom: insets.bottom + Space.xl },
        ]}>
        <Mark size={28} color="onHero" />
        <View style={styles.items}>
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
                <Icon name={tab.icon} size="md" color="onHeroMuted" />
                <ThemedText type="caption" themeColor="onHeroMuted" style={styles.label}>
                  {railLabel(tab.name, tab.label)}
                </ThemedText>
              </Pressable>
            );
          })}
          {/* A cópia escura anda AO CONTRÁRIO dentro do recorte claro. Assim o ícone e o
              rótulo são revelados pelo indicador ao passar, sem saltar de cor com a rota. */}
          <Animated.View
            pointerEvents="none"
            style={[styles.indicator, { backgroundColor: theme.onHero }, indicatorStyle]}>
            <Animated.View style={[styles.indicatorContents, indicatorContentsStyle]}>
              {tabs.map((tab) => (
                <View key={tab.name} style={styles.item}>
                  <Icon name={tab.icon} size="md" color="heroSurface" />
                  <ThemedText type="caption" themeColor="heroSurface" style={styles.label}>
                    {railLabel(tab.name, tab.label)}
                  </ThemedText>
                </View>
              ))}
            </Animated.View>
          </Animated.View>
          <View pointerEvents="none" style={styles.badgeLayer}>
            {tabs.map((tab) => {
              const badge = railBadge(tab.badge ?? 0);
              return (
                <View key={tab.name} style={styles.badgeSlot}>
                  {badge ? (
                    <View style={[styles.badge, { backgroundColor: theme.danger }]}>
                      <ThemedText type="meta" style={[styles.badgeText, { color: theme.onHero }]}>
                        {badge.visual}
                      </ThemedText>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        </View>
      </ScrollView>
    </Animated.View>
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
    overflow: 'hidden',
  },
  indicatorContents: { width: ITEM_SIZE, gap: ITEM_GAP },
  badgeLayer: { ...StyleSheet.absoluteFill, gap: ITEM_GAP },
  badgeSlot: { width: ITEM_SIZE, height: ITEM_SIZE },
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
