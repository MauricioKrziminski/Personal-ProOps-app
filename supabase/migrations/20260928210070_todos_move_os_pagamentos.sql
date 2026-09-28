-- "Todos" (e "Este e os próximos") ao mudar a data de um pagamento de dívida leva os
-- pagamentos REGISTRADOS do alcance ao dia novo, cada um no próprio mês. A `20260928210020`
-- mudava só a data do pagamento editado e o dia do contrato; o dono do produto corrigiu:
-- *"se ele colocou todos, os pagos têm que ir para essa data, senão ele clicava em futuras só"*.
-- Mesmo corpo, mais o passo marcado abaixo.

create or replace function public.update_debt_payment_due_day(
  p_anchor_id uuid,
  p_scope text,
  p_payment_patch jsonb,
  p_occurred_at date,
  p_due_day integer,
  p_expected_debt_revision bigint,
  p_expected_anchor_revision bigint,
  p_expected_payment_versions jsonb,
  p_request_id uuid
) returns jsonb
language plpgsql volatile security invoker
set search_path = public
set timezone to 'America/Sao_Paulo'
as $$
declare
  req_data uuid;
  req_contrato uuid;
  feito jsonb;
  pagamento record;
  d record;
begin
  if auth.uid() is null then raise exception 'Sessão autenticada obrigatória'; end if;
  if p_request_id is null then raise exception 'Identificador da requisição obrigatório'; end if;
  if p_scope not in ('from_here', 'all') then raise exception 'Escopo de pagamento inválido'; end if;
  if p_due_day is null or (p_due_day <> -1 and (p_due_day < 1 or p_due_day > 31)) then
    raise exception 'Dia inválido';
  end if;
  if p_payment_patch is not null and p_payment_patch ? 'occurred_at' then
    raise exception 'A data do pagamento vai em p_occurred_at';
  end if;
  req_data := md5(p_request_id::text || ':data')::uuid;
  req_contrato := md5(p_request_id::text || ':vencimento')::uuid;

  select r.result into feito from private.debt_contract_edit_requests r
   where r.user_id = auth.uid() and r.request_id = req_contrato;
  if feito is not null then
    return feito;
  end if;

  select t.id, t.debt_id into pagamento from public.transactions t where t.id = p_anchor_id;
  if pagamento.id is null or pagamento.debt_id is null then
    raise exception 'Pagamento não encontrado';
  end if;

  if p_payment_patch is not null and p_payment_patch <> '{}'::jsonb then
    perform public.update_debt_payment_scoped(p_anchor_id, p_scope, p_payment_patch,
      p_expected_debt_revision, p_expected_anchor_revision, p_expected_payment_versions, p_request_id);
  else
    -- sem outro campo, a trava otimista continua valendo contra as revisões que a tela leu
    select * into d from public.debts where id = pagamento.debt_id for update;
    if d.edit_revision is distinct from p_expected_debt_revision
       or (select t.edit_revision from public.transactions t where t.id = p_anchor_id)
          is distinct from p_expected_anchor_revision then
      raise exception 'A dívida ou o pagamento mudou enquanto você editava';
    end if;
  end if;

  select t.id, t.debt_id, t.occurred_at, t.edit_revision into pagamento
    from public.transactions t where t.id = p_anchor_id;
  if p_occurred_at is not null and p_occurred_at is distinct from pagamento.occurred_at then
    select * into d from public.debts where id = pagamento.debt_id;
    perform public.update_debt_payment_scoped(p_anchor_id, 'one',
      jsonb_build_object('occurred_at', p_occurred_at), d.edit_revision, pagamento.edit_revision,
      jsonb_build_object(p_anchor_id::text, pagamento.edit_revision), req_data);
  end if;

  -- "Este e os próximos" e "Todos" levam também os pagamentos REGISTRADOS do alcance ao dia
  -- novo, cada um no próprio mês (28/09/2026, decisão do dono do produto: *"se ele colocou
  -- todos, os pagos têm que ir para essa data"*). O gatilho da dívida conserva o número de cada
  -- pagamento quando a data muda.
  update public.transactions t
     set occurred_at = private.day_in_month(t.occurred_at, p_due_day)
   where t.debt_id = pagamento.debt_id
     -- o editado já está na data escolhida; sem data escolhida, ele segue o dia como os outros
     and (t.id <> p_anchor_id or p_occurred_at is null)
     and (p_scope = 'all' or t.debt_payment_no >= (select a.debt_payment_no from public.transactions a where a.id = p_anchor_id))
     and t.occurred_at <> private.day_in_month(t.occurred_at, p_due_day);

  select * into d from public.debts where id = pagamento.debt_id;
  return public.update_debt_contract_scoped(d.id, d.installments_paid + 1,
    case p_scope when 'all' then 'all' else 'future' end,
    -- o dia não reescreve pagamento registrado: não há versões de pagamento a conferir
    jsonb_build_object('due_day', p_due_day), d.edit_revision, '{}'::jsonb, req_contrato);
end;
$$;
revoke execute on function public.update_debt_payment_due_day(uuid, text, jsonb, date, integer, bigint, bigint, jsonb, uuid)
  from public, anon;
grant execute on function public.update_debt_payment_due_day(uuid, text, jsonb, date, integer, bigint, bigint, jsonb, uuid)
  to authenticated;
