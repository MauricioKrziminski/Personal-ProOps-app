\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';
do $$
declare
  u uuid:='00000000-0000-4000-8000-00000000f151';
  w uuid:='00000000-0000-4000-8000-00000000f152';
  u2 uuid:='00000000-0000-4000-8000-00000000f161';
  w2 uuid:='00000000-0000-4000-8000-00000000f162';
  bank uuid:='00000000-0000-4000-8000-00000000f153';
  card uuid:='00000000-0000-4000-8000-00000000f154';
  sub uuid:='00000000-0000-4000-8000-00000000f155';
  inv uuid:='00000000-0000-4000-8000-00000000f156';
  cf date:=current_date-10; ct date:=current_date;
  pf date:=current_date-40; pt date:=current_date-20;
  d text; r jsonb; s bigint;
begin
  insert into auth.users(id,email) values(u,'f15-a@example.invalid'),(u2,'f15-b@example.invalid');
  insert into public.profiles(id) values(u),(u2) on conflict do nothing;
  insert into public.workspaces(id,owner_id,name) values(w,u,'F15'),(w2,u2,'F15 outro');
  insert into public.workspace_members(workspace_id,user_id,role) values(w,u,'owner'),(w2,u2,'owner');
  insert into public.accounts(id,user_id,workspace_id,name,type) values(bank,u,w,'F15 banco','checking'),(card,u,w,'F15 cartão','credit_card');
  insert into public.subcategories(id,user_id,workspace_id,parent_category,name) values(sub,u,w,'alimentação','mercado');
  insert into public.card_invoices(id,workspace_id,user_id,account_id,reference_month,closing_date,due_date,status)
    values(inv,w,u,card,date_trunc('month',current_date)::date,current_date,current_date,'open');
  insert into public.transactions(user_id,workspace_id,kind,amount_cents,category,subcategory_id,payment_method,expense_pattern,expense_pattern_source,expense_necessity,expense_necessity_source,description,account_id,occurred_at,status)
  values
   (u,w,'expense',1000,'alimentação',sub,'pix','variable','explicit','essential','explicit','cur a',bank,cf,'cleared'),
   (u,w,'expense',500,'alimentação',null,null,null,null,null,null,'cur b',bank,cf,'pending'),
   (u,w,'expense',300,null,null,'debit','fixed','explicit','discretionary','explicit','cur sem categoria',bank,cf,'cleared'),
   (u,w,'expense',400,'lazer',null,'pix','variable','explicit','discretionary','explicit','prev lazer',bank,pf,'cleared'),
   (u,w,'expense',200,'alimentação',sub,'pix','variable','explicit','essential','explicit','prev a',bank,pf,'cleared'),
   (u,w,'expense',50,'',null,null,null,null,null,null,'cur vazia',bank,cf,'cleared'),
   (u,w,'income',9999,'salário',null,null,null,null,null,null,'receita',bank,cf,'cleared'),
   (u,w,'expense',7777,'alimentação',null,null,null,null,null,null,'prev grande',bank,pf,'cleared');
  -- fora da lente: transferência, pagamento de fatura, principal adiado
  insert into public.transactions(user_id,workspace_id,kind,amount_cents,category,description,account_id,counterparty_account_id,occurred_at,status,pays_invoice_id)
    values(u,w,'transfer',888,null,'pagamento fatura',bank,card,cf,'cleared',inv),(u,w,'transfer',889,null,'transf',bank,card,cf,'cleared',null);
  insert into public.transactions(user_id,workspace_id,kind,amount_cents,category,description,account_id,occurred_at,status,rollover_of_invoice_id)
    values(u,w,'expense',777,'alimentação','adiado',card,cf,'pending',inv);
  insert into public.transactions(user_id,workspace_id,kind,amount_cents,category,description,account_id,occurred_at,status)
    values(u2,w2,'expense',123456,'alimentação','outro espaço',null,cf,'cleared');
  -- o item de 7777 em pf é despesa mesmo: ajusta o esperado abaixo
  perform set_config('request.jwt.claim.sub',u::text,true);
  perform set_config('role','authenticated',true);
  foreach d in array array['category','subcategory','payment_method','pattern','necessity'] loop
    r:=public.spending_change(cf,ct,pf,pt,d);
    assert r->>'current_cents'='1850' and r->>'previous_cents'='8377' and r->>'delta_cents'='-6527', d||' totais '||r::text;
    select sum((x->>'delta_cents')::bigint) into s from jsonb_array_elements(r->'rows') x;
    assert s=(r->>'delta_cents')::bigint, d||' soma != delta';
    assert (r->>'percent_bp')::int=round(-6527*10000.0/8377), d||' percent';
    assert (select (x->>'delta_cents')::bigint from jsonb_array_elements(r->'rows') x limit 1)
      = (select min((x->>'delta_cents')::bigint) from jsonb_array_elements(r->'rows') x), d||' ordem por |delta|';
  end loop;
  r:=public.spending_change(cf,ct,pf,pt,'category');
  assert exists(select 1 from jsonb_array_elements(r->'rows') x where x->>'key' is null and x->>'label'='Sem categoria' and x->>'current_cents'='350'),'chave nula categoria';
  assert (select x->>'current_cents' from jsonb_array_elements(r->'rows') x where x->>'key'='alimentação')='1500','alimentação atual (sem adiado)';
  assert (select x->>'label' from jsonb_array_elements(public.spending_change(cf,ct,pf,pt,'subcategory')->'rows') x where x->>'key' is null)='Sem detalhe';
  assert (select x->>'label' from jsonb_array_elements(public.spending_change(cf,ct,pf,pt,'payment_method')->'rows') x where x->>'key' is null)='Não informado';
  assert (select x->>'label' from jsonb_array_elements(public.spending_change(cf,ct,pf,pt,'subcategory')->'rows') x where x->>'key'=sub::text)='alimentação · mercado';
  -- anterior zero: percentual nulo e total fecha
  r:=public.spending_change(cf,ct,current_date-300,current_date-290,'category');
  assert r->'percent_bp'='null'::jsonb and r->>'previous_cents'='0' and r->>'delta_cents'='1850','anterior zero';
  -- sem dados nenhum
  r:=public.spending_change(current_date+100,current_date+110,current_date+200,current_date+210,'category');
  assert r->>'delta_cents'='0' and jsonb_array_length(r->'rows')=0,'vazio';
  -- período inválido
  begin perform public.spending_change(ct,cf,pf,pt,'category'); raise exception 'aceitou from>to';
  exception when sqlstate 'P0001' then null; end;
  begin perform public.spending_change(current_date-500,ct,pf,pt,'category'); raise exception 'aceitou >400';
  exception when sqlstate 'P0001' then null; end;
  begin perform public.spending_change(cf,ct,pf,pt,'x'); raise exception 'aceitou dimensão';
  exception when sqlstate 'P0001' then null; end;
  -- isolamento: o outro usuário só vê o dele
  perform set_config('request.jwt.claim.sub',u2::text,true);
  assert public.spending_change(cf,ct,pf,pt,'category')->>'current_cents'='123456','isolamento';
  -- sem login
  perform set_config('request.jwt.claim.sub','',true);
  begin perform public.spending_change(cf,ct,pf,pt,'category'); raise exception 'aceitou sem login';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
