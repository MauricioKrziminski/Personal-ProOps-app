---
description: Cria e aplica uma migration nova seguindo os padrões do projeto
argument-hint: "<descrição da mudança de schema>"
---

Crie uma migration para: $ARGUMENTS

Siga `.claude/rules/supabase.md` à risca:

1. Nome: próximo número sequencial em `supabase/migrations/` (`NNNN_slug.sql`). Nunca editar migration existente.
2. Conteúdo obrigatório conforme o caso:
   - Tabela nova → `enable row level security` + policy own-rows (padrão de `notes` em `0001_init.sql`); tabela de infra → RLS sem policies. Índices para os padrões de consulta. FKs com `on delete` explícito.
   - Função `security definer` → `set search_path = public` + `revoke execute from public, anon, authenticated`.
   - Agregação → padrão duplo `_interna(uid)` + wrapper invoker.
   - Tabela que o app exibe → `alter publication supabase_realtime add table ...`.
   - Dinheiro → `amount_cents bigint` com check `> 0`.
3. Rodar o subagente `migration-reviewer` sobre o SQL antes de aplicar; corrigir o que ele apontar.
4. Aplicar com `npx supabase db push` (ou MCP `apply_migration` se o CLI não estiver linkado). Se não houver acesso ao projeto remoto, deixar a migration commitada e avisar que falta o push.
5. Se o schema consumido pelo app mudou: `npx supabase gen types typescript` e atualizar os tipos usados nos hooks.
