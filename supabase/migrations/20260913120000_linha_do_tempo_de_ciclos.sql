-- A linha do tempo de ciclos — uma base de cálculo só, para qualquer janela.
--
-- Spec: docs/superpowers/specs/2026-09-13-linha-do-tempo-de-ciclos-design.md
--
-- O app tinha DUAS bases vivendo em telas diferentes: `month_lines_for` conta o cartão na data
-- da COMPRA e `_cash_flow_forecast` conta na data do PAGAMENTO. As duas navegam meses, as duas
-- respondem "como fecha o mês X", e nenhuma diz qual é qual — foi a causa medida do
-- "estou 100% perdido no app".
--
-- Aqui existe uma base só: **o dia em que o dinheiro sai da conta**. Compra no cartão entra no
-- ciclo em que a FATURA VENCE.
--
-- ⚠️ `private.cash_events` é a ÚNICA aritmética de caixa por janela. `_cash_flow_forecast`
-- continua existindo para o AGENTE e para APK antigo, e é a mesma regra escrita antes desta —
-- quando a tela nova estiver no ar e o APK velho fora de campo, ela e `forecast_json` saem.
-- Não escreva uma terceira.

-- ---------------------------------------------------------------------------------------------
-- Os eventos de caixa de uma janela qualquer — passada, atual ou futura.
--
-- ⚠️ Sem clamp em `current_date`, ao contrário de `_cash_flow_forecast`. Lá o clamp existe
-- porque a série parte do caixa de HOJE e o que venceu e não foi pago tem que aparecer hoje;
-- aqui a série parte do caixa da VÉSPERA do ciclo, então cada evento fica no dia dele. É a
-- mesma regra ancorada em outro ponto, não outra regra.
--
-- ⚠️ A fatura entra pelo TOTAL, não pelo que ficou em aberto. O que não foi pago não some: ele
-- reaparece como `faltou_pagar` no resumo, que é a decomposição do número de baixo. Entrar
-- pelo valor aberto contaria a compra parcialmente e quebraria a identidade
-- `comecei + entrou - saiu = caixa_no_fim - faltou_pagar`.
create or replace function private.cash_events(ws_ids uuid[], ini date, fim date)
returns table (day date, in_cents bigint, out_cents bigint, title text,
               origin text, ref_id uuid, method_label text)
language sql stable security definer set search_path = public set timezone to 'America/Sao_Paulo'
as $$
  -- fatura, no dia do vencimento
  select ci.due_date, 0::bigint,
         coalesce(sum(t.amount_cents), 0)::bigint,
         'Fatura ' || coalesce(a.name, 'cartão'),
         'invoice', ci.id, coalesce(a.name, 'Cartão')
  from public.card_invoices ci
  join public.accounts a on a.id = ci.account_id
  join public.transactions t on t.invoice_id = ci.id and t.kind = 'expense'
  where ci.workspace_id = any(ws_ids)
    and ci.status <> 'rolled'            -- adiada: o principal foi para a fatura seguinte
    and ci.due_date between ini and fim
  group by ci.id, ci.due_date, a.name

  union all

  -- dinheiro que sai ou entra da conta e não passa por cartão
  select coalesce(t.due_at, t.occurred_at),
         case when t.kind = 'income'  then t.amount_cents else 0 end::bigint,
         case when t.kind = 'expense' then t.amount_cents else 0 end::bigint,
         coalesce(nullif(t.description, ''), nullif(t.merchant, ''), t.category, 'Lançamento'),
         'transaction', t.id, coalesce(a.name, 'Sem conta')
  from public.transactions t
  left join public.accounts a on a.id = t.account_id
  where t.workspace_id = any(ws_ids)
    and t.kind <> 'transfer'
    and t.invoice_id is null
    and t.rollover_of_invoice_id is null
    and coalesce(t.due_at, t.occurred_at) between ini and fim

  union all

  -- parcela de financiamento: sai do CRONOGRAMA, não de `transactions`
  select s.due_date, 0::bigint, s.payment_cents,
         'Parcela ' || d.name, 'debt_schedule', d.id,
         coalesce(a.name, 'Financiamento')
  from public.debts d
  cross join lateral private.debt_schedule_for(d.id) s
  left join public.accounts a on a.id = d.account_id
  where d.workspace_id = any(ws_ids)
    and not d.archived and d.remaining_cents > 0
    and s.due_date between ini and fim
    and not private.debt_paid_in_month(d.id, s.due_date)

  union all

  -- recorrente além do horizonte materializado
  select p.due_date,
         case when p.kind = 'income'  then p.amount_cents else 0 end::bigint,
         case when p.kind = 'expense' then p.amount_cents else 0 end::bigint,
         p.description, 'recurring_projection', p.recurring_id,
         coalesce(a.name, 'Sem conta')
  from private.recurring_projection_for(ws_ids, ini, fim) p
  left join public.accounts a on a.id = p.account_id;
$$;
revoke execute on function private.cash_events(uuid[], date, date) from public, anon;

-- ---------------------------------------------------------------------------------------------
-- O resumo de um ciclo.
--
-- `faltou_pagar` só existe em ciclo FECHADO, e é a diferença entre o caixa que de fato ficou e
-- o que o ciclo dizia que ia ficar. Regra do dono do produto (13/09/2026): *"se eu não paguei
-- nada com esse saldo, o saldo na conta permanece exatamente na conta e o que faltou pagar
-- continua faltando pagar"* — saldo em conta não abate dívida sozinho.
create or replace function private.cycle_summary_for(ws_ids uuid[], p_month date, p_view text default null)
returns table (ini date, fim date, estado text, comecei_com bigint, entrou bigint, saiu bigint,
               resultado bigint, caixa_no_fim bigint, faltou_pagar bigint)
language sql stable security definer set search_path = public set timezone to 'America/Sao_Paulo'
as $$
  with b as (
    select c.ini, c.fim from private.cycle_bounds(private.cycle_close_day(ws_ids, p_view), p_month) c
  ),
  e as (
    select coalesce(sum(x.in_cents), 0)::bigint entrou, coalesce(sum(x.out_cents), 0)::bigint saiu
    from b, private.cash_events(ws_ids, b.ini, b.fim) x
  ),
  s as (
    select b.ini, b.fim,
           case when b.fim < current_date then 'fechado'
                when b.ini > current_date then 'previsto'
                else 'aberto' end as estado,
           private.cash_total(ws_ids, b.ini - 1) as comecei_com,
           e.entrou, e.saiu
    from b, e
  )
  select s.ini, s.fim, s.estado, s.comecei_com, s.entrou, s.saiu,
         (s.comecei_com + s.entrou - s.saiu)::bigint,
         case when s.estado = 'fechado' then private.cash_total(ws_ids, s.fim) end,
         case when s.estado = 'fechado'
              then (private.cash_total(ws_ids, s.fim) - (s.comecei_com + s.entrou - s.saiu))::bigint
         end
  from s;
$$;
revoke execute on function private.cycle_summary_for(uuid[], date, text) from public, anon;

-- ---------------------------------------------------------------------------------------------
-- Portas: interna (agente, com o uid resolvido) e wrapper (app, sob RLS).
-- Padrão duplo de `.claude/rules/supabase.md`: o wrapper NÃO chama a interna — EXECUTE é
-- checado contra o role do chamador, e a interna é revogada de `authenticated`.
create or replace function public._cycle_summary(uid uuid, p_month date, p_view text default null)
returns table (ini date, fim date, estado text, comecei_com bigint, entrou bigint, saiu bigint,
               resultado bigint, caixa_no_fim bigint, faltou_pagar bigint)
language sql stable security definer set search_path = public
as $$
  select * from private.cycle_summary_for(array(select public._workspace_ids(uid)), p_month, p_view);
$$;
revoke execute on function public._cycle_summary(uuid, date, text) from public, anon, authenticated;

create or replace function public.cycle_summary(p_month date, p_view text default null)
returns table (ini date, fim date, estado text, comecei_com bigint, entrou bigint, saiu bigint,
               resultado bigint, caixa_no_fim bigint, faltou_pagar bigint)
language sql stable security invoker set search_path = public
as $$
  select * from private.cycle_summary_for(array(select private.my_workspace_ids()), p_month, p_view);
$$;

-- As linhas do ciclo, para os recortes da tela.
create or replace function public.cycle_lines(p_month date, p_view text default null)
returns table (day date, in_cents bigint, out_cents bigint, title text,
               origin text, ref_id uuid, method_label text)
language sql stable security invoker set search_path = public
as $$
  select x.* from private.cycle_bounds(
      private.cycle_close_day(array(select private.my_workspace_ids()), p_view), p_month) b
  cross join lateral private.cash_events(array(select private.my_workspace_ids()), b.ini, b.fim) x
  order by x.day, x.out_cents desc;
$$;

create or replace function public._cycle_lines(uid uuid, p_month date, p_view text default null)
returns table (day date, in_cents bigint, out_cents bigint, title text,
               origin text, ref_id uuid, method_label text)
language sql stable security definer set search_path = public
as $$
  select x.* from private.cycle_bounds(
      private.cycle_close_day(array(select public._workspace_ids(uid)), p_view), p_month) b
  cross join lateral private.cash_events(array(select public._workspace_ids(uid)), b.ini, b.fim) x
  order by x.day, x.out_cents desc;
$$;
revoke execute on function public._cycle_lines(uuid, date, text) from public, anon, authenticated;

-- ⚠️ `private.cash_events` é `security invoker` por dentro? NÃO — ela é definer, e por isso o
-- `execute` para `authenticated` precisa existir: `cycle_summary`/`cycle_lines` são invoker e a
-- chamada aninhada usa o privilégio de quem chamou. Foi exatamente o `42501 permission denied`
-- que derrubou a Hoje e a Projeção em 11/09/2026 (par de migrations 200000/220000).
grant execute on function private.cash_events(uuid[], date, date) to authenticated;
grant execute on function private.cycle_summary_for(uuid[], date, text) to authenticated;
