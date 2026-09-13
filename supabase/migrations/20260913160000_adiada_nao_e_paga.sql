-- "Adiada" não é "paga", e o rótulo do ciclo tem que dizer isso.
--
-- `faltou_pagar` excluía as faturas `rolled`, e o efeito apareceu no segundo em que o rotativo
-- do Nubank foi ligado: setembro terminou sem conseguir pagar R$ 371,64, o adiamento empurrou o
-- principal para outubro com juros, e a tela passou a anunciar **"Sobrou em setembro de 2026 —
-- R$ 0,72"**. A queixa foi literal: *"por que aqui está falando que sobrou em setembro sendo
-- que na verdade faltou pagar?"*.
--
-- `rolled` quer dizer que o dinheiro NÃO saiu da conta. Só `paid` é pago.
--
-- ⚠️ Isto NÃO mexe no caixa. `cash_events` continua ignorando a fatura adiada (o dinheiro sai
-- quando a fatura de destino for paga), então `resultado`, `saiu` e a invariante `confere` ficam
-- iguais — o que muda é só a coluna que a tela usa para escolher entre "sobrou" e "faltou".

create or replace function private.cycle_series_for(ws_ids uuid[], de date, ate date, p_view text default null)
returns table (mes date, ini date, fim date, estado text, comecei_com bigint,
               entrou bigint, saiu bigint, resultado bigint,
               caixa_no_fim bigint, faltou_pagar bigint, confere boolean)
language sql stable security invoker set search_path = public set timezone to 'America/Sao_Paulo'
as $$
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
           private.cash_total(ws_ids, j.ini - 1) caixa_antes,
           private.cash_total(ws_ids, j.fim) caixa_depois,
           coalesce((select sum(private.invoice_open_cents(ci.id)) from public.card_invoices ci
                     -- ⚠️ ADIADA conta como "faltou pagar". `rolled` significa que o dinheiro
                     -- NÃO saiu: o principal foi empurrado para a fatura seguinte, com juros.
                     -- Excluindo ela, um ciclo que terminou sem conseguir pagar a fatura passava
                     -- a anunciar "Sobrou em setembro R$ 0,72" no instante do adiamento — e foi
                     -- exatamente essa a queixa (13/09/2026). Só `paid` é pago.
                     where ci.workspace_id = any(ws_ids) and ci.status <> 'paid'
                       and ci.due_date <= j.fim), 0)::bigint em_aberto
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
         case when c.fim < current_date then c.caixa_depois = c.resultado end
  from corrente c where c.m >= de order by c.ini;
$$;
