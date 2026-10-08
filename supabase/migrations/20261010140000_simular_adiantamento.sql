-- A Projeção com hipóteses é o ambiente REAL com as hipóteses gravadas (08/10/2026, pedido do dono
-- do produto: "a projeção tem que ser exatamente como se fosse o ambiente real com as hipóteses
-- sendo lançamentos reais"). O adiantamento era a única hipótese que não virava registro: ia como
-- desconto ao motor de caixa, e o ciclo de março seguia listando a parcela do Mac adiantada em
-- fevereiro. Agora `simular` o APLICA (a mesma `apply_anticipation` do "Aplicar") e tudo que lê
-- o banco dentro da simulação o vê.
--   1. `anticipation_candidates` devolve a conta da origem (`account_id`), o padrão do campo.
--   2. Aplicar e editar aceitam "sem conta", como todo lançamento: fora de conta e de fatura.
--   3. `simular`: registro `adiantamento` e a leitura `detalhe_do_ciclo` ("Como chego nesse valor").
-- Os corpos são cópias das 20261010130000 e 20260929150000 com só essas mudanças.

create or replace function public.anticipation_candidates(p_pay_on date default null)
returns jsonb
language sql
stable
set search_path = public
set timezone to 'America/Sao_Paulo'
as $$
  with ws as (select array(select private.my_workspace_ids()) as ids),
  pagar as (select greatest(coalesce(p_pay_on, current_date), current_date) as dia),
  linhas as (
    select t.*, ci.due_date as fatura_vence
    from public.transactions t
    left join public.card_invoices ci on ci.id = t.invoice_id
    where t.workspace_id in (select private.my_workspace_ids())
      and t.kind = 'expense' and t.status = 'pending'
      and t.adiantamento is null
      and not private.parcela_travada(t.status, t.invoice_id)
      and case when t.invoice_id is null
               then coalesce(t.due_at, t.occurred_at) >= current_date
               else ci.status = 'open' and ci.closing_date > current_date end
  ),
  eventos as (
    select 'plan'::text as source, p.id as ref_id,
           coalesce(nullif(p.description, ''), nullif(p.merchant, ''), 'Compra parcelada') as title,
           a.name as account_name, l.installment_no as n, p.installments as total_n,
           case when l.invoice_id is null then greatest(coalesce(l.due_at, l.occurred_at), current_date)
                else greatest(l.fatura_vence, current_date) end as dia,
           l.amount_cents as cents, null::numeric as taxa,
           l.id as linha_id, l.occurred_at as ocorre, p.account_id as conta_id
    from linhas l
    join public.installment_plans p on p.id = l.installment_plan_id and p.workspace_id = l.workspace_id
    left join public.accounts a on a.id = p.account_id

    union all

    select 'debt', d.id, d.name, a.name, s.installment_no, d.installments,
           greatest(s.due_date, current_date), s.payment_cents, d.interest_rate_monthly,
           null::uuid, s.due_date, d.account_id
    from public.debts d
    cross join lateral private.debt_schedule_for(d.id) s
    left join public.accounts a on a.id = d.account_id
    where d.workspace_id in (select private.my_workspace_ids())
      and not d.archived and d.remaining_cents > 0
      and s.due_date >= current_date

    union all

    select 'recurring', r.id, coalesce(nullif(r.description, ''), r.category, 'Recorrente'),
           a.name, null::int, null::int,
           case when l.invoice_id is null then greatest(coalesce(l.due_at, l.occurred_at), current_date)
                else greatest(l.fatura_vence, current_date) end,
           l.amount_cents, null,
           l.id, l.occurred_at, r.account_id
    from linhas l
    join public.recurring_transactions r on r.id = l.recurring_id and r.workspace_id = l.workspace_id
    left join public.accounts a on a.id = r.account_id

    union all

    select 'recurring', pr.recurring_id, pr.description, a.name, null, null,
           pr.due_date, pr.amount_cents, null,
           null::uuid, pr.due_date, pr.account_id
    from private.recurring_projection_for((select ids from ws), current_date,
           current_date + private.clamp_forecast_days(3650)) pr
    left join public.accounts a on a.id = pr.account_id
    where pr.kind = 'expense'
  ),
  com_valor as (
    select e.*,
           case when coalesce(e.taxa, 0) > 0 and e.dia > (select dia from pagar)
                then round(e.cents / power(1 + e.taxa,
                       extract(year from age(e.dia, (select dia from pagar))) * 12
                       + extract(month from age(e.dia, (select dia from pagar)))))::bigint
                else e.cents end as pv_cents
    from eventos e
    where e.dia > (select dia from pagar)
  ),
  itens as (
    select jsonb_build_object(
             'source', source, 'ref_id', ref_id, 'title', title, 'account_name', account_name,
             'account_id', conta_id,
             'total_n', max(total_n), 'taxa', max(taxa),
             'events', jsonb_agg(jsonb_build_object(
                         'n', n, 'day', dia, 'cents', cents, 'pv_cents', pv_cents,
                         'id', linha_id, 'on', ocorre)
                       order by dia, n)
           ) as item,
           min(dia) as primeiro
    from com_valor
    group by source, ref_id, title, account_name, conta_id
  )
  select coalesce(jsonb_agg(item order by primeiro), '[]'::jsonb) from itens;
$$;
revoke execute on function public.anticipation_candidates(date) from public, anon;
grant execute on function public.anticipation_candidates(date) to authenticated;

create or replace function private.status_do_adiantamento(p_cartao boolean, p_dia date)
returns text language sql stable set search_path = '' set timezone to 'America/Sao_Paulo' as $$
  select case when not coalesce(p_cartao, false) and p_dia <= current_date then 'cleared' else 'pending' end
$$;
revoke execute on function private.status_do_adiantamento(boolean, date) from public, anon, authenticated;

create or replace function private.aplicar_adiantamento(p_input jsonb, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
set timezone to 'America/Sao_Paulo'
as $$
declare
  uid uuid := auth.uid();
  fonte text := p_input->>'source';
  ref uuid;
  dia date;
  valor bigint;
  conta uuid;
  titulo text := nullif(btrim(coalesce(p_input->>'description', '')), '');
  pedidas jsonb := p_input->'parcelas';
  ws uuid;
  sealed private.anticipation_receipts%rowtype;
  intent jsonb;
  item jsonb;
  ev jsonb;
  pedida jsonb;
  cobertas jsonb := '[]'::jsonb;
  linhas jsonb;
  soma bigint := 0;
  qtd int;
  acc public.accounts%rowtype;
  novo_status text;
  novo_id uuid;
  d public.debts%rowtype;
  serie public.recurring_transactions%rowtype;
  ns int[];
  modo text;
  delta bigint;
  antes jsonb;
  result jsonb;
begin
  if uid is null then
    raise exception using errcode = '42501', message = 'Autenticação obrigatória';
  end if;
  begin
    ref := nullif(p_input->>'ref_id', '')::uuid;
    dia := nullif(p_input->>'paid_on', '')::date;
    valor := nullif(p_input->>'amount_cents', '')::bigint;
    conta := nullif(p_input->>'account_id', '')::uuid;
  exception when others then
    raise exception using errcode = '22023', message = 'Dados do adiantamento inválidos';
  end;
  if fonte is null or fonte not in ('plan', 'debt', 'recurring') or ref is null then
    raise exception using errcode = '22023', message = 'Escolha o que adiantar';
  end if;
  if dia is null then
    raise exception using errcode = '22023', message = 'Informe a data do pagamento';
  end if;
  if valor is null or valor <= 0 then
    raise exception using errcode = '22023', message = 'O valor pago precisa ser maior que zero';
  end if;
  if titulo is null then
    raise exception using errcode = '22023', message = 'Dê um título ao adiantamento';
  end if;
  if pedidas is null or jsonb_typeof(pedidas) <> 'array' or jsonb_array_length(pedidas) = 0 then
    raise exception using errcode = '22023', message = 'Escolha as parcelas';
  end if;
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'Identificador da tentativa obrigatório';
  end if;

  ws := case fonte
          when 'plan' then (select p.workspace_id from public.installment_plans p where p.id = ref)
          when 'debt' then (select x.workspace_id from public.debts x where x.id = ref)
          else (select r.workspace_id from public.recurring_transactions r where r.id = ref) end;
  if ws is null or not exists (select 1 from public.workspace_members m
                               where m.workspace_id = ws and m.user_id = uid) then
    raise exception using errcode = 'P0001', message = 'Isso não existe mais';
  end if;

  intent := jsonb_build_object('operation', 'apply_anticipation', 'input', p_input);
  perform pg_advisory_xact_lock(hashtextextended('anticipation:' || ws::text, 0));
  select * into sealed from private.anticipation_receipts
    where user_id = uid and request_id = p_request_id;
  if sealed.request_id is not null then
    if sealed.payload is distinct from intent then
      raise exception using errcode = '22023', message = 'Identificador reutilizado com dados diferentes';
    end if;
    return sealed.result;
  end if;

  -- Sem conta vale, como em todo lançamento (08/10/2026): o pagamento fica fora de conta e de fatura.
  if conta is not null then
    select * into acc from public.accounts a where a.id = conta and a.workspace_id = ws and not a.archived;
    if acc.id is null then
      raise exception using errcode = 'P0001', message = 'Escolha uma conta ativa deste espaço';
    end if;
  end if;
  if fonte = 'debt' and acc.type = 'credit_card' then
    raise exception using errcode = 'P0001', message = 'O pagamento da dívida sai de uma conta, não de um cartão';
  end if;

  if fonte = 'plan' then
    perform 1 from public.installment_plans p where p.id = ref for update;
    perform 1 from public.transactions t where t.installment_plan_id = ref order by t.id for update;
  elsif fonte = 'debt' then
    select * into d from public.debts x where x.id = ref for update;
  else
    select * into serie from public.recurring_transactions r where r.id = ref for update;
    perform 1 from public.transactions t where t.recurring_id = ref order by t.id for update;
  end if;

  -- O pedido confere com a MESMA lista que a tela usou, na data do pagamento.
  select x into item from jsonb_array_elements(public.anticipation_candidates(dia)) x
   where x->>'source' = fonte and x->>'ref_id' = ref::text;
  if item is null then
    raise exception using errcode = 'P0001', message = 'Isso não tem mais parcela para adiantar nessa data';
  end if;
  for pedida in select * from jsonb_array_elements(pedidas) loop
    ev := null;
    select e into ev from jsonb_array_elements(item->'events') e
     where case when nullif(pedida->>'id', '') is not null then e->>'id' = pedida->>'id'
                when fonte = 'debt' then e->>'n' = pedida->>'n'
                else e->>'id' is null and e->>'on' = pedida->>'on' end
     limit 1;
    if ev is null then
      raise exception using errcode = 'P0001',
        message = 'Uma das parcelas escolhidas não pode mais ser adiantada (foi paga, mudou ou venceu). Abra o adiantamento de novo.';
    end if;
    if cobertas @> jsonb_build_array(ev) then
      raise exception using errcode = '22023', message = 'A mesma parcela foi escolhida duas vezes';
    end if;
    cobertas := cobertas || jsonb_build_array(ev);
    soma := soma + (ev->>'cents')::bigint;
  end loop;
  qtd := jsonb_array_length(cobertas);
  novo_status := private.status_do_adiantamento(acc.type = 'credit_card', dia);

  if fonte = 'plan' then
    -- As linhas como eram (para desfazer), a primeira vira o adiantamento.
    select jsonb_agg(jsonb_build_object('id', t.id, 'n', t.installment_no, 'on', t.occurred_at,
                                        'cents', t.amount_cents, 'linha', to_jsonb(t))
                     order by t.installment_no),
           (array_agg(t.id order by t.installment_no))[1]
      into linhas, novo_id
      from public.transactions t
     where t.id in (select (e->>'id')::uuid from jsonb_array_elements(cobertas) e)
       and t.installment_plan_id = ref and t.status = 'pending' and t.adiantamento is null
       and not private.parcela_travada(t.status, t.invoice_id);
    if coalesce(jsonb_array_length(linhas), 0) <> qtd then
      raise exception using errcode = 'P0001',
        message = 'Uma das parcelas escolhidas não pode mais ser adiantada. Abra o adiantamento de novo.';
    end if;
    perform set_config('proops.editando_adiantamento', novo_id::text, true);
    update public.transactions t set
      amount_cents = valor, occurred_at = dia, due_at = null, account_id = conta,
      description = titulo, status = novo_status,
      paid_at = case when novo_status = 'cleared' then dia end,
      adiantamento = jsonb_build_object('source', 'plan', 'ref_id', ref, 'parcelas', linhas)
     where t.id = novo_id;
    -- Separado: a baixa com outro valor faria `expected_amount_on_settle` guardar só UMA parcela.
    update public.transactions t set expected_amount_cents = soma where t.id = novo_id;
    delete from public.transactions t
     where t.id in (select (e->>'id')::uuid from jsonb_array_elements(linhas) e) and t.id <> novo_id;
    update public.installment_plans p
       set total_cents = (select sum(t.amount_cents) from public.transactions t where t.installment_plan_id = ref),
           updated_at = now()
     where p.id = ref;

  elsif fonte = 'debt' then
    select array_agg((e->>'n')::int order by (e->>'n')::int) into ns from jsonb_array_elements(cobertas) e;
    if ns = array(select generate_series(d.installments_paid + 1, d.installments_paid + qtd)) then
      modo := 'proximas';
    elsif d.installments is not null
          and ns = array(select generate_series(d.installments - qtd + 1, d.installments)) then
      modo := 'ultimas';
    else
      raise exception using errcode = 'P0001',
        message = 'Adiante as próximas parcelas ou as últimas, em sequência';
    end if;
    antes := jsonb_build_object('installments', d.installments, 'installments_paid', d.installments_paid,
                                'remaining_cents', d.remaining_cents, 'principal_cents', d.principal_cents);
    -- Parcela fixa: o saldo é parcela × restantes, então caem N parcelas (o desconto é do
    -- pagamento, não do contrato). Com juros: o que se pagou amortiza o saldo.
    delta := least(d.remaining_cents,
                   case when d.calculation_mode = 'fixed_installments'
                        then qtd * coalesce(d.installment_cents, 0) else valor end);
    update public.debts x set
      installments_paid = case when modo = 'proximas' then x.installments_paid + qtd else x.installments_paid end,
      installments = case when modo = 'ultimas' then x.installments - qtd else x.installments end,
      principal_cents = case when modo = 'ultimas' and x.calculation_mode = 'fixed_installments'
                             then x.principal_cents - delta else x.principal_cents end,
      remaining_cents = x.remaining_cents - delta
     where x.id = d.id
     returning * into d;
    novo_id := gen_random_uuid();
    perform set_config('proops.editando_adiantamento', novo_id::text, true);
    insert into public.transactions
      (id, workspace_id, user_id, kind, amount_cents, category, description, account_id,
       occurred_at, source, status, paid_at, adiantamento, expected_amount_cents)
    values
      (novo_id, ws, uid, 'expense', valor, coalesce(nullif(d.payment_category, ''), 'dívidas'), titulo, conta,
       dia, 'app', novo_status, case when novo_status = 'cleared' then dia end,
       jsonb_build_object('source', 'debt', 'ref_id', ref, 'modo', modo, 'parcelas', cobertas,
         'antes', antes,
         'depois', jsonb_build_object('installments', d.installments, 'installments_paid', d.installments_paid,
                                      'remaining_cents', d.remaining_cents, 'principal_cents', d.principal_cents)),
       soma);

  else
    select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into linhas
      from public.transactions t
     where t.id in (select (e->>'id')::uuid from jsonb_array_elements(cobertas) e where e->>'id' is not null)
       and t.recurring_id = ref and t.status = 'pending' and t.adiantamento is null
       and not private.parcela_travada(t.status, t.invoice_id);
    if jsonb_array_length(linhas) <> (select count(*) from jsonb_array_elements(cobertas) e where e->>'id' is not null) then
      raise exception using errcode = 'P0001',
        message = 'Uma das ocorrências escolhidas não pode mais ser adiantada. Abra o adiantamento de novo.';
    end if;
    -- As geradas saem (o gatilho marca a data como pulada); as só previstas ganham a marca.
    delete from public.transactions t where t.id in (select (x->>'id')::uuid from jsonb_array_elements(linhas) x);
    insert into private.recurring_moved_occurrences (recurring_id, workspace_id, original_date)
      select ref, ws, (e->>'on')::date from jsonb_array_elements(cobertas) e
    on conflict do nothing;
    novo_id := gen_random_uuid();
    perform set_config('proops.editando_adiantamento', novo_id::text, true);
    insert into public.transactions
      (id, workspace_id, user_id, kind, amount_cents, category, description, merchant, account_id,
       occurred_at, source, status, paid_at, adiantamento, expected_amount_cents)
    values
      (novo_id, ws, uid, 'expense', valor, coalesce(serie.category, 'outros'), titulo, serie.merchant, conta,
       dia, 'app', novo_status, case when novo_status = 'cleared' then dia end,
       jsonb_build_object('source', 'recurring', 'ref_id', ref, 'parcelas', cobertas, 'originais', linhas),
       soma);
  end if;

  perform private.recusa_fatura_fechada_do_adiantamento(novo_id);
  perform set_config('proops.editando_adiantamento', '', true);

  result := jsonb_build_object('id', novo_id, 'source', fonte, 'parcelas', qtd,
                               'expected_cents', soma::text, 'amount_cents', valor::text);
  insert into private.anticipation_receipts(user_id, request_id, workspace_id, payload, result)
    values (uid, p_request_id, ws, intent, result);
  return result;
end $$;
revoke execute on function private.aplicar_adiantamento(jsonb, uuid) from public, anon;
grant execute on function private.aplicar_adiantamento(jsonb, uuid) to authenticated;

create or replace function private.editar_adiantamento(p_id uuid, p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
set timezone to 'America/Sao_Paulo'
as $$
declare
  uid uuid := auth.uid();
  t public.transactions%rowtype;
  acc public.accounts%rowtype;
  d public.debts%rowtype;
  titulo text := nullif(btrim(coalesce(p_input->>'description', '')), '');
  valor bigint;
  dia date;
  conta uuid;
  mexe boolean;
  delta bigint;
  depois jsonb;
begin
  if uid is null then
    raise exception using errcode = '42501', message = 'Autenticação obrigatória';
  end if;
  begin
    valor := (p_input->>'amount_cents')::bigint;
    dia := (p_input->>'paid_on')::date;
    conta := nullif(p_input->>'account_id', '')::uuid;
  exception when others then
    raise exception using errcode = '22023', message = 'Dados do adiantamento inválidos';
  end;
  if titulo is null then raise exception using errcode = '22023', message = 'Dê um título ao adiantamento'; end if;
  if valor is null or valor <= 0 then raise exception using errcode = '22023', message = 'O valor pago precisa ser maior que zero'; end if;
  if dia is null then raise exception using errcode = '22023', message = 'Informe a data do pagamento'; end if;

  select * into t from public.transactions x where x.id = p_id for update;
  if t.id is null or t.adiantamento is null or not exists (
       select 1 from public.workspace_members m where m.workspace_id = t.workspace_id and m.user_id = uid) then
    raise exception using errcode = 'P0001', message = 'Esse adiantamento não existe mais';
  end if;
  if conta is not null then
    select * into acc from public.accounts a where a.id = conta and a.workspace_id = t.workspace_id and not a.archived;
    if acc.id is null then raise exception using errcode = 'P0001', message = 'Escolha uma conta ativa deste espaço'; end if;
  end if;
  if t.adiantamento->>'source' = 'debt' and acc.type = 'credit_card' then
    raise exception using errcode = 'P0001', message = 'O pagamento da dívida sai de uma conta, não de um cartão';
  end if;

  mexe := valor <> t.amount_cents or dia <> t.occurred_at or conta is distinct from t.account_id;
  if mexe and t.invoice_id is not null and private.parcela_travada('pending', t.invoice_id) then
    raise exception using errcode = 'P0001',
      message = 'Este adiantamento está numa fatura paga, adiada ou paga em parte. Desfaça o pagamento da fatura antes.';
  end if;

  delta := valor - t.amount_cents;
  if t.adiantamento->>'source' = 'debt' and delta <> 0 then
    select * into d from public.debts x where x.id = (t.adiantamento->>'ref_id')::uuid for update;
    if d.id is not null and d.calculation_mode <> 'fixed_installments' then
      if d.installments is distinct from (t.adiantamento->'depois'->>'installments')::int
         or d.installments_paid <> (t.adiantamento->'depois'->>'installments_paid')::int
         or d.remaining_cents <> (t.adiantamento->'depois'->>'remaining_cents')::bigint then
        raise exception using errcode = 'P0001',
          message = 'A dívida mudou depois deste adiantamento: o valor dele não muda mais o saldo. Desfaça o que veio depois antes.';
      end if;
      if d.remaining_cents - delta < 0 then
        raise exception using errcode = 'P0001', message = 'Esse valor passa do saldo da dívida';
      end if;
      update public.debts x set remaining_cents = x.remaining_cents - delta where x.id = d.id returning * into d;
      depois := jsonb_build_object('installments', d.installments, 'installments_paid', d.installments_paid,
                                   'remaining_cents', d.remaining_cents, 'principal_cents', d.principal_cents);
    end if;
  end if;

  perform set_config('proops.editando_adiantamento', t.id::text, true);
  update public.transactions x set
    description = titulo, amount_cents = valor, occurred_at = dia, account_id = conta,
    status = case when mexe then private.status_do_adiantamento(acc.type = 'credit_card', dia) else x.status end,
    paid_at = case when not mexe then x.paid_at
                   when private.status_do_adiantamento(acc.type = 'credit_card', dia) = 'cleared' then dia end,
    adiantamento = case when depois is null then x.adiantamento
                        else jsonb_set(x.adiantamento, '{depois}', depois) end
   where x.id = t.id;
  update public.transactions x set expected_amount_cents = t.expected_amount_cents where x.id = t.id;
  if t.installment_plan_id is not null then
    update public.installment_plans p
       set total_cents = (select sum(y.amount_cents) from public.transactions y where y.installment_plan_id = p.id)
     where p.id = t.installment_plan_id;
  end if;
  perform private.recusa_fatura_fechada_do_adiantamento(t.id);
  perform set_config('proops.editando_adiantamento', '', true);
  return jsonb_build_object('id', t.id);
end $$;
revoke execute on function private.editar_adiantamento(uuid, jsonb) from public, anon;
grant execute on function private.editar_adiantamento(uuid, jsonb) to authenticated;

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
