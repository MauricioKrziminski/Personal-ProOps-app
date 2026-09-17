/**
 * Prazo e estado da fatura de um cartão, lidos das datas que `card_summary()` devolve.
 *
 * Nenhuma aritmética de ciclo: comparar uma data que o servidor mandou com hoje não é recalcular
 * ciclo, é ler prazo. Moravam em `finance/cards.tsx`; a Carteira escreve o mesmo estado.
 */

/** Dias até a data (negativo = já passou). Compara data pura, sem hora. */
export function diasAte(iso: string, hoje = new Date()): number {
  const alvo = new Date(`${iso}T00:00:00`);
  const umDia = 24 * 60 * 60 * 1000;
  return Math.round(
    (alvo.getTime() - new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()).getTime()) / umDia
  );
}

export function prazoLabel(iso: string, prefixo: 'vence' | 'fecha', hoje = new Date()): string {
  const dias = diasAte(iso, hoje);
  if (dias === 0) return `${prefixo} hoje`;
  if (dias === 1) return `${prefixo} amanhã`;
  if (dias > 0) return `${prefixo} em ${dias} dias`;
  return `${prefixo === 'vence' ? 'venceu' : 'fechou'} há ${Math.abs(dias)} dias`;
}

export type EstadoDaFatura = 'Aberta' | 'Fechada' | 'Atrasada';

/**
 * Estado da fatura corrente.
 *
 * `card_summary()` ainda **não devolve `status`** — enquanto a coluna não existir na RPC, o
 * estado é inferido das datas. É a inferência mais honesta possível; o rótulo fixo "fatura
 * aberta" de uma versão anterior mentia para quem tinha fatura vencida.
 */
export function estadoDaFatura(
  card: { invoice_id: string | null; closing_date: string | null; due_date: string | null },
  hoje = new Date()
): EstadoDaFatura | null {
  if (!card.invoice_id) return null;
  if (card.due_date && diasAte(card.due_date, hoje) < 0) return 'Atrasada';
  if (card.closing_date && diasAte(card.closing_date, hoje) < 0) return 'Fechada';
  return 'Aberta';
}

/**
 * Quanto do limite usado está em faturas que a tela de Cartões NÃO mostra: nem a corrente (o
 * número grande) nem as atrasadas (a faixa vermelha acima do cartão).
 *
 * `unpaid_total_cents` soma TODAS as não pagas, inclusive as futuras das parcelas — por isso a
 * frase é "outras faturas", não "fatura anterior". E a corrente vencida já está DENTRO das
 * atrasadas: descontá-la duas vezes zerava o que sobra.
 */
export function outrasFaturas(
  c: {
    unpaid_total_cents: number | null;
    invoice_total_cents: number | null;
    overdue_total_cents: number | null;
  },
  estado: EstadoDaFatura | null
): number {
  const corrente = estado === 'Atrasada' ? 0 : Number(c.invoice_total_cents ?? 0);
  return Math.max(
    0,
    Number(c.unpaid_total_cents ?? 0) - corrente - Number(c.overdue_total_cents ?? 0)
  );
}

/**
 * O estado da fatura como PALAVRA (a da `card_invoices.status`, não a inferida).
 *
 * ⚠️ Nunca "Rolada". O dono do produto recusou o jargão — *"eu não saberia o que seria
 * rolada"* —, e o estado não precisa de substantivo novo: a linha da fatura diz para ONDE o
 * saldo foi, que é o que a pessoa quer saber.
 */
export const STATUS_DA_FATURA: Record<string, string> = {
  open: 'Aberta',
  closed: 'Fechada',
  paid: 'Paga',
  rolled: 'Adiada',
};

export function contagemDeLancamentos(n: number): string {
  return `${n} ${n === 1 ? 'lançamento' : 'lançamentos'}`;
}

/** O mínimo que a face do cartão precisa (um recorte do `card_summary`). */
export interface CartaoDaPilha {
  account_id: string;
  name: string;
  invoice_id: string | null;
  invoice_total_cents: number;
  credit_limit_cents: number | null;
  available_limit_cents: number | null;
  closing_date: string | null;
  due_date: string | null;
  overdue_count: number;
}

type LinhaDoResumo = {
  account_id: string;
  name: string;
  invoice_id: string | null;
  invoice_total_cents: number | string | null;
  credit_limit_cents: number | string | null;
  available_limit_cents: number | string | null;
  closing_date: string | null;
  due_date: string | null;
  overdue_count: number | string | null;
};

/** O recorte, com os números já numéricos (a RPC devolve `bigint`, que pode chegar como string). */
export function cartaoDaPilha(c: LinhaDoResumo): CartaoDaPilha {
  return {
    account_id: c.account_id,
    name: c.name,
    invoice_id: c.invoice_id,
    invoice_total_cents: Number(c.invoice_total_cents ?? 0),
    credit_limit_cents: c.credit_limit_cents == null ? null : Number(c.credit_limit_cents),
    available_limit_cents: c.available_limit_cents == null ? null : Number(c.available_limit_cents),
    closing_date: c.closing_date,
    due_date: c.due_date,
    overdue_count: Number(c.overdue_count ?? 0),
  };
}
