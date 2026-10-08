-- As compras simuladas da fatura no formato do app (08/10/2026): sem o plano, a parcela perdia o
-- "compra em 02/09" e mostrava a data da parcela. Cópia do `simular` da 20261010150000.

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
        if r->>'tipo' = 'adiantamento' then
          -- O adiantamento é APLICADO como no "Aplicar" (08/10/2026): o lançamento nasce, as parcelas
          -- cobertas saem da compra, da dívida ou da série, e toda leitura abaixo o vê como real.
          feito := public.apply_anticipation(r->'dados', gen_random_uuid());
          criados := criados || jsonb_build_object('indice', i, 'ids', jsonb_build_array(feito->>'id'),
            'faturas', coalesce((select jsonb_agg(t.invoice_id) from public.transactions t
                                  where t.id = (feito->>'id')::uuid and t.invoice_id is not null), '[]'::jsonb));
        else
          feito := private.criar_registro_da_hipotese(r->>'tipo', r->'dados');
          criados := criados || jsonb_build_object('indice', i, 'ids', feito->'ids', 'faturas', feito->'faturas');
        end if;
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
    l := p_leituras->'detalhe_do_ciclo';
    if l is not null then
      begin
        leituras := leituras || jsonb_build_object('detalhe_do_ciclo',
          public.cycle_breakdown((l->>'mes')::date, l->>'view'));
      exception when others then
        erros := erros || jsonb_build_object('leitura', 'detalhe_do_ciclo', 'mensagem', sqlerrm, 'codigo', sqlstate);
      end;
    end if;
    -- As compras de cada fatura A VENCER do ciclo, com o rascunho gravado (08/10/2026): a fatura
    -- aberta no ciclo listava as compras do banco REAL, e a parcela adiantada seguia ali.
    l := p_leituras->'compras_das_faturas';
    if l is not null then
      begin
        leituras := leituras || jsonb_build_object('compras_das_faturas', coalesce((
          select jsonb_object_agg(f.ref_id, coalesce((
                   -- O mesmo formato do `select` do app (TRANSACTION_COLUMNS): o plano traz a data da
                   -- compra ("compra em 02/09"), e a subcategoria, o nome.
                   select jsonb_agg(to_jsonb(t) || jsonb_build_object(
                            'installment_plans', (select jsonb_build_object('first_occurred_at', p.first_occurred_at)
                                                    from public.installment_plans p where p.id = t.installment_plan_id),
                            'subcategories', (select jsonb_build_object('name', s.name)
                                                from public.subcategories s where s.id = t.subcategory_id))
                          order by t.occurred_at desc, t.id)
                   from public.transactions t where t.invoice_id = f.ref_id), '[]'::jsonb))
          from (select distinct c.ref_id from public.cycle_lines((l->>'mes')::date, l->>'view') c
                 where c.origin = 'invoice' and not c.atrasada and c.ref_id is not null) f), '{}'::jsonb));
      exception when others then
        erros := erros || jsonb_build_object('leitura', 'compras_das_faturas', 'mensagem', sqlerrm, 'codigo', sqlstate);
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
