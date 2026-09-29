/**
 * As hipóteses do "E se…?" dentro do detalhe do ciclo (28/09/2026: *"se eu tiver feito algumas
 * hipóteses e clicar para ver o detalhe de um ciclo ou mês, ele tem que mostrar com aqueles
 * valores da projeção de hipótese (sem salvar)… como se fosse real"*).
 *
 * A conta de CADA ocorrência é do banco (`draft_lines`, sobre o mesmo motor da Projeção); aqui só
 * se dá nome às linhas e se soma o que já veio para o fechamento do ciclo.
 */

/** O que a Projeção manda ao ciclo: o draft do motor + o nome da hipótese. Nada é salvo. */
export interface HipoteseNoCiclo {
  kind: 'income' | 'expense';
  amount_cents: number;
  start: string;
  installments: number;
  mode?: 'total' | 'monthly' | 'cancel';
  /** O nome da hipótese composta (adiantar), repetido em todos os drafts do grupo. */
  rotulo?: string;
}

export interface OcorrenciaDaHipotese {
  i: number;
  day: string;
  kind: string;
  cents: number;
}

/** A linha que a tela do ciclo desenha — o mesmo formato de `cycle_lines`. */
export interface LinhaDeHipotese {
  day: string;
  title: string;
  in_cents: number;
  out_cents: number;
  origin: 'hipotese';
  ref_id: string;
  method_label: string;
  atrasada: boolean;
  realizado: boolean;
}

export function linhasDasHipoteses(
  ocorrencias: readonly OcorrenciaDaHipotese[],
  hipoteses: readonly HipoteseNoCiclo[],
): LinhaDeHipotese[] {
  return ocorrencias.map((o, n) => {
    const h = hipoteses[o.i];
    const cancela = o.cents < 0;
    // `rotulo` já é a frase da hipótese ("adianta 3 parcelas de Mac"): o pagamento a usa como
    // título, e cada parcela que deixa de sair a leva no subtítulo.
    const titulo = cancela
      ? 'Parcela adiantada'
      : h?.rotulo
        ? h.rotulo.charAt(0).toUpperCase() + h.rotulo.slice(1)
        : o.kind === 'income'
          ? 'Entrada da hipótese'
          : 'Gasto da hipótese';
    return {
      day: o.day,
      title: titulo,
      // A parcela adiantada que deixa de sair lê como dinheiro que FICA — verde, não vermelho.
      in_cents: o.kind === 'income' || cancela ? Math.abs(o.cents) : 0,
      out_cents: o.kind === 'income' || cancela ? 0 : o.cents,
      origin: 'hipotese',
      ref_id: `hipotese-${o.i}-${n}`,
      method_label: cancela && h?.rotulo ? `hipótese · ${h.rotulo}` : 'hipótese',
      atrasada: false,
      realizado: false,
    };
  });
}

type Fechamento = {
  comecei_com: number;
  entrou: number;
  saiu: number;
  resultado: number;
  caixa_no_fim: number | null;
};

/**
 * O fechamento do ciclo COM as hipóteses: o efeito de antes do ciclo muda o "Comecei com" e o que
 * cai dentro dele muda entrou/saiu — e os dois chegam ao "Sobrou". A parcela adiantada (`cancel`,
 * valor negativo) diminui o que sai, como no motor.
 */
export function fechamentoComHipoteses<T extends Fechamento>(
  ciclo: T,
  antes: number,
  ocorrencias: readonly OcorrenciaDaHipotese[],
): T {
  const entra = ocorrencias.filter((o) => o.kind === 'income').reduce((s, o) => s + o.cents, 0);
  const sai = ocorrencias.filter((o) => o.kind !== 'income').reduce((s, o) => s + o.cents, 0);
  const liquido = antes + entra - sai;
  return {
    ...ciclo,
    comecei_com: Number(ciclo.comecei_com) + antes,
    entrou: Number(ciclo.entrou) + entra,
    saiu: Number(ciclo.saiu) + sai,
    resultado: Number(ciclo.resultado) + liquido,
    caixa_no_fim: ciclo.caixa_no_fim == null ? null : Number(ciclo.caixa_no_fim) + liquido,
  };
}
