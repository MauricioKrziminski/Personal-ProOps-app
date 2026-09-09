-- Editar uma parcela / ocorrência: só esta, ou esta e as futuras.
--
-- Pedido do dono do produto em 09/09/2026: *"posso editar somente aquele ou de todos as demais
-- parcelas futuras e aquela que ele ta editando... Note que nao edita as passadas, só se ele
-- editar manualmente dos meses anteriores."*
--
-- Apagar já tinha escopo ("só esta parcela" / "a compra inteira"); editar não tinha nenhum, e o
-- único caminho era abrir parcela por parcela. Numa compra em 48x isso não é um caminho.
--
-- ── as três decisões que dão significado ao "futuras" ───────────────────────────────────────
--
-- 1. **Futuro é `status = 'pending'`, não `installment_no` maior.** Uma parcela adiantada já
--    aconteceu: mexer no valor dela reescreveria um mês fechado e, se ela estiver numa fatura
--    paga, mudaria o total de uma fatura que já foi quitada. O número da parcela não sabe disso;
--    o status sabe.
-- 2. **E `occurred_at >= a da âncora.`** Só o status não basta: uma conta prevista ATRASADA (de
--    agosto, ainda `pending`) é passado para o usuário, e ele disse com todas as letras que o
--    passado só muda se ele for lá à mão.
-- 3. **A âncora entra sempre**, mesmo já paga — é a linha que ele está editando na tela.
--
-- ── o que a função tem que fazer além do update, senão ela mente ────────────────────────────
--
-- `installment_plans.total_cents` é metadado do contrato e não é derivado por nenhuma view. Mudar
-- o valor de 40 parcelas e deixar o total velho é o mesmo defeito de "plano órfão mentindo
-- `installments = 10` com 9 parcelas vivas", que já custou uma correção. Aqui o total é
-- RECALCULADO da soma das parcelas.
--
-- Em série recorrente, a mesma coisa vale para `recurring_transactions`: o `finance-scheduler`
-- materializa 90 dias à frente a partir da REGRA, e o unique `(recurring_id, occurred_at)` faz
-- ele não reescrever o que já existe. Sem atualizar a regra, o mês 4 nasceria com o valor velho
-- enquanto os meses 1..3 estariam com o novo.
--
-- ── por que uma RPC e não N updates no cliente ──────────────────────────────────────────────
--
-- "Regra que já mora no banco continua no banco" e "parcelamento só pela RPC". Um laço no app
-- faria N chamadas sem transação: caindo no meio, metade das parcelas fica com o valor novo e o
-- `total_cents` com o velho. E o agente precisa do MESMO comportamento — duas cópias divergem.

alter table public.installment_plans
  add column if not exists updated_at timestamptz;

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
  changed bigint;
  chaves  text[];
begin
  if p_scope not in ('one', 'future') then
    raise exception 'Escopo inválido: use "só esta" ou "esta e as futuras"';
  end if;

  -- Allowlist de colunas. O patch vem do cliente E do agente; nome de coluna nunca
  -- pode chegar solto num `set`, e um campo fora daqui é sempre erro de quem chamou.
  --
  -- `occurred_at`, `kind` e `status` ficam DE FORA de propósito: data é de cada
  -- ocorrência (propagar empilharia todas no mesmo dia), e status é baixa, que tem
  -- caminho próprio (`mark_paid`) com efeito em fatura e projeção.
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
  select t.id, t.workspace_id, t.occurred_at, t.installment_plan_id, t.recurring_id
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

  update public.transactions t set
    amount_cents = coalesce((p_patch->>'amount_cents')::bigint, t.amount_cents),
    category     = case when p_patch ? 'category'    then p_patch->>'category'    else t.category end,
    description  = case when p_patch ? 'description' then p_patch->>'description' else t.description end,
    merchant     = case when p_patch ? 'merchant'    then p_patch->>'merchant'    else t.merchant end,
    account_id   = case when p_patch ? 'account_id'  then (p_patch->>'account_id')::uuid else t.account_id end
  where t.workspace_id = anchor.workspace_id
    and (
      t.id = anchor.id                                  -- a âncora entra sempre
      or (
        p_scope = 'future'
        and t.status = 'pending'                        -- decisão 1
        and t.occurred_at >= anchor.occurred_at         -- decisão 2
        and (
          (anchor.installment_plan_id is not null
             and t.installment_plan_id = anchor.installment_plan_id)
          or (anchor.recurring_id is not null
             and t.recurring_id = anchor.recurring_id)
        )
      )
    );
  get diagnostics changed = row_count;

  -- O contrato do parcelamento acompanha as parcelas, senão a tela mostra um total
  -- que não é a soma do que está embaixo dele.
  if anchor.installment_plan_id is not null and p_patch ? 'amount_cents' then
    update public.installment_plans p
       set total_cents = (
             select sum(t.amount_cents) from public.transactions t
             where t.installment_plan_id = p.id and t.workspace_id = p.workspace_id
           ),
           updated_at = now()
     where p.id = anchor.installment_plan_id and p.workspace_id = anchor.workspace_id;
  end if;

  -- A regra é a fonte das ocorrências que AINDA NÃO existem. Sem isto, o mês seguinte
  -- ao horizonte de materialização voltaria com o valor antigo.
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

comment on function public.update_transaction_scoped(uuid, text, jsonb) is
  'Edita um lançamento e, com escopo "future", as ocorrências FUTURAS da mesma série (parcelamento ou recorrência). Futuro = status pending e data >= a da âncora: o passado só muda à mão. Recalcula installment_plans.total_cents e propaga para recurring_transactions.';

comment on column public.installment_plans.updated_at is
  'Última vez que o contrato mudou por edição em lote. Null nos planos criados antes de 09/09/2026.';

-- ── editar a SÉRIE recorrente ───────────────────────────────────────────────────────────────
--
-- A tela de Recorrentes só sabia criar, pausar e apagar: não havia como corrigir o valor do
-- aluguel sem apagar a série e refazer, o que perderia o histórico já materializado.
--
-- Editar a regra não basta. O `finance-scheduler` materializa 90 dias à frente e o unique
-- `(recurring_id, occurred_at)` faz ele NÃO reescrever o que já existe: mexer só na regra
-- deixaria os próximos três meses com o valor velho e o quarto com o novo. Por isso a mesma
-- função propaga para as ocorrências FUTURAS, com a mesma definição de futuro da irmã acima —
-- `pending` e a partir de hoje. O que já passou (ou já foi pago adiantado) fica como está.
--
-- `rrule` e `dtstart` ficam de fora: `dtstart` é âncora imutável da série e trocar a frequência
-- é outra coisa (implicaria remontar o calendário já materializado). Mudar de ideia sobre a
-- frequência continua sendo apagar e criar de novo, que é honesto.
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

  update public.recurring_transactions r set
    amount_cents = coalesce((p_patch->>'amount_cents')::bigint, r.amount_cents),
    category     = case when p_patch ? 'category'     then p_patch->>'category'     else r.category end,
    description  = case when p_patch ? 'description'  then p_patch->>'description'  else r.description end,
    account_id   = case when p_patch ? 'account_id'   then (p_patch->>'account_id')::uuid else r.account_id end,
    auto_confirm = case when p_patch ? 'auto_confirm' then (p_patch->>'auto_confirm')::boolean else r.auto_confirm end,
    end_date     = case when p_patch ? 'end_date'     then (p_patch->>'end_date')::date else r.end_date end
  where r.id = p_recurring_id
  returning r.id, r.workspace_id into serie;

  if serie.id is null then
    raise exception 'Recorrência não encontrada';
  end if;

  if p_propagate then
    update public.transactions t set
      amount_cents = coalesce((p_patch->>'amount_cents')::bigint, t.amount_cents),
      category     = case when p_patch ? 'category'    then p_patch->>'category'    else t.category end,
      description  = case when p_patch ? 'description' then p_patch->>'description' else t.description end,
      account_id   = case when p_patch ? 'account_id'  then (p_patch->>'account_id')::uuid else t.account_id end
    where t.recurring_id = serie.id
      and t.workspace_id = serie.workspace_id
      and t.status = 'pending'
      and t.occurred_at >= current_date;
    get diagnostics changed = row_count;
  end if;

  return changed;
end;
$$;

comment on function public.update_recurring_series(uuid, jsonb, boolean) is
  'Edita a regra da recorrência e, por padrão, propaga para as ocorrências futuras já materializadas (pending, a partir de hoje). Não mexe em rrule/dtstart: frequência nova é série nova.';
