/**
 * As regras de "Editar a compra", puras (os campos moram em `components/finance/compra-form.tsx`).
 *
 * A régua do contrato é a de `update_installment_plan` (`20260926130000`, *"tudo que se cria se edita"*).
 * A edição por escopo usa `update_installment_scope`: valor de parcela bancária já paga pode
 * ser corrigido com escolha explícita, mas o fechamento de fatura de cartão continua protegido.
 * No editor do contrato:
 * - com parcela paga, o NÚMERO muda — as pagas ficam e o que falta se reparte —, só não fica
 *   abaixo da última paga, e "à vista" continua fora (uma parte já foi paga separada);
 * - a DATA da 1ª e a CONTA mudam, a não ser que alguma parcela esteja numa fatura de cartão
 *   paga: ela sairia da fatura em que foi paga;
 * - as PARCELAS JÁ PAGAS mudam, a partir da última que foi paga junto com uma fatura de verdade.
 * A tela só oferece o que o banco aceita — botão habilitado que o servidor recusa é o espelho do
 * botão desabilitado que não explica.
 */
import { brToISO, isValidBRDate, isoToBR, monthBounds } from './dates.ts';
import { addMonthsISO } from './debt-history.ts';
import { MAX_PARCELAS, digitarValor, valorExibido, parcelaDoTotal, type Contrato, type UnidadeDoValor } from './finance-form.ts';

/** O que a compra gravada precisa ter para virar formulário (`InstallmentPlanSummary`). */
export interface CompraGravada {
  id: string;
  description: string | null;
  merchant: string | null;
  category: string | null;
  account_id: string | null;
  total_cents: number;
  installments: number;
  first_occurred_at: string;
  installment_cents: number;
  paid: number;
  locked: number;
  locked_cents: number;
  locked_paid: number;
  locked_in_invoice: number;
  last_locked_no: number;
  paid_floor: number;
}

export interface CompraForm {
  id: string;
  description: string;
  merchant: string;
  category: string | null;
  accountId: string | null;
  totalCents: number;
  installments: number;
  /** `dd/mm/aaaa`, como a pessoa digita. */
  inicio: string;
  /** Parcelas protegidas no editor estrutural do contrato e quanto elas somam. */
  travadas: number;
  travadasPagas: number;
  travadoCents: number;
  /** Das travadas, quantas estão numa fatura de cartão — elas prendem a data e a conta. */
  naFatura: number;
  /** A maior parcela travada: o número de parcelas não fica abaixo dela. */
  ultimaTravada: number;
  /** "Parcelas já pagas" — as primeiras N ficam pagas. */
  pagas: number;
  /** A última paga junto com uma fatura de verdade: não reabre por aqui. */
  pisoPagas: number;
  /**
   * O que o número do Valor é (23/09/2026). O total continua sendo a verdade; a parcela digitada
   * fica à parte para trocar a unidade não mexer em centavo nenhum (`ValorDaCompra`).
   */
  unidade: UnidadeDoValor;
  parcelaCents: number | null;
  /**
   * "Último dia de todo mês" escolhido no campo da data (28/09/2026). Não é coluna: as parcelas
   * guardam a própria data, e o salvar leva as do alcance ao fim do mês delas
   * (`update_installment_scope_last_day`). Fora do cartão.
   */
  ultimoDia?: boolean;
  /** Como a compra abriu — "cada parcela" antes de qualquer edição, e o que o salvar compara. */
  original: { totalCents: number; installments: number; parcelaCents: number; accountId: string | null; pagas: number };
}

export function compraDoRegistro(p: CompraGravada): CompraForm {
  return {
    id: p.id,
    description: p.description ?? '',
    merchant: p.merchant ?? '',
    category: p.category,
    accountId: p.account_id,
    totalCents: p.total_cents,
    installments: p.installments,
    inicio: isoToBR(p.first_occurred_at),
    travadas: p.locked,
    travadasPagas: p.locked_paid,
    travadoCents: p.locked_cents,
    naFatura: p.locked_in_invoice,
    ultimaTravada: p.last_locked_no,
    pagas: p.paid,
    pisoPagas: p.paid_floor,
    unidade: 'total',
    parcelaCents: null,
    original: {
      totalCents: p.total_cents,
      installments: p.installments,
      parcelaCents: p.installment_cents,
      accountId: p.account_id,
      pagas: p.paid,
    },
  };
}

/**
 * O formulário de uma parcela usa valor por parcela e a data DELA; o contrato usa valor total e
 * data da PRIMEIRA. Ao escolher "a compra toda" no Salvar, convertemos a edição antes de mostrar
 * a revisão do contrato. A revisão estrutural ainda conserva parcelas já pagas.
 */
export function compraParaRevisaoDaParcela(
  plano: CompraGravada,
  parcela: { installment_no: number | null; occurred_at: string; amount_cents: number; description: string | null },
  rascunho: { occurred_at: string; amount_cents: number; description: string; merchant: string | null; category: string | null },
): CompraForm {
  const base = compraDoRegistro(plano);
  const numero = parcela.installment_no ?? 1;
  const mudouData = rascunho.occurred_at !== parcela.occurred_at;
  const mudouValor = rascunho.amount_cents !== parcela.amount_cents;
  const abertas = Math.max(0, plano.installments - plano.locked);
  const tituloDaCompra = rascunho.description === parcela.description
    ? base.description
    : rascunho.description.replace(new RegExp(`\\s+\\(${numero}/${plano.installments}\\)\\s*$`), '').trim();
  return {
    ...base,
    description: tituloDaCompra,
    merchant: rascunho.merchant ?? '',
    category: rascunho.category,
    inicio: mudouData ? isoToBR(addMonthsISO(rascunho.occurred_at, 1 - numero)) : base.inicio,
    totalCents: mudouValor && abertas > 0
      ? plano.locked_cents + abertas * rascunho.amount_cents
      : base.totalCents,
  };
}

export function contratoDaCompra(f: CompraForm): Contrato {
  return { parcelas: f.installments, travadas: f.travadas, travadoCents: f.travadoCents };
}

/** "Cada parcela" hoje: a parcela real enquanto nada mudou; com N trocado, a divisão nova. */
export function valorDoCampo(f: CompraForm): number {
  const c = contratoDaCompra(f);
  const hoje = f.installments === f.original.installments ? f.original.parcelaCents : parcelaDoTotal(f.totalCents, c);
  return valorExibido(f, f.unidade, c, hoje, f.original.totalCents);
}

/** O número digitado no Valor, na unidade escolhida. */
export function digitarNaCompra(f: CompraForm, valorCents: number): Partial<CompraForm> {
  return digitarValor(valorCents, f.unidade, contratoDaCompra(f));
}

/** POR QUE parte da compra não muda — a frase diz o motivo, não "travado". */
export function motivoDaTrava(f: CompraForm): string | undefined {
  if (f.naFatura > 0) return 'Tem parcela paga na fatura do cartão: data e cartão não mudam, senão ela sairia da fatura';
  return undefined;
}

export function validaCompra(f: CompraForm | null) {
  const travado = (f?.travadas ?? 0) > 0;
  const tituloOk = (f?.description.trim().length ?? 0) > 0;
  const emAberto = f ? Math.max(0, f.installments - f.travadas) : 0;
  // O alcance só é escolhido no Salvar. Antes dele, o editor não pode pressupor que
  // pagamentos antigos ficarão fixos: "Todas" pode redistribuir o total inteiro.
  const totalOk = Boolean(f && f.totalCents >= f.installments);
  // Conta obrigatória quando a compra nasceu com uma: sem ela `set_invoice` apagaria o
  // `invoice_id` das parcelas. A que nasceu sem conta continua editável sem uma.
  const contaOk = Boolean(f?.accountId || !f?.original.accountId);
  const faixa = { min: travado ? Math.max(2, f?.ultimaTravada ?? 0) : 1, max: MAX_PARCELAS };
  const pagasOk = Boolean(f && f.pagas >= f.pisoPagas && f.pagas <= f.installments);
  const podeSalvar = Boolean(f && tituloOk && totalOk && contaOk && pagasOk && isValidBRDate(f.inicio));
  return {
    travado,
    tituloOk,
    totalOk,
    contaOk,
    pagasOk,
    emAberto,
    faixa,
    /** Data e conta só mudam sem parcela paga numa fatura de cartão. */
    dataLivre: (f?.naFatura ?? 0) === 0,
    podeSalvar,
  };
}

/** Trocar o número de parcelas: quem digitou "cada parcela" continua com aquela parcela. */
export function mudarParcelas(f: CompraForm, n: number): Partial<CompraForm> {
  const c = { ...contratoDaCompra(f), parcelas: n };
  return {
    installments: n,
    totalCents: f.parcelaCents !== null ? c.travadoCents + f.parcelaCents * Math.max(0, n - c.travadas) : f.totalCents,
    // as já pagas não passam do número de parcelas
    pagas: Math.min(f.pagas, n),
  };
}

/** O que `update_installment_plan` recebe: as pagas só quando mudaram (senão nada muda nelas). */
export function payloadDaCompra(f: CompraForm, isoDaData: string) {
  return {
    planId: f.id,
    totalCents: f.totalCents,
    installments: f.installments,
    firstOccurredAt: isoDaData,
    description: f.description.trim(),
    merchant: f.merchant.trim() || null,
    category: f.category,
    accountId: f.accountId,
    paidInstallments: f.pagas !== f.original.pagas ? f.pagas : null,
  };
}

export type EscopoDaCompra = 'one' | 'future' | 'all';

/** The purchase sheet edits a contract total. The scope RPC distributes that total itself. */
/**
 * O que salvar com o alcance escolhido.
 *
 * ⚠️ **A data NÃO é contrato** (28/09/2026). Ela era, e com parcela paga nenhum alcance deixava
 * mudá-la: "Esta e as próximas" mandava escolher "Todas", e "Todas" recusava por haver parcela
 * paga — a queixa *"tentava editar uma parcela que já tinha 2 pagas e não editava"*. A data
 * nova é da parcela de referência (`ancoraNo`, a mesma distância da primeira) e as outras do
 * alcance andam junto (`update_installment_scope`); a paga no banco anda em "Todas", a paga
 * numa fatura de cartão o banco segura com o motivo.
 */
export function edicaoEscopadaDaCompra(f: CompraForm, original: CompraGravada, scope: EscopoDaCompra, ancoraNo = 1):
  | { kind: 'scope'; lastDay: boolean; patch: { total_cents?: number; amount_cents?: number; description?: string; merchant?: string | null; category?: string | null; occurred_at?: string } }
  | { kind: 'contract' }
  | { kind: 'no-op' }
  | { kind: 'structural-rejection'; reason: string }
  | { kind: 'protected-rejection'; reason: string } {
  const changedCount = f.installments !== original.installments;
  const ultimoDia = Boolean(f.ultimoDia);
  const changedDate = f.inicio !== isoToBR(original.first_occurred_at) || ultimoDia;
  const changedAccount = f.accountId !== original.account_id;
  const changedPaid = f.pagas !== original.paid;
  const changedTotal = f.totalCents !== original.total_cents;
  const changedAmount = f.unidade === 'parcela' && f.parcelaCents !== null
    && f.parcelaCents !== original.installment_cents;
  const structural = changedCount || changedAccount || changedPaid;

  if (structural && scope !== 'all') {
    return {
      kind: 'structural-rejection',
      reason: 'Quantidade, conta e parcelas já pagas pertencem ao contrato da compra. Escolha a opção que inclui as passadas para revisar o contrato.',
    };
  }
  if (scope === 'all' && (
    (original.locked_in_invoice > 0 && (changedTotal || changedAmount || changedDate || changedAccount)) ||
    (original.locked > 0 && changedAccount)
  )) {
    return {
      kind: 'protected-rejection',
      reason: 'Há parcela em fatura protegida ou um histórico de conta já pago. Essa mudança exige rever o fechamento antes de alterar o contrato.',
    };
  }
  if (structural && original.locked > 0 && changedTotal) {
    const open = f.installments - original.locked;
    if (open > 0 ? f.totalCents - original.locked_cents < open
      : f.totalCents !== original.locked_cents) {
      return {
        kind: 'structural-rejection',
        reason: 'Ao mudar a estrutura do contrato, o total precisa conservar as parcelas já pagas e deixar ao menos um centavo para cada parcela aberta.',
      };
    }
  }
  if (structural) return { kind: 'contract' };

  const patch: { total_cents?: number; amount_cents?: number; description?: string; merchant?: string | null; category?: string | null; occurred_at?: string } = {};
  if (changedAmount) patch.amount_cents = f.parcelaCents!;
  else if (changedTotal) patch.total_cents = f.totalCents;
  if (f.description.trim() !== (original.description ?? '')) patch.description = f.description.trim();
  if ((f.merchant.trim() || null) !== original.merchant) patch.merchant = f.merchant.trim() || null;
  if (f.category !== original.category) patch.category = f.category;
  if (changedDate && isValidBRDate(f.inicio)) {
    const naAncora = addMonthsISO(brToISO(f.inicio), ancoraNo - 1);
    // "Só esta" não é regra: o último dia vira a data dela mesma
    const data = ultimoDia && scope === 'one' ? monthBounds(naAncora.slice(0, 7)).to : naAncora;
    if (data !== addMonthsISO(original.first_occurred_at, ancoraNo - 1) || !ultimoDia) patch.occurred_at = data;
  }
  const lastDay = ultimoDia && scope !== 'one';
  return Object.keys(patch).length || lastDay ? { kind: 'scope', lastDay, patch } : { kind: 'no-op' };
}
