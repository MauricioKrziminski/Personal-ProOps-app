-- Parcela fixa paga com valor diferente (25/09/2026, decisão do dono do produto).
--
-- Numa dívida de PARCELA FIXA, pagar R$ 1.500 numa parcela de R$ 1.470 conta UMA parcela: o
-- saldo cai R$ 1.470, como o banco vê, e os R$ 30 viram encargo (a mais) — ou desconto, quando
-- se paga a menos. A diferença mora em `transactions.debt_interest_cents`, que no modo fixo
-- pode ser negativa. As próximas parcelas continuam no valor do contrato.
--
-- Antes: `check_fixed_installment_payment` recusava qualquer valor diferente da parcela, na
-- criação e na correção ("No modo simples, registre o valor integral…"), e o `sync_debt_payment`
-- abatia o valor inteiro — o que o CHECK do contrato fixo (saldo = parcela × restantes) também
-- recusaria. Pagar diferente e corrigir o valor depois eram impossíveis, e o erro sumia atrás
-- do teclado.
--
-- O valor de UMA parcela tem limite: da metade até menos do dobro da parcela.
--
-- Dívida COM JUROS (`amortized`) não muda: o valor pago abate o saldo depois dos juros do mês.
-- Teste: `supabase/tests/parcela_fixa_com_encargo.sql`.

drop trigger if exists check_fixed_installment_payment on public.transactions;
drop function if exists public.tg_fixed_installment_payment();

create or replace function public.tg_transactions_debt_payment()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  d record;
  debt uuid;
  balance_before bigint;
  economic_change boolean;
begin
  debt := case when tg_op = 'DELETE' then old.debt_id else new.debt_id end;
  -- No UPDATE da FK (`set debt_id = null`) quem nomeia a dívida é o `old`.
  if current_setting('proops.apagando_divida', true) in (debt::text, old.debt_id::text) then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if tg_op = 'UPDATE' and new.debt_id is distinct from old.debt_id then
    raise exception 'Não é possível vincular ou desvincular um pagamento já criado';
  end if;
  if debt is null then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  select * into d from public.debts where id = debt for update;
  if d.id is null then raise exception 'Dívida não encontrada'; end if;
  if tg_op <> 'DELETE' then
    if new.kind <> 'expense' or new.status <> 'cleared' or new.workspace_id <> d.workspace_id then
      raise exception 'Pagamento de dívida deve continuar como despesa paga do mesmo workspace';
    end if;
    if new.account_id is not null and not exists (
      select 1 from public.accounts a where a.id = new.account_id and a.workspace_id = d.workspace_id
        and a.type <> 'credit_card' and not a.archived
    ) then raise exception 'Conta pagadora inválida para esta dívida'; end if;
  end if;
  if tg_op = 'INSERT' then
    if d.archived or d.remaining_cents <= 0 then raise exception 'Dívida arquivada ou já quitada'; end if;
    if exists (select 1 from public.transactions t where t.debt_id = debt and t.occurred_at > new.occurred_at) then
      raise exception 'Registre pagamentos em ordem de data';
    end if;
    new.debt_payment_no := d.installments_paid + 1;
    if d.calculation_mode = 'fixed_installments' then
      -- Parcela fixa: o pagamento quita UMA parcela e o saldo cai o valor dela, como o banco vê.
      -- O que foi pago a mais é encargo (multa, juros de atraso); a menos, desconto — vai em
      -- `debt_interest_cents`, que aqui pode ser negativo.
      if new.amount_cents is null or new.amount_cents <= 0 then
        raise exception 'O valor pago precisa ser maior que zero';
      end if;
      new.debt_principal_cents := least(d.installment_cents, d.remaining_cents);
      -- UMA parcela tem limite: sem ele R$ 0,01 quitaria uma parcela inteira, e três parcelas
      -- pagas juntas contariam como uma (o saldo mostraria duas a mais do que se deve).
      if new.amount_cents * 2 < new.debt_principal_cents then
        raise exception 'Esse valor é menos da metade da parcela. Confere o valor pago?';
      end if;
      if new.amount_cents >= 2 * new.debt_principal_cents then
        raise exception 'Esse valor passa de uma parcela. Para pagar mais de uma, registre uma de cada vez.';
      end if;
      new.debt_interest_cents := new.amount_cents - new.debt_principal_cents;
    else
      new.debt_interest_cents := ceil(d.remaining_cents::numeric * d.interest_rate_monthly)::bigint;
      new.debt_principal_cents := new.amount_cents - new.debt_interest_cents;
    end if;
    if new.debt_principal_cents is null or new.debt_principal_cents <= 0 or new.debt_principal_cents > d.remaining_cents then
      raise exception 'Pagamento deve amortizar o saldo e não superar a quitação';
    end if;
    new.debt_balance_after_cents := d.remaining_cents - new.debt_principal_cents;
    update public.debts set remaining_cents = new.debt_balance_after_cents,
      installments_paid = new.debt_payment_no where id = debt;
    return new;
  end if;
  if tg_op = 'UPDATE' then
    -- The ledger is derived by the database, never accepted from an API patch.
    new.debt_payment_no := old.debt_payment_no;
    new.debt_interest_cents := old.debt_interest_cents;
    new.debt_principal_cents := old.debt_principal_cents;
    new.debt_balance_after_cents := old.debt_balance_after_cents;
    if new.occurred_at is distinct from old.occurred_at and exists (
      select 1 from public.transactions t where t.debt_id = debt and t.id <> old.id
        and ((t.occurred_at <= old.occurred_at and t.occurred_at > new.occurred_at)
          or (t.occurred_at >= old.occurred_at and t.occurred_at < new.occurred_at))
    ) then raise exception 'A nova data mudaria a ordem de amortização dos pagamentos'; end if;
    economic_change := new.amount_cents is distinct from old.amount_cents;
    if not economic_change then return new; end if;
    -- Parcela fixa: corrigir o valor pago muda só o encargo/desconto daquele pagamento — a
    -- parcela continua quitada e o saldo não depende do valor. Por isso vale em QUALQUER
    -- pagamento, não só no mais recente.
    if d.calculation_mode = 'fixed_installments' then
      if old.debt_principal_cents is null then
        raise exception 'Pagamento antigo sem histórico de amortização. Valor e exclusão exigem conciliar o saldo em Dívidas e financiamentos';
      end if;
      if new.amount_cents is null or new.amount_cents <= 0 then
        raise exception 'O valor pago precisa ser maior que zero';
      end if;
      if new.amount_cents * 2 < old.debt_principal_cents then
        raise exception 'Esse valor é menos da metade da parcela. Confere o valor pago?';
      end if;
      if new.amount_cents >= 2 * old.debt_principal_cents then
        raise exception 'Esse valor passa de uma parcela. Para pagar mais de uma, registre uma de cada vez.';
      end if;
      new.debt_interest_cents := new.amount_cents - old.debt_principal_cents;
      return new;
    end if;
  end if;
  if old.debt_payment_no is null or old.debt_principal_cents is null or old.debt_balance_after_cents is null then
    raise exception 'Pagamento antigo sem histórico de amortização. Valor e exclusão exigem conciliar o saldo em Dívidas e financiamentos';
  end if;
  if old.debt_payment_no <> d.installments_paid or old.debt_balance_after_cents <> d.remaining_cents then
    raise exception 'Corrija primeiro o pagamento mais recente; o saldo mudou após este pagamento';
  end if;
  balance_before := old.debt_balance_after_cents + old.debt_principal_cents;
  if tg_op = 'DELETE' then
    update public.debts set remaining_cents = balance_before,
      installments_paid = installments_paid - 1 where id = debt;
    return old;
  end if;
  new.debt_principal_cents := new.amount_cents - old.debt_interest_cents;
  if new.debt_principal_cents is null or new.debt_principal_cents <= 0 or new.debt_principal_cents > balance_before then
    raise exception 'Correção deve amortizar o saldo e não superar a quitação';
  end if;
  new.debt_balance_after_cents := balance_before - new.debt_principal_cents;
  update public.debts set remaining_cents = new.debt_balance_after_cents where id = debt;
  return new;
end;
$function$;

-- A coluna mudou de significado no modo fixo: quem somar "juros pagos" precisa saber disto.
comment on column public.transactions.debt_interest_cents is
  'Dívida com juros (amortized): juros do mês. Parcela fixa (fixed_installments): valor pago menos a parcela — positivo é encargo, negativo é desconto.';
