-- Aplicar o adiantamento do "E se…?" (08/10/2026, spec 2026-10-08-aplicar-adiantamento-design.md).
--
-- *"Tudo que eu colocar ali na hipótese, eu devo conseguir aplicar"*: o adiantamento era a única
-- hipótese sem "Aplicar", porque nada sabia gravá-lo. Vira UM lançamento ("Adiantamento de 3
-- parcelas de X"), com o valor pago, a data e a conta, e `expected_amount_cents` = a soma das
-- parcelas cobertas — a diferença é o desconto.
--
--   compra parcelada  o lançamento mora DENTRO da compra, no número da 1ª parcela coberta; as
--                     outras cobertas saem. As que sobram MANTÊM o número (decisão do dono do
--                     produto), então o adiantamento é uma parcela de PESO N.
--   financiamento     lançamento avulso; "as próximas" contam N pagas, "as últimas" encurtam o
--                     prazo; o saldo cai (fixa: N parcelas; com juros: o valor pago).
--   recorrente        lançamento avulso; as ocorrências cobertas saem e ficam puladas.
--
-- Desfazer: apagar o lançamento devolve a origem (compra: `apagar_parcelas` "Só esta"; dívida e
-- série: gatilho AFTER DELETE).

-- ── 1. o registro ───────────────────────────────────────────────────────────────────────────
alter table public.transactions add column if not exists adiantamento jsonb;
comment on column public.transactions.adiantamento is
  'Lançamento de adiantamento do E se…: {source, ref_id, parcelas[...], …}. Só nasce por apply_anticipation.';

create table if not exists private.anticipation_receipts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, request_id)
);
create index if not exists anticipation_receipts_workspace_idx on private.anticipation_receipts(workspace_id);
alter table private.anticipation_receipts enable row level security;
revoke all on private.anticipation_receipts from public, anon, authenticated, service_role;

-- Quantos números de parcela uma linha ocupa: 1, ou N no adiantamento de uma compra.
create or replace function private.peso_da_parcela(p_adiantamento jsonb)
returns int language sql immutable set search_path = '' as $$
  select case when p_adiantamento is null or p_adiantamento->>'source' <> 'plan' then 1
              else greatest(jsonb_array_length(p_adiantamento->'parcelas'), 1) end
$$;
revoke execute on function private.peso_da_parcela(jsonb) from public, anon;
grant execute on function private.peso_da_parcela(jsonb) to authenticated, service_role;

-- O adiantamento que passou a começar no número `p_inicio` (renumeração ao apagar parcelas).
create or replace function private.adiantamento_renumerado(p_adiantamento jsonb, p_inicio int)
returns jsonb language sql immutable set search_path = '' as $$
  select case
    when p_adiantamento is null or p_adiantamento->>'source' <> 'plan' then p_adiantamento
    else jsonb_set(p_adiantamento, '{parcelas}', (
      select coalesce(jsonb_agg(e || jsonb_build_object('n', (e->>'n')::int + p_inicio - x.menor)
                                order by (e->>'n')::int), '[]'::jsonb)
      from jsonb_array_elements(p_adiantamento->'parcelas') e,
           (select min((y->>'n')::int) as menor
              from jsonb_array_elements(p_adiantamento->'parcelas') y) x))
  end
$$;
revoke execute on function private.adiantamento_renumerado(jsonb, int) from public, anon;
grant execute on function private.adiantamento_renumerado(jsonb, int) to authenticated, service_role;

-- ── 2. o lançamento do adiantamento não muda por tabela ──────────────────────────────────────
-- Escritas em LOTE (propagar o valor "desta em diante", reescrever "(i/N)", repartir o total,
-- dar baixa nas "já pagas") alcançariam esta linha como se fosse uma parcela comum e desfariam o
-- adiantamento em silêncio. Valor, data, conta, título, número e o próprio registro ficam; status
-- e categoria seguem livres (a fatura que se quita leva junto). Quem muda os congelados é quem
-- nomeia a linha em `proops.editando_adiantamento` (aplicar, editar, desfazer, renumerar: '*').
-- Roda ANTES de `set_invoice` (ordem alfabética), para ele ver os valores já congelados.
create or replace function private.adiantamento_fica()
returns trigger language plpgsql set search_path = '' as $$
declare
  liberado text := coalesce(current_setting('proops.editando_adiantamento', true), '');
begin
  if liberado = '*' or liberado = new.id::text then return new; end if;
  if tg_op = 'INSERT' then
    if new.adiantamento is not null then
      raise exception using errcode = '42501', message = 'O adiantamento só nasce pelo "Aplicar" do E se…';
    end if;
    return new;
  end if;
  if old.adiantamento is null then
    if new.adiantamento is not null then
      raise exception using errcode = '42501', message = 'O adiantamento só nasce pelo "Aplicar" do E se…';
    end if;
    return new;
  end if;
  new.adiantamento := old.adiantamento;
  new.amount_cents := old.amount_cents;
  new.expected_amount_cents := old.expected_amount_cents;
  new.occurred_at := old.occurred_at;
  new.due_at := old.due_at;
  new.account_id := old.account_id;
  new.description := old.description;
  new.kind := old.kind;
  new.installment_plan_id := old.installment_plan_id;
  new.installment_no := old.installment_no;
  new.recurring_id := old.recurring_id;
  new.debt_id := old.debt_id;
  return new;
end $$;
revoke execute on function private.adiantamento_fica() from public, anon, authenticated;

drop trigger if exists a_adiantamento_fica on public.transactions;
create trigger a_adiantamento_fica before insert or update on public.transactions
  for each row execute function private.adiantamento_fica();

-- ── 3. as candidatas: sem o adiantamento, e com a identidade de cada parcela ──────────────────
-- `id` (a linha, quando existe) e `on` (a data da ocorrência) entram para o servidor conferir o
-- pedido contra esta MESMA lista; o resto é a definição da 20260922120000.
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
           l.id as linha_id, l.occurred_at as ocorre
    from linhas l
    join public.installment_plans p on p.id = l.installment_plan_id and p.workspace_id = l.workspace_id
    left join public.accounts a on a.id = p.account_id

    union all

    select 'debt', d.id, d.name, a.name, s.installment_no, d.installments,
           greatest(s.due_date, current_date), s.payment_cents, d.interest_rate_monthly,
           null::uuid, s.due_date
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
           l.id, l.occurred_at
    from linhas l
    join public.recurring_transactions r on r.id = l.recurring_id and r.workspace_id = l.workspace_id
    left join public.accounts a on a.id = r.account_id

    union all

    select 'recurring', pr.recurring_id, pr.description, a.name, null, null,
           pr.due_date, pr.amount_cents, null,
           null::uuid, pr.due_date
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
             'total_n', max(total_n), 'taxa', max(taxa),
             'events', jsonb_agg(jsonb_build_object(
                         'n', n, 'day', dia, 'cents', cents, 'pv_cents', pv_cents,
                         'id', linha_id, 'on', ocorre)
                       order by dia, n)
           ) as item,
           min(dia) as primeiro
    from com_valor
    group by source, ref_id, title, account_name
  )
  select coalesce(jsonb_agg(item order by primeiro), '[]'::jsonb) from itens;
$$;
revoke execute on function public.anticipation_candidates(date) from public, anon;
grant execute on function public.anticipation_candidates(date) to authenticated;

-- ── 4. a regra da recorrente respeita a data pulada além do ano gerado ───────────────────────
-- `recurring_projection_all_for` (a projeção que lê a REGRA, depois de `materialized_until`) não
-- olhava `recurring_moved_occurrences`: a prevista pulada além do ano gerado e o mês adiantado do
-- ano 2 continuavam saindo do caixa. Cópia da 20261009120000 com a exclusão no fim.
create or replace function private.recurring_projection_all_for(
  ws_ids uuid[], from_date date, to_date date
) returns table(recurring_id uuid,kind text,amount_cents bigint,category text,
  description text,account_id uuid,due_date date)
language sql stable set search_path = public
as $$
  select r.id,r.kind,r.amount_cents,coalesce(r.category,'outros'),
    coalesce(nullif(r.description,''),r.category,'Recorrente'),r.account_id,d.due_date
  from public.recurring_transactions r
  left join public.profiles p on p.id=r.user_id
  cross join lateral private.recurring_dates_for(r.rrule,
    (coalesce(r.dtstart,r.next_run_at) at time zone
      coalesce(p.timezone,'America/Sao_Paulo'))::date,from_date,to_date) d
  where r.workspace_id=any(ws_ids) and r.active
    and d.due_date >= (now() at time zone coalesce(p.timezone,'America/Sao_Paulo'))::date
    and d.due_date > coalesce((r.materialized_until at time zone
      coalesce(p.timezone,'America/Sao_Paulo'))::date,date '1900-01-01')
    and (r.end_date is null or d.due_date<=r.end_date)
    and not private.em_pausa(d.due_date, r.paused_from, r.paused_until)
    and not exists (select 1 from public.transactions t
      where t.workspace_id=r.workspace_id and t.recurring_id=r.id
        and t.occurred_at=d.due_date)
    and not exists (select 1 from private.recurring_moved_occurrences m
      where m.recurring_id=r.id and m.original_date=d.due_date);
$$;
revoke execute on function private.recurring_projection_all_for(uuid[],date,date) from public,anon;
grant execute on function private.recurring_projection_all_for(uuid[],date,date) to authenticated,service_role;

-- ── 5. aplicar ──────────────────────────────────────────────────────────────────────────────
-- Status como no "Paguei": conta e data até hoje → pago naquela data; data futura → em aberto
-- naquele dia; cartão → em aberto na fatura da data (que não pode estar paga nem adiada).
create or replace function private.status_do_adiantamento(p_cartao boolean, p_dia date)
returns text language sql stable set search_path = '' set timezone to 'America/Sao_Paulo' as $$
  select case when not p_cartao and p_dia <= current_date then 'cleared' else 'pending' end
$$;
revoke execute on function private.status_do_adiantamento(boolean, date) from public, anon, authenticated;

create or replace function private.recusa_fatura_fechada_do_adiantamento(p_id uuid)
returns void language plpgsql stable set search_path = '' as $$
begin
  if exists (select 1 from public.transactions t
             where t.id = p_id and t.invoice_id is not null
               and private.parcela_travada('pending', t.invoice_id)) then
    raise exception using errcode = 'P0001',
      message = 'Nessa data a fatura do cartão já foi paga ou adiada. Escolha outra data.';
  end if;
end $$;
revoke execute on function private.recusa_fatura_fechada_do_adiantamento(uuid) from public, anon, authenticated;

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
  if conta is null then
    raise exception using errcode = '22023', message = 'Escolha de onde saiu o dinheiro';
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

  select * into acc from public.accounts a where a.id = conta and a.workspace_id = ws and not a.archived;
  if acc.id is null then
    raise exception using errcode = 'P0001', message = 'Escolha uma conta ativa deste espaço';
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

create or replace function public.apply_anticipation(p_input jsonb, p_request_id uuid)
returns jsonb language sql security invoker set search_path = '' set timezone to 'America/Sao_Paulo' as $$
  select private.aplicar_adiantamento(p_input, p_request_id)
$$;
revoke execute on function public.apply_anticipation(jsonb, uuid) from public, anon;
grant execute on function public.apply_anticipation(jsonb, uuid) to authenticated;

-- ── 6. editar: título, valor, data e conta ───────────────────────────────────────────────────
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
    conta := (p_input->>'account_id')::uuid;
  exception when others then
    raise exception using errcode = '22023', message = 'Dados do adiantamento inválidos';
  end;
  if titulo is null then raise exception using errcode = '22023', message = 'Dê um título ao adiantamento'; end if;
  if valor is null or valor <= 0 then raise exception using errcode = '22023', message = 'O valor pago precisa ser maior que zero'; end if;
  if dia is null then raise exception using errcode = '22023', message = 'Informe a data do pagamento'; end if;
  if conta is null then raise exception using errcode = '22023', message = 'Escolha de onde saiu o dinheiro'; end if;

  select * into t from public.transactions x where x.id = p_id for update;
  if t.id is null or t.adiantamento is null or not exists (
       select 1 from public.workspace_members m where m.workspace_id = t.workspace_id and m.user_id = uid) then
    raise exception using errcode = 'P0001', message = 'Esse adiantamento não existe mais';
  end if;
  select * into acc from public.accounts a where a.id = conta and a.workspace_id = t.workspace_id and not a.archived;
  if acc.id is null then raise exception using errcode = 'P0001', message = 'Escolha uma conta ativa deste espaço'; end if;
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

create or replace function public.edit_anticipation(p_id uuid, p_input jsonb)
returns jsonb language sql security invoker set search_path = '' set timezone to 'America/Sao_Paulo' as $$
  select private.editar_adiantamento(p_id, p_input)
$$;
revoke execute on function public.edit_anticipation(uuid, jsonb) from public, anon;
grant execute on function public.edit_anticipation(uuid, jsonb) to authenticated;

-- ── 7. desfazer ─────────────────────────────────────────────────────────────────────────────
-- As linhas voltam com o id, a data, o valor e a conta de antes.
create or replace function private.devolver_linhas(p_linhas jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_linhas is null or jsonb_array_length(p_linhas) = 0 then return; end if;
  insert into public.transactions
    (id, user_id, kind, amount_cents, currency, category, description, account_id, counterparty_account_id,
     occurred_at, source, workspace_id, status, due_at, installment_plan_id, installment_no, merchant,
     recurring_id, auto_confirm, payment_method, expense_pattern, expense_pattern_source,
     expense_necessity, expense_necessity_source, subcategory_id, subcategory_parent_key,
     subcategory_snapshot_set, expected_amount_cents)
  select r.id, r.user_id, r.kind, r.amount_cents, r.currency, r.category, r.description, r.account_id,
         r.counterparty_account_id, r.occurred_at, r.source, r.workspace_id, 'pending', r.due_at,
         r.installment_plan_id, r.installment_no, r.merchant, r.recurring_id, r.auto_confirm,
         r.payment_method, r.expense_pattern, r.expense_pattern_source, r.expense_necessity,
         r.expense_necessity_source, r.subcategory_id, r.subcategory_parent_key,
         r.subcategory_snapshot_set, r.expected_amount_cents
  from jsonb_populate_recordset(null::public.transactions, p_linhas) r
  on conflict do nothing;
  if exists (select 1 from public.transactions t
             where t.id in (select (x->>'id')::uuid from jsonb_array_elements(p_linhas) x)
               and t.invoice_id is not null and private.parcela_travada('pending', t.invoice_id)) then
    raise exception using errcode = 'P0001',
      message = 'As parcelas voltariam para uma fatura já paga ou adiada. Desfaça o pagamento da fatura antes.';
  end if;
end $$;
revoke execute on function private.devolver_linhas(jsonb) from public, anon, authenticated;

-- Compra: o lançamento volta a ser a parcela que era (mesmo id), as outras renascem.
create or replace function private.desfazer_adiantamento_da_compra(p_id uuid)
returns void language plpgsql security definer set search_path = '' set timezone to 'America/Sao_Paulo' as $$
declare
  t public.transactions%rowtype;
  o jsonb;
begin
  select * into t from public.transactions x where x.id = p_id for update;
  if t.id is null or t.adiantamento is null or t.adiantamento->>'source' <> 'plan' then
    raise exception using errcode = 'P0001', message = 'Esse adiantamento não existe mais';
  end if;
  if t.invoice_id is not null and private.parcela_travada('pending', t.invoice_id) then
    raise exception using errcode = 'P0001',
      message = 'Este adiantamento está numa fatura paga, adiada ou paga em parte. Desfaça o pagamento da fatura antes.';
  end if;
  select e->'linha' into o from jsonb_array_elements(t.adiantamento->'parcelas') e where e->>'id' = t.id::text;
  perform set_config('proops.editando_adiantamento', t.id::text, true);
  update public.transactions x set
    amount_cents = (o->>'amount_cents')::bigint, occurred_at = (o->>'occurred_at')::date,
    due_at = (o->>'due_at')::date, account_id = (o->>'account_id')::uuid,
    description = o->>'description', status = 'pending', paid_at = null, adiantamento = null
   where x.id = t.id;
  update public.transactions x set expected_amount_cents = (o->>'expected_amount_cents')::bigint where x.id = t.id;
  perform set_config('proops.editando_adiantamento', '', true);
  perform private.devolver_linhas(
    (select coalesce(jsonb_agg(e->'linha'), '[]'::jsonb) from jsonb_array_elements(t.adiantamento->'parcelas') e
      where e->>'id' <> t.id::text));
  if exists (select 1 from public.transactions x where x.id = t.id and x.invoice_id is not null
             and private.parcela_travada('pending', x.invoice_id)) then
    raise exception using errcode = 'P0001',
      message = 'A parcela voltaria para uma fatura já paga ou adiada. Desfaça o pagamento da fatura antes.';
  end if;
  update public.installment_plans p
     set total_cents = (select sum(y.amount_cents) from public.transactions y where y.installment_plan_id = p.id),
         updated_at = now()
   where p.id = t.installment_plan_id;
end $$;
revoke execute on function private.desfazer_adiantamento_da_compra(uuid) from public, anon;
grant execute on function private.desfazer_adiantamento_da_compra(uuid) to authenticated;

-- Dívida e série: apagar o lançamento (por qualquer caminho) devolve. Não quando a origem, o
-- espaço ou a pessoa já saíram (cascata), nem quando quem apaga diz que é junto com o resto.
create or replace function private.restaura_adiantamento()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  a jsonb := old.adiantamento;
  ref uuid;
  d public.debts%rowtype;
begin
  if a is null or a->>'source' = 'plan'
     or coalesce(current_setting('proops.sem_restaurar_adiantamento', true), '') = '1'
     or not exists (select 1 from public.workspaces w where w.id = old.workspace_id) then
    return null;
  end if;
  ref := (a->>'ref_id')::uuid;
  if a->>'source' = 'debt' then
    select * into d from public.debts x where x.id = ref and x.workspace_id = old.workspace_id for update;
    if d.id is null then return null; end if;
    if d.installments is distinct from (a->'depois'->>'installments')::int
       or d.installments_paid <> (a->'depois'->>'installments_paid')::int
       or d.remaining_cents <> (a->'depois'->>'remaining_cents')::bigint
       or d.principal_cents <> (a->'depois'->>'principal_cents')::bigint then
      raise exception using errcode = 'P0001',
        message = 'A dívida mudou depois deste adiantamento (um pagamento ou uma edição). Desfaça isso antes de apagar o adiantamento.';
    end if;
    update public.debts x set
      installments = (a->'antes'->>'installments')::int,
      installments_paid = (a->'antes'->>'installments_paid')::int,
      remaining_cents = (a->'antes'->>'remaining_cents')::bigint,
      principal_cents = (a->'antes'->>'principal_cents')::bigint
     where x.id = d.id;
  else
    if not exists (select 1 from public.recurring_transactions r
                   where r.id = ref and r.workspace_id = old.workspace_id) then
      return null;
    end if;
    delete from private.recurring_moved_occurrences m
     where m.recurring_id = ref
       and m.original_date in (select (e->>'on')::date from jsonb_array_elements(a->'parcelas') e);
    perform private.devolver_linhas(a->'originais');
  end if;
  return null;
end $$;
revoke execute on function private.restaura_adiantamento() from public, anon, authenticated;

drop trigger if exists restaura_adiantamento on public.transactions;
create trigger restaura_adiantamento after delete on public.transactions
  for each row when (old.adiantamento is not null) execute function private.restaura_adiantamento();

-- ── 8. a compra sabe que o adiantamento ocupa N números ──────────────────────────────────────
-- Cópia da 20260927120000 com o adiantamento como trava de peso N (ver as marcas "adiantamento").
create or replace function public.update_installment_plan(
  p_plan_id uuid,
  p_total_cents bigint,
  p_installments integer,
  p_first_occurred_at date,
  p_description text default null,
  p_category text default null,
  p_merchant text default null,
  p_account_id uuid default null,
  p_paid_installments integer default null
)
returns integer
language plpgsql
security invoker
set search_path = public
set timezone to 'America/Sao_Paulo'
as $$
declare
  plano record;
  acc record;
  travadas int;
  travado_cents bigint;
  na_fatura int;
  ultima_travada int;
  travadas_antes uuid[];
  reabrir record;
  restante bigint;
  abertas int;
  nome text;
  i int;
  ordem int;
  soma bigint;
  parcela record;
  sobrevivente uuid;
  muda_data boolean;
  muda_conta boolean;
begin
  select p.* into plano from public.installment_plans p where p.id = p_plan_id for update;
  if plano.id is null then
    raise exception 'Não achei essa compra parcelada.';
  end if;

  -- O lock que importa é nas PARCELAS: um `pay_invoice` concorrente escreve nelas e nunca no
  -- plano (ver a `20260915210000`). `for update` não vale com agregado, daí o `perform`.
  perform 1 from public.transactions t
   where t.installment_plan_id = p_plan_id and t.workspace_id = plano.workspace_id
   for update;

  if p_installments is null or p_installments < 1 or p_installments > 72 then
    raise exception 'O número de parcelas precisa ficar entre 1 e 72.';
  end if;
  if p_total_cents is null or p_total_cents < p_installments then
    raise exception 'total precisa permitir pelo menos um centavo por parcela';
  end if;
  if p_first_occurred_at is null then
    raise exception 'Informe a data da primeira parcela';
  end if;
  if p_paid_installments is not null and (p_paid_installments < 0 or p_paid_installments > p_installments) then
    raise exception 'As parcelas já pagas precisam ficar entre 0 e %.', p_installments;
  end if;

  -- ── reabrir as que deixaram de ser "já pagas" — ANTES de medir as travas ────────────────
  if p_paid_installments is not null then
    for reabrir in
      select t.id, t.installment_no, t.invoice_id, ci.status as fatura_status, ci.paid_cents,
             ci.settled_manually,
             exists (select 1 from public.transactions o
                      where o.invoice_id = t.invoice_id
                        and o.installment_plan_id is distinct from p_plan_id) as fatura_mista
      from public.transactions t
      left join public.card_invoices ci on ci.id = t.invoice_id
      where t.installment_plan_id = p_plan_id and t.workspace_id = plano.workspace_id
        and t.status = 'cleared' and t.installment_no > p_paid_installments
        and t.adiantamento is null
      order by t.installment_no
    loop
      if reabrir.invoice_id is not null and (
           reabrir.fatura_status = 'rolled' or reabrir.paid_cents > 0
           or (reabrir.fatura_status = 'paid' and (not reabrir.settled_manually or reabrir.fatura_mista))) then
        raise exception 'A parcela % foi paga junto com a fatura do cartão: ela continua paga. Para reabrir, desfaça o pagamento da fatura.',
          reabrir.installment_no;
      end if;
      -- a fatura que o app quitou à mão SÓ por causa desta compra reabre junto (o inverso do quitar)
      if reabrir.invoice_id is not null and reabrir.fatura_status = 'paid' then
        update public.card_invoices ci
           set status = case when ci.closing_date < current_date then 'closed' else 'open' end,
               paid_at = null, settled_manually = false
         where ci.id = reabrir.invoice_id;
      end if;
      update public.transactions t set status = 'pending', paid_at = null where t.id = reabrir.id;
    end loop;
  end if;

  -- O adiantamento (`adiantamento`, 20261010130000) é uma trava que ocupa N números: as parcelas
  -- que ele cobriu não existem mais como linha e não podem renascer, nem ter valor repartido.
  select coalesce(sum(x.peso) filter (where x.travada), 0),
         coalesce(sum(x.amount_cents) filter (where x.travada), 0),
         count(*) filter (where x.trava_de_fatura and x.invoice_id is not null),
         max(x.installment_no + x.peso - 1) filter (where x.travada),
         coalesce(array_agg(x.id) filter (where x.travada), '{}')
    into travadas, travado_cents, na_fatura, ultima_travada, travadas_antes
  from (
    select t.id, t.amount_cents, t.installment_no, t.invoice_id,
           private.parcela_travada(t.status, t.invoice_id) as trava_de_fatura,
           (t.adiantamento is not null or private.parcela_travada(t.status, t.invoice_id)) as travada,
           private.peso_da_parcela(t.adiantamento) as peso
    from public.transactions t
    where t.installment_plan_id = p_plan_id and t.workspace_id = plano.workspace_id
  ) x;

  muda_data := p_first_occurred_at is distinct from plano.first_occurred_at;
  muda_conta := p_account_id is distinct from plano.account_id;

  if travadas > 0 then
    if p_installments = 1 then
      raise exception 'Esta compra já tem parcela paga: à vista seria um pagamento só, e uma parte já foi paga.';
    end if;
    if p_installments < ultima_travada then
      raise exception 'A parcela % já está paga: o número de parcelas não fica abaixo dela.', ultima_travada;
    end if;
    if na_fatura > 0 and muda_data then
      raise exception 'Esta compra tem parcela paga na fatura do cartão: a data da primeira não muda, senão ela sairia da fatura em que foi paga.';
    end if;
    if na_fatura > 0 and muda_conta then
      raise exception 'Esta compra tem parcela paga na fatura do cartão: o cartão não muda, senão ela sairia da fatura em que foi paga.';
    end if;
    if p_installments = travadas then
      if p_total_cents <> travado_cents then
        raise exception 'Todas as parcelas já foram pagas: o total é a soma delas.';
      end if;
    elsif p_total_cents - travado_cents < p_installments - travadas then
      raise exception
        'O total precisa cobrir as % parcela(s) já paga(s) e sobrar pelo menos um centavo para cada parcela em aberto',
        travadas;
    end if;
  end if;

  -- Omitir a conta não pode ZERAR a conta: sem ela `set_invoice` apaga o `invoice_id` das
  -- parcelas e a compra de cartão vira despesa solta, em silêncio.
  if p_account_id is null and plano.account_id is not null then
    raise exception 'Informe a conta desta compra.';
  end if;
  if p_account_id is not null then
    select a.id, a.workspace_id into acc
    from public.accounts a where a.id = p_account_id and not a.archived;
    if acc.id is null or acc.workspace_id <> plano.workspace_id then
      raise exception 'Escolha uma conta ativa.';
    end if;
  end if;

  nome := coalesce(p_description, p_merchant, 'Compra parcelada');

  -- ── 1x: a compra deixa de ser parcelada (só sem parcela travada — o guarda acima) ────────
  -- A ORDEM impede apagar o dado (`installment_plan_id` é `on delete cascade`): solta o
  -- sobrevivente (a parcela 1, mesmo id) → apaga os irmãos → apaga o plano.
  if p_installments = 1 then
    select t.id into sobrevivente
    from public.transactions t
    where t.installment_plan_id = p_plan_id and t.workspace_id = plano.workspace_id
    order by t.installment_no
    limit 1;
    if sobrevivente is null then
      raise exception 'Essa compra não tem parcela nenhuma para virar lançamento.';
    end if;

    update public.transactions t set
      installment_plan_id = null,
      installment_no      = null,
      amount_cents        = p_total_cents,
      occurred_at         = p_first_occurred_at,
      description         = nome,
      merchant            = p_merchant,
      category            = p_category,
      account_id          = p_account_id
    where t.id = sobrevivente and t.workspace_id = plano.workspace_id;

    delete from public.transactions t
     where t.installment_plan_id = p_plan_id and t.workspace_id = plano.workspace_id
       and t.id <> sobrevivente;
    delete from public.installment_plans p
     where p.id = p_plan_id and p.workspace_id = plano.workspace_id;

    if (select private.parcela_travada('pending', t.invoice_id)
        from public.transactions t where t.id = sobrevivente) then
      raise exception 'Essa data (ou essa conta) joga o lançamento dentro de uma fatura já fechada. Escolha outra.';
    end if;

    -- "já paga": o lançamento que sobra nasce pago
    if p_paid_installments = 1 then
      update public.transactions t set status = 'cleared' where t.id = sobrevivente;
    end if;
    return 1;
  end if;

  update public.installment_plans p set
    description       = p_description,
    merchant          = p_merchant,
    category          = p_category,
    account_id        = p_account_id,
    total_cents       = p_total_cents,
    installments      = p_installments,
    first_occurred_at = p_first_occurred_at,
    updated_at        = now()
  where p.id = p_plan_id and p.workspace_id = plano.workspace_id;

  -- Acima do N novo só há parcela em aberto (o guarda da última paga garante).
  delete from public.transactions t
   where t.installment_plan_id = p_plan_id and t.workspace_id = plano.workspace_id
     and (t.installment_no is null or t.installment_no > p_installments);

  -- Nome, estabelecimento e categoria são da COMPRA: valem para todas, inclusive as pagas.
  update public.transactions t set
    description = nome || ' (' || t.installment_no || '/' || p_installments || ')',
    merchant    = p_merchant,
    category    = p_category
  where t.installment_plan_id = p_plan_id and t.workspace_id = plano.workspace_id
    and t.adiantamento is null;
  -- O adiantamento guarda o título que a pessoa deu; categoria e estabelecimento seguem a compra.
  update public.transactions t set merchant = p_merchant, category = p_category
  where t.installment_plan_id = p_plan_id and t.workspace_id = plano.workspace_id
    and t.adiantamento is not null;

  -- Data e conta: nada pago → todas seguem a compra (o calendário é refeito); com parcela paga,
  -- só quando mudaram. A DATA nova vale para as em aberto: a paga fica no dia em que venceu
  -- (27/09/2026, a mesma régua da série recorrente — mudar o dia 4 para o 30 não põe a parcela de
  -- 04/09, já paga, em 30/09). A CONTA da paga fora do cartão acompanha (ela é o registro da
  -- pessoa; a de fatura já foi recusada acima). Mencionar a coluna dispara `set_invoice`: por
  -- isso a parcela travada só entra aqui quando é para mudar.
  if travadas = 0 or muda_data or muda_conta then
    update public.transactions t set
      occurred_at = case when (travadas = 0 or muda_data) and not (t.id = any(travadas_antes))
                         then private.add_months(p_first_occurred_at, t.installment_no - 1)
                         else t.occurred_at end,
      account_id  = case when travadas = 0 or muda_conta then p_account_id else t.account_id end
    where t.installment_plan_id = p_plan_id and t.workspace_id = plano.workspace_id
      and t.adiantamento is null;
  end if;

  -- As que faltam até o N novo nascem em aberto, no calendário da compra — menos as que um
  -- adiantamento cobriu: elas foram pagas dentro dele.
  for i in 1..p_installments loop
    if not exists (select 1 from public.transactions t
                    where t.installment_plan_id = p_plan_id and t.workspace_id = plano.workspace_id
                      and i between t.installment_no
                                and t.installment_no + private.peso_da_parcela(t.adiantamento) - 1) then
      insert into public.transactions
        (workspace_id, user_id, kind, amount_cents, category, description, merchant,
         account_id, occurred_at, source, status, installment_plan_id, installment_no)
      values (plano.workspace_id, coalesce((select auth.uid()), plano.user_id), 'expense', 1,
              p_category, nome || ' (' || i || '/' || p_installments || ')',
              p_merchant, p_account_id,
              private.add_months(p_first_occurred_at, i - 1),
              'app', 'pending', p_plan_id, i);
    end if;
  end loop;

  -- O que falta do total se reparte entre as em aberto, o resto da divisão na última.
  restante := p_total_cents - travado_cents;
  abertas := p_installments - travadas;
  ordem := 0;
  for parcela in
    select t.id from public.transactions t
    where t.installment_plan_id = p_plan_id and t.workspace_id = plano.workspace_id
      and not (t.id = any(travadas_antes))
    order by t.installment_no
  loop
    ordem := ordem + 1;
    update public.transactions t
       set amount_cents = private.valor_da_parcela(restante, abertas, ordem)
     where t.id = parcela.id;
  end loop;

  -- Data ou conta novas não podem jogar uma parcela em aberto numa fatura já fechada.
  if exists (
    select 1 from public.transactions t
    where t.installment_plan_id = p_plan_id and t.workspace_id = plano.workspace_id
      and not (t.id = any(travadas_antes))
      and private.parcela_travada(t.status, t.invoice_id)
  ) then
    raise exception 'Essa data (ou essa conta) joga uma parcela dentro de uma fatura já fechada. Escolha outra.';
  end if;

  -- ── dar baixa nas que passaram a ser "já pagas", e quitar a fatura vencida que é só delas ──
  if p_paid_installments is not null then
    update public.transactions t set status = 'cleared'
     where t.installment_plan_id = p_plan_id and t.workspace_id = plano.workspace_id
       and t.installment_no <= p_paid_installments and t.status = 'pending'
       and t.adiantamento is null;
  end if;
  -- Também quando a conta ou a data mudaram: a parcela paga fora do cartão que passou para um
  -- cartão caiu numa fatura vencida que só tem ela — a mesma regra da criação com histórico.
  if p_paid_installments is not null or muda_conta or muda_data then
    perform private.quitar_faturas_do_plano(p_plan_id);
  end if;

  select coalesce(sum(t.amount_cents), 0) into soma
  from public.transactions t
  where t.installment_plan_id = p_plan_id and t.workspace_id = plano.workspace_id;
  if soma <> p_total_cents then
    raise exception 'a soma das parcelas (%) não fecha com o total (%)', soma, p_total_cents;
  end if;

  return p_installments;
end;
$$;

revoke execute on function public.update_installment_plan(uuid, bigint, integer, date, text, text, text, uuid, integer) from public, anon;
grant execute on function public.update_installment_plan(uuid, bigint, integer, date, text, text, text, uuid, integer) to authenticated;

-- ── 9. apagar parcelas: renumera pelo peso; "Só esta" no adiantamento desfaz ─────────────────
-- Cópia da 20261008100100 com o adiantamento.
create or replace function private.apagar_parcelas(
  p_tipo text, p_id uuid, p_alcance text, p_ws uuid, p_apply boolean
) returns jsonb
language plpgsql set search_path = '' set timezone to 'America/Sao_Paulo'
as $$
declare
  plano public.installment_plans%rowtype;
  ancora public.transactions%rowtype;
  n_ancora int; ids uuid[]; res jsonb; total int; restantes int; soma bigint; sobra uuid; nome text;
  contrato boolean := false;
begin
  if p_tipo = 'installment' then
    select * into ancora from public.transactions t where t.id = p_id and t.workspace_id = p_ws;
    if ancora.installment_plan_id is null then
      raise exception using errcode = '22023', message = 'Este lançamento não é parcela de uma compra';
    end if;
    select * into plano from public.installment_plans p where p.id = ancora.installment_plan_id;
  else
    select * into plano from public.installment_plans p where p.id = p_id;
  end if;
  if plano.id is null or plano.workspace_id <> p_ws then
    raise exception using errcode = 'P0001', message = 'Esse registro não existe mais';
  end if;
  if p_apply then
    perform 1 from public.installment_plans p where p.id = plano.id for update;
    perform 1 from public.transactions t where t.installment_plan_id = plano.id order by t.id for update;
    -- relê depois do travamento: outra transação pode ter apagado ou mexido
    select * into plano from public.installment_plans p where p.id = plano.id;
    if plano.id is null then
      raise exception using errcode = 'P0001', message = 'Esse registro não existe mais';
    end if;
    if p_tipo = 'installment' then
      select * into ancora from public.transactions t where t.id = p_id and t.workspace_id = p_ws;
      if ancora.id is null or ancora.installment_plan_id is distinct from plano.id then
        raise exception using errcode = 'P0001', message = 'Esse registro não existe mais';
      end if;
    end if;
  end if;

  -- "Só esta" sobre o lançamento de um adiantamento DESFAZ: as parcelas voltam (20261010130000).
  if p_tipo = 'installment' and p_alcance = 'one' and ancora.adiantamento is not null then
    perform private.recusa_fatura_travada(array[ancora.id]);
    res := private.resumo_do_apagar(array[ancora.id]) || jsonb_build_object('desfaz_adiantamento', true);
    if p_apply then perform private.desfazer_adiantamento_da_compra(ancora.id); end if;
    return res;
  end if;

  if p_tipo = 'installment' then
    n_ancora := ancora.installment_no;
  else
    -- pelo contrato, "próximas" = a primeira parcela em aberto fora de fatura travada
    select min(t.installment_no) into n_ancora from public.transactions t
      where t.installment_plan_id = plano.id and t.workspace_id = p_ws and t.status = 'pending'
        and t.adiantamento is null
        and not private.parcela_travada('pending', t.invoice_id);
    if n_ancora is null and p_alcance = 'future' then
      return private.resumo_do_apagar('{}');
    end if;
  end if;

  select count(*) into total from public.transactions t where t.installment_plan_id = plano.id;
  if p_alcance = 'all' or (p_alcance = 'future' and n_ancora <= 1) then
    contrato := true;
  else
    if p_alcance = 'one' then
      ids := array[ancora.id];
    else
      select array_agg(t.id) into ids from public.transactions t
        where t.installment_plan_id = plano.id and t.workspace_id = p_ws and t.installment_no >= n_ancora;
    end if;
    ids := coalesce(ids, '{}');
    -- não sobra parcela: é a compra inteira, com a entrada
    contrato := cardinality(ids) >= total;
  end if;

  if contrato then
    select array_agg(t.id) into ids from public.transactions t
      where (t.installment_plan_id = plano.id or t.down_payment_plan_id = plano.id) and t.workspace_id = p_ws;
    ids := coalesce(ids, '{}');
    perform private.recusa_fatura_travada(ids);
    res := private.resumo_do_apagar(ids) || jsonb_build_object('apaga_contrato', true);
    if p_apply then perform public.delete_installment_purchase(plano.id); end if;
    return res;
  end if;

  perform private.recusa_fatura_travada(ids);
  -- O adiantamento ocupa N números: quem sobra conta pelo PESO (20261010130000).
  select coalesce(sum(private.peso_da_parcela(t.adiantamento)), 0) into restantes
    from public.transactions t
   where t.installment_plan_id = plano.id and t.workspace_id = p_ws and not (t.id = any(ids));
  res := private.resumo_do_apagar(ids) || jsonb_build_object('vira_avista', restantes = 1);
  if not p_apply then return res; end if;

  -- Apagar junto com as outras não é desfazer: o adiantamento sai como elas.
  perform set_config('proops.sem_restaurar_adiantamento', '1', true);
  delete from public.transactions t where t.id = any(ids);
  perform set_config('proops.sem_restaurar_adiantamento', '', true);
  -- Renumerar mexe no número do adiantamento (`a_adiantamento_fica` congela fora deste caminho).
  perform set_config('proops.editando_adiantamento', '*', true);
  if restantes = 1 then
    select t.id into sobra from public.transactions t where t.installment_plan_id = plano.id;
    update public.transactions t set installment_plan_id = null, installment_no = null,
           description = coalesce(plano.description, plano.merchant, t.description)
     where t.id = sobra;
    delete from public.installment_plans p where p.id = plano.id;
  else
    nome := coalesce(plano.description, plano.merchant, 'Compra parcelada');
    update public.transactions t set installment_no = s.k,
           description = case when t.adiantamento is null
                              then nome || ' (' || s.k || '/' || restantes || ')' else t.description end,
           adiantamento = private.adiantamento_renumerado(t.adiantamento, s.k)
      from (select x.id,
                   sum(private.peso_da_parcela(x.adiantamento)) over (order by x.installment_no)
                     - private.peso_da_parcela(x.adiantamento) + 1 as k
              from public.transactions x where x.installment_plan_id = plano.id) s
     where t.id = s.id;
    select sum(t.amount_cents) into soma from public.transactions t where t.installment_plan_id = plano.id;
    update public.installment_plans p set installments = restantes, total_cents = soma,
           first_occurred_at = (select t.occurred_at from public.transactions t
                                 where t.installment_plan_id = plano.id and t.installment_no = 1)
     where p.id = plano.id;
  end if;
  perform set_config('proops.editando_adiantamento', '', true);
  return res;
end $$;
revoke execute on function private.apagar_parcelas(text, uuid, text, uuid, boolean) from public, anon, authenticated;
