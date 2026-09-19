-- Reduz o limite do plano free de 100 para 15 mensagens de IA por mês.
-- Protege a cota do Gemini durante testes em aparelhos reais (ex: 20 celulares).
-- No app, plan_status_for já lê esta função dinamicamente.

create or replace function private.plan_limits(p_plan text)
returns table(max_members int, max_ai_messages_month int, can_import boolean)
language sql immutable
set search_path = public
as $$
  select l.max_members, l.max_ai_messages_month, l.can_import
  from (values
    ('free',   1, 15,   false),
    ('pro',    3, 1000, true),
    ('family', 5, 2000, true)
  ) as l(plan, max_members, max_ai_messages_month, can_import)
  where l.plan = coalesce(p_plan, 'free');
$$;

grant execute on function private.plan_limits(text) to authenticated, service_role;
