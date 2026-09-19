import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { createClient } from '@supabase/supabase-js';

import type { Database } from '@/lib/database.types';
import { comTeto } from '@/lib/com-teto';
import { resolvePublicRuntimeConfig, type PublicRuntimeConfig } from '@/lib/runtime-config';
import { Platform } from 'react-native';

// Apenas anon key no app. Não existe service_role neste repositório desde 09/09/2026: quem
// precisa de privilégio é o agente, com papel próprio, e o que protege o cliente é a RLS.
const publicConfig = resolvePublicRuntimeConfig(
  (Constants.expoConfig?.extra as { proops?: PublicRuntimeConfig } | undefined)?.proops,
  {
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  },
);
export const supabaseUrl = publicConfig.supabaseUrl;
const supabaseAnonKey = publicConfig.supabaseAnonKey;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

/**
 * Teto de tempo de uma requisição ao Supabase.
 *
 * 15 s é folga de ~57× sobre a leitura mais cara já medida em produção (a projeção de 24 meses,
 * 146–256 ms). O número não é ainda menor por causa de UM caminho legitimamente lento: o
 * `signInWithOtp`, que fica esperando o GoTrue chamar o nosso `/hooks/otp` no Cloud Run, que roda
 * com `min_instances = 0`. Na prática o cron de lembretes de 1 minuto mantém o container quente,
 * mas errar para menos ali é recusar um login que ia dar certo.
 *
 * Com `retry: 1` no QueryClient, o pior caso até o card de erro é ~31 s. É muito, e é finito —
 * que é a diferença que importa em relação ao que havia antes.
 */
const TETO_MS = 15_000;

/**
 * ⚠️ **Sem isto a tela fica em esqueleto para sempre quando o aparelho está sem rede.**
 * O `fetch` do React Native não tem timeout nenhum (OkHttp com `connectTimeout(0)` e
 * `readTimeout(0)`), então a promessa não resolve e não rejeita — e uma query do TanStack que
 * nunca rejeita nunca vira erro. O raciocínio inteiro, e por que não é `AbortSignal`, está em
 * `com-teto.ts`.
 *
 * Vale para TODAS as pontas do cliente (PostgREST, Auth, Storage), que é o que consertar no
 * cliente e não em cada hook compra.
 */
const fetchComTeto: typeof fetch = (input, init) =>
  comTeto(
    fetch(input, init),
    TETO_MS,
    'Sem resposta do servidor. Verifique sua conexão e tente de novo.',
  );

// Tipado pelo schema gerado (`npx supabase gen types typescript`): qualquer drift
// entre migration e app vira erro de tsc, não bug em runtime.
export const supabase = createClient<Database>(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder',
  {
    global: { fetch: fetchComTeto },
    auth: {
      // No web/render estático não há AsyncStorage — o supabase-js usa o storage padrão.
      ...(Platform.OS !== 'web' ? { storage: AsyncStorage } : {}),
      autoRefreshToken: true,
      persistSession: Platform.OS !== 'web' || typeof window !== 'undefined',
      detectSessionInUrl: false,
    },
  },
);
