import { formatBRL } from './dates.ts';

/**
 * F11 — onde está o dinheiro de uma meta. Puro: decodifica o estado do banco, valida a folha
 * Guardar/Retirar, monta o comando e as linhas de efeito. A regra de verdade mora no banco
 * (`goal_money_command`); aqui só se evita mandar o que ele recusaria e se explica antes.
 */
export type GoalMoneyInput =
  | { op: 'allocate'; goal_id: string; account_id: string; amount_cents: string; occurred_on: string; note?: string | null }
  | { op: 'transfer_in'; goal_id: string; from_account_id: string; account_id: string; amount_cents: string; occurred_on: string; note?: string | null }
  | { op: 'link_in'; goal_id: string; transfer_id: string }
  | { op: 'release'; goal_id: string; account_id: string | null; amount_cents: string; occurred_on: string; note?: string | null }
  | { op: 'transfer_out'; goal_id: string; account_id: string; to_account_id: string; amount_cents: string; occurred_on: string; note?: string | null }
  | { op: 'undo'; movement_id: string; expected_revision: number };

export type GoalMoneyKind = 'allocate' | 'transfer_in' | 'link_in' | 'release' | 'transfer_out';

export interface GoalMoneyAccount {
  account_id: string; name: string; type: string; archived: boolean;
  goal_cents: number; cash_cents: number; allocated_cents: number; free_cents: number;
}
export interface GoalMoneyMovement {
  id: string; kind: GoalMoneyKind; account_id: string | null; account_name: string | null;
  other_account_id: string | null; other_account_name: string | null; amount_cents: number;
  occurred_on: string; transfer_id: string | null; created_transfer: boolean; revision: number;
  created_at: string; note: string | null; contribution_id: string | null;
}
export interface GoalMoneyState {
  goal_id: string; accounts: GoalMoneyAccount[]; movements: GoalMoneyMovement[];
  has_more: boolean; next_before: string | null;
}
export interface GoalLinkCandidate {
  id: string; amount_cents: number; occurred_on: string; status: string; description: string | null;
  from_account_id: string | null; from_name: string | null; to_account_id: string | null; to_name: string | null;
}

/** A folha: o que a pessoa escolheu, antes de virar comando. */
export interface GoalMoneyDraft {
  direcao: 'guardar' | 'retirar';
  via: 'conta' | 'transferir';
  /** Onde fica (ou estava) separado: a conta, ou o DESTINO ao guardar por transferência / a ORIGEM ao retirar. */
  contaId: string | null;
  /** A outra ponta da transferência (origem ao guardar, destino ao retirar). */
  outraContaId: string | null;
  vincularId: string | null;
  cents: number;
  /** AAAA-MM-DD. */
  data: string;
  nota: string;
}

const MAX = Number.MAX_SAFE_INTEGER;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function cents(value: unknown, what: string): number {
  const n = typeof value === 'string' && /^-?\d{1,16}$/.test(value) ? Number(value) : typeof value === 'number' ? value : NaN;
  if (!Number.isSafeInteger(n) || Math.abs(n) > MAX) throw new Error(`Valor inválido em ${what}`);
  return n;
}
const list = (value: unknown, what: string): any[] => {
  if (!Array.isArray(value)) throw new Error(`Resposta inválida: ${what}`);
  return value;
};

export function decodeGoalMoneyState(raw: unknown): GoalMoneyState {
  const r = raw as any;
  if (!r || typeof r !== 'object' || typeof r.goal_id !== 'string') throw new Error('Resposta inválida da meta');
  return {
    goal_id: r.goal_id,
    has_more: Boolean(r.has_more),
    next_before: typeof r.next_before === 'string' ? r.next_before : null,
    accounts: list(r.accounts, 'contas').map((a) => ({
      account_id: a.account_id, name: a.name, type: a.type, archived: Boolean(a.archived),
      goal_cents: cents(a.goal_cents, 'separado da meta'), cash_cents: cents(a.cash_cents, 'caixa'),
      allocated_cents: cents(a.allocated_cents, 'separado'), free_cents: cents(a.free_cents, 'livre'),
    })),
    movements: list(r.movements, 'movimentações').map((m) => ({
      id: m.id, kind: m.kind, account_id: m.account_id ?? null, account_name: m.account_name ?? null,
      other_account_id: m.other_account_id ?? null, other_account_name: m.other_account_name ?? null,
      amount_cents: cents(m.amount_cents, 'movimentação'), occurred_on: m.occurred_on,
      transfer_id: m.transfer_id ?? null, created_transfer: Boolean(m.created_transfer),
      revision: Number(m.revision), created_at: m.created_at, note: m.note ?? null, contribution_id: m.contribution_id ?? null,
    })),
  };
}

export function decodeGoalLinkCandidates(raw: unknown): GoalLinkCandidate[] {
  return list(raw, 'transferências').map((t) => ({
    id: t.id, amount_cents: cents(t.amount_cents, 'transferência'), occurred_on: t.occurred_on, status: t.status,
    description: t.description ?? null, from_account_id: t.from_account_id ?? null, from_name: t.from_name ?? null,
    to_account_id: t.to_account_id ?? null, to_name: t.to_name ?? null,
  }));
}

/** `pronto` liga o botão; `motivo` só existe quando a pessoa já pediu algo que o banco recusaria. */
export function validarMovimentacao(
  d: GoalMoneyDraft, state: GoalMoneyState | undefined, guardadoCents: number, hoje: string, brl: (cents: number) => string = formatBRL,
): { pronto: boolean; motivo: string | null } {
  const nao = (motivo: string | null = null) => ({ pronto: false, motivo });
  const transfere = d.via === 'transferir';
  if (d.direcao === 'guardar' && transfere && d.vincularId) return { pronto: true, motivo: null };
  if (!ISO.test(d.data)) return nao();
  const conta = state?.accounts.find((a) => a.account_id === d.contaId);
  if (transfere && d.contaId && d.outraContaId && d.contaId === d.outraContaId) return nao('Origem e destino precisam ser contas diferentes.');
  if (d.cents <= 0) return nao();
  if (!Number.isSafeInteger(d.cents)) return nao();
  if (!transfere && d.data > hoje) return nao('A data não pode ser futura.');
  if (d.direcao === 'guardar') {
    if (!d.contaId || (transfere && !d.outraContaId)) return nao();
    if (!transfere && conta && d.cents > conta.free_cents) {
      return nao(`Só há ${brl(Math.max(conta.free_cents, 0))} livres em ${conta.name}.`);
    }
    return { pronto: true, motivo: null };
  }
  if (d.cents > guardadoCents) return nao(`Retira até ${brl(guardadoCents)}.`);
  if (transfere && (!d.contaId || !d.outraContaId)) return nao();
  if (d.contaId && conta && d.cents > conta.goal_cents) return nao(`Só há ${brl(conta.goal_cents)} separados nesta conta.`);
  return { pronto: true, motivo: null };
}

/** O comando exato que a folha pede. Chame só com `validarMovimentacao(...).pronto`. */
export function entradaDaMovimentacao(goalId: string, d: GoalMoneyDraft): GoalMoneyInput {
  const note = d.nota.trim() || null;
  const amount_cents = String(d.cents);
  const occurred_on = d.data;
  if (d.direcao === 'guardar') {
    if (d.via === 'conta') return { op: 'allocate', goal_id: goalId, account_id: d.contaId!, amount_cents, occurred_on, note };
    if (d.vincularId) return { op: 'link_in', goal_id: goalId, transfer_id: d.vincularId };
    return { op: 'transfer_in', goal_id: goalId, from_account_id: d.outraContaId!, account_id: d.contaId!, amount_cents, occurred_on, note };
  }
  if (d.via === 'conta') return { op: 'release', goal_id: goalId, account_id: d.contaId, amount_cents, occurred_on, note };
  return { op: 'transfer_out', goal_id: goalId, account_id: d.contaId!, to_account_id: d.outraContaId!, amount_cents, occurred_on, note };
}

export interface LinhaDeEfeito { contaId: string; conta: string; rotulo: string; antes: number; depois: number }

/** O que muda em cada conta antes de salvar. Transferência futura não mexe no saldo de hoje. */
export function efeitoDaMovimentacao(state: GoalMoneyState | undefined, d: GoalMoneyDraft, hoje: string): LinhaDeEfeito[] {
  const valido = validarMovimentacao(d, state, Number.MAX_SAFE_INTEGER, hoje);
  if (!state || !valido.pronto || d.vincularId) return [];
  const linha = (id: string | null, rotulo: string, campo: 'goal_cents' | 'free_cents' | 'cash_cents', delta: number): LinhaDeEfeito[] => {
    const a = state.accounts.find((x) => x.account_id === id);
    return a ? [{ contaId: a.account_id, conta: a.name, rotulo, antes: a[campo], depois: a[campo] + delta }] : [];
  };
  const SEP = 'Separado para esta meta';
  const agora = d.data <= hoje;
  if (d.direcao === 'guardar' && d.via === 'conta') return [...linha(d.contaId, SEP, 'goal_cents', d.cents), ...linha(d.contaId, 'Livre na conta', 'free_cents', -d.cents)];
  if (d.direcao === 'guardar') {
    return [...(agora ? [...linha(d.outraContaId, 'Saldo', 'cash_cents', -d.cents), ...linha(d.contaId, 'Saldo', 'cash_cents', d.cents)] : []),
      ...linha(d.contaId, SEP, 'goal_cents', d.cents)];
  }
  if (!d.contaId) return [];
  if (d.via === 'conta') return [...linha(d.contaId, SEP, 'goal_cents', -d.cents), ...linha(d.contaId, 'Livre na conta', 'free_cents', d.cents)];
  return [...linha(d.contaId, SEP, 'goal_cents', -d.cents),
    ...(agora ? [...linha(d.contaId, 'Saldo', 'cash_cents', -d.cents), ...linha(d.outraContaId, 'Saldo', 'cash_cents', d.cents)] : [])];
}

/** "Separado em Nubank", "Transferido de Nubank para Caixinha"… */
export function naturezaDaMovimentacao(m: GoalMoneyMovement): string {
  const conta = m.account_name ?? 'conta removida';
  const outra = m.other_account_name ?? 'conta removida';
  switch (m.kind) {
    case 'allocate': return `Separado em ${conta}`;
    case 'transfer_in': return `Transferido de ${outra} para ${conta}`;
    case 'link_in': return `Transferência vinculada de ${outra} para ${conta}`;
    case 'release': return m.account_id || m.account_name ? `Liberado de ${conta}` : 'Retirado sem origem';
    case 'transfer_out': return `Transferido de ${conta} para ${outra}`;
  }
}

/** Mensagem do banco quando ele explica; qualquer outra falha cai no texto de reserva. */
export function mensagemDaMovimentacao(error: unknown, fallback: string, brl: (cents: number) => string = formatBRL): string {
  const e = error as { code?: unknown; message?: unknown } | null;
  if (!e || typeof e.message !== 'string' || typeof e.code !== 'string' || !['22023', 'PT422', 'PT409', '23505', '42501'].includes(e.code)) return fallback;
  const livre = /^SALDO_INSUFICIENTE: livre (\d+) centavos/.exec(e.message);
  return livre ? `Só há ${brl(Number(livre[1]))} livres nessa conta.` : e.message;
}
