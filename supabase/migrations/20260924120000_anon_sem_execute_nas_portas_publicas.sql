-- `anon` sem EXECUTE nas funções do schema public (24/09/2026).
--
-- A regra do projeto é que as portas públicas são de `authenticated` — o app só chama RPC com a
-- sessão —, e as funções novas já nascem assim (`update_installment_plan`, `delete_debt`…). As
-- antigas não: 45 funções em public ainda davam EXECUTE a `anon` (direto e por PUBLIC). Não havia
-- vazamento — todas são `security invoker`, e `anon` não tem USAGE no schema `private`, então a
-- chamada morre em "permission denied for schema private" —, mas a porta aberta dependia de um
-- detalhe de outro schema para ficar fechada.
--
-- O laço tira `anon` e PUBLIC e garante `authenticated` e `service_role` explicitamente (quem já
-- tinha continua tendo; nada que funcionava com a sessão deixa de funcionar). Função de extensão
-- fica de fora, e função de TRIGGER não ganha `authenticated` (o EXECUTE dela só é conferido no
-- CREATE TRIGGER). Se o conjunto trouxer `security definer`, uma interna `_nome` ou função de outro
-- dono, a migration PARA — foi medido que não traz, e não é para passar se um dia trouxer.
--
-- ⚠️ O default do `postgres` em public deixa de dar EXECUTE EXPLÍCITO a `anon`, mas o PUBLIC vem do
-- padrão GLOBAL do Postgres e continua abrindo toda função nova. Por isso cada migration continua
-- com o seu `revoke execute ... from public, anon` — e `supabase/tests/anon_sem_execute.sql` acusa a
-- que esquecer.

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as assinatura, p.proname, p.prosecdef,
           p.proowner::regrole::text as dono, p.prorettype = 'trigger'::regtype as gatilho
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and has_function_privilege('anon', p.oid, 'execute')
      and not exists (
        select 1 from pg_depend d
        where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
      )
  loop
    if f.prosecdef or f.proname like '\_%' or f.dono <> 'postgres' then
      raise exception 'anon executa % (security definer: %, dono: %): conferir antes de mexer',
        f.assinatura, f.prosecdef, f.dono;
    end if;
    if not f.gatilho then
      execute format('grant execute on function %s to authenticated, service_role', f.assinatura);
    end if;
    execute format('revoke execute on function %s from public, anon', f.assinatura);
  end loop;
end
$$;

alter default privileges for role postgres in schema public revoke execute on functions from anon;
