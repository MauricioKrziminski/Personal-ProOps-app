import { paymentMethodAccounts, type PaymentMethod } from './payment-method.ts';

type Conta = { id: string; type?: string | null; archived?: boolean | null };

/**
 * A conta que o formulário sugere ao CRIAR do zero. Precedência: contexto > forma > padrão.
 * Nunca devolve conta arquivada ou que não está em `contas`.
 */
export function contaSugerida(a: {
  contexto?: string | null;
  forma: PaymentMethod | null | undefined;
  contaPadrao: string | null | undefined;
  cartaoPadrao: string | null | undefined;
  contas: readonly Conta[];
}): string | null {
  if (a.contexto) return a.contexto;
  const ativa = (id: string | null | undefined) => a.contas.find((c) => c.id === id && !c.archived);
  if (a.forma === 'credit') {
    const cartao = ativa(a.cartaoPadrao);
    return cartao?.type === 'credit_card' ? cartao.id : null;
  }
  const conta = ativa(a.contaPadrao);
  if (!conta || conta.type === 'credit_card') return null;
  return paymentMethodAccounts(a.forma, [conta]).length ? conta.id : null;
}

/** Quem paga (fatura, parcela): a conta que o registro já indica, senão a conta padrão se for pagadora ativa. */
export function contaQuePaga(propria: string | null | undefined, contaPadrao: string | null | undefined, pagadoras: readonly Conta[]): string | null {
  const ok = (id: string | null | undefined) => pagadoras.find((c) => c.id === id && !c.archived && c.type !== 'credit_card')?.id ?? null;
  return ok(propria) ?? ok(contaPadrao);
}

/**
 * A forma mudou e a conta do campo não serve mais para ela (corrente no crédito, cartão no débito):
 * a sugestão da forma nova entra no lugar, mesmo que a conta tenha sido escolhida à mão — a
 * alternativa era o erro "escolha uma conta compatível". Sem sugestão compatível, null (fica o erro).
 */
export function contaNoConflito(a: {
  forma: PaymentMethod | null | undefined;
  valor: string | null;
  contaPadrao: string | null | undefined;
  cartaoPadrao: string | null | undefined;
  contas: readonly Conta[];
}): string | null {
  const atual = a.contas.find((c) => c.id === a.valor);
  if (!atual || paymentMethodAccounts(a.forma, [atual]).length) return null;
  const sug = contaSugerida(a);
  return sug !== a.valor ? sug : null;
}
