-- F13: movimento NO MESMO DIA da atualização de valor (ou do aplicado informado).
--
-- `investment_position_numbers` somava ao último valor só o que entrou/saiu DEPOIS de `as_of`
-- (`paid_at > as_of`). Atualizar o valor para R$ 850 e resgatar R$ 810 no mesmo dia deixava o
-- valor atual em R$ 850 e o resultado em +347% (QA Android, 05/10/2026). Uma data não diz se o
-- valor informado já contava o movimento do mesmo dia; quem desempata é a ORDEM em que as duas
-- coisas foram registradas: o movimento lançado depois de o valor ser informado vem depois dele.
-- `recorded_at` anda junto com valor/data (gatilho), porque editar é informar de novo.
-- Teste: `supabase/tests/investment_valuations.sql` (bloco "mesmo dia").

alter table public.investment_valuations add column if not exists recorded_at timestamptz not null default now();

create or replace function private.investment_valuation_recorded() returns trigger
language plpgsql set search_path='' as $$
begin
 if (new.value_cents,new.as_of) is distinct from (old.value_cents,old.as_of) then new.recorded_at:=now();end if;
 return new;
end $$;
drop trigger if exists investment_valuation_recorded on public.investment_valuations;
create trigger investment_valuation_recorded before update on public.investment_valuations
 for each row execute function private.investment_valuation_recorded();
revoke execute on function private.investment_valuation_recorded() from public,anon,authenticated,service_role;

create or replace function private.investment_position_numbers(ws_ids uuid[])
returns table(account_id uuid,workspace_id uuid,ledger_cents bigint,value_cents bigint,principal_cents bigint,
 result_cents bigint,result_quality text,received_cents bigint,last_valuation_on date,opening_on date)
language sql stable set search_path to 'public' set timezone to 'America/Sao_Paulo' as $$
 with led as (select c.account_id,c.cents from private.caixa_das_contas(ws_ids,current_date) c where c.account_id is not null)
 select a.id,a.workspace_id,coalesce(led.cents,0)::bigint,
  -- o valor atual nunca fica abaixo de zero (resgate maior que a última atualização)
  greatest(case when lv.as_of is null then coalesce(led.cents,0) else lv.value_cents+dl.d end,0)::bigint,
  (case when op.id is not null then op.value_cents else a.initial_balance_cents end+pr.net)::bigint,
  (case when lv.as_of is null then null else greatest(lv.value_cents+dl.d,0)-(case when op.id is not null then op.value_cents else a.initial_balance_cents end+pr.net) end)::bigint,
  case when lv.as_of is null then 'indisponível' when op.id is not null or a.initial_balance_cents=0 then 'conhecido' else 'estimado' end,
  coalesce(rec.cents,0)::bigint,lv.as_of,op.as_of
 from public.accounts a
 left join led on led.account_id=a.id
 left join lateral (select v.as_of,v.value_cents,v.recorded_at from public.investment_valuations v
   where v.position_account_id=a.id and v.kind='valuation' order by v.as_of desc limit 1) lv on true
 left join lateral (select v.id,v.as_of,v.value_cents,v.recorded_at from public.investment_valuations v
   where v.position_account_id=a.id and v.kind='opening' order by v.as_of desc,v.id limit 1) op on true
 cross join lateral (select coalesce(sum(case
    when t.kind='income' and t.account_id=a.id then t.amount_cents
    when t.kind='expense' and t.account_id=a.id then -t.amount_cents
    when t.kind='transfer' and t.account_id=a.id then -t.amount_cents
    when t.kind='transfer' and t.counterparty_account_id=a.id then t.amount_cents
    else 0 end),0) d
   from public.transactions t where lv.as_of is not null and t.status='cleared'
    and (t.account_id=a.id or t.counterparty_account_id=a.id) and t.paid_at<=current_date
    and (t.paid_at>lv.as_of or (t.paid_at=lv.as_of and t.created_at>lv.recorded_at))) dl
 cross join lateral (select coalesce(sum(case when t.account_id=a.id then -t.amount_cents else t.amount_cents end),0) net
   from public.transactions t where t.kind='transfer' and t.status='cleared'
    and (t.account_id=a.id or t.counterparty_account_id=a.id) and t.paid_at<=current_date
    and (op.id is null or t.paid_at>op.as_of or (t.paid_at=op.as_of and t.created_at>op.recorded_at))) pr
 left join lateral (select sum(t.amount_cents) cents from public.investment_movements m join public.transactions t on t.id=m.transfer_id
   where m.position_account_id=a.id and m.kind='income' and t.status='cleared') rec on true
 where a.type='investment' and not a.archived and a.workspace_id=any(ws_ids);
$$;
revoke execute on function private.investment_position_numbers(uuid[]) from public,anon;
grant execute on function private.investment_position_numbers(uuid[]) to authenticated,service_role;
