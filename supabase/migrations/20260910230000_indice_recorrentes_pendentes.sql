-- Índice para o cron pegar só quem PRECISA de materialização (10/09/2026)
--
-- `materialize_horizon` passou a filtrar por `materialized_until < horizonte` e ordenar por
-- `materialized_until asc nulls first` — quem está mais atrasado primeiro, para ninguém passar
-- fome quando houver mais séries que o `MAX_SERIES_PER_RUN`.
--
-- Sem índice, isso é seq scan em `recurring_transactions` a cada hora. Com ele, a rodada que
-- não tem nada a fazer — que é a maioria absoluta, já que o horizonte é de um ano — custa um
-- index scan que devolve zero linhas.
--
-- Parcial em `active`: série pausada não interessa ao cron e não precisa ocupar o índice.
create index if not exists recurring_pendentes_idx
  on public.recurring_transactions (materialized_until asc nulls first)
  where active;
