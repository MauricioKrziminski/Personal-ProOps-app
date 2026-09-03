import { Children, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Radius, Space, Type } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import type { ThemeColor } from '@/constants/theme';

/**
 * Rótulo do card de destaque.
 *
 * Micro-etiqueta em caixa alta contra o número grande: é o contraste de escala (12 → 40, 3,3×)
 * que faz o valor virar protagonista. Em corpo normal os dois competem e a tela vira platô.
 *
 * Existe como componente porque o mesmo card aparece em Hoje, Financeiro, Projeção e Patrimônio —
 * e estava escrito diferente em cada uma.
 */
export function HeroLabel({
  children,
  accessibilityLabel,
}: {
  children: ReactNode;
  /** Só quando o texto visível (sempre caixa alta) precisa soar diferente para leitor de tela. */
  accessibilityLabel?: string;
}) {
  return (
    <ThemedText
      type="caption"
      themeColor="textSecondary"
      style={styles.tracked}
      accessibilityLabel={accessibilityLabel}>
      {upper(children)}
    </ThemedText>
  );
}

/**
 * Caixa alta que sobrevive à interpolação.
 *
 * `typeof children === 'string'` sozinho não bastava: `<HeroLabel>Sobrou em {ano}</HeroLabel>`
 * entrega um ARRAY (`['Sobrou em ', 2026]`), caía no `else` e o rótulo saía em caixa mista.
 * Em Relatórios isso deixava "Sobrou em 2026" ao lado de "RECEBIDO" e "GASTO" — três rótulos do
 * mesmo card em duas grafias. Falha silenciosa: nada quebra, só fica torto.
 */
function upper(children: ReactNode): ReactNode {
  const parts = Children.toArray(children);
  if (parts.length > 0 && parts.every((c) => typeof c === 'string' || typeof c === 'number')) {
    return parts.join('').toUpperCase();
  }
  return children;
}

/**
 * Cabeçalho de bloco com ação opcional à direita ("Ver tudo").
 *
 * Mesmo tratamento do `title` do `Section` — caixa alta, `caption`, tracking. Sem isto cada tela
 * inventava o seu: uma em `smallBold` 15/600, outra em caixa alta 12. O olho lê como dois apps.
 */
export function SectionHead({
  title,
  action,
  dot,
  inset = true,
}: {
  title: string;
  action?: ReactNode;
  /**
   * Ponto de status antes do rótulo — a assinatura de seção do design Stitch.
   *
   * É COR SEMÂNTICA, nunca decoração: `danger` para o que venceu, `warning` para o que está
   * apertado, `success` para o que chegou. Seção sem estado a comunicar não leva ponto.
   */
  dot?: ThemeColor;
  /** Desliga a calha lateral quando a tela já tem a sua (`Screen` com padding próprio). */
  inset?: boolean;
}) {
  const theme = useTheme();

  return (
    <View style={[styles.head, !inset && styles.flush]}>
      <View style={styles.titleWrap}>
        {dot ? <View style={[styles.dot, { backgroundColor: theme[dot] }]} /> : null}
        <ThemedText type="caption" themeColor="textSecondary" style={styles.tracked}>
          {title.toUpperCase()}
        </ThemedText>
      </View>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  /** Mesma etiqueta do `Section` — sai do token `Type.meta`, não de tracking à mão. */
  tracked: Type.meta,
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Space.lg,
  },
  flush: { paddingHorizontal: 0 },
  titleWrap: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  dot: { width: 6, height: 6, borderRadius: Radius.pill },
});
