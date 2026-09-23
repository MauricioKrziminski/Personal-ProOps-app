-- Financiamento maleável (23/09/2026). Spec: docs/superpowers/specs/2026-09-23-financiamento-maleavel-design.md
--
-- Três queixas do dono do produto que caem no banco:
--
-- 1. *"a primeira parcela às vezes é daqui a 3 meses"* — o cronograma sempre começava na
--    próxima ocorrência do dia de vencimento A PARTIR DE HOJE. Não existia âncora no futuro.
-- 2. *"editar com todas as opções de criar"*, inclusive com parcela já paga pelo app — e o
--    trigger barrava mudar o contrato de parcela fixa depois do primeiro "Paguei". A decisão
--    (Gabriel, 23/09/2026) foi LIBERAR: os pagamentos antigos viram histórico solto.
-- 3. *"excluir por completo, tirando dos lançamentos anteriores e dos futuros"* — apagar a
--    dívida com pagamento FALHAVA: a FK é `on delete set null`, esse UPDATE dispara o
--    `tg_transactions_debt_payment`, e ele recusa "desvincular um pagamento já criado".

-- ── 1. a âncora do contrato ──────────────────────────────────────────────────────────────────
alter table public.debts add column if not exists first_due_date date;

comment on column public.debts.first_due_date is
  'Data da parcela nº 1 do contrato. A parcela n vence em day_in_month(add_months(first_due_date, '
  'n − 1), due_day). null = o comportamento antigo (a próxima ocorrência do due_day a partir de hoje).';

-- `private.debt_schedule_for` é a fonte ÚNICA de parcela futura: projeção, "O mês inteiro",
-- Hoje, ciclo, "E se…" e ordem de ataque passam por ela. A âncora entra num `greatest` com o
-- cálculo de sempre:
--   - 1ª parcela no futuro (carência) → a âncora ganha, e nada aparece antes dela;
--   - pagou adiantado → a âncora + pagas continua no mês certo, não é puxada para frente;
--   - atrasado (a do contrato já passou) → o cálculo de sempre, igual a hoje;
--   - null → `greatest` ignora, e a dívida antiga não muda.
--
-- ⚠️ Cabeçalho repetido inteiro: `create or replace` apaga o `set "TimeZone"` que não for
-- repetido (a lição da `20260911160000`).
create or replace function private.debt_schedule_for(p_debt_id uuid)
returns table (installment_no integer, due_date date, payment_cents bigint,
               interest_cents bigint, principal_cents bigint, balance_cents bigint)
language sql stable
set search_path to 'public'
set "TimeZone" to 'America/Sao_Paulo'
as $function$
  with recursive d as (
    select id, remaining_cents, interest_rate_monthly, due_day, calculation_mode,
           started_at, installments_paid, first_due_date,
           coalesce(installments, 0) - installments_paid as restantes,
           installment_cents
    from public.debts where id = p_debt_id
  ),
  dia as (
    select coalesce(d.due_day, extract(day from d.started_at)::int) as valor from d
  ),
  -- o contrato já foi cobrado NESTE CICLO? o pagamento é a única prova que existe
  pago as (
    select private.debt_paid_in_cycle(p_debt_id, current_date) as sim
  ),
  -- o fim do ciclo corrente, para saber o que é "depois dele"
  ciclo as (
    select b.fim
    from d,
         lateral (select private.cycle_close_day(array[d_ws.workspace_id]) as cd
                  from public.debts d_ws where d_ws.id = p_debt_id) r,
         lateral private.cycle_bounds(r.cd, private.cycle_month_of(r.cd, current_date)) b
  ),
  parametros as (
    select d.remaining_cents, d.interest_rate_monthly as taxa,
           d.installments_paid as pagas,
           (select valor from dia) as venc,
           greatest(
             case
               -- ⚠️ Pago no ciclo: a próxima é a primeira ocorrência do dia de vencimento
               -- ESTRITAMENTE depois do fim do ciclo. Somar um mês ao HOJE não bastava — com
               -- fechamento no dia 10 e vencimento no dia 5, "mês que vem" cai em 05/10, que
               -- ainda está dentro do ciclo 11/09–10/10 que acabou de ser pago.
               when (select sim from pago)
                 then case
                        when private.day_in_month((select fim from ciclo) + 1, (select valor from dia))
                             > (select fim from ciclo)
                          then private.day_in_month((select fim from ciclo) + 1, (select valor from dia))
                        else private.day_in_month(
                               private.add_months((select fim from ciclo) + 1, 1),
                               (select valor from dia))
                      end
               when private.day_in_month(current_date, (select valor from dia)) >= current_date
                 then private.day_in_month(current_date, (select valor from dia))
               else private.day_in_month(private.add_months(current_date, 1), (select valor from dia))
             end,
             -- a âncora do contrato: a parcela `pagas + 1` no dia de vencimento
             case when d.first_due_date is not null
                  then private.day_in_month(private.add_months(d.first_due_date, d.installments_paid),
                                            (select valor from dia))
             end
           ) as primeiro,
           nullif(d.restantes, 0) as n,
           coalesce(d.installment_cents,
                    private.price_installment(d.remaining_cents, d.interest_rate_monthly,
                                              nullif(d.restantes, 0))) as parcela
    from d
  ),
  amortizacao as (
    select 1 as installment_no,
           (select remaining_cents from parametros) as saldo_inicial,
           (select parcela from parametros) as parcela,
           (select taxa from parametros) as taxa,
           (select n from parametros) as n
    union all
    select a.installment_no + 1,
           a.saldo_inicial + ceil(a.saldo_inicial::numeric * a.taxa)::bigint - a.parcela,
           a.parcela, a.taxa, a.n
    from amortizacao a
    where a.installment_no < a.n
      and a.saldo_inicial + ceil(a.saldo_inicial::numeric * a.taxa)::bigint - a.parcela > 0
  )
  -- a numeração é a do CONTRATO: 40 parcelas restantes de 48 são a 9ª à 48ª
  select a.installment_no + coalesce((select pagas from parametros), 0),
         private.day_in_month(
           private.add_months((select primeiro from parametros), a.installment_no - 1),
           (select venc from parametros)
         ) as due_date,
         case when a.installment_no = a.n
              then a.saldo_inicial + ceil(a.saldo_inicial::numeric * a.taxa)::bigint
              else a.parcela end as payment_cents,
         case when (select calculation_mode from d) = 'fixed_installments' then null::bigint
              else ceil(a.saldo_inicial::numeric * a.taxa)::bigint end as interest_cents,
         case when (select calculation_mode from d) = 'fixed_installments' then null::bigint
              when a.installment_no = a.n
              then a.saldo_inicial
              else a.parcela - ceil(a.saldo_inicial::numeric * a.taxa)::bigint end as principal_cents,
         greatest(
           a.saldo_inicial + ceil(a.saldo_inicial::numeric * a.taxa)::bigint
           - case when a.installment_no = a.n
                  then a.saldo_inicial + ceil(a.saldo_inicial::numeric * a.taxa)::bigint
                  else a.parcela end,
           0) as balance_cents
  from amortizacao a
  where (select calculation_mode from d) <> 'fixed_installments'
     or (a.saldo_inicial > 0 and a.n > 0)
  order by a.installment_no;
$function$;

-- ── 2. o contrato de parcela fixa muda mesmo com pagamento registrado ────────────────────────
-- As duas travas de "já existe pagamento" saem; o `check` de parcela fixa continua segurando a
-- aritmética (principal = parcela × N, saldo = parcela × (N − pagas)). O pagamento NOVO sai
-- certo porque o INSERT lê `installments_paid` e `remaining_cents` atuais; o ANTIGO vira
-- histórico — corrigir o valor ou apagar ele continua recusado quando ele não é o mais recente
-- e coerente com o saldo, e esse é o custo aceito.
create or replace function public.tg_debts_calculation_mode()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.calculation_mode is distinct from old.calculation_mode then
    raise exception 'O modo de cálculo não pode ser alterado. Cadastre outro financiamento para um novo contrato';
  end if;
  return new;
end;
$function$;

-- ── 3. excluir por completo ──────────────────────────────────────────────────────────────────
-- O trigger de pagamento ganha UMA saída: quando `proops.apagando_divida` nomeia a dívida
-- daquela linha, ele devolve a linha sem tocar na dívida — que está sendo apagada junto. A GUC
-- é local à transação (`set_config(…, true)`) e só `delete_debt` a escreve; o PostgREST não
-- expõe `set_config`.
create or replace function public.tg_transactions_debt_payment()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  d record;
  debt uuid;
  balance_before bigint;
  economic_change boolean;
begin
  debt := case when tg_op = 'DELETE' then old.debt_id else new.debt_id end;
  -- No UPDATE da FK (`set debt_id = null`) quem nomeia a dívida é o `old`.
  if current_setting('proops.apagando_divida', true) in (debt::text, old.debt_id::text) then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if tg_op = 'UPDATE' and new.debt_id is distinct from old.debt_id then
    raise exception 'Não é possível vincular ou desvincular um pagamento já criado';
  end if;
  if debt is null then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  select * into d from public.debts where id = debt for update;
  if d.id is null then raise exception 'Dívida não encontrada'; end if;
  if tg_op <> 'DELETE' then
    if new.kind <> 'expense' or new.status <> 'cleared' or new.workspace_id <> d.workspace_id then
      raise exception 'Pagamento de dívida deve continuar como despesa paga do mesmo workspace';
    end if;
    if new.account_id is not null and not exists (
      select 1 from public.accounts a where a.id = new.account_id and a.workspace_id = d.workspace_id
        and a.type <> 'credit_card' and not a.archived
    ) then raise exception 'Conta pagadora inválida para esta dívida'; end if;
  end if;
  if tg_op = 'INSERT' then
    if d.archived or d.remaining_cents <= 0 then raise exception 'Dívida arquivada ou já quitada'; end if;
    if exists (select 1 from public.transactions t where t.debt_id = debt and t.occurred_at > new.occurred_at) then
      raise exception 'Registre pagamentos em ordem de data';
    end if;
    new.debt_payment_no := d.installments_paid + 1;
    new.debt_interest_cents := ceil(d.remaining_cents::numeric * d.interest_rate_monthly)::bigint;
    new.debt_principal_cents := new.amount_cents - new.debt_interest_cents;
    if new.debt_principal_cents is null or new.debt_principal_cents <= 0 or new.debt_principal_cents > d.remaining_cents then
      raise exception 'Pagamento deve amortizar o saldo e não superar a quitação';
    end if;
    new.debt_balance_after_cents := d.remaining_cents - new.debt_principal_cents;
    update public.debts set remaining_cents = new.debt_balance_after_cents,
      installments_paid = new.debt_payment_no where id = debt;
    return new;
  end if;
  if tg_op = 'UPDATE' then
    -- The ledger is derived by the database, never accepted from an API patch.
    new.debt_payment_no := old.debt_payment_no;
    new.debt_interest_cents := old.debt_interest_cents;
    new.debt_principal_cents := old.debt_principal_cents;
    new.debt_balance_after_cents := old.debt_balance_after_cents;
    if new.occurred_at is distinct from old.occurred_at and exists (
      select 1 from public.transactions t where t.debt_id = debt and t.id <> old.id
        and ((t.occurred_at <= old.occurred_at and t.occurred_at > new.occurred_at)
          or (t.occurred_at >= old.occurred_at and t.occurred_at < new.occurred_at))
    ) then raise exception 'A nova data mudaria a ordem de amortização dos pagamentos'; end if;
    economic_change := new.amount_cents is distinct from old.amount_cents;
    if not economic_change then return new; end if;
  end if;
  if old.debt_payment_no is null or old.debt_principal_cents is null or old.debt_balance_after_cents is null then
    raise exception 'Pagamento antigo sem histórico de amortização. Valor e exclusão exigem conciliar o saldo em Dívidas e financiamentos';
  end if;
  if old.debt_payment_no <> d.installments_paid or old.debt_balance_after_cents <> d.remaining_cents then
    raise exception 'Corrija primeiro o pagamento mais recente; o saldo mudou após este pagamento';
  end if;
  balance_before := old.debt_balance_after_cents + old.debt_principal_cents;
  if tg_op = 'DELETE' then
    update public.debts set remaining_cents = balance_before,
      installments_paid = installments_paid - 1 where id = debt;
    return old;
  end if;
  new.debt_principal_cents := new.amount_cents - old.debt_interest_cents;
  if new.debt_principal_cents is null or new.debt_principal_cents <= 0 or new.debt_principal_cents > balance_before then
    raise exception 'Correção deve amortizar o saldo e não superar a quitação';
  end if;
  new.debt_balance_after_cents := balance_before - new.debt_principal_cents;
  update public.debts set remaining_cents = new.debt_balance_after_cents where id = debt;
  return new;
end;
$function$;

-- Apaga os pagamentos lançados e a dívida, numa transação. Devolve quantos pagamentos saíram.
-- `security invoker`: no app a RLS limita as duas deleções ao workspace de quem chama (a
-- dívida de outro workspace dá 0 linhas, sem erro); o agente passa por `ensure_owned` antes.
-- Idempotente: a dívida que já não existe devolve 0.
create or replace function public.delete_debt(p_debt_id uuid)
returns int
language plpgsql
security invoker
set search_path to 'public'
as $function$
declare
  n int;
begin
  -- Trava a dívida antes: um "Paguei" que confirmasse entre as duas deleções deixaria um
  -- pagamento novo para a FK anular, e a RPC inteira falharia.
  perform 1 from public.debts where id = p_debt_id for update;
  perform set_config('proops.apagando_divida', p_debt_id::text, true);
  delete from public.transactions where debt_id = p_debt_id;
  get diagnostics n = row_count;
  delete from public.debts where id = p_debt_id;
  perform set_config('proops.apagando_divida', '', true);
  return n;
end;
$function$;

revoke execute on function public.delete_debt(uuid) from public, anon;
grant execute on function public.delete_debt(uuid) to authenticated, service_role;
