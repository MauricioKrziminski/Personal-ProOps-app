import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { Platform, useColorScheme } from 'react-native';

import { Colors } from '@/constants/theme';

// No iOS 26+ a NativeTabs renderiza a tab bar nativa em Liquid Glass —
// diretriz central de design do ProOps. SF Symbols no iOS; PNG no Android.
const TABS = [
  { name: 'index', label: 'Notas', sf: { default: 'note.text', selected: 'note.text' } },
  { name: 'reminders', label: 'Lembretes', sf: { default: 'bell', selected: 'bell.fill' } },
  { name: 'finance', label: 'Financeiro', sf: { default: 'chart.pie', selected: 'chart.pie.fill' } },
  { name: 'profile', label: 'Perfil', sf: { default: 'person', selected: 'person.fill' } },
] as const;

const ANDROID_ICONS: Record<string, number> = {
  index: require('@/assets/images/tabIcons/home.png'),
  reminders: require('@/assets/images/tabIcons/explore.png'),
  finance: require('@/assets/images/tabIcons/explore.png'),
  profile: require('@/assets/images/tabIcons/explore.png'),
};

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
          {Platform.OS === 'ios' ? (
            <NativeTabs.Trigger.Icon sf={tab.sf} />
          ) : (
            <NativeTabs.Trigger.Icon src={ANDROID_ICONS[tab.name]} renderingMode="template" />
          )}
        </NativeTabs.Trigger>
      ))}
    </NativeTabs>
  );
}
