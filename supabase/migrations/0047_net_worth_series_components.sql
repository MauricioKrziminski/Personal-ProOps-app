-- Série do patrimônio: os CINCO componentes, somados por workspace.
--
-- Dois problemas na versão da 0026, no mesmo `select`:
--
-- 1. **A série ignorava workspaces.** `distinct on (date_trunc('month', as_of))` escolhia UMA
--    linha por mês entre TODOS os workspaces do usuário. Quem participa de dois (convite de
--    membro é estado normal) via o gráfico de um deles enquanto o número de hoje — que sai de
--    `net_worth()`, que SOMA — trazia os dois. As duas leituras se contradiziam na mesma tela.
--    Agora é a última foto de cada `(workspace, mês)` e depois `sum()` por mês, que é a mesma
--    conta de `net_worth()`.
-- 2. **A tabela guarda 5 métricas por dia e a função devolvia 2.** `cash_cents`,
--    `investments_cents` e `other_assets_cents` estavam gravados desde a 0026 e nunca saíam.
--
-- `create or replace` NÃO consegue mudar as colunas de retorno ("cannot change return type of
-- existing function"), então é drop + create. As colunas antigas mantêm nome e ordem: bundle
-- velho em campo lê por nome e simplesmente ignora as novas.
--
-- Continua `security invoker` sob RLS, como as outras leituras do APP (o agente Python não usa
-- esta função, então não existe par interna/wrapper aqui).

drop function if exists public.net_worth_series(int);

create function public.net_worth_series(months_back int default 12)
returns table(
  month date,
  net_cents bigint,
  liabilities_cents bigint,
  cash_cents bigint,
  investments_cents bigint,
  other_assets_cents bigint
)
language sql stable
set search_path = public
as $$
  with ultima_do_mes as (
    select distinct on (s.workspace_id, date_trunc('month', s.as_of))
           s.workspace_id,
           date_trunc('month', s.as_of)::date as month,
           s.net_cents,
           s.liabilities_cents,
           s.cash_cents,
           s.investments_cents,
           s.other_assets_cents
    from public.net_worth_snapshots s
    where s.workspace_id in (select private.my_workspace_ids())
      and s.as_of >= (date_trunc('month', current_date)
                      - make_interval(months => least(greatest(coalesce(months_back, 12), 1), 60)))::date
    order by s.workspace_id, date_trunc('month', s.as_of), s.as_of desc
  )
  select u.month,
         sum(u.net_cents)::bigint,
         sum(u.liabilities_cents)::bigint,
         sum(u.cash_cents)::bigint,
         sum(u.investments_cents)::bigint,
         sum(u.other_assets_cents)::bigint
  from ultima_do_mes u
  group by u.month
  -- Ordem explícita: a tela lê `pontos[0]` como a foto MAIS ANTIGA e a última como a de hoje.
  -- Antes isso era efeito colateral do `order by` do `distinct on`.
  order by u.month;
$$;
