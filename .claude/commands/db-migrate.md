---
description: Cria e aplica uma migration nova seguindo os padrões do projeto
argument-hint: "<descrição da mudança de schema>"
---

Crie uma migration para: $ARGUMENTS

Siga `.claude/rules/supabase.md` à risca:

1. Nome: `supabase/migrations/<AAAAMMDDHHMMSS>_slug.sql`, com o carimbo depois do da última migration da pasta. Nunca editar migration existente.
2. Conteúdo obrigatório conforme o caso:
   - Tabela nova → `enable row level security` + `workspace_id` com a policy de workspace (copiar de `transactions`, ver `supabase.md` → RLS); tabela de infra → RLS sem policies. Índices para os padrões de consulta. FKs com `on delete` explícito.
   - Função `security definer` → `set search_path = public` + `revoke execute from public, anon, authenticated`.
   - Toda função nova em `public` → `revoke execute ... from public, anon` (o PUBLIC do padrão do Postgres reabre função nova; `supabase/tests/anon_sem_execute.sql` acusa).
   - Função que usa `current_date` → `set timezone to 'America/Sao_Paulo'` no cabeçalho, nunca por `alter` depois (`finance.md`).
   - Agregação → padrão duplo `_interna(uid)` + wrapper invoker.
   - Tabela que o app exibe → `alter publication supabase_realtime add table ...`.
   - Dinheiro → `amount_cents bigint` com check `> 0`.
3. Rodar o subagente `migration-reviewer` sobre o SQL antes de aplicar; corrigir o que ele apontar.
4. Aplicar conforme a seção *Migrations* de `supabase.md`: alvo confirmado, staging primeiro, produção só a pedido do Gabriel. Sem acesso ao projeto, deixar a migration commitada e avisar que falta aplicar.
5. Se o schema consumido pelo app mudou: `npx supabase gen types typescript` e atualizar os tipos usados nos hooks.
