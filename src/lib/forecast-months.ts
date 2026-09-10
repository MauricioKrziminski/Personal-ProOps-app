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
  /**
   * As bordas REAIS do ciclo — que só são o mês civil quando o usuário não mudou nada.
   *
   * Com fechamento no dia 10, "Outubro" vai de 11/09 a 10/10. O rótulo continua sendo um mês
   * porque é assim que a pessoa fala ("o que sobrou em outubro"), mas o intervalo tem que
   * aparecer: sem ele, quem configurou o ciclo lê "Outubro" e procura o dia 1º.
   */
  de: string;
  ate: string;
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

/**
 * Com quanto o mês COMEÇOU — a sobra que veio do mês anterior.
 *
 * É a linha que faltava para a Projeção ser a planilha do dono do produto. A tela já mostrava o
 * `saldo` acumulado (a série de caixa é cumulativa desde sempre), mas sem o ponto de partida
 * escrito não dava para reconhecer a conta: *"o que importa é o que de fato restou para eu
 * gastar esse mês contando com o que restou do mês anterior"*. Salário caindo num mês e fatura
 * vencendo no começo do outro é exatamente o caso em que olhar mês isolado engana.
 *
 * Sai por SUBTRAÇÃO em vez de vir do mês anterior no array, e isso é de propósito: no primeiro
 * mês não existe anterior, e o valor certo lá é o saldo em conta de hoje ANTES dos vencimentos
 * de hoje (R$ 0,72 em produção em 10/09/2026) — nem o `hoje` do payload, que já desconta o que
 * vence hoje, nem zero. A subtração acerta os dois casos com uma conta só, e como ela é a
 * identidade da série (`saldo = veio + entra − sai`), uma quebra futura aparece como número que
 * não fecha, e não como linha faltando.
 */
export function veioDe(m: Pick<MesProjetado, 'saldo' | 'entra' | 'sai'>): number {
  return Number(m.saldo) - Number(m.entra) + Number(m.sai);
}
