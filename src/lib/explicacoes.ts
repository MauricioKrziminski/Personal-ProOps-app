import { isoToBR } from './dates.ts';
import type { EmergencyReserveState, EmergencyReserveSummary } from './emergency-reserve.ts';
import type { InvestmentPosition } from './investment.ts';
import type { PlanState } from './budget-plan.ts';

/**
 * F17 — "Como é calculado". Uma função pura por indicador, que recebe o PAYLOAD que desenhou o
 * número e devolve as linhas da explicação. Nenhum período, janela ou base é escrito à mão: sai do
 * mesmo objeto. Sem base para afirmar (carregando, erro, sem número) devolve `null` e o (i) não
 * existe. Valor em dinheiro entra pelo `brl` que a tela passa (`useBRL`), então "ocultar valores"
 * vale aqui sem este arquivo saber de máscara.
 *
 * Quando um dado novo é preciso (a janela do score), a RPC passa a devolvê-lo: texto fixo que
 * diverge do cálculo é pior que explicação nenhuma.
 */
export interface Explicacao {
  oQueConta: string;
  /** As datas REAIS da resposta, nunca "este mês". */
  periodo: string;
  fonte: string;
  /** Só quando a resposta marca estimativa ou dado insuficiente. */
  qualidade?: string;
  /** A tela que lista exatamente o que foi somado, na mesma lente e janela. */
  verItens?: { label: string; href: string | { pathname: string; params: Record<string, string> } };
}

const intervalo = (de: string, ate: string) => `${isoToBR(de)} a ${isoToBR(ate)}`;

/** Último dia de um mês dado pelo primeiro (`2026-08-01` → `2026-08-31`). */
export function ultimoDiaDoMes(primeiroDia: string): string {
  const [y, m] = primeiroDia.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Saúde financeira: a janela vem de `financial_health()` (`window_from`/`window_to`). */
export function explicaSaude(h: { window_from?: string | null; window_to?: string | null } | null | undefined): Explicacao | null {
  if (!h?.window_from || !h.window_to) return null;
  return {
    oQueConta: 'Nota de 0 a 100 que soma poupança, limites respeitados, meses de gasto cobertos pelo caixa e peso das dívidas.',
    periodo: `Receitas e despesas pagas de ${intervalo(h.window_from, h.window_to)}, sem transferências; limites, caixa e dívidas, de hoje.`,
    fonte: 'Seus lançamentos pagos, seus orçamentos e seu patrimônio.',
  };
}

/** Reserva de emergência: base `manual` ou `observed`, e os meses fechados que sustentam a média. */
export function explicaReserva(
  state: EmergencyReserveState | null | undefined,
  summary: EmergencyReserveSummary | null | undefined,
  brl: (cents: number) => string,
): Explicacao | null {
  if (!state || !summary || !state.config) return null;
  const meses = state.config.target_months;
  const observado = state.config.base_mode === 'observed';
  const primeiro = state.months[0]?.month;
  const ultimo = state.months[state.months.length - 1]?.month;
  const saldos = `Saldos de ${isoToBR(state.as_of)}.`;
  const periodo = observado && primeiro && ultimo
    ? `${saldos} Gasto essencial: média dos meses fechados de ${intervalo(primeiro, ultimoDiaDoMes(ultimo))}.`
    : `${saldos} Gasto essencial: o valor mensal que você informou.`;
  const qualidades: string[] = [];
  if (!observado) qualidades.push('Estimado: a base é o valor informado, não medido nos seus gastos.');
  else if (summary.baseStatus === 'unreviewed') qualidades.push('Dados insuficientes: revise os três meses fechados para calcular a base.');
  else if (summary.baseStatus === 'incomplete_classification') qualidades.push('Dados insuficientes: há gastos sem necessidade classificada nesses meses.');
  else if (summary.baseStatus === 'zero_base') qualidades.push('Dados insuficientes: os meses revisados não têm gasto essencial.');
  if (summary.unbackedCents > 0) qualidades.push(`${brl(summary.unbackedCents)} separados estão sem saldo ou disponibilidade que os sustente hoje.`);
  return {
    oQueConta: `O que você separou com lastro hoje, dividido pelo gasto essencial mensal (alvo: esse gasto vezes ${meses} ${meses === 1 ? 'mês' : 'meses'}).`,
    periodo,
    fonte: observado
      ? 'Seus gastos marcados como essenciais e as fontes que você separou.'
      : 'O valor que você informou e as fontes que você separou.',
    ...(qualidades.length ? { qualidade: qualidades.join(' ') } : {}),
  };
}

/** Orçamento por categoria: a janela é a MESMA da lista (`useMonthRange`, já resolvida pela régua). */
export function explicaOrcamento(janela: { from: string; to: string; pronto: boolean } | null | undefined): Explicacao | null {
  if (!janela?.pronto) return null;
  return {
    oQueConta: 'O gasto é o que já aconteceu na categoria, com as parcelas de cartão; o aviso soma também o previsto.',
    periodo: intervalo(janela.from, janela.to),
    fonte: 'Seus lançamentos e os limites que você definiu.',
  };
}

/** Projeção: do saldo de hoje até o último dia pedido; recorrente além do materializado vem da regra. */
export function explicaProjecao(p: {
  de: string;
  ate: string;
  /** `YYYY-MM` do último mês com lançamento gravado (`mesDoCorte`), ou `null` se a janela toda está gravada. */
  corteMes: string | null;
  simulando: boolean;
}): Explicacao {
  const qualidades: string[] = [];
  if (p.corteMes) {
    const [y, m] = p.corteMes.split('-');
    qualidades.push(`Depois de ${m}/${y}, as recorrentes vêm da regra de cada uma, não de lançamentos já gravados.`);
  }
  if (p.simulando) qualidades.push('Inclui as hipóteses do simulador.');
  return {
    oQueConta: 'Saldo das contas hoje mais o que entra e menos o que sai nas datas previstas (o cartão, no vencimento da fatura).',
    periodo: `De ${isoToBR(p.de)} a ${isoToBR(p.ate)}.`,
    fonte: 'Seus lançamentos previstos, faturas, parcelas e a regra das recorrentes.',
    ...(qualidades.length ? { qualidade: qualidades.join(' ') } : {}),
  };
}

/**
 * Investimentos (a lista de posições). O período cobre da posição mais antiga à atualização de valor
 * mais recente; a qualidade resume as que não têm resultado conhecido — a palavra de cada uma mora
 * na própria posição (`frasesDaPosicao`).
 */
export function explicaInvestimentos(posicoes: readonly InvestmentPosition[] | null | undefined): Explicacao | null {
  if (!posicoes || posicoes.length === 0) return null;
  const aberturas = posicoes.map((p) => p.opening_on).filter((d): d is string => Boolean(d)).sort();
  const valores = posicoes.map((p) => p.last_valuation_on).filter((d): d is string => Boolean(d)).sort();
  const de = aberturas[0] ? isoToBR(aberturas[0]) : 'o primeiro movimento';
  const ate = valores.length ? isoToBR(valores[valores.length - 1]) : 'a última atualização de valor (ainda não houve)';
  const incertas = posicoes.filter((p) => p.result_quality !== 'conhecido');
  const semValor = incertas.filter((p) => p.result_quality === 'indisponível').length;
  const estimadas = incertas.length - semValor;
  const partes = [
    estimadas ? `${estimadas} ${estimadas === 1 ? 'posição com resultado estimado' : 'posições com resultado estimado'}: o saldo inicial pode já conter ganho.` : '',
    semValor ? `${semValor} ${semValor === 1 ? 'posição sem' : 'posições sem'} atualização de valor: resultado indisponível.` : '',
  ].filter(Boolean);
  return {
    oQueConta: 'O resultado é o valor da última atualização menos o aplicado (o que entrou menos o que saiu).',
    periodo: `Desde ${de} até ${ate}.`,
    fonte: 'Os movimentos e as atualizações de valor que você registrou.',
    ...(partes.length ? { qualidade: partes.join(' ') } : {}),
  };
}

/**
 * O painel do ciclo no Financeiro: o período são as bordas REAIS da linha da `cycle_series` que
 * desenhou o número, e "Ver os itens" abre o ciclo com o `mes` e a `view` da própria tela (nunca um
 * default: a régua é de cada tela). Sem a linha do ciclo, não há (i).
 */
export function explicaCiclo(
  ciclo: { ini: string; fim: string } | null | undefined,
  tela: { month: string; view?: string | null },
): Explicacao | null {
  if (!ciclo) return null;
  return {
    oQueConta: 'O caixa de hoje mais o que ainda entra, menos o que vence até o fim do ciclo (contas, faturas e parcelas).',
    periodo: `${intervalo(ciclo.ini, ciclo.fim)}.`,
    fonte: 'Seus lançamentos, as faturas no vencimento e as parcelas.',
    verItens: {
      label: 'Ver o que fecha o ciclo',
      href: { pathname: '/finance/cycle', params: { month: tela.month, ...(tela.view ? { view: tela.view } : {}), tipo: 'tudo' } },
    },
  };
}

/** Plano de orçamento (F14): o período é o do estado do plano, o mesmo que somou o realizado. */
export function explicaPlano(state: Pick<PlanState, 'period_start' | 'period_end' | 'income_cents' | 'plan'> | null | undefined): Explicacao | null {
  if (!state?.plan) return null;
  return {
    oQueConta: '% da renda-base informada; realizado = gastos lançados no período ÷ renda que entrou.',
    periodo: `${intervalo(state.period_start, state.period_end)}.`,
    fonte: 'O plano que você salvou e os seus lançamentos.',
    ...(state.income_cents === 0 ? { qualidade: 'Sem renda lançada neste período.' } : {}),
  };
}

/** Por que mudou (F15): os dois períodos são os parâmetros da tela, os mesmos que a RPC recebeu. */
export function explicaMudanca(p: { curFrom: string; curTo: string; prevFrom: string; prevTo: string } | null | undefined): Explicacao | null {
  if (!p) return null;
  return {
    oQueConta: 'Diferença do gasto lançado por data entre os dois períodos; cada linha é quanto ela contribuiu.',
    periodo: `${intervalo(p.curFrom, p.curTo)} contra ${intervalo(p.prevFrom, p.prevTo)}.`,
    fonte: 'Seus lançamentos de gasto, sem transferências nem principal de fatura adiada.',
  };
}
