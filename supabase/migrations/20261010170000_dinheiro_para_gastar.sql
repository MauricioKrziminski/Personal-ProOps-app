-- "Dá para gastar" é dinheiro do dia a dia, não patrimônio (10/10/2026, decisão do dono do
-- produto: investimento fica fora, poupança entra por padrão, e cada conta tem a sua chave).
--
-- Antes, toda conta que não era cartão somava no caixa: aplicar R$ 5.000 num CDB não mexia no
-- "livre", a Projeção partia do dinheiro investido e o aporte mensal não aparecia como saída.
--
-- A regra mora em UM lugar, `private.conta_no_disponivel(tipo, spendable)`:
--   * `accounts.spendable` null = o padrão do tipo (investimento fora, o resto dentro);
--     true/false = a escolha da pessoa naquela conta. Cartão nunca (check).
--   * As peças POR CONTA continuam completas (`caixa_das_contas`, `eventos_de_caixa`): reserva,
--     metas, investimentos e o detalhe por conta precisam ver a conta de investimento.
--   * As SOMAS passam pela regra: `cash_total` (de onde saem o livre, o ciclo, o mês e a
--     Projeção), `eventos_disponiveis` (a série da Projeção) e `cash_events` (o ciclo e o
--     "o que vence"), que ganha a transferência que CRUZA a borda — aplicar sai, resgatar entra.
--   * Patrimônio não muda: `net_worth_now` soma o caixa de TODAS as contas.
-- `supabase/tests/dinheiro_para_gastar.sql` prende tudo isso.

alter table public.accounts add column if not exists spendable boolean;
comment on column public.accounts.spendable is
  'Entra no "Dá para gastar"? null = padrão do tipo (investimento fora, o resto dentro). Ver private.conta_no_disponivel.';
alter table public.accounts drop constraint if exists accounts_spendable_cartao;
alter table public.accounts add constraint accounts_spendable_cartao
  check (type <> 'credit_card' or spendable is null);

create or replace function private.conta_no_disponivel(p_type text, p_spendable boolean)
returns boolean
language sql immutable
set search_path = ''
as $$
  -- `null, null` é a linha "sem conta" (lançamento do WhatsApp): dinheiro do dia a dia.
  select p_type is distinct from 'credit_card' and coalesce(p_spendable, p_type is distinct from 'investment');
$$;
revoke execute on function private.conta_no_disponivel(text, boolean) from public, anon;
grant execute on function private.conta_no_disponivel(text, boolean) to authenticated, service_role;

-- O caixa que dá para gastar: as contas da regra + "sem conta".
create or replace function private.cash_total(ws_ids uuid[], as_of date default null)
returns bigint
language sql stable
set search_path = public
as $$
  select coalesce(sum(c.cents), 0)::bigint
  from private.caixa_das_contas(ws_ids, as_of) c
  left join public.accounts a on a.id = c.account_id
  where private.conta_no_disponivel(a.type, a.spendable);
$$;

-- A série da Projeção: os eventos por conta, só das contas da regra. A transferência entre uma
-- conta de dentro e uma de fora já vem em duas pernas, e a de fora cai aqui — vira saída/entrada.
create or replace function private.eventos_disponiveis(ws_ids uuid[], ate date)
returns table (account_id uuid, day date, in_cents bigint, out_cents bigint)
language sql stable
set search_path = public
set timezone to 'America/Sao_Paulo'
as $$
  select e.account_id, e.day, e.in_cents, e.out_cents
  from private.eventos_de_caixa(ws_ids, ate) e
  left join public.accounts a on a.id = e.account_id
  where private.conta_no_disponivel(a.type, a.spendable);
$$;
revoke execute on function private.eventos_disponiveis(uuid[], date) from public, anon;
grant execute on function private.eventos_disponiveis(uuid[], date) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public._cash_flow_forecast(uid uuid, days integer DEFAULT 90)
 RETURNS TABLE(day date, in_cents bigint, out_cents bigint, balance_cents bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Sao_Paulo'
AS $function$
  with horizonte as (select private.clamp_forecast_days(days) as dias),
  saldo_inicial as (select private.cash_total(array(select public._workspace_ids(uid))) as cents),
  eventos as (
    -- UMA lista de eventos, com a conta (20260929140000): a mesma de onde sai o horizonte por conta.
    select e.day, e.in_cents, e.out_cents
    from private.eventos_disponiveis(array(select public._workspace_ids(uid)), current_date + (select dias from horizonte)) e
  ),
  dias as (
    select generate_series(current_date, current_date + (select dias from horizonte),
                           interval '1 day')::date as day
  ),
  agregado as (
    select d.day,
           coalesce(sum(e.in_cents), 0)::bigint as in_cents,
           coalesce(sum(e.out_cents), 0)::bigint as out_cents
    from dias d left join eventos e on e.day = d.day
    group by d.day
  )
  select a.day, a.in_cents, a.out_cents,
         ((select cents from saldo_inicial)
          + sum(a.in_cents - a.out_cents) over (order by a.day))::bigint
  from agregado a
  order by a.day;
$function$;

CREATE OR REPLACE FUNCTION public.cash_flow_forecast(days integer DEFAULT 90)
 RETURNS TABLE(day date, in_cents bigint, out_cents bigint, balance_cents bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Sao_Paulo'
AS $function$
  with horizonte as (select private.clamp_forecast_days(days) as dias),
  saldo_inicial as (select private.cash_total(array(select private.my_workspace_ids())) as cents),
  eventos as (
    -- UMA lista de eventos, com a conta (20260929140000): a mesma de onde sai o horizonte por conta.
    select e.day, e.in_cents, e.out_cents
    from private.eventos_disponiveis(array(select private.my_workspace_ids()), current_date + (select dias from horizonte)) e
  ),
  dias as (
    select generate_series(current_date, current_date + (select dias from horizonte),
                           interval '1 day')::date as day
  ),
  agregado as (
    select d.day,
           coalesce(sum(e.in_cents), 0)::bigint as in_cents,
           coalesce(sum(e.out_cents), 0)::bigint as out_cents
    from dias d left join eventos e on e.day = d.day
    group by d.day
  )
  select a.day, a.in_cents, a.out_cents,
         ((select cents from saldo_inicial)
          + sum(a.in_cents - a.out_cents) over (order by a.day))::bigint
  from agregado a
  order by a.day;
$function$;

CREATE OR REPLACE FUNCTION private.net_worth_now(ws_id uuid)
 RETURNS TABLE(cash_cents bigint, investments_cents bigint, other_assets_cents bigint, liabilities_cents bigint, net_cents bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Sao_Paulo'
AS $function$
  with posicoes as (
    select (select coalesce(sum(c.cents), 0) from private.caixa_das_contas(array[ws_id]) c
             join public.accounts x on x.id = c.account_id where x.type = 'investment')::bigint as ledger,
           (select coalesce(sum(n.value_cents), 0) from private.investment_position_numbers(array[ws_id]) n)::bigint as valor
  ),
  -- Patrimônio conta o dinheiro de TODAS as contas (20261010170000): `cash_total` é só o que dá para gastar.
  dinheiro as (select ((select coalesce(sum(c.cents), 0) from private.caixa_das_contas(array[ws_id]) c)
                       - (select ledger from posicoes))::bigint as cents),
  investimentos as (
    select (coalesce(sum(current_value_cents), 0) + (select valor from posicoes))::bigint as cents
    from public.assets
    where workspace_id = ws_id and not archived and not is_liability
      and class in ('investment','crypto','equity')
  ),
  outros as (
    select coalesce(sum(current_value_cents), 0)::bigint as cents
    from public.assets
    where workspace_id = ws_id and not archived and not is_liability
      and class not in ('investment','crypto','equity')
  ),
  passivos as (
    select (
      coalesce((select sum(current_value_cents) from public.assets
                where workspace_id = ws_id and not archived and is_liability), 0)
      + coalesce((select sum(remaining_cents) from public.debts
                  where workspace_id = ws_id and not archived), 0)
      + coalesce((select sum(private.invoice_open_cents(ci.id)) from public.card_invoices ci
                  where ci.workspace_id = ws_id and ci.status not in ('paid','rolled')), 0)
    )::bigint as cents
  )
  select d.cents, i.cents, o.cents, p.cents,
         (d.cents + i.cents + o.cents - p.cents)::bigint
  from dinheiro d, investimentos i, outros o, passivos p;
$function$;

CREATE OR REPLACE FUNCTION private.contas_no_horizonte(ws_ids uuid[], fim date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Sao_Paulo'
AS $function$
  with base as (select account_id, cents from private.caixa_das_contas(ws_ids, current_date)),
  ev as (select account_id, day, sum(in_cents - out_cents)::bigint as delta
         from private.eventos_de_caixa(ws_ids, fim) group by 1, 2),
  contas as (select account_id from base union select account_id from ev),
  dias as (select generate_series(current_date, fim, interval '1 day')::date as day),
  serie as (
    select k.account_id, d.day,
           (coalesce((select b.cents from base b where b.account_id is not distinct from k.account_id), 0)
            + sum(coalesce(e.delta, 0)) over (partition by k.account_id order by d.day))::bigint as saldo
    from contas k cross join dias d
    left join ev e on e.account_id is not distinct from k.account_id and e.day = d.day
  ),
  resumo as (
    select account_id,
           (array_agg(saldo order by day))[1] as saldo_hoje,
           min(saldo) as menor,
           (array_agg(day order by saldo, day))[1] as dia_do_menor,
           (array_agg(saldo order by day desc))[1] as saldo_fim,
           min(day) filter (where saldo < 0) as negativa_em
    from serie group by account_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'account_id', r.account_id, 'nome', coalesce(a.name, 'Sem conta'), 'tipo', a.type,
           'saldo_hoje', r.saldo_hoje, 'menor', r.menor, 'dia_do_menor', r.dia_do_menor,
           'saldo_fim', r.saldo_fim, 'negativa_em', r.negativa_em,
           'disponivel', private.conta_no_disponivel(a.type, a.spendable)) order by a.name nulls last), '[]'::jsonb)
  from resumo r left join public.accounts a on a.id = r.account_id;
$function$;

CREATE OR REPLACE FUNCTION private.goal_planning_state_f08(p_workspace_id uuid, p_days integer, p_view text, p_mode text, p_preview jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET "TimeZone" TO 'America/Sao_Paulo'
AS $function$
declare
 ws uuid:=p_workspace_id;today date:=current_date;days integer:=private.clamp_forecast_days(p_days);
 finish date;close_day integer;fingerprint text;revision bigint;items jsonb;goals jsonb:='[]';
 incomplete jsonb:='[]';excluded jsonb:='[]';missed jsonb:='[]';points jsonb;months jsonb;
 reserve_state jsonb;reserved numeric;unassigned numeric;initial_cash numeric;income boolean;
 g record;i jsonb;included boolean;monthly numeric;first_on date;suggested numeric;origin text;
 remaining numeric;occurrences integer;first_pressure date;minimum_available numeric;unsafe boolean;
 maxsafe constant numeric:=9007199254740991;
begin
 if auth.uid() is null or ws is null or not exists(select 1 from public.workspace_members m where m.workspace_id=ws and m.user_id=auth.uid())
 then raise exception using errcode='42501',message='Workspace não autorizado';end if;
 if p_view is null or p_view not in('civil','cycle') or p_mode is null or p_mode not in('month','day')
 then raise exception using errcode='22023',message='Régua ou modo de planejamento inválido';end if;
 finish:=today+days;close_day:=private.cycle_close_day(array[ws],p_view);
 fingerprint:=private.goal_planning_fingerprint(ws);
 select p.edit_revision into revision from public.goal_plans p where p.workspace_id=ws;
 if p_preview is not null then
  if jsonb_typeof(p_preview)<>'object' or not(p_preview ?& array['goals_fingerprint','items'])
    or (select count(*) from jsonb_object_keys(p_preview))<>2
    or jsonb_typeof(p_preview->'goals_fingerprint')<>'string'
    or (p_preview->>'goals_fingerprint')!~'^[a-f0-9]{32}$'
  then raise exception using errcode='22023',message='Preview de metas inválido';end if;
  if p_preview->>'goals_fingerprint'<>fingerprint
  then raise exception using errcode='PT409',message='Metas alteradas; reabra o planejamento';end if;
  items:=private.validate_goal_plan_items(ws,p_preview->'items',false);
 end if;
 for g in select * from public.goals where workspace_id=ws and not archived and saved_cents<target_cents order by id loop
  if g.target_cents not between 1 and maxsafe or g.saved_cents not between 0 and maxsafe
    or g.deadline is not null and (g.deadline<date '0001-01-01' or g.deadline>date '9999-12-31')
  then raise exception using errcode='22003',message='Meta ultrapassa os limites seguros';end if;
  remaining:=g.target_cents::numeric-g.saved_cents::numeric;
  occurrences:=case when g.deadline>=today then private.goal_plan_occurrence_count(today,today,g.deadline) else 0 end;
  suggested:=case when occurrences>0 then ceil(remaining/occurrences) else null end;
  i:=null;
  if p_preview is not null then
   select x into i from jsonb_array_elements(items) x where x->>'goal_id'=g.id::text;
   origin:='draft';
  else
   select jsonb_build_object('included',p.included,'monthly_cents',p.monthly_cents,'first_on',p.first_on)
    into i from public.goal_plan_items p where p.workspace_id=ws and p.goal_id=g.id;
   origin:=case when i is null then 'suggested' else 'saved' end;
  end if;
  included:=coalesce((i->>'included')::boolean,true);
  monthly:=case when i is null then suggested else (i->>'monthly_cents')::numeric end;
  first_on:=case when i is null and suggested is not null then today else (i->>'first_on')::date end;
  if not included then
   monthly:=null;first_on:=null;excluded:=excluded||jsonb_build_array(g.id);
  elsif monthly is null or first_on is null then incomplete:=incomplete||jsonb_build_array(g.id);
  end if;
  if monthly is not null and (monthly<1 or monthly>maxsafe or monthly<>trunc(monthly))
    or first_on is not null and (first_on<date '0001-01-01' or first_on>date '9999-12-31')
  then raise exception using errcode='22003',message='Plano ultrapassa os limites seguros';end if;
  -- Only future intentions count toward a deadline. Past scheduled dates are not paid.
  if included and g.deadline is not null and (g.deadline<today or monthly is null or first_on is null
    or monthly*private.goal_plan_occurrence_count(first_on,today,g.deadline)<remaining)
  then missed:=missed||jsonb_build_array(g.id);end if;
  goals:=goals||jsonb_build_array(jsonb_build_object('goal_id',g.id,'name',g.name,
   'target_cents',g.target_cents::text,'saved_cents',g.saved_cents::text,'deadline',g.deadline,
   'included',included,'monthly_cents',monthly::text,'first_on',first_on,'suggested_cents',suggested::text,
   'origin',origin,'deadline_status',case when g.deadline is null then 'none' when g.deadline<today then 'past' else 'future' end));
 end loop;
 reserve_state:=public.emergency_reserve_state(ws,today);
 unassigned:=(reserve_state->>'unassigned_goals_cents')::numeric;
 -- Reserve state already validates eligibility and confirmed reserve liquidity. Goals
 -- share diminished backing proportionally; assets outside cash never subtract twice.
 select coalesce(sum((x->>'effective_cents')::numeric+
   case when (x->>'allocated_cents')::numeric+(x->>'other_allocated_cents')::numeric>0
   then floor((x->>'other_allocated_cents')::numeric*
    least((x->>'available_cents')::numeric,(x->>'allocated_cents')::numeric+(x->>'other_allocated_cents')::numeric)/
    ((x->>'allocated_cents')::numeric+(x->>'other_allocated_cents')::numeric)) else 0 end),0)
 into reserved from jsonb_array_elements(reserve_state->'sources') x where x->>'kind'='account' and (x->>'eligible')::boolean
   -- O lastro numa conta fora do disponível não está no caixa: descontá-lo seria tirar duas vezes.
   and exists(select 1 from public.accounts a where a.id=(x->>'id')::uuid and private.conta_no_disponivel(a.type,a.spendable));
 initial_cash:=private.cash_total(array[ws]);
 if abs(initial_cash)>maxsafe or reserved>maxsafe or unassigned>maxsafe
 then raise exception using errcode='22003',message='Total ultrapassa centavos seguros';end if;
 with events as materialized (
  select e.day,e.in_cents::numeric as incoming,e.out_cents::numeric as outgoing
  from private.eventos_disponiveis(array[ws],finish) e
 ), active as (
  select (x->>'goal_id')::uuid as id,(x->>'first_on')::date as anchor,(x->>'monthly_cents')::numeric as monthly,
   (x->>'target_cents')::numeric-(x->>'saved_cents')::numeric as remaining,
   least(finish,coalesce((x->>'deadline')::date,finish)) as until
  from jsonb_array_elements(goals) x where (x->>'included')::boolean
   and x->>'monthly_cents' is not null and x->>'first_on' is not null
 ), calendar as (
  select a.*,private.goal_plan_month_on(a.anchor,n) as day
  from active a cross join lateral generate_series(
    greatest(0,(extract(year from today)::integer-extract(year from a.anchor)::integer)*12
     +extract(month from today)::integer-extract(month from a.anchor)::integer),
    (extract(year from a.until)::integer-extract(year from a.anchor)::integer)*12
     +extract(month from a.until)::integer-extract(month from a.anchor)::integer) n
 ), upcoming as (
  select c.*,row_number() over(partition by id order by day) as occurrence from calendar c where day between today and until
 ), intentions as (
  select u.day,sum(least(u.monthly,greatest(u.remaining-(u.occurrence-1)::numeric*u.monthly,0))) as planned
  from upcoming u group by u.day
 ), daily_events as (
  select day,sum(incoming-outgoing) as delta from events group by day
 ), daily as (
  select d.day,coalesce(e.delta,0) as delta,
   coalesce(i.planned,0) as planned
  from generate_series(today,finish,interval '1 day') n
  cross join lateral (select n::date as day) d left join intentions i using(day) left join daily_events e using(day)
 ), running as (
  select day,planned,initial_cash+sum(delta) over(order by day) as cash,
   sum(planned) over(order by day) as cumulative from daily
 ), state as materialized (
  select *,cash-reserved-cumulative as available,private.cycle_month_of(close_day,day) as month from running
 ), grouped as (
  select month,min(day) as first_day,max(day) as last_day,sum(planned) as planned,
   (array_agg(cash order by day desc))[1] as cash,(array_agg(cumulative order by day desc))[1] as cumulative,
   (array_agg(available order by day desc))[1] as available,min(day) filter(where available<0) as pressure
  from state group by month
 )
 select exists(select 1 from state where abs(cash)>maxsafe or planned>maxsafe or cumulative>maxsafe or abs(available)>maxsafe)
   or exists(select 1 from events where abs(incoming)>maxsafe or abs(outgoing)>maxsafe),
  exists(select 1 from events where day between today and finish and incoming>0),
  (select min(day) from state where available<0),
  (select min(available) from state),
  case when p_mode='day' then (select jsonb_agg(jsonb_build_object('day',day,'cash_cents',cash::text,
   'planned_cents',planned::text,'cumulative_planned_cents',cumulative::text,'available_cents',available::text) order by day) from state) else '[]'::jsonb end,
  case when p_mode='month' then (select jsonb_agg(jsonb_build_object('month',to_char(m.month,'YYYY-MM'),'from',b.ini,'to',b.fim,
   'partial',m.first_day<>b.ini or m.last_day<>b.fim,'cash_cents',m.cash::text,'planned_cents',m.planned::text,
   'cumulative_planned_cents',m.cumulative::text,'available_cents',m.available::text,'first_pressure_on',m.pressure) order by m.month)
   from grouped m cross join lateral private.cycle_bounds(close_day,m.month) b) else '[]'::jsonb end
 into unsafe,income,first_pressure,minimum_available,points,months;
 if unsafe then raise exception using errcode='22003',message='Projeção ultrapassa centavos seguros';end if;
 return jsonb_build_object('workspace_id',ws,'as_of',today,'days',days,'view',p_view,'mode',p_mode,
  'edit_revision',revision,'goals_fingerprint',fingerprint,'goals',goals,'reserved_cash_cents',reserved::text,
  'unassigned_goals_cents',unassigned::text,'income_present',income,'incomplete_goal_ids',incomplete,
  'excluded_goal_ids',excluded,'missed_deadline_goal_ids',missed,'points',points,'months',months,'first_pressure_on',first_pressure,
  'minimum_available_cents',minimum_available::text);
end $function$;

CREATE OR REPLACE FUNCTION private.cycle_breakdown_for(ws_ids uuid[], p_month date, p_view text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Sao_Paulo'
AS $function$
  with c as (
    select * from private.cycle_series_for(ws_ids, p_month, p_month, p_view) order by ini limit 1
  ),
  ev as (
    select x.origin, sum(x.in_cents)::bigint in_cents, sum(x.out_cents)::bigint out_cents
    from c cross join lateral private.cash_events(ws_ids, c.ini, c.fim) x
    where c.estado <> 'aberto' or not x.realizado
    group by x.origin
  ),
  contas as (
    select k.account_id, coalesce(a.name, 'Sem conta') nome, a.type tipo, k.cents
    from private.caixa_das_contas(ws_ids, current_date) k
    left join public.accounts a on a.id = k.account_id
    where k.cents <> 0 and private.conta_no_disponivel(a.type, a.spendable)
  ),
  -- Fora do que dá para gastar (investimento, ou a conta que a pessoa tirou): linha à parte,
  -- fora da soma — como o "faltou pagar".
  fora as (
    select k.account_id, a.name nome, a.type tipo, k.cents
    from private.caixa_das_contas(ws_ids, current_date) k
    join public.accounts a on a.id = k.account_id
    where k.cents <> 0 and not private.conta_no_disponivel(a.type, a.spendable)
  )
  select jsonb_build_object(
    'estado', c.estado,
    'ini', c.ini,
    'fim', c.fim,
    'partida', case when c.estado = 'aberto' then jsonb_build_object(
        'tipo', 'contas',
        'cents', private.cash_total(ws_ids, current_date),
        'contas', coalesce((select jsonb_agg(jsonb_build_object(
            'account_id', k.account_id, 'nome', k.nome, 'tipo', k.tipo, 'cents', k.cents)
            order by k.cents desc, k.nome) from contas k), '[]'::jsonb))
      else jsonb_build_object(
        'tipo', case when c.estado = 'previsto' then 'anterior' else 'inicio' end,
        'cents', c.comecei_com,
        'contas', '[]'::jsonb) end,
    'entra', coalesce((select sum(e.in_cents) from ev e), 0),
    'sai', coalesce((select sum(e.out_cents) from ev e), 0),
    'por_origem', coalesce((select jsonb_agg(jsonb_build_object(
        'origin', e.origin, 'in_cents', e.in_cents, 'out_cents', e.out_cents) order by e.origin)
        from ev e), '[]'::jsonb),
    'resultado', c.resultado,
    'caixa_no_fim', c.caixa_no_fim,
    'faltou_pagar', c.faltou_pagar,
    'fora', coalesce((select jsonb_agg(jsonb_build_object(
        'account_id', k.account_id, 'nome', k.nome, 'tipo', k.tipo, 'cents', k.cents)
        order by k.cents desc, k.nome) from fora k), '[]'::jsonb)
  )
  from c;
$function$;

CREATE OR REPLACE FUNCTION public.create_account(p_input jsonb, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  receipt jsonb;
  created_id uuid;
  current_account public.accounts%rowtype;
  account_name text;
  account_type text;
  ws uuid;
  initial_cents bigint;
  limit_cents bigint;
  close_day int;
  payment_day int;
  payer uuid;
  rate numeric;
  inclusive boolean;
  automatic boolean;
  spend boolean;
  field text;
  value numeric;
begin
  if jsonb_typeof(p_input) is distinct from 'object' then
    raise exception using errcode='22023', message='Dados da conta inválidos';
  end if;
  receipt:=private.reserve_payment_request(p_request_id,
    jsonb_build_object('operation','create_account','input',p_input));
  if receipt is null then
    if exists(select 1 from jsonb_object_keys(p_input) k where k not in
      ('name','type','initial_balance_cents','closing_day','due_day','credit_limit_cents',
       'payment_account_id','closing_day_inclusive','rotativo_auto','rotativo_rate_monthly','spendable'))
      or jsonb_typeof(p_input->'name') is distinct from 'string'
      or jsonb_typeof(p_input->'type') is distinct from 'string' then
      raise exception using errcode='22023', message='Dados da conta inválidos';
    end if;
    account_name:=regexp_replace(p_input->>'name','^[[:space:]]+|[[:space:]]+$','','g');
    account_type:=p_input->>'type';
    if account_name='' or account_type not in('checking','savings','credit_card','cash','investment') then
      raise exception using errcode='22023', message='Informe um nome e um tipo de conta válidos';
    end if;
    if jsonb_typeof(p_input->'initial_balance_cents') is distinct from 'number' then
      raise exception using errcode='22023', message='Saldo da conta precisa ser informado em centavos inteiros';
    end if;
    value:=(p_input->>'initial_balance_cents')::numeric;
    if value<>trunc(value) or abs(value)>9007199254740991 or (value<0 and account_type<>'checking') then
      raise exception using errcode='22023', message='Saldo da conta inválido';
    end if;
    initial_cents:=value::bigint;
    foreach field in array array['closing_day_inclusive','rotativo_auto'] loop
      if p_input ? field and jsonb_typeof(p_input->field) is distinct from 'boolean' then
        raise exception using errcode='22023', message='Opção do cartão inválida';
      end if;
    end loop;
    inclusive:=coalesce((p_input->>'closing_day_inclusive')::boolean,false);
    automatic:=coalesce((p_input->>'rotativo_auto')::boolean,false);
    if p_input ? 'spendable' and jsonb_typeof(p_input->'spendable') not in ('boolean','null') then
      raise exception using errcode='22023', message='Opção "Conta no Dá para gastar" inválida';
    end if;
    spend:=case when jsonb_typeof(p_input->'spendable')='boolean' then (p_input->>'spendable')::boolean end;
    if account_type='credit_card' and spend is not null then
      raise exception using errcode='22023', message='Cartão não entra no Dá para gastar';
    end if;
    if account_type='credit_card' then
      if initial_cents<>0 then
        raise exception using errcode='22023', message='Um novo cartão começa sem saldo inicial';
      end if;
      foreach field in array array['closing_day','due_day'] loop
        if jsonb_typeof(p_input->field) is distinct from 'number' then
          raise exception using errcode='22023', message='Informe os dias de fechamento e vencimento, de 1 a 31';
        end if;
        value:=(p_input->>field)::numeric;
        if value<>trunc(value) or value<1 or value>31 then
          raise exception using errcode='22023', message='Dias do cartão precisam ser inteiros de 1 a 31';
        end if;
      end loop;
      close_day:=(p_input->>'closing_day')::numeric::int;
      payment_day:=(p_input->>'due_day')::numeric::int;
      limit_cents:=0;
      if p_input->>'credit_limit_cents' is not null then
        if jsonb_typeof(p_input->'credit_limit_cents') is distinct from 'number' then
          raise exception using errcode='22023', message='Limite do cartão inválido';
        end if;
        value:=(p_input->>'credit_limit_cents')::numeric;
        if value<>trunc(value) or value<0 or value>9007199254740991 then
          raise exception using errcode='22023', message='Limite do cartão precisa ser informado em centavos inteiros';
        end if;
        limit_cents:=value::bigint;
      end if;
      if p_input->>'rotativo_rate_monthly' is not null then
        if jsonb_typeof(p_input->'rotativo_rate_monthly') is distinct from 'number' then
          raise exception using errcode='22023', message='Taxa mensal do cartão inválida';
        end if;
        rate:=(p_input->>'rotativo_rate_monthly')::numeric;
        if rate<0 or rate>1 then
          raise exception using errcode='22023', message='Taxa mensal do cartão precisa estar entre 0 e 100%';
        end if;
      end if;
      if p_input->>'payment_account_id' is not null then
        if jsonb_typeof(p_input->'payment_account_id') is distinct from 'string' then
          raise exception using errcode='22023', message='Conta pagadora inválida';
        end if;
        begin
          payer:=(p_input->>'payment_account_id')::uuid;
        exception when invalid_text_representation then
          raise exception using errcode='22023', message='Conta pagadora inválida';
        end;
      end if;
    else
      if p_input->>'closing_day' is not null or p_input->>'due_day' is not null
        or p_input->>'credit_limit_cents' is not null or p_input->>'payment_account_id' is not null
        or p_input->>'rotativo_rate_monthly' is not null or inclusive or automatic then
        raise exception using errcode='22023', message='Campos de cartão não se aplicam a esta conta';
      end if;
    end if;
    ws:=public.my_default_workspace();
    if ws is null then
      raise exception using errcode='42501', message='Nenhum espaço disponível para criar a conta';
    end if;
    if payer is not null then
      -- Lock the eligible payer until insertion completes; this is creation-only validation.
      perform 1 from public.accounts a where a.id=payer and a.workspace_id=ws
        and a.type<>'credit_card' and not a.archived for share;
      if not found then
        raise exception using errcode='22023', message='Escolha uma conta pagadora ativa deste espaço que não seja cartão';
      end if;
    end if;
    insert into public.accounts(user_id,workspace_id,name,type,initial_balance_cents,
      closing_day,due_day,credit_limit_cents,payment_account_id,closing_day_inclusive,rotativo_auto,rotativo_rate_monthly,spendable)
    values(auth.uid(),ws,account_name,account_type,initial_cents,close_day,payment_day,
      limit_cents,payer,inclusive,automatic,rate,spend) returning id into created_id;
    receipt:=jsonb_build_object('id',created_id);
    perform private.finish_payment_request(p_request_id,receipt);
  end if;
  created_id:=(receipt->>'id')::uuid;
  -- Read mutable state under current RLS. A receipt survives deletion and never recreates it.
  select * into current_account from public.accounts a where a.id=created_id;
  if not found then
    return jsonb_build_object('id',created_id,'availability','unavailable','account',null);
  end if;
  return jsonb_build_object('id',created_id,'availability',
    case when current_account.archived then 'archived' else 'active' end,
    'account',to_jsonb(current_account));
end;
$function$;

drop function if exists public.account_balances();
CREATE FUNCTION public.account_balances()
 RETURNS TABLE(account_id uuid, name text, type text, balance_cents bigint, cleared_cents bigint, pending_in_cents bigint, pending_out_cents bigint, disponivel boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select a.id as account_id, a.name, a.type,
         (a.initial_balance_cents + coalesce(sum(s.sinal), 0))::bigint,
         (a.initial_balance_cents
          + coalesce(sum(s.sinal) filter (where t.status = 'cleared'), 0))::bigint,
         coalesce( sum(s.sinal) filter (where t.status = 'pending' and s.sinal > 0), 0)::bigint,
         coalesce(-sum(s.sinal) filter (where t.status = 'pending' and s.sinal < 0), 0)::bigint,
         private.conta_no_disponivel(a.type, a.spendable)
  from public.accounts a
  left join public.transactions t
    on t.workspace_id = a.workspace_id
   and (t.account_id = a.id or t.counterparty_account_id = a.id)
   and not exists (
     select 1 from public.card_invoices ci
     where ci.id = t.invoice_id and ci.settled_manually
   )
  left join lateral (
    select case
      when t.kind = 'income'   and t.account_id = a.id then  t.amount_cents
      when t.kind = 'expense'  and t.account_id = a.id then -t.amount_cents
      when t.kind = 'transfer' and t.account_id = a.id then -t.amount_cents
      when t.kind = 'transfer' and t.counterparty_account_id = a.id then t.amount_cents
      else 0 end as sinal
  ) s on true
  where a.workspace_id in (select private.my_workspace_ids()) and not a.archived
  group by a.id
  union all
  select null::uuid, 'Sem conta', 'none',
         sum(case when t.kind = 'income' then t.amount_cents else -t.amount_cents end)::bigint,
         coalesce(sum(case when t.kind = 'income' then t.amount_cents else -t.amount_cents end)
                  filter (where t.status = 'cleared'), 0)::bigint,
         coalesce(sum(t.amount_cents) filter (where t.status = 'pending' and t.kind = 'income'), 0)::bigint,
         coalesce(sum(t.amount_cents) filter (where t.status = 'pending' and t.kind = 'expense'), 0)::bigint,
         true
  from public.transactions t
  where t.workspace_id in (select private.my_workspace_ids())
    and t.account_id is null and t.kind <> 'transfer'
  having count(*) > 0;
$function$;
revoke execute on function public.account_balances() from public, anon;
grant execute on function public.account_balances() to authenticated, service_role;

drop function if exists public._account_balances(uuid);
CREATE FUNCTION public._account_balances(uid uuid)
 RETURNS TABLE(account_id uuid, name text, type text, balance_cents bigint, cleared_cents bigint, pending_in_cents bigint, pending_out_cents bigint, disponivel boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select a.id as account_id, a.name, a.type,
         (a.initial_balance_cents + coalesce(sum(s.sinal), 0))::bigint,
         (a.initial_balance_cents
          + coalesce(sum(s.sinal) filter (where t.status = 'cleared'), 0))::bigint,
         coalesce( sum(s.sinal) filter (where t.status = 'pending' and s.sinal > 0), 0)::bigint,
         coalesce(-sum(s.sinal) filter (where t.status = 'pending' and s.sinal < 0), 0)::bigint,
         private.conta_no_disponivel(a.type, a.spendable)
  from public.accounts a
  left join public.transactions t
    on t.workspace_id = a.workspace_id
   and (t.account_id = a.id or t.counterparty_account_id = a.id)
   and not exists (
     select 1 from public.card_invoices ci
     where ci.id = t.invoice_id and ci.settled_manually
   )
  left join lateral (
    select case
      when t.kind = 'income'   and t.account_id = a.id then  t.amount_cents
      when t.kind = 'expense'  and t.account_id = a.id then -t.amount_cents
      when t.kind = 'transfer' and t.account_id = a.id then -t.amount_cents
      when t.kind = 'transfer' and t.counterparty_account_id = a.id then t.amount_cents
      else 0 end as sinal
  ) s on true
  where a.workspace_id in (select public._workspace_ids(uid)) and not a.archived
  group by a.id
  union all
  select null::uuid, 'Sem conta', 'none',
         sum(case when t.kind = 'income' then t.amount_cents else -t.amount_cents end)::bigint,
         coalesce(sum(case when t.kind = 'income' then t.amount_cents else -t.amount_cents end)
                  filter (where t.status = 'cleared'), 0)::bigint,
         coalesce(sum(t.amount_cents) filter (where t.status = 'pending' and t.kind = 'income'), 0)::bigint,
         coalesce(sum(t.amount_cents) filter (where t.status = 'pending' and t.kind = 'expense'), 0)::bigint,
         true
  from public.transactions t
  where t.workspace_id in (select public._workspace_ids(uid))
    and t.account_id is null and t.kind <> 'transfer'
  having count(*) > 0;
$function$;
revoke execute on function public._account_balances(uuid) from public, anon, authenticated;
grant execute on function public._account_balances(uuid) to service_role;
