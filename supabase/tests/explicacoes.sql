-- F17: a saúde financeira devolve a janela que usou (os três meses até HOJE do Brasil), e anon
-- não executa a função recriada. Roda como `authenticated`.
--
--     agent/.venv/bin/python scripts/sql-test.py supabase/tests/explicacoes.sql
\set ON_ERROR_STOP on
begin;
do $$
declare
  u uuid := '00000000-0000-0000-0000-00000000f171';
  w uuid := '00000000-0000-0000-0000-00000000f172';
  r record;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  insert into auth.users(id,email) values (u,'explicacoes-owner@example.invalid') on conflict(id) do nothing;
  insert into public.profiles(id) values (u) on conflict(id) do nothing;
  insert into public.workspaces(id,owner_id,name) values (w,u,'Explicações');
  insert into public.workspace_members(workspace_id,user_id,role) values (w,u,'owner');

  perform set_config('request.jwt.claims', json_build_object('sub',u,'role','authenticated')::text, true);
  set local role authenticated;

  select * into r from public.financial_health();
  if r.window_to is distinct from hoje then raise exception 'window_to % <> hoje %', r.window_to, hoje; end if;
  if r.window_from is distinct from (hoje - interval '3 months')::date then
    raise exception 'window_from % não é 3 meses antes de %', r.window_from, hoje;
  end if;
  if r.score is null then raise exception 'score sumiu'; end if;

  reset role;
  if has_function_privilege('anon', 'public.financial_health()', 'execute') then
    raise exception 'anon executa financial_health';
  end if;
  if not has_function_privilege('authenticated', 'public.financial_health()', 'execute') then
    raise exception 'authenticated perdeu financial_health';
  end if;
end $$;
rollback;
