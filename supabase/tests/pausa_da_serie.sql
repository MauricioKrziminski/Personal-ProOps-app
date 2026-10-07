-- Pausar a recorrente com prazo (20261009120000). Período [de, até).
set timezone to 'America/Sao_Paulo';
begin;
do $$
declare
  u uuid := '00000000-0000-0000-0000-0000000a5e01';
  w uuid := '00000000-0000-0000-0000-0000000a5e02';
  outro uuid := '00000000-0000-0000-0000-0000000a5e03';
  conta uuid := gen_random_uuid();
  cartao uuid := gen_random_uuid();
  r uuid := gen_random_uuid();
  hoje date := current_date;
  m1 date := (date_trunc('month', current_date) + interval '1 month')::date + 4;
  m2 date := (date_trunc('month', current_date) + interval '2 month')::date + 4;
  m3 date := (date_trunc('month', current_date) + interval '3 month')::date + 4;
  prev jsonb; res jsonb; req uuid := gen_random_uuid(); fat uuid; tid uuid;
begin
  insert into auth.users(id,email) values (u,'pausa@example.invalid'),(outro,'pausa-outro@example.invalid');
  insert into public.profiles(id) values (u),(outro) on conflict do nothing;
  insert into public.workspaces(id,owner_id,name) values (w,u,'Pausa');
  insert into public.workspace_members(workspace_id,user_id,role) values (w,u,'owner');
  insert into public.accounts(id,workspace_id,user_id,name,type) values (conta,w,u,'Conta','checking');
  insert into public.recurring_transactions(id,workspace_id,user_id,kind,amount_cents,description,
    category,account_id,rrule,dtstart,next_run_at,active)
  values (r,w,u,'expense',12000,'Academia','saude',conta,'FREQ=MONTHLY;BYMONTHDAY=5',
    ((date_trunc('month',hoje) - interval '1 month')::date + 4)::timestamptz,
    m1::timestamptz, true);
  insert into public.transactions(workspace_id,user_id,kind,amount_cents,description,category,
    account_id,occurred_at,due_at,status,source,recurring_id)
  select w,u,'expense',12000,'Academia','saude',conta,d,d,'pending','recurring',r
  from unnest(array[m1,m2,m3]) d;
  update public.recurring_transactions set materialized_until = (m3 + 1)::timestamptz where id = r;

  perform set_config('request.jwt.claim.sub', u::text, true);

  -- 1) prévia = o que a escrita faz
  prev := public.pause_recurring_preview(r, m1, m3);
  assert (prev->>'removed_count')::int = 2, 'prévia conta as duas em aberto: '||prev;
  assert (prev->>'cents')::bigint = 24000, 'prévia soma 2 x 120,00: '||prev;
  assert prev->'dates' = to_jsonb(array[m1::text, m2::text]), 'prévia lista as datas: '||prev;

  res := public.pause_recurring(r, m1, m3, req);
  assert res = prev, 'escrita devolve o mesmo que a prévia';
  assert (select count(*) from public.transactions where recurring_id=r) = 1, 'só m3 sobra';
  assert (select materialized_until from public.recurring_transactions where id=r) is null,
    'pausar zera materialized_until (R1)';
  assert public.pause_recurring(r, m1, m3, req) = res, 'repetir com a mesma chave é inofensivo';
  begin
    perform public.pause_recurring(r, m1, m2, req);
    assert false, 'mesma chave com payload diferente deveria falhar';
  exception when sqlstate '22023' then null; end;

  -- 2) a data apagada pela pausa não vira "apagada não volta"
  assert not exists(select 1 from private.recurring_moved_occurrences where recurring_id=r and original_date in (m1,m2)),
    'pausa não marca as datas como apagadas';

  -- 3) projeção da regra pula o período
  assert not exists(select 1 from private.recurring_projection_all_for(array[w], hoje, m3 + 40)
    where recurring_id=r and due_date in (m1,m2)), 'projeção pula m1 e m2';
  assert exists(select 1 from private.recurring_projection_all_for(array[w], hoje, m3 + 40)
    where recurring_id=r and due_date = (date_trunc('month', m3) + interval '1 month')::date + 4),
    'depois do período a projeção volta';

  -- 4) previstas pulam o período
  assert not exists(select 1 from public.expected_recurring_occurrences(hoje, hoje + 61, r)
    where due_date in (m1, m2)), 'previstas pulam o período';

  -- 5) retomar encerra a pausa
  res := public.resume_recurring(r, gen_random_uuid());
  assert (select paused_until from public.recurring_transactions where id=r) is null
      or (select paused_until from public.recurring_transactions where id=r) <= hoje,
    'retomar encerra a pausa até hoje';
  assert (select materialized_until from public.recurring_transactions where id=r) is null,
    'retomar zera materialized_until';

  -- 6) pausa no futuro não esconde nada antes dela
  perform public.pause_recurring(r, m2, m3, gen_random_uuid());
  assert exists(select 1 from private.recurring_projection_all_for(array[w], hoje, m3 + 40)
    where recurring_id=r and due_date = m1), 'm1 (antes da pausa) segue na projeção';

  -- 7) paga, fatura travada e atrasada ficam; a prévia não cita a data que fica
  perform public.resume_recurring(r, gen_random_uuid());
  insert into public.accounts(id,workspace_id,user_id,name,type,closing_day,due_day,payment_account_id)
    values (cartao,w,u,'Cartao','credit_card',3,10,conta);
  delete from public.transactions where recurring_id=r;
  -- m1: paga (cleared); m2: pending em fatura paga; hoje-1: atrasada; m3: pending solta (sai)
  insert into public.transactions(workspace_id,user_id,kind,amount_cents,description,category,
    account_id,occurred_at,due_at,status,source,recurring_id)
  values (w,u,'expense',12000,'Academia','saude',conta,m1,m1,'cleared','recurring',r),
         (w,u,'expense',12000,'Academia','saude',conta,hoje-1,hoje-1,'pending','recurring',r),
         (w,u,'expense',12000,'Academia','saude',conta,m3,m3,'pending','recurring',r);
  insert into public.transactions(workspace_id,user_id,kind,amount_cents,description,category,
    account_id,occurred_at,status,source,recurring_id)
  values (w,u,'expense',12000,'Academia','saude',cartao,m2,'pending','recurring',r)
  returning id, invoice_id into tid, fat;
  update public.card_invoices set status='paid' where id=fat;
  prev := public.pause_recurring_preview(r, hoje - 5, m3 + 1);
  assert not (prev->'dates') @> to_jsonb(m1::text), 'data paga não está em dates: '||prev;
  assert not (prev->'dates') @> to_jsonb(m2::text), 'data em fatura travada não está em dates: '||prev;
  assert not (prev->'dates') @> to_jsonb((hoje-1)::text), 'atrasada não está em dates: '||prev;
  assert (prev->'dates') @> to_jsonb(m3::text), 'a pendente solta sai: '||prev;
  perform public.pause_recurring(r, hoje - 5, m3 + 1, gen_random_uuid());
  assert (select count(*) from public.transactions where recurring_id=r) = 3,
    'ficam a paga, a travada e a atrasada; sai só m3';
  assert not exists(select 1 from public.transactions where recurring_id=r and occurred_at=m3), 'm3 saiu';

  -- 8) outro espaço não pausa
  perform set_config('request.jwt.claim.sub', outro::text, true);
  begin
    perform public.pause_recurring(r, m1, m3, gen_random_uuid());
    assert false, 'outro espaço não deveria pausar';
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'Recorrência não encontrada', sqlerrm;
  end;

  -- 9) período inválido
  perform set_config('request.jwt.claim.sub', u::text, true);
  begin
    perform public.pause_recurring(r, m2, m1, gen_random_uuid());
    assert false, 'fim antes do início deveria falhar';
  exception when sqlstate '22023' then null; end;

  -- 10) fuso no cabeçalho
  assert exists(select 1 from pg_proc where proname='pause_recurring' and pronamespace='private'::regnamespace
    and 'TimeZone=America/Sao_Paulo' = any(proconfig)), 'fuso no cabeçalho';
end $$;
rollback;
