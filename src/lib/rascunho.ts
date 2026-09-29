/**
 * O rascunho do "E se…?" (spec 2026-09-28, seção 4): rápidas (o `Draft` de sempre, e os grupos
 * de adiantar) e detalhadas (a ENTRADA do hook que as salvaria). Mora no aparelho — ler aceita
 * qualquer coisa e devolve vazio no que não reconhece, para um dado velho nunca quebrar a tela.
 */
import type { Draft } from '@/hooks/use-finance';
import { financeErrorMessage } from './finance-form.ts';
import {
  argsDaParcelada,
  linhaDaRecorrente,
  linhaDoFinanciamento,
  linhasDoLancamento,
  type EntradaFinanciamento,
  type EntradaLancamento,
  type EntradaParcelada,
  type EntradaRecorrente,
} from './escrita.ts';

export type TipoDetalhado = 'lancamento' | 'parcelada' | 'recorrente' | 'financiamento';
export type HipoteseDetalhada =
  | { id: string; tipo: 'lancamento'; entrada: EntradaLancamento; titulo: string }
  | { id: string; tipo: 'parcelada'; entrada: EntradaParcelada; titulo: string }
  | { id: string; tipo: 'recorrente'; entrada: EntradaRecorrente; titulo: string }
  | { id: string; tipo: 'financiamento'; entrada: EntradaFinanciamento; titulo: string };
export type Rascunho = { versao: 1; rapidas: Draft[]; detalhadas: HipoteseDetalhada[] };

export const RASCUNHO_VAZIO: Rascunho = { versao: 1, rapidas: [], detalhadas: [] };

const TIPOS = new Set(['lancamento', 'parcelada', 'recorrente', 'financiamento']);
const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Só o item que dá para simular e aplicar: o aparelho guarda o que uma versão antiga do app gravou,
 * e um item estragado derrubava a Projeção inteira (29/09/2026). O que sai, sai calado — é a mesma
 * régua do envelope inválido.
 */
export function detalhadasValidas(lista: unknown[]): HipoteseDetalhada[] {
  return lista.filter(
    (h): h is HipoteseDetalhada =>
      ehObjeto(h) && typeof h.id === 'string' && typeof h.tipo === 'string' && TIPOS.has(h.tipo) && ehObjeto(h.entrada),
  );
}

function rapidaValida(d: unknown): d is Draft {
  return ehObjeto(d) && (d.kind === 'income' || d.kind === 'expense') && typeof d.amount_cents === 'number' && typeof d.start === 'string';
}

export function lerRascunho(texto: string): Rascunho {
  if (!texto) return RASCUNHO_VAZIO;
  try {
    const r = JSON.parse(texto) as Partial<Rascunho>;
    if (r?.versao !== 1 || !Array.isArray(r.rapidas) || !Array.isArray(r.detalhadas)) return RASCUNHO_VAZIO;
    return { versao: 1, rapidas: r.rapidas.filter(rapidaValida), detalhadas: detalhadasValidas(r.detalhadas) };
  } catch {
    return RASCUNHO_VAZIO;
  }
}

export function gravarRascunho(r: Rascunho): string {
  return r.rapidas.length === 0 && r.detalhadas.length === 0 ? '' : JSON.stringify(r);
}

export function registrosParaSimular(detalhadas: HipoteseDetalhada[]) {
  return detalhadas.map((h) => {
    switch (h.tipo) {
      case 'lancamento':
        return { tipo: h.tipo, dados: { linhas: linhasDoLancamento(h.entrada) } };
      case 'parcelada': {
        const { rpc, args } = argsDaParcelada(h.entrada);
        return { tipo: h.tipo, dados: { ...args, ultimo_dia: rpc === 'create_installment_plan_last_day' } };
      }
      case 'recorrente':
        return { tipo: h.tipo, dados: linhaDaRecorrente(h.entrada) };
      case 'financiamento':
        return { tipo: h.tipo, dados: linhaDoFinanciamento(h.entrada) };
    }
  });
}

/** De quanto em quanto tempo a regra repete, em palavras — só o que o `montaRRule` do app monta. */
function frequencia(rrule: string): string {
  const cada = Number(/INTERVAL=(\d+)/.exec(rrule)?.[1] ?? 1);
  const [um, varios] = rrule.includes('FREQ=WEEKLY') ? ['toda semana', 'semanas'] : rrule.includes('FREQ=YEARLY') ? ['todo ano', 'anos'] : ['todo mês', 'meses'];
  return cada > 1 ? `a cada ${cada} ${varios}` : um;
}

/**
 * O motivo que a pessoa lê quando `simular` recusa uma hipótese: a frase NOSSA (`raise exception`,
 * P0001) passa; o resto (restrição, tipo, permissão) vira uma frase só — o texto cru do Postgres
 * não diz nada a quem usa o app (29/09/2026). A mesma régua de `financeErrorMessage`.
 */
export function motivoDaHipotese(e: { mensagem: string; codigo?: string }): string {
  return financeErrorMessage({ code: e.codigo, message: e.mensagem }, 'o banco recusou esta hipótese. Abra e confira os campos.');
}

export function resumoDaHipotese(h: HipoteseDetalhada, brl: (c: number) => string): string {
  switch (h.tipo) {
    case 'lancamento':
      return `${h.titulo} · ${h.entrada.kind === 'income' ? 'entrada' : h.entrada.kind === 'transfer' ? 'transferência' : 'gasto'} · ${brl(h.entrada.amount_cents)}`;
    case 'parcelada':
      return `${h.titulo} · compra ${h.entrada.installments}× · ${brl(h.entrada.totalCents)}`;
    case 'recorrente':
      return `${h.titulo} · ${frequencia(h.entrada.rrule)} · ${brl(h.entrada.amount_cents)}`;
    case 'financiamento':
      return `${h.titulo} · financiamento · ${brl(h.entrada.remaining_cents)}`;
  }
}

/**
 * O que o formulário de lançamento vira em modo hipótese: a compra parcelada quando ele criaria
 * um plano (`destinoDoSalvar` = 'criarPlano'), o lançamento no resto. A entrada é a MESMA que ele
 * mandaria ao hook — é o que torna o "Aplicar" igual ao salvar.
 */
export function hipoteseDoLancamento(
  destino: string,
  lancamento: EntradaLancamento,
  parcelada: EntradaParcelada | null,
): Omit<HipoteseDetalhada, 'id'> {
  if (destino === 'criarPlano' && parcelada) {
    return { tipo: 'parcelada', entrada: parcelada, titulo: parcelada.description?.trim() || 'Compra parcelada' };
  }
  return { tipo: 'lancamento', entrada: lancamento, titulo: lancamento.description?.trim() || 'Lançamento' };
}
