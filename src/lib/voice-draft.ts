/**
 * O rascunho de lançamento que o agente monta a partir de uma fala (`POST /internal/finance/draft`,
 * F16): `params` já usa os nomes que `/finance/lancar` lê, e as `perguntas` viajam junto para a
 * `Note` do topo do formulário. Pura, para a folha, o formulário e o teste lerem a mesma coisa.
 */
import { hrefDoLancar, type TipoDeLancamento } from './lancar.ts';

/** Print de PRODUTO (anúncio): o servidor lê, o app pergunta "cabe no bolso?" em vez de lançar. */
export type ProdutoDoPrint = {
  o_que: string;
  preco_cents: number | null;
  parcelas: number | null;
  valor_parcela_cents: number | null;
  /** A frase do chat (`*negrito*` do WhatsApp), pronta para `ComNegrito`. */
  frase: string;
};

export type FinanceDraft = {
  tipo: TipoDeLancamento;
  params: Record<string, string>;
  perguntas: string[];
  entendido: string;
  /** Só quando a imagem é um produto; o APK antigo ignora e abre o gasto do rascunho. */
  produto?: ProdutoDoPrint;
};

/** A pergunta que o chat recebe junto da imagem: "em Nx" quando o anúncio mostra parcelas. */
export function legendaDoProduto(p: Pick<ProdutoDoPrint, 'parcelas'>) {
  return p.parcelas && p.parcelas >= 2 ? `Posso comprar isso em ${p.parcelas}x?` : 'Posso comprar isso?';
}

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
