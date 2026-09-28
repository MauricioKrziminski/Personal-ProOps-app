-- Contract edits have a numbered installment boundary. One installment stores a projection
-- exception; future changes the contract rule; all also corrects recorded cash amounts and
-- clears declared historical estimates. Real payment dates remain historical facts.
create table if not exists public.debt_installment_edits (
  debt_id uuid not null references public.debts(id) on delete cascade,
  installment_no int not null check (installment_no > 0),
  due_date date,
  amount_cents bigint check (amount_cents > 0),
  primary key (debt_id, installment_no),
  check (due_date is not null or amount_cents is not null)
);
alter table public.debt_installment_edits enable row level security;
drop policy if exists "workspace debt installment edits" on public.debt_installment_edits;
create policy "workspace debt installment edits" on public.debt_installment_edits for all
  using (exists (select 1 from public.debts d where d.id=debt_id
    and d.workspace_id in (select private.my_workspace_ids())))
  with check (exists (select 1 from public.debts d where d.id=debt_id
    and d.workspace_id in (select private.my_workspace_ids())));
grant select, insert, update, delete on public.debt_installment_edits to authenticated, service_role;

create table if not exists private.debt_contract_edit_requests (
  user_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null,
  debt_id uuid not null,
  anchor_no integer not null,
  scope text not null,
  patch jsonb not null,
  expected_revision bigint not null,
  expected_payment_versions jsonb not null,
  result jsonb,
  primary key (user_id, request_id)
);
alter table private.debt_contract_edit_requests enable row level security;
drop policy if exists "own debt contract requests" on private.debt_contract_edit_requests;
create policy "own debt contract requests" on private.debt_contract_edit_requests for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
grant select, insert, update on private.debt_contract_edit_requests to authenticated, service_role;

create or replace function public.update_debt_contract_scoped(
  p_debt_id uuid, p_anchor_no integer, p_scope text, p_patch jsonb,
  p_expected_revision bigint, p_expected_payment_versions jsonb, p_request_id uuid
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  caller_uid uuid := auth.uid();
  request_row record;
  d record;
  payment record;
  new_amount bigint;
  new_day int;
  new_due_date date;
  old_estimate bigint;
  changed_count int := 0;
  response jsonb;
begin
  if caller_uid is null then raise exception 'Sessão autenticada obrigatória'; end if;
  if p_request_id is null then raise exception 'Identificador da requisição obrigatório'; end if;
  if p_scope not in ('one','future','all') then raise exception 'Escopo da dívida inválido'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch='{}'::jsonb then
    raise exception 'Nenhuma alteração da dívida informada';
  end if;
  insert into private.debt_contract_edit_requests
    (user_id,request_id,debt_id,anchor_no,scope,patch,expected_revision,expected_payment_versions)
  values (caller_uid,p_request_id,p_debt_id,p_anchor_no,p_scope,p_patch,
    p_expected_revision,p_expected_payment_versions)
  on conflict (user_id,request_id) do nothing;
  select * into request_row from private.debt_contract_edit_requests
    where user_id=caller_uid and request_id=p_request_id for update;
  if request_row.debt_id is distinct from p_debt_id
    or request_row.anchor_no is distinct from p_anchor_no
    or request_row.scope is distinct from p_scope
    or request_row.patch is distinct from p_patch
    or request_row.expected_revision is distinct from p_expected_revision
    or request_row.expected_payment_versions is distinct from p_expected_payment_versions then
    raise exception 'Identificador da requisição reutilizado com dados diferentes';
  end if;
  if request_row.result is not null then return request_row.result; end if;
  if exists (select 1 from jsonb_object_keys(p_patch) k where k not in
    ('name','kind','principal_cents','remaining_cents','interest_rate_monthly',
     'installments','installments_paid','installment_cents','account_id','due_day',
     'first_due_date','due_date')) then
    raise exception 'Campo não permitido na edição do contrato';
  end if;
  if p_scope='one' and exists (select 1 from jsonb_object_keys(p_patch) k
    where k not in ('installment_cents','due_date')) then
    raise exception 'Nesta parcela só é possível editar valor e vencimento';
  end if;
  if p_scope='future' and exists (select 1 from jsonb_object_keys(p_patch) k
    where k not in ('installment_cents','due_day','first_due_date')) then
    raise exception 'Este campo pertence ao contrato inteiro; escolha Todas ou edite o contrato sem histórico';
  end if;
  if p_scope<>'one' and p_patch ? 'due_date' then
    raise exception 'Para próximas parcelas, informe a regra do dia e a âncora do contrato';
  end if;
  if p_patch ? 'installment_cents' then
    if jsonb_typeof(p_patch->'installment_cents') <> 'number'
      or (p_patch->>'installment_cents')::numeric <> trunc((p_patch->>'installment_cents')::numeric)
      or (p_patch->>'installment_cents')::numeric <= 0 then
      raise exception 'Valor da parcela deve ser inteiro e maior que zero';
    end if;
    new_amount := (p_patch->>'installment_cents')::bigint;
  end if;
  if p_patch ? 'due_day' then
    if jsonb_typeof(p_patch->'due_day') <> 'number' then raise exception 'Dia inválido'; end if;
    new_day := (p_patch->>'due_day')::int;
    if new_day <> -1 and (new_day < 1 or new_day > 31) then raise exception 'Dia inválido'; end if;
  end if;
  if p_patch ? 'due_date' then
    if jsonb_typeof(p_patch->'due_date') <> 'string' then raise exception 'Vencimento inválido'; end if;
    new_due_date := (p_patch->>'due_date')::date;
  end if;
  select * into d from public.debts where id=p_debt_id for update;
  if d.id is null or d.archived then raise exception 'Dívida ativa não encontrada'; end if;
  if d.edit_revision is distinct from p_expected_revision then
    raise exception 'A dívida mudou enquanto você editava';
  end if;
  if d.installments is null or p_anchor_no is null
    or p_anchor_no <> d.installments_paid+1
    or (p_scope <> 'all' and p_anchor_no > d.installments) then
    raise exception 'Abra novamente a próxima parcela para editar esta dívida';
  end if;
  if p_scope='one' and p_patch ? 'installment_cents' and d.calculation_mode <> 'fixed_installments' then
    raise exception 'Valor individual de dívida com juros exige recálculo Price; edite Todas';
  end if;
  if p_patch ? 'name' and nullif(btrim(p_patch->>'name'), '') is null then
    raise exception 'Informe o nome da dívida';
  end if;
  if p_scope='all' and (p_patch ? 'principal_cents' or p_patch ? 'remaining_cents'
    or p_patch ? 'interest_rate_monthly')
    and exists (select 1 from public.transactions where debt_id=d.id) then
    raise exception 'Saldo, principal e juros com pagamentos registrados exigem revisão do histórico; não foram alterados';
  end if;
  if d.calculation_mode <> 'fixed_installments' and p_patch ? 'installment_cents' and (p_patch ? 'installments'
    or p_patch ? 'installments_paid' or p_patch ? 'principal_cents'
    or p_patch ? 'remaining_cents') then
    raise exception 'Altere o valor da parcela separadamente do prazo e do saldo';
  end if;
  if p_scope='all' and (p_patch ? 'installment_cents' or p_patch ? 'account_id' or p_patch ? 'name') then
    perform 1 from public.transactions t where t.debt_id=d.id
      order by t.debt_payment_no,t.id for update;
    if p_expected_payment_versions is null or jsonb_typeof(p_expected_payment_versions)<>'object'
      or (select count(*) from jsonb_object_keys(p_expected_payment_versions)) <>
         (select count(*) from public.transactions where debt_id=d.id)
      or exists (select 1 from public.transactions t where t.debt_id=d.id and
        (not p_expected_payment_versions ? t.id::text
         or t.edit_revision is distinct from (p_expected_payment_versions->>t.id::text)::bigint)) then
      raise exception 'Outro pagamento mudou enquanto você editava';
    end if;
    for payment in select * from public.transactions where debt_id=d.id order by debt_payment_no,id loop
      if payment.debt_payment_no is null or payment.debt_principal_cents is null
        or payment.invoice_id is not null or payment.pays_invoice_id is not null then
        raise exception 'Histórico de pagamento incompleto; nenhuma parcela foi alterada';
      end if;
      if (p_patch ? 'installment_cents' and payment.amount_cents is distinct from new_amount)
         or (p_patch ? 'account_id' and payment.account_id is distinct from (p_patch->>'account_id')::uuid) then
        update public.transactions set
          amount_cents=case when p_patch ? 'installment_cents' then new_amount else amount_cents end,
          account_id=case when p_patch ? 'account_id' then (p_patch->>'account_id')::uuid else account_id end
        where id=payment.id;
        changed_count := changed_count+1;
      end if;
      -- Generated titles follow a contract rename; titles edited by the person remain theirs.
      if p_patch ? 'name' and payment.description = 'Parcela ' || d.name
         and payment.description is distinct from 'Parcela ' || btrim(p_patch->>'name') then
        update public.transactions set description='Parcela ' || btrim(p_patch->>'name')
        where id=payment.id;
        changed_count := changed_count+1;
      end if;
    end loop;
    if p_patch ? 'installment_cents' then
      delete from public.debt_declared_estimates where debt_id=d.id;
    end if;
  end if;
  if p_scope='future' and p_patch ? 'installment_cents' and d.installments_paid>0 then
    old_estimate := coalesce(d.installment_cents,
      (select s.payment_cents from public.debt_schedule(d.id) s order by s.installment_no limit 1));
    if old_estimate is null or old_estimate<=0 then
      raise exception 'Não é possível preservar as estimativas das parcelas anteriores';
    end if;
    insert into public.debt_declared_estimates(debt_id,installment_no,amount_cents)
    select d.id,n,old_estimate
    from generate_series(1,d.installments_paid) n
    where not exists (select 1 from public.transactions t
      where t.debt_id=d.id and t.debt_payment_no=n)
    on conflict (debt_id,installment_no) do nothing;
  end if;
  if p_scope='one' then
    insert into public.debt_installment_edits(debt_id,installment_no,due_date,amount_cents)
    values (d.id,p_anchor_no,new_due_date,new_amount)
    on conflict (debt_id,installment_no) do update set
      due_date=coalesce(excluded.due_date,public.debt_installment_edits.due_date),
      amount_cents=coalesce(excluded.amount_cents,public.debt_installment_edits.amount_cents);
  else
    delete from public.debt_installment_edits where debt_id=d.id and installment_no>=p_anchor_no;
    update public.debts set
      name=case when p_patch ? 'name' then p_patch->>'name' else name end,
      kind=case when p_patch ? 'kind' then p_patch->>'kind' else kind end,
      calculation_mode=calculation_mode,
      principal_cents=case when d.calculation_mode='fixed_installments'
          and (p_patch ? 'installment_cents' or p_patch ? 'installments' or p_patch ? 'installments_paid')
        then coalesce(new_amount,d.installment_cents)
          *coalesce((p_patch->>'installments')::int,installments)
        when p_patch ? 'principal_cents' then (p_patch->>'principal_cents')::bigint
        else principal_cents end,
      remaining_cents=case when d.calculation_mode='fixed_installments'
          and (p_patch ? 'installment_cents' or p_patch ? 'installments' or p_patch ? 'installments_paid')
        then coalesce(new_amount,d.installment_cents)
          *(coalesce((p_patch->>'installments')::int,installments)
            -coalesce((p_patch->>'installments_paid')::int,installments_paid))
        when p_patch ? 'remaining_cents' then (p_patch->>'remaining_cents')::bigint
        else remaining_cents end,
      interest_rate_monthly=case when p_patch ? 'interest_rate_monthly'
        then (p_patch->>'interest_rate_monthly')::numeric else interest_rate_monthly end,
      installments=case when p_patch ? 'installments' then (p_patch->>'installments')::int else installments end,
      installments_paid=case when p_patch ? 'installments_paid'
        then (p_patch->>'installments_paid')::int else installments_paid end,
      installment_cents=case when p_patch ? 'installment_cents' then new_amount else installment_cents end,
      account_id=case when p_patch ? 'account_id' then (p_patch->>'account_id')::uuid else account_id end,
      due_day=case when p_patch ? 'due_day' then new_day else due_day end,
      first_due_date=case when p_patch ? 'first_due_date'
        then (p_patch->>'first_due_date')::date else first_due_date end
    where id=d.id;
  end if;
  if d.calculation_mode='amortized' and p_patch ? 'installment_cents'
    and d.installments>d.installments_paid and
    ((select count(*) from public.debt_schedule(d.id))<>d.installments-d.installments_paid
      or exists (select 1 from public.debt_schedule(d.id) s where s.principal_cents<=0)) then
    raise exception 'O valor não mantém o cronograma de parcelas com juros';
  end if;
  response := jsonb_build_object('scope',p_scope,'anchor_no',p_anchor_no,
    'recorded_changed',changed_count,'contract_changed',p_scope<>'one');
  update private.debt_contract_edit_requests set result=response
    where user_id=caller_uid and request_id=p_request_id;
  return response;
end;
$$;
revoke execute on function public.update_debt_contract_scoped(uuid,integer,text,jsonb,bigint,jsonb,uuid)
  from public,anon;
grant execute on function public.update_debt_contract_scoped(uuid,integer,text,jsonb,bigint,jsonb,uuid)
  to authenticated,service_role;

-- All forecast readers use this private schedule; a one-parcel exception must appear everywhere.
create or replace function private.debt_schedule_for(p_debt_id uuid)
returns table (installment_no integer, due_date date, payment_cents bigint,
               interest_cents bigint, principal_cents bigint, balance_cents bigint)
language sql stable
set search_path to 'public'
set "TimeZone" to 'America/Sao_Paulo'
as $function$
  with recursive d as (
    select id, remaining_cents, interest_rate_monthly, due_day, calculation_mode,
           started_at, installments_paid, first_due_date,
           coalesce(installments, 0) - installments_paid as restantes,
           installment_cents
    from public.debts where id = p_debt_id
  ),
  dia as (
    select coalesce(d.due_day, extract(day from d.started_at)::int) as valor from d
  ),
  -- o contrato já foi cobrado NESTE CICLO? o pagamento é a única prova que existe
  pago as (
    select private.debt_paid_in_cycle(p_debt_id, current_date) as sim
  ),
  -- o fim do ciclo corrente, para saber o que é "depois dele"
  ciclo as (
    select b.fim
    from d,
         lateral (select private.cycle_close_day(array[d_ws.workspace_id]) as cd
                  from public.debts d_ws where d_ws.id = p_debt_id) r,
         lateral private.cycle_bounds(r.cd, private.cycle_month_of(r.cd, current_date)) b
  ),
  parametros as (
    select d.remaining_cents, d.interest_rate_monthly as taxa,
           d.installments_paid as pagas,
           (select valor from dia) as venc,
           case
             -- ⚠️ Com âncora, o calendário é o do CONTRATO: a parcela `pagas + 1`, nunca antes da
             -- próxima ocorrência do dia a partir de hoje (o atrasado continua como sempre). O
             -- ramo "pago no ciclo" NÃO entra aqui: ele empurrava para depois do fim do ciclo a
             -- parcela do contrato que ainda vence dentro dele, quando a anterior era paga com
             -- atraso neste ciclo (revisão final de 23/09/2026).
             when d.first_due_date is not null then greatest(
               case
                 when private.day_in_month(current_date, (select valor from dia)) >= current_date
                   then private.day_in_month(current_date, (select valor from dia))
                 else private.day_in_month(private.add_months(current_date, 1), (select valor from dia))
               end,
               private.day_in_month(private.add_months(d.first_due_date, d.installments_paid),
                                    (select valor from dia)))
             else
             case
               -- ⚠️ Pago no ciclo: a próxima é a primeira ocorrência do dia de vencimento
               -- ESTRITAMENTE depois do fim do ciclo. Somar um mês ao HOJE não bastava — com
               -- fechamento no dia 10 e vencimento no dia 5, "mês que vem" cai em 05/10, que
               -- ainda está dentro do ciclo 11/09–10/10 que acabou de ser pago.
               when (select sim from pago)
                 then case
                        when private.day_in_month((select fim from ciclo) + 1, (select valor from dia))
                             > (select fim from ciclo)
                          then private.day_in_month((select fim from ciclo) + 1, (select valor from dia))
                        else private.day_in_month(
                               private.add_months((select fim from ciclo) + 1, 1),
                               (select valor from dia))
                      end
               when private.day_in_month(current_date, (select valor from dia)) >= current_date
                 then private.day_in_month(current_date, (select valor from dia))
               else private.day_in_month(private.add_months(current_date, 1), (select valor from dia))
             end
           end as primeiro,
           nullif(d.restantes, 0) as n,
           coalesce(d.installment_cents,
                    private.price_installment(d.remaining_cents, d.interest_rate_monthly,
                                              nullif(d.restantes, 0))) as parcela
    from d
  ),
  amortizacao as (
    select 1 as installment_no,
           (select remaining_cents from parametros) as saldo_inicial,
           (select parcela from parametros) as parcela,
           (select taxa from parametros) as taxa,
           (select n from parametros) as n
    union all
    select a.installment_no + 1,
           a.saldo_inicial + ceil(a.saldo_inicial::numeric * a.taxa)::bigint - a.parcela,
           a.parcela, a.taxa, a.n
    from amortizacao a
    where a.installment_no < a.n
      and a.saldo_inicial + ceil(a.saldo_inicial::numeric * a.taxa)::bigint - a.parcela > 0
  )
  -- a numeração é a do CONTRATO: 40 parcelas restantes de 48 são a 9ª à 48ª
  select a.installment_no + coalesce((select pagas from parametros), 0),
         coalesce(e.due_date, private.day_in_month(
           private.add_months((select primeiro from parametros), a.installment_no - 1),
           (select venc from parametros)
         )) as due_date,
         coalesce(e.amount_cents, case when a.installment_no = a.n
              then a.saldo_inicial + ceil(a.saldo_inicial::numeric * a.taxa)::bigint
              else a.parcela end) as payment_cents,
         case when (select calculation_mode from d) = 'fixed_installments' then null::bigint
              else ceil(a.saldo_inicial::numeric * a.taxa)::bigint end as interest_cents,
         case when (select calculation_mode from d) = 'fixed_installments' then null::bigint
              when a.installment_no = a.n
              then a.saldo_inicial
              else a.parcela - ceil(a.saldo_inicial::numeric * a.taxa)::bigint end as principal_cents,
         greatest(
           a.saldo_inicial + ceil(a.saldo_inicial::numeric * a.taxa)::bigint
           - case when a.installment_no = a.n
                  then a.saldo_inicial + ceil(a.saldo_inicial::numeric * a.taxa)::bigint
                  else a.parcela end,
           0) as balance_cents
  from amortizacao a
  left join public.debt_installment_edits e on e.debt_id=p_debt_id
    and e.installment_no=a.installment_no + coalesce((select pagas from parametros),0)
  where (select calculation_mode from d) <> 'fixed_installments'
     or (a.saldo_inicial > 0 and a.n > 0)
  order by a.installment_no;
$function$;
