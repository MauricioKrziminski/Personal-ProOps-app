-- Regra "nota que cita X vai para a pasta Y": a mesma tabela das regras de lançamento
-- (`categorization_rules`), com `folder_id` no lugar de categoria/conta. Uma tabela só: ela já tem
-- RLS, portão de assinatura, tela, contador de usos e o recurso `rules` do agente.

alter table public.categorization_rules
  add column if not exists folder_id uuid references public.note_folders(id) on delete cascade;

-- Regra de nota não tem categoria, detalhe nem conta; a de lançamento continua como era.
alter table public.categorization_rules drop constraint if exists categorization_rules_alvo_ck;
alter table public.categorization_rules add constraint categorization_rules_alvo_ck
  check (folder_id is null or (category is null and account_id is null and subcategory_id is null));

-- O mesmo termo pode existir como regra de lançamento E como regra de nota.
alter table public.categorization_rules
  drop constraint if exists categorization_rules_workspace_id_match_type_pattern_key;
create unique index if not exists categorization_rules_ws_tipo_pattern_uq
  on public.categorization_rules (workspace_id, match_type, pattern, (folder_id is null));

-- Regra de nota nunca casa lançamento (mesma assinatura e mesmos grants de antes).
create or replace function public._match_rule(ws_id uuid, texto text)
returns table(category text, account_id uuid, rule_id uuid)
language sql stable security definer
set search_path = public
as $$
  select r.category, r.account_id, r.id
  from public.categorization_rules r
  where r.workspace_id = ws_id
    and r.folder_id is null
    and case r.match_type
      when 'regex' then coalesce(texto, '') ~* r.pattern
      else private.normalize_description(texto)
           like '%' || private.normalize_description(r.pattern) || '%'
    end
  order by r.priority, length(r.pattern) desc
  limit 1;
$$;

-- A regra de nota que casa com o texto: menor prioridade e padrão mais longo primeiro.
create or replace function public._match_note_rule(ws uuid, texto text)
returns table(rule_id uuid, folder_id uuid)
language sql stable security definer
set search_path = ''
as $$
  select r.id, r.folder_id
  from public.categorization_rules r
  where r.workspace_id = ws
    and r.folder_id is not null
    and case r.match_type
      when 'regex' then coalesce(texto, '') ~* r.pattern
      else private.normalize_description(texto)
           like '%' || private.normalize_description(r.pattern) || '%'
    end
  order by r.priority, length(r.pattern) desc
  limit 1;
$$;
revoke execute on function public._match_note_rule(uuid, text) from public, anon, authenticated;
grant execute on function public._match_note_rule(uuid, text) to service_role;

-- Versão do agente sob RLS (`AGENTE_RLS`): confere a posse e delega (padrão interna/wrapper).
create or replace function private.match_note_rule_do_membro(p_workspace uuid, p_text text)
returns table(rule_id uuid, folder_id uuid)
language sql stable security definer
set search_path = ''
as $$
  select m.rule_id, m.folder_id
  from public._match_note_rule(p_workspace, p_text) m
  where p_workspace in (select private.my_workspace_ids());
$$;
revoke execute on function private.match_note_rule_do_membro(uuid, text) from public, anon;
grant execute on function private.match_note_rule_do_membro(uuid, text) to authenticated;
