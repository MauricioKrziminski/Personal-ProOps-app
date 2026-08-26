-- Contador de tentativas de entrega/execução para o cron do send-reminders.
--
-- Antes: se a entrega de um lembrete falhava (ex.: template `proops_reminder`
-- não aprovado na Meta), o catch mantinha `next_run_at` e o cron tentava de novo
-- A CADA MINUTO, para sempre. O mesmo valia para a materialização de lançamentos
-- recorrentes com erro persistente.
--
-- Agora: conta tentativas; ao estourar o limite (5) a função pula a série
-- recorrente para a próxima ocorrência ou desativa o item único, guardando o
-- motivo em `last_error`.
--
-- APLICAR ANTES do deploy do send-reminders novo (a função escreve nestas colunas).

alter table public.reminders
  add column if not exists send_attempts int not null default 0,
  add column if not exists last_error text;

alter table public.recurring_transactions
  add column if not exists run_attempts int not null default 0,
  add column if not exists last_error text;
