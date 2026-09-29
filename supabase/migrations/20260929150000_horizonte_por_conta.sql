-- O horizonte por conta e por cartão (29/09/2026, spec "E se…? — uma hipótese só e o detalhe
-- por conta"): o "antes" pelas portas públicas e o "depois" pelas leituras `contas`/`cartoes` do
-- `simular` — a MESMA função privada nos dois.
--
-- Conta: saldo hoje, o menor saldo (e o dia), o saldo no fim e o primeiro dia negativo, a partir
-- de `caixa_das_contas` + `eventos_de_caixa` (20260929140000). Uma linha por conta que tem caixa
-- ou evento — inclusive "sem conta" (account_id null) e a conta de um cartão com recorrente
-- projetada; a tela filtra. A soma dos saldos no fim É a projeção no fim.
-- Cartão: o limite (null = sem limite cadastrado), o livre (a mesma conta do `card_summary`:
-- limite − o que falta pagar das faturas não pagas; null sem limite) e as faturas não pagas até o
-- fim, com o total pela régua `conta_na_fatura`.

create or replace function private.contas_no_horizonte(ws_ids uuid[], fim date)
returns jsonb
language sql stable
set search_path = public
set timezone to 'America/Sao_Paulo'
as $$
  with base as (select account_id, cents from private.caixa_das_contas(ws_ids, current_date)),
  ev as (select account_id, day, sum(in_cents - out_cents)::bigint as delta
         from private.eventos_de_caixa(ws_ids, fim) group by 1, 2),
  contas as (select account_id from base union select account_id from ev),
  dias as (select generate_series(current_date, fim, interval '1 day')::date as day),
  serie as (
    select k.account_id, d.day,
           (coalesce((select b.cents from base b where b.account_id is not distinct from k.account_id), 0)
            + sum(coalesce(e.delta, 0)) over (partition by k.account_id order by d.day))::bigint as saldo
    from contas k cross join dias d
    left join ev e on e.account_id is not distinct from k.account_id and e.day = d.day
  ),
  resumo as (
    select account_id,
           (array_agg(saldo order by day))[1] as saldo_hoje,
           min(saldo) as menor,
           (array_agg(day order by saldo, day))[1] as dia_do_menor,
           (array_agg(saldo order by day desc))[1] as saldo_fim,
           min(day) filter (where saldo < 0) as negativa_em
    from serie group by account_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'account_id', r.account_id, 'nome', coalesce(a.name, 'Sem conta'), 'tipo', a.type,
           'saldo_hoje', r.saldo_hoje, 'menor', r.menor, 'dia_do_menor', r.dia_do_menor,
           'saldo_fim', r.saldo_fim, 'negativa_em', r.negativa_em) order by a.name nulls last), '[]'::jsonb)
  from resumo r left join public.accounts a on a.id = r.account_id;
$$;

create or replace function private.cartoes_no_horizonte(ws_ids uuid[], fim date)
returns jsonb
language sql stable
set search_path = public
set timezone to 'America/Sao_Paulo'
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'account_id', a.id, 'nome', a.name, 'limite', a.credit_limit_cents,
    'livre', case when a.credit_limit_cents is null then null else a.credit_limit_cents - coalesce((
               select sum(private.invoice_open_cents(ci.id)) from public.card_invoices ci
               where ci.account_id = a.id and ci.status not in ('paid','rolled')), 0) end,
    'faturas', (select coalesce(jsonb_agg(jsonb_build_object(
                  'invoice_id', ci.id, 'vencimento', ci.due_date,
                  'total', (select coalesce(sum(t.amount_cents), 0) from public.transactions t
                            where t.invoice_id = ci.id and private.conta_na_fatura(t.kind)),
                  'aberto', private.invoice_open_cents(ci.id)) order by ci.due_date), '[]'::jsonb)
                from public.card_invoices ci
                where ci.account_id = a.id and ci.status not in ('paid','rolled') and ci.due_date <= fim)
  ) order by a.name), '[]'::jsonb)
  from public.accounts a
  where a.workspace_id = any(ws_ids) and a.type = 'credit_card' and not a.archived;
$$;
revoke execute on function private.contas_no_horizonte(uuid[], date) from public, anon;
revoke execute on function private.cartoes_no_horizonte(uuid[], date) from public, anon;
grant execute on function private.contas_no_horizonte(uuid[], date) to authenticated, service_role;
grant execute on function private.cartoes_no_horizonte(uuid[], date) to authenticated, service_role;

create or replace function public.accounts_horizon(days int default 90)
returns jsonb
language sql stable
security invoker
set search_path = public
set timezone to 'America/Sao_Paulo'
as $$
  select private.contas_no_horizonte(array(select private.my_workspace_ids()),
                                     current_date + private.clamp_forecast_days(days));
$$;
create or replace function public.cards_horizon(days int default 90)
returns jsonb
language sql stable
security invoker
set search_path = public
set timezone to 'America/Sao_Paulo'
as $$
  select private.cartoes_no_horizonte(array(select private.my_workspace_ids()),
                                      current_date + private.clamp_forecast_days(days));
$$;
revoke execute on function public.accounts_horizon(int) from public, anon;
revoke execute on function public.cards_horizon(int) from public, anon;
grant execute on function public.accounts_horizon(int) to authenticated;
grant execute on function public.cards_horizon(int) to authenticated;

-- `simular` com as duas leituras novas. Mesma função da 20260929130000; cabeçalho repetido
-- inteiro (`create or replace` apaga a cláusula que não for repetida).
create or replace function public.simular(p_registros jsonb, p_leituras jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
set timezone to 'America/Sao_Paulo'
as $$
declare
  r jsonb;
  i int := 0;
  leituras jsonb := '{}'::jsonb;
  criados jsonb := '[]'::jsonb;
  erros jsonb := '[]'::jsonb;
  l jsonb;
  feito jsonb;
begin
  -- Teto: cada hipótese é uma subtransação que grava, e sem limite o custo (e o cache de
  -- subtransações do Postgres) também não tem.
  if jsonb_array_length(coalesce(p_registros, '[]'::jsonb)) > 30 then
    raise exception 'hipóteses demais (máximo 30)';
  end if;
  begin
    for r in select value from jsonb_array_elements(coalesce(p_registros, '[]'::jsonb)) loop
      -- Cada registro na sua subtransação: o que falha é desfeito sozinho e vira erro.
      begin
        feito := private.criar_registro_da_hipotese(r->>'tipo', r->'dados');
        criados := criados || jsonb_build_object('indice', i, 'ids', feito->'ids', 'faturas', feito->'faturas');
      exception when others then
        erros := erros || jsonb_build_object('indice', i, 'mensagem', sqlerrm, 'codigo', sqlstate);
      end;
      i := i + 1;
    end loop;

    -- Cada leitura na sua subtransação: uma que falhe vira erro, as outras voltam.
    l := p_leituras->'forecast';
    if l is not null then
      begin
        leituras := leituras || jsonb_build_object('forecast',
          public.forecast_json((l->>'days')::int, coalesce(nullif(l->'drafts', 'null'::jsonb), '[]'::jsonb)));
      exception when others then
        erros := erros || jsonb_build_object('leitura', 'forecast', 'mensagem', sqlerrm, 'codigo', sqlstate);
      end;
    end if;
    l := p_leituras->'meses';
    if l is not null then
      begin
        leituras := leituras || jsonb_build_object('meses',
          public.month_forecast_json((l->>'days')::int, coalesce(nullif(l->'drafts', 'null'::jsonb), '[]'::jsonb), l->>'view'));
      exception when others then
        erros := erros || jsonb_build_object('leitura', 'meses', 'mensagem', sqlerrm, 'codigo', sqlstate);
      end;
    end if;
    l := p_leituras->'ciclo';
    if l is not null then
      begin
        leituras := leituras || jsonb_build_object('ciclo', coalesce((select jsonb_agg(to_jsonb(c))
          from public.cycle_series((l->>'de')::date, (l->>'ate')::date, l->>'view') c), '[]'::jsonb));
      exception when others then
        erros := erros || jsonb_build_object('leitura', 'ciclo', 'mensagem', sqlerrm, 'codigo', sqlstate);
      end;
    end if;
    l := p_leituras->'linhas_do_ciclo';
    if l is not null then
      begin
        leituras := leituras || jsonb_build_object('linhas_do_ciclo', coalesce((select jsonb_agg(to_jsonb(c))
          from public.cycle_lines((l->>'mes')::date, l->>'view') c), '[]'::jsonb));
      exception when others then
        erros := erros || jsonb_build_object('leitura', 'linhas_do_ciclo', 'mensagem', sqlerrm, 'codigo', sqlstate);
      end;
    end if;

    l := p_leituras->'contas';
    if l is not null then
      begin
        leituras := leituras || jsonb_build_object('contas', public.accounts_horizon((l->>'days')::int));
      exception when others then
        erros := erros || jsonb_build_object('leitura', 'contas', 'mensagem', sqlerrm, 'codigo', sqlstate);
      end;
    end if;
    l := p_leituras->'cartoes';
    if l is not null then
      begin
        leituras := leituras || jsonb_build_object('cartoes', public.cards_horizon((l->>'days')::int));
      exception when others then
        erros := erros || jsonb_build_object('leitura', 'cartoes', 'mensagem', sqlerrm, 'codigo', sqlstate);
      end;
    end if;

    -- Desfaz TUDO. As variáveis sobrevivem ao `exception`; as escritas, não.
    raise exception using errcode = 'PSIM1', message = 'simulação desfeita';
  exception when sqlstate 'PSIM1' then
    null;
  end;
  return jsonb_build_object('leituras', leituras, 'criados', criados, 'erros', erros);
end;
$$;
revoke execute on function public.simular(jsonb, jsonb) from public, anon;
grant execute on function public.simular(jsonb, jsonb) to authenticated;
