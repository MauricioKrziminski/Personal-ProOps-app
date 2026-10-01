-- Serialize invoice operations before reading status or calculating the balance.
-- Deletion of a linked purchase holds the same invoice lock: a waiter must see
-- the committed purchase state, never settle/roll a balance read before waiting.
-- Preserve signatures, INVOKER/RLS, calculations and existing grants.
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
  where ci.id = p_invoice_id for update of ci;
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

create or replace function public.roll_invoice(
  p_invoice_id uuid,
  p_juros_cents bigint default null,
  p_iof_cents bigint default null
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  inv public.card_invoices;
  aberto bigint;
  destino public.card_invoices;
  dias int;
  taxa numeric;
  juros bigint := coalesce(p_juros_cents, 0);
  iof bigint := coalesce(p_iof_cents, 0);
  tx_id uuid;
  veio_de_adiamento boolean;
begin
  select * into inv from public.card_invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'Fatura não encontrada';
  end if;
  if inv.status = 'paid' then
    raise exception 'Essa fatura já está paga';
  end if;
  if inv.status = 'rolled' then
    raise exception 'Essa fatura já foi para a próxima';
  end if;

  veio_de_adiamento := exists (
    select 1 from public.card_invoices o where o.rolled_into_invoice_id = inv.id);

  aberto := private.invoice_open_cents(inv.id);
  if aberto <= 0 then
    raise exception 'Não há saldo em aberto nessa fatura';
  end if;

  insert into public.transactions
    (workspace_id, user_id, account_id, kind, amount_cents, currency, category,
     description, occurred_at, status, source, rollover_of_invoice_id)
  values (inv.workspace_id, inv.user_id, inv.account_id, 'expense', aberto, 'BRL', 'contas',
          'Saldo em rotativo de ' || private.mes_pt(inv.reference_month),
          inv.due_date, 'pending', 'app', inv.id)
  returning id into tx_id;

  select ci.* into destino from public.card_invoices ci
    join public.transactions t on t.invoice_id = ci.id where t.id = tx_id;

  -- ⚠️ O IOF é a FÓRMULA da lei (0,38% + 0,0082%/dia, teto 3,38%), e ela acerta a ordem de
  -- grandeza, não o centavo: sobre os R$ 333,72 reais do dono do produto ela dá R$ 2,12 e o
  -- Nubank cobrou R$ 2,13 — a diferença é a contagem de dias e o arredondamento do emissor,
  -- que não são públicos. É estimativa muito boa, não valor exato, e a tela não promete exatidão.
  dias := greatest(1, destino.due_date - inv.due_date);
  if p_iof_cents is null then
    iof := round(aberto * least(0.0038 + 0.000082 * dias, 0.0338));
  end if;

  taxa := private.rotativo_rate_for(inv.account_id);
  if p_juros_cents is null and taxa is not null then
    juros := round(aberto * taxa);
  end if;

  if juros > 0 then
    insert into public.transactions
      (workspace_id, user_id, account_id, kind, amount_cents, currency, category,
       description, occurred_at, status, source)
    values (inv.workspace_id, inv.user_id, inv.account_id, 'expense', juros, 'BRL', 'juros',
            'Juros do rotativo' || case when p_juros_cents is null then ' (estimado)' else '' end,
            inv.due_date, 'pending', 'app');
  end if;
  if iof > 0 then
    insert into public.transactions
      (workspace_id, user_id, account_id, kind, amount_cents, currency, category,
       description, occurred_at, status, source)
    values (inv.workspace_id, inv.user_id, inv.account_id, 'expense', iof, 'BRL', 'impostos',
            'IOF do rotativo (estimado)', inv.due_date, 'pending', 'app');
  end if;

  update public.card_invoices
     set status = 'rolled', rolled_into_invoice_id = destino.id
   where id = inv.id;

  return jsonb_build_object(
    'principal_cents', aberto,
    'juros_cents', juros,
    'iof_cents', iof,
    'taxa_usada', taxa,
    'juros_estimados', p_juros_cents is null and taxa is not null,
    'sem_taxa', taxa is null and p_juros_cents is null,
    'segundo_ciclo', veio_de_adiamento,
    'destino_id', destino.id,
    'destino_vence_em', destino.due_date
  );
end;
$$;

-- Manual settlement must also read status after acquiring the invoice lock.
-- A rolled balance must be undone first; paid settlement stays idempotent.
create or replace function public.settle_invoice(
  p_invoice_id uuid,
  p_paid_at date default current_date
)
returns uuid
language plpgsql security invoker
set search_path = public
as $$
declare
  inv record;
begin
  -- security invoker + RLS: quem não enxerga a fatura não acha a linha
  select ci.id, ci.status into inv
  from public.card_invoices ci where ci.id = p_invoice_id for update;
  if inv.id is null then
    raise exception 'fatura não encontrada';
  end if;

  -- Idempotente de propósito: o usuário toca duas vezes no botão antes da tela
  -- responder, e a segunda não pode virar erro nem segunda escrita.
  if inv.status = 'paid' then
    return p_invoice_id;
  end if;
  if inv.status = 'rolled' then
    raise exception 'Essa fatura já foi para a próxima: desfaça o adiamento antes de marcar como paga.';
  end if;

  -- As parcelas de dentro TAMBÉM fecham. Sem isto o app se contradiz: fatura
  -- paga continuaria alimentando `upcoming_bills` e cada parcela continuaria
  -- oferecendo o botão "Paguei".
  --
  -- ⚠️ NÃO tocar em `occurred_at`: o trigger `set_invoice` é
  -- `before update of account_id, occurred_at` (0013:211) e remanejaria a
  -- parcela da fatura de maio para a fatura de hoje.
  update public.transactions
     set status = 'cleared', paid_at = p_paid_at
   where invoice_id = p_invoice_id and status = 'pending';

  -- `payment_transaction_id` fica NULL, e é isso que distingue esta operação de
  -- `pay_invoice`: não existe transferência, então nenhum saldo se move.
  update public.card_invoices
     set status = 'paid', paid_at = p_paid_at,
         payment_transaction_id = null, settled_manually = true
   where id = p_invoice_id;

  return p_invoice_id;
end;
$$;
