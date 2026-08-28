import { Platform, Pressable } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { showItemActions, type ItemAction } from '@/lib/item-actions';

/**
 * Menu "..." do header, para o Android.
 *
 * `Stack.Toolbar.Menu` recebe o nome de um SF Symbol e **no Android não desenha nada** — o próprio
 * runtime avisa: *"Stack.Toolbar.Menu on Android requires an ImageSourcePropType icon"*. O efeito
 * era pior que estético: em `Financeiro`, `Transações` e no detalhe do lançamento o botão não
 * existia, então "Importar extrato", "Regras de categoria", "Duplicar" e "Apagar" ficavam
 * **inalcançáveis** no Android.
 *
 * A saída é a mesma que a regra de design já manda para ação de item: `showItemActions`, que fala
 * o idioma de cada plataforma. O iOS continua com o menu nativo do toolbar; isto devolve o
 * caminho ao Android e some no iOS.
 */
export function androidOverflow(title: string, actions: ItemAction[]) {
  if (Platform.OS !== 'android') return undefined;

  function OverflowButton() {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Mais opções"
        hitSlop={12}
        onPress={() => showItemActions(title, actions)}>
        <Icon name="ellipsis.circle" size="lg" color="tint" />
      </Pressable>
    );
  }

  return OverflowButton;
}
