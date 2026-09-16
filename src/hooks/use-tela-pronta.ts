/**
 * O portão de carregamento de uma tela — a versão com TRAVA, que é a que as telas usam.
 *
 * A regra pura mora em `lib/tela-pronta.ts` (e é lá que ela é testada). Aqui entra a única coisa
 * que precisa do React: **depois de abrir, o portão não fecha mais.**
 *
 * ## Por que travar
 *
 * ⚠️ **`isPending` não quer dizer "primeira carga" — quer dizer "sem dado para esta CHAVE".**
 * Trocar o mês no Financeiro dá chaves novas a `transactions_summary`, `budgets_status` e
 * `cycle_series`: as três voltam a `pending`, e um portão sem trava apagaria a tela inteira —
 * incluindo a carteira de cartões, as dívidas e a tendência mensal, que não dependem do mês e
 * já estavam na tela. Seria a pipoca ao contrário, e pior: em vez de blocos chegando fora de
 * hora, blocos SUMINDO.
 *
 * A divisão de trabalho que sai disso:
 *
 * | quem | cobre |
 * |---|---|
 * | este portão | a PRIMEIRA carga da tela — uma vez, e acabou |
 * | os portões de cada bloco (`isLoading` onde já existiam) | as recargas por troca de mês |
 *
 * Por isso a Fase 5 **não** removeu os portões internos: ela pôs um portão a mais, por fora.
 */

import { useState } from 'react';

import { telaPronta, type Consulta } from '@/lib/tela-pronta';

export type { Consulta };

/**
 * A tela já pode sair do skeleton? Uma vez `true`, sempre `true`.
 *
 * ⚠️ **Só CONSULTAS, nunca booleano** — ver `telaPronta`. E nunca um `&&` do lado de fora: ali
 * a condição escapa da trava e a troca de mês apaga a tela inteira.
 */
export function useTelaPronta(...consultas: Consulta[]): boolean {
  const [abriu, setAbriu] = useState(false);
  const pronta = telaPronta(...consultas);
  /*
    `setState` durante o render, no PRÓPRIO componente: é o padrão que o React documenta para
    estado derivado ("ajustar o estado quando as props mudam"), e ele não causa render extra
    visível — o React refaz o render antes de pintar. A alternativa seria escrever num `ref`
    durante o render, que o compilador do React barra com razão.
  */
  if (pronta && !abriu) setAbriu(true);
  return abriu || pronta;
}
