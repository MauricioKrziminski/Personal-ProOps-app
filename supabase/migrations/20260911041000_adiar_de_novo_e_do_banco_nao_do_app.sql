-- Adiar a fatura DUAS vezes seguidas é possível, e o app não pode recusar.
--
-- A `20260911040000` bloqueava adiar uma fatura que já tinha recebido um saldo adiado, citando
-- a Resolução CMN 4.549/2017 (o rotativo dura um ciclo; depois o banco deve converter em
-- parcelamento). O dono do produto apontou o furo, e ele tem razão: *"o Nubank consegue, ele
-- mescla o pendente na fatura como se fosse um lançamento"*.
--
-- O erro não foi a leitura da norma — foi o LUGAR onde ela entrou. **A 4.549 obriga o BANCO,
-- não o usuário**, e o app não é o banco: ele registra o que aconteceu na conta da pessoa. Com
-- a trava, uma fatura que na vida real carregou saldo dois ciclos seguidos ficaria impossível
-- de representar, e a única saída seria de novo marcar como paga uma fatura não paga — o
-- defeito exato que esta feature existe para matar. Regra de terceiro virando trava de
-- digitação é como um app de finanças passa a mentir com a melhor das intenções.
--
-- O que fica: a recusa de adiar a MESMA fatura duas vezes (`status = 'rolled'`), que é
-- idempotência de verdade — sem ela o mesmo saldo entraria duas vezes na fatura seguinte.
-- O que sai: a trava de cadeia. No lugar dela, `roll_invoice` devolve `segundo_ciclo`, e a
-- tela AVISA que pela 4.549 o banco é obrigado a oferecer parcelamento. Informar, não impedir.

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
  rotulo text;
  veio_de_adiamento boolean;
begin
  select * into inv from public.card_invoices where id = p_invoice_id;
  if not found then
    raise exception 'Fatura não encontrada';
  end if;
  if inv.status = 'paid' then
    raise exception 'Essa fatura já está paga';
  end if;
  -- A ÚNICA recusa: adiar a mesma fatura duas vezes duplicaria o saldo na seguinte.
  if inv.status = 'rolled' then
    raise exception 'Essa fatura já foi para a próxima';
  end if;

  -- Não impede: informa. Ver o cabeçalho.
  veio_de_adiamento := exists (
    select 1 from public.card_invoices o where o.rolled_into_invoice_id = inv.id);

  aberto := private.invoice_open_cents(inv.id);
  if aberto <= 0 then
    raise exception 'Não há saldo em aberto nessa fatura';
  end if;

  select * into card from public.accounts where id = inv.account_id;
  rotulo := to_char(inv.reference_month, 'TMMonth');

  insert into public.transactions
    (workspace_id, user_id, account_id, kind, amount_cents, currency, category,
     description, occurred_at, status, source, rollover_of_invoice_id)
  values (inv.workspace_id, inv.user_id, inv.account_id, 'expense', aberto, 'BRL', 'contas',
          'Saldo em rotativo de ' || rotulo, inv.due_date, 'pending', 'app', inv.id)
  returning id into tx_id;

  select ci.* into destino from public.card_invoices ci
    join public.transactions t on t.invoice_id = ci.id where t.id = tx_id;

  -- IOF é LEI, não estimativa: 0,38% fixo + 0,0082% ao dia, teto de 3,38%
  -- (Decretos 12.466/2025 e 12.499/2025). Sai sempre, mesmo sem taxa de juros cadastrada.
  dias := greatest(1, destino.due_date - inv.due_date);
  if p_iof_cents is null then
    iof := round(aberto * least(0.0038 + 0.000082 * dias, 0.0338));
  end if;
  -- Juros são do CARTÃO e vêm impressos na fatura. Sem a taxa o app não inventa.
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
