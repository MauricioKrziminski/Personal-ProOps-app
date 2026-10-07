-- `anon` não executa função nenhuma de public; `authenticated` continua executando TODA RPC que o
-- app chama (a lista sai de `supabase.rpc('…')` em src/, 24/09/2026), e as duas que a escrita de
-- `notes` avalia. Uma migration que criar função em public sem `revoke ... from public, anon` falha
-- aqui: o PUBLIC do padrão global reabre a porta a cada função nova.
begin;
do $$
declare
  abertas text;
  faltando text;
begin
  select string_agg(p.proname, ', ') into abertas
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
    and has_function_privilege('anon', p.oid, 'execute')
    and not exists (
      select 1 from pg_depend d
      where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
    );
  if abertas is not null then
    raise exception 'anon ainda executa: %', abertas;
  end if;

  select string_agg(nome, ', ') into faltando
  from unnest(array[
    'accept_pending_invites','account_balances','accounts_horizon','agent_activity','annual_by_category','annual_summary',
    'anticipation_candidates','approve_import_items','bill_reminders_overview','budget_plan_command','budget_plan_preview','budget_plan_state','budgets_status','cancel_subscription','card_summary','cards_horizon',
    'categories_used','convert_transaction_to_installments','converter_registro','create_installment_plan_last_day','create_installment_plan_with_history',
    'cycle_lines','cycle_now','cycle_range','cycle_series','daily_spending','debt_schedule','debt_pause','debt_pause_preview','undo_debt_pause','delete_category','delete_scoped','delete_scoped_preview','delete_asset_valuation','delete_debt','end_recurring_series','end_recurring_series_preview','financial_health',
    'finish_import_batch','forecast_json','goal_deposit','goal_link_candidates','goal_money_command','goal_money_state','import_unmatched','investment_command','investment_link_candidates','investment_movements_page','investment_positions','investment_value_command','ledger_expected_lines_transfer','month_breakdown',
    'materialize_recurring_occurrence','month_forecast_json','month_lines','month_summary','monthly_cashflow','my_default_workspace',
    'net_worth','net_worth_series','note_folder_counts','note_folders_reorder','note_tag_counts',
    'notes_reorder','pay_debt_installment','pay_invoice','payoff_strategy','pause_recurring','pause_recurring_preview','plan_status','rename_category','resume_recurring','roll_invoice',
    'save_bill_reminder','save_budget','save_category','settle_invoice','simular','skip_recurring_occurrence','spendable','spendable_path','spending_change','transactions_summary','upcoming_bills',
    'update_asset_value','update_debt_payment_due_day','update_installment_plan','update_installment_scope_last_day','update_recurring_series','update_transaction_scoped',
    'year_end_balances',
    -- não são `.rpc()`, mas a escrita de `notes` as avalia como quem escreve (coluna gerada e CHECK)
    'note_tags_of','note_tags_valid'
  ]) as nome
  where not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = nome
      and has_function_privilege('authenticated', p.oid, 'execute')
  );
  if faltando is not null then
    raise exception 'authenticated perdeu: %', faltando;
  end if;
end
$$;
rollback;
