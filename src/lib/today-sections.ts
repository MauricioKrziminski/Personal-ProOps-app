import { orcamentosApertados, type OrcamentoLinha } from './budget-tight.ts';
import { diaCurtoBR, diaDaSemanaCurto, diasAte, isoToBR, localISODate, somaDias } from './dates.ts';

/**
 * A agenda da Hoje, fora da tela: o que exige ação AGORA e o que vem nos próximos dias.
 *
 * Tipos locais de propósito — este arquivo roda em `node --test` e não importa hooks. As
 * formas são as de `upcoming_bills` e de `useUpcomingCardCharges`.
 *
 * ⚠️ **Compra no cartão nunca é pendência.** Ela não vence: vai POSTAR na fatura. Fica fora do
 * Agora, do contador "Vencendo" e do badge da aba (design.md §8), mesmo quando é de hoje.
 */
export type ContaPrevista = {
  ref_id: string;
  title: string;
  due_date: string;
  amount_cents: number | string;
  kind: 'invoice' | 'transaction' | 'debt' | 'income';
  overdue: boolean;
};

export type CompraNoCartao = {
  id: string;
  title: string;
  occurred_at: string;
  amount_cents: number | string;
  card: string;
  invoice_id: string;
};

export type ItemDaAgenda = {
  chave: string;
  ref_id: string;
  kind: 'invoice' | 'transaction' | 'debt' | 'income' | 'card';
  title: string;
  day: string;
  cents: number;
  atrasado: boolean;
  cartao: string | null;
  faturaId: string | null;
};

export type Tom = 'danger' | 'warning' | 'success' | 'neutral';

const PESO_DO_TIPO: Record<ItemDaAgenda['kind'], number> = {
  invoice: 0, transaction: 0, debt: 0, card: 1, income: 2,
};

function ordemDeAgora(a: ItemDaAgenda, b: ItemDaAgenda): number {
  if (a.atrasado !== b.atrasado) return a.atrasado ? -1 : 1;
  const tipo = PESO_DO_TIPO[a.kind] - PESO_DO_TIPO[b.kind];
  if (tipo !== 0) return tipo;
  return a.day.localeCompare(b.day) || b.cents - a.cents;
}

function ordemDoDia(a: ItemDaAgenda, b: ItemDaAgenda): number {
  return PESO_DO_TIPO[a.kind] - PESO_DO_TIPO[b.kind] || b.cents - a.cents;
}

export function agendaDoDia(
  contas: readonly ContaPrevista[],
  compras: readonly CompraNoCartao[],
  hoje: string,
  janela = 7
): { agora: ItemDaAgenda[]; proximos: { day: string; itens: ItemDaAgenda[] }[] } {
  const itens: ItemDaAgenda[] = [
    ...contas.map((c) => ({
      // `debt` repete o `ref_id` (é o id da DÍVIDA) em cada prestação: a data entra na chave.
      chave: `${c.kind}:${c.ref_id}:${c.due_date}`,
      ref_id: c.ref_id,
      kind: c.kind,
      title: c.title,
      day: c.due_date,
      cents: Number(c.amount_cents),
      atrasado: c.overdue,
      cartao: null,
      faturaId: null,
    })),
    ...compras.map((c) => ({
      chave: `card:${c.id}`,
      ref_id: c.id,
      kind: 'card' as const,
      title: c.title,
      day: c.occurred_at,
      cents: Number(c.amount_cents),
      atrasado: false,
      cartao: c.card,
      faturaId: c.invoice_id,
    })),
  ];

  const agora = itens
    .filter((i) => i.kind !== 'card' && (i.atrasado || i.day <= hoje))
    .sort(ordemDeAgora);
  const naAgora = new Set(agora.map((i) => i.chave));

  const grupos = new Map<string, ItemDaAgenda[]>();
  for (const i of itens) {
    if (naAgora.has(i.chave)) continue;
    const distancia = diasAte(i.day, hoje);
    if (distancia < 0 || distancia > janela) continue;
    grupos.set(i.day, [...(grupos.get(i.day) ?? []), i]);
  }
  const proximos = [...grupos.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, lista]) => ({ day, itens: lista.sort(ordemDoDia) }));

  return { agora, proximos };
}

/** A linha pequena embaixo do título: o que aconteceu, na palavra do dia a dia. */
export function metaDoItem(i: ItemDaAgenda, onde: 'agora' | 'proximos'): { texto: string; tom: Tom } {
  const data = isoToBR(i.day).slice(0, 5);
  if (onde === 'agora') {
    if (i.kind === 'income') {
      return i.atrasado ? { texto: `não caiu ${data}`, tom: 'warning' } : { texto: 'chega hoje', tom: 'success' };
    }
    return i.atrasado ? { texto: `venceu ${data}`, tom: 'danger' } : { texto: 'vence hoje', tom: 'neutral' };
  }
  if (i.kind === 'card') return { texto: i.cartao ?? 'cartão', tom: 'neutral' };
  if (i.kind === 'income') return { texto: 'a receber', tom: 'success' };
  if (i.kind === 'invoice') return { texto: 'fatura', tom: 'neutral' };
  if (i.kind === 'debt') return { texto: 'financiamento', tom: 'neutral' };
  return { texto: 'conta', tom: 'neutral' };
}

export function iconeDoItem(i: ItemDaAgenda): 'creditcard' | 'banknote' | 'arrow.down.left' | 'calendar' {
  if (i.kind === 'invoice' || i.kind === 'card') return 'creditcard';
  if (i.kind === 'debt') return 'banknote';
  if (i.kind === 'income') return 'arrow.down.left';
  return 'calendar';
}

/** Um lembrete como a Hoje o lê (as colunas de `useTodayReminders`). */
export type LembreteDoDia = {
  id: string;
  title: string;
  next_run_at: string;
  channel: string;
  recurrence: string | null;
};

/**
 * Os lembretes de HOJE e os que ficaram de outro dia, pela DATA LOCAL do `next_run_at`.
 *
 * ⚠️ **"Para hoje" listava lembretes de 25 dias antes** (28/09/2026). `useTodayReminders` só tem
 * teto (`lte` fim de hoje): o lembrete ativo que o cron não entregou — no staging o cron não
 * roda; em produção, a entrega falhando — continua com o `next_run_at` no passado e caía na
 * mesma conta dos de hoje. Ele ainda existe e é mostrado, mas com a data dele, e não conta como
 * "de hoje" (nem no badge).
 */
export function separarLembretes<T extends Pick<LembreteDoDia, 'next_run_at'>>(
  lista: readonly T[],
  hoje: string
): { deHoje: T[]; deOutroDia: T[] } {
  const deHoje: T[] = [];
  const deOutroDia: T[] = [];
  for (const l of lista) (localISODate(new Date(l.next_run_at)) === hoje ? deHoje : deOutroDia).push(l);
  return { deHoje, deOutroDia };
}

/** O atrasado numa linha só: quantas contas, quanto, e desde quando. */
export type ResumoDoAtrasado = {
  contas: number;
  contasCents: number;
  /** Receita prevista que não caiu — não é conta, e não soma no valor das contas. */
  entradas: number;
  entradasCents: number;
  /** O dia da pendência mais antiga. */
  desde: string;
};

export function resumoDoAtrasado(itens: readonly ItemDaAgenda[]): ResumoDoAtrasado | null {
  if (itens.length === 0) return null;
  const contas = itens.filter((i) => i.kind !== 'income');
  const entradas = itens.filter((i) => i.kind === 'income');
  return {
    contas: contas.length,
    contasCents: contas.reduce((t, i) => t + i.cents, 0),
    entradas: entradas.length,
    entradasCents: entradas.reduce((t, i) => t + i.cents, 0),
    desde: itens.reduce((m, i) => (i.day < m ? i.day : m), itens[0].day),
  };
}

export type EntradaDoDia<L extends LembreteDoDia = LembreteDoDia> =
  | { tipo: 'resumo'; chave: string; resumo: ResumoDoAtrasado; aberto: boolean }
  | { tipo: 'item'; chave: string; item: ItemDaAgenda }
  | { tipo: 'verMais'; chave: string; restantes: number }
  | { tipo: 'lembrete'; chave: string; lembrete: L; estado: 'passou' | 'proximo' | 'depois' | 'outroDia' }
  | { tipo: 'agora'; chave: string };

/**
 * O dia em linhas, na ordem em que ele acontece (spec 2026-09-28): o atrasado, o que é "do dia
 * todo" (vence ou chega hoje, sem hora), e os lembretes com hora — com o AGORA entre o que já
 * passou e o que vem, como a linha vermelha de um calendário.
 *
 * - **Com 2+ atrasados eles viram UMA linha** (`resumo`) que abre no lugar. Um card vermelho por
 *   fatura atrasada eram sete no topo da tela; com UM só, o resumo seria eco dele.
 * - `limiteDoAtrasado` é a janela do "Ver mais": o atrasado não tem data mínima.
 * - Lembrete de outro dia vem antes dos de hoje, com a data dele.
 */
export function linhasDoDia<L extends LembreteDoDia>(v: {
  atrasados: readonly ItemDaAgenda[];
  atrasadosAbertos: boolean;
  limiteDoAtrasado: number;
  doDia: readonly ItemDaAgenda[];
  lembretes: { deHoje: readonly L[]; deOutroDia: readonly L[] };
  agora: number;
}): EntradaDoDia<L>[] {
  const linhas: EntradaDoDia<L>[] = [];
  const resumo = v.atrasados.length >= 2 ? resumoDoAtrasado(v.atrasados) : null;
  if (resumo) linhas.push({ tipo: 'resumo', chave: 'resumo', resumo, aberto: v.atrasadosAbertos });
  if (!resumo || v.atrasadosAbertos) {
    const visiveis = v.atrasados.slice(0, v.limiteDoAtrasado);
    for (const item of visiveis) linhas.push({ tipo: 'item', chave: item.chave, item });
    const restantes = v.atrasados.length - visiveis.length;
    if (restantes > 0) linhas.push({ tipo: 'verMais', chave: 'ver-mais-atrasado', restantes });
  }
  for (const item of v.doDia) linhas.push({ tipo: 'item', chave: item.chave, item });
  for (const lembrete of v.lembretes.deOutroDia) {
    linhas.push({ tipo: 'lembrete', chave: `lembrete:${lembrete.id}`, lembrete, estado: 'outroDia' });
  }
  const deHoje = [...v.lembretes.deHoje].sort((a, b) => a.next_run_at.localeCompare(b.next_run_at));
  const primeiroQueVem = deHoje.findIndex((l) => new Date(l.next_run_at).getTime() >= v.agora);
  deHoje.forEach((lembrete, i) => {
    if (i === primeiroQueVem) linhas.push({ tipo: 'agora', chave: 'agora' });
    const estado = primeiroQueVem === -1 || i < primeiroQueVem ? 'passou' : i === primeiroQueVem ? 'proximo' : 'depois';
    linhas.push({ tipo: 'lembrete', chave: `lembrete:${lembrete.id}`, lembrete, estado });
  });
  if (deHoje.length > 0 && primeiroQueVem === -1) linhas.push({ tipo: 'agora', chave: 'agora' });
  return linhas;
}

/**
 * O número do badge da aba Hoje — a MESMA régua nas duas tab bars (`usePendentesDaHoje`).
 *
 * Conta a vencer (receita prevista não vence), lembrete de HOJE e orçamento estourado. As duas
 * tab bars somavam `upcoming_bills` inteiro, com a receita dentro, e o lembrete que ficou de
 * outro dia — contra a regra escrita na própria Hoje.
 */
export function pendentesDaHoje(v: {
  contas: readonly Pick<ContaPrevista, 'kind'>[];
  lembretes: readonly Pick<LembreteDoDia, 'next_run_at'>[];
  orcamentos: readonly OrcamentoLinha[];
  hoje: string;
}): number {
  return (
    v.contas.filter((c) => c.kind !== 'income').length +
    separarLembretes(v.lembretes, v.hoje).deHoje.length +
    orcamentosApertados(v.orcamentos).filter((o) => o.estourou).length
  );
}

/** Um dia da semana da Hoje: o que saiu (passado e hoje) ou o que está previsto (futuro). */
export type DiaDaSemana = {
  day: string;
  /** `seg`, `ter`… */
  semana: string;
  /** `28` */
  numero: string;
  tipo: 'passado' | 'hoje' | 'futuro';
  /** O gasto do dia — `daily_spending`, a régua de `transactions_summary`. Zero no futuro. */
  saiu: number;
  entrou: number;
  /** Futuro: o que vence ou vai cair no cartão — os MESMOS itens dos Próximos dias, sem receita. */
  previsto: number;
  previstos: number;
  /** Futuro: a receita prevista. */
  aEntrar: number;
  /** Gastou mais do que cabe por dia (só com "por dia"). */
  acima: boolean;
};

export type Semana = {
  dias: DiaDaSemana[];
  /** O valor que ocupa a altura inteira das barras (só passado e hoje). Nunca zero. */
  teto: number;
  /** A régua tracejada: o que dá para gastar por dia, ou `null` sem ela. */
  linha: number | null;
};

/**
 * A semana da Hoje (28/09/2026): três dias para trás, hoje no meio, três para a frente.
 *
 * ⚠️ **Barra só para o que SAIU; o futuro é MARCA, não barra.** O passado e o hoje são o gasto
 * pela data do lançamento (a régua do "saiu hoje", `daily_spending`). O futuro é o que vence —
 * fatura inclusive, que é quando o dinheiro sai do caixa — e isso é OUTRA régua: uma barra de
 * vencimento ao lado de uma barra de gasto teria a mesma cara e diria outra coisa (uma fatura de
 * R$ 5.000 viraria "o maior gasto da semana"). Os itens do futuro são os MESMOS dos Próximos dias,
 * logo abaixo, para a frase e a lista nunca discordarem.
 */
export function semanaDoDia(v: {
  hoje: string;
  gastos: readonly { day: string; expense_cents: number | string; income_cents: number | string }[];
  proximos: readonly { day: string; itens: readonly ItemDaAgenda[] }[];
  porDia: number | null;
  antes?: number;
  depois?: number;
}): Semana {
  const antes = v.antes ?? 3;
  const depois = v.depois ?? 3;
  const gastoDo = new Map(v.gastos.map((g) => [g.day, g]));
  const itensDo = new Map(v.proximos.map((g) => [g.day, g.itens]));

  const dias: DiaDaSemana[] = [];
  for (let delta = -antes; delta <= depois; delta++) {
    const day = somaDias(v.hoje, delta);
    const tipo = delta < 0 ? 'passado' : delta === 0 ? 'hoje' : 'futuro';
    const gasto = tipo === 'futuro' ? undefined : gastoDo.get(day);
    const itens = tipo === 'futuro' ? (itensDo.get(day) ?? []) : [];
    const saidas = itens.filter((i) => i.kind !== 'income');
    const saiu = Number(gasto?.expense_cents ?? 0);
    dias.push({
      day,
      semana: diaDaSemanaCurto(day),
      numero: String(Number(day.slice(8, 10))),
      tipo,
      saiu,
      entrou: Number(gasto?.income_cents ?? 0),
      previsto: saidas.reduce((t, i) => t + i.cents, 0),
      previstos: saidas.length,
      aEntrar: itens.filter((i) => i.kind === 'income').reduce((t, i) => t + i.cents, 0),
      acima: v.porDia !== null && tipo !== 'futuro' && saiu > v.porDia,
    });
  }
  const maior = Math.max(0, ...dias.map((d) => d.saiu));
  /*
    O teto é o maior gasto, mas nunca mais que 3× a régua: um dia de R$ 3.000 contra R$ 100 por dia
    esmagaria a régua na base (e todo o resto da semana junto). A barra que passa do teto fica
    cheia — o valor exato está na frase de cima.
  */
  const teto = v.porDia === null ? maior : Math.min(Math.max(maior, v.porDia), v.porDia * 3);
  return { dias, teto: Math.max(1, teto), linha: v.porDia };
}

/** A frase de cima da semana, para o dia escolhido. */
export type LegendaDoDia = {
  /** `Hoje` ou `sáb, 26 set`. */
  quando: string;
  /** `saiu`, `vence`, `entra` ou `nada previsto`. */
  rotulo: string;
  valor: number;
  tom: 'text' | 'warning' | 'success';
  /** Uma linha curta, ou `null`: "dentro" não se escreve — a régua e a cor já dizem. */
  estado: string | null;
  /** O dinheiro que entrou (ou entra) no dia, ao lado do valor. */
  entrada: { rotulo: 'entrou' | 'entra'; valor: number } | null;
  /** Dia que vem sem nada: o leitor de tela diz "nada previsto", não "R$ 0,00". */
  vazio: boolean;
};

/**
 * O que a semana diz do dia escolhido. Sem dinheiro formatado aqui dentro: quem desenha escolhe
 * entre o valor e o "valor oculto" do esconder saldo.
 */
export function legendaDoDia(d: DiaDaSemana): LegendaDoDia {
  const quando = d.tipo === 'hoje' ? 'Hoje' : diaCurtoBR(d.day);
  if (d.tipo === 'futuro') {
    if (d.previstos === 0 && d.aEntrar === 0) {
      return { quando, rotulo: 'nada previsto', valor: 0, tom: 'text', estado: null, entrada: null, vazio: true };
    }
    if (d.previstos === 0) {
      return { quando, rotulo: 'entra', valor: d.aEntrar, tom: 'success', estado: null, entrada: null, vazio: false };
    }
    return {
      quando,
      rotulo: 'vence',
      valor: d.previsto,
      tom: 'text',
      estado: `${d.previstos} ${d.previstos === 1 ? 'compromisso' : 'compromissos'}`,
      entrada: d.aEntrar > 0 ? { rotulo: 'entra', valor: d.aEntrar } : null,
      vazio: false,
    };
  }
  return {
    quando,
    rotulo: 'saiu',
    valor: d.saiu,
    tom: d.acima ? 'warning' : 'text',
    estado: d.acima ? 'acima do que dá por dia' : null,
    entrada: d.entrou > 0 ? { rotulo: 'entrou', valor: d.entrou } : null,
    vazio: false,
  };
}
