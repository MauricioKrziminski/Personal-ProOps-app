/**
 * A régua do formulário único (spec 2026-09-29): os tipos, os campos comuns que viajam entre eles e
 * as opções da pergunta de conversão — pura, para as três telas e o teste lerem a mesma coisa.
 */
import { detalheDaEscrita } from './escrita.ts';
import { dataLocalDe } from './dates.ts';
import type { PaymentMethod } from './payment-method.ts';
import type { RegistroSimulado } from './hipotese.ts';
import type { ExpenseClassification } from './expense-classification.ts';

export type TipoDeLancamento = 'uma' | 'recorrente' | 'financiamento';
export type Comum = {
  expenseClassification?: ExpenseClassification;
  kind: 'expense' | 'income' | 'transfer';
  descricao: string;
  valorCents: number;
  contaId: string | null;
  /** Só na transferência: a conta de destino, que viaja entre "Uma vez" e "Recorrente". */
  contraId?: string | null;
  dataBR: string;
  categoria: string | null;
  subcategory_id?: string | null;
  /** Lançamento e série têm; o financiamento não. */
  estabelecimento?: string;
  paymentMethod?: PaymentMethod | null;
};
export type OrigemDaConversao = { tipo: 'transacao' | 'serie' | 'plano' | 'divida'; id: string; papel: 'avulsa' | 'ocorrencia' | 'parcela' | 'pagamento' | 'registro'; temPassado: boolean };
export type Alcance = 'so_esta' | 'desta_em_diante' | 'todas' | 'manter' | 'converter';
export type OpcaoDaConversao = { alcance: Alcance; label: string; destrutiva?: boolean };

// Tupla (`as const`): o `Segmented` só aceita de 2 a 4 opções, e o tipo prova isso.
export const TIPOS_DE_LANCAMENTO = [
  { value: 'uma', label: 'Uma vez' },
  { value: 'recorrente', label: 'Recorrente' },
  { value: 'financiamento', label: 'Financiamento' },
] as const satisfies readonly { value: TipoDeLancamento; label: string }[];

export function opcoesDaConversao(o: OrigemDaConversao): OpcaoDaConversao[] {
  if (o.papel === 'avulsa') return [{ alcance: 'converter', label: 'Converter' }, { alcance: 'manter', label: 'Manter e criar um novo' }];
  const manter: OpcaoDaConversao = { alcance: 'manter', label: 'Manter o atual e criar um novo' };
  const soEsta: OpcaoDaConversao[] = o.papel === 'ocorrencia' ? [{ alcance: 'so_esta', label: 'Só esta' }] : [];
  // sem passado, "Desta em diante" e "Todas" dão o mesmo resultado: um "Converter" só
  if (!o.temPassado) return [...soEsta, { alcance: 'todas', label: 'Converter' }, manter];
  return [
    ...soEsta,
    { alcance: 'desta_em_diante', label: 'Desta em diante' },
    { alcance: 'todas', label: 'Todas, apagando as anteriores', destrutiva: true },
    manter,
  ];
}

export function comumDepoisDeSalvar(c: Comum): Comum {
  const { estabelecimento: _, expenseClassification: _classification, ...fica } = c;
  return { ...fica, ...(Object.hasOwn(c, 'subcategory_id') ? { subcategory_id: null } : {}), descricao: '', valorCents: 0, categoria: null };
}

/** A transferência continua transferência na série (F18): nunca vira gasto em silêncio. */
export function comumParaSerie(c: Comum): Comum {
  return { ...c, ...detalheDaEscrita(c, c.kind), ...(c.kind === 'transfer' ? { categoria: null } : {}) };
}

export function hrefDoLancar(tipo: TipoDeLancamento, extra: Record<string, string> = {}) {
  return { pathname: '/finance/lancar' as const, params: { tipo, ...extra } };
}

/** IDs da RPC: entidade primeiro; na parcelada, plano seguido pelos lançamentos. */
export function hrefDoResultadoDaConversao(destino: RegistroSimulado, resultado: { ids: string[] }) {
  const id = resultado.ids?.[0];
  switch (destino.tipo) {
    case 'financiamento':
      return { pathname: '/finance/debts' as const, params: id ? { id } : {} };
    case 'recorrente': {
      const inicio = destino.dados.dtstart ?? destino.dados.next_run_at;
      const month = typeof inicio === 'string' && !Number.isNaN(new Date(inicio).getTime())
        ? dataLocalDe(inicio).slice(0, 7) : undefined;
      return id
        ? { pathname: '/finance/transactions' as const, params: { recurringId: id, ...(month ? { month } : {}) } }
        : { pathname: '/finance/recurring' as const, params: {} };
    }
    case 'parcelada': {
      const txId = resultado.ids?.[1];
      return txId
        ? { pathname: '/finance/[txId]' as const, params: { txId } }
        : { pathname: '/finance/installments' as const, params: id ? { edit: id } : {} };
    }
    case 'lancamento':
      return id
        ? { pathname: '/finance/[txId]' as const, params: { txId: id } }
        : { pathname: '/finance/transactions' as const, params: {} };
  }
}

export function temPassadoDoParam(v: string | undefined): boolean {
  return v !== '0';
}

/** O que o lançamento é dentro do registro que o gerou — é o que decide as opções da conversão. */
export function papelDaTransacao(tx: { recurring_id?: string | null; installment_plan_id?: string | null; debt_id?: string | null }): OrigemDaConversao['papel'] {
  return tx.recurring_id ? 'ocorrencia' : tx.installment_plan_id ? 'parcela' : tx.debt_id ? 'pagamento' : 'avulsa';
}

/** Editar um lançamento que se tem à mão: o avulso não tem passado, os outros o hospedeiro pergunta. */
export function hrefDoLancamento(
  tx: { id: string; recurring_id?: string | null; installment_plan_id?: string | null; debt_id?: string | null; pix_fee_for_transaction_id?: string | null },
  extra: Record<string, string> = {},
) {
  const papel = papelDaTransacao(tx);
  return hrefDoLancar('uma', { id: tx.pix_fee_for_transaction_id ?? tx.id, origem: 'transacao', papel, ...(papel === 'avulsa' ? { passado: '0' } : {}), ...extra });
}
