import AsyncStorage from '@react-native-async-storage/async-storage';
import type { WidgetTaskHandlerProps } from 'react-native-android-widget';

import { retratoSemSessao } from '@/lib/widget-snapshot';
import { CHAVE_DO_RETRATO } from '@/widgets/chave';
import { propsDoWidget, type PropsDoWidget } from '@/widgets/props';
import { LivreWidget, VenceWidget } from '@/widgets/android/widgets';

/** O último retrato publicado pelo app. Retrato de versão desconhecida vira "entre no app". */
export async function lerRetrato(): Promise<PropsDoWidget> {
  try {
    const cru = await AsyncStorage.getItem(CHAVE_DO_RETRATO);
    const r = cru ? JSON.parse(cru) : null;
    if (r?.versao === 1) return r as PropsDoWidget;
  } catch {
    // retrato ilegível desenha o estado neutro — nunca dinheiro velho de formato errado
  }
  return propsDoWidget(retratoSemSessao('—'));
}

/**
 * O sistema chama isto com o app FECHADO (adicionar, redimensionar, a cada 30 min): desenha o
 * último retrato que o app guardou. Quem atualiza o retrato é o app (`lib/widgets.android.ts`).
 */
export async function widgetTaskHandler({ widgetInfo, widgetAction, renderWidget }: WidgetTaskHandlerProps) {
  if (widgetAction === 'WIDGET_DELETED' || widgetAction === 'WIDGET_CLICK') return;
  const p = await lerRetrato();
  if (widgetInfo.widgetName === 'Vence') renderWidget(<VenceWidget p={p} altura={widgetInfo.height} />);
  else renderWidget(<LivreWidget p={p} largura={widgetInfo.width} />);
}
