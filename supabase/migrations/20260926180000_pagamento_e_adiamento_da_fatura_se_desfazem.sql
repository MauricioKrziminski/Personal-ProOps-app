-- O pagamento da fatura se edita e se apaga; "Marcar como paga" e "Jogar para a próxima" se
-- desfazem (26/09/2026, *"tudo que se cria se edita"*).
--
-- Até aqui a transferência que `pay_invoice` cria não tinha ligação nenhuma com a fatura (só a
-- ÚLTIMA ficava em `payment_transaction_id`): editar o valor dela ou apagá-la mexia no saldo da
-- conta e deixava a fatura paga, com `paid_cents` velho. A `20260926130000` já diz à pessoa
-- "Para reabrir, desfaça o pagamento da fatura" — e não havia como.
--
-- ⚠️ A `20260909060000` escreveu que desfazer pagamento seria uma RPC `unpay_invoice`, "não um
-- trigger em `transactions`". Aqui é o trigger, de propósito: o pagamento se edita e se apaga
-- pelo formulário do lançamento e pelo `delete_transaction` do agente, e uma RPC separada
-- deixaria esses dois caminhos com a fatura dessincronizada, que é o defeito.
--
-- 1. `transactions.pays_invoice_id` liga o pagamento à fatura. `pay_invoice` preenche; o passado
--    é ligado pela `payment_transaction_id` (exato) e, para os pagamentos em parte, pelas
--    transferências "Pagamento da fatura" ao cartão entre o fechamento e o vencimento — só
--    quando a soma delas bate EXATAMENTE com `paid_cents`.
-- 2. Trigger AFTER UPDATE/DELETE: a diferença do que a linha paga (antes × depois) entra em
--    `paid_cents`, e a fatura quita, reabre ou muda a data de pagamento conforme o que falta.
--    Nunca no INSERT: `pay_invoice` já soma.
-- 3. `unsettle_invoice` desfaz o "Marcar como paga"; `unroll_invoice` desfaz o adiamento.
-- Teste: `supabase/tests/pagamento_da_fatura_se_desfaz.sql`.

alter table public.transactions
  add column if not exists pays_invoice_id uuid references public.card_invoices(id) on delete set null;
create index if not exists transactions_pays_invoice_idx
  on public.transactions (pays_invoice_id) where pays_invoice_id is not null;
comment on column public.transactions.pays_invoice_id is
  'A fatura que esta transferência paga (pay_invoice). Editar o valor ou apagar a linha refaz paid_cents e o status da fatura (trigger sync_invoice_payment).';

-- ── backfill ────────────────────────────────────────────────────────────────────────────────
update public.transactions t set pays_invoice_id = ci.id
  from public.card_invoices ci
 where ci.payment_transaction_id = t.id and t.pays_invoice_id is null;

-- fatura quitada por `pay_invoice` antes de `paid_cents` existir: o pagamento que a quitou conta
update public.card_invoices ci set paid_cents = t.amount_cents
  from public.transactions t
 where t.id = ci.payment_transaction_id and ci.status = 'paid' and ci.paid_cents = 0;

-- pagamentos em parte: só quando as transferências da janela somam exatamente o `paid_cents`
with candidatas as (
  select ci.id as invoice_id, t.id as tx_id, t.amount_cents, ci.paid_cents,
         coalesce((select sum(l.amount_cents) from public.transactions l where l.pays_invoice_id = ci.id), 0) as ligado
  from public.card_invoices ci
  join public.accounts a on a.id = ci.account_id
  join public.transactions t on t.kind = 'transfer' and t.counterparty_account_id = ci.account_id
   and t.pays_invoice_id is null
   and t.description = 'Pagamento da fatura ' || a.name
   and t.occurred_at between ci.closing_date and ci.due_date
  where ci.paid_cents > 0
), fecham as (
  select invoice_id from candidatas
   group by invoice_id, paid_cents, ligado
  having sum(amount_cents) + ligado = paid_cents
)
update public.transactions t set pays_invoice_id = c.invoice_id
  from candidatas c
 where c.tx_id = t.id and c.invoice_id in (select invoice_id from fecham)
   -- a mesma transferência na janela de duas faturas não é ligada a nenhuma
   and (select count(*) from candidatas o where o.tx_id = c.tx_id and o.invoice_id in (select invoice_id from fecham)) = 1;

-- As parcelas de fatura quitada pelo histórico (`quitar_faturas_do_historico` e o `_do_plano`)
-- ficaram com o dia da compra em `paid_at` — o acerto para o dia da quitação nunca rodava. Sem ele,
-- "Desmarcar como paga" não as acharia.
update public.transactions t set paid_at = ci.due_date
  from public.card_invoices ci
 where t.invoice_id = ci.id and t.status = 'cleared' and t.installment_plan_id is not null
   and ci.status = 'paid' and ci.settled_manually and ci.paid_at = ci.due_date
   and t.paid_at is distinct from ci.due_date;

create or replace function private.quitar_faturas_do_historico(p_plan_id uuid)
returns int
language plpgsql security invoker
set search_path = public
set timezone to 'America/Sao_Paulo'
as $$
declare
  n int;
begin
  -- Mesma semântica de `settle_invoice` (paga fora do app, sem transferência), restrita a fatura:
  --   - criada NESTA transação (`now()` é o início dela) — a que já existia é da pessoa;
  --   - JÁ VENCIDA — a que ainda vai vencer continua devida, e quitá-la a tiraria da projeção;
  --   - só com linha paga DESTE plano — uma compra à vista do mesmo extrato que caiu ali antes
  --     não pode ser quitada junto (revisão da migration, 22/09/2026).
  update public.card_invoices ci
     set status = 'paid', paid_at = ci.due_date, settled_manually = true
   where ci.id in (select t.invoice_id from public.transactions t
                    where t.installment_plan_id = p_plan_id and t.status = 'cleared'
                      and t.invoice_id is not null)
     and ci.created_at = now()
     and ci.status = 'open'
     and ci.due_date < current_date
     and not exists (select 1 from public.transactions o
                      where o.invoice_id = ci.id
                        and (o.status <> 'cleared' or o.installment_plan_id is distinct from p_plan_id));
  get diagnostics n = row_count;

  -- as linhas levam a data da quitação (o `set_paid_at` já tinha posto o dia da compra)
  update public.transactions t
     set paid_at = ci.due_date
    from public.card_invoices ci
   where t.invoice_id = ci.id and t.installment_plan_id = p_plan_id and t.status = 'cleared'
     and ci.status = 'paid' and ci.settled_manually and ci.paid_at = ci.due_date;
  return n;
end;
$$;
revoke execute on function private.quitar_faturas_do_historico(uuid) from public, anon;
grant execute on function private.quitar_faturas_do_historico(uuid) to authenticated, service_role;

-- ── pay_invoice liga o pagamento ────────────────────────────────────────────────────────────
create or replace function public.pay_invoice(
  p_invoice_id uuid,
  p_account_id uuid,
  p_paid_at date default current_date,
  p_amount_cents bigint default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  inv    record;
  aberto bigint;
  valor  bigint;
  tx_id  uuid;
begin
  select ci.*, a.name as card_name into inv
  from public.card_invoices ci
  join public.accounts a on a.id = ci.account_id
  where ci.id = p_invoice_id;
  if inv.id is null then
    raise exception 'fatura não encontrada';
  end if;
  if inv.status in ('paid','rolled') then
    raise exception 'fatura já paga em %', inv.paid_at;
  end if;
  if p_account_id is null then
    raise exception 'pagar a fatura exige a conta de onde o dinheiro sai';
  end if;
  if p_account_id = inv.account_id then
    raise exception 'a conta pagadora não pode ser o próprio cartão';
  end if;

  aberto := private.invoice_open_cents(p_invoice_id);
  if aberto <= 0 then
    raise exception 'fatura sem lançamentos';
  end if;

  -- sem valor, paga o que falta: pagar tudo continua sendo um toque
  valor := coalesce(p_amount_cents, aberto);
  if valor <= 0 then
    raise exception 'o valor do pagamento precisa ser maior que zero';
  end if;
  if valor > aberto then
    raise exception 'o pagamento é maior que o valor em aberto';
  end if;

  insert into public.transactions
    (workspace_id, user_id, kind, amount_cents, description,
     account_id, counterparty_account_id, occurred_at, source, status, pays_invoice_id)
  values (inv.workspace_id, coalesce((select auth.uid()), inv.user_id), 'transfer',
          valor, 'Pagamento da fatura ' || inv.card_name,
          p_account_id, inv.account_id, p_paid_at, 'app', 'cleared', p_invoice_id)
  returning id into tx_id;

  update public.card_invoices set paid_cents = paid_cents + valor where id = p_invoice_id;

  -- Quitou. Enquanto não quitar, a fatura continua em aberto e as compras continuam previstas —
  -- que é a verdade: elas ainda não foram pagas.
  if valor = aberto then
    -- a baixa das linhas, pelo mesmo motivo da 20260909031000
    update public.transactions
       set status = 'cleared', paid_at = p_paid_at
     where invoice_id = p_invoice_id and status = 'pending';

    update public.card_invoices
       set status = 'paid', paid_at = p_paid_at, payment_transaction_id = tx_id
     where id = p_invoice_id;
  end if;

  return tx_id;
end;
$$;

-- ── o status da fatura segue os pagamentos ──────────────────────────────────────────────────
-- Reabrir devolve a `pending` as linhas que a quitação baixou: as de `paid_at` igual ao dia do
-- pagamento. Uma compra à vista feita NO dia do pagamento também tem esse `paid_at` e volta a
-- `pending` junto — sem efeito (ela está numa fatura em aberto, e quem lê olha a fatura), e pagar
-- de novo a baixa outra vez. Não estreitar o critério: ele é o que pega as parcelas.
create or replace function private.refaz_pagamento_da_fatura(p_invoice_id uuid, p_delta bigint, p_em_cascata boolean)
returns void
language plpgsql
set search_path = public
set timezone to 'America/Sao_Paulo'
as $$
declare
  inv public.card_invoices;
  aberto bigint;
  ultimo record;
begin
  select * into inv from public.card_invoices where id = p_invoice_id for update;
  if not found then
    return;
  end if;
  if p_delta <> 0 and inv.status = 'rolled' and not p_em_cascata then
    raise exception 'Essa fatura já foi para a próxima: desfaça o adiamento dela antes de mudar o pagamento.';
  end if;

  -- `greatest`: um pagamento antigo, editado antes desta ligação existir, não deixa o pago negativo
  update public.card_invoices set paid_cents = greatest(0, paid_cents + p_delta) where id = p_invoice_id
  returning * into inv;
  if inv.status = 'rolled' then
    return;
  end if;
  aberto := private.invoice_open_cents(p_invoice_id);
  if p_delta > 0 and aberto < 0 and not p_em_cascata then
    raise exception 'O pagamento passa do valor da fatura.';
  end if;

  select t.id, t.occurred_at into ultimo from public.transactions t
   where t.pays_invoice_id = p_invoice_id and t.kind = 'transfer'
     and t.counterparty_account_id = inv.account_id
   order by t.occurred_at desc, t.created_at desc limit 1;

  if inv.status = 'paid' and not inv.settled_manually then
    if aberto > 0 or ultimo.id is null then
      update public.transactions set status = 'pending'
       where invoice_id = p_invoice_id and status = 'cleared' and paid_at = inv.paid_at;
      update public.card_invoices set
        status = case when closing_date < current_date then 'closed' else 'open' end,
        paid_at = null, payment_transaction_id = null
       where id = p_invoice_id;
    elsif ultimo.occurred_at is distinct from inv.paid_at or ultimo.id is distinct from inv.payment_transaction_id then
      update public.transactions set paid_at = ultimo.occurred_at
       where invoice_id = p_invoice_id and status = 'cleared' and paid_at = inv.paid_at;
      update public.card_invoices set paid_at = ultimo.occurred_at, payment_transaction_id = ultimo.id
       where id = p_invoice_id;
    end if;
  elsif inv.status in ('open', 'closed') and aberto <= 0 and ultimo.id is not null then
    update public.transactions set status = 'cleared', paid_at = ultimo.occurred_at
     where invoice_id = p_invoice_id and status = 'pending';
    update public.card_invoices set status = 'paid', paid_at = ultimo.occurred_at, payment_transaction_id = ultimo.id
     where id = p_invoice_id;
  end if;
end;
$$;
revoke execute on function private.refaz_pagamento_da_fatura(uuid, bigint, boolean) from public, anon;
-- o trigger roda como quem edita: `authenticated` precisa do execute (o schema private não é exposto)
grant execute on function private.refaz_pagamento_da_fatura(uuid, bigint, boolean) to authenticated;

-- o quanto a linha paga daquela fatura: só transferência para o cartão dela
create or replace function private.quanto_paga_da_fatura(p_invoice_id uuid, p_kind text, p_counterparty uuid, p_amount bigint)
returns bigint
language sql stable
set search_path = public
as $$
  select case when p_invoice_id is not null and p_kind = 'transfer'
              and p_counterparty = (select ci.account_id from public.card_invoices ci where ci.id = p_invoice_id)
         then p_amount else 0 end;
$$;
revoke execute on function private.quanto_paga_da_fatura(uuid, text, uuid, bigint) from public, anon;
grant execute on function private.quanto_paga_da_fatura(uuid, text, uuid, bigint) to authenticated;

create or replace function public.tg_transactions_invoice_payment()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  antes bigint := 0;
  depois bigint := 0;
  -- apagar a conta pagadora (ou o espaço inteiro) apaga o pagamento EM CASCATA: aí a fatura só
  -- acompanha, sem recusa — senão um pagamento de fatura adiada travaria a exclusão.
  cascata boolean := pg_trigger_depth() > 1;
begin
  if old.pays_invoice_id is null and (tg_op = 'DELETE' or new.pays_invoice_id is null) then
    return null;
  end if;
  antes := private.quanto_paga_da_fatura(old.pays_invoice_id, old.kind, old.counterparty_account_id, old.amount_cents);
  if tg_op = 'UPDATE' then
    depois := private.quanto_paga_da_fatura(new.pays_invoice_id, new.kind, new.counterparty_account_id, new.amount_cents);
  end if;

  if tg_op = 'UPDATE' and new.pays_invoice_id is not distinct from old.pays_invoice_id then
    if depois <> antes or new.occurred_at is distinct from old.occurred_at then
      perform private.refaz_pagamento_da_fatura(new.pays_invoice_id, depois - antes, cascata);
    end if;
    return null;
  end if;
  if old.pays_invoice_id is not null then
    perform private.refaz_pagamento_da_fatura(old.pays_invoice_id, -antes, cascata);
  end if;
  if tg_op = 'UPDATE' and new.pays_invoice_id is not null then
    perform private.refaz_pagamento_da_fatura(new.pays_invoice_id, depois, cascata);
  end if;
  return null;
end;
$$;
revoke execute on function public.tg_transactions_invoice_payment() from public, anon, authenticated;
drop trigger if exists sync_invoice_payment on public.transactions;
create trigger sync_invoice_payment
  after update of amount_cents, occurred_at, kind, counterparty_account_id, pays_invoice_id or delete
  on public.transactions
  for each row execute function public.tg_transactions_invoice_payment();

-- ── desfazer "Marcar como paga" ─────────────────────────────────────────────────────────────
create or replace function public.unsettle_invoice(p_invoice_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = public
set timezone to 'America/Sao_Paulo'
as $$
declare
  inv public.card_invoices;
begin
  select * into inv from public.card_invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'Não encontrei essa fatura.';
  end if;
  if inv.status <> 'paid' then
    return p_invoice_id;  -- idempotente: o segundo toque não vira erro
  end if;
  if not inv.settled_manually then
    raise exception 'Essa fatura foi paga com um pagamento: para reabrir, apague ou corrija o pagamento.';
  end if;

  update public.transactions set status = 'pending'
   where invoice_id = p_invoice_id and status = 'cleared' and paid_at = inv.paid_at;
  update public.card_invoices set
    status = case when closing_date < current_date then 'closed' else 'open' end,
    paid_at = null, settled_manually = false
   where id = p_invoice_id;
  return p_invoice_id;
end;
$$;
revoke execute on function public.unsettle_invoice(uuid) from public, anon;
grant execute on function public.unsettle_invoice(uuid) to authenticated;

-- ── desfazer "Jogar para a próxima" ─────────────────────────────────────────────────────────
-- Sai o saldo que entrou na fatura seguinte, e os juros e o IOF que `roll_invoice` lançou junto
-- (pela data, origem, categoria e nome que ela dá — eles não têm ligação com a fatura de origem;
-- o que a pessoa já renomeou ou importou do extrato fica).
create or replace function public.unroll_invoice(p_invoice_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = public
set timezone to 'America/Sao_Paulo'
as $$
declare
  inv public.card_invoices;
  destino public.card_invoices;
  auto boolean;
begin
  select * into inv from public.card_invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'Não encontrei essa fatura.';
  end if;
  if inv.status <> 'rolled' then
    return p_invoice_id;  -- idempotente
  end if;
  select * into destino from public.card_invoices where id = inv.rolled_into_invoice_id for update;
  if destino.id is not null and (destino.status in ('paid', 'rolled') or destino.paid_cents > 0) then
    raise exception 'O saldo já está na fatura de %, que foi paga ou adiada: desfaça aquela antes.',
      to_char(destino.due_date, 'DD/MM');
  end if;
  select a.rotativo_auto into auto from public.accounts a where a.id = inv.account_id;
  if coalesce(auto, false) and inv.due_date < current_date then
    raise exception 'Este cartão adia a fatura vencida sozinho: desligue "Adiar fatura vencida sozinho" no cartão antes, senão ela volta para a próxima.';
  end if;

  delete from public.transactions t where t.rollover_of_invoice_id = inv.id;
  if destino.id is not null then
    delete from public.transactions t
     where t.invoice_id = destino.id and t.occurred_at = inv.due_date and t.source = 'app'
       and t.category in ('juros', 'impostos')
       and t.description in ('Juros do rotativo', 'Juros do rotativo (estimado)', 'IOF do rotativo', 'IOF do rotativo (estimado)');
  end if;

  update public.card_invoices set
    status = case when closing_date < current_date then 'closed' else 'open' end,
    rolled_into_invoice_id = null
   where id = inv.id;

  -- a fatura seguinte que só existia por causa do saldo adiado sai (mesma regra de 20260926170000)
  if destino.id is not null then
    delete from public.card_invoices ci
     where ci.id = destino.id and ci.status = 'open' and ci.paid_cents = 0
       and not exists (select 1 from public.transactions t where t.invoice_id = ci.id)
       and not exists (select 1 from public.transactions t where t.rollover_of_invoice_id = ci.id)
       and not exists (select 1 from public.card_invoices o where o.rolled_into_invoice_id = ci.id);
  end if;
  return p_invoice_id;
end;
$$;
revoke execute on function public.unroll_invoice(uuid) from public, anon;
grant execute on function public.unroll_invoice(uuid) to authenticated;
