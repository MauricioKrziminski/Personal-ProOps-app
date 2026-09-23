import { Platform } from 'react-native';
import { LinearTransition } from 'react-native-reanimated';

import { Motion } from '@/design/tokens';

/**
 * A transição de LAYOUT do app (o `layout=` do Reanimated) — e, no Android, nenhuma.
 *
 * ⚠️ **No Android a view com `layout` fica PRESA no primeiro quadro** (medido em 23/09/2026,
 * RN 0.86 + Reanimated 4.5, nova arquitetura). Quando o conteúdo acima dela muda de altura, ela
 * continua desenhada — e tocável — na posição e no tamanho ANTIGOS, enquanto as irmãs sem
 * `layout` vão para o lugar novo: abrir o calendário do "Quando" deixava o `SelectField` do
 * "Repetir" por cima do próprio rótulo; abrir a lista de contas do lançamento deixava a data e o
 * "Já saiu do caixa" desenhados sobre as opções, e o toque nelas não chegava (a moldura nativa
 * ficou com a altura de antes). Provado tirando a transição de UM componente: o defeito some ali
 * e continua nos vizinhos.
 *
 * É a mesma família do "repouso escrito pelo React" (`design.md` §5): atualização do Reanimated
 * que não chega à tela no Android. Aqui não há repouso a escrever — o layout é do Yoga —, então
 * o Android fica com o comportamento da plataforma: o conteúdo se reorganiza de uma vez, sem
 * deslizar. O iOS mantém o deslize.
 *
 * Uma instância só: `LinearTransition` recriado a cada render remonta a animação.
 */
export const transicaoDeLayout =
  Platform.OS === 'android' ? undefined : LinearTransition.duration(Motion.duration.base);

/** A mesma, na duração curta — reordenar blocos de uma lista que a pessoa está lendo. */
export const transicaoDeLayoutRapida =
  Platform.OS === 'android' ? undefined : LinearTransition.duration(Motion.duration.fast);
