/**
 * Pago × previsto (07/10/2026, *"nos lançamentos que eu paguei mais barato, tem que mostrar o valor
 * que eu paguei de fato… mostrando os dois valores, mas sem deixar feio"*).
 *
 * A régua do app inteiro: o valor da linha é o PAGO; o previsto entra na linha de apoio, curto, e só
 * quando é diferente. Em aberto não há o que comparar — o valor da linha É o previsto.
 */
type Cents = number | string | null | undefined;

/** O previsto de uma linha paga com outro valor (`transactions.expected_amount_cents`). */
export function previstoDaLinha(t: { status: string; amount_cents: Cents; expected_amount_cents?: Cents }): number | null {
  if (t.status !== 'cleared' || t.expected_amount_cents == null) return null;
  const previsto = Number(t.expected_amount_cents);
  return previsto > 0 && previsto !== Number(t.amount_cents) ? previsto : null;
}

/**
 * A parcela do CONTRATO de um pagamento de dívida de parcela fixa que saiu com outro valor. O
 * pagamento guarda a parcela que quitou em `debt_principal_cents` (a diferença mora em
 * `debt_interest_cents`). Com juros o principal é a amortização do mês, não "a parcela" — ali quem
 * explica é `detalheDoPagamento`, e esta função não diz nada.
 */
export function parcelaDoContratoPaga(
  p: { amount_cents: Cents; debt_principal_cents?: Cents },
  comJuros: boolean,
): number | null {
  if (comJuros || p.debt_principal_cents == null) return null;
  const parcela = Number(p.debt_principal_cents);
  return parcela > 0 && parcela !== Number(p.amount_cents) ? parcela : null;
}
