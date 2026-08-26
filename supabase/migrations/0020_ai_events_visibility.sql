-- Auditoria da IA visivel para o usuario.
-- `ai_events` era service_role-only (tabela de infra). Passa a ter leitura
-- own-rows: o app mostra o que a IA entendeu, com que confianca e quanto custou,
-- e da um botao de desfazer. Nenhum concorrente expoe isso — e e exatamente o
-- que responde a queixa de "categorizou errado e eu nao sei por que".
--
-- Continua SEM insert/update/delete pelo app: quem escreve e o process-jobs.
alter table public.ai_events
  add column if not exists created_transaction_ids uuid[];

comment on column public.ai_events.created_transaction_ids is
  'ids das transacoes criadas por este parse — alimenta o desfazer da tela de atividade.';

drop policy if exists "ai_events: own rows read" on public.ai_events;
create policy "ai_events: own rows read" on public.ai_events
  for select using (user_id = (select auth.uid()));

create index if not exists ai_events_user_recent_idx
  on public.ai_events (user_id, created_at desc);
