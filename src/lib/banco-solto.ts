import { supabase } from '@/lib/supabase';

/**
 * O cliente SEM o schema gerado, para as RPCs e tabelas do pacote de consentimento/versão
 * (`accept_terms`, `set_ai_consent`, `app_ping`, `app_config`, colunas novas de `profiles`).
 * ponytail: trocar por `supabase` tipado quando `database.types.ts` for regenerado.
 */
type Resposta<T> = PromiseLike<{ data: T | null; error: { message: string; code?: string } | null }>;
interface Solto {
  rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Resposta<T>;
  from(tabela: string): {
    select(colunas: string): {
      eq(coluna: string, valor: unknown): { maybeSingle<T = Record<string, unknown>>(): Resposta<T> };
    };
  };
}

export const bancoSolto = supabase as unknown as Solto;
