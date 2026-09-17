/**
 * "Quanto eu tenho agora" — a régua ÚNICA do caixa em conta.
 *
 * Ela mora aqui porque DUAS telas respondem essa pergunta (a Hoje, no bloco "Nas contas", e a
 * tela de Contas) e um app que mostra dois valores para o mesmo dinheiro em telas vizinhas é o
 * defeito que este repo já pagou várias vezes — ele não dá erro, só faz a pessoa parar de
 * confiar no número.
 *
 * ⚠️ **`cleared_cents`, nunca `balance_cents`.** O total é o dinheiro que ESTÁ lá; o que ainda
 * vai cair mora em `aReceber` e aparece como legenda, não somado dentro do número. `balance_cents`
 * é a leitura certa só para CARTÃO, que não entra aqui — ali a parcela futura é dívida já
 * assumida, e é por isso que cartão tem fatura, não saldo.
 */

/** As contas que GUARDAM dinheiro. Investimento e cartão são outra pergunta. */
export const GUARDA_DINHEIRO = ['checking', 'savings', 'cash'] as const;

export type SaldoDeConta = {
  account_id: string | null;
  name: string;
  type: string;
  balance_cents: number | string;
  cleared_cents: number | string;
  pending_in_cents: number | string;
  pending_out_cents: number | string;
};

export type LinhaDeCaixa = {
  /** `null` é o lançamento SEM conta — típico de quem só usa o WhatsApp. */
  id: string | null;
  nome: string;
  tipo: string;
  cents: number;
  /** O que ainda vai cair nesta conta; 0 quando não há. */
  aReceber: number;
};

export type Caixa = {
  total: number;
  aReceber: number;
  linhas: LinhaDeCaixa[];
};

/**
 * O caixa e as linhas que o compõem, da maior para a menor.
 *
 * ⚠️ **As linhas SOMAM o total, incluindo a "Sem conta".** A tentação é esconder a pseudo-linha
 * do `account_id` nulo por não ser uma conta de verdade — e aí o topo deixa de ser a soma do que
 * está embaixo dele, que é a regra que o Financeiro já quebrou uma vez. Ela também é acionável:
 * ver "Sem conta · R$ 300,00" é o que faz a pessoa ir lá dizer de qual conta saiu.
 */
export function caixaDasContas(saldos: readonly SaldoDeConta[]): Caixa {
  const doCaixa = saldos.filter(
    (s) => s.account_id === null || (GUARDA_DINHEIRO as readonly string[]).includes(s.type)
  );

  const linhas = doCaixa
    .map((s) => ({
      id: s.account_id,
      nome: s.account_id === null ? 'Sem conta' : s.name,
      tipo: s.account_id === null ? 'none' : s.type,
      cents: Number(s.cleared_cents),
      aReceber: Number(s.pending_in_cents),
    }))
    // Zerada E sem nada a receber não informa nada; a conta continua existindo na tela de Contas.
    .filter((l) => l.cents !== 0 || l.aReceber !== 0)
    .sort((a, b) => b.cents - a.cents);

  return {
    total: linhas.reduce((s, l) => s + l.cents, 0),
    aReceber: linhas.reduce((s, l) => s + l.aReceber, 0),
    linhas,
  };
}
