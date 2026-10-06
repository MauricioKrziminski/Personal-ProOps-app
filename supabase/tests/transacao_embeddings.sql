-- Vetores de lançamento: isolamento por workspace, janela de datas, ordem, cascade ao apagar e o
-- texto único do documento. Roda no staging, sempre revertido:
--
--     agent/.venv/bin/python scripts/sql-test.py supabase/tests/transacao_embeddings.sql
--
-- (a migration `20261006120000` tem que estar aplicada, ou vir antes deste arquivo no mesmo script)
\set ON_ERROR_STOP on
begin;
do $$
declare
  u  uuid := '00000000-0000-0000-0000-00000000e1a1';
  u2 uuid := '00000000-0000-0000-0000-00000000e1a2';
  w  uuid := '00000000-0000-0000-0000-00000000e1b1';
  w2 uuid := '00000000-0000-0000-0000-00000000e1b2';
  t_perto uuid := '00000000-0000-0000-0000-00000000e1c1';
  t_longe uuid := '00000000-0000-0000-0000-00000000e1c2';
  t_velho uuid := '00000000-0000-0000-0000-00000000e1c3';
  t_alheio uuid := '00000000-0000-0000-0000-00000000e1c4';
  d0 date := '1990-03-10';
  v real[]; q extensions.vector; n int;
begin
  insert into auth.users(id,email) values (u,'emb-a@example.invalid'),(u2,'emb-b@example.invalid')
    on conflict(id) do nothing;
  insert into public.profiles(id) values (u),(u2) on conflict(id) do nothing;
  insert into public.workspaces(id,owner_id,name) values (w,u,'Emb A'),(w2,u2,'Emb B');
  insert into public.workspace_members(workspace_id,user_id,role) values (w,u,'owner'),(w2,u2,'owner');
  insert into public.transactions(id,workspace_id,user_id,kind,amount_cents,description,merchant,category,occurred_at,source,status) values
    (t_perto, w, u, 'expense', 3500, 'Restaurante Fulano', null, 'alimentação', d0, 'app', 'cleared'),
    (t_longe, w, u, 'expense', 9000, 'Gasolina', 'Posto X', 'transporte', d0, 'app', 'cleared'),
    (t_velho, w, u, 'expense', 3500, 'Restaurante Fulano', null, 'alimentação', d0 - 30, 'app', 'cleared'),
    (t_alheio,w2, u2,'expense', 3500, 'Restaurante Fulano', null, 'alimentação', d0, 'app', 'cleared');

  -- eixo 1 = "comida", eixo 2 = "carro"; a consulta é "comida"
  v := array_fill(0::real, array[768]); v[1] := 1; q := v::extensions.vector;
  insert into public.transaction_embeddings(transaction_id,workspace_id,embedding,model,content_hash) values
    (t_perto, w, q, 'm', 'h'), (t_velho, w, q, 'm', 'h'), (t_alheio, w2, q, 'm', 'h');
  v := array_fill(0::real, array[768]); v[2] := 1;
  insert into public.transaction_embeddings(transaction_id,workspace_id,embedding,model,content_hash)
    values (t_longe, w, v::extensions.vector, 'm', 'h');

  select count(*) into n from private.transacoes_semelhantes(w, q, 5, null, null);
  assert n = 3, format('workspace A tem 3 vetores, voltaram %s', n);
  assert (select transaction_id from private.transacoes_semelhantes(w, q, 1, null, null)) in (t_perto, t_velho),
    'o mais parecido tem que ser o do eixo da consulta';
  assert (select similaridade from private.transacoes_semelhantes(w, q, 5, null, null) order by similaridade limit 1) < 0.01,
    'o do outro eixo tem similaridade ~0';
  assert (select transaction_id from private.transacoes_semelhantes(w, q, 5, null, null) offset 2) = t_longe,
    'o do outro eixo vem por último';

  -- isolamento: o lançamento idêntico do workspace B nunca aparece em A, e vice-versa
  assert not exists (select 1 from private.transacoes_semelhantes(w, q, 10, null, null) where transaction_id = t_alheio),
    'vazou vetor de outro workspace';
  assert (select array_agg(transaction_id) from private.transacoes_semelhantes(w2, q, 10, null, null)) = array[t_alheio],
    'B só enxerga o próprio';

  -- janela de datas: só o dia pedido
  assert (select array_agg(transaction_id order by transaction_id)
            from private.transacoes_semelhantes(w, q, 10, d0, d0)) = array[t_perto, t_longe],
    'a janela de datas não filtrou';

  assert (select count(*) from private.transacoes_semelhantes(w, q, 1, null, null)) = 1, 'limite';

  -- cascade: apagar o lançamento leva o vetor
  delete from public.transactions where id = t_perto;
  assert not exists (select 1 from public.transaction_embeddings where transaction_id = t_perto),
    'o vetor sobreviveu ao lançamento';

  -- texto único do documento
  assert private.texto_de_busca(' Almoço ', null, 'alimentação') = 'Almoço · alimentação', 'texto 1';
  assert private.texto_de_busca(null, 'Posto X', null) = 'Posto X', 'texto 2';
  assert private.texto_de_busca(null, null, null) = '', 'texto vazio';

  -- só o serviço
  assert not has_table_privilege('authenticated', 'public.transaction_embeddings', 'select'), 'authenticated lê a tabela';
  assert not has_table_privilege('anon', 'public.transaction_embeddings', 'select'), 'anon lê a tabela';
  assert not has_function_privilege('authenticated', 'private.transacoes_semelhantes(uuid, extensions.vector, int, date, date)', 'execute'),
    'authenticated executa a busca';
  assert not has_function_privilege('anon', 'private.transacoes_semelhantes(uuid, extensions.vector, int, date, date)', 'execute'),
    'anon executa a busca';
end $$;
rollback;
