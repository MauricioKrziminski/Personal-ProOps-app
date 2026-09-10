import { Stack } from 'expo-router';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import type { SymbolViewProps } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import type { ThemeColor } from '@/constants/theme';
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
  /**
   * Ação que confirma a tela — o "Salvar" de um form modal.
   *
   * No iOS vira `variant: 'done'` (negrito), que é como o sistema separa confirmar de cancelar.
   * Sem isso o "Salvar" saía na cor de rótulo e ficava MENOS proeminente que o "Cancelar" azul
   * do lado esquerdo: hierarquia invertida no único botão que fecha a tarefa.
   */
  primary?: boolean;
}

/**
 * Menu "…" desta tela — o overflow que acompanha os botões.
 *
 * Vive DENTRO de `HeaderActions` de propósito: os dois escreviam `headerRight` por conta e
 * `setOptions` faz merge raso, então numa tela com os dois o último apagava o primeiro. Ver
 * `anti-slop.test.ts`.
 */
export interface HeaderOverflow {
  /** Título do sheet no Android — some no iOS, onde o menu nativo não tem cabeçalho. */
  title: string;
  actions: ItemAction[];
}

/** Submenu vira `Stack.Toolbar.Menu` aninhado — o "Mudar categoria" do detalhe do lançamento. */
function renderToolbarAction(action: ItemAction) {
  if (action.actions?.length) {
    return (
      <Stack.Toolbar.Menu key={action.label} title={action.label} icon={action.icon}>
        {action.actions.map(renderToolbarAction)}
      </Stack.Toolbar.Menu>
    );
  }
  return (
    <Stack.Toolbar.MenuAction
      key={action.label}
      icon={action.icon}
      destructive={action.destructive}
      isOn={action.selected}
      onPress={() => action.onPress?.()}>
      {action.label}
    </Stack.Toolbar.MenuAction>
  );
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
export function HeaderActions({
  actions,
  menu,
  onHero = false,
}: {
  actions: HeaderAction[];
  /** Ações de overflow, atrás de um "…" à direita dos botões. */
  menu?: HeaderOverflow;
  /** O header desta tela veste a cor do painel — ver `heroHeaderOptions`. */
  onHero?: boolean;
}) {
  const theme = useTheme();
  const menuActions = menu?.actions ?? [];
  // Slot vazio é slot devolvido ao padrão — vale para os DOIS, senão um menu que esvazia
  // (o lote da importação) deixa um "…" apontando para ações que não existem mais.
  const vazio = actions.length === 0 && menuActions.length === 0;

  if (Platform.OS === 'ios') {
    // Toolbar sem filho ainda reclama o slot; desmontar é o que devolve o header ao padrão.
    if (vazio) return null;
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
            variant={action.primary ? 'done' : undefined}
            onPress={action.onPress}>
            {action.icon ? undefined : action.label}
          </Stack.Toolbar.Button>
        ))}
        {menuActions.length > 0 ? (
          <Stack.Toolbar.Menu icon="ellipsis.circle" accessibilityLabel="Mais opções">
            {menuActions.map(renderToolbarAction)}
          </Stack.Toolbar.Menu>
        ) : null}
      </Stack.Toolbar>
    );
  }

  // `undefined` (e não `() => null`) devolve o slot ao padrão quando a ação some — é o caso de
  // "Exportar" em Relatórios, que só existe quando há o que exportar.
  return (
    <Stack.Screen
      options={{
        headerRight: vazio
          ? undefined
          : () => (
              <AndroidActions
                onHero={onHero}
                actions={[
                  ...actions,
                  ...(menuActions.length > 0 && menu
                    ? [
                        {
                          label: 'Mais opções',
                          icon: 'ellipsis.circle' as const,
                          onPress: () => showItemActions(menu.title, menuActions),
                        },
                      ]
                    : []),
                ]}
              />
            ),
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
export function HeaderMenu({
  title,
  actions,
  onHero = false,
}: {
  title: string;
  actions: ItemAction[];
  /** O header desta tela veste a cor do painel — ver `heroHeaderOptions`. */
  onHero?: boolean;
}) {
  return <HeaderActions actions={[]} menu={{ title, actions }} onHero={onHero} />;
}

/**
 * Cor do ícone/rótulo no Android.
 *
 * `selected === false` (e não "falsy") é o que separa **desligado** de **sem estado**: uma ação
 * comum não passa `selected` e continua no accent. Sem essa distinção o pin da nota ficava azul
 * mesmo desafixado — e no Android `pin` e `pin.fill` caem no MESMO glifo Material (`push_pin`),
 * então a cor é o único sinal de estado que sobra.
 */
function androidTone(action: HeaderAction, onHero: boolean): ThemeColor {
  if (action.disabled) return onHero ? 'onHeroMuted' : 'textSecondary';
  if (action.destructive) return 'danger';
  if (action.selected === false) return onHero ? 'onHeroMuted' : 'textSecondary';
  // Sobre o painel de tinta o `tint` é preto no tema claro — o ícone sumiria dentro do
  // cabeçalho. No iOS quem resolve isso é o `headerTintColor`; no Android, aqui.
  return onHero ? 'onHero' : 'tint';
}

/** Alvo de 44pt de verdade, não `hitSlop` — no Android o header não tem pílula para dar a forma. */
function AndroidActions({ actions, onHero }: { actions: HeaderAction[]; onHero: boolean }) {
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
            <Icon name={action.icon} size="lg" color={androidTone(action, onHero)} />
          ) : (
            <ThemedText type="smallBold" themeColor={androidTone(action, onHero)}>
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
