-- Pagar uma PARTE da fatura.
--
-- `pay_invoice` só sabia pagar o valor cheio: somava as compras e criava a transferência inteira.
-- A vida real do dono do produto em setembro/2026 foi outra — R$ 2.080,00 em 04/09 e mais
-- R$ 809,00 em 08/09 de uma fatura de R$ 3.271,77, com R$ 371,67 ficando no rotativo. Não havia
-- como registrar isso, e é o que ele pediu com estas palavras: "estou sentindo falta de pagar as
-- coisas parcialmente ... seria mais fatura e o que mais fizer sentido pagar parcialmente".
--
-- Desenho em `docs/design/fatura.md`, seção "Pagar uma parte".

-- ── 1. o quanto já foi pago ────────────────────────────────────────────────
--
-- Única coisa materializada por aqui, e a exceção é deliberada. A regra "o total nunca é
-- materializado" existe porque o total é soma de LINHAS que o usuário edita o tempo todo, então
-- a cópia derivaria da origem. Pagamento não é isso: o único caminho de escrita é `pay_invoice`.
--
-- A alternativa derivada — marcar a transferência com `invoice_id` e somar — não existe: o
-- trigger `set_invoice` (`0013:175-188`) ZERA `invoice_id` de toda linha cuja conta não seja
-- cartão, e a conta de um pagamento é a PAGADORA. Abrir exceção nesse trigger é desviar o caminho
-- por onde passa cada linha de cartão do app para economizar uma coluna.
alter table public.card_invoices
  add column if not exists paid_cents bigint not null default 0;

comment on column public.card_invoices.paid_cents is
  'Quanto já foi pago desta fatura, somado por pay_invoice. Pagamento parcial deixa a fatura em aberto com paid_cents > 0. settle_invoice (quitação histórica, sem caixa) NÃO mexe aqui: são coisas diferentes.';

-- ponytail: apagar a transferência de pagamento à mão não devolve `paid_cents`. É a mesma
-- fragilidade que `payment_transaction_id` já tem desde a 0046 (`on delete set null`). Se um dia
-- desfazer pagamento virar produto, `unpay_invoice` desconta aqui — e é ela que fecha o buraco,
-- não um trigger em `transactions`.

-- ── 2. quanto a fatura ainda deve, num lugar só ────────────────────────────
--
-- OITO funções calculavam isso inline. Pagamento parcial que não passe por todas produz
-- exatamente a contradição que a `0046 §4` descreve: o saldo do cartão dizendo −371,67 enquanto a
-- tela de Cartões diz −3.271,77.
create or replace function private.invoice_open_cents(p_invoice_id uuid)
returns bigint
language sql stable
set search_path = public
as $$
  select (coalesce((select sum(t.amount_cents) from public.transactions t
                    where t.invoice_id = p_invoice_id and t.kind = 'expense'), 0)
        - coalesce((select ci.paid_cents from public.card_invoices ci
                    where ci.id = p_invoice_id), 0))::bigint;
$$;
grant execute on function private.invoice_open_cents(uuid) to authenticated, service_role;

-- ── 3. pay_invoice aceita um valor ─────────────────────────────────────────
--
-- ⚠️ A antiga é DERRUBADA, não substituída: acrescentar um parâmetro com default criaria uma
-- sobrecarga, e a chamada de três argumentos que o app faz passaria a ser ambígua
-- ("function is not unique"). O ACL é o default (execute para public), então drop + create não
-- perde permissão nenhuma.
--
-- ⚠️ As mensagens ganharam ACENTO. A tela mapeia as quatro exceções por texto
-- (`invoice/[id].tsx:mensagemDoErro`) procurando "já paga", "sem lançamentos", "próprio cartão" e
-- "não encontrada" — e o banco levantava "ja paga", "sem lancamentos", "proprio cartao",
-- "nao encontrada". Nenhum dos quatro casava, então todo erro caía no genérico "Não deu para
-- registrar. Tenta de novo.", inclusive os três que não se resolvem tentando de novo.
drop function if exists public.pay_invoice(uuid, uuid, date);

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
  if inv.status = 'paid' then
    raise exception 'fatura já paga em %', inv.paid_at;
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
     account_id, counterparty_account_id, occurred_at, source, status)
  values (inv.workspace_id, coalesce((select auth.uid()), inv.user_id), 'transfer',
          valor, 'Pagamento da fatura ' || inv.card_name,
          p_account_id, inv.account_id, p_paid_at, 'app', 'cleared')
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

comment on function public.pay_invoice(uuid, uuid, date, bigint) is
  'Registra pagamento da fatura criando a transferência. Sem p_amount_cents paga o que falta e quita; com valor menor, soma em paid_cents e a fatura segue em aberto (rotativo). Juros e IOF do rotativo NÃO são modelados — chegam como despesas comuns na fatura seguinte.';

-- ── 4. os oito leitores ────────────────────────────────────────────────────
--
-- Corpos gerados a partir da definição VIVA de cada função (`pg_get_functiondef`), com uma única
-- substituição: a soma inline virou `private.invoice_open_cents(ci.id)`.
--
-- ⚠️ `invoice_total_cents` do card_summary continua sendo a soma das compras. É o valor de face da
-- fatura, o número impresso no PDF; trocá-lo por "o que falta" faria a tela de Cartões mentir
-- sobre o que foi cobrado. Quem passou a descontar o pagamento é `unpaid_total_cents`,
-- `available_limit_cents` e `overdue_total_cents`.
CREATE OR REPLACE FUNCTION private.net_worth_now(ws_id uuid)
 RETURNS TABLE(cash_cents bigint, investments_cents bigint, other_assets_cents bigint, liabilities_cents bigint, net_cents bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with dinheiro as (select private.cash_total(array[ws_id]) as cents),
  investimentos as (
    select coalesce(sum(current_value_cents), 0)::bigint as cents
    from public.assets
    where workspace_id = ws_id and not archived and not is_liability
      and class in ('investment','crypto','equity')
  ),
  outros as (
    select coalesce(sum(current_value_cents), 0)::bigint as cents
    from public.assets
    where workspace_id = ws_id and not archived and not is_liability
      and class not in ('investment','crypto','equity')
  ),
  passivos as (
    select (
      coalesce((select sum(current_value_cents) from public.assets
                where workspace_id = ws_id and not archived and is_liability), 0)
      + coalesce((select sum(remaining_cents) from public.debts
                  where workspace_id = ws_id and not archived), 0)
      + coalesce((select sum(private.invoice_open_cents(ci.id)) from public.card_invoices ci
                  where ci.workspace_id = ws_id and ci.status <> 'paid'), 0)
    )::bigint as cents
  )
  select d.cents, i.cents, o.cents, p.cents,
         (d.cents + i.cents + o.cents - p.cents)::bigint
  from dinheiro d, investimentos i, outros o, passivos p;
$function$;


CREATE OR REPLACE FUNCTION public._alerts_to_send()
 RETURNS TABLE(workspace_id uuid, user_id uuid, phone text, expo_push_token text, alerts_push_enabled boolean, alerts_whatsapp_enabled boolean, kind text, ref text, title text, body text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with donos as (
    select w.id as workspace_id, w.owner_id as user_id,
           p.phone, p.expo_push_token, p.timezone,
           p.alerts_push_enabled, p.alerts_whatsapp_enabled
    from public.workspaces w
    join public.profiles p on p.id = w.owner_id
    where (p.alerts_push_enabled and p.expo_push_token is not null)
       or (p.alerts_whatsapp_enabled and p.phone is not null)
  ),
  teste as (
    select d.workspace_id, d.user_id, d.phone, d.expo_push_token,
           d.alerts_push_enabled, d.alerts_whatsapp_enabled,
           'trial_ending' as kind,
           s.current_period_end::text as ref,
           'Seu teste acaba em 2 dias' as title,
           case when uso.lancamentos > 0
                then 'Voce ja registrou ' || uso.lancamentos
                     || ' lancamento' || case when uso.lancamentos = 1 then '' else 's' end
                     || ' nesta semana. Dia ' || to_char(s.current_period_end, 'DD/MM')
                     || ' o teste vira assinatura automaticamente. '
                     || 'Se nao quiser continuar, cancele na loja antes disso — '
                     || 'sao dois toques e nao precisa falar com ninguem.'
                else 'Dia ' || to_char(s.current_period_end, 'DD/MM')
                     || ' o teste vira assinatura automaticamente. '
                     || 'Manda um gasto aqui pra experimentar antes de decidir — '
                     || 'ou cancele na loja, sao dois toques.' end as body
    from donos d
    join public.subscriptions s on s.workspace_id = d.workspace_id
    cross join lateral (
      select count(*)::int as lancamentos
      from public.transactions t
      where t.workspace_id = d.workspace_id
        and t.created_at >= now() - interval '7 days'
    ) uso
    where s.is_trial
      and s.status = 'trialing'
      and s.current_period_end = current_date + 2
  ),
  orcamento as (
    select d.workspace_id, d.user_id, d.phone, d.expo_push_token,
           d.alerts_push_enabled, d.alerts_whatsapp_enabled,
           case when b.spent_cents >= b.limit_cents then 'budget_100' else 'budget_80' end as kind,
           b.category as ref,
           case when b.spent_cents >= b.limit_cents
                then 'Orcamento estourado'
                else 'Orcamento no limite' end as title,
           case when b.spent_cents >= b.limit_cents
                then 'Voce ja gastou ' || round(b.spent_cents::numeric / 100, 2)
                     || ' de ' || round(b.limit_cents::numeric / 100, 2)
                     || ' em ' || b.category || '. Quer que eu remaneje de outra categoria?'
                else 'Voce ja usou ' || round(100.0 * b.spent_cents / b.limit_cents)
                     || '% do orcamento de ' || b.category
                     || '. Faltam ' || round((b.limit_cents - b.spent_cents)::numeric / 100, 2)
                     || ' ate o fim do mes.' end as body
    from donos d
    cross join lateral private.budgets_status_for(array[d.workspace_id], current_date) b
    where b.limit_cents > 0 and b.spent_cents >= b.limit_cents * 0.8
  ),
  fatura as (
    select d.workspace_id, d.user_id, d.phone, d.expo_push_token,
           d.alerts_push_enabled, d.alerts_whatsapp_enabled,
           'invoice_due' as kind, ci.id::text as ref,
           'Fatura do ' || a.name as title,
           'Fatura de ' || round(private.invoice_open_cents(ci.id)::numeric / 100, 2)
             || ' vence em ' || to_char(ci.due_date, 'DD/MM')
             || '. Ja pagou? Me manda "paguei a fatura do ' || a.name || '".' as body
    from donos d
    join public.card_invoices ci on ci.workspace_id = d.workspace_id and ci.status <> 'paid'
    join public.accounts a on a.id = ci.account_id
    join public.transactions t on t.invoice_id = ci.id and t.kind = 'expense'
    where ci.due_date <= current_date + 3
    group by d.workspace_id, d.user_id, d.phone, d.expo_push_token,
             d.alerts_push_enabled, d.alerts_whatsapp_enabled,
             ci.id, ci.due_date, a.name
  ),
  conta as (
    select d.workspace_id, d.user_id, d.phone, d.expo_push_token,
           d.alerts_push_enabled, d.alerts_whatsapp_enabled,
           'bill_due' as kind, t.id::text as ref,
           'Conta vencendo' as title,
           coalesce(t.description, t.category, 'Conta') || ' de '
             || round(t.amount_cents::numeric / 100, 2)
             || ' vence ' || case when coalesce(t.due_at, t.occurred_at) = current_date
                                  then 'hoje' else 'amanha' end
             || '. Depois me diz "paguei" que eu dou baixa.' as body
    from donos d
    join public.transactions t on t.workspace_id = d.workspace_id
    where t.status = 'pending' and t.kind = 'expense' and t.invoice_id is null
      and coalesce(t.due_at, t.occurred_at) between current_date and current_date + 1
  ),
  vermelho as (
    select d.workspace_id, d.user_id, d.phone, d.expo_push_token,
           d.alerts_push_enabled, d.alerts_whatsapp_enabled,
           'negative_forecast' as kind, f.day::text as ref,
           'Saldo vai ficar negativo' as title,
           'Do jeito que esta, dia ' || to_char(f.day, 'DD/MM')
             || ' seu saldo fica em ' || round(f.balance_cents::numeric / 100, 2)
             || '. Quer ver o que da pra adiar?' as body
    from donos d
    cross join lateral (
      select day, balance_cents
      from public._cash_flow_forecast(d.user_id, 30)
      where balance_cents < 0
      order by day
      limit 1
    ) f
  )
  -- O teste vem primeiro porque é o único aviso com prazo dentro do teto diário.
  select * from teste
  union all select * from orcamento
  union all select * from fatura
  union all select * from conta
  union all select * from vermelho;
$function$;


CREATE OR REPLACE FUNCTION public._card_summary(uid uuid)
 RETURNS TABLE(account_id uuid, name text, credit_limit_cents bigint, closing_day integer, due_day integer, invoice_id uuid, reference_month date, closing_date date, due_date date, invoice_total_cents bigint, unpaid_total_cents bigint, available_limit_cents bigint, overdue_count integer, overdue_total_cents bigint, oldest_overdue_invoice_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with cards as (
    select a.* from public.accounts a
    where a.workspace_id in (select public._workspace_ids(uid))
      and a.type = 'credit_card' and not a.archived
  ),
  totals as (
    select ci.id as invoice_id, coalesce(sum(t.amount_cents), 0)::bigint as total_cents,
           private.invoice_open_cents(ci.id) as open_cents
    from public.card_invoices ci
    -- escopo no workspace: sem este join a CTE varria card_invoices de TODOS os
    -- usuarios a cada chamada (herdado da 0013). Nao vazava, porque o resultado e
    -- filtrado depois, mas custava O(faturas do banco inteiro).
    join cards c on c.id = ci.account_id
    left join public.transactions t on t.invoice_id = ci.id and t.kind = 'expense'
    group by ci.id
  ),
  aberta as (
    select distinct on (ci.account_id) ci.*
    from public.card_invoices ci
    join cards c on c.id = ci.account_id
    where ci.status <> 'paid'
    order by ci.account_id,
             -- corrente e futuras primeiro, da mais próxima para a mais distante
             (ci.reference_month < date_trunc('month', current_date)::date),
             case when ci.reference_month >= date_trunc('month', current_date)::date
                  then ci.reference_month end asc,
             ci.reference_month desc
  ),
  atrasadas as (
    select ci.account_id,
           count(*)::int as overdue_count,
           coalesce(sum(tt.open_cents), 0)::bigint as overdue_total_cents,
           (array_agg(ci.id order by ci.reference_month))[1] as oldest_id
    from public.card_invoices ci
    join cards c on c.id = ci.account_id
    left join totals tt on tt.invoice_id = ci.id
    where ci.status <> 'paid' and ci.due_date < current_date
    group by ci.account_id
  )
  select c.id, c.name, c.credit_limit_cents, c.closing_day, c.due_day,
         ab.id, ab.reference_month, ab.closing_date, ab.due_date,
         coalesce(tt.total_cents, 0)::bigint,
         coalesce((select sum(t2.open_cents) from totals t2
                   join public.card_invoices ci2 on ci2.id = t2.invoice_id
                   where ci2.account_id = c.id and ci2.status <> 'paid'), 0)::bigint,
         (coalesce(c.credit_limit_cents, 0)
          - coalesce((select sum(t3.open_cents) from totals t3
                      join public.card_invoices ci3 on ci3.id = t3.invoice_id
                      where ci3.account_id = c.id and ci3.status <> 'paid'), 0))::bigint,
         coalesce(atr.overdue_count, 0),
         coalesce(atr.overdue_total_cents, 0)::bigint,
         atr.oldest_id
  from cards c
  left join aberta ab on ab.account_id = c.id
  left join totals tt on tt.invoice_id = ab.id
  left join atrasadas atr on atr.account_id = c.id
  order by c.name;
$function$;


CREATE OR REPLACE FUNCTION public.card_summary()
 RETURNS TABLE(account_id uuid, name text, credit_limit_cents bigint, closing_day integer, due_day integer, invoice_id uuid, reference_month date, closing_date date, due_date date, invoice_total_cents bigint, unpaid_total_cents bigint, available_limit_cents bigint, overdue_count integer, overdue_total_cents bigint, oldest_overdue_invoice_id uuid)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with cards as (
    select a.* from public.accounts a
    where a.workspace_id in (select private.my_workspace_ids())
      and a.type = 'credit_card' and not a.archived
  ),
  totals as (
    select ci.id as invoice_id, coalesce(sum(t.amount_cents), 0)::bigint as total_cents,
           private.invoice_open_cents(ci.id) as open_cents
    from public.card_invoices ci
    -- escopo no workspace: sem este join a CTE varria card_invoices de TODOS os
    -- usuarios a cada chamada (herdado da 0013). Nao vazava, porque o resultado e
    -- filtrado depois, mas custava O(faturas do banco inteiro).
    join cards c on c.id = ci.account_id
    left join public.transactions t on t.invoice_id = ci.id and t.kind = 'expense'
    group by ci.id
  ),
  aberta as (
    select distinct on (ci.account_id) ci.*
    from public.card_invoices ci
    join cards c on c.id = ci.account_id
    where ci.status <> 'paid'
    order by ci.account_id,
             (ci.reference_month < date_trunc('month', current_date)::date),
             case when ci.reference_month >= date_trunc('month', current_date)::date
                  then ci.reference_month end asc,
             ci.reference_month desc
  ),
  atrasadas as (
    select ci.account_id,
           count(*)::int as overdue_count,
           coalesce(sum(tt.open_cents), 0)::bigint as overdue_total_cents,
           (array_agg(ci.id order by ci.reference_month))[1] as oldest_id
    from public.card_invoices ci
    join cards c on c.id = ci.account_id
    left join totals tt on tt.invoice_id = ci.id
    where ci.status <> 'paid' and ci.due_date < current_date
    group by ci.account_id
  )
  select c.id, c.name, c.credit_limit_cents, c.closing_day, c.due_day,
         ab.id, ab.reference_month, ab.closing_date, ab.due_date,
         coalesce(tt.total_cents, 0)::bigint,
         coalesce((select sum(t2.open_cents) from totals t2
                   join public.card_invoices ci2 on ci2.id = t2.invoice_id
                   where ci2.account_id = c.id and ci2.status <> 'paid'), 0)::bigint,
         (coalesce(c.credit_limit_cents, 0)
          - coalesce((select sum(t3.open_cents) from totals t3
                      join public.card_invoices ci3 on ci3.id = t3.invoice_id
                      where ci3.account_id = c.id and ci3.status <> 'paid'), 0))::bigint,
         coalesce(atr.overdue_count, 0),
         coalesce(atr.overdue_total_cents, 0)::bigint,
         atr.oldest_id
  from cards c
  left join aberta ab on ab.account_id = c.id
  left join totals tt on tt.invoice_id = ab.id
  left join atrasadas atr on atr.account_id = c.id
  order by c.name;
$function$;


CREATE OR REPLACE FUNCTION public._cash_flow_forecast(uid uuid, days integer DEFAULT 90)
 RETURNS TABLE(day date, in_cents bigint, out_cents bigint, balance_cents bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with horizonte as (select least(greatest(coalesce(days, 90), 1), 365) as dias),
  saldo_inicial as (
    select private.cash_total(array(select public._workspace_ids(uid))) as cents
  ),
  eventos as (
    select greatest(ci.due_date, current_date) as day,
           0::bigint as in_cents,
           private.invoice_open_cents(ci.id) as out_cents
    from public.card_invoices ci
    join public.transactions t on t.invoice_id = ci.id and t.kind = 'expense'
    where ci.workspace_id in (select public._workspace_ids(uid))
      and ci.status <> 'paid'
    group by ci.id, ci.due_date
    union all
    select greatest(coalesce(t.due_at, t.occurred_at), current_date),
           case when t.kind = 'income'  then t.amount_cents else 0 end::bigint,
           case when t.kind = 'expense' then t.amount_cents else 0 end::bigint
    from public.transactions t
    where t.workspace_id in (select public._workspace_ids(uid))
      and t.status = 'pending' and t.invoice_id is null and t.kind <> 'transfer'
    union all
    -- (c) prestação de dívida/financiamento em aberto: sai do caixa no vencimento
    select greatest(s.due_date, current_date), 0::bigint, s.payment_cents
    from public.debts d
    cross join lateral private.debt_schedule_for(d.id) s
    where d.workspace_id in (select public._workspace_ids(uid))
      and not d.archived and d.remaining_cents > 0
      and s.due_date <= current_date + (select dias from horizonte)
  ),
  dias as (
    select generate_series(current_date, current_date + (select dias from horizonte),
                           interval '1 day')::date as day
  ),
  agregado as (
    select d.day,
           coalesce(sum(e.in_cents), 0)::bigint as in_cents,
           coalesce(sum(e.out_cents), 0)::bigint as out_cents
    from dias d left join eventos e on e.day = d.day
    group by d.day
  )
  select a.day, a.in_cents, a.out_cents,
         ((select cents from saldo_inicial)
          + sum(a.in_cents - a.out_cents) over (order by a.day))::bigint
  from agregado a
  order by a.day;
$function$;


CREATE OR REPLACE FUNCTION public.cash_flow_forecast(days integer DEFAULT 90)
 RETURNS TABLE(day date, in_cents bigint, out_cents bigint, balance_cents bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with horizonte as (select least(greatest(coalesce(days, 90), 1), 365) as dias),
  saldo_inicial as (
    select private.cash_total(array(select private.my_workspace_ids())) as cents
  ),
  eventos as (
    select greatest(ci.due_date, current_date) as day,
           0::bigint as in_cents,
           private.invoice_open_cents(ci.id) as out_cents
    from public.card_invoices ci
    join public.transactions t on t.invoice_id = ci.id and t.kind = 'expense'
    where ci.workspace_id in (select private.my_workspace_ids())
      and ci.status <> 'paid'
    group by ci.id, ci.due_date
    union all
    select greatest(coalesce(t.due_at, t.occurred_at), current_date),
           case when t.kind = 'income'  then t.amount_cents else 0 end::bigint,
           case when t.kind = 'expense' then t.amount_cents else 0 end::bigint
    from public.transactions t
    where t.workspace_id in (select private.my_workspace_ids())
      and t.status = 'pending' and t.invoice_id is null and t.kind <> 'transfer'
    union all
    -- (c) prestação de dívida/financiamento em aberto: sai do caixa no vencimento
    select greatest(s.due_date, current_date), 0::bigint, s.payment_cents
    from public.debts d
    cross join lateral private.debt_schedule_for(d.id) s
    where d.workspace_id in (select private.my_workspace_ids())
      and not d.archived and d.remaining_cents > 0
      and s.due_date <= current_date + (select dias from horizonte)
  ),
  dias as (
    select generate_series(current_date, current_date + (select dias from horizonte),
                           interval '1 day')::date as day
  ),
  agregado as (
    select d.day,
           coalesce(sum(e.in_cents), 0)::bigint as in_cents,
           coalesce(sum(e.out_cents), 0)::bigint as out_cents
    from dias d left join eventos e on e.day = d.day
    group by d.day
  )
  select a.day, a.in_cents, a.out_cents,
         ((select cents from saldo_inicial)
          + sum(a.in_cents - a.out_cents) over (order by a.day))::bigint
  from agregado a
  order by a.day;
$function$;


CREATE OR REPLACE FUNCTION public._upcoming_bills(uid uuid, days integer DEFAULT 30)
 RETURNS TABLE(kind text, ref_id uuid, title text, amount_cents bigint, due_date date, overdue boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select 'invoice'::text, ci.id, 'Fatura ' || a.name,
         private.invoice_open_cents(ci.id), ci.due_date,
         ci.due_date < current_date
  from public.card_invoices ci
  join public.accounts a on a.id = ci.account_id
  join public.transactions t on t.invoice_id = ci.id and t.kind = 'expense'
  where ci.workspace_id in (select public._workspace_ids(uid))
    and ci.status <> 'paid'
    and ci.due_date <= current_date + least(greatest(coalesce(days, 30), 1), 365)
  group by ci.id, a.name, ci.due_date
  union all
  select 'transaction', t.id,
         coalesce(t.description, t.category, 'Lançamento'),
         t.amount_cents, coalesce(t.due_at, t.occurred_at),
         coalesce(t.due_at, t.occurred_at) < current_date
  from public.transactions t
  where t.workspace_id in (select public._workspace_ids(uid))
    and t.status = 'pending' and t.invoice_id is null and t.kind = 'expense'
    and coalesce(t.due_at, t.occurred_at) <= current_date + least(greatest(coalesce(days, 30), 1), 365)
  union all
  -- prestação de dívida/financiamento: vence e sai da conta como qualquer conta
  select 'debt', d.id, 'Parcela ' || d.name, s.payment_cents, s.due_date,
         s.due_date < current_date
  from public.debts d
  cross join lateral private.debt_schedule_for(d.id) s
  where d.workspace_id in (select public._workspace_ids(uid))
    and not d.archived and d.remaining_cents > 0
    and s.due_date <= current_date + least(greatest(coalesce(days, 30), 1), 365)
  order by 5;
$function$;


CREATE OR REPLACE FUNCTION public.upcoming_bills(days integer DEFAULT 30)
 RETURNS TABLE(kind text, ref_id uuid, title text, amount_cents bigint, due_date date, overdue boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select 'invoice'::text, ci.id, 'Fatura ' || a.name,
         private.invoice_open_cents(ci.id), ci.due_date,
         ci.due_date < current_date
  from public.card_invoices ci
  join public.accounts a on a.id = ci.account_id
  join public.transactions t on t.invoice_id = ci.id and t.kind = 'expense'
  where ci.workspace_id in (select private.my_workspace_ids())
    and ci.status <> 'paid'
    and ci.due_date <= current_date + least(greatest(coalesce(days, 30), 1), 365)
  group by ci.id, a.name, ci.due_date
  union all
  select 'transaction', t.id,
         coalesce(t.description, t.category, 'Lançamento'),
         t.amount_cents, coalesce(t.due_at, t.occurred_at),
         coalesce(t.due_at, t.occurred_at) < current_date
  from public.transactions t
  where t.workspace_id in (select private.my_workspace_ids())
    and t.status = 'pending' and t.invoice_id is null and t.kind = 'expense'
    and coalesce(t.due_at, t.occurred_at) <= current_date + least(greatest(coalesce(days, 30), 1), 365)
  union all
  -- prestação de dívida/financiamento: vence e sai da conta como qualquer conta
  select 'debt', d.id, 'Parcela ' || d.name, s.payment_cents, s.due_date,
         s.due_date < current_date
  from public.debts d
  cross join lateral private.debt_schedule_for(d.id) s
  where d.workspace_id in (select private.my_workspace_ids())
    and not d.archived and d.remaining_cents > 0
    and s.due_date <= current_date + least(greatest(coalesce(days, 30), 1), 365)
  order by 5;
$function$;

