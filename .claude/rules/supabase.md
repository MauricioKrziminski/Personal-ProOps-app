# Supabase — schema, RLS, functions

## Migrations

- **Toda** mudança de schema via migration numerada em `supabase/migrations/` (`NNNN_descricao.sql`). Nunca SQL direto no banco de produção; nunca editar migration já aplicada — criar a próxima.
- Aplicar com `npx supabase db push` (ou MCP `apply_migration`). Depois de mudar schema consumido pelo app, regenerar types: `npx supabase gen types typescript`.
- Migrations devem ser idempotentes onde possível (`create or replace function`, `if not exists`).

## RLS (inegociável)

- **Deny-by-default em toda tabela nova**: `alter table X enable row level security;` sem exceção.
- Tabelas do usuário: policy own-rows padrão (copiar de `notes` em `0001_init.sql`): `for all using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))`.
- Tabelas de infra (`jobs`, `messages_raw`, `ai_events`): RLS ligada **sem policies** — só service_role acessa.

## RPCs de agregação — padrão duplo

Cada agregação existe como par interna + wrapper:

1. **Interna** `_nome(uid uuid, ...)` — `security definer set search_path = public`, com `revoke execute ... from public, anon, authenticated`. Só as Edge Functions (service_role) chamam, passando o user_id resolvido.
2. **Wrapper** `nome(...)` — `security invoker` com a **query inline** filtrando `user_id = (select auth.uid())`, sob RLS. É o que o app usa via `supabase.rpc()`. ⚠️ O wrapper NÃO pode chamar a interna: EXECUTE é checado contra o role do chamador (authenticated), que foi revogado da interna — chamaria permission denied. A pequena duplicação da query é intencional.

Funções `security definer` sempre com `set search_path = public` e revoke explícito (padrão do `0002_security_hardening.sql`).

## Edge Functions (Deno, `supabase/functions/`)

- `service_role` **só** aqui, via `adminClient()` de `_shared/admin.ts`.
- `verify_jwt` por função em `config.toml`: webhooks externos (Meta) = `false` com validação própria (HMAC); funções internas de cron = `true`.
- Módulos compartilhados em `_shared/` (`admin.ts`, `whatsapp.ts`, `gemini.ts`) — não duplicar helpers entre functions.
- Testar localmente com `npx supabase functions serve` antes de `functions deploy`.

## Segredos

- Segredos (Gemini, Groq, WhatsApp, hooks) **só** em secrets das functions (`npx supabase secrets set`). Nunca no app, nunca commitados. Toda variável nova documentada em `supabase/.env.example` com comentário.
- ⚠️ Dívida conhecida: a migration `0003` tem o anon JWT hardcoded no `cron.schedule` (pg_net precisa do header). Ao mexer nos crons, migrar o token para o Supabase Vault (`vault.decrypted_secrets`) em vez de repetir o padrão.

## Realtime & fila

- Tabela nova que o app exibe → adicionar à publicação `supabase_realtime` na mesma migration.
- Fila: `jobs` + RPC `claim_jobs` (FOR UPDATE SKIP LOCKED, incrementa attempts, recupera órfãos). Idempotência de entrada por `messages_raw.wa_message_id` unique. Job marcado `done` **antes** da confirmação WhatsApp (envio é best-effort; falha de envio nunca reprocessa).
