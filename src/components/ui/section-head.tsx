import { Children, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Space, Type } from '@/design/tokens';

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
export function SectionHead({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <View style={styles.head}>
      <ThemedText type="caption" themeColor="textSecondary" style={styles.tracked}>
        {title.toUpperCase()}
      </ThemedText>
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
});
