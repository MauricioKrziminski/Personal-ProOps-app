import { Link } from 'expo-router';

import type { ItemAction } from '@/lib/item-actions';
import type { ItemLinkProps } from './item-link.types';

/**
 * Linha com **context menu nativo** — a versão iOS.
 *
 * `Link.Menu` é o menu com preview do sistema: descobrível por toque longo, não bloqueia a tela e
 * anima a partir da própria linha. É melhor que qualquer sheet e por isso vale um arquivo só
 * para ele. O Android não tem equivalente em RN — ver `item-link.tsx`.
 *
 * Sem `onLongPress`: quem escuta o gesto aqui é o `Link.Menu`. Pendurar o nosso competiria com o
 * do sistema e abriria os dois.
 */
export function ItemLink({ href, actions, children }: ItemLinkProps) {
  return (
    <Link asChild href={href}>
      <Link.Trigger>{children({})}</Link.Trigger>
      <Link.Menu>{actions.map(renderAction)}</Link.Menu>
    </Link>
  );
}

/** Submenu (`actions` aninhado) vira `Link.Menu` dentro do menu — é o caso do "Mover para pasta". */
function renderAction(action: ItemAction) {
  if (action.actions?.length) {
    return (
      <Link.Menu key={action.label} title={action.label} icon={action.icon}>
        {action.actions.map(renderAction)}
      </Link.Menu>
    );
  }
  return (
    <Link.MenuAction
      key={action.label}
      icon={action.icon}
      destructive={action.destructive}
      disabled={action.disabled}
      isOn={action.selected}
      onPress={() => action.onPress?.()}>
      {action.label}
    </Link.MenuAction>
  );
}
