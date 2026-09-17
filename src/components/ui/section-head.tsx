import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Space, Type } from '@/design/tokens';

/**
 * Rótulo do card de destaque: pequeno, cinza e em caixa normal, como o "Available balance" dos
 * vídeos de referência. É o contraste de escala (12 → 40) que faz o valor virar protagonista.
 *
 * Existe como componente porque o mesmo card aparece em Hoje, Financeiro, Projeção e Patrimônio —
 * e estava escrito diferente em cada uma.
 */
export function HeroLabel({
  children,
  accessibilityLabel,
}: {
  children: ReactNode;
  /** Só quando o texto visível precisa soar diferente para leitor de tela. */
  accessibilityLabel?: string;
}) {
  return (
    <ThemedText
      type="meta"
      themeColor="textSecondary"
      accessibilityLabel={accessibilityLabel}>
      {children}
    </ThemedText>
  );
}

/**
 * Cabeçalho de bloco com ação opcional à direita ("Ver tudo").
 *
 * Título em tinta, 14/600 e caixa normal — o "Recent transactions" dos vídeos. O mesmo desenho do
 * `title` do `Section`: sem isto cada tela inventava o seu, e o olho lia dois apps.
 */
export function SectionHead({
  title,
  action,
  inset = true,
}: {
  title: string;
  action?: ReactNode;
  /** Desliga a calha lateral quando a tela já tem a sua (`Screen` com padding próprio). */
  inset?: boolean;
}) {
  return (
    <View style={[styles.head, !inset && styles.flush]}>
      <ThemedText type="smallBold" style={styles.titulo}>
        {title}
      </ThemedText>
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  titulo: { letterSpacing: Type.headline.letterSpacing },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Space.lg,
  },
  flush: { paddingHorizontal: 0 },
});
