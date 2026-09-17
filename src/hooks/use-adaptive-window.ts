import { Platform, useWindowDimensions } from 'react-native';

import { classifyWindow } from '@/design/adaptive-window';

export function useAdaptiveWindow() {
  const { width, fontScale } = useWindowDimensions();
  const windowClass = classifyWindow(width);

  return {
    width,
    fontScale,
    windowClass,
    androidRail: Platform.OS === 'android' && windowClass !== 'compact',
  };
}
