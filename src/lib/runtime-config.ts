export type PublicRuntimeConfig = {
  supabaseUrl?: unknown;
  supabaseAnonKey?: unknown;
};

/**
 * A configuração que vem do app config tem precedência sobre `process.env`.
 *
 * O Expo SDK 57 transforma `process.env.EXPO_PUBLIC_*` em `expo/virtual/env`. Esse módulo também
 * pode carregar `.env.local`, inclusive quando o Metro foi iniciado com `EXPO_NO_DOTENV=1`. A
 * configuração do `app.config.js` é calculada para a variante nativa e é a fonte estável para o
 * cliente Supabase.
 */
export function resolvePublicRuntimeConfig(
  extra: PublicRuntimeConfig | null | undefined,
  fallback: { supabaseUrl?: string; supabaseAnonKey?: string },
): { supabaseUrl: string; supabaseAnonKey: string } {
  const supabaseUrl = typeof extra?.supabaseUrl === 'string' ? extra.supabaseUrl.trim() : '';
  const supabaseAnonKey = typeof extra?.supabaseAnonKey === 'string' ? extra.supabaseAnonKey.trim() : '';

  return {
    supabaseUrl: supabaseUrl || fallback.supabaseUrl?.trim() || '',
    supabaseAnonKey: supabaseAnonKey || fallback.supabaseAnonKey?.trim() || '',
  };
}
