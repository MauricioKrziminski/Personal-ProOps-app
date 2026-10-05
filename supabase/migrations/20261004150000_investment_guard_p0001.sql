-- F12: a recusa da guarda é frase para a pessoa ler, então sai como P0001 — a régua de
-- `financeErrorMessage` (só `raise exception` vira texto na tela; o resto é genérico). Com 22023,
-- Lançamentos recusava editar/apagar a transferência de uma aplicação e dizia "Tenta de novo".
create or replace function private.guard_investment_transfer() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if coalesce(current_setting('proops.investment_scope',true),'')='on' or pg_trigger_depth()>1 then
  return case when tg_op='DELETE' then old else new end;end if;
 if exists(select 1 from public.investment_movements m where m.transfer_id=old.id and m.created_transfer)
  and (tg_op='DELETE' or (new.kind,new.account_id,new.counterparty_account_id,new.amount_cents,new.occurred_at)
   is distinct from (old.kind,old.account_id,old.counterparty_account_id,old.amount_cents,old.occurred_at))
 then raise exception using errcode='P0001',message='Esta transferência pertence a uma aplicação ou resgate: edite ou desfaça pela posição.';end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
revoke execute on function private.guard_investment_transfer() from public,anon,authenticated,service_role;
