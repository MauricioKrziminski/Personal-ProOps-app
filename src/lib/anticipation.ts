/**
 * "E se…": adiantar parcelas — a escolha das parcelas e os drafts que ela vira.
 *
 * Não há aritmética de caixa aqui. O DIA de cada parcela e o valor presente vêm do banco
 * (`anticipation_candidates`, pela régua de `cash_flow_forecast`), e quem aplica o rascunho é
 * `private.draft_ocorrencias`. Este arquivo só decide QUAIS parcelas saem e empacota o resultado
 * no formato do motor: uma saída no dia do pagamento e um `cancel` por parcela, no dia em que
 * ela sairia. Spec: `docs/superpowers/specs/2026-09-21-e-se-adiantar-parcelas-design.md`.
 */

export type FonteAdiantavel = 'plan' | 'debt' | 'recurring';

export type ParcelaAdiantavel = {
  /** Nº da parcela no contrato; `null` em recorrente. */
  n: number | null;
  /** ISO — o dia em que ela sai do caixa na projeção. */
  day: string;
  cents: number;
  /** Valor presente no dia do pagamento (financiamento com taxa); igual a `cents` no resto. */
  pv_cents: number;
};

export type Adiantavel = {
  source: FonteAdiantavel;
  ref_id: string;
  title: string;
  account_name: string | null;
  total_n: number | null;
  taxa: number | null;
  events: ParcelaAdiantavel[];
};

export type Quais = 'ultimas' | 'proximas';

/**
 * O que dá para adiantar pagando no MÊS de `pagarEm`: só o que vence DEPOIS desse mês.
 *
 * ⚠️ A régua é o mês, não o dia (22/09/2026). O "Pagar em" escolhe um MÊS e o pagamento cai no
 * 1º dia dele; com a régua do dia, a parcela de 10/10 continuava "adiantável" pagando em
 * outubro, e a tv mostrava 9 parcelas em setembro E em outubro — a queixa foi literal: *"se eu
 * passo para outubro ele ainda fica com 9 parcelas"*. A parcela do próprio mês sai nele de todo
 * jeito; adiantar é trazer as dos meses SEGUINTES. Item sem nada depois do mês some da lista.
 *
 * Idempotente e só função do mês: ir e voltar entre meses sempre dá a mesma lista.
 */
export function adiantaveisNoMes(lista: Adiantavel[], pagarEm: string): Adiantavel[] {
  const mes = pagarEm.slice(0, 7);
  return lista
    .map((i) => ({ ...i, events: i.events.filter((e) => e.day.slice(0, 7) > mes) }))
    .filter((i) => i.events.length > 0);
}

/**
 * Quantas parcelas valem de fato: a pedida, ASSENTADA no que ainda dá para adiantar.
 *
 * ⚠️ O que dá para adiantar DEPENDE do mês do pagamento: só entra parcela dos meses seguintes
 * (`adiantaveisNoMes`). Escolher 8 pagando em setembro e trocar para dezembro deixa 5.
 * Em 22/09/2026 isso virou um erro que travava a hipótese; o dono do produto pediu o contrário —
 * *"o número de parcelas tem que diminuir automaticamente e não mostrar erro"*. O campo, o valor
 * sugerido e a hipótese leem ESTE número, então nenhum deles diz 8 enquanto outro grava 3. A
 * escolha original fica guardada: voltar para setembro devolve as 8.
 */
export function quantasQueCabem(item: Adiantavel | null, quantas: number): number {
  const pedida = Math.max(1, Math.floor(quantas) || 1);
  return item ? Math.min(pedida, Math.max(1, item.events.length)) : pedida;
}

/** As `quantas` parcelas escolhidas. Recorrente não tem fim: sempre as próximas. */
export function escolherParcelas(item: Adiantavel, quantas: number, quais: Quais): ParcelaAdiantavel[] {
  const n = Math.max(0, Math.min(quantas, item.events.length));
  if (n === 0) return [];
  return quais === 'ultimas' && item.source !== 'recurring'
    ? item.events.slice(-n)
    : item.events.slice(0, n);
}

/** O valor sugerido para pagar: a soma dos valores presentes (inteiros, em centavos). */
export function valorSugerido(parcelas: ParcelaAdiantavel[]): number {
  return parcelas.reduce((soma, p) => soma + p.pv_cents, 0);
}

export type DraftDeAdiantamento = {
  kind: 'expense';
  amount_cents: number;
  start: string;
  installments: number;
  mode: 'total' | 'cancel';
  /** Liga os drafts de UMA hipótese: a lista mostra uma linha e "Tirar" remove o grupo. */
  grupo: string;
  /** Só no draft do pagamento: o texto da linha da hipótese. */
  rotulo?: string;
  /** Só no draft do pagamento: a ESCOLHA, para editar a hipótese voltar ao que foi escolhido. */
  adiantar?: EscolhaDeAdiantamento;
};

export type EscolhaDeAdiantamento = { ref_id: string; quantas: number; quais: Quais };

/**
 * A hipótese inteira: pagar `valor` em `pagarEm` e desfazer cada parcela escolhida no dia dela.
 * Parcela no MESMO dia do pagamento se anula na conta, que é o certo — ela sairia ali de todo jeito.
 */
export function draftsDoAdiantamento(
  item: Adiantavel,
  parcelas: ParcelaAdiantavel[],
  valor: number,
  pagarEm: string,
  grupo: string,
  escolha: Omit<EscolhaDeAdiantamento, 'ref_id'> = { quantas: parcelas.length, quais: 'ultimas' },
): DraftDeAdiantamento[] {
  if (parcelas.length === 0 || valor <= 0) return [];
  const qtd = parcelas.length;
  const oQue = item.source === 'recurring'
    ? `${qtd} ${qtd === 1 ? 'mês' : 'meses'} de ${item.title}`
    : `${qtd} ${qtd === 1 ? 'parcela' : 'parcelas'} de ${item.title}`;
  return [
    { kind: 'expense', amount_cents: valor, start: pagarEm, installments: 1, mode: 'total', grupo,
      rotulo: `adianta ${oQue}`, adiantar: { ref_id: item.ref_id, ...escolha } },
    ...parcelas.map((p) => ({
      kind: 'expense' as const, amount_cents: p.cents, start: p.day, installments: 1,
      mode: 'cancel' as const, grupo,
    })),
  ];
}

/** O último dia que a hipótese mexe — a projeção precisa alcançá-lo para mostrar o ganho. */
export function ultimoDia(parcelas: ParcelaAdiantavel[], pagarEm: string): string {
  return parcelas.reduce((max, p) => (p.day > max ? p.day : max), pagarEm);
}

/**
 * A lista de hipóteses que a tela mostra: cada draft solto é uma; os drafts de um mesmo
 * `grupo` (um adiantamento) são UMA, representada pelo draft que tem `rotulo`.
 */
export function agruparHipoteses<T extends { grupo?: string; rotulo?: string }>(
  drafts: T[],
): { chave: string; principal: T; indices: number[] }[] {
  const saida: { chave: string; principal: T; indices: number[] }[] = [];
  const porGrupo = new Map<string, { chave: string; principal: T; indices: number[] }>();
  drafts.forEach((d, i) => {
    if (!d.grupo) {
      saida.push({ chave: `d${i}`, principal: d, indices: [i] });
      return;
    }
    const g = porGrupo.get(d.grupo);
    if (g) {
      g.indices.push(i);
      if (d.rotulo) g.principal = d;
    } else {
      const novo = { chave: d.grupo, principal: d, indices: [i] };
      porGrupo.set(d.grupo, novo);
      saida.push(novo);
    }
  });
  return saida;
}

/**
 * Editar uma hipótese: os drafts do `grupo` dão lugar aos `novos`, NA MESMA POSIÇÃO — a lista
 * não pula a linha editada para o fim. Grupo que não existe mais (tirado no meio) entra no fim.
 */
export function substituirGrupo<T extends { grupo?: string }>(drafts: T[], grupo: string, novos: T[]): T[] {
  const primeiro = drafts.findIndex((d) => d.grupo === grupo);
  if (primeiro < 0) return [...drafts, ...novos];
  const resto = drafts.filter((d) => d.grupo !== grupo);
  const antes = drafts.slice(0, primeiro).filter((d) => d.grupo !== grupo).length;
  return [...resto.slice(0, antes), ...novos, ...resto.slice(antes)];
}
