-- Contador de uso da regra: a tela de regras mostra quais estao pegando de fato
-- (e quais viraram lixo). Incremento atomico, sem read-modify-write no cliente.
create or replace function public._bump_rule_hits(rule_id uuid)
returns void
language sql security definer
set search_path = public
as $$
  update public.categorization_rules set hits = hits + 1 where id = rule_id;
$$;
revoke execute on function public._bump_rule_hits(uuid) from public, anon, authenticated;
