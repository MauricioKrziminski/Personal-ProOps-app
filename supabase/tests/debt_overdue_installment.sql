-- `20261005190000`: parcela do contrato vencida e não paga fica na data do contrato (atrasada),
-- sem deslizar para o mês seguinte nem arrastar as demais. Sem âncora, nada muda.
--
--   agent/.venv/bin/python scripts/sql-test.py supabase/tests/debt_overdue_installment.sql </dev/null

\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';

do $$
declare
  ws uuid; u uuid; conta uuid; d1 uuid; d2 uuid; l record; venc date := current_date - 12;
  base bigint; com bigint; hoje_base bigint; hoje_com bigint; n int;
begin
  select w.id, m.user_id into ws, u
  from public.workspaces w join public.workspace_members m on m.workspace_id = w.id
  order by w.created_at limit 1;
  select id into conta from public.accounts
  where workspace_id = ws and type <> 'credit_card' and not archived limit 1;
  if ws is null or conta is null then raise exception 'sem workspace/conta para testar'; end if;

  -- âncora: a 9ª venceu há 12 dias e não foi paga (8 pagas, 12 no contrato, 4 restantes)
  insert into public.debts (workspace_id, user_id, name, kind, calculation_mode, principal_cents,
    remaining_cents, interest_rate_monthly, installments, installments_paid, installment_cents,
    due_day, first_due_date, account_id)
  values (ws, u, 'teste atrasada 1', 'financing', 'fixed_installments', 120000, 40000, 0, 12, 8,
    10000, extract(day from venc)::int, private.add_months(venc, -8), conta)
  returning id into d1;

  -- (a) a 9ª na data do contrato, (b) a 10ª um mês depois
  select * into l from private.debt_schedule_for(d1) order by installment_no limit 1;
  if l.installment_no <> 9 or l.due_date <> venc then
    raise exception 'a: primeira linha %ª em %, esperado 9ª em %', l.installment_no, l.due_date, venc;
  end if;
  select * into l from private.debt_schedule_for(d1) where installment_no = 10;
  if l.due_date <> private.day_in_month(private.add_months(venc, 1), extract(day from venc)::int) then
    raise exception 'b: 10ª em %', l.due_date;
  end if;

  -- (c) a projeção conta a 9ª hoje, uma vez: com a dívida, hoje sai 10000 a mais, e as 4 parcelas
  -- somam 40000 no horizonte
  update public.debts set archived = true where id = d1;
  select coalesce(sum(out_cents),0), coalesce(sum(out_cents) filter (where day = current_date),0)
    into base, hoje_base from private.eventos_de_caixa(array[ws], current_date + 120) where account_id = conta;
  update public.debts set archived = false where id = d1;
  select coalesce(sum(out_cents),0), coalesce(sum(out_cents) filter (where day = current_date),0)
    into com, hoje_com from private.eventos_de_caixa(array[ws], current_date + 120) where account_id = conta;
  if com - base <> 40000 or hoje_com - hoje_base <> 10000 then
    raise exception 'c: horizonte +%, hoje +%', com - base, hoje_com - hoje_base;
  end if;
  -- ...e o ciclo: uma vez, marcada atrasada, no dia de hoje
  select count(*) into n from private.cash_events(array[ws], current_date, current_date + 5)
   where origin = 'debt_schedule' and ref_id = d1 and atrasada and day = current_date;
  if n <> 1 then raise exception 'c: cash_events devolveu % atrasada(s) hoje', n; end if;
  -- ciclo FECHADO (já passou) não a conta como saída
  if exists (select 1 from private.cash_events(array[ws], venc - 5, current_date - 1)
             where origin = 'debt_schedule' and ref_id = d1) then
    raise exception 'c: ciclo fechado contou a parcela atrasada';
  end if;
  -- as leituras por data (mês, lista, o que vence) a mostram na data do contrato
  if not exists (select 1 from private.month_lines_for(array[ws], venc, 'civil')
                 where origin = 'debt_schedule' and ref_id = d1 and installment_no = 9 and due_date = venc) then
    raise exception 'c: a 9ª não está em month_lines_for na data do contrato';
  end if;

  -- (d) SEM âncora segue como antes: nunca antes de hoje
  insert into public.debts (workspace_id, user_id, name, kind, calculation_mode, principal_cents,
    remaining_cents, interest_rate_monthly, installments, installments_paid, installment_cents,
    due_day)
  values (ws, u, 'teste atrasada 2', 'financing', 'fixed_installments', 120000, 40000, 0, 12, 8,
    10000, extract(day from venc)::int)
  returning id into d2;
  select * into l from private.debt_schedule_for(d2) order by installment_no limit 1;
  if l.due_date < current_date then raise exception 'd: sem âncora devolveu % no passado', l.due_date; end if;

  -- (e) "Paguei" a 9ª: a 10ª é a próxima, na data do contrato
  perform public.pay_debt_installment(d1, 10000, conta, current_date);
  select * into l from private.debt_schedule_for(d1) order by installment_no limit 1;
  if l.installment_no <> 10
     or l.due_date <> private.day_in_month(private.add_months(venc, 1), extract(day from venc)::int) then
    raise exception 'e: primeira linha %ª em %', l.installment_no, l.due_date;
  end if;
end $$;

rollback;
