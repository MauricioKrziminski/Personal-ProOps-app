import { Link } from 'expo-router';

import { showItemActions } from '@/lib/item-actions';
import type { ItemLinkProps } from './item-link.types';

/**
 * Linha que navega no toque e abre ações no toque longo — **implementação padrão** (Android, web).
 *
 * O iOS sobrescreve em `item-link.ios.tsx` com `Link.Menu`, o context menu nativo com preview.
 * Aqui não existe equivalente em RN, então o toque longo abre o sheet de `showItemActions`, que
 * já fala o idioma da plataforma.
 *
 * ## Por que este componente existe
 *
 * `Link.Menu` é iOS-only, e **cinco telas** remendavam isso por conta — com o mesmo comentário
 * copiado e a mesma expressão `Platform.OS === 'ios' ? undefined : () => showItemActions(...)`.
 * Decisão de plataforma espalhada por tela é como as duas plataformas divergem sem ninguém
 * decidir: cada tela nova copia a de antes, e a que esquecer fica sem ação no Android.
 */
export function ItemLink({ href, actions, title, children }: ItemLinkProps) {
  return (
    <Link asChild href={href}>
      <Link.Trigger>{children({ onLongPress: () => showItemActions(title, actions) })}</Link.Trigger>
    </Link>
  );
}
