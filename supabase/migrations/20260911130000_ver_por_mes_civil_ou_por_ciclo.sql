-- Ver por MÊS CIVIL ou por CICLO passa a ser escolha, não configuração de mão única.
--
-- A `20260911020000` deu ao usuário um dia de fechamento e, com isso, FIXOU a régua: quem
-- configurou o dia 10 passou a ver 11/08–10/09 em todo lugar, sem caminho de volta que não fosse
-- apagar a configuração. A queixa do dono do produto (11/09/2026) foi essa: *"permita ele
-- escolher se ele quer ver do ciclo ou do mês ao invés de fixar"*.
--
-- ## Por que é UMA preferência e não um controle por tela
--
-- A Projeção já tem um `Segmented` escrito **Dia | Mês**. Um segundo controle escrito
-- **Mês | Ciclo** na mesma tela poria a mesma palavra em dois lugares significando coisas
-- diferentes — granularidade num, régua no outro —, que é exatamente o "rótulos diferentes para
-- a mesma intenção: 0" do `design.md` §10 ao contrário. E a frase que originou o ciclo
-- (*"eu não quero olhar para o mês do dia 1 ao 31"*) descreve uma PESSOA, não uma tela.
--
-- ## Por que o ponto de aplicação é `cycle_close_day()` e não um parâmetro novo
--
-- As quatro leituras que seguem o ciclo (`month_lines_for`, `month_summary_for`,
-- `monthly_lines_range`, `month_forecast_json`) já perguntam o dia de fechamento a esta função.
-- Fazer ela devolver `null` no modo civil reaproveita o caminho que JÁ existe para
-- "usuário sem ciclo configurado" — `cycle_bounds(null, m)` e `cycle_month_of(null, d)` são
-- literalmente `date_trunc('month', ...)`. Zero função nova, zero argumento novo em cinco
-- assinaturas, e nenhuma segunda implementação de "onde o mês começa" para divergir depois.

alter table public.workspaces
  add column if not exists cycle_view text not null default 'cycle'
    check (cycle_view in ('cycle', 'civil'));

comment on column public.workspaces.cycle_view is
  'Régua de LEITURA: "cycle" usa cycle_close_day, "civil" usa o mês do dia 1 ao último. '
  'Default "cycle" para quem já configurou o dia não ver mudança nenhuma. Com '
  'cycle_close_day null os dois modos são idênticos — por isso o app só oferece a troca '
  'depois de haver um dia configurado.';

-- Agora ela responde "qual régua vale", não "qual dia está gravado". Continua ordenada por id
-- para ser determinística com múltiplos workspaces (o caso normal é um só).
create or replace function private.cycle_close_day(ws_ids uuid[])
returns int
language sql stable set search_path = public as $$
  select case when w.cycle_view = 'civil' then null else w.cycle_close_day end
  from public.workspaces w
  where w.id = any(ws_ids) order by w.id limit 1;
$$;

-- ---------------------------------------------------------------------------------------------
-- O orçamento era a leitura que FALTAVA seguir o ciclo — e falhava calada.
--
-- As outras quatro migraram na `20260911021000`; esta ficou em `date_trunc('month', ...)`. Na
-- tela do Financeiro o painel de cima somava 11/08–10/09 e o bloco de orçamento logo abaixo
-- somava 01–30/09, os dois rotulados "setembro": mesmo conceito (competência), duas réguas, um
-- rótulo só. Na Hoje e no badge da dock era pior — `useBudgetsStatus()` manda HOJE, e no dia
-- 11/09 o ciclo corrente já se chama outubro enquanto o orçamento respondia por setembro.
--
-- ⚠️ **`ref_month` é um DIA qualquer do período, não o rótulo.** A Hoje manda `current_date`; o
-- Financeiro manda `<rótulo>-01`. Quem traduz dia → rótulo é `cycle_month_of`, e é por isso que
-- ela vem antes de `cycle_bounds` aqui.
--
-- ⚠️ **`budgets.month` é o RÓTULO, `occurred_at` é a JANELA, e com ciclo os dois deixam de ser o
-- mesmo valor.** Com fechamento no dia 10 o rótulo de setembro é `01/09` e a janela é
-- 11/08–10/09. Comparar `b.month = janela.inicio` gravaria o override do mês no dia 11 do mês
-- anterior e nenhuma linha casaria — o limite personalizado simplesmente sumiria da tela.
create or replace function private.budgets_status_for(ws_ids uuid[], ref_month date)
returns table (
  category text, limit_cents bigint, spent_cents bigint, committed_cents bigint,
  base_limit_cents bigint, rollover_cents bigint, rollover boolean, month date
)
language sql stable set search_path = public as $$
  with regua as (
    select private.cycle_close_day(ws_ids) as close_day
  ),
  rotulos as (
    select r.close_day,
           private.cycle_month_of(r.close_day, ref_month) as rotulo,
           (private.cycle_month_of(r.close_day, ref_month) - interval '1 month')::date as rotulo_anterior
    from regua r
  ),
  mes as (
    select t.rotulo,
           t.rotulo_anterior,
           b.ini as inicio,
           (b.fim + 1) as fim,          -- exclusivo, como era com `+ interval '1 month'`
           a.ini as anterior             -- ciclos são contíguos: o anterior termina em `inicio`
    from rotulos t
    cross join lateral private.cycle_bounds(t.close_day, t.rotulo) b
    cross join lateral private.cycle_bounds(t.close_day, t.rotulo_anterior) a
  ),
  efetivos as (
    select distinct on (b.category)
           b.category, b.limit_cents, b.rollover, b.month
    from public.budgets b, mes m
    where b.workspace_id = any(ws_ids)
      and (b.month is null or b.month = m.rotulo)
    order by b.category, b.month nulls last
  ),
  gasto as (
    select coalesce(t.category, 'outros') as category,
           -- JÁ ACONTECEU: efetivado, ou parcela de cartão (a compra foi feita)
           coalesce(sum(t.amount_cents) filter (
             where t.status = 'cleared' or t.invoice_id is not null), 0)::bigint as cents,
           -- AINDA PODE NÃO ACONTECER: previsto fora de fatura
           coalesce(sum(t.amount_cents) filter (
             where t.status = 'pending' and t.invoice_id is null), 0)::bigint as previsto
    from public.transactions t, mes m
    where t.workspace_id = any(ws_ids)
      and t.kind = 'expense'
      -- dívida que mudou de fatura já comeu o orçamento no mês da compra
      and t.rollover_of_invoice_id is null
      and t.occurred_at >= m.inicio and t.occurred_at < m.fim
    group by 1
  ),
  gasto_anterior as (
    -- O rollover olha o ciclo FECHADO, e ali "já aconteceu" é a mesma régua: um boleto de agosto
    -- que nunca foi pago não pode consumir a sobra que vai para setembro.
    select coalesce(t.category, 'outros') as category,
           coalesce(sum(t.amount_cents) filter (
             where t.status = 'cleared' or t.invoice_id is not null), 0)::bigint as cents
    from public.transactions t, mes m
    where t.workspace_id = any(ws_ids)
      and t.kind = 'expense'
      and t.rollover_of_invoice_id is null
      and t.occurred_at >= m.anterior and t.occurred_at < m.inicio
    group by 1
  ),
  limite_anterior as (
    select distinct on (b.category) b.category, b.limit_cents
    from public.budgets b, mes m
    where b.workspace_id = any(ws_ids)
      and (
        -- override daquele mes: existia por definicao
        b.month = m.rotulo_anterior
        -- limite padrao: so vale se ja existia antes deste ciclo comecar
        or (b.month is null and b.created_at < m.inicio)
      )
    order by b.category, b.month nulls last
  )
  select e.category,
         (e.limit_cents + case
            when e.rollover then greatest(
              coalesce(la.limit_cents, 0) - coalesce(ga.cents, 0), 0)
            else 0 end)::bigint as limit_cents,
         coalesce(g.cents, 0)::bigint as spent_cents,
         coalesce(g.previsto, 0)::bigint as committed_cents,
         e.limit_cents as base_limit_cents,
         (case when e.rollover then greatest(
            coalesce(la.limit_cents, 0) - coalesce(ga.cents, 0), 0)
         else 0 end)::bigint as rollover_cents,
         e.rollover,
         e.month
  from efetivos e
  left join gasto g on g.category = e.category
  left join gasto_anterior ga on ga.category = e.category
  left join limite_anterior la on la.category = e.category
  order by 3 desc;
$$;

-- ---------------------------------------------------------------------------------------------
-- `cycle_now` passa a responder DUAS coisas que antes eram a mesma.
--
-- `de`/`ate`/`mes`/`diasAteOFim` seguem saindo da régua ATIVA (via `private.cycle_close_day`,
-- que agora devolve null no modo civil) — é o que o painel e a projeção consomem.
--
-- ⚠️ **`closeDay` continua sendo o dia CONFIGURADO, não o ativo.** Os dois consumidores dele são
-- a grade de 28 dias do onboarding e a do Perfil, e as duas precisam mostrar o dia que o usuário
-- escolheu mesmo quando ele está vendo por mês civil. Se ele virasse null no modo civil, abrir o
-- Perfil depois de trocar a régua mostraria "Último dia do mês" — apagando a configuração na
-- tela sem ninguém ter pedido, e um toque em "Ciclo" depois disso não teria para onde voltar.
create or replace function public.cycle_now()
returns jsonb
language sql stable set search_path = public as $$
  with ws as (select array(select private.my_workspace_ids()) as ids),
  cru as (
    -- `in (select ...)` e não `any((select ids from ws))`: aquele compara uuid com uuid[] e o
    -- Postgres recusa com 42883 — a CTE devolve UMA LINHA cujo valor é o array, não um conjunto.
    select w.cycle_close_day as dia, w.cycle_view as modo
    from public.workspaces w
    where w.id in (select private.my_workspace_ids()) order by w.id limit 1
  ),
  cfg as (select private.cycle_close_day((select ids from ws)) as dia),
  atual as (
    select private.cycle_month_of((select dia from cfg), current_date) as mes
  ),
  b as (
    select * from private.cycle_bounds((select dia from cfg), (select mes from atual))
  )
  select jsonb_build_object(
    'closeDay', (select dia from cru),
    'view', coalesce((select modo from cru), 'cycle'),
    'mes', to_char((select mes from atual), 'YYYY-MM'),
    'de', (select ini from b),
    'ate', (select fim from b),
    -- piso 1: no ÚLTIMO dia do ciclo a projeção ainda precisa de uma janela para existir, e
    -- pedir 0 dias devolveria a série vazia e um painel sem número.
    'diasAteOFim', greatest(1, (select fim from b) - current_date)
  );
$$;
