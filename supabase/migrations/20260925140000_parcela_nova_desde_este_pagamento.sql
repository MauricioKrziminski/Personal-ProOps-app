-- "Este e as próximas parcelas" no pagamento de parcela fixa (25/09/2026).
--
-- Corrigir o valor de um pagamento pelo "Editar lançamento" pergunta "Só este pagamento / Este e
-- as próximas parcelas". A segunda passava o contrato ao valor novo DEPOIS de gravar o pagamento,
-- e o trigger media o pagamento contra a parcela antiga: o detalhe dizia "Parcela de R$ 105 +
-- R$ 5 de encargo" para quem tinha acabado de dizer que a parcela passou a R$ 110. A folha de
-- pagar já fazia o certo (contrato primeiro, parcela inteira no valor novo).
--
-- Agora o app muda o contrato ANTES, e o trigger reconhece o caso no pagamento MAIS RECENTE: o
-- valor corrigido igual à parcela que o contrato acabou de ganhar vira a parcela inteira, sem
-- encargo. Pagamento antigo continua como era (parcela da época + encargo/desconto); o resto do
-- trigger é o de `20260925120000`, byte a byte. Sem esta migration o app segue funcionando: o
-- pagamento só fica com o encargo, como antes.
-- Teste: `supabase/tests/parcela_fixa_com_encargo.sql`, caso 7.

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
      -- "Este e as próximas parcelas" (o app passa o contrato ao valor novo ANTES): o pagamento
      -- MAIS RECENTE corrigido para o valor que o contrato acabou de ganhar é a parcela inteira
      -- nele, sem encargo — o mesmo que a folha de pagar grava com "Usar este valor nas
      -- próximas". O saldo não muda: o contrato já foi recalculado com esta parcela paga.
      -- "Mais recente" são as DUAS coisas: o nº bate com as pagas do contrato E não há pagamento
      -- depois dele (o contrato pode baixar `installments_paid` à mão). Corrigir o último para
      -- exatamente a parcela atual, por qualquer caminho, lê como a parcela inteira — é também o
      -- que deixa apagá-lo depois de o contrato mudar (saldo = parcela × restantes).
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
