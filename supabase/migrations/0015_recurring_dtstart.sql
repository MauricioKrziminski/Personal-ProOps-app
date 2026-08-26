-- Âncora fixa da série recorrente.
-- Até a 0014 a expansão da RRULE usava `next_run_at` como dtstart, mas ele anda a
-- cada materialização — com horizonte de 90 dias isso faria a hora de parede
-- derivar a cada rodada do cron. `dtstart` guarda o início original e nunca muda.
alter table public.recurring_transactions
  add column if not exists dtstart timestamptz;

update public.recurring_transactions
set dtstart = next_run_at
where dtstart is null;

comment on column public.recurring_transactions.dtstart is
  'início da série: âncora imutável da RRULE. next_run_at anda, dtstart não.';
