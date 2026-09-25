/**
 * O que o "Paguei"/"Recebi" faz depois de a pessoa confirmar o valor (25/09/2026).
 *
 * Mesmo valor do previsto: só a baixa (`useMarkPaid`). Outro valor: primeiro corrige o valor pela
 * mesma porta da edição com escopo (`update_transaction_scoped`) — só este lançamento, ou este e
 * os próximos da série quando ela existe e a pessoa ligou "Usar este valor nas próximas" — e só
 * então dá a baixa. A regra de "próximos" (pendente E da data em diante) mora na RPC.
 */
export type PlanoDaBaixa = {
  corrigir: { scope: 'one' | 'future'; amount_cents: number } | null;
};

export function planoDaBaixa({
  previsto,
  pago,
  temSerie,
  nasProximas,
}: {
  previsto: number;
  pago: number;
  temSerie: boolean;
  nasProximas: boolean;
}): PlanoDaBaixa {
  if (!Number.isInteger(pago) || pago <= 0) throw new Error('O valor precisa ser maior que zero');
  if (pago === previsto) return { corrigir: null };
  return { corrigir: { scope: temSerie && nasProximas ? 'future' : 'one', amount_cents: pago } };
}

/**
 * Parcela fixa paga com outro valor (`20260925120000`, decisão do dono do produto): conta UMA
 * parcela — o saldo cai o valor dela — e a diferença é encargo (positiva) ou desconto (negativa).
 * Os limites e as frases são os do trigger `tg_transactions_debt_payment`, para a tela avisar
 * antes do toque em vez de o erro do banco chegar depois.
 */
export function pagamentoDaParcelaFixa(parcela: number, pago: number): { diferenca: number; erro: string | null } {
  const erro =
    pago * 2 < parcela
      ? 'Esse valor é menos da metade da parcela. Confere o valor pago?'
      : pago >= 2 * parcela
        ? 'Esse valor passa de uma parcela. Para pagar mais de uma, registre uma de cada vez.'
        : null;
  return { diferenca: pago - parcela, erro };
}

/**
 * Corrigir o VALOR de um pagamento de dívida pelo "Editar lançamento" (25/09/2026). A tela diz
 * antes do Salvar o que o banco recusaria (`tg_transactions_debt_payment`), e sabe quando
 * perguntar "Só este pagamento / Este e as próximas parcelas" — só na parcela fixa, e só com um
 * valor diferente do contrato: com juros quem calcula as próximas é a Price.
 */
export function correcaoDoPagamento(
  divida: {
    calculation_mode: 'amortized' | 'fixed_installments';
    installments: number | null;
    installments_paid: number;
    installment_cents: number | null;
    remaining_cents: number;
  },
  pagamento: {
    amount_cents: number;
    debt_payment_no: number | null;
    debt_principal_cents: number | null;
    debt_balance_after_cents: number | null;
  },
  novo: number,
): { erro: string | null; perguntaAsProximas: boolean } {
  if (novo === pagamento.amount_cents) return { erro: null, perguntaAsProximas: false };
  if (pagamento.debt_principal_cents == null) {
    return { erro: 'Pagamento sem o histórico da dívida: o valor dele não muda por aqui.', perguntaAsProximas: false };
  }
  if (divida.calculation_mode === 'fixed_installments') {
    const { erro } = pagamentoDaParcelaFixa(pagamento.debt_principal_cents, novo);
    return { erro, perguntaAsProximas: !erro && Boolean(divida.installments) && novo !== divida.installment_cents };
  }
  if (pagamento.debt_payment_no !== divida.installments_paid || pagamento.debt_balance_after_cents !== divida.remaining_cents) {
    return { erro: 'Numa dívida com juros, só o pagamento mais recente muda de valor.', perguntaAsProximas: false };
  }
  return { erro: null, perguntaAsProximas: false };
}

/**
 * A linha embaixo do total, no detalhe de um pagamento de dívida (25/09/2026): o que o valor pago
 * carrega. Sai da LINHA, nunca do contrato — `debt_principal_cents` é a parcela que este
 * pagamento quitou (o contrato pode ter mudado depois, com "Usar este valor nas próximas"), e o
 * resto é encargo/desconto (parcela fixa) ou juros (com juros). Corrigir o valor depois muda a
 * frase junto: o trigger mantém a parcela e recalcula a diferença.
 */
export function detalheDoPagamento(
  pagamento: { amount_cents: number; debt_principal_cents: number | null },
  modo: 'amortized' | 'fixed_installments' | null | undefined,
  fmt: (cents: number) => string,
): string | null {
  const parcela = pagamento.debt_principal_cents;
  if (parcela == null || !modo) return null;
  const diferenca = pagamento.amount_cents - parcela;
  if (diferenca === 0) return null;
  if (modo === 'amortized') {
    return diferenca > 0 ? `Amortização de ${fmt(parcela)} + ${fmt(diferenca)} de juros` : null;
  }
  return diferenca > 0
    ? `Parcela de ${fmt(parcela)} + ${fmt(diferenca)} de encargo`
    : `Parcela de ${fmt(parcela)} − ${fmt(-diferenca)} de desconto`;
}
