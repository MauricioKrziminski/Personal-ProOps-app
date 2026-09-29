-- Hipóteses detalhadas do "E se…?" (spec 2026-09-28-hipoteses-detalhadas-e-aplicar-design.md).
--
-- `simular` CRIA os registros de verdade, pelo mesmo caminho do formulário, roda as leituras
-- pedidas e DESFAZ tudo numa subtransação — as regras de fatura (`set_invoice`), cronograma
-- (`debt_schedule_for`) e recorrência (`recurring_projection_for`) valem sem uma segunda cópia.
-- `security invoker`: RLS vale e o `workspace_id` sai do default da coluna, como na criação manual.

-- Insere UMA linha com só as colunas permitidas que vieram; o resto fica com o default da coluna.
create or replace function private.inserir_da_hipotese(p_tabela text, p_linha jsonb, p_permitidas text[])
returns uuid
language plpgsql
set search_path = public
as $$
declare
  cols text;
  novo uuid;
begin
  if p_tabela is null or p_tabela not in ('transactions', 'recurring_transactions', 'debts') then
    raise exception 'tabela não permitida: %', p_tabela;
  end if;
  -- Campo fora da lista é ERRO, não silêncio: o insert real (PostgREST) recusaria, e ignorar
  -- faria a simulação divergir do "Aplicar" sem ninguém ver. Dono e espaço nunca vêm de fora.
  if exists (select 1 from jsonb_object_keys(p_linha) k
             where k <> all(p_permitidas) or k in ('id', 'user_id', 'workspace_id')) then
    raise exception 'campo fora da lista: %', (select string_agg(k, ', ') from jsonb_object_keys(p_linha) k
      where k <> all(p_permitidas) or k in ('id', 'user_id', 'workspace_id'));
  end if;
  select string_agg(quote_ident(k), ', ') into cols
    from jsonb_object_keys(p_linha) k where k = any(p_permitidas);
  if cols is null then raise exception 'hipótese sem campos'; end if;
  execute format(
    'insert into public.%I (%s, user_id) select %s, auth.uid() from jsonb_populate_record(null::public.%I, $1) returning id',
    p_tabela, cols, cols, p_tabela)
    using p_linha into novo;
  return novo;
end;
$$;
revoke execute on function private.inserir_da_hipotese(text, jsonb, text[]) from public, anon;
grant execute on function private.inserir_da_hipotese(text, jsonb, text[]) to authenticated;

-- Um registro da hipótese → `{ids, faturas}`: `ids` é o que ela CRIOU (linhas, plano, série,
-- dívida e faturas novas) e pode aparecer como `ref_id` nas leituras; `faturas` são as que JÁ
-- existiam e receberam a hipótese — marcá-las como hipótese marcaria as compras reais junto.
create or replace function private.criar_registro_da_hipotese(p_tipo text, p_dados jsonb)
returns jsonb
language plpgsql
set search_path = public
set timezone to 'America/Sao_Paulo'
as $$
declare
  linha jsonb;
  ids uuid[] := '{}';
  novo uuid;
  plano uuid;
begin
  if p_tipo = 'lancamento' then
    if jsonb_typeof(p_dados->'linhas') is distinct from 'array' or jsonb_array_length(p_dados->'linhas') = 0 then
      raise exception 'hipótese sem linhas';
    end if;
    if jsonb_array_length(p_dados->'linhas') > 30 then
      raise exception 'linhas demais na hipótese (máximo 30)';
    end if;
    for linha in select value from jsonb_array_elements(p_dados->'linhas') loop
      novo := private.inserir_da_hipotese('transactions', linha, array[
        'kind', 'amount_cents', 'category', 'description', 'merchant', 'account_id',
        'counterparty_account_id', 'occurred_at', 'status', 'due_at', 'auto_confirm', 'source']);
      ids := ids || novo;
    end loop;
  elsif p_tipo = 'parcelada' then
    if coalesce((p_dados->>'ultimo_dia')::boolean, false) then
      plano := public.create_installment_plan_last_day(
        (p_dados->>'p_account_id')::uuid, (p_dados->>'p_total_cents')::bigint,
        (p_dados->>'p_installments')::int, (p_dados->>'p_occurred_at')::date,
        coalesce((p_dados->>'p_paid_installments')::int, 0), p_dados->>'p_description',
        p_dados->>'p_category', p_dados->>'p_merchant');
    else
      plano := public.create_installment_plan_with_history(
        (p_dados->>'p_account_id')::uuid, (p_dados->>'p_total_cents')::bigint,
        (p_dados->>'p_installments')::int, (p_dados->>'p_occurred_at')::date,
        coalesce((p_dados->>'p_paid_installments')::int, 0), p_dados->>'p_description',
        p_dados->>'p_category', p_dados->>'p_merchant');
    end if;
    ids := ids || plano;
    ids := ids || array(select t.id from public.transactions t where t.installment_plan_id = plano);
  elsif p_tipo = 'recorrente' then
    ids := ids || private.inserir_da_hipotese('recurring_transactions', p_dados, array[
      'kind', 'amount_cents', 'description', 'merchant', 'category', 'account_id', 'rrule',
      'next_run_at', 'dtstart', 'end_date', 'auto_confirm']);
  elsif p_tipo = 'financiamento' then
    ids := ids || private.inserir_da_hipotese('debts', p_dados, array[
      'name', 'kind', 'calculation_mode', 'principal_cents', 'remaining_cents',
      'interest_rate_monthly', 'installments', 'installments_paid', 'installment_cents',
      'account_id', 'due_day', 'first_due_date']);
  else
    raise exception 'tipo de hipótese desconhecido: %', p_tipo;
  end if;
  -- As faturas em que as linhas caíram (a compra aparece no ciclo pela fatura). É da hipótese a
  -- fatura em que TODAS as linhas são dela; a que tem linha real vai à parte, senão a tela
  -- marcaria as compras reais como hipótese. (Pelo `created_at` não serve: dentro da mesma
  -- transação todo `now()` é igual.)
  return jsonb_build_object(
    'ids', to_jsonb(ids || array(
      select distinct t.invoice_id from public.transactions t
       where t.id = any(ids) and t.invoice_id is not null
         and not exists (select 1 from public.transactions o
                          where o.invoice_id = t.invoice_id and not (o.id = any(ids))))),
    'faturas', to_jsonb(array(
      select distinct t.invoice_id from public.transactions t
       where t.id = any(ids) and t.invoice_id is not null
         and exists (select 1 from public.transactions o
                      where o.invoice_id = t.invoice_id and not (o.id = any(ids))))));
end;
$$;
revoke execute on function private.criar_registro_da_hipotese(text, jsonb) from public, anon;
grant execute on function private.criar_registro_da_hipotese(text, jsonb) to authenticated;

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
        erros := erros || jsonb_build_object('indice', i, 'mensagem', sqlerrm);
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
        erros := erros || jsonb_build_object('leitura', 'forecast', 'mensagem', sqlerrm);
      end;
    end if;
    l := p_leituras->'meses';
    if l is not null then
      begin
        leituras := leituras || jsonb_build_object('meses',
          public.month_forecast_json((l->>'days')::int, coalesce(nullif(l->'drafts', 'null'::jsonb), '[]'::jsonb), l->>'view'));
      exception when others then
        erros := erros || jsonb_build_object('leitura', 'meses', 'mensagem', sqlerrm);
      end;
    end if;
    l := p_leituras->'ciclo';
    if l is not null then
      begin
        leituras := leituras || jsonb_build_object('ciclo', coalesce((select jsonb_agg(to_jsonb(c))
          from public.cycle_series((l->>'de')::date, (l->>'ate')::date, l->>'view') c), '[]'::jsonb));
      exception when others then
        erros := erros || jsonb_build_object('leitura', 'ciclo', 'mensagem', sqlerrm);
      end;
    end if;
    l := p_leituras->'linhas_do_ciclo';
    if l is not null then
      begin
        leituras := leituras || jsonb_build_object('linhas_do_ciclo', coalesce((select jsonb_agg(to_jsonb(c))
          from public.cycle_lines((l->>'mes')::date, l->>'view') c), '[]'::jsonb));
      exception when others then
        erros := erros || jsonb_build_object('leitura', 'linhas_do_ciclo', 'mensagem', sqlerrm);
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
