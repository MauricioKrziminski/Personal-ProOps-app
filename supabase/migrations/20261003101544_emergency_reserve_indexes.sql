-- F07 advisors: keep parent deletion and source lookups indexed as allocations grow.
-- These indexes change neither privileges nor reserve/ledger values.
create index if not exists emergency_reserves_user_idx on public.emergency_reserves(user_id);
create index if not exists financial_allocations_account_idx on public.financial_allocations(account_id) where account_id is not null;
create index if not exists financial_allocations_asset_idx on public.financial_allocations(asset_id) where asset_id is not null;
create index if not exists financial_allocations_user_idx on public.financial_allocations(user_id);
create index if not exists reserve_month_reviews_user_idx on public.reserve_month_reviews(user_id);
create index if not exists emergency_reserve_receipts_workspace_idx on private.emergency_reserve_write_receipts(workspace_id);
