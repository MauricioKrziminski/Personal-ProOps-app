-- Reparcelar: a compra parcelada passa a ter EDIÇÃO, e não só "apagar e lançar de novo".
--
-- A queixa foi literal (15/09/2026): *"eu queria colocar o valor total de novo e parcelado em
-- 2x mas ele veio com o valor 52,49 preenchido e nao consigo mudar a parcela etc..."*. O
-- formulário do lançamento edita uma PARCELA; o que ele queria editar é a COMPRA — total,
-- número de parcelas, nome, data. Isso não existia em lugar nenhum do app.
--
-- ⚠️ **Não é invenção: é o padrão do nicho, com UMA qualificação que o mercado repete.**
-- Pesquisado em 15/09/2026. O Organizze recebe total + número de parcelas na criação (e põe o
-- resto da divisão na PRIMEIRA parcela, onde este repo põe na ÚLTIMA); o Mobills edita com
-- escopo "só esta / esta e as futuras"; o OnBalance **desabilita o campo de número de parcelas
-- depois do primeiro pagamento**; o Oracle Financials só permite atualizar parcela com saldo em
-- aberto. A regra convergente, e a que esta função implementa:
--
--   1. **Parcela já paga não se move.** Nem valor, nem data, nem conta, nem existência.
--   2. **O número de parcelas só é livre enquanto NADA foi pago.** Depois disso o contrato já
--      produziu efeito em fatura fechada e em mês encerrado; mexer nele reescreveria o passado.
--   3. O total continua editável mesmo com parcela paga — o que muda é só a repartição do que
--      SOBROU, entre as parcelas em aberto.
--
-- ⚠️ **"Paga" aqui não é só `status = 'cleared'`, e são TRÊS casos.** Compra no cartão fica
-- `pending` até a fatura ser paga (`pay_invoice` dá a baixa das linhas), então a régua precisa
-- olhar a fatura também:
--
--   • **`paid`** — a fatura foi quitada; se por algum motivo a linha ficou `pending`, ela é
--     passado do mesmo jeito.
--   • **`rolled`** — a fatura foi adiada: as linhas dela seguem `pending` e o PRINCIPAL já virou
--     um lançamento na fatura seguinte (`rollover_of_invoice_id`). Mexer no valor faria o saldo
--     rolado deixar de bater com a soma que o gerou.
--   • **`paid_cents > 0`** — pagamento PARCIAL. `pay_invoice` com valor menor soma em
--     `paid_cents` e deixa a fatura `open` com as linhas `pending`; baixar o total da compra aqui
--     derrubaria `private.invoice_open_cents` (`sum(linhas) − paid_cents`) para NEGATIVO, e a
--     fatura ficaria impossível de quitar (`pay_invoice` recusa com `aberto <= 0`). Este é o caso
--     que não aparece em teste nenhum e some no meio de uma leitura de caixa.
--
-- ⚠️ **As parcelas em aberto são ATUALIZADAS, não recriadas.** Apagar e inserir trocaria os
-- `id`s: o `last_write_id` do agente, um `pending_actions` esperando confirmação e qualquer
-- referência futura apontariam para linha morta, e o `set_invoice` correria de novo em cima de
-- linhas que já estavam classificadas. Insert só quando o número CRESCE; delete só quando ele
-- encolhe (e, pela regra 2, só quando nada foi pago).
--
-- ⚠️ **O texto "(i/N)" é REESCRITO em todas as parcelas.** Ele é derivado, não digitado: com N
-- mudando de 2 para 3, "(1/2)" vira mentira na primeira linha da fatura. Parcela travada também
-- é renomeada — o nome é da COMPRA, e "(1/3)" com um nome e "(2/3)" com outro é exatamente o
-- defeito que a 20260915190000 acabou de fechar. Renomear não move dinheiro e **não dispara o
-- `set_invoice`**, que só escuta `account_id, occurred_at, due_at, workspace_id` (0057).
--
-- ⚠️ **A soma é conferida no fim.** Se as parcelas não fecharem com `total_cents`, a função
-- levanta e a transação inteira volta. O modo de falha desta classe de código não é erro na
-- tela — é um total que deixa de ser a soma do que está embaixo dele.

-- --------------------------------------------------------------------------
-- "esta parcela pode mexer?" — uma função, um lugar
-- --------------------------------------------------------------------------
create or replace function private.parcela_travada(p_status text, p_invoice_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  -- `cleared` é a baixa (o pagamento da fatura marca as linhas dela); `paid` cobre a fatura
  -- quitada cujas linhas por algum motivo não foram marcadas; `rolled` é a fatura adiada, cujo
  -- principal já virou lançamento na fatura seguinte; e `paid_cents > 0` é o pagamento PARCIAL,
  -- que deixa a fatura aberta e as linhas pendentes — mexer nelas faz o "quanto falta" da fatura
  -- ficar negativo e ela nunca mais fecha.
  select p_status = 'cleared'
      or exists (
           select 1 from public.card_invoices i
           where i.id = p_invoice_id
             and (i.status in ('paid', 'rolled') or i.paid_cents > 0)
         );
$$;

revoke execute on function private.parcela_travada(text, uuid) from public, anon;
grant execute on function private.parcela_travada(text, uuid) to authenticated, service_role;

comment on function private.parcela_travada(text, uuid) is
  'Uma parcela não pode ser alterada quando já foi paga (status cleared) ou quando a fatura dela está paga, adiada ou parcialmente paga. Régua única de update_installment_plan.';

-- --------------------------------------------------------------------------
-- editar a compra inteira
-- --------------------------------------------------------------------------
create or replace function public.update_installment_plan(
  p_plan_id uuid,
  p_total_cents bigint,
  p_installments int,
  p_first_occurred_at date,
  p_description text default null,
  p_category text default null,
  p_merchant text default null,
  p_account_id uuid default null
)
returns int
language plpgsql security invoker
set search_path = public
as $$
declare
  plano record;
  acc record;
  travadas int;
  travado_cents bigint;
  editaveis int;
  restante bigint;
  base bigint;
  nome text;
  i int;
  ordem int;
  soma bigint;
  parcela record;
begin
  -- `security invoker`: a RLS de `installment_plans` já responde "não é seu" como "não existe".
  --
  -- ⚠️ `for update` porque quantas parcelas estão travadas é MEDIDO num statement e usado em
  -- outro: em READ COMMITTED cada statement pega snapshot novo, e um `pay_invoice` que commita
  -- no meio mudaria o conjunto debaixo da conta. O check de invariante no fim pegaria, mas
  -- falharia com uma mensagem obscura — é o mesmo `select ... for update` de
  -- `pay_debt_installment`.
  select p.* into plano from public.installment_plans p where p.id = p_plan_id for update;
  if plano.id is null then
    raise exception 'Não achei essa compra parcelada.';
  end if;

  if p_installments is null or p_installments < 2 or p_installments > 72 then
    raise exception 'O número de parcelas precisa ficar entre 2 e 72.';
  end if;
  if p_total_cents is null or p_total_cents < p_installments then
    raise exception 'total precisa permitir pelo menos um centavo por parcela';
  end if;
  if p_first_occurred_at is null then
    raise exception 'Informe a data da primeira parcela';
  end if;

  select count(*) filter (where x.travada),
         coalesce(sum(x.amount_cents) filter (where x.travada), 0),
         count(*) filter (where not x.travada)
    into travadas, travado_cents, editaveis
  from (
    select t.amount_cents, private.parcela_travada(t.status, t.invoice_id) as travada
    from public.transactions t
    where t.installment_plan_id = p_plan_id
  ) x;

  -- Regra 2 do cabeçalho: com parcela paga, só o dinheiro em aberto se redistribui.
  if travadas > 0 then
    if p_installments <> plano.installments then
      raise exception
        'Esta compra já tem % parcela(s) paga(s): o número de parcelas não muda mais. Dá para corrigir o total, o nome e a categoria.',
        travadas;
    end if;
    if p_first_occurred_at <> plano.first_occurred_at then
      raise exception 'Esta compra já tem parcela paga: a data da primeira parcela não muda mais.';
    end if;
    if p_account_id is distinct from plano.account_id then
      raise exception 'Esta compra já tem parcela paga: a conta não muda mais.';
    end if;
    if editaveis = 0 then
      if p_total_cents <> travado_cents then
        raise exception 'Todas as parcelas já foram pagas: o total não muda mais.';
      end if;
    elsif p_total_cents - travado_cents < editaveis then
      raise exception
        'O total precisa cobrir as % parcela(s) já paga(s) e sobrar pelo menos um centavo para cada parcela em aberto',
        travadas;
    end if;
  end if;

  -- ⚠️ **Omitir a conta não pode ZERAR a conta.** Os parâmetros têm `default null` para o
  -- chamador não precisar mandar categoria nem estabelecimento; a conta é outra coisa — sem ela
  -- `set_invoice` apaga o `invoice_id` das N parcelas e a compra de cartão vira despesa solta,
  -- em silêncio. Na criação isso é impossível (o parâmetro é posicional e a busca não acha
  -- conta nula); aqui a recusa é explícita. Plano que já nasceu sem conta continua editável.
  if p_account_id is null and plano.account_id is not null then
    raise exception 'Informe a conta desta compra.';
  end if;
  if p_account_id is not null then
    select a.id, a.workspace_id into acc
    from public.accounts a where a.id = p_account_id and not a.archived;
    if acc.id is null or acc.workspace_id <> plano.workspace_id then
      raise exception 'Escolha uma conta ativa.';
    end if;
  end if;

  -- `workspace_id` em todo update/delete daqui para baixo: para o APP a RLS já resolve, mas o
  -- agente Python conecta com papel que a IGNORA — ali a única barreira seria o `ensure_owned`
  -- do outro lado. É o mesmo cinto de `update_transaction_scoped`.
  update public.installment_plans p set
    description       = p_description,
    merchant          = p_merchant,
    category          = p_category,
    account_id        = p_account_id,
    total_cents       = p_total_cents,
    installments      = p_installments,
    first_occurred_at = p_first_occurred_at,
    updated_at        = now()
  where p.id = p_plan_id and p.workspace_id = plano.workspace_id;

  -- Mesmo coalesce da criação (20260915190000): quem informou só o estabelecimento não pode
  -- acabar com "Compra parcelada (1/2)" de novo.
  nome := coalesce(p_description, p_merchant, 'Compra parcelada');

  if travadas = 0 then
    -- Nada pago: o contrato inteiro é reescrito. Some o excedente, entra o que faltar, e a
    -- divisão é a MESMA da criação — resto na última.
    delete from public.transactions t
     where t.installment_plan_id = p_plan_id
       and t.workspace_id = plano.workspace_id
       and (t.installment_no is null or t.installment_no > p_installments);

    base := p_total_cents / p_installments;  -- divisão inteira: nunca float
    for i in 1..p_installments loop
      update public.transactions t set
        amount_cents = case when i = p_installments
                         then p_total_cents - base * (p_installments - 1) else base end,
        occurred_at  = private.add_months(p_first_occurred_at, i - 1),
        description  = nome || ' (' || i || '/' || p_installments || ')',
        merchant     = p_merchant,
        category     = p_category,
        account_id   = p_account_id
      where t.installment_plan_id = p_plan_id
        and t.workspace_id = plano.workspace_id
        and t.installment_no = i;

      if not found then
        insert into public.transactions
          (workspace_id, user_id, kind, amount_cents, category, description, merchant,
           account_id, occurred_at, source, status, installment_plan_id, installment_no)
        values (plano.workspace_id, coalesce((select auth.uid()), plano.user_id), 'expense',
                case when i = p_installments
                  then p_total_cents - base * (p_installments - 1) else base end,
                p_category, nome || ' (' || i || '/' || p_installments || ')',
                p_merchant, p_account_id,
                private.add_months(p_first_occurred_at, i - 1),
                'app', 'pending', p_plan_id, i);
      end if;
    end loop;

    /*
     * ⚠️ **`travadas = 0` fala do estado de ANTES, não do destino.** Recuar a data da primeira
     * parcela (ou trocar o cartão) faz o `set_invoice` pendurar uma parcela `pending` numa
     * fatura que já foi paga, adiada ou parcialmente paga — e ali ela some de toda leitura de
     * caixa, porque todas filtram `status not in ('paid','rolled')`. É o espelho do bug que a
     * `20260909071000` fechou no caminho da edição com escopo.
     *
     * A checagem reaproveita a régua: depois de reescrever, nenhuma parcela deste plano pode
     * estar travada — se estiver, ela caiu num lugar fechado e a transação inteira volta.
     */
    if exists (
      select 1 from public.transactions t
      where t.installment_plan_id = p_plan_id
        and t.workspace_id = plano.workspace_id
        and private.parcela_travada(t.status, t.invoice_id)
    ) then
      raise exception 'Essa data (ou essa conta) joga uma parcela dentro de uma fatura já fechada. Escolha outra.';
    end if;
  else
    /*
     * Nome, estabelecimento e CATEGORIA valem para todas as parcelas, inclusive as pagas.
     * Dinheiro, data e conta, não.
     *
     * ⚠️ A categoria é decisão declarada, não descuido. `update_transaction_scoped` diz "o
     * passado só muda à mão" — e ali está certo, porque lá o que propaga é VALOR. Aqui a
     * categoria é atributo da COMPRA: deixar as 3 parcelas pagas em "eletrônicos" e as 9 em
     * "lazer" parte o relatório dessa compra em dois para sempre, que é pior do que o efeito
     * colateral conhecido — `budgets_status_for` agrupa por categoria dentro da janela, então
     * o orçamento de um mês fechado se remaneja. Ele se remaneja para a verdade: o dinheiro
     * foi gasto naquela categoria, e nenhum número é materializado.
     */
    update public.transactions t set
      description = nome || ' (' || t.installment_no || '/' || p_installments || ')',
      merchant    = p_merchant,
      category    = p_category
    where t.installment_plan_id = p_plan_id
      and t.workspace_id = plano.workspace_id
      and t.installment_no is not null;

    if editaveis > 0 then
      restante := p_total_cents - travado_cents;
      base := restante / editaveis;
      ordem := 0;
      for parcela in
        select t.id from public.transactions t
        where t.installment_plan_id = p_plan_id
          and t.workspace_id = plano.workspace_id
          and not private.parcela_travada(t.status, t.invoice_id)
        order by t.installment_no
      loop
        ordem := ordem + 1;
        update public.transactions t
           set amount_cents = case when ordem = editaveis
                                then restante - base * (editaveis - 1) else base end
         where t.id = parcela.id and t.workspace_id = plano.workspace_id;
      end loop;
    end if;
  end if;

  -- A invariante do modelo: a soma das parcelas É o total. Falhar aqui desfaz tudo.
  select coalesce(sum(t.amount_cents), 0) into soma
  from public.transactions t
  where t.installment_plan_id = p_plan_id and t.workspace_id = plano.workspace_id;
  if soma <> p_total_cents then
    raise exception 'a soma das parcelas (%) não fecha com o total (%)', soma, p_total_cents;
  end if;

  return p_installments;
end;
$$;

revoke execute on function public.update_installment_plan(uuid,bigint,int,date,text,text,text,uuid)
  from public, anon;
grant execute on function public.update_installment_plan(uuid,bigint,int,date,text,text,text,uuid)
  to authenticated, service_role;

comment on function public.update_installment_plan(uuid,bigint,int,date,text,text,text,uuid) is
  'Edita a compra parcelada inteira: total, número de parcelas, nome, estabelecimento, categoria, conta e data da primeira. Parcela já paga (ou em fatura paga, adiada ou parcialmente paga) nunca muda de valor, data ou conta; com qualquer parcela paga, o número de parcelas, a data e a conta ficam travados e só o saldo em aberto se redistribui. Grava o plano INTEIRO — quem chama manda todos os campos.';
