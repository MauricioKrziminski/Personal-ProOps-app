# Supabase — schema, RLS, functions

> **O Supabase é BANCO e FILA, não onde a lógica roda** (desde 30/08/2026). Quem processa é o
> serviço Python em `agent/` — ver `.claude/rules/agent.md`. As Edge Functions em
> `supabase/functions/` são legado em desmonte; a seção sobre elas, mais abaixo, vale só enquanto
> o corte Strangler não terminar.

## Migrations

- **Toda** mudança de schema via migration numerada em `supabase/migrations/` (`NNNN_descricao.sql`). Nunca SQL direto no banco de produção; nunca editar migration já aplicada — criar a próxima.
- **Antes de qualquer `db push`, confirme o alvo: `scripts/supabase-target.sh`.** Ele imprime o
  ref linkado e o ref do `.env.local` e sai 1 se discordarem. São dois projetos de nome parecido
  (`kwriuifcwyvdrxtspjiz` = produção, `utkqoiigimqzeenxkxdl` = staging) e a confusão já custou
  duas migrations anunciadas no lugar errado. O mesmo script roda como hook `PreToolUse` e
  bloqueia escrita em produção sem `PROOPS_PROD_OK=1`.
- Aplicar com `npx supabase db push` (ou MCP `apply_migration`). Depois de mudar schema consumido pelo app, regenerar types: `npx supabase gen types typescript`.
- **Staging vai na frente; produção só por pedido explícito.** Uma migration nova nasce aplicada
  no staging. Promover para produção é uma decisão do Gabriel, com o número da migration dito em
  voz alta — não um passo silencioso no fim de uma tarefa.
- Migrations devem ser idempotentes onde possível (`create or replace function`, `if not exists`).

## RLS (inegociável)

- **Deny-by-default em toda tabela nova**: `alter table X enable row level security;` sem exceção.
- **O escopo do dado é o WORKSPACE, não o usuário** (migration `0010_workspaces.sql`): toda tabela de dado tem `workspace_id not null` com `default public.my_default_workspace()` e a policy padrão é
  `for all using (workspace_id in (select private.my_workspace_ids())) with check (...)` — copiar de `transactions`.
  `user_id` continua na tabela como **autor** do lançamento, nunca como filtro de visibilidade.
- `private.my_workspace_ids()` é `security definer` (senão a policy de `workspace_members` recursaria) e mora no schema `private` **de propósito**: o PostgREST não expõe esse schema, então não vira endpoint `/rest/v1/rpc/`. Não mover para `public`.
- Tabelas de infra (`messages_queue`, `user_sessions`, `pending_actions`, `executed_actions`,
  `agent_routing`, `ai_events`, e as legadas `jobs`/`messages_raw`): RLS ligada **sem policies**.
- **O schema `langgraph` fica FORA do `public`** e sem grant para `anon`/`authenticated`: as
  tabelas de checkpoint guardam o conteúdo das conversas (valores, contas, notas), e em `public`
  elas seriam legíveis pelo PostgREST com a anon key. Mesmo motivo do schema `private`.
- ⚠️ **O serviço Python conecta com papel que IGNORA RLS.** A RLS continua protegendo o APP;
  para o agente, escopo de workspace virou código (`ensure_owned`, filtro obrigatório). Ver
  `agent.md`.

## Unique parcial não funciona com upsert do PostgREST

Se um `unique` for **parcial** (`where ... is null`), o `.upsert()` do supabase-js **sempre falha** com
`42P10`: o Postgres só casa índice parcial se o `ON CONFLICT` repetir o mesmo predicado, e o
PostgREST não tem como mandar isso pela query string. Aconteceu com `budgets` (dois parciais, porque
NULL não colide com NULL) e travou a tela inteira com um "Não deu para salvar" genérico.

**Regra:** unique parcial → o salvamento vira **RPC** (ver `save_budget` na `0031`), onde o predicado
pode existir. Unique completo pode usar `.upsert()` normalmente.

Para auditar: `select indexname, indexdef from pg_indexes where schemaname='public' and indexdef like 'CREATE UNIQUE%' and indexdef like '%WHERE%';`

## RPCs de agregação — padrão duplo

Cada agregação existe como par interna + wrapper:

1. **Interna** `_nome(uid uuid, ...)` — recebe o user_id resolvido do telefone e expande para os workspaces dele com `public._workspace_ids(uid)` — `security definer set search_path = public`, com `revoke execute ... from public, anon, authenticated`. É a que o **serviço Python** chama, passando o user_id resolvido. O wrapper `security invoker` depende de `auth.uid()`, que é null lá — chamá-lo do agente devolveria vazio, em silêncio.
2. **Wrapper** `nome(...)` — `security invoker` com a **query inline** filtrando `workspace_id in (select private.my_workspace_ids())`, sob RLS. É o que o app usa via `supabase.rpc()`. ⚠️ O wrapper NÃO pode chamar a interna: EXECUTE é checado contra o role do chamador (authenticated), que foi revogado da interna — chamaria permission denied. A pequena duplicação da query é intencional.

Funções `security definer` sempre com `set search_path = public` e revoke explícito (padrão do `0002_security_hardening.sql`).

## Edge Functions (Deno, `supabase/functions/`) — LEGADO

Em desmonte. Só o `whatsapp-webhook` tem função ativa nova: ele é o **roteador do corte
Strangler** (lê `agent_routing.use_python_agent` e repassa para o Cloud Run). Não adicionar
função nem lógica aqui — o lugar é `agent/`.

- `service_role` **só** aqui, via `adminClient()` de `_shared/admin.ts`.
- `verify_jwt` por função em `config.toml`: webhooks externos (Meta) = `false` com validação própria (HMAC); funções internas de cron = `true`.
- Módulos compartilhados em `_shared/` (`admin.ts`, `whatsapp.ts`, `gemini.ts`, `datetime.ts`, `recurrence.ts`) — não duplicar helpers entre functions.
- **Datas**: o runtime roda em UTC. "Hoje" para o usuário sai de `localISODate(date, timezone)` e RRULE de `nextOccurrence(...)` (`_shared/`), nunca de `toISOString().slice(0,10)`. Datetime vindo do Gemini passa por `toInstantISO` antes de virar `timestamptz`.
- Testar localmente com `npx supabase functions serve` antes de `functions deploy`.

## Segredos

- Segredos (Gemini, Groq, WhatsApp, hooks, DATABASE_URL, THREAD_SALT) no **GCP Secret Manager**,
  injetados por `gcloud run deploy --set-secrets`. Nunca no app, nunca commitados. Toda variável
  nova documentada em `agent/.env.example` com comentário. (`supabase/.env.example` cobre só o que
  as Edge Functions legadas ainda usam.)
- **Os crons saíram do pg_cron para o Cloud Scheduler** (`/cron/reminders` a cada minuto, levando
  junto o sweep da fila; `/cron/finance-scheduler` de hora em hora; `/cron/alerts` diário). O
  Scheduler autentica com OIDC: não há mais token para vazar.
- A chave anon literal da `0003` continua no histórico do git — **rotacionar**. Nunca voltar a
  escrever token em migration.

## Realtime & fila

- Tabela nova que o app exibe → adicionar à publicação `supabase_realtime` na mesma migration.
- Fila: **`messages_queue` + RPC `claim_thread_batch`**. Ela reivindica o LOTE inteiro da conversa
  (o debounce), recusa thread com `processing` recente (um worker por conversa) e não mistura
  retentativa com mensagem nova (a chave de idempotência mudaria). `jobs`/`claim_jobs` são legado.
- Idempotência de entrada por `messages_queue.wa_message_id` unique; de execução por
  `executed_actions`, reservada ANTES de executar.
- Mensagem marcada `done` **antes** da confirmação no WhatsApp — envio é best-effort e falha de
  envio nunca pode reprocessar (reprocessar duplicaria escrita).
