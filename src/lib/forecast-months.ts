/**
 * A projeção diária, agrupada por mês.
 *
 * A RPC `cash_flow_forecast` devolve uma linha POR DIA com `balance_cents` já acumulado — é uma
 * soma corrida, não um saldo do dia. Então o saldo de um mês é o do ÚLTIMO dia dele, nunca a
 * soma dos dias: somar acumulados conta o mesmo dinheiro N vezes.
 *
 * `entra`/`sai`, ao contrário, são fluxo do dia e SOMAM dentro do mês.
 *
 * Isto existe porque a planilha do dono do produto tem exatamente esta tabela (uma aba por mês,
 * com o saldo do mês anterior entrando no seguinte) e o app só sabia mostrar dia a dia.
 */

export type DiaProjetado = {
  day: string;
  in_cents: number | string;
  out_cents: number | string;
  balance_cents: number | string;
};

export type MesProjetado = {
  /** `2026-11` */
  mes: string;
  entra: number;
  sai: number;
  /** Saldo no último dia do mês — o acumulado, que é o que a planilha chama de "Saldo". */
  saldo: number;
  /** Primeiro dia DENTRO deste mês em que o acumulado fica negativo. */
  primeiroNegativo: string | null;
  /** O mês está inteiro na série, ou é o mês em que o horizonte corta? */
  parcial: boolean;
};

/**
 * Agrupa preservando a ordem cronológica que a RPC já devolve.
 *
 * ⚠️ **Não reordena.** `balance_cents` só faz sentido na ordem em que veio; ordenar por outra
 * coisa e pegar "o último" devolveria o saldo de um dia qualquer.
 */
export function agruparPorMes(serie: DiaProjetado[]): MesProjetado[] {
  const meses: MesProjetado[] = [];
  let atual: MesProjetado | null = null;

  for (const dia of serie) {
    const mes = dia.day.slice(0, 7);
    if (!atual || atual.mes !== mes) {
      atual = { mes, entra: 0, sai: 0, saldo: 0, primeiroNegativo: null, parcial: false };
      meses.push(atual);
    }
    atual.entra += Number(dia.in_cents);
    atual.sai += Number(dia.out_cents);
    // sobrescreve a cada dia: no fim do laço sobra o último dia do mês
    atual.saldo = Number(dia.balance_cents);
    if (atual.primeiroNegativo === null && Number(dia.balance_cents) < 0) {
      atual.primeiroNegativo = dia.day;
    }
  }

  // O último mês quase sempre está cortado no meio pelo horizonte (90 dias a partir de hoje não
  // termina em dia 31). Dizer o saldo "do mês" ali seria mentira — a tela precisa saber para
  // rotular. O primeiro também: a série começa HOJE, não no dia 1.
  const ultimo = meses[meses.length - 1];
  if (ultimo) {
    const fim = serie[serie.length - 1].day;
    const ultimoDiaDoMes = new Date(
      Number(fim.slice(0, 4)),
      Number(fim.slice(5, 7)),
      0,
    ).getDate();
    ultimo.parcial = Number(fim.slice(8, 10)) < ultimoDiaDoMes;
  }
  if (meses[0] && serie[0] && Number(serie[0].day.slice(8, 10)) > 1) {
    meses[0].parcial = true;
  }

  return meses;
}

/**
 * O mês a partir do qual a linha deixa de ser lançamento real e passa a sair da regra.
 *
 * `recurring_covered_until` é a data até onde o cron materializou as recorrentes. Depois dela a
 * projeção continua — a migration `20260910140000` expande a regra —, mas a natureza do número
 * muda, e o usuário tem direito de saber onde. Devolve `null` quando tudo no horizonte é real.
 */
export function mesDoCorte(meses: MesProjetado[], cobertoAte: string | null): string | null {
  if (!cobertoAte) return null;
  const corte = cobertoAte.slice(0, 7);
  return meses.some((m) => m.mes > corte) ? corte : null;
}
