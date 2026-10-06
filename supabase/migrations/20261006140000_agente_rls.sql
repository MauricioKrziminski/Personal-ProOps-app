-- RLS como segunda camada do agente (`AGENTE_RLS`): as TOOLS passam a rodar sob `authenticated`
-- com `auth.uid()` = dono da conversa (`db.sob_rls`), como o PostgREST faz com o app.
--
-- O que faltava para as tools funcionarem sob RLS:
--   1. `private.attach_import_rule_purchase` (usada pelo parcelamento com detalhe): SECURITY INVOKER,
--      só toca tabelas com RLS e funções que `authenticated` já executa. Conceder é seguro: a RLS
--      de `installment_plans`/`transactions` continua valendo.
--   2. `private.match_rule_subcategory` chama `public._match_rule` (SECURITY DEFINER, aceita QUALQUER
--      workspace, sem `execute` para `authenticated` DE PROPÓSITO). Conceder a ela vazaria regras
--      de outro workspace; o wrapper abaixo confere a posse (`private.my_workspace_ids()`, que lê
--      `auth.uid()`) e só então delega — o padrão interna/wrapper de `supabase.md`.
--
-- Fica DE FORA, de propósito (o agente lê como `postgres`, na fase cognitiva, fora do trecho RLS;
-- conferido por grep: nenhuma tool do `registry` alcança `resolve._por_semantica`, só o `prepare`):
-- `private.transacoes_semelhantes` / `transaction_embeddings` (tabela interna, RLS sem policy).
-- As RPCs por usuário `public._account_balances(uid)`, `_budgets_status`, `_card_summary`,
-- `_cash_flow_forecast`, `_forecast_with_drafts` NÃO ganham `execute`: aceitam qualquer `uid`.
-- Sob RLS o Python chama os wrappers (`db.por_usuario`), que já existem para o app.

create or replace function private.match_rule_subcategory_do_membro(p_workspace uuid, p_text text)
returns table(category text, account_id uuid, rule_id uuid, subcategory_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select m.category, m.account_id, m.rule_id, m.subcategory_id
  from private.match_rule_subcategory(p_workspace, p_text) m
  where p_workspace in (select private.my_workspace_ids());
$$;

revoke execute on function private.match_rule_subcategory_do_membro(uuid, text) from public, anon;
grant execute on function private.match_rule_subcategory_do_membro(uuid, text) to authenticated;

revoke execute on function private.attach_import_rule_purchase(uuid, uuid, uuid) from public, anon;
grant execute on function private.attach_import_rule_purchase(uuid, uuid, uuid) to authenticated;
