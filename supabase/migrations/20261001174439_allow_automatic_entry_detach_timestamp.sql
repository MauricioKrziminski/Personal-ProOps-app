-- Detach de entrada histórica aceita somente a auditoria automática da edição.
-- A comparação anterior incluía updated_at: passava na mesma transação, mas recusava
-- compras criadas numa transação anterior. Nenhum campo financeiro ganhou exceção.
create or replace function private.guard_purchase_down_payment()
returns trigger language plpgsql security definer set search_path = ''
set timezone to 'America/Sao_Paulo' as $$
declare parent_workspace uuid; account_workspace uuid; account_type text; account_archived boolean;
  valid_card_invoice boolean;
begin
  if tg_op = 'UPDATE' and
    (new.down_payment_debt_id is distinct from old.down_payment_debt_id
     or new.down_payment_plan_id is distinct from old.down_payment_plan_id) then
    -- Só o DELETE de um plano já sem parcelas pode soltar sua entrada histórica.
    -- UPDATE direto/reassociação continuam recusados, sem chave/GUC que o cliente possa forjar.
    if pg_trigger_depth() > 1
      and old.down_payment_plan_id is not null and new.down_payment_plan_id is null
      and exists(select 1 from public.installment_plans p
        where p.id=old.down_payment_plan_id and p.workspace_id=old.workspace_id)
      and not exists(select 1 from public.transactions t where t.installment_plan_id=old.down_payment_plan_id)
      and new.edit_revision = old.edit_revision + 1
      -- BEFORE UPDATE set_updated_at (moddatetime) always stamps this transaction.
      -- Entry creation and removal can be different transactions; financial fields stay exact.
      and new.updated_at = now()
      and (to_jsonb(new) - 'down_payment_plan_id' - 'edit_revision' - 'updated_at') =
          (to_jsonb(old) - 'down_payment_plan_id' - 'edit_revision' - 'updated_at') then
      return new;
    end if;
    raise exception 'O vínculo da entrada não pode ser alterado: apague e registre uma nova entrada';
  end if;
  if new.down_payment_debt_id is null and new.down_payment_plan_id is null then return new; end if;
  select a.workspace_id,a.type,a.archived into account_workspace,account_type,account_archived
    from public.accounts a where a.id=new.account_id for share;
  -- Arquivar uma conta conserva seu historico e o fluxo das faturas existentes.
  -- Nova entrada ou troca de conta/espaco continua exigindo conta ativa.
  if account_archived and (tg_op <> 'UPDATE' or new.account_id is distinct from old.account_id
    or new.workspace_id is distinct from old.workspace_id) then
    raise exception 'Escolha uma conta ativa para registrar ou mover a entrada';
  end if;
  valid_card_invoice := account_type='credit_card' and new.invoice_id is not null and exists(
    select 1 from public.card_invoices i where i.id=new.invoice_id and i.account_id=new.account_id
      and i.workspace_id=new.workspace_id);
  if (new.down_payment_debt_id is not null and new.down_payment_plan_id is not null)
    or new.debt_id is not null or new.installment_plan_id is not null or new.recurring_id is not null
    or new.installment_no is not null or new.debt_payment_no is not null
    or new.debt_principal_cents is not null or new.debt_interest_cents is not null
    or new.debt_balance_after_cents is not null or new.counterparty_account_id is not null
    or new.kind is distinct from 'expense'
    -- A compra no cartao ja aconteceu; pagar/desfazer a fatura governa o estado de caixa dela.
    or (new.status is distinct from 'cleared' and not(coalesce(valid_card_invoice,false) and new.status='pending'))
    or (account_type='credit_card' and not coalesce(valid_card_invoice,false))
    or (account_type<>'credit_card' and new.invoice_id is not null)
    or new.amount_cents is null or new.amount_cents <= 0
    or new.occurred_at is null or new.occurred_at > current_date then
    raise exception 'Entrada exige despesa positiva já realizada, sem vínculo de parcela, dívida ou recorrente';
  end if;
  if new.down_payment_debt_id is not null then
    select d.workspace_id into parent_workspace from public.debts d where d.id=new.down_payment_debt_id for share;
  else
    select p.workspace_id into parent_workspace from public.installment_plans p where p.id=new.down_payment_plan_id for share;
  end if;
  if parent_workspace is distinct from new.workspace_id or account_workspace is distinct from new.workspace_id
     or parent_workspace is null or account_workspace is null then
    raise exception 'Contrato e conta da entrada devem pertencer ao mesmo workspace ativo';
  end if;
  return new;
end $$;
revoke execute on function private.guard_purchase_down_payment() from public, anon, authenticated;

