import type { ReactNode } from 'react';
import type { Href } from 'expo-router';

import type { ItemAction } from '@/lib/item-actions';

export interface ItemLinkProps {
  /** Para onde a linha navega no toque curto. */
  href: Href;
  /**
   * As ações do item — **declaradas UMA vez**.
   *
   * Antes cada tela escrevia a mesma lista duas vezes: como `<Link.MenuAction>` (iOS) e como
   * array para o `showItemActions` (Android). Duas sintaxes para o mesmo conteúdo é duas coisas
   * que divergem.
   */
  actions: ItemAction[];
  /** Título do sheet no Android. O menu do iOS não tem título. */
  title: string;
  /**
   * A linha. Recebe `onLongPress` para pendurar no elemento tocável (`Row`, `Pressable`).
   *
   * É render prop porque no iOS ele vem `undefined` — lá quem abre o menu é o próprio
   * `Link.Menu`, e um `onLongPress` competiria com o gesto do sistema.
   */
  children: (props: { onLongPress?: () => void }) => ReactNode;
}
