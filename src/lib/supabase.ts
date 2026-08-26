import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

import type { Database } from '@/lib/database.types';
import { Platform } from 'react-native';

// Apenas anon key no app — service_role vive só nas Edge Functions.
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

// Tipado pelo schema gerado (`npx supabase gen types typescript`): qualquer drift
// entre migration e app vira erro de tsc, não bug em runtime.
export const supabase = createClient<Database>(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder',
  {
    auth: {
      // No web/render estático não há AsyncStorage — o supabase-js usa o storage padrão.
      ...(Platform.OS !== 'web' ? { storage: AsyncStorage } : {}),
      autoRefreshToken: true,
      persistSession: Platform.OS !== 'web' || typeof window !== 'undefined',
      detectSessionInUrl: false,
    },
  },
);
