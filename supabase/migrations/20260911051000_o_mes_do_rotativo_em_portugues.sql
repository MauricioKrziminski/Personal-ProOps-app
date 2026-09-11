-- "Saldo em rotativo de July".
--
-- `to_char(data, 'TMMonth')` traduz o mês pelo `lc_time` da SESSÃO, e o Postgres do Supabase
-- roda em `C`/inglês. O `TM` prometia a tradução e entregava o nome em inglês no meio de uma
-- frase em português, dentro da descrição de um lançamento de dinheiro — que é onde o usuário
-- menos espera achar isso. Apareceu no primeiro teste contra dados reais.
--
-- A correção não é configurar locale no banco (é global, e a doc do Supabase recomenda não
-- mexer): é não depender dele. Um array literal é exato, testável e não muda debaixo de
-- ninguém — e este app escreve em pt-BR em todo lugar por decisão, não por configuração.
create or replace function private.mes_pt(d date)
returns text
language sql immutable as $$
  select (array['janeiro','fevereiro','março','abril','maio','junho',
                'julho','agosto','setembro','outubro','novembro','dezembro'])
         [extract(month from d)::int];
$$;

create or replace function public.roll_invoice(
  p_invoice_id uuid,
  p_juros_cents bigint default null,
  p_iof_cents bigint default null
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  inv public.card_invoices;
  card public.accounts;
  aberto bigint;
  destino public.card_invoices;
  dias int;
  juros bigint := coalesce(p_juros_cents, 0);
  iof bigint := coalesce(p_iof_cents, 0);
  tx_id uuid;
  veio_de_adiamento boolean;
begin
  select * into inv from public.card_invoices where id = p_invoice_id;
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

  select * into card from public.accounts where id = inv.account_id;

  insert into public.transactions
    (workspace_id, user_id, account_id, kind, amount_cents, currency, category,
     description, occurred_at, status, source, rollover_of_invoice_id)
  values (inv.workspace_id, inv.user_id, inv.account_id, 'expense', aberto, 'BRL', 'contas',
          'Saldo em rotativo de ' || private.mes_pt(inv.reference_month),
          inv.due_date, 'pending', 'app', inv.id)
  returning id into tx_id;

  select ci.* into destino from public.card_invoices ci
    join public.transactions t on t.invoice_id = ci.id where t.id = tx_id;

  dias := greatest(1, destino.due_date - inv.due_date);
  if p_iof_cents is null then
    iof := round(aberto * least(0.0038 + 0.000082 * dias, 0.0338));
  end if;
  if p_juros_cents is null and card.rotativo_rate_monthly is not null then
    juros := round(aberto * card.rotativo_rate_monthly);
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
            'IOF do rotativo', inv.due_date, 'pending', 'app');
  end if;

  update public.card_invoices
     set status = 'rolled', rolled_into_invoice_id = destino.id
   where id = inv.id;

  return jsonb_build_object(
    'principal_cents', aberto,
    'juros_cents', juros,
    'iof_cents', iof,
    'juros_estimados', p_juros_cents is null and card.rotativo_rate_monthly is not null,
    'sem_taxa', card.rotativo_rate_monthly is null and p_juros_cents is null,
    'segundo_ciclo', veio_de_adiamento,
    'destino_id', destino.id,
    'destino_vence_em', destino.due_date
  );
end;
$$;
