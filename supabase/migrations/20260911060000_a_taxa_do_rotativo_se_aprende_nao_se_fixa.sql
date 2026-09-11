-- A taxa do rotativo NÃO é fixa, e guardá-la num campo era o desenho errado.
--
-- O dono do produto barrou antes de entrar em produção: *"esse valor pode mudar também à medida
-- que o tempo passa, por isso não queria deixar fixo"*. Ele está certo, e os números dele
-- provam. Cobrança real do Nubank em agosto/2026, medida na produção:
--
--   Saldo em rotativo de agosto ....... R$ 333,72   (10/08)
--   Juros de pagamento parcial ........ R$  42,97   (31/08)  ->  12,876% no período
--   IOF de pagamento parcial .......... R$   2,13   (31/08)  ->   0,6383%
--
-- 12,876%, não os 15,5% que eu tinha sugerido como exemplo — o campo fixo erraria ~20% já no
-- primeiro mês, e envelheceria sozinho depois.
--
-- ## De onde a estimativa passa a vir
--
-- Do HISTÓRICO DELE. `private.rotativo_rate_for` divide os juros efetivamente cobrados pelo
-- saldo que os gerou, na última vez que isso aconteceu naquele cartão. É a taxa daquele cartão,
-- daquele usuário, e ela se atualiza sozinha toda vez que uma fatura real é importada — que é
-- exatamente o fluxo que já existe.
--
-- ⚠️ **Linha ESTIMADA não alimenta a estimativa.** Sem o filtro de `(estimado)`, o palpite de um
-- mês viraria a "observação" do mês seguinte e o número nunca mais se corrigiria — um laço que
-- parece aprendizado e é só eco. Só cobrança de verdade (importada ou digitada) ensina.
--
-- O campo `accounts.rotativo_rate_monthly` continua, mas mudou de papel: deixou de ser A taxa e
-- virou o que usar ENQUANTO não houve cobrança nenhuma para observar. Sem histórico e sem
-- campo, o app não estima juros — e a tela diz isso.
create or replace function private.rotativo_rate_for(p_account_id uuid)
returns numeric
language sql stable set search_path = public as $$
  select coalesce(
    (select round(j.amount_cents::numeric / p.amount_cents, 6)
       from public.transactions p
       join public.transactions j
         on j.invoice_id = p.invoice_id
        and j.id <> p.id
        and j.description ilike '%juros%rotativ%'
        -- ver o cabeçalho: estimativa não pode virar observação
        and j.description not ilike '%(estimado)%'
      where p.account_id = p_account_id
        and p.description ilike 'Saldo em rotativo%'
        and p.amount_cents > 0
      order by p.occurred_at desc, p.created_at desc
      limit 1),
    (select a.rotativo_rate_monthly from public.accounts a where a.id = p_account_id)
  );
$$;

comment on column public.accounts.rotativo_rate_monthly is
  'Taxa de PARTIDA do rotativo, em fração mensal. Só vale enquanto não houve nenhuma cobrança '
  'real para observar — depois disso quem manda é `private.rotativo_rate_for`, que aprende do '
  'histórico do próprio cartão. A taxa muda com o tempo e não podia ficar fixa num campo.';

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
