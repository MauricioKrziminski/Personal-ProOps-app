/**
 * Como uma conta se chama na tela — fonte única.
 *
 * ## O defeito que isto existe para matar
 *
 * O seletor mostrava só `account.name`, e nome de conta não diz o que a conta É.
 * Em produção (09/09/2026) o dono do produto lançou o salário de R$ 4.000 num
 * CARTÃO DE CRÉDITO achando que era conta: as opções eram
 *
 *     Conta corrente · Conta corrente BB · BB · Nubank
 *
 * onde "Conta corrente" é a conta do Nubank e "Nubank" é o cartão do Nubank. A
 * frase dele foi exata: *"aparece só nubank e eu achei que era a conta corrente
 * nubank e nao cartao nubank"*. O par BB tem a mesma armadilha, invertida.
 *
 * Cartão não é uma conta a mais na lista: ele guarda DÍVIDA, não saldo, e o
 * mesmo lançamento significa o contrário nos dois. Escolher errado não dá erro
 * nenhum — só um número errado, meses depois.
 *
 * ## A regra
 *
 * Diga o tipo, a menos que o nome já diga. "Conta corrente" não vira
 * "Conta corrente · Corrente" (ruído que faz o usuário parar de ler o sufixo
 * justamente onde ele importa); "Nubank" vira "Nubank · Cartão".
 *
 * Vale para TODO lugar que oferece ou nomeia uma conta — formulário de
 * lançamento, transferência, importação de extrato, recorrente, pagamento de
 * fatura, filtro e as linhas de lista. `anti-slop.test.ts` quebra o build se
 * alguma tela voltar a desenhar `account.name` cru.
 */

export const ACCOUNT_TYPES = [
  { value: 'checking', label: 'Corrente' },
  { value: 'savings', label: 'Poupança' },
  { value: 'credit_card', label: 'Cartão' },
  { value: 'cash', label: 'Dinheiro' },
  { value: 'investment', label: 'Investimento' },
] as const;

const semAcento = (s: string) =>
  s.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase();

/** Só a palavra do tipo: "Corrente", "Cartão", "Poupança"... */
export function accountTypeLabel(account: { type?: string | null } | null | undefined): string {
  return ACCOUNT_TYPES.find((t) => t.value === account?.type)?.label ?? '';
}

/**
 * O rótulo de UMA LINHA: o nome, mais o tipo quando o nome não o entrega.
 *
 * Onde o tipo tem um lugar próprio na interface — o `AccountPicker`, que o
 * escreve embaixo do nome —, use o nome cru mais `accountTypeLabel`. Dizer
 * "Nubank · Cartão" numa linha que já tem "Cartão" embaixo é o ruído que ensina
 * a pessoa a não ler o sufixo.
 */
export function accountLabel(
  account: { name: string; type?: string | null } | null | undefined
): string {
  if (!account) return 'Sem conta';
  const tipo = ACCOUNT_TYPES.find((t) => t.value === account.type)?.label;
  if (!tipo) return account.name;
  // "Cartão Nubank" e "Nubank cartão" já se explicam; "Nubank" sozinho, não.
  return semAcento(account.name).includes(semAcento(tipo))
    ? account.name
    : `${account.name} · ${tipo}`;
}
