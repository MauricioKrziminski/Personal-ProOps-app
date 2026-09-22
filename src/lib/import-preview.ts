/**
 * A prévia da importação — o que vai entrar, o que já está no app e o que fica de fora.
 *
 * Puro, sem React: a tela só desenha o que isto decide. Plano:
 * `docs/superpowers/plans/2026-09-22-importacao-inteligente.md`.
 *
 * ⚠️ **A pré-seleção é uma SUGESTÃO, nunca um filtro.** Tudo aparece e tudo se marca: o que já
 * está no app nasce desmarcado com o motivo ao lado; importar mesmo assim é escolha da pessoa.
 */

export type StatusDoItem = 'pending' | 'approved' | 'discarded' | 'duplicate' | 'near_match' | 'uncertain';

export type Natureza =
  | 'compra' | 'estorno' | 'pagamento_fatura' | 'transferencia_propria'
  | 'investimento' | 'encargo' | 'saldo_anterior' | 'receita';

export interface ItemDaPrevia {
  id: string;
  kind: 'expense' | 'income';
  amount_cents: number;
  occurred_at: string;
  description: string | null;
  merchant: string | null;
  status: StatusDoItem;
  nature: Natureza | null;
  installment_no: number | null;
  installments: number | null;
  match_layer: string | null;
  match_note: string | null;
  adopt_ids: (string | null)[] | null;
  transactions: { id: string; occurred_at: string; description: string | null } | null;
}

export type Grupo = 'entram' | 'fora' | 'talvez' | 'no_app';

/** O que a IA achou que a linha é, quando isso a tira do financeiro por padrão. */
const FORA: Partial<Record<Natureza, string>> = {
  pagamento_fatura: 'Pagamento da fatura',
  transferencia_propria: 'Entre as suas contas',
  investimento: 'Aplicação ou resgate',
  saldo_anterior: 'Saldo da fatura anterior — as compras já foram contadas',
};

/**
 * Por que a linha fica de fora por padrão, ou `null` se ela entra.
 *
 * ⚠️ **Crédito na FATURA nunca entra sozinho como receita.** "Pagamento recebido" é a fatura sendo
 * paga, e o pagamento já move o caixa pelo "Pagar fatura"; lançado como receita no cartão, ele
 * contaria duas vezes. Só o que a IA reconhece como ESTORNO nasce marcado. É régua estrutural
 * (sentido + tipo de conta), então vale mesmo sem a IA ter respondido.
 */
export function motivoDeFora(item: ItemDaPrevia, cartao: boolean): string | null {
  const porNatureza = item.nature ? FORA[item.nature] : undefined;
  if (porNatureza) return porNatureza;
  if (cartao && item.kind === 'income' && item.nature !== 'estorno') {
    return 'Crédito na fatura — pagamento ou estorno';
  }
  return null;
}

export function grupoDe(item: ItemDaPrevia, cartao: boolean): Grupo | null {
  switch (item.status) {
    case 'duplicate':
    case 'near_match':
      return 'no_app';
    case 'uncertain':
      return 'talvez';
    case 'pending':
      return motivoDeFora(item, cartao) ? 'fora' : 'entram';
    default:
      return null; // já decidido (approved / discarded)
  }
}

/** Os ids marcados quando a prévia abre: só o que é novo e é gasto/receita de verdade. */
export function selecaoInicial(itens: ItemDaPrevia[], cartao: boolean): Set<string> {
  return new Set(itens.filter((i) => grupoDe(i, cartao) === 'entram').map((i) => i.id));
}

export const TITULO_DO_GRUPO: Record<Grupo, string> = {
  entram: 'Novos',
  talvez: 'Talvez já estejam no app',
  no_app: 'Já estão no app',
  fora: 'Fora do financeiro',
};

export const ORDEM_DOS_GRUPOS: Grupo[] = ['entram', 'talvez', 'no_app', 'fora'];

export function agrupar<T extends ItemDaPrevia>(itens: T[], cartao: boolean): { grupo: Grupo; itens: T[] }[] {
  return ORDEM_DOS_GRUPOS.map((grupo) => ({
    grupo,
    itens: itens.filter((i) => grupoDe(i, cartao) === grupo),
  })).filter((g) => g.itens.length > 0);
}

/** O nome que a linha mostra: sem o " - Parcela 2/12" — a parcela ganha frase própria. */
export function nomeDoItem(item: ItemDaPrevia): string {
  if (item.installments && item.merchant) return item.merchant;
  return item.description?.trim() || 'Sem descrição';
}

/**
 * A frase do parcelado: o que a importação VAI criar, antes de criar.
 *
 * "Parcela 2/12 · cria a compra de 12x: 1 anterior como paga, esta e mais 10"
 */
export function fraseDaParcela(item: ItemDaPrevia, cartao: boolean): string | null {
  const k = item.installment_no;
  const n = item.installments;
  if (!k || !n) return null;
  const base = `Parcela ${k}/${n}`;
  // Só compra NOVA no cartão vira compra parcelada; as outras linhas só dizem que são parcela.
  if (!cartao || item.status !== 'pending' || item.kind !== 'expense') return base;
  const anteriores = k - 1;
  const futuras = n - k;
  const adotadas = (item.adopt_ids ?? []).filter(Boolean).length;
  const partes = [
    anteriores > 0
      ? `${anteriores} ${anteriores === 1 ? 'anterior como paga' : 'anteriores como pagas'}`
      : null,
    futuras > 0 ? `esta e mais ${futuras}` : 'esta é a última',
  ].filter(Boolean);
  const adocao = adotadas > 0
    ? ` · ${adotadas === 1 ? 'a anterior que já está no app entra nela' : `${adotadas} anteriores que já estão no app entram nela`}`
    : '';
  return `${base} · cria a compra de ${n}x: ${partes.join(', ')}${adocao}`;
}

/** Por que a linha NÃO nasceu marcada — a frase que sustenta o "já está no app". */
export function motivoDaLinha(item: ItemDaPrevia, cartao: boolean): string | null {
  const g = grupoDe(item, cartao);
  if (g === 'fora') return motivoDeFora(item, cartao);
  if (g === 'no_app' || g === 'talvez') {
    const alvo = item.transactions;
    const nota = item.match_note ?? (g === 'talvez' ? 'parecido com um lançamento do app' : 'já está no app');
    // A nota da camada semântica já nomeia o lançamento ("é Energia no app, …"): repetir o nome
    // no fim dizia a mesma coisa duas vezes na mesma linha.
    return alvo?.description && !nota.includes(alvo.description) ? `${nota} — «${alvo.description}»` : nota;
  }
  return null;
}

export interface Totais {
  quantos: number;
  saiCents: number;
  entraCents: number;
  /** Compras parceladas NOVAS que a importação vai criar. */
  compras: number;
}

export function totais(itens: ItemDaPrevia[], marcados: Set<string>, cartao: boolean): Totais {
  const escolhidos = itens.filter((i) => marcados.has(i.id) && grupoDe(i, cartao) !== null);
  return {
    quantos: escolhidos.length,
    saiCents: escolhidos.filter((i) => i.kind === 'expense').reduce((s, i) => s + i.amount_cents, 0),
    entraCents: escolhidos.filter((i) => i.kind === 'income').reduce((s, i) => s + i.amount_cents, 0),
    compras: escolhidos.filter(
      (i) => cartao && i.status === 'pending' && i.kind === 'expense' && i.installments,
    ).length,
  };
}
