/**
 * "Onde muda" (spec 2026-09-29, §4): o que as hipóteses fazem em cada conta e cartão, antes →
 * depois. O "antes" é o horizonte real (`accounts_horizon`/`cards_horizon`); o "depois", as
 * leituras `contas`/`cartoes` do `simular` — a MESMA função privada nos dois lados.
 */
export type ContaNoHorizonte = {
  account_id: string | null;
  nome: string;
  tipo: string | null;
  saldo_hoje: number;
  menor: number;
  dia_do_menor: string;
  saldo_fim: number;
  negativa_em: string | null;
};
export type FaturaNoHorizonte = { invoice_id: string; vencimento: string; total: number; aberto: number };
export type CartaoNoHorizonte = { account_id: string; nome: string; limite: number | null; livre: number | null; faturas: FaturaNoHorizonte[] };

export type MudancaNaConta = {
  tipo: 'conta';
  account_id: string;
  nome: string;
  antes: ContaNoHorizonte | null;
  depois: ContaNoHorizonte;
  /** O primeiro dia negativo quando ele é NOVO (antes não ficava) ou MAIS CEDO; senão `null`. */
  ficaNegativaEm: string | null;
};
export type MudancaNoCartao = {
  tipo: 'cartao';
  account_id: string;
  nome: string;
  semLimite: boolean;
  livreAntes: number | null;
  livreDepois: number | null;
  /** Quanto passa do limite (positivo), ou `null`. Sem limite cadastrado nunca "passa". */
  passaDoLimiteEm: number | null;
  /** Só as faturas que mudam; fatura que ainda não existia conta do zero. */
  faturas: { vencimento: string; antes: number; depois: number }[];
};

export function ondeMuda(
  antes: { contas: ContaNoHorizonte[]; cartoes: CartaoNoHorizonte[] },
  depois: { contas: ContaNoHorizonte[]; cartoes: CartaoNoHorizonte[] },
): (MudancaNaConta | MudancaNoCartao)[] {
  const contas: MudancaNaConta[] = depois.contas
    // "Sem conta" só muda a visão geral (a linha da hipótese diz isso); conta do tipo cartão é
    // lida pelo lado do cartão.
    .filter((d): d is ContaNoHorizonte & { account_id: string } => d.account_id !== null && d.tipo !== 'credit_card')
    .flatMap((d) => {
      const a = antes.contas.find((x) => x.account_id === d.account_id) ?? null;
      const mudou = !a || a.saldo_fim !== d.saldo_fim || a.menor !== d.menor || a.negativa_em !== d.negativa_em;
      if (!mudou) return [];
      const ficaNegativaEm = d.negativa_em && (!a?.negativa_em || d.negativa_em < a.negativa_em) ? d.negativa_em : null;
      return [{ tipo: 'conta' as const, account_id: d.account_id, nome: d.nome, antes: a, depois: d, ficaNegativaEm }];
    });
  const cartoes: MudancaNoCartao[] = depois.cartoes.flatMap((d) => {
    const a = antes.cartoes.find((x) => x.account_id === d.account_id);
    const vencimentos = [...new Set([...(a?.faturas ?? []), ...d.faturas].map((f) => f.vencimento))].sort();
    const faturas = vencimentos
      .map((v) => ({
        vencimento: v,
        antes: a?.faturas.find((f) => f.vencimento === v)?.total ?? 0,
        depois: d.faturas.find((f) => f.vencimento === v)?.total ?? 0,
      }))
      .filter((f) => f.antes !== f.depois);
    const livreAntes = a?.livre ?? null;
    if (faturas.length === 0 && livreAntes === d.livre) return [];
    const semLimite = d.limite === null;
    return [{
      tipo: 'cartao' as const,
      account_id: d.account_id,
      nome: d.nome,
      semLimite,
      livreAntes,
      livreDepois: d.livre,
      passaDoLimiteEm: !semLimite && d.livre !== null && d.livre < 0 ? -d.livre : null,
      faturas,
    }];
  });
  return [...contas, ...cartoes];
}
