import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Icon } from '@/components/ui/icon';
import { Fonts } from '@/constants/theme';
import { HitTarget, Radius, Space, Type } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

/**
 * A barra de topo do design Stitch — **a mesma nas quatro raízes de aba**.
 *
 * Substitui o large title nativo nas raízes: o desenho não tem título de tela, tem marca. Quem
 * diz onde o usuário está é a aba acesa embaixo, e o topo fica livre para a identidade e para o
 * atalho do perfil. Telas EMPURRADAS (Orçamentos, Fatura, detalhe) continuam com o header do
 * navegador — lá o título e o "voltar" são a informação, e trocá-los por uma marca tiraria a
 * única pista de onde a pessoa está.
 *
 * O ponto verde é ESTADO (o agente está no ar), não enfeite, e por isso não pisca: a regra de
 * movimento §5 é explícita em não animar o que o usuário está lendo, e um pulso permanente no
 * canto superior é exatamente o movimento que nunca termina.
 *
 * O avatar do Stitch traz as iniciais do usuário; aqui ele traz o ícone de pessoa, porque o
 * schema não guarda nome — só o telefone (`profiles.phone`). Inventar iniciais a partir do
 * número seria escrever um dado que não existe.
 */
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

export function AppHeader({ online = true }: { online?: boolean }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.bar,
        {
          paddingTop: insets.top + Space.sm,
          backgroundColor: theme.background,
          borderBottomColor: theme.cardBorder,
        },
      ]}>
      <View style={styles.brand}>
        <View style={[styles.iconBox, { backgroundColor: theme.surfaceRaised, borderColor: theme.cardBorder }]}>
          <Icon name="clock" size="sm" color="text" />
        </View>
        <ThemedText style={styles.wordmark}>ProOps</ThemedText>
        {online ? <View style={[styles.dot, { backgroundColor: theme.success }]} /> : null}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Abrir perfil"
        hitSlop={Space.sm}
        onPress={() => router.push('/(tabs)/profile')}
        style={[styles.avatar, { backgroundColor: theme.surfaceRaised, borderColor: theme.cardBorder }]}>
        <Icon name="person.crop.circle" size="md" color="textSecondary" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Space.lg,
    paddingBottom: Space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  iconBox: {
    width: 28,
    height: 28,
    borderRadius: Radius.sm,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wordmark: Type.wordmark,
  dot: { width: 6, height: 6, borderRadius: Radius.pill },
  avatar: {
    width: HitTarget - 12,
    height: HitTarget - 12,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
