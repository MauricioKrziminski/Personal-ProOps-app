-- Lembrete de conta, revisão de robustez (09/10/2026). Achados da auditoria, cada um com teste em
-- supabase/tests/lembrete_de_conta.sql:
--
-- (1) O lembrete é DA PESSOA. `user_id` sempre foi quem recebe, mas salvar apagava/trocava os
--     avisos do alvo para o ESPAÇO inteiro: num espaço compartilhado, um membro editava ou apagava o
--     lembrete do outro, e o "só esta" de um calava a série do outro. Agora salvar, a precedência, a
--     lista e o silêncio do aviso automático (que vai ao dono) olham só os lembretes da própria pessoa.
-- (2) Quem saiu do espaço não recebe mais: o cron exige `workspace_members`.
-- (3) O aviso só é devido se já existia no momento dele (`created_at <= dia + hora`). Mudar a hora
--     de um aviso já enviado (salvar troca a linha) ou criar um aviso com a hora de hoje já passada
--     disparava na hora.
-- (4) O livro de envios descreve a si mesmo (pessoa, alvo, dias, hora) e não some quando o lembrete
--     é apagado. Antes o `cascade` levava o registro junto e o outro lembrete do mesmo vencimento
--     reenviava; o "já enviado" agora lê o livro, não a tabela de lembretes.
-- (5) Entrega com folga: até 8 tentativas com espera dobrando (2, 4, 8… min, ~4 h). Eram 5 em 5
--     minutos — uma queda curta do push perdia o aviso para sempre.
-- (6) Salvar recusa também a fatura paga/adiada e a compra sem parcela em aberto.
-- (7) O cron calcula só a janela que pode tocar (hoje a hoje + 30), não o ano inteiro de cada série.
-- (8) A lista diz qual fatura ("Fatura Nubank · 10/10/2026").

-- ── (4) livro de envios ──────────────────────────────────────────────────────────────────────
alter table private.bill_reminder_sends
  add column if not exists user_id uuid,
  add column if not exists workspace_id uuid,
  add column if not exists transaction_id uuid,
  add column if not exists recurring_id uuid,
  add column if not exists installment_plan_id uuid,
  add column if not exists debt_id uuid,
  add column if not exists debt_installment_no int,
  add column if not exists invoice_id uuid,
  add column if not exists days_before int,
  add column if not exists at_time time,
  add column if not exists tentado_em timestamptz;

update private.bill_reminder_sends s
set user_id = b.user_id, workspace_id = b.workspace_id, transaction_id = b.transaction_id,
    recurring_id = b.recurring_id, installment_plan_id = b.installment_plan_id, debt_id = b.debt_id,
    debt_installment_no = b.debt_installment_no, invoice_id = b.invoice_id,
    days_before = b.days_before, at_time = b.at_time
from public.bill_reminders b
where b.id = s.bill_reminder_id and s.user_id is null;

alter table private.bill_reminder_sends drop constraint if exists bill_reminder_sends_bill_reminder_id_fkey;
create index if not exists bill_reminder_sends_entrega_idx
  on private.bill_reminder_sends (user_id, due_date, days_before, at_time) where sent_at is not null;

-- Quem reserva (o agente) só manda o id do lembrete e o vencimento; o resto vem do lembrete, uma vez.
create or replace function private.tg_bill_reminder_sends_descreve()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    select b.user_id, b.workspace_id, b.transaction_id, b.recurring_id, b.installment_plan_id,
           b.debt_id, b.debt_installment_no, b.invoice_id, b.days_before, b.at_time
      into new.user_id, new.workspace_id, new.transaction_id, new.recurring_id, new.installment_plan_id,
           new.debt_id, new.debt_installment_no, new.invoice_id, new.days_before, new.at_time
    from public.bill_reminders b where b.id = new.bill_reminder_id;
    -- lembrete apagado entre a leitura e a reserva: a linha fica sem descrição e não cobre nada
  elsif new.attempts is distinct from old.attempts then
    new.tentado_em := now();
  end if;
  return new;
end $$;
revoke execute on function private.tg_bill_reminder_sends_descreve() from public, anon, authenticated;
drop trigger if exists descreve on private.bill_reminder_sends;
create trigger descreve before insert or update of attempts on private.bill_reminder_sends
  for each row execute function private.tg_bill_reminder_sends_descreve();

-- O alvo de um lembrete (ou de um envio) chega ao vencimento (target, ref)? A régua de
-- `bill_reminder_dues`, vista do outro lado.
drop function if exists private.bill_reminder_cobre(public.bill_reminders, text, uuid);
create or replace function private.bill_reminder_cobre(
  p_ws uuid, p_tx uuid, p_rec uuid, p_plan uuid, p_debt uuid, p_inv uuid, p_target text, p_ref uuid)
returns boolean
language sql stable security definer
set search_path = ''
set "TimeZone" to 'America/Sao_Paulo'
as $$
  select case p_target
    when 'debt' then p_debt = p_ref
    when 'transaction' then exists (
      select 1 from public.transactions t
      where t.id = p_ref and t.workspace_id = p_ws
        and (t.id = p_tx or t.recurring_id = p_rec or t.installment_plan_id = p_plan))
    when 'invoice' then p_inv = p_ref or exists (
      select 1 from public.transactions t
      where t.invoice_id = p_ref and t.workspace_id = p_ws
        and (t.id = p_tx or t.recurring_id = p_rec or t.installment_plan_id = p_plan))
    else false end;
$$;
revoke execute on function private.bill_reminder_cobre(uuid, uuid, uuid, uuid, uuid, uuid, text, uuid) from public, anon, authenticated;

-- ── vencimentos: precedência POR PESSOA (1) e janela (7) ─────────────────────────────────────
-- Os dois chamadores (cron e lista) são redefinidos abaixo, nesta mesma migration.
drop function if exists private.bill_reminder_dues(uuid[]);
create or replace function private.bill_reminder_dues(p_ws uuid[], p_de date default null, p_ate date default null)
returns table (bill_reminder_id uuid, due_date date, title text, amount_cents bigint, target text, ref uuid)
language sql stable security definer
set search_path = ''
set "TimeZone" to 'America/Sao_Paulo'
as $$
  with r as (select * from public.bill_reminders b where b.workspace_id = any (p_ws)),
  linhas as (
    select r.id as rid, r.user_id as ruid, (r.transaction_id is not null) as so_esta, t.*
    from r join public.transactions t
      on t.workspace_id = r.workspace_id
     and (t.id = r.transaction_id or t.recurring_id = r.recurring_id or t.installment_plan_id = r.installment_plan_id)
    where t.kind <> 'transfer'
  )
  select l.rid, coalesce(l.due_at, l.occurred_at),
         coalesce(l.description, l.merchant, l.category, 'Lançamento'), l.amount_cents, 'transaction', l.id
  from linhas l
  where l.invoice_id is null and l.status = 'pending'
    and (p_de is null or coalesce(l.due_at, l.occurred_at) >= p_de)
    and (p_ate is null or coalesce(l.due_at, l.occurred_at) <= p_ate)
    -- a ocorrência com "só esta" DA MESMA PESSOA não recebe o da série/compra
    and (l.so_esta or not exists (
      select 1 from public.bill_reminders b2 where b2.transaction_id = l.id and b2.user_id = l.ruid))
  union
  select l.rid, ci.due_date, 'Fatura ' || a.name, private.invoice_open_cents(ci.id), 'invoice', ci.id
  from linhas l
  join public.card_invoices ci on ci.id = l.invoice_id and ci.status not in ('paid', 'rolled')
  join public.accounts a on a.id = ci.account_id
  where (p_de is null or ci.due_date >= p_de) and (p_ate is null or ci.due_date <= p_ate)
    -- o lembrete da própria fatura cala os das compras; o "só esta" de uma compra cala o das séries
    and not exists (select 1 from public.bill_reminders b2 where b2.invoice_id = ci.id and b2.user_id = l.ruid)
    and (l.so_esta or not exists (
      select 1 from public.bill_reminders b2 join public.transactions t2 on t2.id = b2.transaction_id
      where t2.invoice_id = ci.id and b2.user_id = l.ruid))
  union
  select r.id, ci.due_date, 'Fatura ' || a.name, private.invoice_open_cents(ci.id), 'invoice', ci.id
  from r
  join public.card_invoices ci on ci.id = r.invoice_id and ci.status not in ('paid', 'rolled')
  join public.accounts a on a.id = ci.account_id
  where (p_de is null or ci.due_date >= p_de) and (p_ate is null or ci.due_date <= p_ate)
  union
  select r.id, s.due_date,
         coalesce(d.payment_description, 'Parcela ' || d.name) || ' (' || s.installment_no || coalesce('/' || d.installments, '') || ')',
         s.payment_cents, 'debt', d.id
  from r
  join public.debts d on d.id = r.debt_id and not d.archived and d.remaining_cents > 0
  cross join lateral private.debt_schedule_for(d.id) s
  where s.payment_cents is not null
    and (p_de is null or s.due_date >= p_de) and (p_ate is null or s.due_date <= p_ate)
    and (s.installment_no = r.debt_installment_no
         -- a dívida inteira não toca a parcela que tem lembrete próprio DA MESMA PESSOA
         or (r.debt_installment_no is null and not exists (
               select 1 from public.bill_reminders b2
               where b2.debt_id = d.id and b2.debt_installment_no = s.installment_no and b2.user_id = r.user_id)));
$$;
revoke execute on function private.bill_reminder_dues(uuid[], date, date) from public, anon, authenticated;

-- ── o que toca agora: (2) membro, (3) existia no momento, (4) livro, (5) espera ───────────────
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
    from private.bill_reminder_dues((select array_agg(distinct r.workspace_id) from public.bill_reminders r),
                                    current_date, current_date + 30) d
    join public.bill_reminders b on b.id = d.bill_reminder_id
    where d.due_date - b.days_before = current_date
      and localtime >= b.at_time
      and b.created_at <= (current_date + b.at_time)::timestamptz
      and exists (select 1 from public.workspace_members m
                  where m.workspace_id = b.workspace_id and m.user_id = b.user_id)
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
  where coalesce(s.attempts, 0) < 8
    and (s.tentado_em is null or s.tentado_em <= now() - make_interval(mins => (2 ^ s.attempts)::int))
    and not exists (
      select 1 from private.bill_reminder_sends s2
      where s2.due_date = g.due_date and s2.sent_at is not null
        and s2.user_id = g.user_id and s2.workspace_id = g.workspace_id
        and s2.days_before = g.days_before and s2.at_time = g.at_time
        and private.bill_reminder_cobre(s2.workspace_id, s2.transaction_id, s2.recurring_id,
                                        s2.installment_plan_id, s2.debt_id, s2.invoice_id, g.target, g.ref));
$$;
revoke execute on function public._bill_reminders_due() from public, anon, authenticated;
grant execute on function public._bill_reminders_due() to service_role;

-- ── salvar: os avisos DA PESSOA (1) e a fatura/compra que nunca tocam (6) ─────────────────────
create or replace function private.save_bill_reminder(p_alvo jsonb, p_avisos jsonb, p_channel text)
returns integer
language plpgsql security definer
set search_path = ''
set "TimeZone" to 'America/Sao_Paulo'
as $$
declare
  v_ws uuid;
  v_eu uuid := auth.uid();
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
  if v_eu is null then raise exception 'Sem sessão' using errcode = '42501'; end if;
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

  -- Só ao GRAVAR avisos; remover (`[]`) sempre passa, para o lembrete morto poder sair.
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
    elsif v_plan is not null then
      if not exists (
        select 1 from public.transactions t0 left join public.card_invoices ci on ci.id = t0.invoice_id
        where t0.installment_plan_id = v_plan
          and ((t0.invoice_id is null and t0.status = 'pending')
               or (t0.invoice_id is not null and ci.status not in ('paid', 'rolled')))) then
        raise exception 'Essa compra já foi toda paga' using errcode = 'P0001';
      end if;
    elsif v_inv is not null then
      if (select status from public.card_invoices where id = v_inv) in ('paid', 'rolled') then
        raise exception 'Essa fatura já foi paga ou adiada' using errcode = 'P0001';
      end if;
    elsif v_debt is not null then
      select d0.archived, d0.installments, d0.installments_paid, d0.remaining_cents into d
      from public.debts d0 where d0.id = v_debt;
      if d.archived or d.remaining_cents <= 0 then
        raise exception 'Essa dívida já foi quitada ou arquivada' using errcode = 'P0001';
      end if;
      if v_no is not null and (v_no < 1 or (d.installments is not null and v_no > d.installments)) then
        raise exception 'Essa parcela não existe no contrato' using errcode = 'P0001';
      end if;
      if v_no is not null and v_no <= d.installments_paid then
        raise exception 'Essa parcela já foi paga' using errcode = 'P0001';
      end if;
    end if;
  end if;

  -- Fica o aviso que já existe com os mesmos dias e hora (só o canal muda). Sai só o que foi tirado.
  delete from public.bill_reminders b
  where b.workspace_id = v_ws and b.user_id = v_eu
    and b.transaction_id is not distinct from v_tx and b.recurring_id is not distinct from v_rec
    and b.installment_plan_id is not distinct from v_plan and b.debt_id is not distinct from v_debt
    and b.debt_installment_no is not distinct from v_no and b.invoice_id is not distinct from v_inv
    and not (b.days_before || '|' || b.at_time = any (v_keys));

  update public.bill_reminders b set channel = p_channel
  where b.workspace_id = v_ws and b.user_id = v_eu
    and b.transaction_id is not distinct from v_tx and b.recurring_id is not distinct from v_rec
    and b.installment_plan_id is not distinct from v_plan and b.debt_id is not distinct from v_debt
    and b.debt_installment_no is not distinct from v_no and b.invoice_id is not distinct from v_inv
    and b.channel <> p_channel;

  for a in select split_part(k, '|', 1)::int as db, split_part(k, '|', 2)::time as hr from unnest(v_keys) k
           where not exists (
             select 1 from public.bill_reminders b
             where b.workspace_id = v_ws and b.user_id = v_eu
               and b.transaction_id is not distinct from v_tx and b.recurring_id is not distinct from v_rec
               and b.installment_plan_id is not distinct from v_plan and b.debt_id is not distinct from v_debt
               and b.debt_installment_no is not distinct from v_no and b.invoice_id is not distinct from v_inv
               and b.days_before || '|' || b.at_time = k) loop
    insert into public.bill_reminders (workspace_id, user_id, transaction_id, recurring_id, installment_plan_id,
                                       debt_id, debt_installment_no, invoice_id, days_before, at_time, channel)
    values (v_ws, v_eu, v_tx, v_rec, v_plan, v_debt, v_no, v_inv, a.db, a.hr, p_channel);
  end loop;
  return coalesce(cardinality(v_keys), 0);
end $$;
revoke execute on function private.save_bill_reminder(jsonb, jsonb, text) from public, anon;
grant execute on function private.save_bill_reminder(jsonb, jsonb, text) to authenticated;

-- ── lista: só os da pessoa (1), e qual fatura (8) ────────────────────────────────────────────
create or replace function private.bill_reminders_overview()
returns table (alvo jsonb, title text, channel text, avisos jsonb, next_due date)
language sql stable security definer
set search_path = ''
set "TimeZone" to 'America/Sao_Paulo'
as $$
  with mine as (select array_agg(w) as ws from private.my_workspace_ids() w),
  b as (select * from public.bill_reminders
        where workspace_id in (select private.my_workspace_ids()) and user_id = auth.uid()),
  prox as (
    select d.bill_reminder_id, min(d.due_date) as due
    from private.bill_reminder_dues((select ws from mine), current_date) d
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
           (select 'Fatura ' || a.name || ' · ' || to_char(ci.due_date, 'DD/MM/YYYY')
            from public.card_invoices ci join public.accounts a on a.id = ci.account_id where ci.id = b.invoice_id)
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

-- ── aviso automático: cala só pelo lembrete de QUEM o recebe (o dono) (1) ─────────────────────
create or replace function private.tx_tem_lembrete(p_tx public.transactions, p_user uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.bill_reminders b
    where b.user_id = p_user
      and (b.transaction_id = p_tx.id
           or b.recurring_id = p_tx.recurring_id
           or b.installment_plan_id = p_tx.installment_plan_id));
$$;
revoke execute on function private.tx_tem_lembrete(public.transactions, uuid) from public, anon, authenticated;

-- Corpo de `_alerts_to_send` copiado de `pg_get_functiondef` do staging em 09/10/2026 (igual ao da
-- 20261007120100); só as três exclusões por lembrete ganharam `d.user_id`.
CREATE OR REPLACE FUNCTION public._alerts_to_send()
 RETURNS TABLE(workspace_id uuid, user_id uuid, phone text, expo_push_token text, alerts_push_enabled boolean, alerts_whatsapp_enabled boolean, kind text, ref text, title text, body text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Sao_Paulo'
AS $function$
  with donos as (
    select w.id as workspace_id, w.owner_id as user_id,
           p.phone, p.expo_push_token, p.timezone,
           p.alerts_push_enabled, p.alerts_whatsapp_enabled
    from public.workspaces w
    join public.profiles p on p.id = w.owner_id
    where (p.alerts_push_enabled and p.expo_push_token is not null)
       or (p.alerts_whatsapp_enabled and p.phone is not null)
  ),
  teste as (
    select d.workspace_id, d.user_id, d.phone, d.expo_push_token,
           d.alerts_push_enabled, d.alerts_whatsapp_enabled,
           'trial_ending' as kind,
           s.current_period_end::text as ref,
           'Seu teste acaba em 2 dias' as title,
           case when uso.lancamentos > 0
                then 'Voce ja registrou ' || uso.lancamentos
                     || ' lancamento' || case when uso.lancamentos = 1 then '' else 's' end
                     || ' nesta semana. Dia ' || to_char(s.current_period_end, 'DD/MM')
                     || ' o teste vira assinatura automaticamente. '
                     || 'Se nao quiser continuar, cancele na loja antes disso — '
                     || 'sao dois toques e nao precisa falar com ninguem.'
                else 'Dia ' || to_char(s.current_period_end, 'DD/MM')
                     || ' o teste vira assinatura automaticamente. '
                     || 'Manda um gasto aqui pra experimentar antes de decidir — '
                     || 'ou cancele na loja, sao dois toques.' end as body
    from donos d
    join public.subscriptions s on s.workspace_id = d.workspace_id
    cross join lateral (
      select count(*)::int as lancamentos
      from public.transactions t
      where t.workspace_id = d.workspace_id
        and t.created_at >= now() - interval '7 days'
    ) uso
    where s.is_trial
      and s.status = 'trialing'
      and s.current_period_end = current_date + 2
  ),
  fechamento as (
    -- O ciclo que terminou ONTEM. Com `cycle_close_day = 10` dispara no dia 11; com `null`
    -- (mês civil) dispara no dia 1º — o mesmo `private.cycle_close_day` que as telas usam, então
    -- o número do aviso e o da tela que ele abre saem da MESMA borda.
    select d.workspace_id, d.user_id, d.phone, d.expo_push_token,
           d.alerts_push_enabled, d.alerts_whatsapp_enabled,
           'cycle_closed' as kind,
           -- O `ref` é a data de FIM, e ela faz DOIS trabalhos: deduplica em `alerts_sent`
           -- (um aviso por ciclo) e vai no `data` do push como o mês a abrir. Ela cai sempre no
           -- mês do RÓTULO, porque o rótulo de um ciclo é o mês em que ele termina.
           b.fim::text as ref,
           initcap(translate(private.mes_pt(b.fim), 'ç', 'c')) || ' fechou' as title,
           -- ⚠️ **Colunas CRUAS, nunca uma manchete de "fechou em X".** Qual número lidera um
           -- ciclo fechado é regra de produto e mora em `describeCycle` (`src/lib/cycle-label.ts`):
           -- com dívida ele lidera com `-faltou_pagar`, sem dívida com `caixa_no_fim`. Escrever
           -- essa escolha aqui seria a segunda cópia — e o push diria um número enquanto a tela
           -- que ele abre diria outro, que é a queixa que criou o `describeCycle`.
           'Entrou ' || round(s.entrou::numeric / 100, 2)
             || ', saiu ' || round(s.saiu::numeric / 100, 2)
             || '. Sobrou na conta ' || round(coalesce(s.caixa_no_fim, 0)::numeric / 100, 2)
             || case when coalesce(s.faltou_pagar, 0) > 0
                     then '. Ficou faltando pagar ' || round(s.faltou_pagar::numeric / 100, 2)
                     else '' end
             || '. Quer ver o detalhe?' as body
    from donos d
    cross join lateral (select private.cycle_close_day(array[d.workspace_id], null) as dia) cfg
    cross join lateral (select private.cycle_month_of(cfg.dia, current_date - 1) as m) lbl
    cross join lateral private.cycle_bounds(cfg.dia, lbl.m) b
    -- `cycle_series_for` recebe o mês do RÓTULO, não a data de início: ela mesma chama
    -- `cycle_bounds` por dentro. Passar `b.ini` devolveria o ciclo anterior ao certo.
    cross join lateral private.cycle_series_for(array[d.workspace_id], lbl.m, lbl.m, null) s
    where b.fim = current_date - 1
  ),
  orcamento as (
    select d.workspace_id, d.user_id, d.phone, d.expo_push_token,
           d.alerts_push_enabled, d.alerts_whatsapp_enabled,
           -- O GATILHO é gasto + comprometido; o TEXTO separa os dois. Avisar só pelo gasto
           -- deixaria a pessoa tranquila com um limite já tomado por um boleto agendado —
           -- e é justamente enquanto o boleto não saiu que ainda dá para fazer algo.
           case when b.spent_cents + b.committed_cents >= b.limit_cents
                then 'budget_100' else 'budget_80' end as kind,
           b.category as ref,
           case when b.spent_cents + b.committed_cents >= b.limit_cents
                then 'Orcamento estourado'
                else 'Orcamento no limite' end as title,
           case when b.spent_cents + b.committed_cents >= b.limit_cents
                then 'Voce ja gastou ' || round(b.spent_cents::numeric / 100, 2)
                     || ' de ' || round(b.limit_cents::numeric / 100, 2)
                     || ' em ' || b.category
                     || case when b.committed_cents > 0
                             then ', e tem mais ' || round(b.committed_cents::numeric / 100, 2)
                                  || ' em conta prevista'
                             else '' end
                     || '. Quer que eu remaneje de outra categoria?'
                else 'Voce ja usou ' || round(100.0 * (b.spent_cents + b.committed_cents) / b.limit_cents)
                     || '% do orcamento de ' || b.category
                     || case when b.committed_cents > 0
                             then ' (contando ' || round(b.committed_cents::numeric / 100, 2)
                                  || ' que ainda nao saiu)'
                             else '' end
                     || '. Faltam ' || round((b.limit_cents - b.spent_cents - b.committed_cents)::numeric / 100, 2)
                     || ' ate o fim do mes.' end as body
    from donos d
    cross join lateral private.budgets_status_for(array[d.workspace_id], current_date) b
    where b.limit_cents > 0 and b.spent_cents + b.committed_cents >= b.limit_cents * 0.8
  ),
  fatura as (
    select d.workspace_id, d.user_id, d.phone, d.expo_push_token,
           d.alerts_push_enabled, d.alerts_whatsapp_enabled,
           'invoice_due' as kind, ci.id::text as ref,
           'Fatura do ' || a.name as title,
           'Fatura de ' || round(private.invoice_open_cents(ci.id)::numeric / 100, 2)
             || ' vence em ' || to_char(ci.due_date, 'DD/MM')
             || '. Ja pagou? Me manda "paguei a fatura do ' || a.name || '".' as body
    from donos d
    join public.card_invoices ci on ci.workspace_id = d.workspace_id
                                and ci.status not in ('paid', 'rolled')
    join public.accounts a on a.id = ci.account_id
    join public.transactions t on t.invoice_id = ci.id and private.conta_na_fatura(t.kind)
    where ci.due_date <= current_date + 3
      and not exists (select 1 from public.bill_reminders b where b.invoice_id = ci.id and b.user_id = d.user_id)
      and not exists (select 1 from public.transactions tc
                      where tc.invoice_id = ci.id and private.tx_tem_lembrete(tc, d.user_id))
    group by d.workspace_id, d.user_id, d.phone, d.expo_push_token,
             d.alerts_push_enabled, d.alerts_whatsapp_enabled,
             ci.id, ci.due_date, a.name
  ),
  conta as (
    select d.workspace_id, d.user_id, d.phone, d.expo_push_token,
           d.alerts_push_enabled, d.alerts_whatsapp_enabled,
           'bill_due' as kind, t.id::text as ref,
           'Conta vencendo' as title,
           coalesce(t.description, t.category, 'Conta') || ' de '
             || round(t.amount_cents::numeric / 100, 2)
             || ' vence ' || case when coalesce(t.due_at, t.occurred_at) = current_date
                                  then 'hoje' else 'amanha' end
             || '. Depois me diz "paguei" que eu dou baixa.' as body
    from donos d
    join public.transactions t on t.workspace_id = d.workspace_id
    where t.status = 'pending' and t.kind = 'expense' and t.invoice_id is null
      and coalesce(t.due_at, t.occurred_at) between current_date and current_date + 1
      and not private.tx_tem_lembrete(t, d.user_id)
  ),
  receita as (
    select d.workspace_id, d.user_id, d.phone, d.expo_push_token,
           d.alerts_push_enabled, d.alerts_whatsapp_enabled,
           'income_to_confirm' as kind, t.id::text as ref,
           'Chegou o dinheiro?' as title,
           coalesce(t.description, t.category, 'Receita') || ' de '
             || round(t.amount_cents::numeric / 100, 2)
             || case when coalesce(t.due_at, t.occurred_at) = current_date
                     then ' estava previsto pra hoje. '
                     else ' estava previsto pra '
                          || to_char(coalesce(t.due_at, t.occurred_at), 'DD/MM')
                          || ' e ainda nao foi confirmado. ' end
             || 'Se ja caiu, me manda "recebi" que eu dou baixa. '
             || 'Ate la ele conta so na projecao, nao no saldo.' as body
    from donos d
    join public.transactions t on t.workspace_id = d.workspace_id
    where t.status = 'pending' and t.kind = 'income'
      -- quem tem `auto_confirm` nao precisa de aviso: o cron da baixa sozinho
      and not t.auto_confirm
      -- dois toques: no dia previsto e tres dias depois. Ver o cabecalho.
      and coalesce(t.due_at, t.occurred_at) in (current_date, current_date - 3)
  ),
  vermelho as (
    select d.workspace_id, d.user_id, d.phone, d.expo_push_token,
           d.alerts_push_enabled, d.alerts_whatsapp_enabled,
           'negative_forecast' as kind, f.day::text as ref,
           'Saldo vai ficar negativo' as title,
           'Do jeito que esta, dia ' || to_char(f.day, 'DD/MM')
             || ' seu saldo fica em ' || round(f.balance_cents::numeric / 100, 2)
             || '. Quer ver o que da pra adiar?' as body
    from donos d
    cross join lateral (
      select day, balance_cents
      from public._cash_flow_forecast(d.user_id, 30)
      where balance_cents < 0
      order by day
      limit 1
    ) f
  )
  -- O teste vem primeiro porque é o único aviso com prazo dentro do teto diário.
  -- O fechamento vem logo atrás: ele acontece UMA vez por ciclo e é o aviso mais
  -- importante do mês. Deixado no fim, três avisos de orçamento no dia 11 o cortariam
  -- pelo `MAX_ALERTS_PER_USER`.
  select * from teste
  union all select * from fechamento
  union all select * from orcamento
  union all select * from fatura
  union all select * from conta
  union all select * from receita
  union all select * from vermelho;
$function$;
revoke execute on function public._alerts_to_send() from public, anon, authenticated;
grant execute on function public._alerts_to_send() to service_role;

drop function if exists private.tx_tem_lembrete(public.transactions);
