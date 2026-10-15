-- Lançamentos capturados das notificações: cada pessoa LÊ e muda só status/texto das PRÓPRIAS capturas;
-- não insere, não apaga, não vê a de outro membro do mesmo espaço nem a de outro espaço; quem sai do
-- espaço deixa de ver; a reserva do agente (`processing`) é invisível e inalcançável; anon não vê nada.
--
--     agent/.venv/bin/python scripts/sql-test.py supabase/tests/lancamentos_capturados.sql
\set ON_ERROR_STOP on
begin;
do $$
declare
  u uuid := '00000000-0000-0000-0000-0000000ca001';
  w uuid := '00000000-0000-0000-0000-0000000ca002';
  outro uuid := '00000000-0000-0000-0000-0000000ca003';
  w2 uuid := '00000000-0000-0000-0000-0000000ca004';
  socio uuid := '00000000-0000-0000-0000-0000000ca005';
  c uuid; c2 uuid; cs uuid; cp uuid; n int;
begin
  insert into auth.users(id,email) values (u,'captura@example.invalid'), (outro,'captura2@example.invalid'),
    (socio,'captura3@example.invalid') on conflict(id) do nothing;
  insert into public.profiles(id) values (u), (outro), (socio) on conflict(id) do nothing;
  insert into public.workspaces(id,owner_id,name) values (w,u,'Captura'), (w2,outro,'Outro');
  insert into public.workspace_members(workspace_id,user_id,role) values (w,u,'owner'), (w2,outro,'owner'),
    (w,socio,'member');

  -- o agente (postgres) insere
  insert into public.captured_notifications(workspace_id,user_id,external_id,bank,posted_at,texto,status,draft,entendido,kind,amount_cents,occurred_at)
  values (w,u,'ext-00000001','Nubank',now(),'Compra de R$ 45,90 aprovada em MERCADO','pending',
          '{"tipo":"uma","params":{"kind":"expense","amount":"4590"},"perguntas":[],"entendido":"Gasto de R$ 45,90"}',
          'Gasto de R$ 45,90','expense',4590,current_date)
  returning id into c;
  insert into public.captured_notifications(workspace_id,user_id,external_id,bank,posted_at,status)
  values (w2,outro,'ext-00000002','Itaú',now(),'ignored') returning id into c2;

  -- a do sócio, no MESMO espaço
  insert into public.captured_notifications(workspace_id,user_id,external_id,bank,posted_at,texto,status,draft,kind,amount_cents)
  values (w,socio,'ext-00000005','Itaú',now(),'Pix de R$ 12,00 enviado','pending',
          '{"tipo":"uma","params":{},"perguntas":[]}','expense',1200)
  returning id into cs;
  -- a reserva do agente: sem rascunho, antes do modelo
  insert into public.captured_notifications(workspace_id,user_id,external_id,bank,posted_at,status)
  values (w,u,'ext-00000006','Nubank',now(),'processing') returning id into cp;

  -- mesmo external_id no mesmo espaço é recusado
  begin
    insert into public.captured_notifications(workspace_id,user_id,external_id,bank,posted_at,status)
    values (w,u,'ext-00000001','Nubank',now(),'ignored');
    raise exception 'external_id repetido passou';
  exception when unique_violation then null;
  end;

  -- pendente sem rascunho é recusado
  begin
    insert into public.captured_notifications(workspace_id,user_id,external_id,bank,posted_at,status)
    values (w,u,'ext-00000009','Nubank',now(),'pending');
    raise exception 'pendente sem rascunho passou';
  exception when check_violation then null;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub',u,'role','authenticated')::text, true);
  set local role authenticated;

  select count(*) into n from public.captured_notifications;
  if n <> 1 then raise exception 'membro vê % linhas (esperado 1: a própria; nem a do sócio, nem a reserva)', n; end if;

  -- a do sócio não se resolve, nem a reserva vira outra coisa, nem a própria vira reserva
  update public.captured_notifications set status = 'discarded', texto = null where id in (cs, cp);
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'membro alterou % capturas que não são dele / reserva', n; end if;
  begin
    update public.captured_notifications set status = 'processing' where id = c;
    raise exception 'membro pôs a própria captura em processing';
  exception when insufficient_privilege or check_violation then null;
  end;

  update public.captured_notifications set status = 'confirmed', texto = null where id = c;
  if (select status from public.captured_notifications where id = c) <> 'confirmed' then
    raise exception 'status não mudou';
  end if;

  begin
    update public.captured_notifications set amount_cents = 1 where id = c;
    raise exception 'membro mudou amount_cents';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.captured_notifications(workspace_id,user_id,external_id,bank,posted_at,status)
    values (w,u,'ext-00000003','Nubank',now(),'ignored');
    raise exception 'membro inseriu';
  exception when insufficient_privilege then null;
  end;

  begin
    delete from public.captured_notifications where id = c;
    raise exception 'membro apagou';
  exception when insufficient_privilege then null;
  end;

  update public.captured_notifications set status = 'discarded' where id = c2;
  reset role;
  if (select status from public.captured_notifications where id = c2) <> 'ignored' then
    raise exception 'membro mudou linha de outro espaço';
  end if;
  if (select status from public.captured_notifications where id = cs) <> 'pending' then
    raise exception 'membro mudou a captura do sócio';
  end if;

  -- o sócio vê só a dele; depois de sair do espaço, nem ela
  perform set_config('request.jwt.claims', json_build_object('sub',socio,'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.captured_notifications;
  if n <> 1 then raise exception 'sócio vê % linhas (esperado 1: a dele)', n; end if;
  reset role;
  delete from public.workspace_members where workspace_id = w and user_id = socio;
  set local role authenticated;
  select count(*) into n from public.captured_notifications;
  if n <> 0 then raise exception 'quem saiu do espaço ainda vê % capturas', n; end if;
  reset role;

  if has_table_privilege('anon', 'public.captured_notifications', 'select') then
    raise exception 'anon lê captured_notifications';
  end if;

  -- ai_events aceita kind capture
  perform 1 from pg_constraint
   where conname = 'ai_events_kind_check' and pg_get_constraintdef(oid) like '%capture%';
  if not found then raise exception 'ai_events_kind_check sem capture'; end if;

  -- gatilho de assinatura e realtime
  perform 1 from pg_trigger where tgname = 'a0_exige_assinatura'
     and tgrelid = 'public.captured_notifications'::regclass;
  if not found then raise exception 'sem a0_exige_assinatura'; end if;
  perform 1 from pg_publication_tables where pubname = 'supabase_realtime'
     and schemaname = 'public' and tablename = 'captured_notifications';
  if not found then raise exception 'fora do realtime'; end if;
end $$;
-- Um registro por captura: `lancar_da_captura` grava o lançamento (ou a compra parcelada, a série, o financiamento) e confirma a captura numa transação só,
-- repetir devolve o mesmo lançamento, e o vínculo (`transaction_id`) só vale dentro do espaço e confirmado.
do $$
declare
  u uuid := '00000000-0000-0000-0000-0000000cb001';
  w uuid := '00000000-0000-0000-0000-0000000cb002';
  outro uuid := '00000000-0000-0000-0000-0000000cb003';
  w2 uuid := '00000000-0000-0000-0000-0000000cb004';
  socio uuid := '00000000-0000-0000-0000-0000000cb005';
  c uuid; c2 uuid; c3 uuid; cd uuid; tx uuid; tx_alheia uuid; r jsonb; r2 jsonb; n int;
  cp uuid; cr uuid; cf uuid; cdup uuid; csv uuid; cfree uuid; tx2 uuid; plano_x uuid; banco uuid := '00000000-0000-0000-0000-0000000cb0a1';
  entrada jsonb := '{"kind":"expense","amount_cents":4590,"description":"captura mercado","occurred_at":"2026-10-12","status":"cleared"}';
begin
  insert into auth.users(id,email) values (u,'cb1@example.invalid'), (outro,'cb2@example.invalid'),
    (socio,'cb3@example.invalid') on conflict(id) do nothing;
  insert into public.profiles(id) values (u), (outro), (socio) on conflict(id) do nothing;
  -- o espaço mais antigo da pessoa é o padrão (`my_default_workspace`): é nele que o lançamento nasce
  insert into public.workspaces(id,owner_id,name,created_at) values (w,u,'Captura B','2000-01-01'), (w2,outro,'Outro B','2000-01-01');
  insert into public.workspace_members(workspace_id,user_id,role) values (w,u,'owner'), (w2,outro,'owner'), (w,socio,'member');
  insert into public.captured_notifications(workspace_id,user_id,external_id,bank,posted_at,texto,status,draft,kind,amount_cents)
  values (w,u,'ext-cb000001','Nubank',now(),'Compra de R$ 45,90','pending','{"tipo":"uma","params":{},"perguntas":[]}','expense',4590)
  returning id into c;
  insert into public.captured_notifications(workspace_id,user_id,external_id,bank,posted_at,texto,status,draft,kind,amount_cents)
  values (w,u,'ext-cb000002','Nubank',now(),'Compra de R$ 10,00','pending','{"tipo":"uma","params":{},"perguntas":[]}','expense',1000)
  returning id into c2;
  insert into public.captured_notifications(workspace_id,user_id,external_id,bank,posted_at,status)
  values (w,u,'ext-cb000003','Nubank',now(),'discarded') returning id into cd;
  insert into public.captured_notifications(workspace_id,user_id,external_id,bank,posted_at,texto,status,draft,kind,amount_cents)
  values (w,u,'ext-cb000004','Nubank',now(),'Compra','pending','{"tipo":"uma","params":{},"perguntas":[]}','expense',500)
  returning id into c3;
  insert into public.accounts(id,workspace_id,user_id,name,type,initial_balance_cents) values (banco,w,u,'Banco CB','checking',100000);
  insert into public.captured_notifications(workspace_id,user_id,external_id,bank,posted_at,texto,status,draft,kind,amount_cents)
  values (w,u,'ext-cb000011','Nubank',now(),'3x','pending','{"tipo":"uma","params":{},"perguntas":[]}','expense',60000) returning id into cp;
  insert into public.captured_notifications(workspace_id,user_id,external_id,bank,posted_at,texto,status,draft,kind,amount_cents)
  values (w,u,'ext-cb000012','Nubank',now(),'serie','pending','{"tipo":"uma","params":{},"perguntas":[]}','expense',9000) returning id into cr;
  insert into public.captured_notifications(workspace_id,user_id,external_id,bank,posted_at,texto,status,draft,kind,amount_cents)
  values (w,u,'ext-cb000013','Nubank',now(),'fin','pending','{"tipo":"uma","params":{},"perguntas":[]}','expense',9000) returning id into cf;
  insert into public.transactions(workspace_id,user_id,kind,amount_cents,description,occurred_at,status,source)
  values (w2,outro,'expense',100,'de outro espaço','2026-10-12','cleared','app') returning id into tx_alheia;

  insert into public.captured_notifications(workspace_id,user_id,external_id,bank,posted_at,texto,status,draft,kind,amount_cents)
  values (w,u,'ext-cb000021','Nubank',now(),'dup','duplicate','{"tipo":"uma","params":{},"perguntas":[]}','expense',777)
  returning id into cdup;
  insert into public.captured_notifications(workspace_id,user_id,external_id,bank,posted_at,status)
  values (w,u,'ext-cb000022','Nubank',now(),'confirmed') returning id into csv;  -- confirmada sem vínculo (APK antigo)
  insert into public.captured_notifications(workspace_id,user_id,external_id,bank,posted_at,texto,status,draft,kind,amount_cents)
  values (w,u,'ext-cb000023','Nubank',now(),'free','pending','{"tipo":"uma","params":{},"perguntas":[]}','expense',500)
  returning id into cfree;
  insert into public.transactions(workspace_id,user_id,kind,amount_cents,description,occurred_at,status,source)
  values (w,u,'expense',100,'outro lançamento','2026-10-12','cleared','app') returning id into tx2;

  perform set_config('request.jwt.claims', json_build_object('sub',u,'role','authenticated')::text, true);
  set local role authenticated;

  -- confirmar grava o lançamento E a captura de uma vez
  r := public.lancar_da_captura(c, 'lancamento', entrada, 0, gen_random_uuid());
  tx := (r->>'id')::uuid;
  if tx is null then raise exception 'sem id do lançamento'; end if;
  if (select status from public.captured_notifications where id = c) <> 'confirmed'
     or (select transaction_id from public.captured_notifications where id = c) is distinct from tx
     or (select texto from public.captured_notifications where id = c) is not null then
    raise exception 'captura não ficou confirmada, vinculada e sem texto';
  end if;

  -- repetir (outro request_id, até com dados editados) devolve o MESMO lançamento e não cria outro
  r2 := public.lancar_da_captura(c, 'lancamento', entrada || '{"amount_cents":9999}', 0, gen_random_uuid());
  if (r2->>'id')::uuid <> tx then raise exception 'segundo confirmar criou outro lançamento'; end if;
  select count(*) into n from public.transactions where description = 'captura mercado' and workspace_id = w;
  if n <> 1 then raise exception 'lançamentos da captura: % (esperado 1)', n; end if;

  -- os outros três tipos: a MESMA função de criação do formulário, na mesma transação da captura
  declare plano jsonb; serie jsonb; fin jsonb; dados jsonb;
  begin
    dados := jsonb_build_object('p_account_id',banco,'p_total_cents',60000,'p_installments',3,
      'p_occurred_at',current_date,'p_description','captura parcelada');
    plano := public.lancar_da_captura(cp, 'parcelada', dados, 0, gen_random_uuid());
    if (select installment_plan_id from public.captured_notifications where id = cp) is distinct from (plano->'ids'->>0)::uuid
       or (select status from public.captured_notifications where id = cp) <> 'confirmed' then
      raise exception 'parcelada não confirmou a captura com o plano';
    end if;
    r2 := public.lancar_da_captura(cp, 'parcelada', dados || '{"p_total_cents":1}', 0, gen_random_uuid());
    if (r2->'ids'->>0)::uuid <> (plano->'ids'->>0)::uuid then raise exception 'segunda parcelada criou outro plano'; end if;
    select count(*) into n from public.installment_plans where description = 'captura parcelada';
    if n <> 1 then raise exception 'planos: % (esperado 1)', n; end if;
    select count(*) into n from public.transactions where installment_plan_id = (plano->'ids'->>0)::uuid;
    if n <> 3 then raise exception 'parcelas: % (esperado 3)', n; end if;

    dados := jsonb_build_object('kind','expense','amount_cents',9000,'description','captura serie','account_id',banco,
      'rrule','FREQ=MONTHLY;BYMONTHDAY=5','next_run_at',(current_date+30)::timestamp at time zone 'America/Sao_Paulo',
      'dtstart',(current_date+30)::timestamp at time zone 'America/Sao_Paulo');
    serie := public.lancar_da_captura(cr, 'recorrente', dados, 0, gen_random_uuid());
    if (select recurring_id from public.captured_notifications where id = cr) is distinct from (serie->>'id')::uuid then
      raise exception 'série não ficou ligada à captura';
    end if;
    r2 := public.lancar_da_captura(cr, 'recorrente', dados || '{"amount_cents":1}', 0, gen_random_uuid());
    if (r2->>'id')::uuid <> (serie->>'id')::uuid then raise exception 'segunda série criou outra'; end if;
    select count(*) into n from public.recurring_transactions where description = 'captura serie';
    if n <> 1 then raise exception 'séries: % (esperado 1)', n; end if;

    dados := jsonb_build_object('name','captura financiamento','kind','financing','calculation_mode','fixed_installments',
      'principal_cents',100000,'remaining_cents',100000,'interest_rate_monthly',0,'installments',5,'installments_paid',0,
      'installment_cents',20000,'account_id',banco,'due_day',extract(day from current_date+10)::int,
      'first_due_date',current_date+10);
    fin := public.lancar_da_captura(cf, 'financiamento', dados, 0, gen_random_uuid());
    if (select debt_id from public.captured_notifications where id = cf) is distinct from (fin->'ids'->>0)::uuid then
      raise exception 'financiamento não ficou ligado à captura';
    end if;
    r2 := public.lancar_da_captura(cf, 'financiamento', dados || '{"name":"outro nome"}', 0, gen_random_uuid());
    if (r2->'ids'->>0)::uuid <> (fin->'ids'->>0)::uuid then raise exception 'segundo financiamento criou outra dívida'; end if;
    select count(*) into n from public.debts where name in ('captura financiamento', 'outro nome');
    if n <> 1 then raise exception 'dívidas: % (esperado 1)', n; end if;

    -- tipo inválido e vínculo duplo são recusados
    begin
      perform public.lancar_da_captura(c2, 'transferencia', entrada, 0, gen_random_uuid());
      raise exception 'tipo inválido passou';
    exception when raise_exception then
      if sqlerrm = 'tipo inválido passou' then raise; end if;
    end;
  end;

  -- captura em `duplicate` ("Lançar mesmo assim") também se lança
  r := public.lancar_da_captura(cdup, 'lancamento', entrada || '{"description":"captura duplicada lançada"}', 0, gen_random_uuid());
  if (select status from public.captured_notifications where id = cdup) <> 'confirmed'
     or (select transaction_id from public.captured_notifications where id = cdup) is distinct from (r->>'id')::uuid then
    raise exception 'captura duplicate não foi lançada';
  end if;

  r2 := public.lancar_da_captura(c, 'lancamento', entrada, 0, gen_random_uuid());
  -- o replay devolve o formato que o app lê: id, ids[0], tipo e ja_lancado
  if not (r2 ? 'id' and r2 ? 'ids' and r2 ? 'tipo' and (r2->>'ja_lancado')::boolean and r2->>'tipo' = 'lancamento'
          and (r2->'ids'->>0)::uuid = (r2->>'id')::uuid) then
    raise exception 'replay fora do formato {id, ids, tipo, ja_lancado}: %', r2;
  end if;

  -- replay com OUTRO tipo devolve o que existe (a parcelada), sem criar um lançamento
  r2 := public.lancar_da_captura(cp, 'lancamento', entrada || '{"description":"tipo diferente"}', 0, gen_random_uuid());
  if r2->>'tipo' <> 'parcelada' or (r2->>'id')::uuid <> (select installment_plan_id from public.captured_notifications where id = cp) then
    raise exception 'replay com outro tipo não devolveu o existente: %', r2;
  end if;
  select count(*) into n from public.transactions where description = 'tipo diferente';
  if n <> 0 then raise exception 'replay com outro tipo criou lançamento'; end if;

  -- confirmada SEM vínculo (APK antigo): recusa com a frase, sem criar nada
  begin
    perform public.lancar_da_captura(csv, 'lancamento', entrada || '{"description":"sem vinculo"}', 0, gen_random_uuid());
    raise exception 'lançou captura confirmada sem vínculo';
  exception when sqlstate 'PT409' then
    if sqlerrm <> 'Esta captura já foi resolvida' then raise exception 'frase inesperada: %', sqlerrm; end if;
  end;
  select count(*) into n from public.transactions where description = 'sem vinculo';
  if n <> 0 then raise exception 'criou lançamento para captura confirmada sem vínculo'; end if;

  -- vínculo: de NULL para um valor UMA vez. Trocar ou mover entre colunas é recusado
  begin
    update public.captured_notifications set transaction_id = tx2 where id = c;
    raise exception 'trocou o transaction_id de captura já vinculada';
  exception when sqlstate 'PT409' then null;
  end;
  select installment_plan_id into plano_x from public.captured_notifications where id = cp;
  begin
    update public.captured_notifications set transaction_id = tx2, installment_plan_id = null where id = cp;
    raise exception 'moveu o vínculo entre colunas';
  exception when sqlstate 'PT409' then null;
  end;
  if (select transaction_id from public.captured_notifications where id = c) is distinct from tx then
    raise exception 'a recusa mexeu no vínculo';
  end if;

  -- confirmada é terminal: não volta para pendente (trocar ou mover o vínculo já foi recusado acima)
  begin
    update public.captured_notifications set status = 'pending' where id = c;
    raise exception 'confirmada voltou a pendente';
  exception when sqlstate 'PT409' then null;
  end;

  -- o vínculo só vale em captura confirmada
  begin
    update public.captured_notifications set transaction_id = tx where id = c2;
    raise exception 'vínculo em captura pendente';
  exception when raise_exception then
    if sqlerrm = 'vínculo em captura pendente' then raise; end if;
  end;
  -- ... e para um lançamento que a pessoa enxerga (o de outro espaço nem é visível pela RLS)
  begin
    update public.captured_notifications set status = 'confirmed', texto = null, transaction_id = tx_alheia where id = c2;
    raise exception 'vínculo com lançamento de outro espaço';
  exception when raise_exception then
    if sqlerrm = 'vínculo com lançamento de outro espaço' then raise; end if;
  end;
  if (select status from public.captured_notifications where id = c2) <> 'pending' then
    raise exception 'a recusa do vínculo deixou a captura mudada';
  end if;

  -- descartada não se lança; a que não existe (ou é de outro) também não
  begin
    perform public.lancar_da_captura(cd, 'lancamento', entrada, 0, gen_random_uuid());
    raise exception 'lançou captura descartada';
  exception when sqlstate 'PT409' then null;
  end;
  reset role;

  -- o sócio do mesmo espaço não confirma a captura que é do outro
  perform set_config('request.jwt.claims', json_build_object('sub',socio,'role','authenticated')::text, true);
  set local role authenticated;
  begin
    perform public.lancar_da_captura(c3, 'lancamento', entrada, 0, gen_random_uuid());
    raise exception 'sócio lançou a captura de outra pessoa';
  exception when sqlstate 'PT409' then null;
  end;
  reset role;
  if (select status from public.captured_notifications where id = c3) <> 'pending' then
    raise exception 'captura do outro mudou';
  end if;
  select count(*) into n from public.transactions where workspace_id = w and installment_plan_id is null and description = 'captura mercado';
  if n <> 1 then raise exception 'lançamentos no espaço: % (esperado 1)', n; end if;

  -- apagar o lançamento solta o vínculo e a captura segue confirmada (não reabre)
  delete from public.transactions where id = tx;
  if (select status from public.captured_notifications where id = c) <> 'confirmed'
     or (select transaction_id from public.captured_notifications where id = c) is not null then
    raise exception 'apagar o lançamento reabriu ou manteve o vínculo';
  end if;

  -- sem assinatura (requisição do app, workspace free): PT402 e a captura não muda
  perform set_config('request.jwt.claims', json_build_object('sub',u,'role','authenticated')::text, true);
  perform set_config('proops.forcar_app', 'on', true);
  set local role authenticated;
  begin
    perform public.lancar_da_captura(cfree, 'lancamento', entrada || '{"description":"sem assinatura"}', 0, gen_random_uuid());
    raise exception 'lançou sem assinatura';
  exception when sqlstate 'PT402' then null;
  end;
  reset role;
  perform set_config('proops.forcar_app', 'off', true);
  if (select status from public.captured_notifications where id = cfree) <> 'pending'
     or (select count(*) from public.transactions where description = 'sem assinatura') <> 0 then
    raise exception 'a recusa por assinatura mudou a captura ou criou lançamento';
  end if;

  if has_function_privilege('anon', 'public.lancar_da_captura(uuid,text,jsonb,bigint,uuid)', 'execute') then
    raise exception 'anon executa lancar_da_captura';
  end if;
  if not has_function_privilege('authenticated', 'public.lancar_da_captura(uuid,text,jsonb,bigint,uuid)', 'execute') then
    raise exception 'authenticated não executa lancar_da_captura';
  end if;
  if has_function_privilege('anon', 'private.tg_captura_resolucao()', 'execute') then
    raise exception 'anon executa o gatilho de resolução';
  end if;
end $$;
rollback;
