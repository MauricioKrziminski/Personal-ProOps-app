-- Pastas aninhadas (20261015120000): nome único por mãe, ciclo, profundidade, workspace e contagem recursiva.
\set ON_ERROR_STOP on
begin;
do $$
declare
  u uuid := '00000000-0000-0000-0000-0000000073a1';
  u2 uuid := '00000000-0000-0000-0000-0000000073a2';
  w uuid; w2 uuid; trab uuid; pess uuid; a26 uuid; b26 uuid; l3 uuid; l4 uuid; l5 uuid; r1 uuid; r2 uuid; rid uuid;
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
  values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pa-a@teste.local', '{}', '{}'),
         (u2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pa-b@teste.local', '{}', '{}');
  select id into w from public.workspaces where owner_id = u;
  select id into w2 from public.workspaces where owner_id = u2;

  insert into public.note_folders (workspace_id, user_id, name) values (w, u, 'trabalho') returning id into trab;
  insert into public.note_folders (workspace_id, user_id, name) values (w, u, 'pessoal') returning id into pess;

  -- mesmo nome em mães diferentes: ok
  insert into public.note_folders (workspace_id, user_id, name, parent_id) values (w, u, '2026', trab) returning id into a26;
  insert into public.note_folders (workspace_id, user_id, name, parent_id) values (w, u, '2026', pess) returning id into b26;

  -- mesmo nome na mesma mãe: falha
  begin
    insert into public.note_folders (workspace_id, user_id, name, parent_id) values (w, u, '2026', trab);
    assert false, 'mesmo nome na mesma mãe deveria colidir';
  exception when unique_violation then null; end;

  -- mesmo nome na raiz duas vezes: falha (nulls not distinct)
  begin
    insert into public.note_folders (workspace_id, user_id, name) values (w, u, 'trabalho');
    assert false, 'mesmo nome na raiz deveria colidir';
  exception when unique_violation then null; end;

  -- ciclo: pasta dentro dela mesma e dentro de uma descendente
  begin
    update public.note_folders set parent_id = trab where id = trab;
    assert false, 'pasta dentro dela mesma deveria falhar';
  exception when sqlstate 'P0001' then null; end;
  begin
    update public.note_folders set parent_id = a26 where id = trab;
    assert false, 'ciclo deveria falhar';
  exception when sqlstate 'P0001' then
    assert sqlerrm like '%dentro dela%', 'mensagem do ciclo: ' || sqlerrm;
  end;

  -- profundidade: trab(1) > a26(2) > l3 > l4 > l5 ok; o 6º falha
  insert into public.note_folders (workspace_id, user_id, name, parent_id) values (w, u, 'n3', a26) returning id into l3;
  insert into public.note_folders (workspace_id, user_id, name, parent_id) values (w, u, 'n4', l3) returning id into l4;
  insert into public.note_folders (workspace_id, user_id, name, parent_id) values (w, u, 'n5', l4) returning id into l5;
  begin
    insert into public.note_folders (workspace_id, user_id, name, parent_id) values (w, u, 'n6', l5);
    assert false, '6º nível deveria falhar';
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'Limite de 5 níveis de pastas.', 'mensagem da profundidade: ' || sqlerrm;
  end;

  -- mover subárvore que estoura: b26 (nível 2, sem filhas) ok sob l4? b26 sob l4 = nível 5 ok; pess com b26 sob l5 estoura
  begin
    update public.note_folders set parent_id = l5 where id = pess;  -- pess + b26 = 2 níveis sob l5 (nível 5)
    assert false, 'mover subárvore que estoura deveria falhar';
  exception when sqlstate 'P0001' then null; end;
  update public.note_folders set parent_id = l3 where id = b26;      -- 1 nível sob l3 (nível 3) → nível 4: ok
  begin
    update public.note_folders set parent_id = trab where id = b26;  -- '2026' já existe em trab
    assert false, 'mover para mãe que já tem o nome deveria colidir';
  exception when unique_violation then null; end;

  -- upsert com parent_id nulo (nulls not distinct): atualiza em vez de duplicar
  insert into public.note_folders (workspace_id, user_id, name, icon) values (w, u, 'trabalho', 'folder')
    on conflict (workspace_id, parent_id, name) do update set icon = excluded.icon returning id into rid;
  assert rid = trab, 'upsert na raiz deveria bater na pasta existente';
  assert (select icon from public.note_folders where id = trab) = 'folder', 'upsert deveria atualizar o ícone';

  -- mesmo nome na raiz de dois workspaces: ok
  insert into public.note_folders (workspace_id, user_id, name) values (w2, u2, 'trabalho');

  -- apagar a mãe solta a filha na raiz (on delete set null): se já há raiz com o mesmo nome, dá 23505
  -- (conhecido; o app trata a mensagem). 'trabalho' > '2026' e outra '2026' na raiz:
  insert into public.note_folders (workspace_id, user_id, name) values (w, u, '2026');
  begin
    delete from public.note_folders where id = trab;
    assert false, 'apagar mãe cuja filha colide com a raiz deveria dar 23505';
  exception when unique_violation then null; end;

  -- ciclo LEGADO (trigger desligado): a CTE tem teto e um update na pasta do ciclo termina
  alter table public.note_folders disable trigger note_folders_arvore;
  insert into public.note_folders (workspace_id, user_id, name) values (w, u, 'ciclo-a') returning id into r1;
  insert into public.note_folders (workspace_id, user_id, name, parent_id) values (w, u, 'ciclo-b', r1) returning id into r2;
  update public.note_folders set parent_id = r2 where id = r1;
  alter table public.note_folders enable trigger note_folders_arvore;
  begin
    update public.note_folders set parent_id = r1 where id = r2;  -- termina (com erro ou não)
  exception when sqlstate 'P0001' then null; end;
end $$;
rollback;

begin;
do $$
declare
  u uuid := '00000000-0000-0000-0000-0000000073b1';
  u2 uuid := '00000000-0000-0000-0000-0000000073b2';
  w uuid; w2 uuid; raiz uuid; filha uuid; neta uuid; arq uuid; sob_arq uuid; alheia uuid; n bigint;
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
  values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pb-a@teste.local', '{}', '{}'),
         (u2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pb-b@teste.local', '{}', '{}');
  select id into w from public.workspaces where owner_id = u;
  select id into w2 from public.workspaces where owner_id = u2;

  -- mãe de outro workspace: falha
  insert into public.note_folders (workspace_id, user_id, name) values (w2, u2, 'alheia') returning id into alheia;
  insert into public.note_folders (workspace_id, user_id, name) values (w, u, 'raiz') returning id into raiz;
  begin
    insert into public.note_folders (workspace_id, user_id, name, parent_id) values (w, u, 'x', alheia);
    assert false, 'mãe de outro workspace deveria falhar';
  exception when sqlstate 'P0001' then null; end;

  insert into public.note_folders (workspace_id, user_id, name, parent_id) values (w, u, 'filha', raiz) returning id into filha;
  insert into public.note_folders (workspace_id, user_id, name, parent_id) values (w, u, 'neta', filha) returning id into neta;
  insert into public.note_folders (workspace_id, user_id, name, parent_id, archived_at) values (w, u, 'arq', raiz, now()) returning id into arq;
  insert into public.note_folders (workspace_id, user_id, name, parent_id) values (w, u, 'sob', arq) returning id into sob_arq;

  insert into public.notes (workspace_id, user_id, content, folder_id) values
    (w, u, 'r1', raiz), (w, u, 'f1', filha), (w, u, 'f2', filha), (w, u, 'n1', neta),
    (w, u, 'a1', arq), (w, u, 's1', sob_arq);
  insert into public.notes (workspace_id, user_id, content, folder_id, archived_at) values (w, u, 'arquivada', neta, now());

  -- a função é invoker: simula o app
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select notes_count into n from public.note_folder_counts() where folder_id = raiz;
  assert n = 4, 'raiz soma ela + filha + neta (sem a subpasta arquivada): ' || n;
  select notes_count into n from public.note_folder_counts() where folder_id = filha;
  assert n = 3, 'filha soma ela + neta: ' || n;
  select notes_count into n from public.note_folder_counts() where folder_id = neta;
  assert n = 1, 'neta só as dela (arquivada fora): ' || n;
  select notes_count into n from public.note_folder_counts() where folder_id = arq;
  assert n = 2, 'a própria arquivada ainda conta as dela e as de baixo: ' || n;
  reset role;
end $$;
rollback;
