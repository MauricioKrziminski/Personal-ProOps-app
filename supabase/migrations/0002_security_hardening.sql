-- Hardening apontado pelos security advisors do Supabase:
-- 1. search_path fixo nas funções expostas via RPC
alter function public.expenses_summary(date, date) set search_path = public;
alter function public.expenses_monthly(int) set search_path = public;

-- 2. handle_new_user é um trigger interno — ninguém deve poder chamá-la via API
revoke execute on function public.handle_new_user() from public, anon, authenticated;
