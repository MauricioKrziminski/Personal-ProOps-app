-- Parcela paga que já estava só CONTADA (`installments_paid`) e que saiu da conta no ciclo atual
-- vira lançamento PAGO, ligado à parcela, pelo MESMO gatilho do "Paguei"
-- (`tg_transactions_debt_payment`). O saldo e a contagem da dívida não andam duas vezes: para cada
-- parcela a função recua o contador até `k-1` (devolvendo ao saldo o que o gatilho vai abater),
-- insere o pagamento — o gatilho numera `k` e abate — e no fim restaura o par original.
-- Só parcela fixa: no modo com juros o saldo antes da parcela `k` não é derivável do contrato.
-- Idempotente: parcela que já tem pagamento é pulada (duplo toque e repetição não duplicam).
create or replace function public.register_counted_debt_payments(
  p_debt_id uuid, p_account_id uuid, p_numbers int[]
) returns int
language plpgsql security invoker
set search_path = public
set timezone to 'America/Sao_Paulo'
as $$
declare d record; k int; feitos int := 0; pagas int; saldo bigint;
begin
  select * into d from public.debts where id = p_debt_id for update;
  if d.id is null then raise exception 'Dívida não encontrada'; end if;
  if d.calculation_mode <> 'fixed_installments' or d.installment_cents is null then
    raise exception 'Só financiamento de parcela fixa registra parcela já paga';
  end if;
  if p_account_id is null then raise exception 'Escolha a conta de onde a parcela saiu'; end if;
  pagas := d.installments_paid;
  saldo := d.remaining_cents;
  foreach k in array coalesce((select array_agg(distinct n order by n) from unnest(p_numbers) n), '{}') loop
    if k < 1 or k > pagas then raise exception 'A parcela % não está entre as pagas', k; end if;
    if exists (select 1 from public.transactions t where t.debt_id = p_debt_id and t.debt_payment_no = k) then
      continue;
    end if;
    update public.debts
       set installments_paid = k - 1,
           remaining_cents = saldo + (pagas - (k - 1)) * d.installment_cents
     where id = p_debt_id;
    insert into public.transactions
      (workspace_id, user_id, kind, amount_cents, category, description, merchant,
       account_id, occurred_at, source, status, debt_id)
    values (d.workspace_id, coalesce((select auth.uid()), d.user_id), 'expense',
            d.installment_cents, coalesce(d.payment_category, 'contas'),
            coalesce(d.payment_description, 'Parcela ' || d.name), d.payment_merchant,
            p_account_id,
            least(private.debt_projected_due_date(p_debt_id, k), current_date),
            'app', 'cleared', p_debt_id);
    feitos := feitos + 1;
  end loop;
  -- o gatilho deixa o par em (k, saldo+...): volta ao que a dívida já dizia
  update public.debts set installments_paid = pagas, remaining_cents = saldo where id = p_debt_id;
  return feitos;
end;
$$;
revoke execute on function public.register_counted_debt_payments(uuid, uuid, int[]) from public, anon;
grant execute on function public.register_counted_debt_payments(uuid, uuid, int[]) to authenticated, service_role;
