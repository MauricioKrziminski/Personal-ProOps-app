import { SymbolView, type SymbolViewProps } from 'expo-symbols';

import { IconSize } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';
import type { ThemeColor } from '@/constants/theme';

type IconName = SymbolViewProps['name'];

interface IconProps {
  /**
   * SF Symbol (iOS) — `expo-symbols` já mapeia para Material Symbols no Android e web.
   * Quando o nome do Android precisar ser diferente, passar `{ ios, android }`.
   */
  name: IconName;
  size?: keyof typeof IconSize | number;
  /** Chave de cor do tema. Ícone nunca recebe hex. */
  color?: ThemeColor;
  weight?: SymbolViewProps['weight'];
}

/**
 * O único caminho para ícone no app.
 *
 * Existe para matar dois padrões: emoji fazendo papel de ícone (proibido pela regra de design) e
 * glyph de texto (`‹` no voltar, `＋` no FAB) desenhado à mão.
 */
export function Icon({ name, size = 'md', color = 'text', weight = 'regular' }: IconProps) {
  const theme = useTheme();
  const px = typeof size === 'number' ? size : IconSize[size];

  return <SymbolView name={name} size={px} tintColor={theme[color]} weight={weight} />;
}
