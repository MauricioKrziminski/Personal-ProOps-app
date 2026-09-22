import { requireOptionalNativeModule } from 'expo';

import type { Retrato } from '@/lib/widget-snapshot';
import { propsDoWidget } from '@/widgets/props';

type Widget = { updateSnapshot: (props: ReturnType<typeof propsDoWidget>) => void };

/**
 * Carregado na primeira publicação, e não no topo: `expo-widgets` pede o módulo NATIVO na
 * importação, e um JS novo sobre um binário sem ele (OTA para a nativa errada) derrubaria o app
 * inteiro pelo `_layout`. Sem o módulo, `null` — e o app segue sem widget.
 *
 * ⚠️ Pergunta ANTES de carregar; `try` em volta do `require` não serve: o Metro manda o erro de
 * um módulo que falha ao iniciar para o `reportFatalError` e não o relança — em release, o app
 * fecha (medido no simulador com o binário de 18/09, 22/09/2026).
 */
let widgets: Widget[] | null | undefined;
function carregar(): Widget[] | null {
  if (widgets === undefined) {
    widgets = requireOptionalNativeModule('ExpoWidgets')
      ? // eslint-disable-next-line @typescript-eslint/no-require-imports
        [require('@/widgets/ios/livre').default, require('@/widgets/ios/vence').default]
      : null;
  }
  return widgets;
}

/** iOS: o retrato vai para o App Group pelo `updateSnapshot`, e o WidgetKit redesenha. */
export async function publicarRetrato(retrato: Retrato): Promise<void> {
  const props = propsDoWidget(retrato);
  for (const w of carregar() ?? []) w.updateSnapshot(props);
}
