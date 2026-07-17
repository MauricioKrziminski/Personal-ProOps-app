-- SÓ APLICAR depois do deploy do process-jobs que escreve em `transactions`
-- (senão gastos via WhatsApp falham e viram jobs failed).
-- Migra o delta que entrou em `expenses` entre a 0005 e o deploy, e dropa a tabela.
-- O drop remove `expenses` da publicação supabase_realtime automaticamente.

insert into public.transactions
  (id, user_id, kind, amount_cents, currency, category, description, occurred_at, source, created_at)
select e.id, e.user_id, 'expense', e.amount_cents, e.currency, e.category, e.description, e.spent_at, e.source, e.created_at
from public.expenses e
where not exists (select 1 from public.transactions t where t.id = e.id);

drop table public.expenses;
