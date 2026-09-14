-- Notas: ordem manual, cor, arquivamento e tag de pasta.
--
--   docker exec -i supabase_db_app-proops psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/notas_ordem_cor_arquivo.sql
--
-- A asserção que carrega esta migration é a 2: **a linha que NÃO mudou de slot mantém o
-- `updated_at`**. Ela é o caso que passa despercebido — conferir só a linha que MOVEU dá verde
-- com o defeito de pé, porque a cláusula WHEN do trigger protege exatamente essa e deixa as
-- outras para o `is distinct from` da RPC. Sem as duas metades, arrastar uma nota reescreve o
-- "há 2 dias" de toda a lista e embaralha o modo Recentes, sem erro nenhum na tela.

\set ON_ERROR_STOP on
begin;

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
values
  ('00000000-0000-0000-0000-00000000d001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'nota-a@teste.local', '{}', '{}'),
  ('00000000-0000-0000-0000-00000000d002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'nota-b@teste.local', '{}', '{}');

do $$
declare
  ws_a uuid; ws_b uuid;
  usr_a uuid := '00000000-0000-0000-0000-00000000d001';
  pasta uuid;
begin
  select id into ws_a from public.workspaces where owner_id = usr_a;
  select id into ws_b from public.workspaces
    where owner_id = '00000000-0000-0000-0000-00000000d002';

  insert into public.note_folders (id, workspace_id, user_id, name, color, tags)
  values ('00000000-0000-0000-0000-0000000f0001', ws_a, usr_a, 'mercado', 'oceano', '{casa,feira}')
  returning id into pasta;

  -- `updated_at` vem do INSERT: o trigger é `before update`, então aqui ele não roda e a data
  -- antiga fica gravada. É contra ela que as asserções de reordenação comparam.
  insert into public.notes (id, workspace_id, user_id, content, folder_id, source, updated_at)
  values
    ('00000000-0000-0000-0000-0000000e0001', ws_a, usr_a, 'nota um #feira',   pasta, 'app', '2020-01-01'),
    ('00000000-0000-0000-0000-0000000e0002', ws_a, usr_a, 'nota dois #feira', pasta, 'app', '2020-01-01'),
    ('00000000-0000-0000-0000-0000000e0003', ws_a, usr_a, 'nota tres',        pasta, 'app', '2020-01-01'),
    ('00000000-0000-0000-0000-0000000e0004', ws_a, usr_a, 'nota quatro',      pasta, 'app', '2020-01-01');

  insert into public.notes (id, workspace_id, user_id, content, source, updated_at)
  values ('00000000-0000-0000-0000-0000000e0009',
          ws_b, '00000000-0000-0000-0000-00000000d002', 'nota do B', 'app', '2020-01-01');
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000d001', true);
set local role authenticated;

-- 1. primeira reordenação: tudo era null, tudo é escrito, nada muda `updated_at`.
do $$
declare mexidas int;
begin
  perform public.notes_reorder(array[
    '00000000-0000-0000-0000-0000000e0001',
    '00000000-0000-0000-0000-0000000e0002',
    '00000000-0000-0000-0000-0000000e0004',
    '00000000-0000-0000-0000-0000000e0003']::uuid[]);

  assert (select position from public.notes where id = '00000000-0000-0000-0000-0000000e0004') = 3,
    'a nota quatro deveria estar no slot 3';
  assert (select position from public.notes where id = '00000000-0000-0000-0000-0000000e0003') = 4,
    'a nota tres deveria estar no slot 4';

  select count(*) into mexidas from public.notes
   where workspace_id in (select private.my_workspace_ids())
     and updated_at <> '2020-01-01'::timestamptz;
  assert mexidas = 0,
    format('1. reordenar nao pode tocar em updated_at; %s linha(s) mudaram', mexidas);
end $$;

-- 2. A ASSERÇÃO QUE IMPORTA. Segunda reordenação, desfazendo a troca: as notas UM e DOIS recebem
--    o mesmo slot que já tinham. Sem o `position is distinct from` da RPC elas seriam escritas,
--    a cláusula WHEN do trigger seria VERDADEIRA nelas (a posição não mudou) e o `moddatetime`
--    carimbaria `now()` — o defeito atinge justamente a maioria da lista, que nem se moveu.
do $$
declare paradas int; mexidas int;
begin
  perform public.notes_reorder(array[
    '00000000-0000-0000-0000-0000000e0001',
    '00000000-0000-0000-0000-0000000e0002',
    '00000000-0000-0000-0000-0000000e0003',
    '00000000-0000-0000-0000-0000000e0004']::uuid[]);

  select count(*) into paradas from public.notes
   where id in ('00000000-0000-0000-0000-0000000e0001','00000000-0000-0000-0000-0000000e0002')
     and updated_at = '2020-01-01'::timestamptz;
  assert paradas = 2,
    ' 2. a linha que NAO mudou de slot tem de manter updated_at (falta o `is distinct from` na RPC)';

  select count(*) into mexidas from public.notes
   where workspace_id in (select private.my_workspace_ids())
     and updated_at <> '2020-01-01'::timestamptz;
  assert mexidas = 0,
    format('2. nenhuma linha pode mudar updated_at ao reordenar; %s mudaram', mexidas);
end $$;

-- 3. editar de verdade CONTINUA carimbando `updated_at` — a trava não pode ter desligado o
--    trigger para todo mundo.
do $$
begin
  update public.notes set content = 'nota um editada #feira'
   where id = '00000000-0000-0000-0000-0000000e0001';

  assert (select updated_at from public.notes where id = '00000000-0000-0000-0000-0000000e0001')
         > '2020-01-02'::timestamptz,
    '3. edicao normal tem de continuar atualizando updated_at';
end $$;

-- 4. cor é NOME de token, e só os oito.
do $$
begin
  begin
    update public.notes set color = 'roxo' where id = '00000000-0000-0000-0000-0000000e0002';
    raise exception '4. cor fora do catalogo deveria ser recusada pelo CHECK';
  exception when check_violation then null;
  end;

  update public.notes set color = 'oceano' where id = '00000000-0000-0000-0000-0000000e0002';
  update public.notes set color = null     where id = '00000000-0000-0000-0000-0000000e0003';
end $$;

-- 5. tag de pasta usa a MESMA forma que `note_tags_of` produz.
do $$
begin
  begin
    update public.note_folders set tags = '{Casa}' where id = '00000000-0000-0000-0000-0000000f0001';
    raise exception '5. tag com maiuscula deveria ser recusada';
  exception when check_violation then null;
  end;

  begin
    update public.note_folders set tags = '{a}' where id = '00000000-0000-0000-0000-0000000f0001';
    raise exception '5. tag de 1 caractere deveria ser recusada';
  exception when check_violation then null;
  end;

  update public.note_folders set tags = '{}'          where id = '00000000-0000-0000-0000-0000000f0001';
  update public.note_folders set tags = '{casa,ideia_2026}'
   where id = '00000000-0000-0000-0000-0000000f0001';
end $$;

-- 5b. O NAMESPACE É UM SÓ: a tag que uma nota GERA tem de caber numa pasta.
--     `note_tags_of` usa `[[:alnum:]]`, que num banco UTF-8 casa acento — medido, `#reunião`
--     vira a tag `reunião`. Um CHECK em `^[a-z0-9_]+$` a recusaria com 23514 e o chip da tela
--     filtraria metade: a nota apareceria, a pasta nunca.
do $$
declare gerada text;
begin
  update public.notes set content = 'ata #reunião' where id = '00000000-0000-0000-0000-0000000e0004';
  select tags[1] into gerada from public.notes where id = '00000000-0000-0000-0000-0000000e0004';
  assert gerada = 'reunião', format('5b. a nota deveria gerar a tag "reunião", veio "%s"', gerada);

  update public.note_folders set tags = array[gerada] where id = '00000000-0000-0000-0000-0000000f0001';
  update public.note_folders set tags = '{casa,ideia_2026}' where id = '00000000-0000-0000-0000-0000000f0001';
end $$;

-- 6. arquivada some das contagens, e volta ao desarquivar.
do $$
declare na_pasta bigint; com_a_tag bigint;
begin
  select notes_count into na_pasta from public.note_folder_counts()
   where folder_id = '00000000-0000-0000-0000-0000000f0001';
  assert na_pasta = 4, format('6. a pasta deveria ter 4 notas, veio %s', na_pasta);

  select notes_count into com_a_tag from public.note_tag_counts() where tag = 'feira';
  assert com_a_tag = 2, format('6. #feira deveria estar em 2 notas, veio %s', com_a_tag);

  update public.notes set archived_at = now() where id = '00000000-0000-0000-0000-0000000e0001';

  select notes_count into na_pasta from public.note_folder_counts()
   where folder_id = '00000000-0000-0000-0000-0000000f0001';
  assert na_pasta = 3, format('6. arquivada tem de sair da contagem da pasta, veio %s', na_pasta);

  select notes_count into com_a_tag from public.note_tag_counts() where tag = 'feira';
  assert com_a_tag = 1, format('6. arquivada tem de sair da contagem de tag, veio %s', com_a_tag);

  update public.notes set archived_at = null where id = '00000000-0000-0000-0000-0000000e0001';

  select notes_count into na_pasta from public.note_folder_counts()
   where folder_id = '00000000-0000-0000-0000-0000000f0001';
  assert na_pasta = 4, format('6. desarquivar tem de devolver a nota a contagem, veio %s', na_pasta);
end $$;

-- 6b. `note_folders_reorder` é a cópia simétrica, e cópia simétrica é onde mora o erro de
--     copiar-e-colar (trocar `f.` por `n.`, esquecer o `is distinct from`). Mesma prova da 2:
--     a pasta que NÃO mudou de slot mantém o `updated_at`.
--
--     ⚠️ As três pastas são NOVAS e a data vem do INSERT. Retrodatar por UPDATE não funciona
--     aqui — esse próprio update dispara o trigger e o `moddatetime` carimba `now()` por cima,
--     que é exatamente o comportamento sob teste. (Foi o que fez esta asserção acusar um
--     defeito que não existia, na primeira escrita dela.)
do $$
declare ws uuid; usr uuid := '00000000-0000-0000-0000-00000000d001'; mexidas int;
begin
  select workspace_id into ws from public.note_folders
   where id = '00000000-0000-0000-0000-0000000f0001';

  insert into public.note_folders (id, workspace_id, user_id, name, updated_at) values
    ('00000000-0000-0000-0000-0000000f0002', ws, usr, 'trabalho', '2020-01-01'),
    ('00000000-0000-0000-0000-0000000f0003', ws, usr, 'ideias',   '2020-01-01'),
    ('00000000-0000-0000-0000-0000000f0004', ws, usr, 'viagem',   '2020-01-01');

  perform public.note_folders_reorder(array[
    '00000000-0000-0000-0000-0000000f0002',
    '00000000-0000-0000-0000-0000000f0003',
    '00000000-0000-0000-0000-0000000f0004']::uuid[]);
  -- segunda passada trocando só as duas últimas: "trabalho" recebe o slot 1 que já tinha
  perform public.note_folders_reorder(array[
    '00000000-0000-0000-0000-0000000f0002',
    '00000000-0000-0000-0000-0000000f0004',
    '00000000-0000-0000-0000-0000000f0003']::uuid[]);

  assert (select position from public.note_folders
           where id = '00000000-0000-0000-0000-0000000f0004') = 2,
    '6b. "viagem" deveria ter subido para o slot 2';

  select count(*) into mexidas from public.note_folders
   where id in ('00000000-0000-0000-0000-0000000f0002',
                '00000000-0000-0000-0000-0000000f0003',
                '00000000-0000-0000-0000-0000000f0004')
     and updated_at <> '2020-01-01'::timestamptz;
  assert mexidas = 0,
    format('6b. reordenar pasta nao pode tocar em updated_at; %s linha(s) mudaram', mexidas);
end $$;

reset role;

-- 7. reordenar é `security invoker` sob RLS: B não mexe no que é de A, e o silêncio é o certo
--    (a linha some do UPDATE, não vira erro).
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000d002', true);
set local role authenticated;

do $$
declare alheias int;
begin
  perform public.notes_reorder(array[
    '00000000-0000-0000-0000-0000000e0003',
    '00000000-0000-0000-0000-0000000e0004']::uuid[]);
end $$;

reset role;

do $$
declare p3 double precision; p4 double precision;
begin
  select position into p3 from public.notes where id = '00000000-0000-0000-0000-0000000e0003';
  select position into p4 from public.notes where id = '00000000-0000-0000-0000-0000000e0004';
  assert p3 = 3 and p4 = 4,
    format('7. B nao pode reordenar nota de A; ficou p3=%s p4=%s', p3, p4);
end $$;

rollback;
