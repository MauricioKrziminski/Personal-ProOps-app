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
  /** A linha da parcela, quando ela já existe (compra, recorrente gerada); `null` no resto. */
  id?: string | null;
  /** O dia da ocorrência (a data da compra, a da recorrente, o vencimento da dívida). */
  on?: string;
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

/**
 * A chave de UMA parcela de uma fonte: fonte + dia em que ela sai do caixa. O `cancel` não guarda
 * o nº da parcela (recorrente nem tem), mas guarda o dia (`start = p.day`), e uma fonte não tem
 * duas parcelas no mesmo dia — então a chave vale também para rascunho gravado antes desta regra.
 */
export function chaveDaParcela(ref_id: string, day: string): string {
  return `${ref_id}|${day}`;
}

/** O mínimo de um draft que estas contas leem — vale para o `Draft` do hook e para o daqui. */
type DraftLido = { mode?: string; grupo?: string; start: string; adiantar?: { ref_id: string } };

/** A fonte de cada grupo vem do draft de PAGAMENTO dele (o único que tem `adiantar`). */
function fonteDosGrupos(drafts: readonly DraftLido[]): Map<string, string> {
  const fonte = new Map<string, string>();
  for (const d of drafts) if (d.adiantar && d.grupo) fonte.set(d.grupo, d.adiantar.ref_id);
  return fonte;
}

/**
 * As parcelas que o rascunho JÁ adiantou, fora do grupo `exceto` (o que está sendo editado).
 *
 * ⚠️ 07/10/2026: `anticipation_candidates` lê só o banco, e o rascunho mora no aparelho. Sem
 * descontar isto, o segundo adiantamento da mesma compra oferecia as mesmas parcelas do primeiro,
 * dizia "N a vencer" sem tirar as já adiantadas e cancelava a MESMA parcela duas vezes — a projeção
 * devolvia ao caixa uma saída que só existia uma vez (saldo otimista, sem erro nenhum).
 */
export function parcelasJaAdiantadas(drafts: readonly DraftLido[], exceto?: string): Set<string> {
  const fonte = fonteDosGrupos(drafts);
  const ja = new Set<string>();
  for (const d of drafts) {
    if (d.mode !== 'cancel' || !d.grupo || d.grupo === exceto) continue;
    const ref = fonte.get(d.grupo);
    if (ref) ja.add(chaveDaParcela(ref, d.start));
  }
  return ja;
}

/** A lista do banco sem as parcelas já adiantadas; a fonte que ficou vazia sai. */
export function semAsJaAdiantadas(lista: readonly Adiantavel[], ja: ReadonlySet<string>): Adiantavel[] {
  if (ja.size === 0) return [...lista];
  return lista
    .map((i) => ({ ...i, events: i.events.filter((e) => !ja.has(chaveDaParcela(i.ref_id, e.day))) }))
    .filter((i) => i.events.length > 0);
}

/**
 * Defesa no ENVIO: o cancelamento de uma parcela que outro grupo já cancelou sai (fica o primeiro).
 * Cobre o rascunho gravado no aparelho antes de `semAsJaAdiantadas` existir. Idempotente.
 */
export function semCancelamentoRepetido<T extends DraftLido>(drafts: readonly T[]): T[] {
  const fonte = fonteDosGrupos(drafts);
  const vistas = new Set<string>();
  return drafts.filter((d) => {
    if (d.mode !== 'cancel' || !d.grupo) return true;
    const ref = fonte.get(d.grupo);
    if (!ref) return true;
    const chave = chaveDaParcela(ref, d.start);
    if (vistas.has(chave)) return false;
    vistas.add(chave);
    return true;
  });
}

/**
 * Quantas parcelas da fonte ainda faltariam DEPOIS de cada adiantamento, na ordem dos pagamentos:
 * as que vencem depois do dia do pagamento, menos as que este grupo e os pagos antes (ou junto)
 * dele já adiantaram. `candidatos` é a lista do banco a partir de hoje; sem a fonte nela, o grupo
 * fica sem número (nada a afirmar enquanto a lista não chegou).
 */
export function faltamDepois(
  drafts: readonly DraftLido[],
  candidatos: readonly Adiantavel[],
): Map<string, number> {
  const fonte = fonteDosGrupos(drafts);
  const pagamentos = drafts
    .filter((d): d is DraftLido & { grupo: string; adiantar: { ref_id: string } } => Boolean(d.adiantar && d.grupo))
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  const saida = new Map<string, number>();
  for (const p of pagamentos) {
    const item = candidatos.find((c) => c.ref_id === p.adiantar.ref_id);
    // Conta fixa não tem fim: "faltam 117" seria o tamanho da janela da projeção, não um fato.
    if (!item || item.source === 'recurring') continue;
    const ate = new Set<string>();
    for (const d of drafts) {
      if (d.mode !== 'cancel' || !d.grupo) continue;
      const pagoEm = drafts.find((x) => x.grupo === d.grupo && x.adiantar)?.start;
      if (fonte.get(d.grupo) === item.ref_id && pagoEm && pagoEm <= p.start) ate.add(d.start);
    }
    // Depois do DIA do pagamento, não do mês: a parcela de 10/11 ainda falta para quem adiantou
    // no dia 1º de novembro (ela só não é adiantável nesse mês — `adiantaveisNoMes`).
    saida.set(p.grupo, item.events.filter((e) => e.day > p.start && !ate.has(e.day)).length);
  }
  return saida;
}

/**
 * A dica de "Quantas parcelas" no Adiantar (08/10/2026, *"tem que mostrar quantas faltariam
 * contando com a quantidade que eu estou querendo adiantar"*): quantas faltam hoje e quantas FICAM
 * depois de adiantar as escolhidas. `total` já desconta as adiantadas no mesmo rascunho.
 */
export function dicaDasParcelas(total: number, quantas: number, jaAdiantadas: number): string {
  const plural = (n: number) => `${n} ${n === 1 ? 'parcela' : 'parcelas'}`;
  const ficam = Math.max(0, total - quantas);
  const rascunho = jaAdiantadas > 0
    ? ` (${jaAdiantadas} já ${jaAdiantadas === 1 ? 'adiantada' : 'adiantadas'} no rascunho)`
    : '';
  const depois = ficam === 0 ? 'não fica nenhuma' : `${ficam === 1 ? 'fica' : 'ficam'} ${plural(ficam)}`;
  return `Faltam ${plural(total)}${rascunho}. Adiantando ${quantas}, ${depois}.`;
}

/**
 * Aplicar (08/10/2026): as parcelas que um adiantamento do rascunho tirou, achadas na lista do
 * banco pelo dia em que cada uma sairia (o `start` dos `cancel` do grupo). Dia repetido conta
 * uma vez por draft (a semanal no cartão vence várias no mesmo dia). `null` = alguma não está mais
 * lá (paga, mudou, venceu): o adiantamento precisa ser refeito.
 */
export function parcelasDoGrupo(item: Adiantavel, dias: readonly string[]): ParcelaAdiantavel[] | null {
  const livres = [...item.events];
  const saida: ParcelaAdiantavel[] = [];
  for (const dia of dias) {
    const i = livres.findIndex((e) => e.day === dia);
    if (i < 0) return null;
    saida.push(livres.splice(i, 1)[0]);
  }
  return saida.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : (a.n ?? 0) - (b.n ?? 0)));
}

/** O pedido ao banco: a linha quando ela existe, o número na dívida, a data na recorrente prevista. */
export function pedidoDasParcelas(
  source: FonteAdiantavel,
  parcelas: readonly ParcelaAdiantavel[],
): ({ id: string } | { n: number } | { on: string })[] {
  return parcelas.map((p) =>
    p.id ? { id: p.id } : source === 'debt' ? { n: p.n ?? 0 } : { on: p.on ?? p.day });
}

/** O título que o lançamento nasce com: "Adiantamento de 3 parcelas de Fone" / "de 2 meses de". */
export function tituloDoAdiantamento(source: FonteAdiantavel, quantas: number, nome: string): string {
  const oQue = source === 'recurring'
    ? `${quantas} ${quantas === 1 ? 'mês' : 'meses'}`
    : `${quantas} ${quantas === 1 ? 'parcela' : 'parcelas'}`;
  return `Adiantamento de ${oQue} de ${nome}`;
}

/** O que mora em `transactions.adiantamento` (20261010130000), só o que a tela lê. */
export type RegistroDeAdiantamento = {
  source: FonteAdiantavel;
  ref_id: string;
  modo?: 'proximas' | 'ultimas';
  /** `day` é o dia em que sairia do caixa (dívida, série); na compra, a linha guardada traz o `due_at`. */
  parcelas: { n?: number | null; on?: string; day?: string; cents?: number | string; linha?: { due_at?: string | null } }[];
};

/** "parcelas 10 a 12", "parcela 4", "3 meses": o que o lançamento cobriu, em poucas palavras. */
export function oQueOAdiantamentoCobriu(a: RegistroDeAdiantamento): string {
  const qtd = a.parcelas.length;
  if (a.source === 'recurring') return `${qtd} ${qtd === 1 ? 'mês' : 'meses'}`;
  const ns = a.parcelas.map((p) => Number(p.n)).filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
  if (ns.length === 0) return `${qtd} ${qtd === 1 ? 'parcela' : 'parcelas'}`;
  if (ns.length === 1) return `parcela ${ns[0]}`;
  const seguidas = ns.every((n, i) => i === 0 || n === ns[i - 1] + 1);
  return seguidas ? `parcelas ${ns[0]} a ${ns[ns.length - 1]}` : `parcelas ${ns.join(', ')}`;
}

/**
 * O apoio da linha de um adiantamento: o que ele cobriu e, quando o pago difere da soma das
 * parcelas, a diferença dita como DESCONTO (ou o que se pagou a mais) — *"pode ser que tenha
 * desconto, tem que mostrar isso também"*.
 */
export function apoioDoAdiantamento(
  a: RegistroDeAdiantamento,
  pagoCents: number,
  previstoCents: number | null | undefined,
  brl: (c: number) => string,
): string {
  const partes = [`adiantamento · ${oQueOAdiantamentoCobriu(a)}`];
  if (previstoCents != null && previstoCents !== pagoCents) {
    partes.push(previstoCents > pagoCents
      ? `desconto de ${brl(previstoCents - pagoCents)}`
      : `${brl(pagoCents - previstoCents)} a mais`);
  }
  return partes.join(' · ');
}

/** O dia que o "Aplicar" sugere: o da hipótese, nunca antes de hoje. */
export function diaDoAplicar(pagarEm: string, hoje: string): string {
  return pagarEm < hoje ? hoje : pagarEm;
}
