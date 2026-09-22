import AsyncStorage from '@react-native-async-storage/async-storage';
import { requestWidgetUpdate } from 'react-native-android-widget';

import type { Retrato } from '@/lib/widget-snapshot';
import { LivreWidget, VenceWidget } from '@/widgets/android/widgets';
import { CHAVE_DO_RETRATO } from '@/widgets/chave';
import { propsDoWidget } from '@/widgets/props';

/**
 * Android: guarda o retrato (o sistema redesenha com o app fechado, `task-handler.tsx`) e pede o
 * redesenho AGORA de cada widget que estiver na tela — sem isso ele esperaria o ciclo de 30 min.
 */
export async function publicarRetrato(retrato: Retrato): Promise<void> {
  const p = propsDoWidget(retrato);
  await AsyncStorage.setItem(CHAVE_DO_RETRATO, JSON.stringify(p));
  await Promise.all([
    requestWidgetUpdate({ widgetName: 'Livre', renderWidget: (w) => <LivreWidget p={p} largura={w.width} /> }),
    requestWidgetUpdate({ widgetName: 'Vence', renderWidget: (w) => <VenceWidget p={p} altura={w.height} /> }),
  ]);
}
