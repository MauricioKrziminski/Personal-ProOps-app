-- "Último dia de todo mês" nas compras parceladas FORA do cartão (28/09/2026, decisão do dono
-- do produto).
--
-- A parcela guarda a própria data (não há regra lida depois, como na recorrente), e as portas
-- que as escrevem repetem o DIA da primeira: começando em 31 cai no fim de todo mês, mas
-- começando em 30/06 não havia como dizer "último dia". Em vez de reescrever as quatro funções
-- que calculam datas de parcela, as duas portas abaixo chamam a de sempre e, na MESMA transação,
-- levam as parcelas do alcance ao último dia do mês delas — cada uma por
-- `update_installment_occurrence`, que já sabe o que pode mudar numa parcela.
--
-- No cartão a data da parcela segue a da compra (é ela que decide a fatura): recusado.

create or replace function private.parcelas_no_ultimo_dia(p_plan_id uuid, p_from_no integer)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  linha record;
  fim date;
  patch jsonb;
  mudou bigint := 0;
begin
  if exists (
    select 1 from public.installment_plans p join public.accounts a on a.id = p.account_id
     where p.id = p_plan_id and a.type = 'credit_card'
  ) then
    raise exception 'No cartão a parcela segue a data da compra: o último dia do mês não vale ali';
  end if;
  for linha in
    select t.id, t.occurred_at, t.due_at from public.transactions t
     where t.installment_plan_id = p_plan_id and t.installment_no >= p_from_no
     order by t.installment_no
  loop
    fim := (date_trunc('month', linha.occurred_at) + interval '1 month - 1 day')::date;
    patch := '{}'::jsonb;
    if linha.occurred_at <> fim then
      patch := patch || jsonb_build_object('occurred_at', fim);
    end if;
    if linha.due_at is not null
       and linha.due_at <> (date_trunc('month', linha.due_at) + interval '1 month - 1 day')::date then
      patch := patch || jsonb_build_object('due_at',
        (date_trunc('month', linha.due_at) + interval '1 month - 1 day')::date);
    end if;
    if patch <> '{}'::jsonb then
      mudou := mudou + public.update_installment_occurrence(linha.id, patch);
    end if;
  end loop;
  return mudou;
end;
$$;
revoke execute on function private.parcelas_no_ultimo_dia(uuid, integer) from public, anon;
grant execute on function private.parcelas_no_ultimo_dia(uuid, integer) to authenticated;

-- Criar a compra com as parcelas no último dia de cada mês.
create or replace function public.create_installment_plan_last_day(
  p_account_id uuid, p_total_cents bigint, p_installments integer, p_occurred_at date,
  p_paid_installments integer, p_description text default null, p_category text default null,
  p_merchant text default null
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  plano uuid;
begin
  plano := public.create_installment_plan_with_history(p_account_id, p_total_cents, p_installments,
    p_occurred_at, p_paid_installments, p_description, p_category, p_merchant);
  perform private.parcelas_no_ultimo_dia(plano, 1);
  return plano;
end;
$$;
revoke execute on function public.create_installment_plan_last_day(uuid, bigint, integer, date, integer, text, text, text)
  from public, anon;
grant execute on function public.create_installment_plan_last_day(uuid, bigint, integer, date, integer, text, text, text)
  to authenticated;

-- Editar "Esta e as próximas" / "Todas" com o último dia: a edição de sempre e depois as datas.
create or replace function public.update_installment_scope_last_day(
  p_transaction_id uuid, p_scope text, p_patch jsonb
) returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  ancora record;
  mudou bigint := 0;
begin
  if p_scope not in ('future', 'all') then
    raise exception 'O último dia de todo mês vale para Esta e as próximas ou Todas';
  end if;
  select t.installment_plan_id, t.installment_no into ancora
    from public.transactions t where t.id = p_transaction_id;
  if ancora.installment_plan_id is null then
    raise exception 'Parcela não encontrada';
  end if;
  if p_patch is not null and p_patch <> '{}'::jsonb then
    mudou := public.update_installment_scope(p_transaction_id, p_scope, p_patch);
  end if;
  return mudou + private.parcelas_no_ultimo_dia(ancora.installment_plan_id,
    case when p_scope = 'all' then 1 else ancora.installment_no end);
end;
$$;
revoke execute on function public.update_installment_scope_last_day(uuid, text, jsonb) from public, anon;
grant execute on function public.update_installment_scope_last_day(uuid, text, jsonb) to authenticated;
