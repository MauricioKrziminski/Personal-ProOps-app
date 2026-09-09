/**
 * As parcelas que já ficaram para trás num financiamento.
 *
 * `debts` guarda o passado como CONTAGEM (`installments_paid`), não como lançamento:
 * quem diz "estou na nona parcela" está declarando oito pagamentos de que o app não
 * conhece data nem conta. O cronograma (`debt_schedule`) devolve só o que falta, então
 * abrir um financiamento de 48x com 8 pagas não mostrava nada para trás — o contrato
 * parecia ter nascido com 40 parcelas.
 *
 * Estas linhas são **apresentação derivada de uma contagem**, nunca lançamento: elas não
 * entram na projeção, não viram `transactions` e não mexem no saldo. Onde existe pagamento
 * de verdade (a RPC `pay_debt_installment` grava um `transactions` com `debt_payment_no`),
 * a data e o valor vêm dele; o resto é a cadência mensal do contrato, andando para trás a
 * partir da próxima parcela em aberto.
 */

export interface PaidInstallment {
  installment_no: number;
  /** ISO. Real quando `registered`; inferida da cadência mensal quando declarada. */
  due_date: string;
  payment_cents: number;
  /** Existe um lançamento por trás — a data e o valor são fato, não inferência. */
  registered: boolean;
}

export interface DebtPaymentRow {
  debt_payment_no: number | null;
  occurred_at: string;
  amount_cents: number;
}

/** Soma meses a uma data ISO, prendendo o dia no último do mês (31/01 − 1 = 31/12, 31/03 − 1 = 28/02). */
export function addMonthsISO(iso: string, months: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const alvo = new Date(Date.UTC(y, m - 1 + months, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimo));
  return alvo.toISOString().slice(0, 10);
}

export function paidInstallments({
  installmentsPaid,
  installmentCents,
  nextDueDate,
  payments = [],
}: {
  installmentsPaid: number;
  installmentCents: number;
  /** Vencimento da próxima parcela em aberto — a âncora da cadência. */
  nextDueDate: string | null | undefined;
  payments?: readonly DebtPaymentRow[];
}): PaidInstallment[] {
  const pagas = Math.max(0, Math.trunc(installmentsPaid || 0));
  if (pagas === 0) return [];
  // Quitada não tem próxima parcela: a cadência anda para trás a partir de hoje.
  const ancora = nextDueDate ?? new Date().toISOString().slice(0, 10);
  const porNumero = new Map<number, DebtPaymentRow>();
  for (const p of payments) {
    if (p.debt_payment_no != null) porNumero.set(p.debt_payment_no, p);
  }
  const linhas: PaidInstallment[] = [];
  for (let n = 1; n <= pagas; n++) {
    const real = porNumero.get(n);
    linhas.push(
      real
        ? {
            installment_no: n,
            due_date: real.occurred_at.slice(0, 10),
            payment_cents: Number(real.amount_cents),
            registered: true,
          }
        : {
            installment_no: n,
            due_date: addMonthsISO(ancora, n - (pagas + 1)),
            payment_cents: installmentCents,
            registered: false,
          },
    );
  }
  return linhas;
}
