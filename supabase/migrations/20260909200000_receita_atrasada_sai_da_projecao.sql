-- Receita atrasada para de inflar a projeção depois de três dias.
--
-- `greatest(coalesce(due_at, occurred_at), current_date)` empurra qualquer previsto vencido para
-- HOJE. Para despesa isso é certo — um boleto atrasado continua saindo do caixa. Para receita era
-- o anti-padrão que a prática de contas a receber nomeia com todas as letras: *"resista ao impulso
-- de assumir que o atrasado vai ser pago mais rápido do que historicamente foi"*. O app assumia a
-- versão extrema: que chega HOJE, e reassumia isso todo dia, para sempre.
--
-- Sem histórico de pontualidade para ponderar, a régua honesta é a que o app já usa para cutucar:
-- o alerta `income_to_confirm` (`20260909120000`) dispara no dia previsto e três dias depois.
-- Passado o segundo toque sem confirmação, a projeção para de contar — o sistema cobra duas vezes
-- e então deixa de contar com o dinheiro, que é o que uma pessoa faria.
--
-- **Some do número, não da tela**: o lançamento continua em "O que entra" com a pílula "não caiu",
-- e volta inteiro ao saldo no dia em que o usuário marcar "Recebi".

drop function if exists public._cash_flow_forecast(uuid, integer);

create function public._cash_flow_forecast(uid uuid, days integer DEFAULT 90)
 RETURNS TABLE(day date, in_cents bigint, out_cents bigint, balance_cents bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with horizonte as (select least(greatest(coalesce(days, 90), 1), 365) as dias),
  saldo_inicial as (
    select private.cash_total(array(select public._workspace_ids(uid))) as cents
  ),
  eventos as (
    select greatest(ci.due_date, current_date) as day,
           0::bigint as in_cents,
           private.invoice_open_cents(ci.id) as out_cents
    from public.card_invoices ci
    join public.transactions t on t.invoice_id = ci.id and t.kind = 'expense'
    where ci.workspace_id in (select public._workspace_ids(uid))
      and ci.status <> 'paid'
    group by ci.id, ci.due_date
    union all
    select greatest(coalesce(t.due_at, t.occurred_at), current_date),
           case when t.kind = 'income'  then t.amount_cents else 0 end::bigint,
           case when t.kind = 'expense' then t.amount_cents else 0 end::bigint
    from public.transactions t
    where t.workspace_id in (select public._workspace_ids(uid))
      and t.status = 'pending' and t.invoice_id is null and t.kind <> 'transfer'
      -- ⚠️ RECEITA atrasada sai da projeção depois da janela de graça; DESPESA não.
      --
      -- A assimetria é o ponto. Um boleto vencido continua saindo do caixa: você atrasou, mas
      -- ainda deve. Uma receita que não chegou depende de outra pessoa, e `greatest(..., today)`
      -- reassumia todo santo dia que ela cai HOJE — a projeção nunca desistia, e o saldo ficava
      -- otimista para sempre.
      --
      -- É o anti-padrão que a prática de contas a receber nomeia: "não assuma que o atrasado
      -- vai ser pago mais rápido do que historicamente foi". A versão honesta sem histórico de
      -- pontualidade é usar o que o app já faz: o alerta `income_to_confirm` cutuca no dia e
      -- três dias depois. Passado o segundo toque sem confirmação, para de contar.
      --
      -- O lançamento NÃO some da tela: continua em "O que entra" com a pílula "não caiu". Sai
      -- do número, não da vista — e volta inteiro no dia em que você marcar "Recebi".
      and (t.kind <> 'income'
           or coalesce(t.due_at, t.occurred_at) >= current_date - 3)
    union all
    -- (c) prestação de dívida/financiamento em aberto: sai do caixa no vencimento
    select greatest(s.due_date, current_date), 0::bigint, s.payment_cents
    from public.debts d
    cross join lateral private.debt_schedule_for(d.id) s
    where d.workspace_id in (select public._workspace_ids(uid))
      and not d.archived and d.remaining_cents > 0
      and s.due_date <= current_date + (select dias from horizonte)
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
revoke execute on function public._cash_flow_forecast(uuid, integer) from public, anon, authenticated;

drop function if exists public.cash_flow_forecast(integer);

create function public.cash_flow_forecast(days integer DEFAULT 90)
 RETURNS TABLE(day date, in_cents bigint, out_cents bigint, balance_cents bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with horizonte as (select least(greatest(coalesce(days, 90), 1), 365) as dias),
  saldo_inicial as (
    select private.cash_total(array(select private.my_workspace_ids())) as cents
  ),
  eventos as (
    select greatest(ci.due_date, current_date) as day,
           0::bigint as in_cents,
           private.invoice_open_cents(ci.id) as out_cents
    from public.card_invoices ci
    join public.transactions t on t.invoice_id = ci.id and t.kind = 'expense'
    where ci.workspace_id in (select private.my_workspace_ids())
      and ci.status <> 'paid'
    group by ci.id, ci.due_date
    union all
    select greatest(coalesce(t.due_at, t.occurred_at), current_date),
           case when t.kind = 'income'  then t.amount_cents else 0 end::bigint,
           case when t.kind = 'expense' then t.amount_cents else 0 end::bigint
    from public.transactions t
    where t.workspace_id in (select private.my_workspace_ids())
      and t.status = 'pending' and t.invoice_id is null and t.kind <> 'transfer'
      -- ⚠️ RECEITA atrasada sai da projeção depois da janela de graça; DESPESA não.
      --
      -- A assimetria é o ponto. Um boleto vencido continua saindo do caixa: você atrasou, mas
      -- ainda deve. Uma receita que não chegou depende de outra pessoa, e `greatest(..., today)`
      -- reassumia todo santo dia que ela cai HOJE — a projeção nunca desistia, e o saldo ficava
      -- otimista para sempre.
      --
      -- É o anti-padrão que a prática de contas a receber nomeia: "não assuma que o atrasado
      -- vai ser pago mais rápido do que historicamente foi". A versão honesta sem histórico de
      -- pontualidade é usar o que o app já faz: o alerta `income_to_confirm` cutuca no dia e
      -- três dias depois. Passado o segundo toque sem confirmação, para de contar.
      --
      -- O lançamento NÃO some da tela: continua em "O que entra" com a pílula "não caiu". Sai
      -- do número, não da vista — e volta inteiro no dia em que você marcar "Recebi".
      and (t.kind <> 'income'
           or coalesce(t.due_at, t.occurred_at) >= current_date - 3)
    union all
    -- (c) prestação de dívida/financiamento em aberto: sai do caixa no vencimento
    select greatest(s.due_date, current_date), 0::bigint, s.payment_cents
    from public.debts d
    cross join lateral private.debt_schedule_for(d.id) s
    where d.workspace_id in (select private.my_workspace_ids())
      and not d.archived and d.remaining_cents > 0
      and s.due_date <= current_date + (select dias from horizonte)
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

