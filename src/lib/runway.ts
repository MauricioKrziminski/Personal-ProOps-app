import { diasAte } from './dates.ts';

/**
 * A Pista do herói da Hoje: de hoje até a próxima entrada, com um entalhe em cada saída.
 *
 * ⚠️ **Ela lê a MESMA lista que produz o número grande.** O herói escreve
 * `caixa − comprometido_ate_entrada`, e `comprometido_ate_entrada` é a soma dos eventos que
 * `spendable_path` devolve. Se a soma dos eventos não bater com o comprometido (duas consultas
 * em idades diferentes do cache), a Pista não desenha entalhe nenhum: um "livre depois" que
 * contradiz o herói é pior que nenhum.
 */
export type EventoDaPista = { day: string; out_cents: number | string };
export type Entalhe = { day: string; posicao: number; saida: number; livreDepois: number };
export type Pista = {
  caixa: number;
  comprometido: number;
  livre: number;
  entalhes: Entalhe[];
  confere: boolean;
};

export function montarPista(
  caixa: number,
  comprometido: number,
  eventos: readonly EventoDaPista[],
  hoje: string,
  ate: string
): Pista {
  const janela = Math.max(0, diasAte(ate, hoje));
  const porDia = new Map<string, number>();
  for (const e of eventos) {
    const valor = Number(e.out_cents);
    if (valor > 0) porDia.set(e.day, (porDia.get(e.day) ?? 0) + valor);
  }
  let acumulado = 0;
  const entalhes = [...porDia.keys()].sort().map((day) => {
    const saida = porDia.get(day) ?? 0;
    acumulado += saida;
    const dia = diasAte(day, hoje);
    return {
      day,
      posicao: janela > 0 ? Math.min(1, Math.max(0, dia / janela)) : 0,
      saida,
      livreDepois: caixa - acumulado,
    };
  });
  const confere = porDia.size > 0 && acumulado === comprometido;
  return { caixa, comprometido, livre: caixa - comprometido, entalhes: confere ? entalhes : [], confere };
}

/** O entalhe mais perto de uma posição 0..1. Roda na UI thread durante o arraste. */
export function entalheMaisProximo(posicoes: readonly number[], p: number): number {
  'worklet';
  let melhor = -1;
  let distancia = Infinity;
  for (let i = 0; i < posicoes.length; i++) {
    const d = Math.abs(posicoes[i] - p);
    if (d < distancia) {
      distancia = d;
      melhor = i;
    }
  }
  return melhor;
}

/**
 * Um trecho da Pista: de `inicio` a `fim` (0..1, o eixo do tempo) o dinheiro livre é
 * `fracao` do caixa. `entalhe` é a saída que abriu o trecho (-1 no primeiro).
 */
export type Degrau = { inicio: number; fim: number; fracao: number; negativo: boolean; entalhe: number };

/**
 * A Pista como ESCADA DE QUEIMA: a altura é quanto sobra livre em cada trecho, e ela desce a
 * cada saída.
 *
 * O desenho anterior pintava "% comprometido" sobre um eixo de tempo e lia como progresso do
 * calendário (medido no simulador em 17/09/2026). Aqui os dois eixos dizem coisas próprias: o
 * horizontal é o tempo até a entrada, o vertical é o dinheiro.
 */
export function degrausDaPista(p: Pista): Degrau[] {
  const fracao = (livre: number) => (p.caixa > 0 ? Math.min(1, Math.max(0, livre / p.caixa)) : 0);
  if (p.entalhes.length === 0) {
    return [{ inicio: 0, fim: 1, fracao: fracao(p.livre), negativo: p.livre < 0, entalhe: -1 }];
  }
  const degraus: Degrau[] = [];
  let inicio = 0;
  let livre = p.caixa;
  let entalhe = -1;
  for (let i = 0; i <= p.entalhes.length; i++) {
    const fim = i < p.entalhes.length ? p.entalhes[i].posicao : 1;
    if (fim > inicio) degraus.push({ inicio, fim, fracao: fracao(livre), negativo: livre < 0, entalhe });
    if (i < p.entalhes.length) {
      inicio = fim;
      livre = p.entalhes[i].livreDepois;
      entalhe = i;
    }
  }
  return degraus;
}
