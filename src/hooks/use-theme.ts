/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export function useTheme() {
  const scheme = useColorScheme();
  const theme = scheme === 'unspecified' ? 'light' : scheme;

  return Colors[theme];
}

/**
 * Estilo dos ícones da status bar — claro ou escuro.
 *
 * Existe porque **no Android o padrão do `react-native-screens` é `light`** (a doc é explícita:
 * "`auto` e `inverted` são suportados só no iOS; no Android caem para `light`"). Ou seja: em toda
 * tela de fundo claro o relógio e a bateria saem brancos sobre branco e simplesmente somem — foi
 * o que aconteceu no app inteiro, invisível enquanto o topo tinha uma faixa branca por cima.
 *
 * Vai como `screenOptions.statusBarStyle` de cada `<Stack>`, e NÃO como `<StatusBar>` de
 * `expo-status-bar` dentro da tela: o componente aplica o estilo na MONTAGEM, e a `NativeTabs`
 * mantém as abas montadas — então o `style="light"` da Hoje vazava para Notas e Perfil e ficava
 * lá. A opção do navegador é aplicada no FOCO, que é o comportamento certo por construção.
 */
export function useBarStyle(): 'light' | 'dark' {
  return useColorScheme() === 'dark' ? 'light' : 'dark';
}
