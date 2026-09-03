import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Fonts } from '@/constants/theme';
import { HitTarget, Radius, Space } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

/**
 * As opções de `<Stack>` que vestem o header NATIVO com a fonte do app.
 *
 * Sem isto o título das telas empurradas (Lançamentos, Contas, Cartões, Gerenciar, Pastas…) sai
 * em SF Pro sobre um corpo em Hanken Grotesk — duas famílias na mesma tela, que é exatamente o
 * "quase nativo" que o design proíbe. `headerTitleStyle`/`headerLargeTitleStyle` viram
 * `titleFontFamily`/`largeTitleFontFamily` no `react-native-screens`.
 *
 * Vai no `screenOptions` de cada pilha, não tela a tela: uma tela nova nasce certa.
 */
export const stackHeaderFonts = {
  headerTitleStyle: { fontFamily: Fonts.semibold },
  headerLargeTitleStyle: { fontFamily: Fonts.bold },
} as const;

interface AppHeaderProps {
  /** O nome da tela, em display. É a única palavra grande do topo. */
  title: string;
  /**
   * A linha de cima, em caixa alta.
   *
   * Ela carrega CONTEXTO que muda — a data de hoje, o mês em foco, quantos itens existem. Rótulo
   * fixo aqui é ruído: repetir "ProOps" em cima de "Hoje" gasta a faixa mais valiosa da tela
   * dizendo o que o ícone do app já disse na tela inicial.
   */
  eyebrow?: string;
  /** Controles à direita, antes do avatar (ex.: nova nota). */
  action?: React.ReactNode;
}

/**
 * A barra de topo das quatro raízes de aba.
 *
 * ## Por que não é mais a barra de marca do Stitch (03/09/2026)
 *
 * O desenho original trazia um logotipo com um ponto verde pulsando e um avatar — uma faixa que
 * gastava o lugar mais nobre da tela dizendo em que app a pessoa está, que é a única coisa que ela
 * já sabe. E o ponto piscava para sempre, contra a regra de movimento (§5: nada anima sem
 * propósito, e dado que o usuário está lendo não se move).
 *
 * A referência agora é a dos apps que se destacam por respiro — Copilot, Monzo, Things: uma
 * **micro-etiqueta de contexto** em cima e um **display grande** embaixo, com um único controle à
 * direita. A hierarquia sai de escala e espaço, não de moldura: sem caixa em volta de ícone, sem
 * fio embaixo, sem cor. É a mesma alavanca que o resto do sistema usa desde que a marca virou
 * monocromática.
 *
 * O avatar traz o ícone de pessoa, e não iniciais: o schema guarda só o telefone
 * (`profiles.phone`), e tirar iniciais de um número seria escrever um dado que não existe.
 */
export function AppHeader({ title, eyebrow, action }: AppHeaderProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[styles.bar, { paddingTop: insets.top + Space.md, backgroundColor: theme.background }]}>
      <View style={styles.titles}>
        {eyebrow ? (
          <ThemedText type="meta" themeColor="textSecondary" numberOfLines={1}>
            {eyebrow.toUpperCase()}
          </ThemedText>
        ) : null}
        <ThemedText type="title" numberOfLines={1}>
          {title}
        </ThemedText>
      </View>

      <View style={styles.right}>
        {action}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Abrir perfil"
          hitSlop={Space.sm}
          onPress={() => router.push('/(tabs)/profile')}
          style={[styles.round, { backgroundColor: theme.surface, borderColor: theme.cardBorder }]}>
          <Icon name="person.crop.circle" size="md" color="textSecondary" />
        </Pressable>
      </View>
    </View>
  );
}

/** Botão só-ícone do slot `action` — mesma forma do avatar, para a fileira ficar par. */
export function HeaderIconButton({
  icon,
  label,
  onPress,
}: {
  icon: React.ComponentProps<typeof Icon>['name'];
  label: string;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={Space.sm}
      onPress={onPress}
      style={[styles.round, { backgroundColor: theme.surface, borderColor: theme.cardBorder }]}>
      <Icon name={icon} size="md" color="text" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: Space.md,
    paddingHorizontal: Space.lg,
    paddingBottom: Space.lg,
  },
  /** `flex: 1` para o display truncar em vez de empurrar os controles para fora. */
  titles: { flex: 1, minWidth: 0, gap: Space.xs },
  right: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  round: {
    width: HitTarget - 6,
    height: HitTarget - 6,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
