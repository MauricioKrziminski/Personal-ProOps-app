-- Captura de lançamentos: NO MÁXIMO UM registro por captura (spec 2026-10-12-captura-de-lancamentos-design.md).
--
-- Antes o app salvava o lançamento e SÓ DEPOIS marcava a captura como confirmada: morrer entre os dois
-- deixava a captura em "A confirmar" e um segundo "Confirmar" lançava de novo. Agora confirmar é UMA
-- transação no servidor: `lancar_da_captura` trava a captura, grava o registro pela MESMA função de criação que o
-- formulário usa em cada tipo (lançamento, compra parcelada, financiamento, série) e a marca `confirmed` com o
-- vínculo (uma FK por tipo, `on delete set null`).
-- Repetir (resposta perdida, segundo aparelho, segundo toque) devolve o registro que já existe.
--
-- `security invoker` de propósito: um wrapper `definer` faria o `save_transaction_payment` de dentro
-- rodar sem RLS. Aqui tudo roda como a pessoa, e a policy "own resolve" decide o que ela alcança.

alter table public.captured_notifications
  add column if not exists transaction_id uuid references public.transactions(id) on delete set null,
  add column if not exists installment_plan_id uuid references public.installment_plans(id) on delete set null,
  add column if not exists recurring_id uuid references public.recurring_transactions(id) on delete set null,
  add column if not exists debt_id uuid references public.debts(id) on delete set null;
-- um registro só por captura (lançamento, compra parcelada, série OU financiamento)
alter table public.captured_notifications drop constraint if exists captured_notifications_um_registro;
alter table public.captured_notifications add constraint captured_notifications_um_registro
  check (num_nonnulls(transaction_id, installment_plan_id, recurring_id, debt_id) <= 1);
create index if not exists captured_notifications_transaction_idx
  on public.captured_notifications (transaction_id) where transaction_id is not null;
create index if not exists captured_notifications_plan_idx
  on public.captured_notifications (installment_plan_id) where installment_plan_id is not null;
create index if not exists captured_notifications_recurring_idx
  on public.captured_notifications (recurring_id) where recurring_id is not null;
create index if not exists captured_notifications_debt_idx
  on public.captured_notifications (debt_id) where debt_id is not null;
grant update (transaction_id, installment_plan_id, recurring_id, debt_id) on public.captured_notifications to authenticated;

-- `confirmed` é terminal (voltar a `pending` reabriria o "Confirmar" de um registro já feito), e o vínculo só
-- existe numa captura confirmada e aponta para um registro que a pessoa ENXERGA. A conferência é a RLS
-- (invoker), não "mesmo `workspace_id`": o registro nasce no espaço padrão de hoje (`my_default_workspace`), que
-- pode ser outro que o da captura se a pessoa ganhou um espaço próprio depois; recusar aí travaria o Confirmar.
-- O vínculo vai de NULL para um valor UMA vez: trocar ou mover entre colunas depois é recusado. Voltar a NULL
-- (o `on delete set null` do registro apagado) passa.
create or replace function private.tg_captura_resolucao() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare antes int := num_nonnulls(old.transaction_id, old.installment_plan_id, old.recurring_id, old.debt_id);
        depois int := num_nonnulls(new.transaction_id, new.installment_plan_id, new.recurring_id, new.debt_id);
begin
  if old.status = 'confirmed' and new.status is distinct from 'confirmed' then
    raise exception using errcode = 'PT409', message = 'Esta captura já foi confirmada';
  end if;
  if antes > 0 and depois > 0
     and (new.transaction_id, new.installment_plan_id, new.recurring_id, new.debt_id)
         is distinct from (old.transaction_id, old.installment_plan_id, old.recurring_id, old.debt_id) then
    raise exception using errcode = 'PT409', message = 'Esta captura já está ligada a um registro';
  end if;
  if (new.transaction_id is distinct from old.transaction_id and new.transaction_id is not null)
     or (new.installment_plan_id is distinct from old.installment_plan_id and new.installment_plan_id is not null)
     or (new.recurring_id is distinct from old.recurring_id and new.recurring_id is not null)
     or (new.debt_id is distinct from old.debt_id and new.debt_id is not null) then
    if new.status <> 'confirmed' then
      raise exception 'O registro só se liga a uma captura confirmada';
    end if;
    if (new.transaction_id is not null and not exists (select 1 from public.transactions t where t.id = new.transaction_id))
       or (new.installment_plan_id is not null and not exists (select 1 from public.installment_plans t where t.id = new.installment_plan_id))
       or (new.recurring_id is not null and not exists (select 1 from public.recurring_transactions t where t.id = new.recurring_id))
       or (new.debt_id is not null and not exists (select 1 from public.debts t where t.id = new.debt_id)) then
      raise exception 'O registro precisa ser de um espaço seu';
    end if;
  end if;
  return new;
end $$;
revoke execute on function private.tg_captura_resolucao() from public, anon, authenticated;
drop trigger if exists b_resolucao on public.captured_notifications;
create trigger b_resolucao before update on public.captured_notifications
  for each row execute function private.tg_captura_resolucao();

-- `p_tipo`: lancamento | parcelada | financiamento | recorrente. `p_dados` é o MESMO payload que o formulário
-- manda à função de criação do tipo (save_transaction_payment `p_input`, create_purchase `p_dados`,
-- create_recurring_payment `p_input`).
-- REPLAY (captura já confirmada, qualquer `p_tipo`): devolve o que existe, no formato
-- `{id, ids: [id], tipo, ja_lancado: true}`. O app só lê `id` (lançamento, série) e `ids[0]` (compra, dívida);
-- `revision` e `fee_id` do lançamento não são lidos por quem confirma uma captura.
drop function if exists public.lancar_da_captura(uuid, jsonb, bigint, uuid);
create or replace function public.lancar_da_captura(
  p_captura_id uuid, p_tipo text, p_dados jsonb, p_fee_cents bigint, p_request_id uuid
) returns jsonb
language plpgsql security invoker set search_path = '' set timezone = 'America/Sao_Paulo' as $$
declare c public.captured_notifications%rowtype; r jsonb; rid uuid; ja uuid; tipo text;
begin
  if auth.uid() is null then raise exception 'Autenticação obrigatória'; end if;
  if p_tipo is null or p_tipo not in ('lancamento', 'parcelada', 'financiamento', 'recorrente') then
    raise exception 'Tipo de registro inválido';
  end if;
  -- só a PRÓPRIA captura (a policy já filtra; o `user_id` deixa a recusa explícita) e uma de cada vez
  select * into c from public.captured_notifications where id = p_captura_id and user_id = auth.uid() for update;
  if c.id is null then
    raise exception using errcode = 'PT409', message = 'Não achei essa captura. Ela pode já ter sido resolvida';
  end if;
  if c.status = 'confirmed' and num_nonnulls(c.transaction_id, c.installment_plan_id, c.recurring_id, c.debt_id) = 1 then
    ja := coalesce(c.transaction_id, c.installment_plan_id, c.recurring_id, c.debt_id);
    tipo := case when c.transaction_id is not null then 'lancamento' when c.installment_plan_id is not null then 'parcelada'
                 when c.recurring_id is not null then 'recorrente' else 'financiamento' end;
    return jsonb_build_object('id', ja, 'ids', jsonb_build_array(ja), 'tipo', tipo, 'ja_lancado', true);
  end if;
  if c.status not in ('pending', 'duplicate') then
    raise exception using errcode = 'PT409', message = 'Esta captura já foi resolvida';
  end if;
  if p_tipo = 'lancamento' then
    r := public.save_transaction_payment(null, p_dados, p_fee_cents, null, p_request_id);
    rid := (r->>'id')::uuid;
  elsif p_tipo = 'recorrente' then
    r := public.create_recurring_payment(p_dados, p_request_id);
    rid := (r->>'id')::uuid;
  else
    r := public.create_purchase(p_tipo, p_dados, null, p_request_id);
    rid := (r->'ids'->>0)::uuid;
  end if;
  if rid is null then raise exception 'A criação não devolveu o registro'; end if;
  update public.captured_notifications set
    status = 'confirmed', texto = null,
    transaction_id = case when p_tipo = 'lancamento' then rid end,
    installment_plan_id = case when p_tipo = 'parcelada' then rid end,
    recurring_id = case when p_tipo = 'recorrente' then rid end,
    debt_id = case when p_tipo = 'financiamento' then rid end
  where id = c.id;
  return r;
end $$;
revoke execute on function public.lancar_da_captura(uuid, text, jsonb, bigint, uuid) from public, anon;
grant execute on function public.lancar_da_captura(uuid, text, jsonb, bigint, uuid) to authenticated;
