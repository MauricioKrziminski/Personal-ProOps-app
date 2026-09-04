import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';
import { useKeyboardState } from 'react-native-keyboard-controller';

/**
 * A altura que o teclado ocupa agora, em pontos. `0` com ele fechado.
 *
 * Usa o evento NATIVO do React Native, não o `useKeyboardState` do
 * `react-native-keyboard-controller`. Os dois existem no projeto e fazem coisas
 * diferentes: a biblioteca serve para acompanhar a CURVA de abertura em worklet
 * (é o que a barra de blocos da nota precisa), e este hook serve para uma conta
 * de layout — quanto tirar do fim de uma coluna.
 *
 * **Duas fontes, e vale a maior.** O par foi verificado funcionando no emulador
 * Android 16 em 04/09/2026 — a lista cede a altura certa e a barra de escrita
 * fica acima do teclado. O que NÃO foi possível determinar é qual das duas
 * dispara ali: isolar cada uma exigia um ciclo de recarga que apagava o cache da
 * conversa. Manter as duas custa uma linha e não muda nada onde ambas respondem,
 * porque elas respondem o mesmo número; escolher uma seria apostar sem medida.
 *
 * `Will` no iOS e `Did` no Android é a diferença que importa: só o iOS emite os
 * eventos `Will*`, e usar `Did*` lá faria o layout pular DEPOIS da animação do
 * teclado, em vez de junto com ela.
 */
export function useKeyboardHeight(): number {
  const [altura, setAltura] = useState(0);
  const daBiblioteca = useKeyboardState((estado) => estado.height);

  useEffect(() => {
    const ios = Platform.OS === 'ios';
    const mostrar = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow', (e) =>
      setAltura(e.endCoordinates.height),
    );
    const esconder = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide', () =>
      setAltura(0),
    );
    return () => {
      mostrar.remove();
      esconder.remove();
    };
  }, []);

  return Math.max(altura, daBiblioteca);
}
