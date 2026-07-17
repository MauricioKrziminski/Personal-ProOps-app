# Personal ProOps app

App mobile pessoal de **notas rápidas, lembretes e controle financeiro operado via WhatsApp**, parte do produto ProOps. Você manda uma mensagem em linguagem natural — texto ou áudio — e a IA cria e organiza tudo no app:

> "gastei 45 no mercado" · "recebi 500 de freela" · "me lembra de pagar aluguel todo dia 5" · "quanto gastei esse mês?"

## Como funciona

```
WhatsApp → Meta Cloud API → whatsapp-webhook (HMAC, dedupe, fila) → process-jobs
(Groq transcreve áudio → Gemini classifica em ações → grava notas/lembretes/transações
→ confirma no WhatsApp) → Supabase Realtime atualiza o app na hora.
send-reminders (pg_cron) dispara lembretes vencidos por push/WhatsApp.
```

- **App:** Expo SDK 57 + expo-router + TypeScript (`src/`), design liquid glass iOS, TanStack Query, dark mode automático.
- **Backend:** Supabase — Postgres (RLS deny-by-default), Auth Phone OTP, Edge Functions Deno (`supabase/functions/`), Realtime, pg_cron.
- **IA:** Google Gemini (Flash + fallback Pro, saída estruturada) · **Áudio:** Groq Whisper · **WhatsApp:** Meta Cloud API oficial.

## Rodando o app

```bash
npm install
cp .env.example .env   # preencher EXPO_PUBLIC_SUPABASE_URL e EXPO_PUBLIC_SUPABASE_ANON_KEY
npx expo start         # ou: npm run android / npm run ios
```

Login por telefone (OTP). Em dev (`__DEV__`) há um botão de login de teste.

## Backend (Supabase)

- Migrations: `supabase/migrations/` — aplicar com `npx supabase db push`.
- Edge Functions: `supabase/functions/` — testar com `npx supabase functions serve`, deployar com `npx supabase functions deploy <nome>`.
- Secrets das functions: documentados em `supabase/.env.example`, definidos com `npx supabase secrets set` (nunca commitados).

## Qualidade

```bash
npx tsc --noEmit   # typecheck
npx expo lint      # lint
```

## Convenções e regras

As regras do projeto (design system, padrões Supabase/RLS, IA, WhatsApp, domínio financeiro, workflow) estão em `CLAUDE.md` + `.claude/rules/` e valem para humanos e agentes.
