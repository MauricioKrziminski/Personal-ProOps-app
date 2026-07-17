import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useColorScheme } from 'react-native';

import { Colors } from '@/constants/theme';

// No iOS 26+ a NativeTabs renderiza a tab bar nativa em Liquid Glass —
// diretriz central de design do Personal ProOps app. SF Symbols no iOS; Material glyphs no Android.
const TABS = [
  { name: 'index', label: 'Notas', sf: { default: 'note.text', selected: 'note.text' }, md: 'description' },
  { name: 'reminders', label: 'Lembretes', sf: { default: 'bell', selected: 'bell.fill' }, md: 'notifications' },
  { name: 'finance', label: 'Financeiro', sf: { default: 'chart.pie', selected: 'chart.pie.fill' }, md: 'pie_chart' },
  { name: 'profile', label: 'Perfil', sf: { default: 'person', selected: 'person.fill' }, md: 'person' },
] as const;

export default function AppTabs() {
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'unspecified' ? 'light' : scheme];

  return (
    <NativeTabs
      backgroundColor={colors.background}
      indicatorColor={colors.backgroundElement}
      labelStyle={{ selected: { color: colors.text } }}>
      {TABS.map((tab) => (
        <NativeTabs.Trigger key={tab.name} name={tab.name}>
          <NativeTabs.Trigger.Label>{tab.label}</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon sf={tab.sf} md={tab.md} />
        </NativeTabs.Trigger>
      ))}
    </NativeTabs>
  );
}
