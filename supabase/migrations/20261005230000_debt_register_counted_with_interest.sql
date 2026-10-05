-- `register_counted_debt_payments` também no modo COM JUROS (Price). A parcela k paga (só contada)
-- que saiu da conta no ciclo atual vira lançamento pago pelo MESMO gatilho do "Paguei"
-- (`tg_transactions_debt_payment`: juros = ceil(saldo × taxa), o resto amortiza). O valor é a
-- parcela do cronograma (`coalesce(installment_cents, price_installment(saldo, taxa, restantes))`,
-- a mesma expressão de `debt_schedule_for`; estimativa/edição declarada da parcela k vale antes) e
-- o saldo ANTES da parcela k sai de desfazer, da última paga para trás, a conta que o gatilho faz.
-- No fim `installments_paid` e `remaining_cents` voltam ao que a dívida já dizia. Corpo da
-- 20261005192000 (cabeçalho, grants) com o ramo novo.
create or replace function public.register_counted_debt_payments(
  p_debt_id uuid, p_account_id uuid, p_numbers int[]
) returns int
language plpgsql security invoker
set search_path = public
set timezone to 'America/Sao_Paulo'
as $$
declare d record; k int; j int; feitos int := 0; pagas int; saldo bigint; dt date; amt bigint;
  fixa boolean; parcela bigint; menor int; b bigint; antes bigint[] := '{}';
begin
  select * into d from public.debts where id = p_debt_id for update;
  if d.id is null then raise exception 'Dívida não encontrada'; end if;
  if d.archived then raise exception 'Dívida arquivada: desarquive antes de registrar parcelas pagas'; end if;
  fixa := d.calculation_mode = 'fixed_installments';
  if fixa and d.installment_cents is null then
    raise exception 'Só financiamento de parcela fixa ou com juros registra parcela já paga';
  end if;
  if d.first_due_date is null then
    raise exception 'Só financiamento com data de vencimento registra parcela já paga';
  end if;
  if p_account_id is null then raise exception 'Escolha a conta de onde a parcela saiu'; end if;
  pagas := d.installments_paid;
  saldo := d.remaining_cents;
  menor := (select min(n) from unnest(p_numbers) n where n is not null);
  if not fixa and menor is not null then
    if coalesce(d.installments, 0) - pagas <= 0 then
      raise exception 'Financiamento sem parcelas restantes: não há como calcular a parcela paga';
    end if;
    parcela := coalesce(d.installment_cents,
      private.price_installment(d.remaining_cents, d.interest_rate_monthly, d.installments - pagas));
    -- saldo antes de cada parcela paga: inverte  antes + ceil(antes × taxa) − parcela = depois
    b := saldo;
    for j in reverse pagas..greatest(menor, 1) loop
      b := greatest(floor((b + parcela)::numeric / (1 + d.interest_rate_monthly))::bigint - 2, 0);
      -- (b acima é só o ponto de partida; sobe até a conta fechar)
      while b + ceil(b::numeric * d.interest_rate_monthly)::bigint - parcela
            < coalesce(antes[j + 1], saldo) loop
        b := b + 1;
      end loop;
      antes[j] := b;
    end loop;
  end if;
  foreach k in array coalesce((select array_agg(distinct n order by n) from unnest(p_numbers) n where n is not null), '{}') loop
    if k < 1 or k > pagas then raise exception 'A parcela % não está entre as pagas', k; end if;
    if exists (select 1 from public.transactions t where t.debt_id = p_debt_id and t.debt_payment_no = k) then
      continue;
    end if;
    -- data e valor que o app mostra para a parcela k, lidos ANTES do recuo (que muda o cronograma)
    dt := coalesce((select h.due_date from public.debt_declared_due_dates h
                    where h.debt_id = p_debt_id and h.installment_no = k),
                   private.debt_projected_due_date(p_debt_id, k));
    amt := coalesce((select e.amount_cents from public.debt_declared_estimates e
                     where e.debt_id = p_debt_id and e.installment_no = k),
                    (select e.amount_cents from public.debt_installment_edits e
                     where e.debt_id = p_debt_id and e.installment_no = k),
                    case when fixa then d.installment_cents else parcela end);
    update public.debts
       set installments_paid = k - 1,
           remaining_cents = case when fixa then saldo + (pagas - (k - 1)) * d.installment_cents
                                  else antes[k] end
     where id = p_debt_id;
    insert into public.transactions
      (workspace_id, user_id, kind, amount_cents, category, description, merchant,
       account_id, occurred_at, source, status, debt_id)
    values (d.workspace_id, coalesce((select auth.uid()), d.user_id), 'expense',
            amt, coalesce(d.payment_category, 'contas'),
            coalesce(d.payment_description, 'Parcela ' || d.name), d.payment_merchant,
            p_account_id, least(dt, current_date), 'app', 'cleared', p_debt_id);
    feitos := feitos + 1;
  end loop;
  -- o gatilho deixa o par em (k, ...): volta ao que a dívida já dizia (só se algo foi lançado,
  -- senão o UPDATE vazio mexe em edit_revision/updated_at e a tela aberta acusa conflito falso)
  if feitos > 0 then
    update public.debts set installments_paid = pagas, remaining_cents = saldo where id = p_debt_id;
  end if;
  return feitos;
end;
$$;
revoke execute on function public.register_counted_debt_payments(uuid, uuid, int[]) from public, anon;
grant execute on function public.register_counted_debt_payments(uuid, uuid, int[]) to authenticated, service_role;
