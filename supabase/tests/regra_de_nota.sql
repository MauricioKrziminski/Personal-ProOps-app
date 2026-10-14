-- Regra "nota que cita X vai para a pasta Y" (20261013150000): tabela única, exclusividade, cascade.
\set ON_ERROR_STOP on
begin;
do $$
declare
  u uuid := '00000000-0000-0000-0000-0000000072a1';
  w uuid; f1 uuid; f2 uuid; r_nota uuid; r_cat uuid; got record; n int;
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
  values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rn-a@teste.local', '{}', '{}');
  select id into w from public.workspaces where owner_id = u;
  insert into public.note_folders (workspace_id, user_id, name) values (w, u, 'proops') returning id into f1;
  insert into public.note_folders (workspace_id, user_id, name) values (w, u, 'saude') returning id into f2;

  insert into public.categorization_rules (workspace_id, user_id, pattern, folder_id)
    values (w, u, 'proops', f1) returning id into r_nota;
  insert into public.categorization_rules (workspace_id, user_id, pattern, category)
    values (w, u, 'uber', 'transporte') returning id into r_cat;
  -- o mesmo termo pode ser regra de lançamento E de nota
  insert into public.categorization_rules (workspace_id, user_id, pattern, category)
    values (w, u, 'proops', 'trabalho');
  begin
    insert into public.categorization_rules (workspace_id, user_id, pattern, folder_id) values (w, u, 'proops', f2);
    assert false, 'duas regras de nota com o mesmo termo deveriam colidir';
  exception when unique_violation then null; end;

  -- nota casa regra de nota; lançamento nunca casa regra de nota (e vice-versa)
  select * into got from public._match_note_rule(w, 'Ideia para o ProOps: agente novo');
  assert got.rule_id = r_nota and got.folder_id = f1, 'regra de nota deveria casar';
  assert (select count(*) from public._match_note_rule(w, 'corrida de uber')) = 0, 'regra de lançamento não casa nota';
  select * into got from public._match_rule(w, 'proops mensalidade');
  assert got.category = 'trabalho', 'só a regra de lançamento casa lançamento';
  assert (select count(*) from public._match_rule(w, 'uber')) = 1, 'regra de lançamento segue casando';

  -- mesma prioridade: o padrão mais longo vem primeiro
  insert into public.categorization_rules (workspace_id, user_id, pattern, folder_id) values (w, u, 'agente novo', f2);
  select * into got from public._match_note_rule(w, 'proops agente novo');
  assert got.folder_id = f2, 'padrão mais longo (agente novo) vem antes com a mesma prioridade';

  -- exclusividade: regra de nota não tem categoria nem conta
  begin
    insert into public.categorization_rules (workspace_id, user_id, pattern, folder_id, category) values (w, u, 'x1', f1, 'a');
    assert false, 'nota com categoria deveria ser recusada';
  exception when check_violation then null; end;

  -- apagar a pasta leva a regra
  delete from public.note_folders where id = f2;
  select count(*) into n from public.categorization_rules where folder_id = f2 or pattern = 'agente novo';
  assert n = 0, 'cascade da pasta';

  -- o wrapper do agente sob RLS confere a posse
  perform set_config('request.jwt.claim.sub', u::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  assert (select count(*) from private.match_note_rule_do_membro(w, 'proops')) = 1, 'membro enxerga';
  assert (select count(*) from private.match_note_rule_do_membro('00000000-0000-0000-0000-0000000072ff', 'proops')) = 0, 'não-membro não';
  reset role;
end $$;
rollback;
