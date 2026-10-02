import type { PaymentMethod } from './payment-method.ts';
import { brToISO, isValidBRDate, isoToBR, localISODate } from './dates.ts';
import { argsDaParcelada, dadosDoLancamento, linhaDaRecorrente, linhaDoFinanciamento } from './escrita.ts';
import { hrefDoLancar } from './lancar.ts';
import { montaRRule } from './serie.ts';

export type Forma = 'uma' | 'parcelado' | 'repete' | 'financiamento';
export type Repete = 'weekly' | 'monthly' | 'yearly';

/**
 * A hipótese do "E se…?" (spec 2026-09-29): rápida de fazer, com o que o detalhe por conta
 * precisa para estar CERTO — a conta (a fatura sai do cartão, a parcela da conta que paga), a
 * forma e o DIA (o dia decide em qual fatura a compra cai). Na simulação ela vira um registro de
 * verdade (`registroDaHipotese`) e é desfeita; o título, a categoria e o resto vêm no formulário
 * completo, na hora de aplicar.
 */
export type Hipotese = {
  id: string;
  kind: 'income' | 'expense';
  forma: Forma;
  /** Parcelado: o total da compra. Financiamento: o valor da parcela. Resto: o valor. */
  valor_cents: number;
  parcelas: number;
  repete: Repete;
  conta: string | null;
  paymentMethod?: PaymentMethod | null;
  /** ISO `YYYY-MM-DD`; nunca antes de hoje (a folha não deixa). */
  data: string;
};
export type RegistroSimulado = { tipo: 'lancamento' | 'parcelada' | 'recorrente' | 'financiamento'; dados: Record<string, unknown> };

/** O título do registro simulado — a pessoa dá o nome de verdade no formulário, ao aplicar. */
const TITULO = 'Hipótese';

export function novaHipotese(hoje: string): Hipotese {
  return {
    id: `h${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    kind: 'expense',
    forma: 'uma',
    valor_cents: 0,
    parcelas: 2,
    repete: 'monthly',
    conta: null,
    data: hoje,
  };
}

/**
 * O dia em que a hipótese vale: o dela, ou HOJE quando ele já passou. O rascunho mora no aparelho
 * e fica lá dias; com a data crua, a receita "atrasada" saía da projeção e a parcela caía numa
 * fatura já fechada, sem aviso (revisão final, 29/09/2026). A simulação, a linha e o Aplicar leem
 * daqui — os três dizem o mesmo dia.
 */
export function dataDaHipotese(h: Hipotese): string {
  const hoje = localISODate();
  return h.data < hoje ? hoje : h.data;
}

/** O que falta para a hipótese entrar na simulação, em uma frase — ou `null` quando está pronta. */
export function faltaNaHipotese(h: Hipotese): string | null {
  if (!(h.valor_cents > 0)) return 'Digite o valor';
  if (h.forma === 'parcelado' && !h.conta) return 'Escolha a conta ou o cartão';
  if (h.forma === 'financiamento' && !h.conta) return 'Escolha a conta que paga';
  if (h.forma === 'parcelado' && h.parcelas < 2) return 'Parcelado precisa de 2 parcelas ou mais';
  if (h.forma === 'financiamento' && h.parcelas < 1) return 'Diga quantas parcelas';
  return null;
}

/**
 * O registro que a simulação cria — montado pelos MESMOS construtores do salvar real
 * (`lib/escrita.ts`), para a compra cair na fatura certa, o financiamento seguir o cronograma e a
 * recorrência a frequência. `null` = incompleta (fica fora da simulação).
 *
 * `posicao` é a da hipótese no rascunho: a dívida tem nome ÚNICO no espaço, e dois financiamentos
 * chamados "Hipótese" faziam o segundo voltar 23505 (medido no staging, 29/09/2026).
 */
export function registroDaHipotese(hipotese: Hipotese, posicao: number): RegistroSimulado | null {
  if (faltaNaHipotese(hipotese)) return null;
  const h = { ...hipotese, data: dataDaHipotese(hipotese) };
  switch (h.forma) {
    case 'uma':
      return {
        tipo: 'lancamento',
        dados: dadosDoLancamento({
          ...(h.paymentMethod !== undefined ? { payment_method: h.paymentMethod } : {}),
          kind: h.kind, amount_cents: h.valor_cents, category: null, description: TITULO, merchant: null,
          account_id: h.conta, counterparty_account_id: null, occurred_at: h.data, status: 'pending', due_at: null,
          auto_confirm: false,
        }),
      };
    case 'parcelado': {
      const { rpc, args } = argsDaParcelada({
        ...(h.paymentMethod !== undefined ? { paymentMethod: h.paymentMethod } : {}),
        accountId: h.conta!, totalCents: h.valor_cents, installments: h.parcelas, paidInstallments: 0,
        occurredAt: h.data, description: TITULO, category: null, merchant: null,
      });
      return { tipo: 'parcelada', dados: { ...args, ultimo_dia: rpc === 'create_installment_plan_last_day' } };
    }
    case 'repete': {
      const [y, m, d] = h.data.split('-').map(Number);
      return {
        tipo: 'recorrente',
        dados: linhaDaRecorrente({
          ...(h.paymentMethod !== undefined ? { payment_method: h.paymentMethod } : {}),
          kind: h.kind, amount_cents: h.valor_cents, description: TITULO, merchant: null, category: null,
          account_id: h.conta, rrule: montaRRule(h.repete, new Date(y, m - 1, d), 1),
          next_run_at: `${h.data}T12:00:00.000Z`, end_date: null, auto_confirm: false,
        }),
      };
    }
    case 'financiamento':
      return {
        tipo: 'financiamento',
        dados: linhaDoFinanciamento({
          ...(h.paymentMethod !== undefined ? { payment_method: h.paymentMethod } : {}),
          name: `Financiamento da hipótese ${posicao + 1}`, kind: 'financing', calculation_mode: 'fixed_installments',
          principal_cents: h.valor_cents * h.parcelas, remaining_cents: h.valor_cents * h.parcelas,
          interest_rate_monthly: 0, installments: h.parcelas, installments_paid: 0, installment_cents: h.valor_cents,
          account_id: h.conta, due_day: Number(h.data.slice(8, 10)), first_due_date: h.data,
        }),
      };
  }
}

const REPETE: Record<Repete, string> = { weekly: 'toda semana', monthly: 'todo mês', yearly: 'todo ano' };

/** A linha da hipótese: lado, valor e forma · onde · quando. */
export function resumoDaHipotese(h: Hipotese, brl: (c: number) => string, nomeDaConta: (id: string) => string | null): string {
  const onde = h.conta ? (nomeDaConta(h.conta) ?? 'conta que não existe mais') : 'sem conta (só a visão geral)';
  const quando = isoToBR(dataDaHipotese(h));
  if (h.forma === 'financiamento') return `Financiamento de ${h.parcelas}× ${brl(h.valor_cents)} · ${onde} · 1ª em ${quando}`;
  const lado = h.kind === 'income' ? 'Entra' : 'Sai';
  const como = h.forma === 'parcelado' ? ` em ${h.parcelas}×` : h.forma === 'repete' ? ` ${REPETE[h.repete]}` : '';
  return `${lado} ${brl(h.valor_cents)}${como} · ${onde} · ${h.forma === 'uma' ? 'em' : 'a partir de'} ${quando}`;
}

/**
 * Para onde o "Aplicar" leva: o formulário COMPLETO do registro, pré-preenchido com tudo que a
 * hipótese tem. `deHipotese` é o id — salvar lá tira ESTA hipótese, mesmo que a lista tenha mudado.
 */
export function paramsDoAplicar(h: Hipotese): ReturnType<typeof hrefDoLancar> {
  const data = isoToBR(dataDaHipotese(h));
  const payment: Record<string, string> = h.paymentMethod !== undefined ? { paymentMethod: h.paymentMethod ?? '' } : {};
  if (h.forma === 'repete') {
    return hrefDoLancar('recorrente', { ...payment, deHipotese: h.id, kind: h.kind, amount: String(h.valor_cents), start: data, ...(h.conta ? { account: h.conta } : {}), repete: h.repete });
  }
  if (h.forma === 'financiamento') {
    return hrefDoLancar('financiamento', { ...payment, deHipotese: h.id, parcela: String(h.valor_cents), parcelas: String(h.parcelas), ...(h.conta ? { conta: h.conta } : {}), data });
  }
  return hrefDoLancar('uma', { ...payment, deHipotese: h.id, kind: h.kind, amount: String(h.valor_cents), data, parcelas: String(h.forma === 'parcelado' ? h.parcelas : 1), ...(h.conta ? { conta: h.conta } : {}) });
}

/**
 * O status com que o formulário do "Aplicar" nasce: data futura fora do cartão é "a pagar", com o
 * vencimento na data — como a simulação a tratou. Nascendo paga, o saldo mexia HOJE e o aplicado
 * deixava de ser o simulado (revisão final, 29/09/2026). No cartão quem decide é a fatura.
 */
export function pendenciaDoAplicar(
  dataBR: string | undefined,
  tipoDaConta: string | null | undefined,
  hoje: string,
): { pending: boolean; due_at: string | null } {
  const futura = !!dataBR && isValidBRDate(dataBR) && brToISO(dataBR) > hoje;
  return futura && tipoDaConta !== 'credit_card' ? { pending: true, due_at: dataBR } : { pending: false, due_at: null };
}
