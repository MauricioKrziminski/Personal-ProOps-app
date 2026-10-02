import { semAcento } from './text.ts';

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

/**
 * Os cinco tipos de conta, com o glifo de cada um.
 *
 * O ícone mora AQUI porque ele é o que separa cartão de conta antes de qualquer
 * texto — foi o que fez o `AccountPicker` existir, depois de um salário de
 * R$ 4.000 ser lançado dentro da fatura do cartão. Ele estava em dois mapas
 * privados que **discordavam**: `cash` era `dollarsign.circle` na tela de contas
 * e `wallet.bifold` no seletor, ou seja, o mesmo tipo tinha duas caras no mesmo
 * app. Uma fonte só.
 *
 * `meta` é a segunda linha da opção, e só o cartão tem: escolher "Cartão" TROCA
 * os campos de baixo (some o saldo inicial, entram fechamento, vencimento,
 * limite e rotativo), e dizer o que vai mudar é a metade que faltava. Dar `meta`
 * às cinco opções seria a parede de cinza que o resto desta leva está desmontando.
 *
 * ⚠️ Sem `import type { IconName }` aqui: este arquivo é lido por `node --test`
 * (`accounts.test.ts`), e importar do `@/components/ui/icon` traria `expo-symbols`
 * junto. O `as const` já dá os tipos literais, que são atribuíveis a `IconName`.
 */
export const ACCOUNT_TYPES = [
  { value: 'checking', label: 'Corrente', icon: 'building.columns' },
  { value: 'savings', label: 'Poupança', icon: 'banknote' },
  { value: 'credit_card', label: 'Cartão', icon: 'creditcard' },
  { value: 'cash', label: 'Dinheiro', icon: 'wallet.bifold' },
  { value: 'investment', label: 'Investimento', icon: 'chart.line.uptrend.xyaxis' },
] as const;

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

export type AccountOptionAccount = {
  id: string; name: string; type?: string | null; closing_day?: number | null; archived?: boolean;
  credit_limit_cents?: number | null;
};
type FinancialQuery<Row> = {
  data?: readonly Row[];
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  isPaused: boolean;
};
export type AccountPickerContext = {
  balances: FinancialQuery<{ account_id: string | null; cleared_cents: unknown }>;
  cards: FinancialQuery<{ account_id: string; credit_limit_cents: unknown; available_limit_cents: unknown; limit_status?: string }>;
  format: (cents: number) => string;
  concealed: boolean;
};

/** SQL bigint may arrive as text; never round an unsafe aggregate or turn null into zero. */
function safeCents(value: unknown): number | null {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^-?\d+$/.test(value))) return null;
  const cents = Number(value);
  return Number.isSafeInteger(cents) ? cents : null;
}

/** Opções de conta com o mesmo tipo, glifo e agrupamento em formulários e filtros. */
export function accountSelectOptions(accounts: readonly AccountOptionAccount[], emptyLabel?: string,
  emptyId: string | null = null, context?: AccountPickerContext) {
  const contas = accounts.filter(a => a.type !== 'credit_card');
  const cartoes = accounts.filter(a => a.type === 'credit_card');
  const agrupado = contas.length > 0 && cartoes.length > 0;
  // Two aggregate resources, indexed once. No query or scan for each option.
  const balances = new Map(context?.balances.data?.map(row => [row.account_id, row]));
  const cards = new Map(context?.cards.data?.map(row => [row.account_id, row]));
  const financialDetail = (a: AccountOptionAccount) => {
    if (!context || a.archived) return {};
    const card = a.type === 'credit_card';
    const resource = card ? context.cards : context.balances;
    const noun = card ? 'Limite' : 'Saldo';
    if (resource.isPaused) return { detail: `${noun} aguardando conexão` };
    if (resource.isError) return { detail: `${noun} indisponível`, detailUnavailable: true };
    if (resource.isPending) return { detail: `Carregando ${noun.toLowerCase()}…` };
    const row = card ? cards.get(a.id) : balances.get(a.id);
    if (card && row && 'limit_status' in row && row.limit_status === 'needs_review') {
      return { detail: 'Limite precisa de conferência' };
    }
    if (card && (a.credit_limit_cents === null || row && 'credit_limit_cents' in row && row.credit_limit_cents === null)) {
      return { detail: 'Limite não cadastrado' };
    }
    if (card && row && (!('limit_status' in row) || row.limit_status !== 'available')) {
      return { detail: 'Limite indisponível', detailUnavailable: true };
    }
    const cents = safeCents(card ? (row && 'available_limit_cents' in row ? row.available_limit_cents : undefined)
      : (row && 'cleared_cents' in row ? row.cleared_cents : undefined));
    const limit = card && row && 'credit_limit_cents' in row ? safeCents(row.credit_limit_cents) : 0;
    if (cents === null || limit === null || limit < 0) return { detail: `${noun} indisponível`, detailUnavailable: true };
    const value = context.concealed ? '••••••' : `${cents < 0 ? '−' : ''}${context.format(Math.abs(cents))}`;
    const label = card ? 'Limite disponível' : 'Saldo no ProOps';
    return { detail: `${label} ${value}${resource.isFetching ? ' · atualizando' : ''}`, detailHidden: `${label} ••••••` };
  };
  const option = (a: typeof accounts[number]) => {
    const tipo = accountTypeLabel(a);
    return { id: a.id, label: a.name,
      meta: a.archived ? `${tipo} · arquivada` : a.type === 'credit_card' && a.closing_day ? `${tipo} · fecha dia ${a.closing_day}` : tipo,
      icon: ACCOUNT_TYPES.find(t => t.value === a.type)?.icon ?? 'building.columns',
      group: agrupado ? a.type === 'credit_card' ? 'CARTÕES' : 'CONTAS' : undefined,
      ...financialDetail(a),
    } as const;
  };
  return [
    ...(emptyLabel ? [{ id: emptyId, label: emptyLabel, icon: 'minus' as const, neutral: true }] : []),
    ...contas.map(option), ...cartoes.map(option),
  ];
}

/**
 * O saldo de UMA conta, na régua da tela Contas — a mesma função nas duas telas.
 *
 * Conta de dinheiro mostra o CONFIRMADO (`cleared_cents`), e o que falta cair vai à parte
 * ("a receber"); cartão mostra o TOTAL (`balance_cents`), porque a parcela futura é dívida já
 * assumida, e à parte o que ainda vai vencer. Existe desde 24/09/2026 para o extrato de uma conta
 * dizer quanto ela tem — só dizia os totais do período (*"como acessar saldo de uma conta
 * específica"*).
 */
export function saldoDaConta(saldo: {
  type: string;
  balance_cents: number | string;
  cleared_cents: number | string;
  pending_in_cents: number | string;
  pending_out_cents: number | string;
}): { cents: number; previsto: number; rotulo: string; previstoTexto: string } {
  const cartao = saldo.type === 'credit_card';
  return {
    cents: Number(cartao ? saldo.balance_cents : saldo.cleared_cents),
    previsto: Number(cartao ? saldo.pending_out_cents : saldo.pending_in_cents),
    rotulo: cartao ? 'Saldo do cartão' : 'Saldo',
    previstoTexto: cartao ? 'a vencer' : 'a receber',
  };
}

/**
 * Editar a conta mostra o saldo ATUAL (28/09/2026, *"ao editar, depois de já ter criado, eu tenho
 * que conseguir editar o valor atual dele, e não mais o inicial"*). O banco continua guardando o
 * INICIAL — o saldo é derivado, nunca coluna —, então gravar anda o inicial pela diferença: o
 * atual passa a ser o digitado e os lançamentos ficam como estão. Sem mexer no campo, o inicial
 * não muda nem um centavo. `atualMostrado` é o de `saldoDaConta`, a régua da lista.
 */
export function inicialParaOSaldo(desejado: number, atualMostrado: number, inicial: number): number {
  return inicial + (desejado - atualMostrado);
}


/** Só a confirmação atual e ainda desejada pode escolher a origem do rascunho. */
export function createdAccountSelection(result: {
  id: string;
  availability: string;
  account: { id: string; type?: string | null; archived?: boolean } | null;
}, allowedTypes: readonly string[], active = true): string | null {
  const account = result.account;
  if (!active || result.availability !== 'active' || !account || account.archived
    || account.id !== result.id || !allowedTypes.includes(account.type ?? '')) return null;
  return account.id;
}
