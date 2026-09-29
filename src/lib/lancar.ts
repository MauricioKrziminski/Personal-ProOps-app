/**
 * A régua do formulário único (spec 2026-09-29): os tipos, os campos comuns que viajam entre eles e
 * as opções da pergunta de conversão — pura, para as três telas e o teste lerem a mesma coisa.
 */
export type TipoDeLancamento = 'uma' | 'recorrente' | 'financiamento';
export type Comum = {
  kind: 'expense' | 'income' | 'transfer';
  descricao: string;
  valorCents: number;
  contaId: string | null;
  dataBR: string;
  categoria: string | null;
  /** Lançamento e série têm; o financiamento não. */
  estabelecimento?: string;
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
  const { estabelecimento: _, ...fica } = c;
  return { ...fica, descricao: '', valorCents: 0, categoria: null };
}

export function comumParaSerie(c: Comum): Comum {
  return c.kind === 'transfer' ? { ...c, kind: 'expense' } : c;
}

export function hrefDoLancar(tipo: TipoDeLancamento, extra: Record<string, string> = {}) {
  return { pathname: '/finance/lancar' as const, params: { tipo, ...extra } };
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
  tx: { id: string; recurring_id?: string | null; installment_plan_id?: string | null; debt_id?: string | null },
  extra: Record<string, string> = {},
) {
  const papel = papelDaTransacao(tx);
  return hrefDoLancar('uma', { id: tx.id, origem: 'transacao', papel, ...(papel === 'avulsa' ? { passado: '0' } : {}), ...extra });
}
