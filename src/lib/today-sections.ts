import { diasAte, isoToBR } from './dates.ts';

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
