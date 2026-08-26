/**
 * Fonte única das categorias sugeridas do financeiro.
 *
 * Categoria é TEXTO LIVRE no banco (sem FK) — esta lista é só sugestão: alimenta
 * os chips do app e o prompt do Gemini, para que a IA e a UI falem a mesma língua.
 *
 * O prompt roda em Deno (`supabase/functions/_shared/gemini.ts`) e não consegue
 * importar de `src/`, então mantém uma cópia literal. `categories.test.ts` falha
 * se as duas listas divergirem.
 */
export const SUGGESTED_CATEGORIES = [
  'mercado', 'transporte', 'lazer', 'contas', 'saúde', 'casa',
  'educação', 'assinaturas', 'restaurante', 'salário', 'freela', 'outros',
] as const;

export type SuggestedCategory = (typeof SUGGESTED_CATEGORIES)[number];

/** Categorias que não fazem sentido como orçamento de gasto (são receita). */
export const INCOME_CATEGORIES: readonly SuggestedCategory[] = ['salário', 'freela'];
