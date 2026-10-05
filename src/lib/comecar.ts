/**
 * O passo EFETIVO do primeiro cadastro (`/finance/comecar`), calculado do dado REAL.
 *
 * O aparelho guarda só `{passo, contaIds, cartaoId}` (por usuário e espaço). Ao reabrir, o guardado
 * é conferido contra as contas que existem: id apagado sai, e nada é recriado — o passo nunca
 * promete um cadastro que o banco não tem.
 */
export type PassoDoComecar = 1 | 2 | 3 | 4;
export type Salvo = { passo: PassoDoComecar; contaIds: string[]; cartaoId?: string };
export type Efetivo = Salvo & { jaTinhaContas: boolean };

type ContaReal = { id: string; type: string };

export function lerSalvo(texto: string): Salvo | null {
  try {
    const v: unknown = JSON.parse(texto);
    if (!v || typeof v !== 'object') return null;
    const { passo, contaIds, cartaoId } = v as Record<string, unknown>;
    if (![1, 2, 3, 4].includes(passo as number) || !Array.isArray(contaIds)) return null;
    return {
      passo: passo as PassoDoComecar,
      contaIds: contaIds.filter((i): i is string => typeof i === 'string'),
      ...(typeof cartaoId === 'string' ? { cartaoId } : {}),
    };
  } catch {
    return null;
  }
}

export function passoEfetivo(salvo: Salvo | null, contas: readonly ContaReal[]): Efetivo {
  const existem = new Set(contas.map((c) => c.id));
  const contaIds = (salvo?.contaIds ?? []).filter((i) => existem.has(i));
  if (!contaIds.length) {
    // Nada do que foi guardado existe mais: com contas de antes, o caminho é o resumo delas.
    const dele = contas.filter((c) => c.type !== 'credit_card').map((c) => c.id);
    return dele.length
      ? { passo: 4, contaIds: dele, jaTinhaContas: true }
      : { passo: 1, contaIds: [], jaTinhaContas: false };
  }
  const cartaoId = salvo?.cartaoId && existem.has(salvo.cartaoId) ? salvo.cartaoId : undefined;
  // Com conta existente o passo 1 está feito, qualquer que seja o guardado.
  return {
    passo: Math.max(salvo?.passo ?? 2, 2) as PassoDoComecar,
    contaIds,
    ...(cartaoId ? { cartaoId } : {}),
    jaTinhaContas: false,
  };
}
