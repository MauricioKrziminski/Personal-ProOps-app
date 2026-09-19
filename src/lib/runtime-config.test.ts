import assert from 'node:assert/strict';
import test from 'node:test';

import { resolvePublicRuntimeConfig } from './runtime-config.ts';

test('configuração do app config vence o fallback injetado pelo Metro', () => {
  assert.deepEqual(
    resolvePublicRuntimeConfig(
      {
        supabaseUrl: ' https://kwriuifcwyvdrxtspjiz.supabase.co ',
        supabaseAnonKey: ' prod-key ',
      },
      {
        supabaseUrl: 'https://utkqoiigimqzeenxkxdl.supabase.co',
        supabaseAnonKey: 'staging-key',
      },
    ),
    {
      supabaseUrl: 'https://kwriuifcwyvdrxtspjiz.supabase.co',
      supabaseAnonKey: 'prod-key',
    },
  );
});

test('fallback continua funcionando quando o app config ainda não tem a chave', () => {
  assert.deepEqual(
    resolvePublicRuntimeConfig(undefined, {
      supabaseUrl: 'https://utkqoiigimqzeenxkxdl.supabase.co',
      supabaseAnonKey: 'staging-key',
    }),
    {
      supabaseUrl: 'https://utkqoiigimqzeenxkxdl.supabase.co',
      supabaseAnonKey: 'staging-key',
    },
  );
});
