/**
 * A forma de um mês projetado, e o aviso do corte.
 *
 * ⚠️ **O AGRUPAMENTO saiu daqui em 10/09/2026** (`20260911001500`). Ele virava 3.651 linhas
 * diárias baixadas para desenhar ~120 números — 288 KB contra 13 KB —, e agrupar no cliente
 * punha aritmética de dinheiro numa segunda linguagem, longe da projeção que a produz. Agora é
 * `private.month_group`, com as 9 asserções portadas para `supabase/tests/month_forecast.sql`.
 *
 * O que ficou é `mesDoCorte`, que não é aritmética: é a regra de QUANDO avisar.
 */

/** O que `month_forecast_json` devolve: o saldo de hoje mais os meses. */
export type ProjecaoMensal = { hoje: number; meses: MesProjetado[] };

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
