import { SearchField } from '@/components/ui/search-field';
import type { SearchProps } from './search.types';

/**
 * A busca — **implementação padrão** (Android e web).
 *
 * Uma pílula com os tokens do app. O iOS sobrescreve em `search.ios.tsx` com a barra nativa; ver
 * o cabeçalho de lá para o porquê da divisão. Onde ela mora na tela é decisão do `Screen` (prop
 * `search`): uma faixa fixa entre o header e o conteúdo, que não rola.
 *
 * `hideWhenScrolling` é aceito e ignorado aqui de propósito: o contrato é único
 * (`search.types.ts`) e quem tem esse comportamento é a barra nativa.
 */
export function Search({ value, onChangeText, placeholder, autoFocus = false, accessibilityLabel }: SearchProps) {
  return (
    <SearchField
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      autoFocus={autoFocus}
      accessibilityLabel={accessibilityLabel}
    />
  );
}
