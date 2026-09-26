-- O pagamento de dívida se edita e se apaga, qualquer um (26/09/2026, *"tudo que se cria se
-- edita"*).
--
-- A varredura achou três recusas que eram trava nossa, não lógica:
-- 1. DATA que mudaria a ordem dos pagamentos, e pagamento novo com data anterior a um já lançado
--    ("Registre pagamentos em ordem de data"). Na parcela fixa a ordem não mexe no saldo (ele sai
--    do contrato); com juros, os juros já cobrados ficam como foram. A data é da pessoa.
-- 2. Apagar um pagamento que NÃO é o mais recente. Na parcela fixa, devolve UMA parcela como o
--    mais recente já devolvia; com juros, o principal dele volta ao saldo da dívida e ao saldo
--    depois de cada pagamento seguinte. Os seguintes são renumerados.
-- 3. Corrigir o VALOR de um pagamento antigo com juros. A diferença entra no principal DELE (os
--    juros daquele mês não mudam — eles dependem do saldo de antes, que não mudou) e desce pelo
--    saldo depois de cada pagamento seguinte até o saldo da dívida. Os juros dos seguintes ficam
--    como foram cobrados: refazê-los seria trocar o que o banco cobrou por uma conta nossa.
-- Continua recusado, com o motivo: pagamento antigo sem histórico de amortização (não há de onde
-- refazer a conta), valor que não cobre os juros daquele mês, e saldo que ficaria negativo.
--
-- A escrita nos pagamentos seguintes passa pela MESMA trava que o `delete_debt` usa
-- (`proops.apagando_divida`), senão o gatilho desfaria o que ele mesmo acabou de acertar
-- ("o ledger é derivado pelo banco") — e a trava é devolvida logo depois.
-- Teste: `supabase/tests/parcela_fixa_com_encargo.sql` (casos 4 e 5) e
-- `supabase/tests/pagamento_de_divida_se_edita.sql`.

create or replace function public.tg_transactions_debt_payment()
returns trigger
language plpgsql
set search_path = public
as $function$
declare
  d record;
  debt uuid;
  economic_change boolean;
  delta bigint;
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
      -- "Este e as próximas parcelas" (o app passa o contrato ao valor novo ANTES): o pagamento
      -- MAIS RECENTE corrigido para o valor que o contrato acabou de ganhar é a parcela inteira
      -- nele, sem encargo (`20260925140000`).
      if old.debt_payment_no = d.installments_paid and new.amount_cents = d.installment_cents
         and d.installment_cents <> old.debt_principal_cents
         and not exists (select 1 from public.transactions t where t.debt_id = debt
                           and t.id <> old.id and t.debt_payment_no > old.debt_payment_no) then
        new.debt_principal_cents := new.amount_cents;
        new.debt_interest_cents := 0;
        new.debt_balance_after_cents := d.remaining_cents;
        return new;
      end if;
      new.debt_interest_cents := new.amount_cents - old.debt_principal_cents;
      return new;
    end if;

    -- Com juros, QUALQUER pagamento: a diferença é principal deste, e desce pelos seguintes.
    if old.debt_principal_cents is null or old.debt_balance_after_cents is null or old.debt_payment_no is null then
      raise exception 'Pagamento antigo sem histórico de amortização. Valor e exclusão exigem conciliar o saldo em Dívidas e financiamentos';
    end if;
    delta := new.amount_cents - old.amount_cents;
    new.debt_principal_cents := old.debt_principal_cents + delta;
    if new.debt_principal_cents <= 0 then
      raise exception 'O valor precisa passar dos juros deste pagamento';
    end if;
    new.debt_balance_after_cents := old.debt_balance_after_cents - delta;
    if new.debt_balance_after_cents < 0 or d.remaining_cents - delta < 0 then
      raise exception 'Correção deve amortizar o saldo e não superar a quitação';
    end if;
    if exists (select 1 from public.transactions t where t.debt_id = debt and t.id <> old.id
                 and t.debt_payment_no > old.debt_payment_no and t.debt_balance_after_cents - delta < 0) then
      raise exception 'Correção deve amortizar o saldo e não superar a quitação';
    end if;
    perform set_config('proops.apagando_divida', debt::text, true);
    update public.transactions t set debt_balance_after_cents = t.debt_balance_after_cents - delta
     where t.debt_id = debt and t.id <> old.id and t.debt_payment_no > old.debt_payment_no;
    perform set_config('proops.apagando_divida', '', true);
    update public.debts set remaining_cents = remaining_cents - delta where id = debt;
    return new;
  end if;

  -- ── DELETE: qualquer pagamento ─────────────────────────────────────────────────────────
  if d.calculation_mode = 'fixed_installments' then
    -- Devolve UMA parcela pelo contrato (parcela × restantes, o `check`). Com as pagas já zeradas
    -- à mão no contrato, a parcela não conta mais: só a linha sai.
    if d.installments_paid > 0 then
      update public.debts set installments_paid = installments_paid - 1,
        remaining_cents = installment_cents * (installments - installments_paid + 1)
       where id = debt;
    end if;
  else
    if old.debt_payment_no is null or old.debt_principal_cents is null or old.debt_balance_after_cents is null then
      raise exception 'Pagamento antigo sem histórico de amortização. Valor e exclusão exigem conciliar o saldo em Dívidas e financiamentos';
    end if;
    update public.debts set remaining_cents = remaining_cents + old.debt_principal_cents,
      installments_paid = greatest(installments_paid - 1, 0) where id = debt;
  end if;
  -- Os seguintes sobem um número (e, com juros, recebem de volta o principal deste no saldo).
  perform set_config('proops.apagando_divida', debt::text, true);
  update public.transactions t set
    debt_payment_no = t.debt_payment_no - 1,
    debt_balance_after_cents = case when d.calculation_mode = 'fixed_installments' then t.debt_balance_after_cents
                                    else t.debt_balance_after_cents + old.debt_principal_cents end
   where t.debt_id = debt and t.id <> old.id and t.debt_payment_no > old.debt_payment_no;
  perform set_config('proops.apagando_divida', '', true);
  return old;
end;
$function$;
