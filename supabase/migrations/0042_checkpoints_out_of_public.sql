-- As tabelas de checkpoint do LangGraph nasceram em `public` por um motivo que
-- só aparece atrás do pooler: o Supabase IGNORA em silêncio o
-- `options=-csearch_path%3Dlanggraph` do conninfo. A conexão sobe, o search_path
-- continua `"$user", public, extensions`, e o `checkpointer.setup()` cria
-- `checkpoints`, `checkpoint_writes`, `checkpoint_blobs` e `checkpoint_migrations`
-- em public — onde o PostgREST as serve com a ANON KEY.
--
-- Elas guardam o CONTEÚDO das conversas (valores, contas, nomes, notas). Isso é
-- exatamente o que a 0040 criou o schema `langgraph` para evitar.
--
-- O código foi corrigido para fazer `set search_path to langgraph` na conexão
-- (app/db.py::_isolar_checkpointer), que funciona porque roda depois do handshake.
-- Esta migration só remove o que ficou para trás.
--
-- ⚠️ DESTRUTIVA. Só rode depois de conferir que não há conversa em andamento:
--     select count(*) from public.checkpoints;
-- Perder um checkpoint significa perder uma confirmação pendente (o usuário
-- respondeu "sim" e o grafo não sabe mais o que era). Em produção isso é zero
-- hoje — o agente está inerte —, mas depois do corte não será.

-- O `count` vai por EXECUTE, não direto no IF. O PL/pgSQL prepara a expressão
-- do IF como UMA query e resolve a referência à tabela no parse — não há
-- curto-circuito. Com a tabela ausente (banco fresco, `db reset`, CI, ou este
-- mesmo banco depois desta migration rodar uma vez) o bloco levantaria 42P01 e
-- abortaria tudo. Verificado contra Postgres real em 31/08/2026.
do $$
declare
  t text;
  n bigint;
begin
  foreach t in array array['checkpoints', 'checkpoint_writes', 'checkpoint_blobs'] loop
    if to_regclass('public.' || t) is not null then
      execute format('select count(*) from public.%I', t) into n;
      if n > 0 then
        raise exception
          'public.% tem % linha(s): há conversa viva. Revise antes de dropar.', t, n;
      end if;
    end if;
  end loop;
end $$;

drop table if exists public.checkpoint_writes;
drop table if exists public.checkpoint_blobs;
drop table if exists public.checkpoints;
drop table if exists public.checkpoint_migrations;
