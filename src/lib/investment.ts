import { formatBRL } from './dates.ts';

/**
 * F12 — aplicar e resgatar com origem e destino. Puro: decodifica o que o banco devolve, valida a
 * folha Aplicar | Resgatar, monta o comando e as linhas de efeito. A regra de verdade mora no
 * banco (`investment_command`); aqui só se evita mandar o que ele recusaria e se explica antes.
 * A POSIÇÃO é uma conta `investment`; aplicar/resgatar é UMA transferência real (neutra em
 * receita, despesa e patrimônio).
 */
export type InvestmentInput =
  | { op: 'contribute'; position_account_id: string; from_account_id: string; amount_cents: string; occurred_on: string; note?: string | null }
  | { op: 'redeem'; position_account_id: string; to_account_id: string; amount_cents: string; occurred_on: string; note?: string | null }
  | { op: 'link'; transfer_id: string }
  | { op: 'edit'; movement_id: string; amount_cents: string; occurred_on: string; expected_revision: number }
  | { op: 'undo'; movement_id: string; expected_revision: number };

export interface InvestmentPosition {
  account_id: string; workspace_id: string; name: string; type_label: string;
  balance_cents: number; net_contributed_cents: number; movements_count: number;
}
export interface InvestmentMovement {
  id: string; kind: 'contribution' | 'redemption'; amount_cents: number | null; occurred_on: string; status: string | null;
  counterparty_account_id: string | null; counterparty_name: string | null; transfer_id: string | null;
  /** A transferência foi apagada por fora: sobra o movimento, que só pode ser desfeito. */
  deleted: boolean;
  created_transfer: boolean; revision: number; created_at: string; description: string | null;
}
/** Cursor composto do histórico (data da transferência, criação, id). */
export interface InvestmentCursor { on: string; created: string; id: string }
export interface InvestmentMovementsPage {
  position_account_id: string; movements: InvestmentMovement[]; has_more: boolean; next_before: InvestmentCursor | null;
}
export interface InvestmentLinkCandidate {
  id: string; amount_cents: number; occurred_on: string; description: string | null;
  from_account_id: string | null; from_name: string | null; to_account_id: string | null; to_name: string | null;
  position_account_id: string; kind: 'contribution' | 'redemption';
}

/** A folha: o que a pessoa escolheu, antes de virar comando. `contaId` é a ORIGEM ao aplicar e o DESTINO ao resgatar. */
export interface InvestmentDraft {
  direcao: 'aplicar' | 'resgatar';
  posicaoId: string | null;
  contaId: string | null;
  vincularId: string | null;
  cents: number;
  /** AAAA-MM-DD. */
  data: string;
  nota: string;
}
export interface InvestmentAccount { id: string; name: string; type: string; archived: boolean; balance_cents: number | null }
export interface InvestmentContext {
  contas: readonly InvestmentAccount[];
  posicoes: readonly InvestmentPosition[];
  hoje: string;
  /** Movimento em edição: o resgate pode usar de novo o que ele mesmo já tirou. */
  edicao?: { kind: 'contribution' | 'redemption'; amount_cents: number; occurred_on: string };
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function cents(value: unknown, what: string): number {
  const n = typeof value === 'string' && /^-?\d{1,16}$/.test(value) ? Number(value) : typeof value === 'number' ? value : NaN;
  if (!Number.isSafeInteger(n)) throw new Error(`Valor inválido em ${what}`);
  return n;
}
const list = (value: unknown, what: string): any[] => {
  if (!Array.isArray(value)) throw new Error(`Resposta inválida: ${what}`);
  return value;
};

export function decodeInvestmentPositions(raw: unknown): InvestmentPosition[] {
  return list(raw, 'posições').map((p) => ({
    account_id: p.account_id, workspace_id: p.workspace_id, name: p.name, type_label: p.type_label ?? 'Conta de investimento',
    balance_cents: cents(p.balance_cents, 'saldo'), net_contributed_cents: cents(p.net_contributed_cents, 'aportado'),
    movements_count: Number(p.movements_count ?? 0),
  }));
}

export function decodeInvestmentMovements(raw: unknown): InvestmentMovementsPage {
  const r = raw as any;
  if (!r || typeof r !== 'object' || typeof r.position_account_id !== 'string') throw new Error('Resposta inválida da posição');
  return {
    position_account_id: r.position_account_id,
    has_more: Boolean(r.has_more),
    next_before: r.next_before && typeof r.next_before.id === 'string' ? { on: r.next_before.on, created: r.next_before.created, id: r.next_before.id } : null,
    movements: list(r.movements, 'movimentos').map((m) => ({
      id: m.id, kind: m.kind, amount_cents: m.amount_cents == null ? null : cents(m.amount_cents, 'movimento'), occurred_on: m.occurred_on, status: m.status ?? null,
      counterparty_account_id: m.counterparty_account_id ?? null, counterparty_name: m.counterparty_name ?? null,
      transfer_id: m.transfer_id ?? null, deleted: m.transfer_id == null || Boolean(m.deleted), created_transfer: Boolean(m.created_transfer), revision: Number(m.revision),
      created_at: m.created_at, description: m.description ?? null,
    })),
  };
}

export function decodeInvestmentLinkCandidates(raw: unknown): InvestmentLinkCandidate[] {
  return list(raw, 'transferências').map((t) => ({
    id: t.id, amount_cents: cents(t.amount_cents, 'transferência'), occurred_on: t.occurred_on, description: t.description ?? null,
    from_account_id: t.from_account_id ?? null, from_name: t.from_name ?? null,
    to_account_id: t.to_account_id ?? null, to_name: t.to_name ?? null,
    position_account_id: t.position_account_id, kind: t.kind,
  }));
}

/** A outra ponta do aporte/resgate: conta comum, não arquivada — nem cartão, nem outra posição. */
export function contasParaInvestir<T extends { type: string; archived: boolean }>(contas: readonly T[]): T[] {
  return contas.filter((c) => !c.archived && c.type !== 'credit_card' && c.type !== 'investment');
}

/** `pronto` liga o botão; `motivo` só existe quando a pessoa já pediu algo que o banco recusaria. */
export function validarInvestimento(
  d: InvestmentDraft, ctx: InvestmentContext, brl: (cents: number) => string = formatBRL,
): { pronto: boolean; motivo: string | null } {
  const nao = (motivo: string | null = null) => ({ pronto: false, motivo });
  if (d.direcao === 'aplicar' && d.vincularId) return { pronto: true, motivo: null };
  if (!ISO.test(d.data)) return nao();
  if (!d.posicaoId || !d.contaId) return nao();
  if (d.posicaoId === d.contaId) return nao('Origem e destino precisam ser contas diferentes.');
  const outra = ctx.contas.find((c) => c.id === d.contaId);
  if (outra?.type === 'credit_card') return nao('Cartão de crédito não aplica nem recebe resgate.');
  if (outra?.type === 'investment') return nao('A outra ponta precisa ser uma conta que não seja de investimento.');
  if (d.cents <= 0 || !Number.isSafeInteger(d.cents)) return nao();
  if (d.direcao === 'resgatar') {
    const posicao = ctx.posicoes.find((p) => p.account_id === d.posicaoId);
    if (posicao) {
      // Editando um resgate, o valor que ele mesmo já tirou volta a estar disponível.
      const devolvido = ctx.edicao?.kind === 'redemption' && ctx.edicao.occurred_on <= ctx.hoje ? ctx.edicao.amount_cents : 0;
      const disponivel = Math.max(posicao.balance_cents + devolvido, 0);
      if (d.cents > disponivel) return nao(`Só há ${brl(disponivel)} disponíveis em ${posicao.name}.`);
    }
  }
  return { pronto: true, motivo: null };
}

/** O comando exato que a folha pede. Chame só com `validarInvestimento(...).pronto`. */
export function entradaDoInvestimento(d: InvestmentDraft, editando?: { id: string; revision: number }): InvestmentInput {
  const amount_cents = String(d.cents);
  const occurred_on = d.data;
  if (editando) return { op: 'edit', movement_id: editando.id, amount_cents, occurred_on, expected_revision: editando.revision };
  if (d.direcao === 'aplicar' && d.vincularId) return { op: 'link', transfer_id: d.vincularId };
  const note = d.nota.trim() || null;
  if (d.direcao === 'aplicar') return { op: 'contribute', position_account_id: d.posicaoId!, from_account_id: d.contaId!, amount_cents, occurred_on, note };
  return { op: 'redeem', position_account_id: d.posicaoId!, to_account_id: d.contaId!, amount_cents, occurred_on, note };
}

export interface LinhaDeEfeito { contaId: string; conta: string; rotulo: string; antes: number; depois: number }

/** Saldo antes → depois nas duas pontas. Transferência futura (ou vinculada) não mexe no saldo de hoje. */
export function efeitoDoInvestimento(d: InvestmentDraft, ctx: InvestmentContext): LinhaDeEfeito[] {
  if (d.vincularId || !validarInvestimento(d, ctx).pronto || d.data > ctx.hoje) return [];
  const posicao = ctx.posicoes.find((p) => p.account_id === d.posicaoId);
  const outra = ctx.contas.find((c) => c.id === d.contaId);
  if (!posicao || !outra || outra.balance_cents === null) return [];
  const delta = d.cents - (ctx.edicao && ctx.edicao.occurred_on <= ctx.hoje ? ctx.edicao.amount_cents : 0);
  const sinal = d.direcao === 'aplicar' ? 1 : -1;
  const pos: LinhaDeEfeito = { contaId: posicao.account_id, conta: posicao.name, rotulo: 'Saldo', antes: posicao.balance_cents, depois: posicao.balance_cents + sinal * delta };
  const out: LinhaDeEfeito = { contaId: outra.id, conta: outra.name, rotulo: 'Saldo', antes: outra.balance_cents, depois: outra.balance_cents - sinal * delta };
  return d.direcao === 'aplicar' ? [out, pos] : [pos, out];
}

/** "Aplicado a partir de Nubank", "Resgatado para Nubank"… */
export function naturezaDoMovimento(m: InvestmentMovement): string {
  if (m.deleted) return 'Lançamento apagado';
  const outra = m.counterparty_name ?? 'conta removida';
  const texto = m.kind === 'contribution' ? `Aplicado a partir de ${outra}` : `Resgatado para ${outra}`;
  return m.created_transfer ? texto : `${texto} (transferência vinculada)`;
}

/** Mensagem do banco quando ele explica; qualquer outra falha cai no texto de reserva. */
export function mensagemDoInvestimento(error: unknown, fallback: string, brl: (cents: number) => string = formatBRL): string {
  const e = error as { code?: unknown; message?: unknown } | null;
  if (!e || typeof e.message !== 'string' || typeof e.code !== 'string' || !['22023', 'PT422', 'PT409', '23505', '42501'].includes(e.code)) return fallback;
  const falta = /^SALDO_INSUFICIENTE: faltam (\d+) centavos em (\S+)/.exec(e.message);
  return falta ? `Falta ${brl(Number(falta[1]))} na posição em ${falta[2]}.` : e.message;
}
