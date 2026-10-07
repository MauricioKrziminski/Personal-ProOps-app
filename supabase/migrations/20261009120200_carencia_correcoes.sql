-- Correções da carência (revisão 1): âncora cravada sem first_due_date, dívida sem nº de parcelas,
-- desfazer recusa dívida editada depois, validação de entrada.
alter table public.debt_pauses
  add column if not exists first_due_before date,
  add column if not exists first_due_set boolean not null default false,
  add column if not exists balance_after_cents bigint,
  add column if not exists installment_after_cents bigint,
  add column if not exists first_due_after date;

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
    ancora_antes := d.first_due_date;
    ancora_depois := d.first_due_date;
    -- Sem âncora a data da próxima desliza com o HOJE e a carência nunca acabaria: crava a âncora
    -- que reproduz o cronograma de agora (a próxima parcela, recuada `pagas` meses no dia do vencimento).
    if d.first_due_date is null then
      prox := (antes->>'next')::date;
      if prox is not null then
        ancora_depois := private.day_in_month(private.add_months(prox, -d.installments_paid),
                                              coalesce(d.due_day, extract(day from prox)::int));
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
  if p.balance_after_cents is not null and (
       d.remaining_cents is distinct from p.balance_after_cents
       or d.installment_cents is distinct from p.installment_after_cents
       or d.first_due_date is distinct from p.first_due_after) then
    raise exception using errcode = 'P0001',
      message = 'A dívida mudou depois da carência: desfaça a mudança antes';
  end if;
  update public.debts x set
    remaining_cents = case when d.calculation_mode = 'amortized' and coalesce(d.interest_rate_monthly, 0) > 0
                           then p.balance_before_cents else x.remaining_cents end,
    installment_cents = case when d.calculation_mode = 'amortized' and coalesce(d.interest_rate_monthly, 0) > 0
                             then p.installment_before_cents else x.installment_cents end,
    first_due_date = case when p.first_due_set then p.first_due_before else x.first_due_date end
  where x.id = d.id;
  delete from public.debt_pauses x where x.id = p.id;
  return jsonb_build_object('undone', true);
end $$;
revoke execute on function private.debt_pause(uuid, int, int, uuid, boolean) from public, anon;
grant execute on function private.debt_pause(uuid, int, int, uuid, boolean) to authenticated;
revoke execute on function private.undo_debt_pause(uuid, uuid) from public, anon;
grant execute on function private.undo_debt_pause(uuid, uuid) to authenticated;
