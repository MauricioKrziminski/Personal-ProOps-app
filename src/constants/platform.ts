import { Platform } from 'react-native';

/**
 * iOS 26 ou mais novo — a MESMA conta que o `react-native-screens` faz para decidir se embrulha a
 * tela num `SafeAreaView` de topo (`PlatformUtils.ts`). Por isso ela é a versão do sistema, e não
 * `supportsLiquidGlass()`: o que importa aqui é o comportamento do RNS, não o vidro. O porquê de a
 * pilha precisar disso está no `headerTransparent` de `app/_layout.tsx`.
 */
export const IOS_26_OU_MAIS = Platform.OS === 'ios' && parseInt(String(Platform.Version), 10) >= 26;
