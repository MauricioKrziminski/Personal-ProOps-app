import AsyncStorage from '@react-native-async-storage/async-storage';
import { TurboModuleRegistry } from 'react-native';

import type { Retrato } from '@/lib/widget-snapshot';
import { CHAVE_DO_RETRATO } from '@/widgets/chave';
import { propsDoWidget } from '@/widgets/props';

/**
 * Android: guarda o retrato (o sistema redesenha com o app fechado, `task-handler.tsx`) e pede o
 * redesenho AGORA de cada widget que estiver na tela — sem isso ele esperaria o ciclo de 30 min.
 */
export async function publicarRetrato(retrato: Retrato): Promise<void> {
  // Na hora, e não no topo, e só com o módulo NATIVO presente: a lib o exige na importação (ver
  // `index.js`), e sem ele o app seguiria sem widget em vez de fechar.
  if (!TurboModuleRegistry.get('AndroidWidget')) return;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { requestWidgetUpdate } = require('react-native-android-widget') as typeof import('react-native-android-widget');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { LivreWidget, VenceWidget } = require('@/widgets/android/widgets') as typeof import('@/widgets/android/widgets');
  const p = propsDoWidget(retrato);
  await AsyncStorage.setItem(CHAVE_DO_RETRATO, JSON.stringify(p));
  await Promise.all([
    requestWidgetUpdate({ widgetName: 'Livre', renderWidget: (w) => <LivreWidget p={p} largura={w.width} /> }),
    requestWidgetUpdate({ widgetName: 'Vence', renderWidget: (w) => <VenceWidget p={p} altura={w.height} /> }),
  ]);
}
