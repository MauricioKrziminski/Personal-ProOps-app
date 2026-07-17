# Frontend — Expo Router + TanStack Query

Expo SDK 57 (managed), código em `src/`, paths `@/*` → `src/*` e `@/assets/*` → `assets/*`. **Antes de usar qualquer API do Expo, ler a doc versionada: https://docs.expo.dev/versions/v57.0.0/** (o Expo mudou muito; não confiar em memória).

## Rotas

- Telas em `src/app/`. Abas dentro do grupo `(tabs)/` (tab bar = `AppTabs`/NativeTabs); telas de detalhe e forms fora do grupo, registradas no `<Stack>` do `_layout.tsx` raiz. Forms de criação/edição = `presentation: 'modal'`.
- `typedRoutes` está ligado: navegar com `router.push('/rota')` tipado, nunca strings mágicas erradas.
- Auth gate fica no `_layout.tsx` raiz (`useSession` → LoginScreen vs app). Não duplicar checagem de sessão em telas.

## Dados (TanStack Query)

- Todo acesso a dados via hooks em `src/hooks/` seguindo o padrão de `src/hooks/use-items.ts`:
  - `queryKey` por recurso (ex.: `['transactions', filtros]`), `useQuery` com select tipado no supabase-js.
  - **Realtime**: usar `useRealtimeInvalidate(tabela, queryKey)` (já existe em `use-items.ts`) para invalidar quando itens chegam via WhatsApp.
  - Mutações com `useMutation` + `invalidateQueries` no `onSuccess`. Inserts/updates diretos via supabase-js — RLS own-rows protege; não criar Edge Function para CRUD simples.
- Cliente Supabase único: `src/lib/supabase.ts` (anon key via `EXPO_PUBLIC_SUPABASE_*`). Nunca instanciar outro client, nunca usar service_role no app.

## Forms

- Sempre **react-hook-form + zod** (`zodResolver`). Schema zod colocalizado com o form.
- **Dinheiro**: sempre `amount_cents` inteiro. Input monetário via `src/components/finance/money-input.tsx` (digita em centavos); exibição via `formatBRL` de `use-items.ts`. **Nunca float, nunca `parseFloat` em dinheiro.**
- Datas exibidas com `formatDateBR`; armazenadas ISO.

## Estado local

- Preferir estado de servidor (Query) + `useState`. Zustand só se estado global de UI real aparecer (hoje não há nenhum) — não criar store "por via das dúvidas".

## Qualidade

- `npx tsc --noEmit` e `npx expo lint` limpos antes de commitar.
- Componentes reutilizáveis em `src/components/` (subpasta por domínio, ex.: `finance/`); componente usado por uma tela só pode viver inline na tela.
