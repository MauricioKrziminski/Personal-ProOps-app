import { Stack } from 'expo-router';

import { useTheme } from '@/hooks/use-theme';
import type { SearchProps } from './search.types';

/**
 * A busca no **iOS** — a barra nativa do header.
 *
 * Aqui o nativo ganha sem discussão: integra com o large title, some no scroll e é a busca que o
 * usuário do iPhone já conhece. No Android ele desenha uma laje de **canto 0** — o único elemento
 * fora da escala `Radius` — e a API expõe cor, não forma; por isso lá o padrão (`search.tsx`) é
 * uma pílula no corpo.
 *
 * Este arquivo **não desenha nada no corpo da tela**: `Stack.SearchBar` escreve opções por hook e
 * retorna `null`. É o que permite o mesmo `<Search>` ficar, no JSX, exatamente onde o campo deve
 * aparecer no Android — sem abrir buraco aqui. Por isso `gutter` é ignorado.
 */
export function Search({
  onChangeText,
  placeholder,
  autoFocus = false,
  hideWhenScrolling,
}: SearchProps) {
  const theme = useTheme();

  return (
    <Stack.SearchBar
      // A barra nativa NÃO herda o tema. `tintColor` é o caret e o "Cancelar" daqui;
      // `hintTextColor` e `headerIconColor` existem para o Android e são inofensivos.
      barTintColor={theme.backgroundElement}
      textColor={theme.text}
      hintTextColor={theme.textSecondary}
      headerIconColor={theme.text}
      tintColor={theme.tint}
      placement="automatic"
      autoCapitalize="none"
      autoFocus={autoFocus}
      hideWhenScrolling={hideWhenScrolling}
      placeholder={placeholder}
      // A barra nativa é NÃO-CONTROLADA: ela guarda o próprio texto e só avisa quando muda. Por
      // isso `value` entra no contrato (o Android precisa) e não é repassado aqui.
      onChangeText={(e) => onChangeText(e.nativeEvent.text)}
      onCancelButtonPress={() => onChangeText('')}
    />
  );
}
