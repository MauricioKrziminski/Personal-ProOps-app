-- Contato comercial com opção de sair (20261013140000).
\set ON_ERROR_STOP on
begin;

do $$
declare
  a uuid := '00000000-0000-0000-0000-0000000078a1';
  b uuid := '00000000-0000-0000-0000-0000000078b1';
  r jsonb; quando timestamptz; tok uuid; tok_b uuid;
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data) values
   (a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cc-a@teste.local', '{}', '{}'),
   (b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cc-b@teste.local', '{}', '{}');
  select marketing_token into tok from public.profiles where id = a;
  select marketing_token into tok_b from public.profiles where id = b;
  assert (select marketing_opt_out_at is null from public.profiles where id = a), 'perfil novo aceita (legítimo interesse)';
  assert tok is not null and tok_b is not null and tok <> tok_b, 'cada perfil tem o seu token';

  set local role anon;
  begin perform public.set_marketing_contact(false); assert false, 'anon não executa'; exception when insufficient_privilege then null; end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r := public.set_marketing_contact(false);
  quando := (r->>'marketing_opt_out_at')::timestamptz;
  assert quando is not null, 'sair grava a data';
  perform public.set_marketing_contact(false);
  assert (select marketing_opt_out_at from public.profiles where id = a) = quando, 'sair de novo não move a data';
  begin perform public.set_marketing_contact(null); assert false, 'nulo recusa'; exception when sqlstate '22023' then null; end;

  -- UPDATE direto não mexe na preferência nem no token
  update public.profiles set marketing_opt_out_at = null, marketing_token = gen_random_uuid(), display_name = 'X' where id = a;
  assert (select marketing_opt_out_at = quando and marketing_token = tok and display_name = 'X'
            from public.profiles where id = a), 'update direto não muda preferência nem token';

  r := public.set_marketing_contact(true);
  assert r->'marketing_opt_out_at' = 'null'::jsonb, 'voltar a aceitar zera a data';
  reset role;
  assert (select marketing_opt_out_at is null from public.profiles where id = b), 'perfil de B intacto';

  perform set_config('request.jwt.claims', '', true);
  set local role authenticated;
  begin perform public.set_marketing_contact(false); assert false, 'sem uid'; exception when sqlstate '28000' then null; end;
  reset role;
end $$;

rollback;
