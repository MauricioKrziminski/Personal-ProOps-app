import { Stack } from 'expo-router';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import type { SymbolViewProps } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { HitTarget, Space } from '@/design/tokens';
import { showItemActions, type ItemAction } from '@/lib/item-actions';
import { useTheme } from '@/hooks/use-theme';

/** SF Symbol em string — é o que o toolbar nativo aceita; o Android sai do mapa do `Icon`. */
type SFName = Extract<SymbolViewProps['name'], string>;

export interface HeaderAction {
  /**
   * Rótulo. Com `icon`, é só `accessibilityLabel`; sem `icon`, vira o texto do botão
   * ("Salvar", "Esvaziar").
   */
  label: string;
  icon?: SFName;
  onPress: () => void;
  disabled?: boolean;
  /** Estado ligado — a nota fixada. */
  selected?: boolean;
  /** Ação destrutiva: "Esvaziar" da lixeira. */
  destructive?: boolean;
}

/**
 * O único caminho para ação no header.
 *
 * Existiam TRÊS padrões convivendo — `View` à mão com dois `Pressable` e `gap: 16` (Hoje, Notas),
 * `Stack.Toolbar` nativo (Financeiro, Transações) e `Pressable` solto (Pastas, Lixeira, …) — e a
 * queixa do usuário foi exatamente essa: *a pílula do header não tem o mesmo padding nem o mesmo
 * raio entre telas*.
 *
 * A causa é o iOS 26: o header desenha uma **pílula de vidro em volta do que está no
 * `headerRight`**. Quando esse conteúdo é uma `View` nossa, o respiro interno passa a ser o
 * `gap` que a gente escolheu, não o do sistema — e nenhuma tela escolhia igual. Com
 * `Stack.Toolbar` quem decide pílula, espaçamento e comportamento com o large title é o iOS.
 *
 * No Android o toolbar nativo **reclama o slot direito do header sem desenhar nada**, então lá a
 * ação vem por `headerRight`. Por isso este componente monta um `Stack.Screen` extra em vez de
 * receber as opções: `setOptions` faz merge raso, e as chaves não colidem com o `title` da tela.
 *
 * Disciplina de peso de ícone (`design.md` §4): **ou todos contorno, ou todos preenchidos** no
 * mesmo header. Misturar `magnifyingglass` com `plus.circle.fill` faz um virar glifo e o outro
 * virar botão — era o caso da aba Hoje.
 */
export function HeaderActions({ actions }: { actions: HeaderAction[] }) {
  const theme = useTheme();

  if (Platform.OS === 'ios') {
    // Toolbar sem filho ainda reclama o slot; desmontar é o que devolve o header ao padrão.
    if (actions.length === 0) return null;
    return (
      <Stack.Toolbar placement="right">
        {actions.map((action) => (
          <Stack.Toolbar.Button
            key={action.label}
            icon={action.icon}
            accessibilityLabel={action.label}
            disabled={action.disabled}
            selected={action.selected}
            // O toolbar não tem "papel destrutivo": sem `tintColor` o "Esvaziar" da lixeira
            // sairia no accent, igualzinho a "Salvar".
            tintColor={action.destructive ? theme.danger : undefined}
            onPress={action.onPress}>
            {action.icon ? undefined : action.label}
          </Stack.Toolbar.Button>
        ))}
      </Stack.Toolbar>
    );
  }

  // `undefined` (e não `() => null`) devolve o slot ao padrão quando a ação some — é o caso de
  // "Exportar" em Relatórios, que só existe quando há o que exportar.
  return (
    <Stack.Screen
      options={{
        headerRight: actions.length === 0 ? undefined : () => <AndroidActions actions={actions} />,
      }}
    />
  );
}

/**
 * Menu "..." do header.
 *
 * `Stack.Toolbar.Menu` recebe o nome de um SF Symbol e **no Android não desenha nada** — o próprio
 * runtime avisa: *"Stack.Toolbar.Menu on Android requires an ImageSourcePropType icon"*. O efeito
 * era pior que estético: em `Financeiro`, `Transações` e no detalhe do lançamento o botão não
 * existia, então "Importar extrato", "Regras de categoria", "Duplicar" e "Apagar" ficavam
 * **inalcançáveis** no Android. Lá o menu vira `showItemActions`, que fala o idioma da plataforma.
 */
export function HeaderMenu({ title, actions }: { title: string; actions: ItemAction[] }) {
  if (Platform.OS === 'ios') {
    return (
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon="ellipsis.circle" accessibilityLabel="Mais opções">
          {actions.map((action) => (
            <Stack.Toolbar.MenuAction
              key={action.label}
              icon={action.icon}
              destructive={action.destructive}
              onPress={action.onPress}>
              {action.label}
            </Stack.Toolbar.MenuAction>
          ))}
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
    );
  }

  return (
    <Stack.Screen
      options={{
        headerRight: () => (
          <AndroidActions
            actions={[
              {
                label: 'Mais opções',
                icon: 'ellipsis.circle',
                onPress: () => showItemActions(title, actions),
              },
            ]}
          />
        ),
      }}
    />
  );
}

/**
 * Cor do ícone/rótulo no Android.
 *
 * `selected === false` (e não "falsy") é o que separa **desligado** de **sem estado**: uma ação
 * comum não passa `selected` e continua no accent. Sem essa distinção o pin da nota ficava azul
 * mesmo desafixado — e no Android `pin` e `pin.fill` caem no MESMO glifo Material (`push_pin`),
 * então a cor é o único sinal de estado que sobra.
 */
function androidTone(action: HeaderAction): 'textSecondary' | 'danger' | 'tint' {
  if (action.disabled) return 'textSecondary';
  if (action.destructive) return 'danger';
  return action.selected === false ? 'textSecondary' : 'tint';
}

/** Alvo de 44pt de verdade, não `hitSlop` — no Android o header não tem pílula para dar a forma. */
function AndroidActions({ actions }: { actions: HeaderAction[] }) {
  return (
    <View style={styles.row}>
      {actions.map((action) => (
        <Pressable
          key={action.label}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          accessibilityState={{ disabled: action.disabled, selected: action.selected }}
          disabled={action.disabled}
          onPress={action.onPress}
          style={({ pressed }) => [styles.target, { opacity: pressed ? 0.5 : 1 }]}>
          {action.icon ? (
            <Icon name={action.icon} size="lg" color={androidTone(action)} />
          ) : (
            <ThemedText type="smallBold" themeColor={androidTone(action)}>
              {action.label}
            </ThemedText>
          )}
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
  },
  target: {
    minWidth: HitTarget,
    height: HitTarget,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Space.sm,
  },
});

/**
 * Escape hatch: `headerRight` do Android para uma tela cujo menu o `HeaderMenu` não expressa.
 *
 * Só o detalhe do lançamento usa. Lá o toolbar do iOS tem um botão "Editar" ao lado de um menu
 * **com submenu** ("Mudar categoria"), e achatar isso num sheet só para uniformizar seria trocar
 * um menu nativo bom por um pior. No Android o submenu vira um segundo sheet, que é o natural.
 */
export function androidOverflow(title: string, actions: ItemAction[]) {
  if (Platform.OS !== 'android') return undefined;

  function OverflowButton() {
    return (
      <AndroidActions
        actions={[
          { label: 'Mais opções', icon: 'ellipsis.circle', onPress: () => showItemActions(title, actions) },
        ]}
      />
    );
  }

  return OverflowButton;
}
