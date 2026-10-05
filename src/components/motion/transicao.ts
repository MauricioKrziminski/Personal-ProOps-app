import { Platform } from 'react-native';
import { LinearTransition, useReducedMotion } from 'react-native-reanimated';

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
 * **E no iOS com Reduzir Movimento, também nenhuma** (05/10/2026): o Reanimated pula a animação
 * e a view fica no quadro antigo, igual ao Android — em Metas o cartão ficou 87 pt acima, por cima
 * de "Simular juntas", e o toque abria a folha da meta. `useReducedMotion` do Reanimated não é hook
 * de verdade: devolve a constante lida na abertura do app, a MESMA que decide pular a animação.
 *
 * Uma instância só: `LinearTransition` recriado a cada render remonta a animação.
 */
// eslint-disable-next-line react-hooks/rules-of-hooks -- constante do Reanimated, lida uma vez
const semTransicao = Platform.OS === 'android' || useReducedMotion();

export const transicaoDeLayout = semTransicao ? undefined : LinearTransition.duration(Motion.duration.base);

/** A mesma, na duração curta — reordenar blocos de uma lista que a pessoa está lendo. */
export const transicaoDeLayoutRapida = semTransicao ? undefined : LinearTransition.duration(Motion.duration.fast);
