import { ScrollView as GestureScrollView } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';

/**
 * A rolagem que CONVIVE com o arrasto.
 *
 * ⚠️ **Não é o `Animated.ScrollView` do Reanimated, e a diferença decide se o gesto existe.**
 * Aquele embrulha o `ScrollView` do React Native, que no Android é uma view NATIVA de rolagem:
 * ela captura o toque assim que o dedo anda na vertical e nunca devolve. O `Pan` da alça, que só
 * ativa depois de 4px, perde a corrida — `onStart` não roda, então nem o `scrollEnabled={false}`
 * do `onDragStateChange` chega a ser chamado. O arrasto simplesmente não acontece, sem erro.
 *
 * O `ScrollView` do `react-native-gesture-handler` participa do MESMO sistema de reconhecedores
 * que o `Pan`, e aí a disputa é resolvida em vez de ganha por quem chegou primeiro. Desligar a
 * rolagem durante o arrasto continua valendo — as duas coisas são complementares, não
 * alternativas: uma deixa o gesto começar, a outra impede que ele brigue depois.
 *
 * O `ref` continua sendo `AnimatedRef<Animated.ScrollView>`: por baixo é o mesmo `ScrollView`, e
 * é o que `scrollTo`, `useScrollViewOffset` e o auto-scroll do `Reorderable` esperam.
 */
/**
 * O tipo é o do `Animated.ScrollView` de propósito: as props são as mesmas (o componente do
 * gesture-handler é um `ScrollView` com os reconhecedores por fora), e é esse tipo que aceita o
 * `AnimatedRef` sem cast em cada chamada. O cast fica AQUI, uma vez, com o motivo escrito.
 */
export const DragScrollView = Animated.createAnimatedComponent(
  GestureScrollView
) as unknown as typeof Animated.ScrollView;
