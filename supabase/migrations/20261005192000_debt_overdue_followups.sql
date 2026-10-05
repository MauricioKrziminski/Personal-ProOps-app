-- Follow-ups da revisão de 20261005190000/20261005191000 (que sobem juntas e dependem uma da outra):
-- "faltou pagar" do ciclo fechado vê a parcela atrasada; register_counted_debt_payments usa a data e
-- o valor que o app mostra, recusa dívida sem âncora/arquivada, ignora NULL e não toca a dívida
-- quando não registra nada.

CREATE OR REPLACE FUNCTION private.cycle_series_for(ws_ids uuid[], de date, ate date, p_view text DEFAULT NULL::text)
 RETURNS TABLE(mes date, ini date, fim date, estado text, comecei_com bigint, entrou bigint, saiu bigint, resultado bigint, caixa_no_fim bigint, faltou_pagar bigint, confere boolean, entrou_realizado bigint, saiu_realizado bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
 SET "TimeZone" TO 'America/Sao_Paulo'
AS $function$
  with recursive limites as (
    select private.cycle_close_day(ws_ids, p_view) dia,
           least(de, private.cycle_month_of(private.cycle_close_day(ws_ids, p_view), current_date)) inicio
  ),
  meses as (select generate_series((select inicio from limites), ate, interval '1 month')::date m),
  janela as (
    select m.m, c.ini, c.fim, row_number() over (order by c.ini) rn
    from meses m cross join lateral private.cycle_bounds((select dia from limites), m.m) c
  ),
  fluxo as (
    select j.m, j.ini, j.fim, j.rn,
           coalesce(sum(x.in_cents),0)::bigint entrou, coalesce(sum(x.out_cents),0)::bigint saiu,
           -- O MESMO `sum`, com o filtro de `cash_events`. Nenhuma segunda definição de "já
           -- aconteceu": `realizado` é `cleared` E `paid_at <= hoje`, escrito lá.
           coalesce(sum(x.in_cents)  filter (where x.realizado),0)::bigint entrou_realizado,
           coalesce(sum(x.out_cents) filter (where x.realizado),0)::bigint saiu_realizado,
           private.cash_total(ws_ids, j.ini - 1) caixa_antes,
           private.cash_total(ws_ids, j.fim) caixa_depois,
           coalesce((select sum(private.invoice_open_cents(ci.id)) from public.card_invoices ci
                     -- ⚠️ ADIADA conta como "faltou pagar". `rolled` significa que o dinheiro
                     -- NÃO saiu: o principal foi empurrado para a fatura seguinte, com juros.
                     -- Excluindo ela, um ciclo que terminou sem conseguir pagar a fatura passava
                     -- a anunciar "Sobrou em setembro R$ 0,72" no instante do adiamento — e foi
                     -- exatamente essa a queixa (13/09/2026). Só `paid` é pago.
                     where ci.workspace_id = any(ws_ids) and ci.status <> 'paid'
                       and ci.due_date <= j.fim), 0)::bigint
           -- ⚠️ E a conta PENDENTE fora de cartão (25/09/2026): o aluguel que venceu no ciclo e
           -- não foi pago também "faltou pagar". Ele saiu de `cash_events` no ciclo fechado —
           -- contado lá, o ciclo anunciava uma saída que não houve e a conta da tela
           -- (comecei + entrou − saiu) não chegava ao "sobrou na conta".
           + coalesce((select sum(t.amount_cents) from public.transactions t
                       where t.workspace_id = any(ws_ids) and t.status = 'pending'
                         and t.kind = 'expense' and t.invoice_id is null
                         and t.rollover_of_invoice_id is null
                         and coalesce(t.due_at, t.occurred_at) <= j.fim), 0)::bigint
           -- ⚠️ E a parcela de financiamento COM ÂNCORA vencida e não paga (05/10/2026): o cronograma
           -- a mantém na data do contrato e `cash_events` a tira do ciclo fechado, então só aqui ela
           -- vira dívida daquele ciclo. Sem âncora o cronograma nunca fica no passado.
           + coalesce((select sum(s.payment_cents) from public.debts d
                       cross join lateral private.debt_schedule_for(d.id) s
                       where d.workspace_id = any(ws_ids) and not d.archived
                         and d.remaining_cents > 0 and d.first_due_date is not null
                         and s.due_date <= j.fim), 0)::bigint em_aberto
    from janela j left join lateral private.cash_events(ws_ids, j.ini, j.fim) x on true
    group by j.m, j.ini, j.fim, j.rn
  ),
  corrente as (
    select f.*, f.caixa_antes comecei, (f.caixa_antes + f.entrou - f.saiu)::bigint resultado
    from fluxo f where f.rn = 1
    union all
    select f.*,
           case when f.ini <= current_date then f.caixa_antes else c.resultado end,
           (case when f.ini <= current_date then f.caixa_antes else c.resultado end
            + f.entrou - f.saiu)::bigint
    from fluxo f join corrente c on f.rn = c.rn + 1
  )
  select c.m, c.ini, c.fim,
         case when c.fim < current_date then 'fechado'
              when c.ini > current_date then 'previsto' else 'aberto' end,
         c.comecei, c.entrou, c.saiu, c.resultado,
         case when c.fim < current_date then c.caixa_depois end,
         case when c.fim < current_date then c.em_aberto end,
         -- A invariante: num ciclo FECHADO, a soma dos eventos tem que reproduzir o caixa real.
         -- Se der falso, um movimento de dinheiro está sendo contado duas vezes ou nenhuma.
         case when c.fim < current_date then c.caixa_depois = c.resultado end,
         c.entrou_realizado, c.saiu_realizado
  from corrente c where c.m >= de order by c.ini;
$function$;

create or replace function public.register_counted_debt_payments(
  p_debt_id uuid, p_account_id uuid, p_numbers int[]
) returns int
language plpgsql security invoker
set search_path = public
set timezone to 'America/Sao_Paulo'
as $$
declare d record; k int; feitos int := 0; pagas int; saldo bigint; dt date; amt bigint;
begin
  select * into d from public.debts where id = p_debt_id for update;
  if d.id is null then raise exception 'Dívida não encontrada'; end if;
  if d.archived then raise exception 'Dívida arquivada: desarquive antes de registrar parcelas pagas'; end if;
  if d.calculation_mode <> 'fixed_installments' or d.installment_cents is null then
    raise exception 'Só financiamento de parcela fixa registra parcela já paga';
  end if;
  if d.first_due_date is null then
    raise exception 'Só financiamento com data de vencimento registra parcela já paga';
  end if;
  if p_account_id is null then raise exception 'Escolha a conta de onde a parcela saiu'; end if;
  pagas := d.installments_paid;
  saldo := d.remaining_cents;
  foreach k in array coalesce((select array_agg(distinct n order by n) from unnest(p_numbers) n where n is not null), '{}') loop
    if k < 1 or k > pagas then raise exception 'A parcela % não está entre as pagas', k; end if;
    if exists (select 1 from public.transactions t where t.debt_id = p_debt_id and t.debt_payment_no = k) then
      continue;
    end if;
    -- data e valor que o app mostra para a parcela k, lidos ANTES do recuo (que muda o cronograma)
    dt := coalesce((select h.due_date from public.debt_declared_due_dates h
                    where h.debt_id = p_debt_id and h.installment_no = k),
                   private.debt_projected_due_date(p_debt_id, k));
    amt := coalesce((select e.amount_cents from public.debt_declared_estimates e
                     where e.debt_id = p_debt_id and e.installment_no = k), d.installment_cents);
    update public.debts
       set installments_paid = k - 1,
           remaining_cents = saldo + (pagas - (k - 1)) * d.installment_cents
     where id = p_debt_id;
    insert into public.transactions
      (workspace_id, user_id, kind, amount_cents, category, description, merchant,
       account_id, occurred_at, source, status, debt_id)
    values (d.workspace_id, coalesce((select auth.uid()), d.user_id), 'expense',
            amt, coalesce(d.payment_category, 'contas'),
            coalesce(d.payment_description, 'Parcela ' || d.name), d.payment_merchant,
            p_account_id, least(dt, current_date), 'app', 'cleared', p_debt_id);
    feitos := feitos + 1;
  end loop;
  -- o gatilho deixa o par em (k, ...): volta ao que a dívida já dizia (só se algo foi lançado,
  -- senão o UPDATE vazio mexe em edit_revision/updated_at e a tela aberta acusa conflito falso)
  if feitos > 0 then
    update public.debts set installments_paid = pagas, remaining_cents = saldo where id = p_debt_id;
  end if;
  return feitos;
end;
$$;
