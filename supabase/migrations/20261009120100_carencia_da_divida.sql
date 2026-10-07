-- Carência (spec 2026-10-07-pausar-e-carencia-design.md §2).
create table if not exists public.debt_pauses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  debt_id uuid not null references public.debts(id) on delete cascade,
  from_installment_no int not null check (from_installment_no >= 1),
  months int not null check (months between 1 and 24),
  balance_before_cents bigint not null,
  installment_before_cents bigint,
  installments_paid_at int not null,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists debt_pauses_debt_idx on public.debt_pauses(debt_id);
alter table public.debt_pauses enable row level security;
revoke all on public.debt_pauses from public, anon, authenticated;
grant select on public.debt_pauses to authenticated;
create policy debt_pauses_member_read on public.debt_pauses for select
  using (workspace_id in (select private.my_workspace_ids()));
alter publication supabase_realtime add table public.debt_pauses;

create or replace function private.debt_pause_shift(p_debt_id uuid, p_installment_no int)
returns int language sql stable set search_path = '' as $$
  select coalesce(sum(p.months), 0)::int from public.debt_pauses p
  where p.debt_id = p_debt_id and p.from_installment_no <= p_installment_no
$$;
revoke execute on function private.debt_pause_shift(uuid, int) from public, anon;
grant execute on function private.debt_pause_shift(uuid, int) to authenticated, service_role;

-- Cronograma: a carência desloca a data das parcelas (qualquer ramo: com e sem âncora). Corpo de 20261005190000 + o deslocamento.
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
             -- ⚠️ Com âncora, o calendário é o do CONTRATO, sem piso de hoje (05/10/2026): a parcela
             -- `pagas + 1` fica na data dela mesmo vencida — é parcela ATRASADA, não uma que
             -- desliza para o mês seguinte e arrasta as demais. Quem projeta caixa clampa para
             -- hoje (`eventos_de_caixa`); quem lista mostra a data e marca o atraso. O ramo
             -- "pago no ciclo" NÃO entra aqui (revisão final de 23/09/2026).
             when d.first_due_date is not null then
               private.day_in_month(private.add_months(d.first_due_date, d.installments_paid),
                                    (select valor from dia))
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
           private.add_months((select primeiro from parametros),
             a.installment_no - 1
             + private.debt_pause_shift(p_debt_id, a.installment_no + coalesce((select pagas from parametros), 0))),
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
create table if not exists private.debt_pause_receipts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, request_id)
);
alter table private.debt_pause_receipts enable row level security;
revoke all on private.debt_pause_receipts from public, anon, authenticated, service_role;

create or replace function private.debt_pause(
  p_debt_id uuid, p_from_installment_no int, p_months int, p_request_id uuid, p_apply boolean
) returns jsonb
language plpgsql security definer
set search_path = ''
set timezone to 'America/Sao_Paulo'
as $$
declare
  uid uuid := auth.uid();
  d public.debts%rowtype;
  sealed private.debt_pause_receipts%rowtype;
  intent jsonb;
  com_juros boolean;
  saldo bigint;
  nova_parcela bigint;
  restantes int;
  antes jsonb;
  depois jsonb;
  novo_id uuid := gen_random_uuid();
  result jsonb;
begin
  if uid is null then
    raise exception using errcode = '42501', message = 'Autenticação obrigatória';
  end if;
  if p_months is null or p_months < 1 or p_months > 24 then
    raise exception using errcode = '22023', message = 'A carência vai de 1 a 24 meses';
  end if;
  if p_apply and p_request_id is null then
    raise exception using errcode = '22023', message = 'Identificador da tentativa obrigatório';
  end if;
  select * into d from public.debts x where x.id = p_debt_id;
  if d.id is null or not exists (select 1 from public.workspace_members m
                                 where m.workspace_id = d.workspace_id and m.user_id = uid) then
    raise exception using errcode = 'P0001', message = 'Dívida não encontrada';
  end if;
  if p_apply then
    intent := jsonb_build_object('operation', 'debt_pause', 'debt_id', p_debt_id,
                                 'from', p_from_installment_no, 'months', p_months);
    perform pg_advisory_xact_lock(hashtextextended('debt-pause:' || d.id::text, 0));
    select * into sealed from private.debt_pause_receipts where user_id = uid and request_id = p_request_id;
    if sealed.request_id is not null then
      if sealed.payload is distinct from intent then
        raise exception using errcode = '22023', message = 'Identificador reutilizado com dados diferentes';
      end if;
      return sealed.result;
    end if;
    select * into d from public.debts x where x.id = p_debt_id for update;
  end if;
  if d.archived or d.remaining_cents <= 0 then
    raise exception using errcode = 'P0001', message = 'Esta dívida já está quitada ou arquivada';
  end if;
  if p_from_installment_no <= d.installments_paid then
    raise exception using errcode = 'P0001',
      message = 'A ' || p_from_installment_no || 'ª parcela já paga não entra em carência: comece pela próxima';
  end if;
  if exists (select 1 from public.debt_pauses p where p.debt_id = d.id
             and p_from_installment_no < p.from_installment_no + p.months
             and p.from_installment_no < p_from_installment_no + p_months) then
    raise exception using errcode = 'P0001', message = 'Já existe outra carência nesse período: desfaça-a antes';
  end if;
  com_juros := d.calculation_mode = 'amortized' and coalesce(d.interest_rate_monthly, 0) > 0;
  if com_juros and p_from_installment_no <> d.installments_paid + 1 then
    raise exception using errcode = 'P0001',
      message = 'Com juros, a carência começa na próxima parcela em aberto (a ' || (d.installments_paid + 1) || 'ª)';
  end if;

  select jsonb_build_object('next', min(s.due_date), 'end', max(s.due_date),
           'installment', (array_agg(s.payment_cents order by s.installment_no))[1])
    into antes from private.debt_schedule_for(d.id) s;

  -- A escrita REAL roda num bloco que volta na prévia (as variáveis sobrevivem ao rollback do bloco).
  begin
    saldo := d.remaining_cents;
    nova_parcela := d.installment_cents;
    if com_juros then
      for i in 1..p_months loop
        saldo := saldo + ceil(saldo::numeric * d.interest_rate_monthly)::bigint;
      end loop;
      restantes := coalesce(d.installments, 0) - d.installments_paid;
      if d.installment_cents is not null then
        nova_parcela := private.price_installment(saldo, d.interest_rate_monthly, restantes);
      end if;
      update public.debts x set remaining_cents = saldo, installment_cents = nova_parcela where x.id = d.id;
    end if;
    insert into public.debt_pauses(id, workspace_id, debt_id, from_installment_no, months,
      balance_before_cents, installment_before_cents, installments_paid_at, created_by)
    values (novo_id, d.workspace_id, d.id, p_from_installment_no, p_months,
      d.remaining_cents, d.installment_cents, d.installments_paid, uid);
    select jsonb_build_object('next', min(s.due_date), 'end', max(s.due_date),
             'installment', (array_agg(s.payment_cents order by s.installment_no))[1])
      into depois from private.debt_schedule_for(d.id) s;
    if not p_apply then
      raise exception using errcode = 'P0099', message = 'previa';
    end if;
  exception when sqlstate 'P0099' then
    null;
  end;

  result := jsonb_build_object(
    'next_before', antes->>'next', 'next_after', depois->>'next',
    'installment_before', (antes->>'installment')::bigint, 'installment_after', (depois->>'installment')::bigint,
    'balance_before', d.remaining_cents, 'balance_after', saldo,
    'end_before', antes->>'end', 'end_after', depois->>'end',
    'with_interest', com_juros);
  if not p_apply then return result; end if;
  insert into private.debt_pause_receipts(user_id, request_id, workspace_id, payload, result)
    values (uid, p_request_id, d.workspace_id, intent, result || jsonb_build_object('pause_id', novo_id));
  return result || jsonb_build_object('pause_id', novo_id);
end $$;
revoke execute on function private.debt_pause(uuid, int, int, uuid, boolean) from public, anon;
grant execute on function private.debt_pause(uuid, int, int, uuid, boolean) to authenticated;

create or replace function private.undo_debt_pause(p_pause_id uuid, p_request_id uuid)
returns jsonb language plpgsql security definer
set search_path = ''
set timezone to 'America/Sao_Paulo'
as $$
declare
  uid uuid := auth.uid();
  p public.debt_pauses%rowtype;
  d public.debts%rowtype;
begin
  if uid is null then
    raise exception using errcode = '42501', message = 'Autenticação obrigatória';
  end if;
  select * into p from public.debt_pauses x where x.id = p_pause_id;
  if p.id is null then
    -- idempotente: a carência já foi desfeita
    return jsonb_build_object('undone', true);
  end if;
  if not exists (select 1 from public.workspace_members m where m.workspace_id = p.workspace_id and m.user_id = uid) then
    raise exception using errcode = 'P0001', message = 'Carência não encontrada';
  end if;
  select * into d from public.debts x where x.id = p.debt_id for update;
  if d.installments_paid <> p.installments_paid_at then
    raise exception using errcode = 'P0001',
      message = 'Já houve pagamento depois da carência: desfaça o pagamento antes';
  end if;
  update public.debts x set remaining_cents = p.balance_before_cents,
    installment_cents = p.installment_before_cents where x.id = d.id
    and (d.calculation_mode = 'amortized' and coalesce(d.interest_rate_monthly, 0) > 0);
  delete from public.debt_pauses x where x.id = p.id;
  return jsonb_build_object('undone', true);
end $$;
revoke execute on function private.undo_debt_pause(uuid, uuid) from public, anon;
grant execute on function private.undo_debt_pause(uuid, uuid) to authenticated;

create or replace function public.debt_pause(p_debt_id uuid, p_from_installment_no int, p_months int, p_request_id uuid)
returns jsonb language sql security invoker set search_path = '' set timezone to 'America/Sao_Paulo' as $$
  select private.debt_pause(p_debt_id, p_from_installment_no, p_months, p_request_id, true)
$$;
create or replace function public.debt_pause_preview(p_debt_id uuid, p_from_installment_no int, p_months int)
returns jsonb language sql security invoker set search_path = '' set timezone to 'America/Sao_Paulo' as $$
  select private.debt_pause(p_debt_id, p_from_installment_no, p_months, null, false)
$$;
create or replace function public.undo_debt_pause(p_pause_id uuid, p_request_id uuid)
returns jsonb language sql security invoker set search_path = '' set timezone to 'America/Sao_Paulo' as $$
  select private.undo_debt_pause(p_pause_id, p_request_id)
$$;
revoke execute on function public.debt_pause(uuid, int, int, uuid) from public, anon;
revoke execute on function public.debt_pause_preview(uuid, int, int) from public, anon;
revoke execute on function public.undo_debt_pause(uuid, uuid) from public, anon;
grant execute on function public.debt_pause(uuid, int, int, uuid) to authenticated;
grant execute on function public.debt_pause_preview(uuid, int, int) to authenticated;
grant execute on function public.undo_debt_pause(uuid, uuid) to authenticated;
