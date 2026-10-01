-- Arquivados são histórico: conservam seu nome e permitem um novo contrato homônimo.
-- Entre ativos continua existindo somente um nome exato por workspace.
alter table public.debts drop constraint if exists debts_workspace_id_name_key;
create unique index if not exists debts_workspace_id_name_key
  on public.debts(workspace_id,name) where not archived;
