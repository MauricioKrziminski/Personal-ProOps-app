import { StyleSheet, View } from 'react-native';

import { SearchField } from '@/components/ui/search-field';
import { MaxContentWidth } from '@/constants/theme';
import { Space } from '@/design/tokens';
import type { SearchProps } from './search.types';

/**
 * A busca — **implementação padrão** (Android e web).
 *
 * Uma pílula no corpo da tela, com os tokens do app. O iOS sobrescreve em `search.ios.tsx` com a
 * barra nativa; ver o cabeçalho de lá para o porquê da divisão.
 *
 * `hideWhenScrolling` é aceito e ignorado aqui de propósito: o contrato é único
 * (`search.types.ts`) e quem tem esse comportamento é a barra nativa.
 */
export function Search({
  value,
  onChangeText,
  placeholder,
  autoFocus = false,
  accessibilityLabel,
  gutter = false,
}: SearchProps) {
  return (
    <View style={[styles.slot, gutter && styles.gutter]}>
      <SearchField
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        autoFocus={autoFocus}
        accessibilityLabel={accessibilityLabel}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  slot: {
    marginBottom: Space.md,
  },
  /** A calha padrão do app, igual à da lista — inclusive o teto de largura em tablet. */
  gutter: {
    marginTop: Space.md,
    paddingHorizontal: Space.lg,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
});
