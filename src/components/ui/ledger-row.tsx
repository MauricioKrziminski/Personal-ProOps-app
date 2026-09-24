import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Icon, type IconName } from '@/components/ui/icon';
import { Money } from '@/components/ui/money';
import { Fonts, type ThemeColor } from '@/constants/theme';
import { HitTarget, Radius, Space, tabular } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

/** Prévia da citação (o corpo inteiro está a um toque, no detalhe) — §7. */
const CITACAO = 90;

/**
 * A linha de lançamento das raízes: selo de categoria, título, meta, valor e data empilhados, e
 * — quando o lançamento veio de uma fala — a citação do que a pessoa disse.
 *
 * Mesmo contrato do `Row` para o `ItemLink`: no iOS ela vem SEM `onLongPress` (quem abre o menu
 * lá é o `Link.Menu`) e COM o `onPress` que o `<Link asChild>` injeta. Sem nenhum dos dois ela é
 * uma `View`; com qualquer um, um `Pressable` que repassa os dois. Desenhada como `View` só por
 * faltar o `onLongPress`, a linha jogava o `onPress` fora e tocar no lançamento não abria nada no
 * iPhone (24/09/2026). Feedback de linha é highlight, nunca escala (§5).
 */
export function LedgerRow({
  title,
  subtitle,
  icon,
  cents,
  signed,
  tone,
  date,
  quote,
  onPress,
  onLongPress,
  accessibilityLabel,
}: {
  title: string;
  subtitle?: string;
  icon: IconName;
  cents: number;
  signed: boolean;
  tone: ThemeColor | 'plain';
  date: string;
  quote?: string | null;
  /** Injetado pelo `<Link asChild>` do `ItemLink` — nunca escrito pela tela. */
  onPress?: () => void;
  onLongPress?: () => void;
  accessibilityLabel: string;
}) {
  const theme = useTheme();
  const citacao = quote ? (quote.length > CITACAO ? `${quote.slice(0, CITACAO).trimEnd()}…` : quote) : null;

  const conteudo = (pressed: boolean) => (
    <View style={[styles.linha, { backgroundColor: pressed ? theme.backgroundSelected : 'transparent' }]}>
      <View style={[styles.selo, { backgroundColor: theme.backgroundElement }]}>
        <Icon name={icon} size="md" color="text" />
      </View>
      <View style={styles.textos}>
        <ThemedText type="default">{title}</ThemedText>
        {subtitle ? (
          <ThemedText type="footnote" themeColor="textSecondary">
            {subtitle}
          </ThemedText>
        ) : null}
        {citacao ? (
          <ThemedText
            type="footnote"
            themeColor="textSecondary"
            style={[styles.italico, styles.citacao]}>
            {`“${citacao}”`}
          </ThemedText>
        ) : null}
      </View>
      <View style={styles.direita}>
        <Money cents={cents} variant="ticker" tone={tone} signed={signed} />
        <ThemedText type="caption" themeColor="textSecondary" style={tabular}>
          {date}
        </ThemedText>
      </View>
    </View>
  );

  if (!onPress && !onLongPress) return conteudo(false);
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel}>
      {({ pressed }) => conteudo(pressed)}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // A mesma válvula do `Row`: o valor desce de linha antes de o título partir (minWidth medido).
  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Space.md,
    minHeight: HitTarget,
    paddingVertical: Space.md,
    paddingHorizontal: Space.lg,
  },
  selo: { width: 40, height: 40, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  textos: { flexGrow: 1, flexShrink: 1, minWidth: 134, gap: 2 },
  // As aspas já marcam a citação; um trilho colorido ao lado seria a segunda marca do mesmo fato.
  citacao: { marginTop: Space.xs },
  italico: { flex: 1, fontFamily: Fonts.italic },
  direita: { alignItems: 'flex-end', gap: Space.half, marginLeft: 'auto' },
});
