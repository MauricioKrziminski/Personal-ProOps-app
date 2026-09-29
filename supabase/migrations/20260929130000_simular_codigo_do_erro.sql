-- `simular` devolve o CÓDIGO do erro junto da mensagem (29/09/2026, revisão final).
--
-- A tela escrevia o texto cru do Postgres na linha da hipótese e no ciclo ("new row for relation
-- ... violates check constraint ..."). O app só mostra a frase do banco quando ela é NOSSA
-- (`raise exception`, P0001) — a mesma régua de `financeErrorMessage` —, e para isso precisa do
-- código. A função é a mesma da 20260929120000; só `'codigo', sqlstate` entra em cada erro.
-- Cabeçalho repetido inteiro: `create or replace` apaga cláusula que não for repetida.

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
