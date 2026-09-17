/**
 * Orçamentos "no limite" — a régua ÚNICA das duas raízes.
 *
 * Hoje e Financeiro filtravam cada um do seu jeito, e mostravam percentuais diferentes para a
 * mesma categoria. A regra é a de `finance.md`: **o aviso conta gasto + comprometido; o número
 * exibido é só o gasto** (o destaque amarelo do YNAB traduzido).
 */
export type OrcamentoLinha = {
  category: string;
  limit_cents: number | string;
  spent_cents: number | string;
  committed_cents?: number | string | null;
};

export type OrcamentoApertado = {
  categoria: string;
  limite: number;
  gasto: number;
  /** Só o gasto sobre o limite — é o número que a tela escreve. */
  fracaoGasta: number;
  /** Limite − gasto. Negativo quando já passou. */
  restante: number;
  /** Gasto + comprometido chegou no limite. */
  estourou: boolean;
};

export function orcamentosApertados(linhas: readonly OrcamentoLinha[], limiar = 0.8): OrcamentoApertado[] {
  return linhas.flatMap((l) => {
    const limite = Number(l.limit_cents);
    if (!(limite > 0)) return [];
    const gasto = Number(l.spent_cents);
    const comprometido = Number(l.committed_cents ?? 0);
    const aviso = (gasto + comprometido) / limite;
    if (aviso < limiar) return [];
    return [
      {
        categoria: l.category,
        limite,
        gasto,
        fracaoGasta: gasto / limite,
        restante: limite - gasto,
        estourou: aviso >= 1,
      },
    ];
  });
}
