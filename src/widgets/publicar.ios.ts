import type { Retrato } from '@/lib/widget-snapshot';
import Livre from '@/widgets/ios/livre';
import Vence from '@/widgets/ios/vence';
import { propsDoWidget } from '@/widgets/props';

/** iOS: o retrato vai para o App Group pelo `updateSnapshot`, e o WidgetKit redesenha. */
export async function publicarRetrato(retrato: Retrato): Promise<void> {
  const props = propsDoWidget(retrato);
  Livre.updateSnapshot(props);
  Vence.updateSnapshot(props);
}
