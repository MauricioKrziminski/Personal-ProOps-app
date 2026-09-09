-- Correções da `20260909070000`, achadas na revisão da migration no mesmo dia.
--
-- A `070000` já estava aplicada no staging quando isto foi escrito, por isso vem numa migration
-- nova em vez de editada: migration aplicada não se edita, senão o staging fica com uma versão
-- que nenhum arquivo descreve.
--
-- ── o defeito grave: fatura remanejada em lote, em silêncio ─────────────────────────────────
--
-- O `set` da `070000` mencionava `account_id` SEMPRE (`else t.account_id`), inclusive quando o
-- usuário só corrigiu o nome. O Postgres dispara `update of <coluna>` pelas colunas MENCIONADAS
-- no `set`, não pelas que mudaram de valor — então `set_invoice` (`0057`) rodava em toda linha
-- tocada e recalculava `private.invoice_window`.
--
-- **Onde isso morde, exatamente** (medido, não suposto): com dado recém-escrito o gatilho
-- recalcula e chega no mesmo lugar — é inofensivo. O caso que quebra é a linha cuja fatura
-- GRAVADA discorda do que a regra calcula hoje, ou seja, dado escrito antes da
-- `20260909050000`, que corrigiu o dia do fechamento por um caractere. Aí a linha é remanejada:
-- e se ela estivesse numa fatura já PAGA, sairia dela e entraria na aberta — a paga ficaria com
-- `sum(transactions) < paid_cents` (`invoice_open_cents` negativo, invisível porque as leituras
-- filtram `status <> 'paid'`) e o usuário seria cobrado de novo por algo que já pagou.
--
-- `supabase/tests/scoped_transaction_edit.sql` força essa divergência à mão — é a única forma de
-- ter dado "antigo" num banco novo — e o teste FALHA sem esta migration.
--
-- A `20260909050000` diz com todas as letras que remanejar as linhas EXISTENTES é "decisão
-- separada, feita linha a linha". Fazer isso em lote como efeito colateral de uma correção de
-- texto é o oposto disso. Agora `account_id` só é escrito quando foi pedido — e aí a
-- reatribuição da fatura é justamente o que se quer.
--
-- ── as outras três ──────────────────────────────────────────────────────────────────────────
--
-- • **Conta de outro workspace.** `transactions` escapava por acaso (o `set_invoice` valida e
--   levanta); `recurring_transactions` não tem trigger nenhum, então a regra aceitaria a conta e
--   o `finance-scheduler` quebraria de hora em hora gravando `last_error`, com a série parada.
-- • **Transferência.** `account_id` igual ao `counterparty_account_id` estoura o check da `0005`
--   como `23514` cru, que a tela não sabe traduzir; e `account_id: null` passa em todos os checks
--   e deixa a transferência sem origem. Trocar a conta de uma transferência é na tela dela.
-- • **O contrato do parcelamento mentia em tudo que não era `total_cents`.** A tela de
--   Parcelamentos mostra `description`, `merchant`, `category` e `account_id` DO PLANO: corrigir o
--   nome "esta e as futuras" deixava o título velho na lista com as parcelas já renomeadas
--   embaixo. É o mesmo argumento do total, aplicado aos campos que faltavam.

create or replace function public.update_transaction_scoped(
  p_transaction_id uuid,
  p_scope text,                       -- 'one' | 'future'
  p_patch jsonb
)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
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
      account_id   = case when p_patch ? 'account_id'  then (p_patch->>'account_id')::uuid else r.account_id end
    where r.id = anchor.recurring_id and r.workspace_id = anchor.workspace_id;
  end if;

  return changed;
end;
$$;

-- Mesma checagem de conta na irmã: a regra da recorrência é a que faz o cron quebrar.
create or replace function public.update_recurring_series(
  p_recurring_id uuid,
  p_patch jsonb,
  p_propagate boolean default true
)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  serie   record;
  changed bigint := 0;
begin
  if p_patch is null or p_patch = '{}'::jsonb then
    raise exception 'Nada para alterar';
  end if;
  if exists (
    select 1 from unnest(array(select jsonb_object_keys(p_patch))) k
    where k not in ('amount_cents', 'category', 'description', 'account_id',
                    'auto_confirm', 'end_date')
  ) then
    raise exception 'Campo não permitido nesta alteração';
  end if;
  if p_patch ? 'amount_cents'
     and coalesce((p_patch->>'amount_cents')::bigint, 0) <= 0 then
    raise exception 'O valor precisa ser maior que zero';
  end if;

  select r.id, r.workspace_id into serie
  from public.recurring_transactions r where r.id = p_recurring_id;
  if serie.id is null then
    raise exception 'Recorrência não encontrada';
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
    account_id   = case when p_patch ? 'account_id'   then (p_patch->>'account_id')::uuid else r.account_id end,
    auto_confirm = case when p_patch ? 'auto_confirm' then (p_patch->>'auto_confirm')::boolean else r.auto_confirm end,
    end_date     = case when p_patch ? 'end_date'     then (p_patch->>'end_date')::date else r.end_date end
  where r.id = serie.id;

  if p_propagate then
    -- Mesmo cuidado da irmã: `account_id` só entra no `set` quando foi pedido, senão
    -- `set_invoice` recalcula a fatura de ocorrências que ninguém mandou mover.
    update public.transactions t set
      amount_cents = coalesce((p_patch->>'amount_cents')::bigint, t.amount_cents),
      category     = case when p_patch ? 'category'    then p_patch->>'category'    else t.category end,
      description  = case when p_patch ? 'description' then p_patch->>'description' else t.description end
    where t.recurring_id = serie.id
      and t.workspace_id = serie.workspace_id
      and t.status = 'pending'
      and t.occurred_at >= current_date;
    get diagnostics changed = row_count;

    if p_patch ? 'account_id' then
      update public.transactions t
         set account_id = (p_patch->>'account_id')::uuid
       where t.recurring_id = serie.id
         and t.workspace_id = serie.workspace_id
         and t.status = 'pending'
         and t.occurred_at >= current_date;
    end if;
  end if;

  return changed;
end;
$$;

revoke execute on function public.update_transaction_scoped(uuid, text, jsonb) from anon;
revoke execute on function public.update_recurring_series(uuid, jsonb, boolean) from anon;

comment on function public.update_transaction_scoped(uuid, text, jsonb) is
  'Edita um lançamento e, com escopo "future", as ocorrências FUTURAS da mesma série. Futuro = status pending E data >= a da âncora. account_id só entra no UPDATE quando foi pedido: mencioná-lo dispara set_invoice e remaneja parcela entre faturas. Mantém installment_plans e a regra da recorrência em dia.';
