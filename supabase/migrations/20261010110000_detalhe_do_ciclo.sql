-- "Como chego nesse valor" (07/10/2026, *"ter um detalhamento do valor que fecha o ciclo: o saldo de
-- cada conta, o que veio do mês anterior…"*).
--
-- UMA leitura que abre o número do ciclo em partes que se SOMAM até ele, das mesmas fontes que o
-- calculam — nada de segunda aritmética:
--   * ciclo ABERTO: parte do caixa de HOJE, conta por conta (`private.caixa_das_contas`, cuja soma é
--     o `cash_total`), e soma só o que AINDA vai acontecer (`cash_events` sem `realizado`). A
--     identidade `caixa de hoje = comecei_com + entrou_realizado − saiu_realizado` foi conferida nos
--     espaços do staging nas duas réguas antes de escrever isto, e `detalhe_do_ciclo.sql` a prende;
--   * ciclo PREVISTO: parte do resultado do ciclo anterior (`comecei_com`), com o ciclo inteiro;
--   * ciclo FECHADO: parte do `comecei_com`, com o ciclo inteiro; o resultado é o caixa no fim, e o
--     que faltou pagar vem à parte (fora da soma, como na tela do ciclo).
-- `por_origem` agrupa por `origin`; o app põe cada origem no balde da tela do ciclo.

create or replace function private.cycle_breakdown_for(ws_ids uuid[], p_month date, p_view text default null)
returns jsonb
language sql
stable
set search_path = public
set timezone to 'America/Sao_Paulo'
as $$
  with c as (
    select * from private.cycle_series_for(ws_ids, p_month, p_month, p_view) order by ini limit 1
  ),
  ev as (
    select x.origin, sum(x.in_cents)::bigint in_cents, sum(x.out_cents)::bigint out_cents
    from c cross join lateral private.cash_events(ws_ids, c.ini, c.fim) x
    where c.estado <> 'aberto' or not x.realizado
    group by x.origin
  ),
  contas as (
    select k.account_id, coalesce(a.name, 'Sem conta') nome, a.type tipo, k.cents
    from private.caixa_das_contas(ws_ids, current_date) k
    left join public.accounts a on a.id = k.account_id
    where k.cents <> 0
  )
  select jsonb_build_object(
    'estado', c.estado,
    'ini', c.ini,
    'fim', c.fim,
    'partida', case when c.estado = 'aberto' then jsonb_build_object(
        'tipo', 'contas',
        'cents', private.cash_total(ws_ids, current_date),
        'contas', coalesce((select jsonb_agg(jsonb_build_object(
            'account_id', k.account_id, 'nome', k.nome, 'tipo', k.tipo, 'cents', k.cents)
            order by k.cents desc, k.nome) from contas k), '[]'::jsonb))
      else jsonb_build_object(
        'tipo', case when c.estado = 'previsto' then 'anterior' else 'inicio' end,
        'cents', c.comecei_com,
        'contas', '[]'::jsonb) end,
    'entra', coalesce((select sum(e.in_cents) from ev e), 0),
    'sai', coalesce((select sum(e.out_cents) from ev e), 0),
    'por_origem', coalesce((select jsonb_agg(jsonb_build_object(
        'origin', e.origin, 'in_cents', e.in_cents, 'out_cents', e.out_cents) order by e.origin)
        from ev e), '[]'::jsonb),
    'resultado', c.resultado,
    'caixa_no_fim', c.caixa_no_fim,
    'faltou_pagar', c.faltou_pagar
  )
  from c;
$$;

create or replace function public.cycle_breakdown(p_month date, p_view text default null)
returns jsonb
language sql
stable
security invoker
set search_path = public
set timezone to 'America/Sao_Paulo'
as $$
  select private.cycle_breakdown_for(array(select private.my_workspace_ids()), p_month, p_view);
$$;

revoke execute on function private.cycle_breakdown_for(uuid[], date, text) from public, anon;
revoke execute on function public.cycle_breakdown(date, text) from public, anon;
grant execute on function private.cycle_breakdown_for(uuid[], date, text) to authenticated;
grant execute on function public.cycle_breakdown(date, text) to authenticated;
