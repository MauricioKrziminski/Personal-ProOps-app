/**
 * As regras de "Editar a compra", puras (os campos moram em `components/finance/compra-form.tsx`).
 *
 * A régua é a de `update_installment_plan` (`20260926130000`, *"tudo que se cria se edita"*):
 * - com parcela paga, o NÚMERO muda — as pagas ficam e o que falta se reparte —, só não fica
 *   abaixo da última paga, e "à vista" continua fora (uma parte já foi paga separada);
 * - a DATA da 1ª e a CONTA mudam, a não ser que alguma parcela esteja numa fatura de cartão
 *   paga: ela sairia da fatura em que foi paga;
 * - as PARCELAS JÁ PAGAS mudam, a partir da última que foi paga junto com uma fatura de verdade.
 * A tela só oferece o que o banco aceita — botão habilitado que o servidor recusa é o espelho do
 * botão desabilitado que não explica.
 */
import { isValidBRDate, isoToBR } from './dates.ts';
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
  /** Parcelas que não mudam de valor (pagas ou em fatura fechada) e quanto elas somam. */
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
  const restante = f ? f.totalCents - f.travadoCents : 0;
  const totalOk = Boolean(
    f && f.totalCents >= f.installments && (!travado || (emAberto > 0 ? restante >= emAberto : restante === 0)),
  );
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
