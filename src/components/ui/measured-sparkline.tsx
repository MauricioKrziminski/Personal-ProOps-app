import { useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';

import { Sparkline } from '@/components/ui/sparkline';

type MeasuredSparklineProps = Omit<Parameters<typeof Sparkline>[0], 'width'>;

/** Skia gets the width of its own card, including split-screen and orientation changes. */
export function MeasuredSparkline(props: MeasuredSparklineProps) {
  const [width, setWidth] = useState(0);
  const onLayout = (event: LayoutChangeEvent) => {
    const measured = event.nativeEvent.layout.width;
    setWidth((previous) => previous === measured ? previous : measured);
  };

  return (
    <View onLayout={onLayout} style={{ width: '100%' }}>
      {width > 0 ? <Sparkline {...props} width={width} /> : null}
    </View>
  );
}
