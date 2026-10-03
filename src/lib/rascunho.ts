/**
 * O rascunho do "E se…?" (spec 2026-09-29): as hipóteses (viram registro na simulação) e os
 * adiantamentos (continuam `Draft` de cancelamento). Mora no aparelho — ler aceita qualquer coisa
 * e devolve vazio no que não reconhece, para um dado velho nunca quebrar a tela.
 */
import { detalheDaEscrita } from './escrita.ts';
import type { Draft } from '@/hooks/use-finance';
import { financeErrorMessage } from './finance-form.ts';
import type { Hipotese } from './hipotese.ts';

export type Rascunho = { versao: 2; hipoteses: Hipotese[]; adiantamentos: Draft[] };
export const RASCUNHO_VAZIO: Rascunho = { versao: 2, hipoteses: [], adiantamentos: [] };

const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
function detailValid(value: Record<string, unknown>): boolean {
  try { detalheDaEscrita(value as { subcategory_id?: string | null }); return true; } catch { return false; }
}
const FORMAS = new Set(['uma', 'parcelado', 'repete', 'financiamento']);

function hipoteseValida(h: unknown): h is Hipotese {
  return ehObjeto(h) && detailValid(h) && (!Object.hasOwn(h, 'category') || h.category === null || typeof h.category === 'string') && typeof h.id === 'string' && (h.kind === 'income' || h.kind === 'expense')
    && FORMAS.has(h.forma as string) && typeof h.valor_cents === 'number' && typeof h.parcelas === 'number'
    && typeof h.data === 'string';
}

function draftValido(d: unknown): d is Draft {
  return ehObjeto(d) && (d.kind === 'income' || d.kind === 'expense') && typeof d.amount_cents === 'number' && typeof d.start === 'string';
}

/**
 * A rápida da versão 1 (valor + mês, sem conta) como hipótese. Parcelada sem conta fica
 * INCOMPLETA — a linha pede a conta, e ela sai da simulação até ser editada.
 */
function daVersao1(d: Draft): Hipotese {
  const forma = d.mode === 'monthly' ? 'repete' : d.installments > 1 ? 'parcelado' : 'uma';
  return {
    id: d.grupo ?? `v1-${d.start}-${d.amount_cents}`,
    kind: d.kind,
    forma,
    valor_cents: d.amount_cents,
    parcelas: forma === 'parcelado' ? d.installments : 1,
    repete: 'monthly',
    conta: null,
    data: d.start,
  };
}

export function lerRascunho(texto: string): Rascunho {
  if (!texto) return RASCUNHO_VAZIO;
  try {
    const r = JSON.parse(texto) as Record<string, unknown> | null;
    if (r?.versao === 2 && Array.isArray(r.hipoteses) && Array.isArray(r.adiantamentos)) {
      return { versao: 2, hipoteses: r.hipoteses.filter(hipoteseValida), adiantamentos: r.adiantamentos.filter(draftValido) };
    }
    if (r?.versao === 1 && Array.isArray(r.rapidas)) {
      const rapidas = r.rapidas.filter(draftValido);
      // Adiantamento = o grupo que tem a linha com `rotulo` (1 pagamento + N cancelamentos).
      const gruposDeAdiantar = new Set(rapidas.filter((d) => d.rotulo && d.grupo).map((d) => d.grupo));
      const ehAdiantar = (d: Draft) => d.mode === 'cancel' || (d.grupo !== undefined && gruposDeAdiantar.has(d.grupo));
      // As detalhadas da v1 ficam para trás: o caminho que as criava saiu.
      return { versao: 2, hipoteses: rapidas.filter((d) => !ehAdiantar(d)).map(daVersao1), adiantamentos: rapidas.filter(ehAdiantar) };
    }
    return RASCUNHO_VAZIO;
  } catch {
    return RASCUNHO_VAZIO;
  }
}

export function gravarRascunho(r: Rascunho): string {
  return r.hipoteses.length === 0 && r.adiantamentos.length === 0 ? '' : JSON.stringify(r);
}

/**
 * O motivo que a pessoa lê quando `simular` recusa uma hipótese: a frase NOSSA (`raise exception`,
 * P0001) passa; o resto (restrição, tipo, permissão) vira uma frase só — o texto cru do Postgres
 * não diz nada a quem usa o app (29/09/2026). A mesma régua de `financeErrorMessage`.
 */
export function motivoDaHipotese(e: { mensagem: string; codigo?: string }): string {
  return financeErrorMessage({ code: e.codigo, message: e.mensagem }, 'o banco recusou esta hipótese. Abra e confira os campos.');
}
