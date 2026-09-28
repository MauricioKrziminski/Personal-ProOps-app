-- A ocorrência PREVISTA de uma recorrente vira lançamento quando a pessoa age sobre ela, e a
-- leitura de previstas deixa de mostrar o que não existe.
--
-- Lançamentos mistura por data o que já é linha (`transactions`) e o que só existe na regra
-- (`ledger_expected_lines`), e a pessoa quer tocar, ver o detalhe e dar "Paguei" nas duas do
-- mesmo jeito (28/09/2026, decisão do dono do produto). Em produção a recorrente vira linha em
-- até um minuto pelo agendador; no staging (sem agendador), além do horizonte de um ano e
-- nesse minuto, ela só existia calculada e o toque não fazia nada.

-- ── 1. A leitura só mostra o que o agendador ainda NÃO decidiu ────────────────────────────────
--
-- `expected_recurring_occurrences` (20260928200010) escondia um dia só quando havia linha da
-- série naquela DATA. Três fantasmas passavam, cada um uma cobrança em dobro na tela (e, com o
-- toque, no banco):
--   * trocado o dia da série (8 → 9), o dia 8 do mês aparecia ao lado da linha movida para o 9;
--   * a linha com `occurred_at` 04/09 e vencimento 30/09 (o Fundacred) deixava o 30/09 previsto;
--   * a ocorrência apagada voltava, porque a data ficava sem linha.
-- As duas réguas que o agendador e `update_recurring_series` já usam fecham os três:
--   * no trecho que o agendador GEROU — da primeira linha da série até `materialized_until` — o
--     dia sem linha foi apagado ou movido de propósito (a régua de `recurring_projection_for`).
--     Antes da primeira linha é história que o agendador nunca escreveu (a estimativa depois de um
--     "Todos"), e ela continua aparecendo;
--   * um período (mês, semana, ano) com a cobrança da série não ganha outra — "o período já tem
--     a sua cobrança", pelo vencimento fora do cartão e pela data no cartão.
-- Limite conhecido: uma ocorrência movida para o mês seguinte esconde a prevista daquele mês. Só
-- pesa onde não há agendador (staging) ou além do horizonte.

create or replace function public.expected_recurring_occurrences(
  p_from date,p_to date,p_recurring_id uuid default null
) returns table(id uuid,recurring_id uuid,due_date date,amount_cents bigint,
  kind text,description text,category text,account_id uuid,inferred_start boolean)
language plpgsql stable security invoker
set search_path = public, pg_temp
as $$
begin
  if p_from is null or p_to is null or p_to<p_from or p_to-p_from>61 then
    raise exception 'Informe uma janela de no máximo 62 dias';
  end if;
  return query
    select (md5(v.recurring_id::text||':'||d.due_date::text))::uuid,
      v.recurring_id,d.due_date,v.amount_cents,v.kind,
      coalesce(nullif(v.description,''),v.category,'Recorrente'),
      coalesce(v.category,'outros'),v.account_id,
      v.inferred_before is not null and d.due_date<v.inferred_before
    from private.recurring_history_versions v
    join public.recurring_transactions r on r.id=v.recurring_id
      and r.workspace_id=v.workspace_id
    left join public.profiles p on p.id=r.user_id
    cross join lateral private.recurring_dates_for(v.rrule,v.anchor_date,
      greatest(p_from,v.valid_from),least(p_to,coalesce(v.valid_through,p_to))) d
    cross join lateral (select case when v.rrule like 'FREQ=WEEKLY%' then 'week'
      when v.rrule like 'FREQ=YEARLY%' then 'year' else 'month' end as periodo,
      (r.materialized_until at time zone coalesce(p.timezone,'America/Sao_Paulo'))::date as gerado_ate,
      (select min(t.occurred_at) from public.transactions t
        where t.recurring_id=r.id and t.workspace_id=r.workspace_id) as gerado_desde) pr
    where v.workspace_id in (select private.my_workspace_ids())
      and (p_recurring_id is null or v.recurring_id=p_recurring_id)
      and v.valid_from<=p_to and coalesce(v.valid_through,p_to)>=p_from
      and r.active and (v.end_date is null or d.due_date<=v.end_date)
      and not coalesce(d.due_date between pr.gerado_desde and pr.gerado_ate, false)
      and not exists(select 1 from public.transactions t
        where t.workspace_id=v.workspace_id and t.recurring_id=v.recurring_id
          and date_trunc(pr.periodo, case when t.invoice_id is null
                then coalesce(t.due_at,t.occurred_at) else t.occurred_at end)
            = date_trunc(pr.periodo, d.due_date))
      and not exists(select 1 from private.recurring_moved_occurrences m
        where m.recurring_id=v.recurring_id and m.original_date=d.due_date)
    order by d.due_date,v.recurring_id;
end;
$$;
revoke execute on function public.expected_recurring_occurrences(date,date,uuid) from public,anon;
grant execute on function public.expected_recurring_occurrences(date,date,uuid) to authenticated;

-- ── 2. O toque grava a linha que o agendador gravaria ────────────────────────────────────────
--
-- ⚠️ **Não calcula data.** Quem diz se o dia é uma ocorrência é a leitura acima (o mesmo
-- expansor da lista); aqui só se confere e se grava, espelhando o INSERT do agendador
-- (`agent/app/jobs/scheduler.py`): mesmos campos, `occurred_at = due_at = dia`,
-- `source = 'recurring'`, `cleared` só no passado com `auto_confirm`, e a "gêmea" solta do mesmo
-- dia é ADOTADA em vez de duplicada (`_adotar_gemea`). A estimativa retroativa não prova que a
-- cobrança existiu: não vira lançamento.
--
-- Idempotente pelo unique parcial `(recurring_id, occurred_at)`: dois toques, ou o toque e o
-- agendador, dão a MESMA linha. A série fica travada (`for share`) contra uma troca de
-- calendário no meio.

create or replace function public.materialize_recurring_occurrence(
  p_recurring_id uuid, p_date date
) returns uuid
language plpgsql volatile security invoker
set search_path = public
set timezone to 'America/Sao_Paulo'
as $$
declare
  achado uuid;
  prevista record;
  serie public.recurring_transactions%rowtype;
begin
  if p_recurring_id is null or p_date is null then
    raise exception 'Informe a recorrente e o dia';
  end if;
  select * into serie from public.recurring_transactions r where r.id = p_recurring_id for share;
  if serie.id is null then
    raise exception 'Essa ocorrência não existe mais na recorrente.' using errcode = 'P0001';
  end if;

  select t.id into achado from public.transactions t
   where t.recurring_id = p_recurring_id and t.occurred_at = p_date;
  if achado is not null then
    return achado;
  end if;

  select * into prevista
    from public.expected_recurring_occurrences(p_date, p_date, p_recurring_id) e
   where e.due_date = p_date
   limit 1;
  if not found then
    raise exception 'Essa ocorrência não existe mais na recorrente.' using errcode = 'P0001';
  end if;
  if prevista.inferred_start then
    raise exception 'Essa data é uma estimativa da recorrente: não vira lançamento.' using errcode = 'P0001';
  end if;

  if p_date <= current_date then
    update public.transactions t set recurring_id = serie.id
     where t.id = (
       select g.id from public.transactions g
        where g.workspace_id = serie.workspace_id and g.recurring_id is null
          and g.kind = prevista.kind and g.amount_cents = prevista.amount_cents
          and g.account_id is not distinct from prevista.account_id and g.occurred_at = p_date
          and extensions.unaccent(lower(coalesce(g.description, '')))
            = extensions.unaccent(lower(coalesce(serie.description, '')))
        order by g.created_at
        limit 1)
    returning t.id into achado;
    if achado is not null then
      return achado;
    end if;
  end if;

  insert into public.transactions
    (user_id, workspace_id, kind, amount_cents, currency, category, description, merchant,
     account_id, occurred_at, due_at, source, status, recurring_id, auto_confirm)
  values
    (serie.user_id, serie.workspace_id, prevista.kind, prevista.amount_cents, serie.currency,
     -- a leitura preenche o vazio ('outros', 'Recorrente'); a linha guarda o que a série guarda
     case when prevista.category = coalesce(serie.category, 'outros') then serie.category
          else prevista.category end,
     case when prevista.description = coalesce(nullif(serie.description, ''), serie.category, 'Recorrente')
          then serie.description else prevista.description end,
     serie.merchant, prevista.account_id, p_date, p_date, 'recurring',
     case when p_date <= current_date and serie.auto_confirm then 'cleared' else 'pending' end,
     serie.id, serie.auto_confirm)
  on conflict (recurring_id, occurred_at) where recurring_id is not null do nothing
  returning id into achado;

  if achado is null then
    select t.id into achado from public.transactions t
     where t.recurring_id = p_recurring_id and t.occurred_at = p_date;
  end if;
  if achado is null then
    raise exception 'Não consegui abrir essa ocorrência.';
  end if;
  return achado;
end;
$$;
revoke execute on function public.materialize_recurring_occurrence(uuid, date) from public, anon;
grant execute on function public.materialize_recurring_occurrence(uuid, date) to authenticated;

-- ── 3. Apagar uma ocorrência (gravada ou prevista) não a traz de volta ───────────────────────
--
-- A data apagada entra na mesma lista que o "Só esta" já usa para a data original de uma
-- ocorrência movida (`private.recurring_moved_occurrences`), e o agendador passa a respeitá-la.
--
-- ⚠️ **Refazer o calendário também apaga**, e ali o dia NÃO pode ficar marcado: a regra nova
-- pode cair nele de novo. `update_recurring_series` (a porta que refaz o calendário) grava a
-- série ANTES de apagar as em aberto, então quem apaga sabe que a série mudou nesta transação
-- pela marca abaixo (`set_config(..., true)`, que vive até o fim da transação). Limite: qualquer
-- UPDATE da série na transação desliga a marcação — um RPC futuro que "atualiza a série e apaga
-- só esta" precisa marcar a data por conta própria.

create or replace function private.marca_serie_editada()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform set_config('proops.series_editadas',
    coalesce(current_setting('proops.series_editadas', true), '') || new.id::text || ',', true);
  return null;
end;
$$;
revoke execute on function private.marca_serie_editada() from public, anon, authenticated;

drop trigger if exists marca_serie_editada on public.recurring_transactions;
create trigger marca_serie_editada
  after update on public.recurring_transactions
  for each row execute function private.marca_serie_editada();

create or replace function private.ocorrencia_apagada_nao_volta()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.recurring_id is not null
     and position(old.recurring_id::text in coalesce(current_setting('proops.series_editadas', true), '')) = 0
     -- apagando a série inteira, as futuras saem por `recurring_drop_future` e a marca some no
     -- cascade; o workspace é conferido porque a FK não o garante (o cuidado de `recurring_drop_future`)
     and exists (select 1 from public.recurring_transactions r
                  where r.id = old.recurring_id and r.workspace_id = old.workspace_id) then
    insert into private.recurring_moved_occurrences (recurring_id, workspace_id, original_date)
    values (old.recurring_id, old.workspace_id, old.occurred_at)
    on conflict do nothing;
  end if;
  return null;
end;
$$;
revoke execute on function private.ocorrencia_apagada_nao_volta() from public, anon, authenticated;

drop trigger if exists ocorrencia_apagada_nao_volta on public.transactions;
create trigger ocorrencia_apagada_nao_volta
  after delete on public.transactions
  for each row execute function private.ocorrencia_apagada_nao_volta();

-- "Apagar" na prevista: só a marca, sem criar e apagar uma linha (duas escritas que, falhando a
-- segunda, deixariam uma cobrança real no lugar).
create or replace function public.skip_recurring_occurrence(p_recurring_id uuid, p_date date)
returns void
language plpgsql
security definer
set search_path = public
set timezone to 'America/Sao_Paulo'
as $$
declare
  ws uuid;
begin
  select r.workspace_id into ws from public.recurring_transactions r
   where r.id = p_recurring_id and r.workspace_id in (select private.my_workspace_ids())
   for share;
  if ws is null or p_date is null then
    raise exception 'Essa ocorrência não existe mais na recorrente.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.transactions t where t.recurring_id = p_recurring_id and t.occurred_at = p_date) then
    raise exception 'Essa ocorrência já é um lançamento: apague pelo lançamento.' using errcode = 'P0001';
  end if;
  insert into private.recurring_moved_occurrences (recurring_id, workspace_id, original_date)
  values (p_recurring_id, ws, p_date)
  on conflict do nothing;
end;
$$;
revoke execute on function public.skip_recurring_occurrence(uuid, date) from public, anon;
grant execute on function public.skip_recurring_occurrence(uuid, date) to authenticated;
