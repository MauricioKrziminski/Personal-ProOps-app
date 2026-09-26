-- A série recorrente se edita INTEIRA (26/09/2026).
--
-- Visto em produção: o Fundacred foi cadastrado no dia 4 e vence no último dia do mês, e a edição
-- da série não deixava mudar a data — "Repete", "A cada quantos meses", o dia e o "Tipo" só
-- existiam ao criar. A regra antiga dizia "mudar a cadência é apagar e criar de novo"; o dono do
-- produto pediu o contrário: *"ter todos os campos de quando eu crio ao editar, podendo editar
-- tudo"*.
--
-- 1. `merchant` na série. O "Repetir lançamento" perdia o estabelecimento: a série não tinha onde
--    guardá-lo, e toda ocorrência nascia sem ele. O agendador (`jobs/scheduler.py`) passa a
--    copiá-lo; sem o agente novo a ocorrência só nasce sem estabelecimento, como antes.
-- 2. `update_recurring_series` aceita `kind`, `merchant` e o CALENDÁRIO (`rrule` + `next_run_at`,
--    sempre juntos). Mudar o calendário refaz as ocorrências FUTURAS em aberto: as `pending` de
--    hoje em diante saem, a âncora (`dtstart`) passa a ser o próximo vencimento e
--    `materialized_until` volta a nulo — o agendador gera de novo pela regra nova (de hora em hora
--    em produção). Só saem as em aberto a partir do PERÍODO (semana, mês, ano) do próximo
--    vencimento: a de um mês anterior a ele é outra conta, e ninguém a gera de novo. Até lá a projeção lê a regra só no mensal simples (`recurring_projection_for`):
--    reagendada para semanal, anual ou "a cada N meses", a série some da projeção até a rodada.
--    A ocorrência que FICA (paga, atrasada, compra de cartão já feita) segura o calendário: o
--    próximo vencimento vem num período depois dela — senão aquele mês ganharia uma segunda
--    cobrança. O caso é o Fundacred: setembro pago com vencimento 30/09, e "próximo em 30/09"
--    criaria outro setembro. O passado e a ocorrência atrasada não mudam
--    ("o passado só muda à mão"); a paga adiantada (`cleared`) também fica.
--    ⚠️ "Futura em aberto" é pelo VENCIMENTO fora do cartão: o Fundacred de setembro tinha data
--    04/09 e vencimento 30/09 — pela data ele ficaria, e o agendador criaria outro 30/09 ao lado.
--    No cartão `due_at` é o vencimento da FATURA, e a compra de ontem já aconteceu: lá vale a data.
-- 3. Encurtar o "Termina em" tira as ocorrências futuras em aberto depois do fim. Antes elas
--    ficavam pesando na projeção de uma série que já tinha acabado.
--
-- A regra aceita é a que o app monta (`montaRRule`): mensal no dia N ou no último dia (-1), com
-- INTERVAL opcional; semanal num dia; anual num dia e mês. As faixas são as do calendário:
-- INTERVAL=0 prende o agendador num laço, BYMONTHDAY=0 gera uma linha por dia.
-- 4. `update_transaction_scoped` ("esta e as próximas") grava o estabelecimento também na SÉRIE:
--    sem isso as ocorrências mudavam e a regra seguia gerando o nome velho. Fuso no CABEÇALHO: `create or replace`
-- apaga o `set timezone` que a `20260911030000` pendurou por `alter`.
-- Teste: `supabase/tests/serie_recorrente_edita_tudo.sql`.

alter table public.recurring_transactions add column if not exists merchant text;

create or replace function public.update_recurring_series(
  p_recurring_id uuid,
  p_patch jsonb,
  p_propagate boolean default true
)
returns bigint
language plpgsql
security invoker
set search_path = public
set timezone to 'America/Sao_Paulo'
as $$
declare
  serie   record;
  changed bigint := 0;
  proxima timestamptz;
  fica    record;
  periodo text;
begin
  if p_patch is null or p_patch = '{}'::jsonb then
    raise exception 'Nada para alterar';
  end if;
  if exists (
    select 1 from unnest(array(select jsonb_object_keys(p_patch))) k
    where k not in ('amount_cents', 'category', 'description', 'account_id',
                    'auto_confirm', 'end_date', 'kind', 'merchant', 'rrule', 'next_run_at')
  ) then
    raise exception 'Campo não permitido nesta alteração';
  end if;
  if p_patch ? 'amount_cents'
     and coalesce((p_patch->>'amount_cents')::bigint, 0) <= 0 then
    raise exception 'O valor precisa ser maior que zero';
  end if;
  if p_patch ? 'kind' and coalesce(p_patch->>'kind', '') not in ('expense', 'income') then
    raise exception 'A série é de saída ou de entrada';
  end if;
  if (p_patch ? 'rrule') <> (p_patch ? 'next_run_at') then
    raise exception 'A repetição e o próximo vencimento mudam juntos';
  end if;
  if p_patch ? 'rrule' then
    if coalesce(p_patch->>'rrule', '') !~ '^FREQ=(MONTHLY(;INTERVAL=([2-9]|[1-9][0-9]))?;BYMONTHDAY=(-1|[1-9]|[12][0-9]|3[01])|WEEKLY;BYDAY=(SU|MO|TU|WE|TH|FR|SA)|YEARLY;BYMONTH=([1-9]|1[0-2]);BYMONTHDAY=([1-9]|[12][0-9]|3[01]))$' then
      raise exception 'Repetição inválida: use mensal, semanal ou anual';
    end if;
    proxima := (p_patch->>'next_run_at')::timestamptz;
    if proxima is null or proxima::date < current_date then
      raise exception 'O próximo vencimento não pode ser antes de hoje';
    end if;
  end if;

  select r.id, r.workspace_id into serie
  from public.recurring_transactions r where r.id = p_recurring_id
  for update;
  if serie.id is null then
    raise exception 'Recorrência não encontrada';
  end if;

  if p_patch ? 'rrule' then
    periodo := case when p_patch->>'rrule' like 'FREQ=WEEKLY%' then 'week'
                    when p_patch->>'rrule' like 'FREQ=YEARLY%' then 'year' else 'month' end;
    -- A mais recente das que FICAM (tudo menos a em aberto que ainda não venceu). O dia dela é o
    -- vencimento fora do cartão; no cartão, a data da compra.
    select x.dia, x.status into fica
    from (
      select case when t.invoice_id is null then coalesce(t.due_at, t.occurred_at) else t.occurred_at end as dia,
             t.status
      from public.transactions t
      where t.recurring_id = serie.id and t.workspace_id = serie.workspace_id
        and not (t.status = 'pending'
                 and (t.occurred_at >= current_date or (t.invoice_id is null and t.due_at >= current_date)))
    ) x
    order by x.dia desc
    limit 1;
    if fica.dia is not null and date_trunc(periodo, proxima::date) <= date_trunc(periodo, fica.dia) then
      raise exception 'A de % %: o próximo vencimento vem depois dela', to_char(fica.dia, 'DD/MM/YYYY'),
        case when fica.status = 'cleared' then 'já está paga' else 'ainda está em aberto' end;
    end if;
  end if;

  if p_patch ? 'account_id' and p_patch->>'account_id' is not null and not exists (
    select 1 from public.accounts a
    where a.id = (p_patch->>'account_id')::uuid and a.workspace_id = serie.workspace_id
  ) then
    raise exception 'Conta precisa ser do mesmo workspace da série';
  end if;

  update public.recurring_transactions r set
    amount_cents = coalesce((p_patch->>'amount_cents')::bigint, r.amount_cents),
    category     = case when p_patch ? 'category'     then p_patch->>'category'     else r.category end,
    description  = case when p_patch ? 'description'  then p_patch->>'description'  else r.description end,
    merchant     = case when p_patch ? 'merchant'     then nullif(p_patch->>'merchant', '') else r.merchant end,
    kind         = case when p_patch ? 'kind'         then p_patch->>'kind'         else r.kind end,
    account_id   = case when p_patch ? 'account_id'   then (p_patch->>'account_id')::uuid else r.account_id end,
    auto_confirm = case when p_patch ? 'auto_confirm' then (p_patch->>'auto_confirm')::boolean else r.auto_confirm end,
    end_date     = case when p_patch ? 'end_date'     then (p_patch->>'end_date')::date else r.end_date end,
    rrule        = case when p_patch ? 'rrule'        then p_patch->>'rrule'        else r.rrule end,
    dtstart      = case when p_patch ? 'rrule'        then proxima                  else r.dtstart end,
    next_run_at  = case when p_patch ? 'rrule'        then proxima                  else r.next_run_at end,
    materialized_until = case when p_patch ? 'rrule'  then null                     else r.materialized_until end
  where r.id = serie.id;

  if p_patch ? 'rrule' then
    -- O calendário mudou: as em aberto do período do próximo vencimento em diante saem, e o
    -- agendador as gera de novo pela regra nova.
    delete from public.transactions t
    where t.recurring_id = serie.id
      and t.workspace_id = serie.workspace_id
      and t.status = 'pending'
      and (t.occurred_at >= current_date or (t.invoice_id is null and t.due_at >= current_date))
      and date_trunc(periodo, case when t.invoice_id is null then coalesce(t.due_at, t.occurred_at) else t.occurred_at end)
          >= date_trunc(periodo, proxima::date);
  end if;

  if p_patch ? 'end_date' and p_patch->>'end_date' is not null then
    -- Fim mais cedo: o que passou dele não vai mais acontecer.
    delete from public.transactions t
    where t.recurring_id = serie.id
      and t.workspace_id = serie.workspace_id
      and t.status = 'pending'
      and (t.occurred_at >= current_date or (t.invoice_id is null and t.due_at >= current_date))
      and t.occurred_at > (p_patch->>'end_date')::date;
  end if;

  if p_propagate then
    -- Mesmo cuidado da irmã: `account_id` só entra no `set` quando foi pedido, senão
    -- `set_invoice` recalcula a fatura de ocorrências que ninguém mandou mover.
    update public.transactions t set
      amount_cents = coalesce((p_patch->>'amount_cents')::bigint, t.amount_cents),
      category     = case when p_patch ? 'category'    then p_patch->>'category'    else t.category end,
      description  = case when p_patch ? 'description' then p_patch->>'description' else t.description end,
      merchant     = case when p_patch ? 'merchant'    then nullif(p_patch->>'merchant', '') else t.merchant end,
      kind         = case when p_patch ? 'kind'        then p_patch->>'kind'        else t.kind end
    where t.recurring_id = serie.id
      and t.workspace_id = serie.workspace_id
      and t.status = 'pending'
      and (t.occurred_at >= current_date or (t.invoice_id is null and t.due_at >= current_date));
    get diagnostics changed = row_count;

    if p_patch ? 'account_id' then
      update public.transactions t
         set account_id = (p_patch->>'account_id')::uuid
       where t.recurring_id = serie.id
         and t.workspace_id = serie.workspace_id
         and t.status = 'pending'
         and (t.occurred_at >= current_date or (t.invoice_id is null and t.due_at >= current_date));
    end if;
  end if;

  return changed;
end;
$$;

revoke execute on function public.update_recurring_series(uuid, jsonb, boolean) from public, anon;
grant execute on function public.update_recurring_series(uuid, jsonb, boolean) to authenticated;

-- O comentário da `20260909070000` ("frequência nova é série nova") sobrevive ao replace e mentiria.
comment on function public.update_recurring_series(uuid, jsonb, boolean) is
  'Edita a série inteira: valor, categoria, título, estabelecimento, tipo, conta, fim e o calendário (rrule + next_run_at juntos). Propaga para as futuras em aberto; calendário novo refaz as futuras em aberto e zera materialized_until. O passado e as pagas não mudam.';

-- 4. "Esta e as próximas" com estabelecimento novo grava também na SÉRIE (a regra passou a ter a
--    coluna). Corpo igual ao da `20260909071000`, com a linha do `merchant` no update da série.
create or replace function public.update_transaction_scoped(p_transaction_id uuid, p_scope text, p_patch jsonb)
returns bigint
language plpgsql
security invoker
set search_path = public
as $function$
declare
  anchor  record;
  alvos   uuid[];
  changed bigint;
  chaves  text[];
begin
  if p_scope not in ('one', 'future') then
    raise exception 'Escopo inválido: use "só esta" ou "esta e as futuras"';
  end if;

  chaves := array(select jsonb_object_keys(p_patch));
  if chaves = '{}' then
    raise exception 'Nada para alterar';
  end if;
  if exists (
    select 1 from unnest(chaves) k
    where k not in ('amount_cents', 'category', 'description', 'merchant', 'account_id')
  ) then
    raise exception 'Campo não permitido nesta alteração';
  end if;
  if p_patch ? 'amount_cents'
     and coalesce((p_patch->>'amount_cents')::bigint, 0) <= 0 then
    raise exception 'O valor precisa ser maior que zero';
  end if;

  -- security invoker + RLS: quem não enxerga o lançamento não acha a linha.
  select t.id, t.workspace_id, t.occurred_at, t.kind,
         t.installment_plan_id, t.recurring_id
    into anchor
  from public.transactions t
  where t.id = p_transaction_id;

  if anchor.id is null then
    raise exception 'Lançamento não encontrado';
  end if;
  if p_scope = 'future'
     and anchor.installment_plan_id is null
     and anchor.recurring_id is null then
    raise exception 'Esse lançamento não faz parte de uma série';
  end if;

  if p_patch ? 'account_id' then
    -- Transferência tem DUAS contas e um check que proíbe as duas iguais (`0005`). Trocar
    -- uma delas por aqui devolveria 23514 cru; `null` passaria e deixaria a transferência
    -- sem origem. A tela da transferência é quem tem as duas pontas na mão.
    if anchor.kind = 'transfer' then
      raise exception 'Transferência: mude a conta pela tela da transferência';
    end if;
    -- `recurring_transactions` não tem trigger que valide a conta, ao contrário de
    -- `transactions`. Sem esta checagem a regra aceitaria conta de outro workspace e o
    -- cron quebraria em toda materialização, com a série parada e um `last_error`.
    if p_patch->>'account_id' is not null and not exists (
      select 1 from public.accounts a
      where a.id = (p_patch->>'account_id')::uuid and a.workspace_id = anchor.workspace_id
    ) then
      raise exception 'Conta precisa ser do mesmo workspace do lançamento';
    end if;
  end if;

  -- O conjunto é decidido UMA vez, e o predicado mora num lugar só.
  select array_agg(t.id) into alvos
  from public.transactions t
  where t.workspace_id = anchor.workspace_id
    and (
      t.id = anchor.id                                  -- a âncora entra sempre
      or (
        p_scope = 'future'
        and t.status = 'pending'                        -- futuro é status...
        and t.occurred_at >= anchor.occurred_at         -- ...E data, as duas juntas
        and (
          (anchor.installment_plan_id is not null
             and t.installment_plan_id = anchor.installment_plan_id)
          or (anchor.recurring_id is not null
             and t.recurring_id = anchor.recurring_id)
        )
      )
    );

  -- ⚠️ `account_id` FORA deste `set`. Mencionar a coluna já dispara `set_invoice`, e
  -- recalcular a janela da fatura numa correção de texto remaneja parcela entre faturas
  -- (inclusive para fora de uma já paga) sem ninguém ter pedido.
  update public.transactions t set
    amount_cents = coalesce((p_patch->>'amount_cents')::bigint, t.amount_cents),
    category     = case when p_patch ? 'category'    then p_patch->>'category'    else t.category end,
    description  = case when p_patch ? 'description' then p_patch->>'description' else t.description end,
    merchant     = case when p_patch ? 'merchant'    then p_patch->>'merchant'    else t.merchant end
  where t.id = any(alvos);

  if p_patch ? 'account_id' then
    -- Aqui a reatribuição de fatura é o efeito DESEJADO: a conta mudou de verdade.
    update public.transactions t
       set account_id = (p_patch->>'account_id')::uuid
     where t.id = any(alvos);
  end if;

  changed := coalesce(array_length(alvos, 1), 0);

  -- O contrato do parcelamento acompanha as parcelas em TUDO que a tela mostra, não só no
  -- total: `useInstallmentPlans` exibe descrição, comerciante, categoria e conta do PLANO.
  if anchor.installment_plan_id is not null then
    update public.installment_plans p set
      total_cents = case
        when p_patch ? 'amount_cents' then (
          select sum(t.amount_cents) from public.transactions t
          where t.installment_plan_id = p.id and t.workspace_id = p.workspace_id
        ) else p.total_cents end,
      description = case when p_patch ? 'description' then p_patch->>'description' else p.description end,
      merchant    = case when p_patch ? 'merchant'    then p_patch->>'merchant'    else p.merchant end,
      category    = case when p_patch ? 'category'    then p_patch->>'category'    else p.category end,
      account_id  = case when p_patch ? 'account_id'  then (p_patch->>'account_id')::uuid else p.account_id end,
      updated_at  = now()
    where p.id = anchor.installment_plan_id and p.workspace_id = anchor.workspace_id;
  end if;

  if p_scope = 'future' and anchor.recurring_id is not null then
    update public.recurring_transactions r set
      amount_cents = coalesce((p_patch->>'amount_cents')::bigint, r.amount_cents),
      category     = case when p_patch ? 'category'    then p_patch->>'category'    else r.category end,
      description  = case when p_patch ? 'description' then p_patch->>'description' else r.description end,
      merchant     = case when p_patch ? 'merchant'    then nullif(p_patch->>'merchant', '') else r.merchant end,
      account_id   = case when p_patch ? 'account_id'  then (p_patch->>'account_id')::uuid else r.account_id end
    where r.id = anchor.recurring_id and r.workspace_id = anchor.workspace_id;
  end if;

  return changed;
end;
$function$
;
