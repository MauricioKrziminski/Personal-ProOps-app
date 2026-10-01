-- A entrada de financiamento também é compra da fatura. Exclusão completa e
-- conversão Todas não podem remover esse fato depois de pagar/adiar a fatura.
-- A assinatura, retorno (pagamentos removidos), idempotência e RLS são mantidos.
create or replace function public.delete_debt(p_debt_id uuid)
returns int
language plpgsql
security invoker
set search_path to 'public'
as $function$
declare
  n int;
begin
  -- Mesmo lock do contrato antes dos pagamentos e da entrada.
  perform 1 from public.debts where id=p_debt_id for update;
  if not found then return 0; end if;
  -- Serialize against invoice settlement before checking its paid/rolled state.
  perform 1 from public.card_invoices ci
    where ci.id in (select t.invoice_id from public.transactions t
      where t.down_payment_debt_id=p_debt_id)
    order by ci.id for update;
  if exists(select 1 from public.transactions t
    where t.down_payment_debt_id=p_debt_id and private.parcela_travada('pending',t.invoice_id)) then
    raise exception 'Há lançamento numa fatura paga, adiada ou paga em parte. Desfaça o pagamento da fatura antes.';
  end if;
  -- O desvio já existente atende o ledger dos pagamentos; não libera a entrada.
  perform set_config('proops.apagando_divida',p_debt_id::text,true);
  delete from public.transactions where debt_id=p_debt_id;
  get diagnostics n = row_count;
  delete from public.debts where id=p_debt_id;
  perform set_config('proops.apagando_divida','',true);
  return n;
end;
$function$;
revoke execute on function public.delete_debt(uuid) from public,anon;
grant execute on function public.delete_debt(uuid) to authenticated,service_role;
