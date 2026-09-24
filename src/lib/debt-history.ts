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
  // Quitada não tem próxima parcela: a cadência anda para trás a partir de hoje.
  const ancora = nextDueDate ?? new Date().toISOString().slice(0, 10);
  const porNumero = new Map<number, DebtPaymentRow>();
  for (const p of payments) {
    if (p.debt_payment_no != null) porNumero.set(p.debt_payment_no, p);
  }
  // Pagamento lançado com número ACIMA das pagas (dado de antes do piso das pagas) é fato: ele
  // entra como pago, e a contagem estimada vai até ele.
  const ate = Math.max(pagas, ...porNumero.keys());
  if (ate === 0) return [];
  const linhas: PaidInstallment[] = [];
  for (let n = 1; n <= ate; n++) {
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

export interface ItemDaLinha {
  n: number;
  iso: string;
  cents: number;
  jurosCents: number | null;
  estado: 'paga' | 'estimada' | 'proxima' | 'futura';
}

/**
 * O contrato inteiro numa linha só, agrupado por ano: o passado (histórico, com a mesma régua de
 * `paidInstallments`) e o que falta (o cronograma do banco, cuja 1ª linha é a próxima).
 */
export function linhaDoTempo(
  historico: readonly PaidInstallment[],
  futuras: readonly {
    installment_no: number;
    due_date: string;
    payment_cents: number;
    interest_cents: number | null;
  }[],
): { ano: string; itens: ItemDaLinha[] }[] {
  const itens: ItemDaLinha[] = [
    ...historico.map((p) => ({
      n: p.installment_no,
      iso: p.due_date,
      cents: p.payment_cents,
      jurosCents: null,
      estado: p.registered ? ('paga' as const) : ('estimada' as const),
    })),
    // O cronograma começa em `pagas + 1`; a parcela que já tem pagamento lançado não é futura.
    ...futuras.filter((p) => !historico.some((h) => h.installment_no === p.installment_no)).map((p, i) => ({
      n: p.installment_no,
      iso: p.due_date,
      cents: Number(p.payment_cents),
      jurosCents: p.interest_cents == null ? null : Number(p.interest_cents),
      estado: i === 0 ? ('proxima' as const) : ('futura' as const),
    })),
  ];
  return porAno(itens);
}

/** Agrupa por ano sem mudar a ordem: um cabeçalho a cada vez que o ano muda. */
export function porAno(itens: readonly ItemDaLinha[]): { ano: string; itens: ItemDaLinha[] }[] {
  const anos: { ano: string; itens: ItemDaLinha[] }[] = [];
  for (const item of itens) {
    const ano = item.iso.slice(0, 4);
    if (anos.at(-1)?.ano !== ano) anos.push({ ano, itens: [] });
    anos.at(-1)!.itens.push(item);
  }
  return anos;
}

/**
 * As duas metades do contrato (24/09/2026). O que FALTA começa pela próxima parcela — é a
 * resposta da tela —, e o que já foi PAGO vem do mais recente para o mais antigo. Numa linha só,
 * de 1 a 360, a próxima ficava centenas de linhas abaixo do topo.
 */
export function secoesDaLinha(
  historico: readonly PaidInstallment[],
  futuras: Parameters<typeof linhaDoTempo>[1],
): { aSeguir: ItemDaLinha[]; pagas: ItemDaLinha[] } {
  const itens = linhaDoTempo(historico, futuras).flatMap((a) => a.itens);
  return {
    aSeguir: itens.filter((i) => i.estado === 'proxima' || i.estado === 'futura'),
    pagas: itens.filter((i) => i.estado === 'paga' || i.estado === 'estimada').reverse(),
  };
}
