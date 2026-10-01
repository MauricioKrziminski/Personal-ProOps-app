import { Link, router } from 'expo-router';
import { isValidElement } from 'react';
import { View } from 'react-native';

import { Deslizavel } from '@/components/ui/deslizavel';
import { usarDica } from '@/hooks/use-dicas';
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
export function ItemLink({ href, actions, title, accessibilityLabel, forma, children }: ItemLinkProps) {
  const content = children({});
  const childLabel = isValidElement<{ accessibilityLabel?: string }>(content)
    ? content.props.accessibilityLabel
    : undefined;
  const accessibleActions = actionsForAccessibility(actions);
  // O arrasto fica POR FORA do `Link`: o `Link.Trigger` engole o `style` do filho direto.
  return (
    <Deslizavel titulo={title} acoes={actions} forma={forma}>
      {/* Uma caixa própria mantém o alvo acessível fora da fronteira do preview nativo.
          Toque/preview continuam no Link.Trigger; o leitor usa as mesmas ações do menu/arrasto. */}
      <View accessible accessibilityRole="link" accessibilityLabel={accessibilityLabel ?? childLabel ?? title}
        onAccessibilityTap={() => router.navigate(href)}
        accessibilityActions={accessibleActions.map(({ name, label }) => ({ name, label }))}
        onAccessibilityAction={({ nativeEvent: { actionName } }) => {
          if (actionName === 'activate') router.navigate(href);
          else {
            const action = accessibleActions.find((item) => item.name === actionName);
            if (action) executeAction(action.action);
          }
        }}>
        <Link asChild href={href}>
          <Link.Trigger>{content}</Link.Trigger>
          <Link.Menu>{actions.map(renderAction)}</Link.Menu>
        </Link>
      </View>
    </Deslizavel>
  );
}

function executeAction(action: ItemAction) {
  usarDica('lista-arrasto');
  action.onPress?.();
}

/** Submenu também fica alcançável pelo rotor; ação/ramo desabilitado não executa. */
function actionsForAccessibility(actions: ItemAction[], path: number[] = [], prefix: string[] = []): {
  name: string; label: string; action: ItemAction;
}[] {
  return actions.flatMap((action, index) => {
    if (action.disabled) return [];
    const ids = [...path, index];
    const labels = [...prefix, action.label];
    if (action.actions?.length) return actionsForAccessibility(action.actions, ids, labels);
    return action.onPress ? [{ name: `item-action-${ids.join('-')}`, label: labels.join(', '), action }] : [];
  });
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
      onPress={() => {
        // Segurar e escolher é o que a dica das listas ensina (`lista-arrasto`). O menu do sistema
        // não avisa quando ABRE; escolher uma ação é o primeiro sinal que chega aqui.
        executeAction(action);
      }}>
      {action.label}
    </Link.MenuAction>
  );
}
