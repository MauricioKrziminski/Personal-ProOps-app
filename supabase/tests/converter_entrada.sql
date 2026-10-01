-- Conversão futura conserva a entrada histórica, mesmo quando o plano se desfaz.
-- Executar antes da migration (RED), depois dela (GREEN); todas as fixtures usam rollback.
-- agent/.venv/bin/python scripts/sql-test.py supabase/tests/converter_entrada.sql
\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000e0a1', true);
do $$
declare
  u uuid := auth.uid(); other_u uuid := '00000000-0000-0000-0000-00000000e0a2';
  w uuid; a uuid; e uuid; c uuid; foreign_w uuid; foreign_a uuid; foreign_p uuid; foreign_e uuid;
begin
  insert into auth.users(id,email) values(u,'converter-entrada@example.invalid') on conflict(id) do nothing;
  insert into public.profiles(id) values(u) on conflict(id) do nothing;
  w := public.my_default_workspace();
  if w is null then
    insert into public.workspaces(name,owner_id) values('converter entrada',u) returning id into w;
    insert into public.workspace_members(workspace_id,user_id,role) values(w,u,'owner');
  end if;
  insert into public.accounts(workspace_id,user_id,name,type) values(w,u,'Parcelas QA','checking') returning id into a;
  insert into public.accounts(workspace_id,user_id,name,type) values(w,u,'Entrada QA','cash') returning id into e;
  insert into public.accounts(workspace_id,user_id,name,type,closing_day,due_day,credit_limit_cents,payment_account_id)
    values(w,u,'Cartão entrada QA','credit_card',5,12,500000,a) returning id into c;
  perform set_config('test.ce.account',a::text,true);
  perform set_config('test.ce.entry_account',e::text,true);
  perform set_config('test.ce.card',c::text,true);
  insert into auth.users(id,email) values(other_u,'converter-entrada-foreign@example.invalid') on conflict(id) do nothing;
  insert into public.profiles(id) values(other_u) on conflict(id) do nothing;
  insert into public.workspaces(name,owner_id) values('CE outro workspace',other_u) returning id into foreign_w;
  insert into public.workspace_members(workspace_id,user_id,role) values(foreign_w,other_u,'owner');
  insert into public.accounts(workspace_id,user_id,name,type) values(foreign_w,other_u,'CE foreign','cash') returning id into foreign_a;
  insert into public.installment_plans(workspace_id,user_id,account_id,total_cents,installments,first_occurred_at)
    values(foreign_w,other_u,foreign_a,20000,2,current_date+10) returning id into foreign_p;
  insert into public.transactions(workspace_id,user_id,kind,amount_cents,account_id,occurred_at,status,source,down_payment_plan_id)
    values(foreign_w,other_u,'expense',12345,foreign_a,current_date-2,'cleared','app',foreign_p) returning id into foreign_e;
  perform set_config('test.ce.foreign_plan',foreign_p::text,true);
  perform set_config('test.ce.foreign_entry',foreign_e::text,true);
end $$;

create function pg_temp.ce_must_fail(q text) returns void language plpgsql as $$
declare refused boolean := false;
begin
  begin execute q; exception when others then refused := true; end;
  if not refused then raise exception 'Era para recusar: %',q; end if;
end $$;

set local role authenticated;
do $$
declare
  a uuid := current_setting('test.ce.account')::uuid;
  ea uuid := current_setting('test.ce.entry_account')::uuid;
  data jsonb; entry jsonb; result jsonb; target jsonb; origin jsonb;
  p uuid; e uuid; tx uuid; destination_id uuid; before_entry public.transactions;
  retained int; scope text; destination text; origin_type text; with_entry boolean;
  label text; n int; cases int := 0;
begin
  -- 108 combinações: plano/parcela × 0/1/2 pagas × futuro/todas/manter × 3 destinos × com/sem entrada.
  foreach origin_type in array array['plano','transacao'] loop
    foreach retained in array array[0,1,2] loop
      foreach scope in array array['desta_em_diante','todas','manter'] loop
        foreach destination in array array['lancamento','recorrente','financiamento'] loop
          foreach with_entry in array array[true,false] loop
            cases := cases + 1;
            label := 'CE '||cases;
            data := jsonb_build_object('p_account_id',a,'p_total_cents',100000,'p_installments',5,
              'p_paid_installments',retained,'p_occurred_at',current_date-60,
              'p_description',label,'p_category','casa','p_merchant','Loja QA');
            entry := case when with_entry then jsonb_build_object('amount_cents',12345,
              'account_id',ea,'occurred_at',current_date-2) else null end;
            result := public.create_purchase('parcelada',data,entry,gen_random_uuid());
            p := (result->'ids'->>0)::uuid;
            e := (result->>'down_payment_id')::uuid;
            before_entry := null;
            if with_entry then
              select * into strict before_entry from public.transactions where id=e;
              -- A correção não abre a reassociação do vínculo para o cliente.
              perform pg_temp.ce_must_fail(format('update public.transactions set down_payment_plan_id=null where id=%L',e));
            end if;
            select id into strict tx from public.transactions where installment_plan_id=p and installment_no=retained+1;
            origin := jsonb_build_object('tipo',origin_type,'id',case when origin_type='plano' then p else tx end);
            target := case destination
              when 'lancamento' then jsonb_build_object('linhas',jsonb_build_array(jsonb_build_object(
                'kind','expense','amount_cents',20000,'description',label||' destino','account_id',a,
                'occurred_at',current_date+10,'due_at',current_date+10,'status','pending','source','app')))
              when 'recorrente' then jsonb_build_object('kind','expense','amount_cents',20000,
                'description',label||' destino','account_id',a,'rrule','FREQ=MONTHLY',
                'dtstart',(current_date+10)::timestamp at time zone 'America/Sao_Paulo',
                'next_run_at',(current_date+10)::timestamp at time zone 'America/Sao_Paulo','auto_confirm',false)
              else jsonb_build_object('name',label||' destino','kind','financing','calculation_mode','fixed_installments',
                'principal_cents',100000,'remaining_cents',100000,'interest_rate_monthly',0,
                'installments',5,'installments_paid',0,'installment_cents',20000,'account_id',a,
                'due_day',extract(day from current_date+10)::int,'first_due_date',current_date+10)
            end;
            result := public.converter_registro(origin,scope,jsonb_build_object('tipo',destination,'dados',target));
            destination_id := (result->'ids'->>0)::uuid;
            if destination_id is null then raise exception '%: destino ausente',label; end if;

            if with_entry and scope <> 'todas' then
              if not exists(select 1 from public.transactions t where t.id=e
                and t.amount_cents=before_entry.amount_cents and t.occurred_at=before_entry.occurred_at
                and t.account_id=before_entry.account_id and t.status=before_entry.status
                and t.invoice_id is not distinct from before_entry.invoice_id
                and t.due_at is not distinct from before_entry.due_at
                and t.paid_at is not distinct from before_entry.paid_at
                and t.description=before_entry.description and t.category=before_entry.category
                and t.merchant=before_entry.merchant and t.source=before_entry.source
                and t.workspace_id=before_entry.workspace_id and t.user_id=before_entry.user_id
                and t.created_at=before_entry.created_at
                and t.installment_plan_id is null and t.debt_id is null and t.recurring_id is null
                and t.down_payment_debt_id is null
                and t.down_payment_plan_id is not distinct from
                  case when scope='desta_em_diante' and retained<2 then null::uuid else p end) then
                raise exception 'RED %: entrada histórica perdida/alterada (% → %, pagas %, alcance %)',
                  label,origin_type,destination,retained,scope;
              end if;
              if (select count(*) from public.transactions where description=before_entry.description) <> 1 then
                raise exception '%: entrada duplicada',label;
              end if;
            elsif with_entry and exists(select 1 from public.transactions where id=e) then
              raise exception '%: todas deveria apagar a entrada deliberadamente',label;
            elsif not with_entry and exists(select 1 from public.transactions where description='Entrada · '||label) then
              raise exception '%: controle sem entrada ganhou movimento',label;
            end if;

            if scope='manter' then
              if not exists(select 1 from public.installment_plans where id=p)
                or (select count(*) from public.transactions where installment_plan_id=p)<>5 then
                raise exception '%: manter alterou origem',label;
              end if;
            elsif scope='todas' or retained<2 then
              if exists(select 1 from public.installment_plans where id=p) then raise exception '%: plano não saiu',label; end if;
              if scope='desta_em_diante' and retained=1 and not exists(select 1 from public.transactions
                where description=label||' (1/5)' and installment_plan_id is null and status='cleared') then
                raise exception '%: parcela histórica não foi preservada como avulsa',label;
              end if;
            elsif not exists(select 1 from public.installment_plans where id=p and installments=retained and total_cents=retained*20000) then
              raise exception '%: contrato histórico não foi preservado',label;
            end if;
          end loop;
        end loop;
      end loop;
    end loop;
  end loop;
  raise notice 'PASS: % conversões entrada/plano/parcela, 0/1/2 históricas, futuro/todas/manter, 3 destinos e controle sem entrada',cases;
end $$;

-- Uma entrada em cartão/conta arquivada continua histórica; não recalcular sua fatura ao preservar.
do $$
declare
  a uuid := current_setting('test.ce.account')::uuid;
  c uuid := current_setting('test.ce.card')::uuid;
  ea uuid := current_setting('test.ce.entry_account')::uuid;
  entry_account uuid; result jsonb; p uuid; e uuid; old_entry public.transactions;
begin
  foreach entry_account in array array[c,ea] loop
    result := public.create_purchase('parcelada',jsonb_build_object('p_account_id',a,'p_total_cents',100000,
      'p_installments',5,'p_paid_installments',0,'p_occurred_at',current_date+10,'p_description','CE histórico '||entry_account),
      jsonb_build_object('amount_cents',12345,'account_id',entry_account,'occurred_at',current_date-2),gen_random_uuid());
    p := (result->'ids'->>0)::uuid; e := (result->>'down_payment_id')::uuid;
    select * into strict old_entry from public.transactions where id=e;
    update public.accounts set archived=true where id=entry_account;
    -- Destino inválido: exceção desfaz também a preservação/corte da origem.
    perform pg_temp.ce_must_fail(format('select public.converter_registro(%L::jsonb,%L,%L::jsonb)',
      jsonb_build_object('tipo','plano','id',p),'desta_em_diante',jsonb_build_object('tipo','invalido','dados','{}'::jsonb)));
    if not exists(select 1 from public.transactions where id=e and down_payment_plan_id=p)
      or not exists(select 1 from public.installment_plans where id=p) then
      raise exception 'Falha de destino deixou corte parcial da origem';
    end if;
    perform public.converter_registro(jsonb_build_object('tipo','plano','id',p),'desta_em_diante',
      jsonb_build_object('tipo','lancamento','dados',jsonb_build_object('linhas',jsonb_build_array(jsonb_build_object(
        'kind','expense','amount_cents',20000,'account_id',a,'occurred_at',current_date+10,'status','pending','source','app')))));
    if not exists(select 1 from public.transactions where id=e and amount_cents=old_entry.amount_cents
      and occurred_at=old_entry.occurred_at and account_id=old_entry.account_id
      and invoice_id is not distinct from old_entry.invoice_id and due_at is not distinct from old_entry.due_at
      and status=old_entry.status and paid_at is not distinct from old_entry.paid_at and down_payment_plan_id is null) then
      raise exception 'Entrada de cartão/conta arquivada perdeu fato ou mudou fatura';
    end if;
  end loop;
  raise notice 'PASS: entrada histórica em cartão/conta arquivada e falha atômica';
end $$;

-- Nenhum set_config do cliente libera o vínculo; excluir tudo usa a RPC, até com plano vazio.
do $$
declare
  a uuid := current_setting('test.ce.account')::uuid;
  ea uuid := current_setting('test.ce.entry_account')::uuid;
  c uuid := current_setting('test.ce.card')::uuid;
  result jsonb; p uuid; e uuid; inv uuid; next_inv uuid; survivor uuid; old_entry public.transactions;
  mode text; empty boolean; invoice_state text; before_rows int; before_plans int;
begin
  update public.accounts set archived=false where id in(ea,c);
  foreach empty in array array[false,true] loop
    foreach mode in array array['raw','rpc','todas'] loop
      result := public.create_purchase('parcelada',jsonb_build_object('p_account_id',a,'p_total_cents',100000,
        'p_installments',5,'p_paid_installments',0,'p_occurred_at',current_date+10,'p_description','CE delete '||mode||empty),
        jsonb_build_object('amount_cents',12345,'account_id',ea,'occurred_at',current_date-2),gen_random_uuid());
      p := (result->'ids'->>0)::uuid; e := (result->>'down_payment_id')::uuid;
      select * into strict old_entry from public.transactions where id=e;
      if empty then delete from public.transactions where installment_plan_id=p; end if;
      perform set_config('proops.preservando_entrada_plano',p::text,true); -- antigo mecanismo não existe mais
      perform pg_temp.ce_must_fail(format('update public.transactions set down_payment_plan_id=null where id=%L',e));
      if mode='raw' then
        delete from public.installment_plans where id=p;
      elsif mode='rpc' then
        if public.delete_installment_purchase(p)<>1 or public.delete_installment_purchase(p)<>0 then
          raise exception 'RPC delete não foi idempotente (vazio %)',empty;
        end if;
      else
        perform public.converter_registro(jsonb_build_object('tipo','plano','id',p),'todas',
          jsonb_build_object('tipo','lancamento','dados',jsonb_build_object('linhas',jsonb_build_array(jsonb_build_object(
            'kind','expense','amount_cents',20000,'account_id',a,'occurred_at',current_date+10,'status','pending','source','app')))));
      end if;
      if mode='raw' and empty then
        if not exists(select 1 from public.transactions where id=e and down_payment_plan_id is null
          and (to_jsonb(transactions)-'down_payment_plan_id'-'edit_revision')=(to_jsonb(old_entry)-'down_payment_plan_id'-'edit_revision')) then
          raise exception 'DELETE de plano esvaziado manualmente não preservou histórico';
        end if;
      elsif exists(select 1 from public.transactions where id=e) then
        raise exception 'Exclusão completa manteve entrada (modo %, vazio %)',mode,empty;
      end if;
      if exists(select 1 from public.installment_plans where id=p)
        or exists(select 1 from public.transactions where installment_plan_id=p) then raise exception 'DELETE deixou plano/parcela'; end if;
    end loop;
  end loop;
  perform set_config('proops.preservando_entrada_plano','',true);
  if public.delete_installment_purchase(current_setting('test.ce.foreign_plan')::uuid)<>0 then
    raise exception 'RPC delete alcançou outro workspace';
  end if;

  -- Voltar de 5x para 1x é desfazer o contrato, não apagar a entrada já realizada.
  result := public.create_purchase('parcelada',jsonb_build_object('p_account_id',a,'p_total_cents',100000,
    'p_installments',5,'p_paid_installments',0,'p_occurred_at',current_date+10,'p_description','CE desfazer 1x'),
    jsonb_build_object('amount_cents',12345,'account_id',ea,'occurred_at',current_date-2),gen_random_uuid());
  p := (result->'ids'->>0)::uuid; e := (result->>'down_payment_id')::uuid;
  select * into strict old_entry from public.transactions where id=e;
  select id into strict survivor from public.transactions where installment_plan_id=p and installment_no=1;
  perform public.update_installment_plan(p,100000,1,current_date+10,'CE desfazer 1x','casa','Loja',a,0);
  if exists(select 1 from public.installment_plans where id=p)
    or not exists(select 1 from public.transactions where id=survivor and installment_plan_id is null and amount_cents=100000)
    or not exists(select 1 from public.transactions where id=e and down_payment_plan_id is null
      and (to_jsonb(transactions)-'down_payment_plan_id'-'edit_revision')=(to_jsonb(old_entry)-'down_payment_plan_id'-'edit_revision')) then
    raise exception 'Desfazer para 1x perdeu/alterou entrada ou sobrevivente';
  end if;

  -- Entrada numa fatura fechada: exclusão completa e todas recusam sem resíduo.
  foreach invoice_state in array array['paid','rolled','partial'] loop
    result := public.create_purchase('parcelada',jsonb_build_object('p_account_id',a,'p_total_cents',100000,
      'p_installments',5,'p_paid_installments',0,'p_occurred_at',current_date+10,'p_description','CE fatura '||invoice_state),
      jsonb_build_object('amount_cents',12345,'account_id',c,'occurred_at',current_date-2),gen_random_uuid());
    p := (result->'ids'->>0)::uuid; e := (result->>'down_payment_id')::uuid;
    select invoice_id into strict inv from public.transactions where id=e;
    next_inv := null;
    if invoice_state='rolled' then
      insert into public.card_invoices(workspace_id,user_id,account_id,reference_month,closing_date,due_date)
        select workspace_id,user_id,account_id,(reference_month+interval '1 month')::date,
          (closing_date+interval '1 month')::date,(due_date+interval '1 month')::date
          from public.card_invoices where id=inv
        on conflict(account_id,reference_month) do nothing;
      select later.id into strict next_inv from public.card_invoices earlier join public.card_invoices later
        on later.account_id=earlier.account_id and later.reference_month=(earlier.reference_month+interval '1 month')::date
        where earlier.id=inv;
    end if;
    update public.card_invoices set status=case when invoice_state='partial' then 'open' else invoice_state end,
      paid_cents=case when invoice_state='partial' then 1 else 0 end,rolled_into_invoice_id=next_inv where id=inv;
    select count(*) into before_rows from public.transactions;
    select count(*) into before_plans from public.installment_plans;
    perform pg_temp.ce_must_fail(format('select public.delete_installment_purchase(%L)',p));
    perform pg_temp.ce_must_fail(format('select public.converter_registro(%L::jsonb,%L,%L::jsonb)',
      jsonb_build_object('tipo','plano','id',p),'todas',jsonb_build_object('tipo','lancamento','dados',jsonb_build_object(
        'linhas',jsonb_build_array(jsonb_build_object('kind','expense','amount_cents',1,'account_id',a,'occurred_at',current_date,'status','cleared','source','app'))))));
    if (select count(*) from public.transactions)<>before_rows or (select count(*) from public.installment_plans)<>before_plans
      or not exists(select 1 from public.transactions where id=e and down_payment_plan_id=p and invoice_id=inv) then
      raise exception 'Recusa de fatura % deixou alteração parcial',invoice_state;
    end if;
    -- Converter só o futuro deve conservar a entrada na fatura exata, mesmo adiada.
    select * into strict old_entry from public.transactions where id=e;
    perform public.converter_registro(jsonb_build_object('tipo','plano','id',p),'desta_em_diante',
      jsonb_build_object('tipo','lancamento','dados',jsonb_build_object('linhas',jsonb_build_array(jsonb_build_object(
        'kind','expense','amount_cents',1,'account_id',a,'occurred_at',current_date+10,'status','pending','source','app')))));
    if not exists(select 1 from public.transactions where id=e and down_payment_plan_id is null
      and (to_jsonb(transactions)-'down_payment_plan_id'-'edit_revision')=(to_jsonb(old_entry)-'down_payment_plan_id'-'edit_revision')) then
      raise exception 'Preservação de entrada em fatura % modificou fato/fatura',invoice_state;
    end if;
    update public.card_invoices set status='open',paid_cents=0,rolled_into_invoice_id=null where id=inv;
  end loop;
  raise notice 'PASS: guarda sem GUC, DELETE comum/vazio, exclusão completa/todas, RLS/idempotência, desfazer 1x e fatura paga/adiada/parcial';
end $$;

-- Financiamento com entrada: somente todas apaga o fato histórico; futuro arquiva, manter não altera.
do $$
declare
  a uuid := current_setting('test.ce.account')::uuid;
  ea uuid := current_setting('test.ce.entry_account')::uuid;
  result jsonb; target jsonb; d uuid; e uuid; old_entry public.transactions;
  paid int; i int; scope text; destination text; label text; cases int := 0;
begin
  update public.accounts set archived=false where id=ea;
  foreach paid in array array[0,1,2] loop
    foreach scope in array array['desta_em_diante','todas','manter'] loop
      foreach destination in array array['lancamento','recorrente','parcelada'] loop
        cases := cases+1; label := 'CE dívida '||cases;
        result := public.create_purchase('financiamento',jsonb_build_object('name',label,
          'kind','financing','calculation_mode','fixed_installments','principal_cents',100000,
          'remaining_cents',100000,'interest_rate_monthly',0,'installments',5,'installments_paid',0,
          'installment_cents',20000,'account_id',a,'due_day',extract(day from current_date+10)::int,
          'first_due_date',current_date+10),
          jsonb_build_object('amount_cents',12345,'account_id',ea,'occurred_at',current_date-2),gen_random_uuid());
        d := (result->'ids'->>0)::uuid; e := (result->>'down_payment_id')::uuid;
        select * into strict old_entry from public.transactions where id=e;
        for i in 1..paid loop perform public.pay_debt_installment(d,20000,a,current_date-30+i); end loop;
        target := case destination
          when 'lancamento' then jsonb_build_object('linhas',jsonb_build_array(jsonb_build_object(
            'kind','expense','amount_cents',20000,'description',label||' destino','account_id',a,
            'occurred_at',current_date+10,'status','pending','source','app')))
          when 'recorrente' then jsonb_build_object('kind','expense','amount_cents',20000,
            'description',label||' destino','account_id',a,'rrule','FREQ=MONTHLY',
            'dtstart',(current_date+10)::timestamp at time zone 'America/Sao_Paulo',
            'next_run_at',(current_date+10)::timestamp at time zone 'America/Sao_Paulo','auto_confirm',false)
          else jsonb_build_object('p_account_id',a,'p_total_cents',100000,'p_installments',5,
            'p_paid_installments',0,'p_occurred_at',current_date+10,'p_description',label||' destino')
        end;
        result := public.converter_registro(jsonb_build_object('tipo','divida','id',d),scope,
          jsonb_build_object('tipo',destination,'dados',target));
        if (result->'ids'->>0) is null then raise exception '%: destino ausente',label; end if;
        if scope='todas' then
          if exists(select 1 from public.debts where id=d) or exists(select 1 from public.transactions where id=e or debt_id=d) then
            raise exception '%: todas deixou entrada, dívida ou pagamento',label;
          end if;
        else
          if not exists(select 1 from public.transactions where id=e and to_jsonb(transactions)=to_jsonb(old_entry)) then
            raise exception '%: % alterou entrada histórica',label,scope;
          end if;
          if (select count(*) from public.transactions where debt_id=d)<>paid
            or not exists(select 1 from public.debts where id=d and installments_paid=paid
              and remaining_cents=100000-paid*20000 and archived=(scope='desta_em_diante')) then
            raise exception '%: contrato/pagamentos da origem divergiram',label;
          end if;
          if (select count(*) from public.transactions where down_payment_debt_id=d)<>1 then raise exception '%: entrada duplicada',label; end if;
        end if;
      end loop;
    end loop;
  end loop;
  raise notice 'PASS: % financiamento+entrada → avulsa/recorrente/parcelada, futuro/todas/manter, 0/1/2 pagamentos',cases;
end $$;

-- Avulsa e recorrente → financiamento+entrada: entrada não vira prestação nem duplica histórico.
do $$
declare
  a uuid := current_setting('test.ce.account')::uuid;
  ea uuid := current_setting('test.ce.entry_account')::uuid;
  origin_type text; scope text; source_status text; label text;
  origin jsonb; target jsonb; result jsonb; tx uuid; series uuid; d uuid; e uuid;
  scopes text[]; expected_paid int; cases int := 0;
begin
  foreach origin_type in array array['avulsa','serie','ocorrencia'] loop
    scopes := case origin_type when 'avulsa' then array['converter','manter']
      when 'serie' then array['desta_em_diante','todas','manter']
      else array['so_esta','desta_em_diante','todas','manter'] end;
    foreach scope in array scopes loop
      foreach source_status in array array['cleared','pending'] loop
        cases := cases+1; label := 'CE reversa '||cases; series := null;
        if origin_type<>'avulsa' then
          insert into public.recurring_transactions(user_id,kind,amount_cents,description,account_id,rrule,dtstart,next_run_at,auto_confirm)
            values(auth.uid(),'expense',20000,label,a,'FREQ=MONTHLY',
              (current_date-2)::timestamp at time zone 'America/Sao_Paulo',
              (current_date+28)::timestamp at time zone 'America/Sao_Paulo',false) returning id into series;
        end if;
        insert into public.transactions(user_id,kind,amount_cents,description,account_id,occurred_at,due_at,status,source,recurring_id)
          values(auth.uid(),'expense',20000,label,a,current_date-2,current_date-2,source_status,'app',series) returning id into tx;
        origin := jsonb_build_object('tipo',case when origin_type='serie' then 'serie' else 'transacao' end,
          'id',case when origin_type='serie' then series else tx end);
        target := jsonb_build_object('name',label||' destino','kind','financing','calculation_mode','fixed_installments',
          'principal_cents',100000,'remaining_cents',100000,'interest_rate_monthly',0,'installments',5,
          'installments_paid',0,'installment_cents',20000,'account_id',a,
          'due_day',extract(day from current_date+10)::int,'first_due_date',current_date+10,
          'down_payment',jsonb_build_object('amount_cents',12345,'account_id',ea,'occurred_at',current_date-1));
        result := public.converter_registro(origin,scope,jsonb_build_object('tipo','financiamento','dados',target));
        d := (result->'ids'->>0)::uuid; e := (result->>'down_payment_id')::uuid;
        expected_paid := case when scope in('converter','so_esta') and source_status='cleared' then 1 else 0 end;
        if not exists(select 1 from public.debts where id=d and installments_paid=expected_paid
          and principal_cents=100000 and remaining_cents=100000-expected_paid*20000)
          or (select count(*) from public.transactions where debt_id=d)<>expected_paid then
          raise exception '%: adoção da origem/contagem de prestações divergiram',label;
        end if;
        if not exists(select 1 from public.transactions where id=e and down_payment_debt_id=d
          and down_payment_plan_id is null and installment_plan_id is null and debt_id is null
          and recurring_id is null and amount_cents=12345 and account_id=ea and occurred_at=current_date-1 and status='cleared')
          or (select count(*) from public.transactions where down_payment_debt_id=d)<>1 then
          raise exception '%: entrada independente ausente/duplicada',label;
        end if;
        if expected_paid=1 and not exists(select 1 from public.transactions where id=tx and debt_id=d and amount_cents=20000) then
          raise exception '%: pagamento adotado perdeu identidade',label;
        end if;
        if scope='manter' and not exists(select 1 from public.transactions where id=tx and status=source_status
          and recurring_id is not distinct from series and debt_id is null) then raise exception '%: manter alterou origem',label; end if;
        if scope='todas' and exists(select 1 from public.transactions where id=tx) then raise exception '%: todas manteve ocorrência',label; end if;
        if scope='desta_em_diante' and not exists(select 1 from public.recurring_transactions where id=series and end_date is not null) then
          raise exception '%: futuro não encerrou série',label;
        end if;
      end loop;
    end loop;
  end loop;
  raise notice 'PASS: % avulsa/recorrente → financiamento+entrada, paga/pendente, todos os alcances válidos',cases;
end $$;
reset role;
do $$ begin
  if not exists(select 1 from public.installment_plans where id=current_setting('test.ce.foreign_plan')::uuid)
    or not exists(select 1 from public.transactions where id=current_setting('test.ce.foreign_entry')::uuid
      and down_payment_plan_id=current_setting('test.ce.foreign_plan')::uuid) then
    raise exception 'Exclusão RLS modificou workspace alheio';
  end if;
end $$;
rollback;
