/**
 * O rascunho de lançamento que o agente monta a partir de uma fala (`POST /internal/finance/draft`,
 * F16): `params` já usa os nomes que `/finance/lancar` lê, e as `perguntas` viajam junto para a
 * `Note` do topo do formulário. Pura, para a folha, o formulário e o teste lerem a mesma coisa.
 */
import { hrefDoLancar, type TipoDeLancamento } from './lancar.ts';

export type FinanceDraft = {
  tipo: TipoDeLancamento;
  params: Record<string, string>;
  perguntas: string[];
  entendido: string;
};

/** O que cabe num parâmetro de rota, e nada que o formulário não leia como texto. */
const SEPARADOR = '\n';

export function hrefDoRascunho(d: FinanceDraft) {
  const perguntas = d.perguntas.map((p) => p.trim()).filter(Boolean);
  return hrefDoLancar(d.tipo, { ...d.params, ...(perguntas.length ? { perguntas: perguntas.join(SEPARADOR) } : {}) });
}

/** As perguntas que o formulário recebeu na rota (vazio quando não veio da voz). */
export function perguntasDoParam(v: string | undefined): string[] {
  return (v ?? '').split(SEPARADOR).map((p) => p.trim()).filter(Boolean);
}
