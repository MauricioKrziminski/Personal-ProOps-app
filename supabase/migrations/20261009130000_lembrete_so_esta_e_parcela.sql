-- Lembrete de conta: "só esta" SUBSTITUI o da série naquele vencimento, um aviso por coisa a
-- pagar, e o salvar recusa alvo que nunca vai tocar.
--
-- (1) Precedência, por ESPAÇO (o modelo é um conjunto de avisos por alvo no espaço; quem recebe é
--     quem salvou): o alvo mais específico de um vencimento cala os mais gerais NAQUELE vencimento.
--       fatura direta  >  uma ocorrência (transaction_id) / uma parcela da dívida  >  série, compra, dívida inteira
--     No cartão quem vence é a FATURA: um "só esta" numa compra dela (ou um lembrete da própria
--     fatura) cala o lembrete de série/compra para AQUELA fatura; as outras faturas seguem.
--     Não é botão de silenciar: "só esta" sempre SUBSTITUI (salvar `[]` apaga o "só esta", e o
--     da série volta a valer naquele vencimento).
-- (2) Um aviso por coisa a pagar: dois lembretes que chegam ao MESMO vencimento, para a mesma
--     pessoa, no mesmo dia e hora (duas compras de séries diferentes na mesma fatura) saem UMA vez,
--     com os canais somados. "Já enviado" vale para qualquer lembrete que cobria aquele vencimento
--     naquele dia e hora — inclusive o que acabou de perder a precedência (criar o "só esta" às
--     09:05 com o aviso das 09:00 já enviado pela série não manda de novo).
-- (3) `save_bill_reminder` recusa, ao GRAVAR avisos (remover sempre passa): o que não é conta a
--     pagar, a ocorrência já paga e a parcela da dívida fora do contrato ou já paga.
--
-- Corpos copiados da 20261007120200 (dues, save), da 20261007120100 (_bill_reminders_due, com o
-- filtro por espaço que tem lembrete) e da 20261007120000 (overview); só as partes marcadas mudam.

-- O lembrete `b` chega ao vencimento (target, ref)? A mesma régua de `bill_reminder_dues`, vista
-- do outro lado — serve para conferir o "já enviado" de quem não está mais na lista.
create or replace function private.bill_reminder_cobre(p_b public.bill_reminders, p_target text, p_ref uuid)
returns boolean
language sql stable security definer
set search_path = ''
set "TimeZone" to 'America/Sao_Paulo'
as $$
  select case p_target
    when 'debt' then p_b.debt_id = p_ref
    when 'transaction' then exists (
      select 1 from public.transactions t
      where t.id = p_ref and t.workspace_id = p_b.workspace_id
        and (t.id = p_b.transaction_id or t.recurring_id = p_b.recurring_id
             or t.installment_plan_id = p_b.installment_plan_id))
    when 'invoice' then p_b.invoice_id = p_ref or exists (
      select 1 from public.transactions t
      where t.invoice_id = p_ref and t.workspace_id = p_b.workspace_id
        and (t.id = p_b.transaction_id or t.recurring_id = p_b.recurring_id
             or t.installment_plan_id = p_b.installment_plan_id))
    else false end;
$$;
revoke execute on function private.bill_reminder_cobre(public.bill_reminders, text, uuid) from public, anon, authenticated;

create or replace function private.bill_reminder_dues(p_ws uuid[])
returns table (bill_reminder_id uuid, due_date date, title text, amount_cents bigint, target text, ref uuid)
language sql stable security definer
set search_path = ''
set "TimeZone" to 'America/Sao_Paulo'
as $$
  with r as (select * from public.bill_reminders b where b.workspace_id = any (p_ws)),
  linhas as (
    -- NOVO: `so_esta` = o lembrete é da própria linha (não da série/compra dela)
    select r.id as rid, (r.transaction_id is not null) as so_esta, t.*
    from r join public.transactions t
      on t.workspace_id = r.workspace_id
     and (t.id = r.transaction_id or t.recurring_id = r.recurring_id or t.installment_plan_id = r.installment_plan_id)
    where t.kind <> 'transfer'
  )
  select l.rid, coalesce(l.due_at, l.occurred_at),
         coalesce(l.description, l.merchant, l.category, 'Lançamento'), l.amount_cents, 'transaction', l.id
  from linhas l
  where l.invoice_id is null and l.status = 'pending'
    -- NOVO: a ocorrência com "só esta" não recebe o da série/compra
    and (l.so_esta or not exists (select 1 from public.bill_reminders b2 where b2.transaction_id = l.id))
  union
  select l.rid, ci.due_date, 'Fatura ' || a.name, private.invoice_open_cents(ci.id), 'invoice', ci.id
  from linhas l
  join public.card_invoices ci on ci.id = l.invoice_id and ci.status not in ('paid', 'rolled')
  join public.accounts a on a.id = ci.account_id
  -- NOVO: o lembrete da própria fatura cala os das compras; o "só esta" de uma compra cala o das séries
  where not exists (select 1 from public.bill_reminders b2 where b2.invoice_id = ci.id)
    and (l.so_esta or not exists (
      select 1 from public.bill_reminders b2 join public.transactions t2 on t2.id = b2.transaction_id
      where t2.invoice_id = ci.id))
  union
  select r.id, ci.due_date, 'Fatura ' || a.name, private.invoice_open_cents(ci.id), 'invoice', ci.id
  from r
  join public.card_invoices ci on ci.id = r.invoice_id and ci.status not in ('paid', 'rolled')
  join public.accounts a on a.id = ci.account_id
  union
  select r.id, s.due_date,
         coalesce(d.payment_description, 'Parcela ' || d.name) || ' (' || s.installment_no || coalesce('/' || d.installments, '') || ')',
         s.payment_cents, 'debt', d.id
  from r
  join public.debts d on d.id = r.debt_id and not d.archived and d.remaining_cents > 0
  cross join lateral private.debt_schedule_for(d.id) s
  where s.payment_cents is not null
    and (s.installment_no = r.debt_installment_no
         -- NOVO: a dívida inteira não toca a parcela que tem lembrete próprio
         or (r.debt_installment_no is null and not exists (
               select 1 from public.bill_reminders b2
               where b2.debt_id = d.id and b2.debt_installment_no = s.installment_no)));
$$;
revoke execute on function private.bill_reminder_dues(uuid[]) from public, anon, authenticated;

-- O que toca AGORA: um aviso por (pessoa, vencimento, dia, hora). O representante é o lembrete
-- de menor id do grupo, estável entre as rodadas do cron — é nele que o agente reserva o envio.
create or replace function public._bill_reminders_due()
returns table (bill_reminder_id uuid, user_id uuid, workspace_id uuid, due_date date, days_before int,
               title text, amount_cents bigint, target text, ref uuid, channel text,
               phone text, expo_push_token text, alerts_whatsapp_enabled boolean, attempts int)
language sql stable security definer
set search_path = ''
set "TimeZone" to 'America/Sao_Paulo'
as $$
  with hoje as (
    select d.bill_reminder_id, d.due_date, d.title, d.amount_cents, d.target, d.ref,
           b.user_id, b.workspace_id, b.days_before, b.at_time, b.channel
    from private.bill_reminder_dues((select array_agg(distinct r.workspace_id) from public.bill_reminders r)) d
    join public.bill_reminders b on b.id = d.bill_reminder_id
    where d.due_date - b.days_before = current_date
      and localtime >= b.at_time
  ),
  grupo as (
    select h.user_id, h.workspace_id, h.target, h.ref, h.due_date, h.days_before, h.at_time,
           min(h.bill_reminder_id::text)::uuid as rep,
           min(h.title) as title, min(h.amount_cents) as amount_cents,
           case when bool_or(h.channel in ('push', 'both')) and bool_or(h.channel in ('whatsapp', 'both')) then 'both'
                when bool_or(h.channel in ('push', 'both')) then 'push' else 'whatsapp' end as channel
    from hoje h
    group by 1, 2, 3, 4, 5, 6, 7
  )
  select g.rep, g.user_id, g.workspace_id, g.due_date, g.days_before, g.title, g.amount_cents, g.target, g.ref,
         g.channel, p.phone, p.expo_push_token, p.alerts_whatsapp_enabled, coalesce(s.attempts, 0)
  from grupo g
  join public.profiles p on p.id = g.user_id
  left join private.bill_reminder_sends s on s.bill_reminder_id = g.rep and s.due_date = g.due_date
  where coalesce(s.attempts, 0) < 5
    and not exists (
      select 1 from private.bill_reminder_sends s2
      join public.bill_reminders b2 on b2.id = s2.bill_reminder_id
      where s2.due_date = g.due_date and s2.sent_at is not null
        and b2.workspace_id = g.workspace_id and b2.user_id = g.user_id
        and b2.days_before = g.days_before and b2.at_time = g.at_time
        and private.bill_reminder_cobre(b2, g.target, g.ref));
$$;
revoke execute on function public._bill_reminders_due() from public, anon, authenticated;
grant execute on function public._bill_reminders_due() to service_role;

create or replace function private.save_bill_reminder(p_alvo jsonb, p_avisos jsonb, p_channel text)
returns integer
language plpgsql security definer
set search_path = ''
set "TimeZone" to 'America/Sao_Paulo'
as $$
declare
  v_ws uuid;
  v_tx uuid := nullif(p_alvo ->> 'transaction_id', '')::uuid;
  v_rec uuid := nullif(p_alvo ->> 'recurring_id', '')::uuid;
  v_plan uuid := nullif(p_alvo ->> 'installment_plan_id', '')::uuid;
  v_debt uuid := nullif(p_alvo ->> 'debt_id', '')::uuid;
  v_no int := nullif(p_alvo ->> 'debt_installment_no', '')::int;
  v_inv uuid := nullif(p_alvo ->> 'invoice_id', '')::uuid;
  v_keys text[];
  a record;
  t record;
  d record;
begin
  if auth.uid() is null then raise exception 'Sem sessão' using errcode = '42501'; end if;
  if num_nonnulls(v_tx, v_rec, v_plan, v_debt, v_inv) <> 1 then
    raise exception 'Escolha um registro para lembrar' using errcode = '22023';
  end if;
  if v_no is not null and v_debt is null then
    raise exception 'Escolha um registro para lembrar' using errcode = '22023';
  end if;
  if p_channel not in ('push', 'whatsapp', 'both') then
    raise exception 'Canal inválido' using errcode = '22023';
  end if;

  v_ws := coalesce(
    (select workspace_id from public.transactions where id = v_tx),
    (select workspace_id from public.recurring_transactions where id = v_rec),
    (select workspace_id from public.installment_plans where id = v_plan),
    (select workspace_id from public.debts where id = v_debt),
    (select workspace_id from public.card_invoices where id = v_inv));
  if v_ws is null or v_ws not in (select private.my_workspace_ids()) then
    raise exception 'Esse registro não existe mais' using errcode = 'P0001';
  end if;

  v_keys := array(select distinct (e ->> 'days_before')::int || '|' || (e ->> 'at_time')::time
                  from jsonb_array_elements(coalesce(p_avisos, '[]'::jsonb)) e);

  -- NOVO: só ao GRAVAR avisos; remover (`[]`) sempre passa, para o lembrete morto poder sair.
  if cardinality(v_keys) > 0 then
    if v_tx is not null then
      select t0.kind, t0.status, t0.debt_id, t0.pays_invoice_id, t0.pix_fee_for_transaction_id, t0.invoice_id,
             ci.status as fatura
        into t
      from public.transactions t0 left join public.card_invoices ci on ci.id = t0.invoice_id
      where t0.id = v_tx;
      if t.kind <> 'expense' or t.debt_id is not null or t.pays_invoice_id is not null
         or t.pix_fee_for_transaction_id is not null then
        raise exception 'Lembrete é para conta a pagar' using errcode = 'P0001';
      end if;
      if (t.invoice_id is null and t.status <> 'pending') or t.fatura in ('paid', 'rolled') then
        raise exception 'Essa já foi paga. Para lembrar das próximas, escolha Todas as próximas' using errcode = 'P0001';
      end if;
    elsif v_rec is not null then
      if (select kind from public.recurring_transactions where id = v_rec) <> 'expense' then
        raise exception 'Lembrete é para conta a pagar' using errcode = 'P0001';
      end if;
    elsif v_debt is not null then
      select d0.archived, d0.installments, d0.installments_paid, d0.remaining_cents into d
      from public.debts d0 where d0.id = v_debt;
      if d.archived or d.remaining_cents <= 0 then
        raise exception 'Essa dívida já foi quitada ou arquivada' using errcode = 'P0001';
      end if;
      if v_no is not null and (v_no < 1 or (d.installments is not null and v_no > d.installments)) then
        raise exception 'Essa parcela não existe no contrato' using errcode = '22023';
      end if;
      if v_no is not null and v_no <= d.installments_paid then
        raise exception 'Essa parcela já foi paga' using errcode = 'P0001';
      end if;
    end if;
  end if;

  -- Fica o aviso que já existe com os mesmos dias e hora (só o canal muda): apagá-lo levaria o
  -- registro de envio junto (cascade) e o de hoje tocaria de novo. Sai só o que foi tirado.
  delete from public.bill_reminders b
  where b.workspace_id = v_ws
    and b.transaction_id is not distinct from v_tx and b.recurring_id is not distinct from v_rec
    and b.installment_plan_id is not distinct from v_plan and b.debt_id is not distinct from v_debt
    and b.debt_installment_no is not distinct from v_no and b.invoice_id is not distinct from v_inv
    and not (b.days_before || '|' || b.at_time = any (v_keys));

  update public.bill_reminders b set channel = p_channel
  where b.workspace_id = v_ws
    and b.transaction_id is not distinct from v_tx and b.recurring_id is not distinct from v_rec
    and b.installment_plan_id is not distinct from v_plan and b.debt_id is not distinct from v_debt
    and b.debt_installment_no is not distinct from v_no and b.invoice_id is not distinct from v_inv
    and b.channel <> p_channel;

  for a in select split_part(k, '|', 1)::int as db, split_part(k, '|', 2)::time as hr from unnest(v_keys) k
           where not exists (
             select 1 from public.bill_reminders b
             where b.workspace_id = v_ws
               and b.transaction_id is not distinct from v_tx and b.recurring_id is not distinct from v_rec
               and b.installment_plan_id is not distinct from v_plan and b.debt_id is not distinct from v_debt
               and b.debt_installment_no is not distinct from v_no and b.invoice_id is not distinct from v_inv
               and b.days_before || '|' || b.at_time = k) loop
    insert into public.bill_reminders (workspace_id, user_id, transaction_id, recurring_id, installment_plan_id,
                                       debt_id, debt_installment_no, invoice_id, days_before, at_time, channel)
    values (v_ws, auth.uid(), v_tx, v_rec, v_plan, v_debt, v_no, v_inv, a.db, a.hr, p_channel);
  end loop;
  return coalesce(cardinality(v_keys), 0);
end $$;
revoke execute on function private.save_bill_reminder(jsonb, jsonb, text) from public, anon;
grant execute on function private.save_bill_reminder(jsonb, jsonb, text) to authenticated;

-- Leitura da tela. NOVO: o título diz QUAL — a parcela da dívida ("Carro · 9ª parcela") e a
-- ocorrência de série com a data —, senão o "só esta" e o "todas" eram duas linhas iguais.
create or replace function private.bill_reminders_overview()
returns table (alvo jsonb, title text, channel text, avisos jsonb, next_due date)
language sql stable security definer
set search_path = ''
set "TimeZone" to 'America/Sao_Paulo'
as $$
  with mine as (select array_agg(w) as ws from private.my_workspace_ids() w),
  b as (select * from public.bill_reminders where workspace_id in (select private.my_workspace_ids())),
  prox as (
    select d.bill_reminder_id, min(d.due_date) as due
    from private.bill_reminder_dues((select ws from mine)) d where d.due_date >= current_date
    group by 1
  )
  select jsonb_strip_nulls(jsonb_build_object(
           'transaction_id', b.transaction_id, 'recurring_id', b.recurring_id,
           'installment_plan_id', b.installment_plan_id, 'debt_id', b.debt_id,
           'debt_installment_no', b.debt_installment_no, 'invoice_id', b.invoice_id)) as alvo,
         coalesce(
           (select coalesce(t.description, t.merchant, t.category, 'Lançamento')
                   || case when t.recurring_id is not null
                           then ' · ' || to_char(coalesce(t.due_at, t.occurred_at), 'DD/MM/YYYY') else '' end
            from public.transactions t where t.id = b.transaction_id),
           (select coalesce(r.description, 'Recorrente') from public.recurring_transactions r where r.id = b.recurring_id),
           (select coalesce(p.description, p.merchant, 'Compra parcelada') from public.installment_plans p where p.id = b.installment_plan_id),
           (select d.name || coalesce(' · ' || b.debt_installment_no || 'ª parcela', '') from public.debts d where d.id = b.debt_id),
           (select 'Fatura ' || a.name from public.card_invoices ci join public.accounts a on a.id = ci.account_id where ci.id = b.invoice_id)
         ) as title,
         min(b.channel),
         jsonb_agg(jsonb_build_object('days_before', b.days_before, 'at_time', to_char(b.at_time, 'HH24:MI'))
                   order by b.days_before desc, b.at_time),
         min(prox.due)
  from b left join prox on prox.bill_reminder_id = b.id
  group by 1, 2;
$$;
revoke execute on function private.bill_reminders_overview() from public, anon;
grant execute on function private.bill_reminders_overview() to authenticated;
