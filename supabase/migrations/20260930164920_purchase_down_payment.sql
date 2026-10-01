-- A entrada e um fato de caixa, nunca uma prestacao/amortizacao do contrato.
alter table public.transactions
  add column if not exists down_payment_debt_id uuid references public.debts(id) on delete cascade,
  add column if not exists down_payment_plan_id uuid references public.installment_plans(id) on delete cascade;
create unique index if not exists transactions_one_down_payment_debt
  on public.transactions(down_payment_debt_id) where down_payment_debt_id is not null;
create unique index if not exists transactions_one_down_payment_plan
  on public.transactions(down_payment_plan_id) where down_payment_plan_id is not null;

-- O lookup privilegiado so confere integridade, inclusive para escritores que ignoram RLS.
-- RLS das tabelas continua decidindo quem pode gravar/ler cada workspace.
create or replace function private.guard_purchase_down_payment()
returns trigger language plpgsql security definer set search_path = ''
set timezone to 'America/Sao_Paulo' as $$
declare parent_workspace uuid; account_workspace uuid; account_type text; account_archived boolean;
  valid_card_invoice boolean;
begin
  if tg_op = 'UPDATE' and
    (new.down_payment_debt_id is distinct from old.down_payment_debt_id
     or new.down_payment_plan_id is distinct from old.down_payment_plan_id) then
    raise exception 'O vínculo da entrada não pode ser alterado: apague e registre uma nova entrada';
  end if;
  if new.down_payment_debt_id is null and new.down_payment_plan_id is null then return new; end if;
  select a.workspace_id,a.type,a.archived into account_workspace,account_type,account_archived
    from public.accounts a where a.id=new.account_id for share;
  -- Arquivar uma conta conserva seu historico e o fluxo das faturas existentes.
  -- Nova entrada ou troca de conta/espaco continua exigindo conta ativa.
  if account_archived and (tg_op <> 'UPDATE' or new.account_id is distinct from old.account_id
    or new.workspace_id is distinct from old.workspace_id) then
    raise exception 'Escolha uma conta ativa para registrar ou mover a entrada';
  end if;
  valid_card_invoice := account_type='credit_card' and new.invoice_id is not null and exists(
    select 1 from public.card_invoices i where i.id=new.invoice_id and i.account_id=new.account_id
      and i.workspace_id=new.workspace_id);
  if (new.down_payment_debt_id is not null and new.down_payment_plan_id is not null)
    or new.debt_id is not null or new.installment_plan_id is not null or new.recurring_id is not null
    or new.installment_no is not null or new.debt_payment_no is not null
    or new.debt_principal_cents is not null or new.debt_interest_cents is not null
    or new.debt_balance_after_cents is not null or new.counterparty_account_id is not null
    or new.kind is distinct from 'expense'
    -- A compra no cartao ja aconteceu; pagar/desfazer a fatura governa o estado de caixa dela.
    or (new.status is distinct from 'cleared' and not(coalesce(valid_card_invoice,false) and new.status='pending'))
    or (account_type='credit_card' and not coalesce(valid_card_invoice,false))
    or (account_type<>'credit_card' and new.invoice_id is not null)
    or new.amount_cents is null or new.amount_cents <= 0
    or new.occurred_at is null or new.occurred_at > current_date then
    raise exception 'Entrada exige despesa positiva já realizada, sem vínculo de parcela, dívida ou recorrente';
  end if;
  if new.down_payment_debt_id is not null then
    select d.workspace_id into parent_workspace from public.debts d where d.id=new.down_payment_debt_id for share;
  else
    select p.workspace_id into parent_workspace from public.installment_plans p where p.id=new.down_payment_plan_id for share;
  end if;
  if parent_workspace is distinct from new.workspace_id or account_workspace is distinct from new.workspace_id
     or parent_workspace is null or account_workspace is null then
    raise exception 'Contrato e conta da entrada devem pertencer ao mesmo workspace ativo';
  end if;
  return new;
end $$;
revoke execute on function private.guard_purchase_down_payment() from public, anon, authenticated;
drop trigger if exists guard_purchase_down_payment on public.transactions;
create trigger guard_purchase_down_payment after insert or update on public.transactions
  for each row execute function private.guard_purchase_down_payment();

-- Mudar o workspace do parent/conta nao pode invalidar uma entrada ja registrada.
create or replace function private.guard_down_payment_workspace()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.workspace_id is distinct from old.workspace_id and exists (
    select 1 from public.transactions t where
      (tg_table_name='debts' and t.down_payment_debt_id=old.id)
      or (tg_table_name='installment_plans' and t.down_payment_plan_id=old.id)
      or (tg_table_name='accounts' and t.account_id=old.id
        and (t.down_payment_debt_id is not null or t.down_payment_plan_id is not null))
  ) then raise exception 'Não é possível mudar o workspace de um contrato/conta com entrada'; end if;
  return new;
end $$;
revoke execute on function private.guard_down_payment_workspace() from public, anon, authenticated;
drop trigger if exists guard_down_payment_workspace on public.debts;
create trigger guard_down_payment_workspace before update of workspace_id on public.debts
  for each row execute function private.guard_down_payment_workspace();
drop trigger if exists guard_down_payment_workspace on public.installment_plans;
create trigger guard_down_payment_workspace before update of workspace_id on public.installment_plans
  for each row execute function private.guard_down_payment_workspace();
drop trigger if exists guard_down_payment_workspace on public.accounts;
create trigger guard_down_payment_workspace before update of workspace_id on public.accounts
  for each row execute function private.guard_down_payment_workspace();

create table if not exists private.purchase_write_requests (
  user_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  payload jsonb not null,
  result jsonb,
  created_at timestamptz not null default now(),
  primary key(user_id,request_id)
);
alter table private.purchase_write_requests enable row level security;
drop policy if exists "own workspace purchase requests" on private.purchase_write_requests;
create policy "own workspace purchase requests" on private.purchase_write_requests for all to authenticated
  using (user_id=(select auth.uid()) and workspace_id in (select private.my_workspace_ids()))
  with check (user_id=(select auth.uid()) and workspace_id in (select private.my_workspace_ids()));
grant usage on schema private to authenticated;
grant select,insert,update on private.purchase_write_requests to authenticated;
revoke all on private.purchase_write_requests from public, anon;

create or replace function private.insert_purchase_down_payment(p_tipo text,p_parent_id uuid,p_entrada jsonb)
returns uuid language plpgsql security invoker set search_path = public
set timezone to 'America/Sao_Paulo' as $$
declare ws uuid; nome text; categoria text; estabelecimento text; amount bigint; account uuid; dia date; novo uuid;
begin
  if p_tipo is null or p_tipo not in ('financiamento','parcelada') then raise exception 'Tipo de compra inválido'; end if;
  if jsonb_typeof(p_entrada) is distinct from 'object'
    or exists(select 1 from jsonb_object_keys(p_entrada) k where k not in ('amount_cents','account_id','occurred_at'))
    or jsonb_typeof(p_entrada->'amount_cents') is distinct from 'number'
    or coalesce(p_entrada->>'amount_cents','') !~ '^[0-9]+$'
    or jsonb_typeof(p_entrada->'account_id') is distinct from 'string'
    or jsonb_typeof(p_entrada->'occurred_at') is distinct from 'string'
    or coalesce(p_entrada->>'occurred_at','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'Informe valor inteiro em centavos, conta e data da entrada';
  end if;
  amount := (p_entrada->>'amount_cents')::bigint;
  account := (p_entrada->>'account_id')::uuid;
  dia := (p_entrada->>'occurred_at')::date;
  if amount<=0 or dia>current_date then raise exception 'Entrada exige valor positivo e data já ocorrida'; end if;
  if p_tipo='financiamento' then
    select d.workspace_id,d.name,d.payment_category,d.payment_merchant into ws,nome,categoria,estabelecimento
      from public.debts d where d.id=p_parent_id for update;
  else
    select p.workspace_id,coalesce(p.description,p.merchant,'Compra parcelada'),p.category,p.merchant
      into ws,nome,categoria,estabelecimento from public.installment_plans p where p.id=p_parent_id for update;
  end if;
  if ws is null or ws not in(select private.my_workspace_ids()) then raise exception 'Contrato não encontrado neste workspace'; end if;
  if not exists(select 1 from public.accounts a where a.id=account and a.workspace_id=ws and not a.archived) then
    raise exception 'Escolha uma conta ativa do workspace da entrada';
  end if;
  insert into public.transactions(workspace_id,user_id,kind,amount_cents,description,category,merchant,
    account_id,occurred_at,status,source,down_payment_debt_id,down_payment_plan_id)
  values(ws,auth.uid(),'expense',amount,'Entrada · '||nome,categoria,estabelecimento,account,dia,'cleared','app',
    case when p_tipo='financiamento' then p_parent_id end,case when p_tipo='parcelada' then p_parent_id end)
  returning id into novo;
  return novo;
end $$;
revoke execute on function private.insert_purchase_down_payment(text,uuid,jsonb) from public, anon;
grant execute on function private.insert_purchase_down_payment(text,uuid,jsonb) to authenticated;

-- Mantem o nucleo anterior, inclusive parcelas/faturas/historico/ultimo dia; nao ha recursao.
do $$ begin
  if to_regprocedure('private.criar_registro_da_hipotese_sem_entrada(text,jsonb)') is null then
    alter function private.criar_registro_da_hipotese(text,jsonb) rename to criar_registro_da_hipotese_sem_entrada;
  end if;
end $$;

create or replace function private.criar_registro_da_hipotese(p_tipo text,p_dados jsonb)
returns jsonb language plpgsql security invoker set search_path = public
set timezone to 'America/Sao_Paulo' as $$
declare feito jsonb; entrada jsonb; novo uuid; inv uuid; ids uuid[];
begin
  entrada := nullif(p_dados->'down_payment','null'::jsonb);
  if entrada is not null and p_tipo not in ('financiamento','parcelada') then raise exception 'Entrada só vale para compra ou financiamento'; end if;
  feito := private.criar_registro_da_hipotese_sem_entrada(p_tipo,p_dados-'down_payment');
  if entrada is null then return feito; end if;
  novo := private.insert_purchase_down_payment(p_tipo,(feito->'ids'->>0)::uuid,entrada);
  select array_agg(value::uuid) into ids from jsonb_array_elements_text(feito->'ids');
  ids := ids || novo;
  -- Fatura nova e marcada junto com a hipotese; fatura que ja tinha outros gastos fica separada.
  select t.invoice_id into inv from public.transactions t where t.id=novo;
  if inv is not null and not (inv=any(ids)) and not exists(
    select 1 from public.transactions t where t.invoice_id=inv and not(t.id=any(ids))) then
    feito := jsonb_set(feito,'{ids}',(feito->'ids')||to_jsonb(inv));
  end if;
  if inv is not null and exists(select 1 from public.transactions t where t.invoice_id=inv and not(t.id=any(ids)))
    and not exists(select 1 from jsonb_array_elements_text(feito->'faturas') f where f.value=inv::text) then
    feito := jsonb_set(feito,'{faturas}',(feito->'faturas')||to_jsonb(inv));
  end if;
  return feito||jsonb_build_object('ids',(feito->'ids')||to_jsonb(novo),'down_payment_id',novo);
end $$;
revoke execute on function private.criar_registro_da_hipotese(text,jsonb) from public, anon;
grant execute on function private.criar_registro_da_hipotese(text,jsonb) to authenticated;

create or replace function public.create_purchase(
  p_tipo text,p_dados jsonb,p_entrada jsonb default null,p_request_id uuid default null
) returns jsonb language plpgsql security invoker set search_path = public
set timezone to 'America/Sao_Paulo' as $$
declare ws uuid; entrada jsonb; dados jsonb; payload jsonb; pedido private.purchase_write_requests%rowtype; feito jsonb;
begin
  if auth.uid() is null then raise exception 'Autenticação obrigatória'; end if;
  if p_tipo is null or p_tipo not in('financiamento','parcelada') or jsonb_typeof(p_dados) is distinct from 'object' then
    raise exception 'Tipo/dados de compra inválidos';
  end if;
  entrada := coalesce(nullif(p_entrada,'null'::jsonb),nullif(p_dados->'down_payment','null'::jsonb));
  if nullif(p_entrada,'null'::jsonb) is not null and nullif(p_dados->'down_payment','null'::jsonb) is not null
     and p_entrada<>p_dados->'down_payment' then raise exception 'Entradas divergentes'; end if;
  dados := p_dados-'down_payment';
  if p_tipo='parcelada' then
    select a.workspace_id into ws from public.accounts a where a.id=(dados->>'p_account_id')::uuid and not a.archived;
  else ws := public.my_default_workspace(); end if;
  if ws is null or ws not in(select private.my_workspace_ids()) then raise exception 'Workspace da compra não autorizado'; end if;
  payload := jsonb_build_object('operation','create','tipo',p_tipo,'dados',dados,'entrada',entrada);
  if p_request_id is not null then
    insert into private.purchase_write_requests(user_id,request_id,workspace_id,payload)
      values(auth.uid(),p_request_id,ws,payload) on conflict(user_id,request_id) do nothing;
    select * into pedido from private.purchase_write_requests where user_id=auth.uid() and request_id=p_request_id for update;
    if pedido.payload is distinct from payload then raise exception 'Esta tentativa já foi usada com dados diferentes'; end if;
    if pedido.result is not null then return pedido.result; end if;
  end if;
  if entrada is not null then dados := dados||jsonb_build_object('down_payment',entrada); end if;
  feito := private.criar_registro_da_hipotese(p_tipo,dados);
  if p_request_id is not null then
    update private.purchase_write_requests set result=feito where user_id=auth.uid() and request_id=p_request_id;
  end if;
  return feito;
end $$;
revoke execute on function public.create_purchase(text,jsonb,jsonb,uuid) from public, anon;
grant execute on function public.create_purchase(text,jsonb,jsonb,uuid) to authenticated;

create or replace function public.add_purchase_down_payment(p_tipo text,p_parent_id uuid,p_entrada jsonb,p_request_id uuid)
returns uuid language plpgsql security invoker set search_path = public
set timezone to 'America/Sao_Paulo' as $$
declare ws uuid; payload jsonb; pedido private.purchase_write_requests%rowtype; novo uuid;
begin
  if auth.uid() is null then raise exception 'Autenticação obrigatória'; end if;
  if p_tipo='financiamento' then select d.workspace_id into ws from public.debts d where d.id=p_parent_id;
  elsif p_tipo='parcelada' then select p.workspace_id into ws from public.installment_plans p where p.id=p_parent_id;
  else raise exception 'Tipo de compra inválido'; end if;
  if ws is null or ws not in(select private.my_workspace_ids()) then raise exception 'Contrato não encontrado neste workspace'; end if;
  payload := jsonb_build_object('operation','add','tipo',p_tipo,'parent_id',p_parent_id,'entrada',p_entrada);
  if p_request_id is not null then
    insert into private.purchase_write_requests(user_id,request_id,workspace_id,payload)
      values(auth.uid(),p_request_id,ws,payload) on conflict(user_id,request_id) do nothing;
    select * into pedido from private.purchase_write_requests where user_id=auth.uid() and request_id=p_request_id for update;
    if pedido.payload is distinct from payload then raise exception 'Esta tentativa já foi usada com dados diferentes'; end if;
    if pedido.result is not null then return (pedido.result->>'down_payment_id')::uuid; end if;
  end if;
  novo := private.insert_purchase_down_payment(p_tipo,p_parent_id,p_entrada);
  if p_request_id is not null then
    update private.purchase_write_requests set result=jsonb_build_object('down_payment_id',novo)
      where user_id=auth.uid() and request_id=p_request_id;
  end if;
  return novo;
end $$;
revoke execute on function public.add_purchase_down_payment(text,uuid,jsonb,uuid) from public, anon;
grant execute on function public.add_purchase_down_payment(text,uuid,jsonb,uuid) to authenticated;

-- O ramo avulso→parcelada converte a linha existente sem passar pelo helper de criacao.
-- Preservamos esse codigo e envolvemos TODOS os alcances em um anexo atomico da entrada.
do $$ begin
  if to_regprocedure('private.converter_registro_sem_entrada(jsonb,text,jsonb)') is null then
    execute replace(pg_get_functiondef('public.converter_registro(jsonb,text,jsonb)'::regprocedure),
      'FUNCTION public.converter_registro(', 'FUNCTION private.converter_registro_sem_entrada(');
  end if;
end $$;
revoke execute on function private.converter_registro_sem_entrada(jsonb,text,jsonb) from public, anon;
grant execute on function private.converter_registro_sem_entrada(jsonb,text,jsonb) to authenticated;

create or replace function public.converter_registro(p_origem jsonb,p_alcance text,p_destino jsonb)
returns jsonb language plpgsql security invoker set search_path = public
set timezone to 'America/Sao_Paulo' as $$
declare feito jsonb; entrada jsonb; novo uuid; tipo text;
begin
  if exists(select 1 from public.transactions t where t.id=(p_origem->>'id')::uuid
    and (t.down_payment_debt_id is not null or t.down_payment_plan_id is not null)) then
    raise exception 'Entrada é um movimento do contrato: edite/apague o lançamento sem converter o tipo';
  end if;
  entrada := nullif(p_destino->'dados'->'down_payment','null'::jsonb);
  tipo := p_destino->>'tipo';
  if entrada is not null and tipo not in('financiamento','parcelada') then raise exception 'Entrada só vale para compra ou financiamento'; end if;
  feito := private.converter_registro_sem_entrada(p_origem,p_alcance,
    case when entrada is null then p_destino else jsonb_set(p_destino,'{dados}',(p_destino->'dados')-'down_payment') end);
  if entrada is not null then
    novo := private.insert_purchase_down_payment(tipo,(feito->'ids'->>0)::uuid,entrada);
    feito := feito||jsonb_build_object('ids',(feito->'ids')||to_jsonb(novo),'down_payment_id',novo);
  end if;
  return feito;
end $$;
revoke execute on function public.converter_registro(jsonb,text,jsonb) from public, anon;
grant execute on function public.converter_registro(jsonb,text,jsonb) to authenticated;
