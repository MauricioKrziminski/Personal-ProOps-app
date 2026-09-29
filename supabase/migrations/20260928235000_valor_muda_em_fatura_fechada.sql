-- Corrigir o VALOR de um lançamento que está numa fatura paga, adiada ou paga em parte
-- (28/09/2026, pedido do dono do produto: "mesmo que tenha sido paga, ele tem que mudar e alterar
-- todos os lugares que esse valor é influenciado"). O "Controle (mãe)" tinha as parcelas 1 e 2 em
-- faturas marcadas como pagas à mão, e mudar o valor da série inteira era recusado.
--
-- A trava de VALOR sai das três portas (parcela, escopo da compra e ocorrência de recorrente); a
-- de data, conta, tipo e pagamento fica — mover a linha a tiraria da fatura em que foi paga. Quem
-- mantém a fatura honesta é UM gatilho, em `transactions`, por onde passam todas as escritas (as
-- três RPCs, o agente e o formulário da compra à vista):
--
--   * fatura PAGA: o total muda e o pagamento fica. O pagamento é o que saiu da conta (a folha do
--     "Paguei" confirma o valor), e mudar uma transferência da conta corrente por causa de uma
--     linha do cartão seria mexer no saldo em silêncio. Se o total SOBE acima do que foi pago por
--     transferência, ela REABRE com a diferença (`refaz_pagamento_da_fatura`, o mesmo caminho de
--     baixar um pagamento): paga e com saldo, a diferença sumiria de toda leitura de "a pagar". A
--     marcada como paga à mão (`settled_manually`) continua paga — foi a pessoa que disse.
--   * fatura ADIADA: o saldo que ela levou para a seguinte (`rollover_of_invoice_id`) anda a mesma
--     diferença. Se a seguinte também estiver fechada, o gatilho dispara de novo nela — a cascata
--     é a própria recursão. Juros e IOF ESTIMADOS do adiamento não são recalculados: são
--     estimativa, e o valor real chega pela importação.
--   * fatura aberta PAGA EM PARTE: o que falta anda; zerado, ela vira paga
--     (`refaz_pagamento_da_fatura`); negativo, recusa — o que já foi pago passaria do total. Zerado
--     sem transferência ligada (pagamento antigo), recusa também: ela ficaria aberta com nada a
--     pagar, e `pay_invoice` não a fecharia mais.
--
-- O gatilho é `security definer` e confere que a fatura é do MESMO espaço da linha: `invoice_id`
-- é FK simples, e sem a conferência uma linha apontada para a fatura de outro espaço mexeria nela.
--
-- Teste: `supabase/tests/valor_em_fatura_fechada.sql`.

create or replace function private.valor_corrigido_na_fatura()
returns trigger
language plpgsql
security definer
set search_path = public
set timezone to 'America/Sao_Paulo'
as $$
declare
  inv public.card_invoices;
  delta bigint := new.amount_cents - old.amount_cents;
  adiado_id uuid;
  adiado_cents bigint;
begin
  if not private.conta_na_fatura(new.kind) or not private.conta_na_fatura(old.kind) then
    return new;
  end if;
  -- Sem trava no caso comum (fatura aberta e sem pagamento): nada a escrever.
  select * into inv from public.card_invoices where id = new.invoice_id;
  if not found or inv.workspace_id is distinct from new.workspace_id
     or (inv.status in ('open', 'closed') and inv.paid_cents = 0) then
    return new;
  end if;
  select * into inv from public.card_invoices where id = inv.id for update;

  if inv.status = 'rolled' then
    select t.id, t.amount_cents into adiado_id, adiado_cents from public.transactions t
     where t.rollover_of_invoice_id = inv.id and t.workspace_id = inv.workspace_id
     order by t.created_at limit 1 for update;
    if adiado_id is not null then
      if adiado_cents + delta <= 0 then
        raise exception 'Com esse valor, o saldo que a fatura de % levou para a seguinte zeraria: desfaça o adiamento antes.',
          to_char(inv.due_date, 'DD/MM/YYYY');
      end if;
      update public.transactions set amount_cents = amount_cents + delta where id = adiado_id;
    end if;
  elsif inv.status in ('open', 'closed') and inv.paid_cents > 0 then
    if private.invoice_open_cents(inv.id) < 0 then
      raise exception 'Com esse valor, o que já foi pago da fatura de % passa do total dela: corrija o pagamento antes.',
        to_char(inv.due_date, 'DD/MM/YYYY');
    end if;
    perform private.refaz_pagamento_da_fatura(inv.id, 0, false);
    if private.invoice_open_cents(inv.id) = 0
       and (select status from public.card_invoices where id = inv.id) in ('open', 'closed') then
      raise exception 'Com esse valor, a fatura de % ficaria sem nada a pagar, mas o pagamento dela não está ligado a ela: corrija o pagamento antes.',
        to_char(inv.due_date, 'DD/MM/YYYY');
    end if;
  elsif inv.status = 'paid' and not inv.settled_manually and inv.paid_cents > 0
        and private.invoice_open_cents(inv.id) > 0 then
    perform private.refaz_pagamento_da_fatura(inv.id, 0, false);
  end if;
  return new;
end;
$$;
revoke execute on function private.valor_corrigido_na_fatura() from public, anon, authenticated;

drop trigger if exists valor_corrigido_na_fatura on public.transactions;
create trigger valor_corrigido_na_fatura
  after update of amount_cents on public.transactions
  for each row
  when (old.amount_cents is distinct from new.amount_cents
        and new.invoice_id is not null
        and old.invoice_id is not distinct from new.invoice_id)
  execute function private.valor_corrigido_na_fatura();

create or replace function public.update_installment_occurrence(
  p_transaction_id uuid,
  p_patch jsonb
)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  anchor public.transactions%rowtype;
  locked_plan_id uuid;
  plan_workspace uuid;
  desired_amount bigint;
  desired_category text;
  desired_description text;
  desired_merchant text;
  desired_date date;
  desired_status text;
  desired_due date;
  desired_auto_confirm boolean;
  plan_total bigint;
  changed bigint;
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'Nada para alterar';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_patch) as key
     where key not in ('amount_cents', 'category', 'description', 'merchant',
                       'occurred_at', 'status', 'due_at', 'auto_confirm')
  ) then
    raise exception 'Campo não permitido nesta parcela';
  end if;

  -- Lock in the same order as update_installment_plan (plan, then line), so the purchase
  -- cannot be repartitioned between reading its installments and recomputing the total.
  select t.installment_plan_id into locked_plan_id
    from public.transactions t where t.id = p_transaction_id;
  if locked_plan_id is null then
    raise exception 'Parcela não encontrada';
  end if;
  select p.workspace_id into plan_workspace
    from public.installment_plans p where p.id = locked_plan_id for update;
  if plan_workspace is null then
    raise exception 'Compra parcelada não encontrada';
  end if;
  select t.* into anchor
    from public.transactions t where t.id = p_transaction_id for update;
  if anchor.id is null or anchor.installment_plan_id is distinct from locked_plan_id
     or anchor.workspace_id <> plan_workspace then
    raise exception 'Parcela não encontrada';
  end if;

  desired_amount := case when p_patch ? 'amount_cents'
                         then (p_patch->>'amount_cents')::bigint else anchor.amount_cents end;
  desired_category := case when p_patch ? 'category'
                           then p_patch->>'category' else anchor.category end;
  desired_description := case when p_patch ? 'description'
                              then p_patch->>'description' else anchor.description end;
  desired_merchant := case when p_patch ? 'merchant'
                           then p_patch->>'merchant' else anchor.merchant end;
  desired_date := case when p_patch ? 'occurred_at'
                       then (p_patch->>'occurred_at')::date else anchor.occurred_at end;
  desired_status := case when p_patch ? 'status'
                         then p_patch->>'status' else anchor.status end;
  desired_due := case when p_patch ? 'due_at'
                      then (p_patch->>'due_at')::date else anchor.due_at end;
  desired_auto_confirm := case when p_patch ? 'auto_confirm'
                               then (p_patch->>'auto_confirm')::boolean else anchor.auto_confirm end;

  if desired_amount is null or desired_amount <= 0 then
    raise exception 'O valor precisa ser maior que zero';
  end if;
  if desired_description is null or btrim(desired_description) = '' then
    raise exception 'Informe o título da parcela';
  end if;
  if desired_date is null then
    raise exception 'Informe a data da parcela';
  end if;
  if desired_status not in ('pending', 'cleared') or desired_status is null then
    raise exception 'Status inválido';
  end if;
  if desired_auto_confirm is null then
    raise exception 'Confirmação automática inválida';
  end if;
  if anchor.invoice_id is not null then
    -- The card's settlement belongs to the invoice workflow. A paid/rolled/partly paid
    -- invoice also freezes the monetary amount and calendar date of its line.
    if desired_status is distinct from anchor.status then
      raise exception 'O pagamento desta parcela é controlado pela fatura';
    end if;
    -- O VALOR muda (28/09/2026) e o gatilho `valor_corrigido_na_fatura` mantém a fatura
    -- honesta; a data não, senão a parcela sairia da fatura em que foi paga.
    if private.parcela_travada(anchor.status, anchor.invoice_id)
       and (desired_date is distinct from anchor.occurred_at
         or desired_due is distinct from anchor.due_at) then
      raise exception 'Parcela em fatura paga ou adiada: a data não muda';
    end if;
  end if;

  if desired_amount is not distinct from anchor.amount_cents
     and desired_category is not distinct from anchor.category
     and desired_description is not distinct from anchor.description
     and desired_merchant is not distinct from anchor.merchant
     and desired_date is not distinct from anchor.occurred_at
     and desired_status is not distinct from anchor.status
     and desired_due is not distinct from anchor.due_at
     and desired_auto_confirm is not distinct from anchor.auto_confirm then
    return 0;
  end if;

  update public.transactions t set
    amount_cents = desired_amount,
    category = desired_category,
    description = desired_description,
    merchant = desired_merchant,
    occurred_at = desired_date,
    status = desired_status,
    due_at = desired_due,
    auto_confirm = desired_auto_confirm
   where t.id = anchor.id and t.workspace_id = plan_workspace
     and t.installment_plan_id = anchor.installment_plan_id;
  get diagnostics changed = row_count;
  if changed <> 1 then
    raise exception 'Parcela não encontrada para salvar';
  end if;
  if desired_date is distinct from anchor.occurred_at and exists (
    select 1 from public.transactions t
     where t.id = anchor.id and t.invoice_id is not null
       and private.parcela_travada(t.status, t.invoice_id)
  ) then
    -- set_invoice may have assigned the line to a protected invoice even though its
    -- previous invoice was open. The exception rolls the trigger's assignment back too.
    raise exception 'Esta data joga a parcela dentro de uma fatura paga ou adiada';
  end if;

  if anchor.installment_no = 1 and desired_date is distinct from anchor.occurred_at then
    -- The purchase editor derives its calendar from this date. Leaving the old anchor
    -- would revert a correction to installment 1 on the next whole-purchase edit.
    update public.installment_plans p
       set first_occurred_at = desired_date, updated_at = now()
     where p.id = anchor.installment_plan_id and p.workspace_id = plan_workspace;
    get diagnostics changed = row_count;
    if changed <> 1 then
      raise exception 'Não consegui salvar a data inicial da compra';
    end if;
  end if;

  if desired_amount is distinct from anchor.amount_cents then
    select sum(t.amount_cents) into plan_total
      from public.transactions t
     where t.installment_plan_id = anchor.installment_plan_id
       and t.workspace_id = plan_workspace;
    if plan_total is null or plan_total <= 0 then
      raise exception 'Não consegui recalcular o total da compra';
    end if;
    update public.installment_plans p
       set total_cents = plan_total, updated_at = now()
     where p.id = anchor.installment_plan_id and p.workspace_id = plan_workspace;
    get diagnostics changed = row_count;
    if changed <> 1 then
      raise exception 'Não consegui salvar o total da compra';
    end if;
  end if;
  return 1;
end;
$$;

revoke execute on function public.update_installment_occurrence(uuid, jsonb) from public, anon;
grant execute on function public.update_installment_occurrence(uuid, jsonb) to authenticated;

create or replace function public.update_installment_scope(
  p_transaction_id uuid,
  p_scope text,
  p_patch jsonb
)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  anchor public.transactions%rowtype;
  plan_row public.installment_plans%rowtype;
  line public.transactions%rowtype;
  line_patch jsonb;
  base_description text;
  target_count integer;
  outside_cents bigint;
  target_cents bigint;
  ordinal integer := 0;
  changed bigint := 0;
  line_changed bigint;
  desired_total bigint;
  desired_amount bigint;
  first_date date;
  first_due date;
begin
  if p_scope not in ('one', 'future', 'all') or p_scope is null then
    raise exception 'Escolha quais parcelas editar';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'Nada para alterar';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_patch) as key
    where key not in ('amount_cents', 'total_cents', 'category', 'description', 'merchant',
                      'occurred_at', 'status', 'due_at', 'auto_confirm')
  ) then
    raise exception 'Campo não permitido nas parcelas';
  end if;
  if p_patch ? 'amount_cents' and p_patch ? 'total_cents' then
    raise exception 'Informe o valor da parcela ou o total da compra, não os dois';
  end if;

  -- Match the lock order of update_installment_plan and update_installment_occurrence.
  select t.installment_plan_id into anchor.installment_plan_id
    from public.transactions t where t.id = p_transaction_id;
  if anchor.installment_plan_id is null then
    raise exception 'Parcela não encontrada';
  end if;
  select p.* into plan_row from public.installment_plans p
    where p.id = anchor.installment_plan_id for update;
  if plan_row.id is null then
    raise exception 'Compra parcelada não encontrada';
  end if;
  perform 1 from public.transactions t
    where t.installment_plan_id = plan_row.id and t.workspace_id = plan_row.workspace_id
    for update;
  select t.* into anchor from public.transactions t
    where t.id = p_transaction_id and t.installment_plan_id = plan_row.id
      and t.workspace_id = plan_row.workspace_id;
  if anchor.id is null or anchor.installment_no is null then
    raise exception 'Parcela não encontrada';
  end if;

  if p_patch ? 'total_cents' then
    desired_total := (p_patch->>'total_cents')::bigint;
    if desired_total is null or desired_total <= 0 then
      raise exception 'O total da compra precisa ser maior que zero';
    end if;
  end if;

  if p_scope = 'one' then
    line_patch := p_patch - 'total_cents';
    if desired_total is not null then
      desired_amount := anchor.amount_cents + desired_total - plan_row.total_cents;
      if desired_amount <> anchor.amount_cents then
        line_patch := line_patch || jsonb_build_object('amount_cents', desired_amount);
      end if;
    end if;
    if line_patch = '{}'::jsonb then return 0; end if;
    return public.update_installment_occurrence(anchor.id, line_patch);
  end if;

  select count(*), coalesce(sum(t.amount_cents), 0)
    into target_count, target_cents
    from public.transactions t
   where t.installment_plan_id = plan_row.id and t.workspace_id = plan_row.workspace_id
     and (p_scope = 'all' or t.installment_no >= anchor.installment_no);
  if target_count = 0 then raise exception 'Nenhuma parcela encontrada'; end if;

  if desired_total is not null then
    outside_cents := plan_row.total_cents - target_cents;
    target_cents := desired_total - outside_cents;
    if target_cents < target_count then
      raise exception 'O total precisa cobrir as parcelas fora do escopo e deixar pelo menos um centavo por parcela selecionada';
    end if;
  end if;
  if p_patch ? 'description' then
    base_description := regexp_replace(p_patch->>'description', '\s+\([0-9]+/[0-9]+\)$', '');
    if base_description is null or btrim(base_description) = '' then
      raise exception 'Informe o título da compra';
    end if;
  end if;
  if p_patch ? 'occurred_at' then
    first_date := (p_patch->>'occurred_at')::date;
    if first_date is null then raise exception 'Informe a data da parcela'; end if;
  end if;
  if p_patch ? 'due_at' and p_patch->>'due_at' is not null then
    first_due := (p_patch->>'due_at')::date;
  end if;

  for line in
    select t.* from public.transactions t
     where t.installment_plan_id = plan_row.id and t.workspace_id = plan_row.workspace_id
       and (p_scope = 'all' or t.installment_no >= anchor.installment_no)
     order by t.installment_no
  loop
    ordinal := ordinal + 1;
    line_patch := p_patch - 'total_cents';
    if desired_total is not null then
      line_patch := line_patch || jsonb_build_object(
        'amount_cents', private.valor_da_parcela(target_cents, target_count, ordinal));
    end if;
    if p_patch ? 'description' then
      line_patch := line_patch || jsonb_build_object(
        'description', base_description || ' (' || line.installment_no || '/' || plan_row.installments || ')');
    end if;
    if p_patch ? 'occurred_at' then
      line_patch := line_patch || jsonb_build_object(
        'occurred_at', private.add_months(first_date, line.installment_no - anchor.installment_no));
    end if;
    if p_patch ? 'due_at' and first_due is not null then
      line_patch := line_patch || jsonb_build_object(
        'due_at', private.add_months(first_due, line.installment_no - anchor.installment_no));
    end if;
    -- Correcting a recorded bank amount preserves the fact that it was paid.
    if line.status = 'cleared' and line_patch ? 'status'
       and line_patch->>'status' is distinct from line.status then
      raise exception 'A parcela % já foi paga: use o fluxo de estorno para reabrir o pagamento',
        line.installment_no;
    end if;
    -- A card invoice that is paid, rolled, or partly paid still owns its date and settlement;
    -- the AMOUNT moves (28/09/2026) and `valor_corrigido_na_fatura` keeps the invoice honest.
    if line.invoice_id is not null and private.parcela_travada(line.status, line.invoice_id) and
       ((line_patch ? 'occurred_at' and (line_patch->>'occurred_at')::date is distinct from line.occurred_at)
        or (line_patch ? 'due_at' and (line_patch->>'due_at')::date is distinct from line.due_at)
        or (line_patch ? 'status' and line_patch->>'status' is distinct from line.status)) then
      raise exception 'A parcela % está em fatura paga, adiada ou paga em parte: a data e o pagamento dela não mudam',
        line.installment_no;
    end if;
    line_changed := public.update_installment_occurrence(line.id, line_patch);
    changed := changed + line_changed;
  end loop;

  -- Only a complete series rewrite changes the canonical purchase title and metadata.
  if p_scope = 'all' and
      ((p_patch ? 'description' and plan_row.description is distinct from base_description)
       or (p_patch ? 'category' and plan_row.category is distinct from p_patch->>'category')
       or (p_patch ? 'merchant' and plan_row.merchant is distinct from p_patch->>'merchant')) then
    update public.installment_plans p set
      description = case when p_patch ? 'description' then base_description else p.description end,
      category = case when p_patch ? 'category' then p_patch->>'category' else p.category end,
      merchant = case when p_patch ? 'merchant' then p_patch->>'merchant' else p.merchant end,
      updated_at = now()
    where p.id = plan_row.id and p.workspace_id = plan_row.workspace_id;
  end if;
  return changed;
end;
$$;

revoke execute on function public.update_installment_scope(uuid, text, jsonb) from public, anon;
grant execute on function public.update_installment_scope(uuid, text, jsonb) to authenticated;

create or replace function public.update_recurring_one(
  p_transaction_id uuid,
  p_patch jsonb,
  p_expected_revision bigint,
  p_request_id uuid
) returns bigint
language plpgsql security invoker
set search_path = public, pg_temp
set timezone to 'America/Sao_Paulo'
as $$
declare
  caller_uid uuid := auth.uid();
  request_row private.recurring_one_edit_requests%rowtype;
  series_row public.recurring_transactions%rowtype;
  line_row public.transactions%rowtype;
  series_id uuid;
  desired_amount bigint;
  desired_category text;
  desired_description text;
  desired_merchant text;
  desired_account uuid;
  desired_date date;
  desired_due date;
  desired_kind text;
  desired_status text;
  desired_auto_confirm boolean;
  changed bigint := 0;
begin
  if caller_uid is null or p_transaction_id is null or p_request_id is null
     or p_expected_revision is null then
    raise exception 'Sessão, ocorrência, revisão e identificador da requisição obrigatórios';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'Nada para alterar';
  end if;
  if exists (select 1 from jsonb_object_keys(p_patch) k
             where k not in ('amount_cents', 'category', 'description', 'merchant',
                             'account_id', 'occurred_at', 'due_at', 'kind', 'status',
                             'auto_confirm')) then
    raise exception 'Campo não permitido nesta ocorrência';
  end if;
  if p_patch ? 'amount_cents' and
     (jsonb_typeof(p_patch->'amount_cents') <> 'number'
      or (p_patch->>'amount_cents')::numeric <> trunc((p_patch->>'amount_cents')::numeric)
      or (p_patch->>'amount_cents')::numeric <= 0) then
    raise exception 'O valor precisa ser inteiro e maior que zero';
  end if;
  if p_patch ? 'auto_confirm' and jsonb_typeof(p_patch->'auto_confirm') <> 'boolean' then
    raise exception 'Confirmação automática inválida';
  end if;

  insert into private.recurring_one_edit_requests
    (user_id, request_id, transaction_id, patch, expected_revision)
  values (caller_uid, p_request_id, p_transaction_id, p_patch, p_expected_revision)
  on conflict (user_id, request_id) do nothing;
  select * into request_row from private.recurring_one_edit_requests
    where user_id = caller_uid and request_id = p_request_id for update;
  if request_row.transaction_id is distinct from p_transaction_id
     or request_row.patch is distinct from p_patch
     or request_row.expected_revision is distinct from p_expected_revision then
    raise exception 'Identificador de requisição reutilizado com dados diferentes';
  end if;
  if request_row.result is not null then return request_row.result; end if;

  -- Take locks in the same order as whole-series edits. Recheck the membership after
  -- locking: another writer may have moved or removed the line between the two reads.
  select t.recurring_id into series_id from public.transactions t
    where t.id = p_transaction_id;
  if series_id is null then raise exception 'Ocorrência recorrente não encontrada'; end if;
  select * into series_row from public.recurring_transactions r
    where r.id = series_id for update;
  if series_row.id is null or series_row.workspace_id not in (select private.my_workspace_ids()) then
    raise exception 'Recorrência não encontrada';
  end if;
  select * into line_row from public.transactions t
    where t.id = p_transaction_id for update;
  if line_row.id is null or line_row.recurring_id is distinct from series_row.id
     or line_row.workspace_id is distinct from series_row.workspace_id then
    raise exception 'Ocorrência recorrente não encontrada';
  end if;
  if line_row.edit_revision is distinct from p_expected_revision then
    raise exception 'A ocorrência mudou enquanto você editava. Abra de novo antes de salvar.';
  end if;

  desired_amount := case when p_patch ? 'amount_cents'
    then (p_patch->>'amount_cents')::bigint else line_row.amount_cents end;
  desired_category := case when p_patch ? 'category'
    then p_patch->>'category' else line_row.category end;
  desired_description := case when p_patch ? 'description'
    then p_patch->>'description' else line_row.description end;
  desired_merchant := case when p_patch ? 'merchant'
    then nullif(p_patch->>'merchant', '') else line_row.merchant end;
  desired_account := case when p_patch ? 'account_id'
    then (p_patch->>'account_id')::uuid else line_row.account_id end;
  desired_date := case when p_patch ? 'occurred_at'
    then (p_patch->>'occurred_at')::date else line_row.occurred_at end;
  desired_due := case when p_patch ? 'due_at'
    then (p_patch->>'due_at')::date
    when desired_date is distinct from line_row.occurred_at
       and line_row.invoice_id is null and line_row.due_at = line_row.occurred_at
    then desired_date else line_row.due_at end;
  desired_kind := case when p_patch ? 'kind'
    then p_patch->>'kind' else line_row.kind end;
  desired_status := case when p_patch ? 'status'
    then p_patch->>'status' else line_row.status end;
  desired_auto_confirm := case when p_patch ? 'auto_confirm'
    then (p_patch->>'auto_confirm')::boolean else line_row.auto_confirm end;

  if desired_amount is null or desired_amount <= 0 then
    raise exception 'O valor precisa ser maior que zero';
  end if;
  if p_patch ? 'description' and
     (desired_description is null or btrim(desired_description) = '') then
    raise exception 'Informe a descrição da ocorrência';
  end if;
  if desired_date is null then raise exception 'Informe a data da ocorrência'; end if;
  if desired_kind is null or desired_kind not in ('expense', 'income') then
    raise exception 'Tipo inválido para ocorrência recorrente';
  end if;
  if desired_status is null or desired_status not in ('pending', 'cleared') then
    raise exception 'Status inválido';
  end if;
  if desired_auto_confirm is null then raise exception 'Confirmação automática inválida'; end if;
  if desired_account is distinct from line_row.account_id
     and desired_account is not null and not exists
    (select 1 from public.accounts a where a.id = desired_account
      and a.workspace_id = line_row.workspace_id and not a.archived) then
    raise exception 'Conta precisa ser ativa e do mesmo espaço da ocorrência';
  end if;
  if line_row.invoice_id is not null then
    if desired_status is distinct from line_row.status
       or desired_due is distinct from line_row.due_at then
      raise exception 'Pagamento e vencimento desta ocorrência são controlados pela fatura';
    end if;
    -- O valor muda (28/09/2026): `valor_corrigido_na_fatura` mantém a fatura honesta.
    if private.parcela_travada(line_row.status, line_row.invoice_id)
       and (desired_account is distinct from line_row.account_id
         or desired_date is distinct from line_row.occurred_at
         or desired_kind is distinct from line_row.kind) then
      raise exception 'Ocorrência em fatura paga ou adiada: conta, tipo e data não mudam';
    end if;
  end if;
  if line_row.pays_invoice_id is not null
     and (desired_amount is distinct from line_row.amount_cents
       or desired_account is distinct from line_row.account_id
       or desired_date is distinct from line_row.occurred_at
       or desired_due is distinct from line_row.due_at
       or desired_kind is distinct from line_row.kind
       or desired_status is distinct from line_row.status) then
    raise exception 'Pagamento de fatura precisa ser alterado pelo fluxo da fatura';
  end if;

  if desired_amount is not distinct from line_row.amount_cents
     and desired_category is not distinct from line_row.category
     and desired_description is not distinct from line_row.description
     and desired_merchant is not distinct from line_row.merchant
     and desired_account is not distinct from line_row.account_id
     and desired_date is not distinct from line_row.occurred_at
     and desired_due is not distinct from line_row.due_at
     and desired_kind is not distinct from line_row.kind
     and desired_status is not distinct from line_row.status
     and desired_auto_confirm is not distinct from line_row.auto_confirm then
    changed := 0;
  else
    -- The invoice trigger listens to account_id, occurred_at AND due_at. A text
    -- correction must not mention any of those columns in its SET list.
    if desired_category is distinct from line_row.category
       or desired_description is distinct from line_row.description
       or desired_merchant is distinct from line_row.merchant
       or desired_auto_confirm is distinct from line_row.auto_confirm then
      update public.transactions t set
        category = desired_category,
        description = desired_description, merchant = desired_merchant,
        auto_confirm = desired_auto_confirm
      where t.id = line_row.id;
    end if;
    if desired_amount is distinct from line_row.amount_cents
       or desired_kind is distinct from line_row.kind then
      update public.transactions t set amount_cents = desired_amount,
        kind = desired_kind where t.id = line_row.id;
    end if;
    if desired_status is distinct from line_row.status then
      update public.transactions t set status = desired_status where t.id = line_row.id;
    end if;
    if desired_account is distinct from line_row.account_id
       and desired_date is distinct from line_row.occurred_at then
      update public.transactions t set account_id = desired_account,
        occurred_at = desired_date, due_at = desired_due where t.id = line_row.id;
    elsif desired_account is distinct from line_row.account_id then
      if desired_due is distinct from line_row.due_at then
        update public.transactions t set account_id = desired_account,
          due_at = desired_due where t.id = line_row.id;
      else
        update public.transactions t set account_id = desired_account where t.id = line_row.id;
      end if;
    elsif desired_date is distinct from line_row.occurred_at then
      update public.transactions t set occurred_at = desired_date,
        due_at = desired_due where t.id = line_row.id;
    elsif desired_due is distinct from line_row.due_at then
      update public.transactions t set due_at = desired_due where t.id = line_row.id;
    end if;
    if (desired_account is distinct from line_row.account_id
        or desired_date is distinct from line_row.occurred_at)
       and exists (select 1 from public.transactions t where t.id = line_row.id
         and t.invoice_id is not null and private.parcela_travada(t.status, t.invoice_id)) then
      raise exception 'Esta conta ou data joga a ocorrência em uma fatura paga ou adiada';
    end if;
    -- A whole-series edit with an earlier snapshot must not overwrite this correction.
    -- Bumping the shared revision changes no rule or projected occurrence.
    update public.recurring_transactions r set updated_at = now()
      where r.id = series_row.id;
    changed := 1;
  end if;
  update private.recurring_one_edit_requests set result = changed
    where user_id = caller_uid and request_id = p_request_id;
  return changed;
end;
$$;

revoke execute on function public.update_recurring_one(uuid, jsonb, bigint, uuid)
  from public, anon;
grant execute on function public.update_recurring_one(uuid, jsonb, bigint, uuid)
  to authenticated;
