-- Carência (revisão final): a data das parcelas já pagas também leva o deslocamento; e uma segunda
-- carência, de outra parcela, é aceita (os deslocamentos somam; o desfazer segue LIFO).

create or replace function private.debt_projected_due_date(p_debt_id uuid, p_installment_no int)
returns date language plpgsql stable security invoker
set search_path = public
set "TimeZone" = 'America/Sao_Paulo'
as $$
declare
  d record;
  projected date;
  anchor date;
  target_day int;
begin
  select * into d from public.debts where id=p_debt_id;
  if d.id is null or p_installment_no is null or p_installment_no < 1 then return null; end if;
  target_day := coalesce(d.due_day, extract(day from d.started_at)::int);
  if p_installment_no > d.installments_paid then
    select s.due_date into projected from public.debt_schedule(p_debt_id) s
      where s.installment_no=p_installment_no;
    if projected is not null then return projected; end if;
  end if;
  if d.first_due_date is not null then
    return private.day_in_month(private.add_months(d.first_due_date,p_installment_no-1+private.debt_pause_shift(p_debt_id,p_installment_no)),target_day);
  end if;
  select s.due_date into anchor from public.debt_schedule(p_debt_id) s
    order by s.installment_no limit 1;
  return private.day_in_month(
    private.add_months(coalesce(anchor,current_date),p_installment_no-d.installments_paid-1),
    target_day);
end;
$$;
revoke execute on function private.debt_projected_due_date(uuid,int) from public, anon;
grant execute on function private.debt_projected_due_date(uuid,int) to authenticated, service_role;

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
  ancora_antes date;
  ancora_depois date;
  prox date;
  prox_no int;
  dia int;
  cd int;
  fim date;
  result jsonb;
begin
  if uid is null then
    raise exception using errcode = '42501', message = 'Autenticação obrigatória';
  end if;
  if p_months is null or p_months < 1 or p_months > 24 then
    raise exception using errcode = '22023', message = 'A carência vai de 1 a 24 meses';
  end if;
  if p_from_installment_no is null or p_from_installment_no < 1 then
    raise exception using errcode = '22023', message = 'Informe a parcela em que a carência começa';
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
  if d.installments is not null and p_from_installment_no > d.installments then
    raise exception using errcode = '22023',
      message = 'A dívida tem ' || d.installments || ' parcelas: não existe a ' || p_from_installment_no || 'ª';
  end if;
  if p_from_installment_no <= d.installments_paid then
    raise exception using errcode = 'P0001',
      message = 'A ' || p_from_installment_no || 'ª parcela já paga não entra em carência: comece pela próxima';
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
    ancora_antes := d.first_due_date;
    ancora_depois := d.first_due_date;
    -- Sem âncora a data da próxima desliza com o HOJE e a carência nunca acabaria: crava a âncora
    -- que reproduz o cronograma de agora (a próxima parcela, recuada `pagas` meses no dia do vencimento).
    if d.first_due_date is null then
      dia := coalesce(d.due_day, extract(day from d.started_at)::int);
      -- a data vem da 1ª parcela SEM data editada (a editada não diz onde está o calendário)
      select s.due_date, s.installment_no into prox, prox_no
        from private.debt_schedule_for(d.id) s
        where not exists (select 1 from public.debt_installment_edits e
                          where e.debt_id = d.id and e.installment_no = s.installment_no and e.due_date is not null)
        order by s.installment_no limit 1;
      if prox is null then
        -- todas editadas: a data de fórmula da próxima, como o ramo sem âncora do cronograma
        prox_no := d.installments_paid + 1;
        cd := private.cycle_close_day(array[d.workspace_id]);
        select b.fim into fim from private.cycle_bounds(cd, private.cycle_month_of(cd, current_date)) b;
        if private.debt_paid_in_cycle(d.id, current_date) then
          prox := case when private.day_in_month(fim + 1, dia) > fim then private.day_in_month(fim + 1, dia)
                       else private.day_in_month(private.add_months(fim + 1, 1), dia) end;
        elsif private.day_in_month(current_date, dia) >= current_date then
          prox := private.day_in_month(current_date, dia);
        else
          prox := private.day_in_month(private.add_months(current_date, 1), dia);
        end if;
      end if;
      if prox is not null then
        ancora_depois := private.day_in_month(private.add_months(prox, -(prox_no - 1)), dia);
        update public.debts x set first_due_date = ancora_depois where x.id = d.id;
      end if;
    end if;
    if com_juros then
      for i in 1..p_months loop
        saldo := saldo + ceil(saldo::numeric * d.interest_rate_monthly)::bigint;
      end loop;
      restantes := coalesce(d.installments, 0) - d.installments_paid;
      -- dívida sem número de parcelas: só capitaliza, a parcela fica como está
      if d.installment_cents is not null and restantes > 0 then
        nova_parcela := private.price_installment(saldo, d.interest_rate_monthly, restantes);
      end if;
      update public.debts x set remaining_cents = saldo, installment_cents = nova_parcela where x.id = d.id;
    end if;
    insert into public.debt_pauses(id, workspace_id, debt_id, from_installment_no, months,
      balance_before_cents, installment_before_cents, installments_paid_at, created_by,
      first_due_before, first_due_set, balance_after_cents, installment_after_cents, first_due_after)
    values (novo_id, d.workspace_id, d.id, p_from_installment_no, p_months,
      d.remaining_cents, d.installment_cents, d.installments_paid, uid,
      ancora_antes, (d.first_due_date is null and ancora_depois is not null), saldo, nova_parcela, ancora_depois);
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
