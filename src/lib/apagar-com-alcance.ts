import type { EditScope, EditScopeKind } from './edit-scope-model';

export type TipoDoApagar = 'occurrence' | 'installment' | 'debt_payment' | 'recurring' | 'plan' | 'debt' | 'reminder';
export type AlvoDoApagar = { tipo: TipoDoApagar; id: string; nome: string; ancora?: string };
export type PreviaDoApagar = {
  apagadas: number; pagas: number; somaPagasCents: number; contas: string[]; desde: string | null;
  apagaContrato: boolean;
  /** Sobra 1 parcela: a compra vira à vista. */
  viraAvista: boolean;
};

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export const ehContrato = (tipo: TipoDoApagar) => tipo === 'recurring' || tipo === 'plan' || tipo === 'debt';

export function kindDoApagar(tipo: TipoDoApagar): EditScopeKind {
  if (tipo === 'installment' || tipo === 'plan') return 'installment';
  if (tipo === 'debt_payment' || tipo === 'debt') return 'payment';
  if (tipo === 'reminder') return 'reminder';
  return 'occurrence';
}

/** O que o banco recusa não é oferecido: dívida (contrato) só "Todas"; lembrete só "Só esta"/"Todas". */
export function alcancesDoApagar(tipo: TipoDoApagar): EditScope[] | undefined {
  if (tipo === 'debt') return ['all'];
  if (tipo === 'reminder') return ['one', 'all'];
  return undefined;
}

/** O dinheiro chega como texto decimal (padrão das escritas compostas) e é conferido antes de virar número. */
export function lerPrevia(json: unknown): PreviaDoApagar {
  const j = json as Record<string, unknown> | null;
  const inteiro = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0;
  if (!j || !inteiro(j.apagadas) || !inteiro(j.pagas_apagadas) || typeof j.soma_pagas_cents !== 'string'
      || !/^\d+$/.test(j.soma_pagas_cents) || !Array.isArray(j.contas)) {
    throw new Error('Resposta do apagar em formato inesperado');
  }
  return {
    apagadas: j.apagadas as number, pagas: j.pagas_apagadas as number, somaPagasCents: Number(j.soma_pagas_cents),
    contas: (j.contas as unknown[]).map(String), desde: typeof j.desde === 'string' ? j.desde : null,
    apagaContrato: j.apaga_contrato === true, viraAvista: j.vira_avista === true,
  };
}

const lista = (nomes: string[]) => (nomes.length > 1 ? `${nomes.slice(0, -1).join(', ')} e ${nomes.at(-1)}` : nomes[0] ?? '');

/** A segunda confirmação só existe quando o alcance leva coisa PAGA; sem isso, a pergunta já confirmou. */
export function fraseDoEstrago(p: PreviaDoApagar, brl: (cents: number) => string): string | null {
  if (p.pagas === 0) return null;
  const n = p.pagas === 1 ? '1 lançamento já pago' : `${p.pagas} lançamentos já pagos`;
  const contas = p.contas.length === 0 ? '' : p.contas.length === 1 ? ` e muda o saldo da ${p.contas[0]}` : ` e muda o saldo das contas ${lista(p.contas)}`;
  const desde = p.desde ? ` e o histórico desde ${MESES[Number(p.desde.slice(5, 7)) - 1]} de ${p.desde.slice(0, 4)}` : '';
  return `Isso apaga ${n} (${brl(p.somaPagasCents)})${contas}${desde}.`;
}

export function textoDoApagado(p: PreviaDoApagar): string {
  if (p.apagaContrato && p.apagadas === 0) return 'Apagado por completo.';
  return p.apagadas === 1 ? '1 lançamento apagado.' : `${p.apagadas} lançamentos apagados.`;
}

/** Ocorrência, parcela e pagamento perguntam o alcance; o avulso não (`null`). */
export function alvoDoLancamento(
  tx: { id: string; recurring_id?: string | null; installment_plan_id?: string | null; debt_id?: string | null },
  nome: string,
): AlvoDoApagar | null {
  if (tx.recurring_id) return { tipo: 'occurrence', id: tx.id, nome };
  if (tx.installment_plan_id) return { tipo: 'installment', id: tx.id, nome };
  if (tx.debt_id) return { tipo: 'debt_payment', id: tx.id, nome };
  return null;
}
