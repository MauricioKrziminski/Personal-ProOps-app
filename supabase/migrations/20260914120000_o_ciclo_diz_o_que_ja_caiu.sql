-- O ciclo passa a dizer quanto do total JÁ CAIU na conta.
--
-- As linhas `O que entra` / `O que sai` do Financeiro mostravam só o total PROJETADO do ciclo.
-- No dia 20, "sai R$ 8.272,53" não distingue o que já foi pago do que ainda vai vencer — e é
-- essa distinção que fazia o dono do produto abrir a planilha.
--
-- ⚠️ **Nada de aritmética nova.** `private.cash_events` já devolve `realizado boolean` desde a
-- `20260913180000` (foi a coluna que matou a contagem dupla do `spendable`). Aqui é só somar com
-- `filter`, sobre a MESMA fonte que alimenta `entrou`/`saiu` — o que garante que a sub-linha
-- nunca discorde do total em cima dela.
--
-- ⚠️ **Isto NÃO é um modo "até hoje", e o herói não muda.** As colunas novas são ADIÇÃO: o
-- painel e a Projeção continuam mostrando o ciclo inteiro com saldo acumulado. Um toggle faria o
-- mesmo card significar duas coisas conforme um estado invisível.
--
-- ⚠️ **`drop` + `create`, nunca `create or replace`**: mudar o tipo de retorno de uma função é
-- erro, não substituição. E as colunas entram DEPOIS de `confere` nas TRÊS assinaturas — os dois
-- wrappers fazem `select *` sobre um `returns table` explícito, então posição desalinhada devolve
-- coluna trocada sem erro nenhum (a armadilha do `month_summary`). Acrescentar no fim não move
-- nenhuma coluna existente.
--
-- ⚠️ **O corpo copiado é o da `20260913160000`, não o da `150000`.** A `160000` trocou o
-- predicado de `em_aberto` para `ci.status <> 'paid'` — fatura ADIADA conta como "faltou pagar",
-- porque `rolled` quer dizer que o dinheiro não saiu. Copiar a versão anterior reverteria isso em
-- silêncio, e o sintoma seria a tela voltar a anunciar "Sobrou em setembro R$ 0,72" num ciclo que
-- terminou devendo. Conferido com `pg_get_functiondef` contra o staging antes de escrever.
--
-- ⚠️ Fuso, `security` e `search_path` no CABEÇALHO, repetidos: `drop` apaga tudo, e cláusula
-- pendurada por `alter` morre no replace seguinte. O mesmo vale para os `revoke`/`grant`.

drop function if exists public.cycle_series(date, date, text);
drop function if exists public._cycle_series(uuid, date, date, text);
drop function if exists private.cycle_series_for(uuid[], date, date, text);

create function private.cycle_series_for(ws_ids uuid[], de date, ate date, p_view text default null)
returns table (mes date, ini date, fim date, estado text, comecei_com bigint,
               entrou bigint, saiu bigint, resultado bigint,
               caixa_no_fim bigint, faltou_pagar bigint, confere boolean,
               entrou_realizado bigint, saiu_realizado bigint)
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
         case when c.fim < current_date then c.caixa_depois = c.resultado end,
         c.entrou_realizado, c.saiu_realizado
  from corrente c where c.m >= de order by c.ini;
$$;

revoke execute on function private.cycle_series_for(uuid[], date, date, text) from public, anon;
grant execute on function private.cycle_series_for(uuid[], date, date, text) to authenticated, service_role;

create function public.cycle_series(de date, ate date, p_view text default null)
returns table (mes date, ini date, fim date, estado text, comecei_com bigint,
               entrou bigint, saiu bigint, resultado bigint,
               caixa_no_fim bigint, faltou_pagar bigint, confere boolean,
               entrou_realizado bigint, saiu_realizado bigint)
language sql stable security invoker set search_path = public
as $$
  select * from private.cycle_series_for(array(select private.my_workspace_ids()), de, ate, p_view);
$$;

create function public._cycle_series(uid uuid, de date, ate date, p_view text default null)
returns table (mes date, ini date, fim date, estado text, comecei_com bigint,
               entrou bigint, saiu bigint, resultado bigint,
               caixa_no_fim bigint, faltou_pagar bigint, confere boolean,
               entrou_realizado bigint, saiu_realizado bigint)
language sql stable security definer set search_path = public
as $$
  select * from private.cycle_series_for(array(select public._workspace_ids(uid)), de, ate, p_view);
$$;
revoke execute on function public._cycle_series(uuid, date, date, text) from public, anon, authenticated;
