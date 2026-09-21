-- Parcelar um lançamento que já existe — e desparcelar de volta.
--
-- A queixa foi literal (19/09/2026): *"não consigo editar o lançamento criado sem parcelar,
-- colocando a parcela"*, e logo em seguida *"quando eu consegui editar, ele duplicou"*. As duas
-- frases são a mesma coisa: **o caminho não existia**, e o jeito de contornar era lançar outra
-- vez — o que deixa as duas compras na fatura. O print mostrava "Wardogs Nuuvem (1/2)" e
-- "Compra parcelada (1/2)", 52,49 cada, em dias diferentes.
--
-- ⚠️ **A transação existente é ADOTADA como parcela 1. O `id` não muda.** É isto que torna a
-- duplicação impossível por construção, e é a mesma regra que a `20260915210000` escreveu para o
-- reparcelamento: apagar e inserir trocaria os `id`s, e o `last_write_id` do agente, um
-- `pending_actions` esperando confirmação e qualquer referência futura apontariam para linha
-- morta.
--
-- ⚠️ **Converter DUAS VEZES é recusa, não segundo plano.** A linha já parcelada é rejeitada pelo
-- `installment_plan_id is not null`. Uma retentativa — rede que caiu depois do commit, dedo duplo
-- no botão — nunca cria um plano a mais. Num caminho de dinheiro, a idempotência não é conforto:
-- é a diferença entre remandar e gravar duas compras que ninguém fez.
--
-- ⚠️ **Parcela 1 já paga é o caso NORMAL, e por isso ela é liberada.** Converter é a correção de
-- uma compra lançada errado ("300 no mercado" que era 3x), e a primeira parcela normalmente já
-- aconteceu. Ela mantém o status; 2..N nascem `pending`. O que NÃO se libera é a FATURA fechada:
-- `paid`, `rolled` ou `paid_cents > 0` recusam, porque baixar o valor de uma compra ali derruba
-- `private.invoice_open_cents` (`sum(linhas) − paid_cents`) para negativo e `pay_invoice` passa a
-- recusar a quitação com `aberto <= 0` — a fatura fica impossível de fechar, sem uma linha de erro
-- em lugar nenhum. É o terceiro caso de `private.parcela_travada`, o que não aparece em teste
-- nenhum.
--
-- ⚠️ **Desparcelar entra na `update_installment_plan` como `p_installments = 1`**, não numa função
-- nova: ela já é a dona do contrato da compra, já tem o `for update` e já tem as travas. Uma
-- segunda função seria a segunda cópia delas. E o guarda que já existia
-- (`p_installments <> plano.installments`) cobre sozinho o caso perigoso: com qualquer parcela
-- paga, `1 <> N` recusa com a mensagem certa.
--
-- ⚠️ **A ORDEM do dissolve é o que impede apagar o dado.** `transactions.installment_plan_id` é
-- `on delete cascade`: apagar o plano primeiro levaria a linha sobrevivente junto, em silêncio.
-- Solta o sobrevivente → apaga os irmãos → apaga o plano.
--
-- MEDIDO no staging em 20/09/2026, com um plano de 3 parcelas criado pela RPC de criação e o
-- `id` da parcela 1 guardado antes: com a ordem certa o sobrevivente CONTINUA existindo
-- (`count = 1`); apagando o plano primeiro, o mesmo `id` devolve `count = 0`. Não é risco
-- teórico — é o dado do usuário indo embora sem erro nenhum.
--
-- ⚠️ **`installment_plans.installments` tem `check between 2 and 72`**, então o ramo do dissolve
-- roda ANTES do `update installment_plans` e termina apagando o plano — nunca gravando `1` nele.
--
-- ⚠️ **`create or replace` preserva dono e permissões e APAGA o resto.** A
-- `update_installment_plan` é reescrita inteira aqui, com `security invoker` e
-- `set search_path = public` no CABEÇALHO. Ela nunca teve `set timezone` (não usa `current_date`),
-- e continua sem.

-- --------------------------------------------------------------------------
-- o valor de UMA parcela — uma régua, três chamadores
-- --------------------------------------------------------------------------
-- A conta estava escrita à mão em `create_installment_plan_with_history` e em
-- `update_installment_plan`; com a conversão seriam TRÊS cópias da mesma expressão, e o modo de
-- falha dela é mudo: um total que deixa de ser a soma do que está embaixo dele.
create or replace function private.valor_da_parcela(
  p_total_cents bigint, p_installments int, p_indice int
)
returns bigint
language sql
immutable
set search_path = public
as $$
  -- Divisão INTEIRA (nunca float) e o resto na ÚLTIMA parcela: é o que faz a soma fechar.
  select case
    when p_indice = p_installments
      then p_total_cents - (p_total_cents / p_installments) * (p_installments - 1)
    else p_total_cents / p_installments
  end;
$$;

revoke execute on function private.valor_da_parcela(bigint, int, int) from public, anon;
grant execute on function private.valor_da_parcela(bigint, int, int) to authenticated, service_role;

comment on function private.valor_da_parcela(bigint, int, int) is
  'O valor da i-ésima parcela: divisão inteira, com o resto na última. Régua única da criação, da edição e da conversão.';

-- --------------------------------------------------------------------------
-- converter: o lançamento que existe vira a parcela 1 de uma compra parcelada
-- --------------------------------------------------------------------------
create or replace function public.convert_transaction_to_installments(
  p_transaction_id uuid,
  p_total_cents bigint,
  p_installments int,
  p_first_occurred_at date,
  p_description text default null,
  p_category text default null,
  p_merchant text default null,
  p_account_id uuid default null
)
returns uuid
language plpgsql security invoker
set search_path = public
as $$
declare
  tx record;
  acc record;
  plano uuid;
  nome text;
  i int;
  soma bigint;
begin
  -- `security invoker`: a RLS de `transactions` já responde "não é seu" como "não existe".
  --
  -- ⚠️ `for update` porque o estado da linha é MEDIDO num statement e usado em outro: em READ
  -- COMMITTED cada statement pega snapshot novo, e um `pay_invoice` que commita no meio mudaria o
  -- que se está convertendo. Mesmo cinto de `update_installment_plan`.
  select t.* into tx from public.transactions t where t.id = p_transaction_id for update;
  if tx.id is null then
    raise exception 'Não achei esse lançamento.';
  end if;

  -- A idempotência do caminho. Ver o ⚠️ do cabeçalho.
  if tx.installment_plan_id is not null then
    raise exception 'Esse lançamento já é uma compra parcelada. Edite a compra inteira em Parceladas.';
  end if;
  if tx.kind <> 'expense' then
    raise exception 'Só gasto vira compra parcelada.';
  end if;
  if tx.recurring_id is not null then
    raise exception 'Esse lançamento é uma ocorrência de uma série recorrente: edite a série, não a ocorrência.';
  end if;
  if tx.debt_id is not null then
    raise exception 'Esse lançamento é a parcela de um financiamento: o cronograma dele manda na divisão.';
  end if;
  -- ⚠️ **O saldo adiado de uma fatura NÃO é compra nova.** Ele é `expense` comum, sem `debt_id`
  -- e sem `recurring_id`, então passaria por todas as guardas acima — e a coluna que o mantém
  -- fora da competência (`rollover_of_invoice_id`, lida por 11 leituras desde a `20260911040000`)
  -- NÃO seria copiada para as parcelas 2..N. O principal, já contado quando as compras foram
  -- feitas, voltaria como despesa NOVA em N−1 meses, comendo orçamento, sem erro nenhum.
  if tx.rollover_of_invoice_id is not null then
    raise exception 'Esse lançamento é o saldo adiado de uma fatura: ele não é uma compra nova para parcelar.';
  end if;

  if p_installments is null or p_installments < 2 or p_installments > 72 then
    raise exception 'Escolha pelo menos 2 parcelas (e no máximo 72).';
  end if;
  if p_total_cents is null or p_total_cents < p_installments then
    raise exception 'O total precisa sobrar pelo menos um centavo para cada parcela.';
  end if;
  if p_first_occurred_at is null then
    raise exception 'Informe a data da primeira parcela';
  end if;

  -- ⚠️ Conta é obrigatória aqui, ao contrário da edição do plano. A compra parcelada existe para
  -- cair numa fatura; sem conta, o `set_invoice` deixa as N linhas soltas e a divisão não tem onde
  -- acontecer. Na criação isso é impossível (a busca não acha conta nula); aqui é explícito.
  if p_account_id is null then
    raise exception 'Escolha a conta ou o cartão desta compra.';
  end if;
  select a.id, a.workspace_id into acc
  from public.accounts a where a.id = p_account_id and not a.archived;
  if acc.id is null or acc.workspace_id <> tx.workspace_id then
    raise exception 'Escolha uma conta ativa.';
  end if;

  -- A trava da FATURA, e só ela: o status `cleared` da linha original é liberado de propósito.
  -- `'pending'` no primeiro argumento isola o lado da fatura da régua.
  if private.parcela_travada('pending', tx.invoice_id) then
    raise exception 'A fatura desse lançamento já foi paga, adiada ou paga em parte: ele não pode ser parcelado agora.';
  end if;

  nome := coalesce(p_description, p_merchant, 'Compra parcelada');

  insert into public.installment_plans
    (workspace_id, user_id, account_id, description, merchant, category,
     total_cents, installments, first_occurred_at)
  values (tx.workspace_id, coalesce((select auth.uid()), tx.user_id), p_account_id,
          p_description, p_merchant, p_category, p_total_cents, p_installments,
          p_first_occurred_at)
  returning id into plano;

  -- A ADOÇÃO. `occurred_at` e `account_id` estão no `set`, então o `set_invoice` roda e
  -- reclassifica a fatura desta linha — que é o efeito desejado: a data da primeira parcela pode
  -- ter mudado no mesmo formulário.
  update public.transactions t set
    installment_plan_id = plano,
    installment_no      = 1,
    amount_cents        = private.valor_da_parcela(p_total_cents, p_installments, 1),
    occurred_at         = p_first_occurred_at,
    description         = nome || ' (1/' || p_installments || ')',
    merchant            = p_merchant,
    category            = p_category,
    account_id          = p_account_id,
    -- ⚠️ O `due_at` do lançamento antigo não vale mais. Em cartão o trigger o reescreve com o
    -- vencimento da fatura; FORA do cartão, um vencimento preenchido à mão ficaria velho enquanto
    -- as parcelas 2..N nascem nulas — e a projeção, que lê `coalesce(due_at, occurred_at)`,
    -- jogaria a parcela 1 num mês e as outras noutro.
    due_at              = null
  where t.id = p_transaction_id and t.workspace_id = tx.workspace_id;

  -- 2..N nascem pendentes, como na criação.
  for i in 2..p_installments loop
    insert into public.transactions
      (workspace_id, user_id, kind, amount_cents, category, description, merchant,
       account_id, occurred_at, source, status, installment_plan_id, installment_no)
    values (tx.workspace_id, coalesce((select auth.uid()), tx.user_id), 'expense',
            private.valor_da_parcela(p_total_cents, p_installments, i),
            p_category, nome || ' (' || i || '/' || p_installments || ')',
            p_merchant, p_account_id,
            private.add_months(p_first_occurred_at, i - 1),
            'app', 'pending', plano, i);
  end loop;

  /*
   * ⚠️ **O estado de ANTES não fala do destino.** Mudar a data da primeira parcela (ou a conta)
   * pode pendurar uma parcela `pending` numa fatura já paga, adiada ou parcialmente paga — e ali
   * ela some de toda leitura de caixa, porque todas filtram `status not in ('paid','rolled')`. É
   * a mesma checagem que a `20260915210000` faz depois de reescrever.
   *
   * A parcela 1 entra com `'pending'` forçado no primeiro argumento: o status `cleared` dela já
   * foi liberado lá em cima, e o que se confere aqui é só onde ela CAIU.
   */
  if exists (
    select 1 from public.transactions t
    where t.installment_plan_id = plano
      and t.workspace_id = tx.workspace_id
      and private.parcela_travada(
            case when t.installment_no = 1 then 'pending' else t.status end, t.invoice_id)
  ) then
    raise exception 'Essa data (ou essa conta) joga uma parcela dentro de uma fatura já fechada. Escolha outra.';
  end if;

  -- A invariante do modelo: a soma das parcelas É o total. Falhar aqui desfaz tudo.
  select coalesce(sum(t.amount_cents), 0) into soma
  from public.transactions t
  where t.installment_plan_id = plano and t.workspace_id = tx.workspace_id;
  if soma <> p_total_cents then
    raise exception 'a soma das parcelas (%) não fecha com o total (%)', soma, p_total_cents;
  end if;

  return plano;
end;
$$;

revoke execute on function
  public.convert_transaction_to_installments(uuid,bigint,int,date,text,text,text,uuid)
  from public, anon;
grant execute on function
  public.convert_transaction_to_installments(uuid,bigint,int,date,text,text,text,uuid)
  to authenticated, service_role;

comment on function
  public.convert_transaction_to_installments(uuid,bigint,int,date,text,text,text,uuid) is
  'Transforma um lançamento simples em compra parcelada ADOTANDO a linha existente como parcela 1 (o id não muda). Recusa linha que já é parcela, receita, ocorrência de recorrência, parcela de financiamento, e linha em fatura paga/adiada/paga em parte. Chamar duas vezes é recusa, nunca um segundo plano.';

-- --------------------------------------------------------------------------
-- editar a compra inteira — agora aceitando 1x, que DISSOLVE o plano
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
  nome text;
  i int;
  ordem int;
  soma bigint;
  parcela record;
  sobrevivente uuid;
begin
  select p.* into plano from public.installment_plans p where p.id = p_plan_id for update;
  if plano.id is null then
    raise exception 'Não achei essa compra parcelada.';
  end if;

  /*
   * ⚠️ **O lock que importa é nas PARCELAS, não no plano — e a versão anterior travava a linha
   * errada.** O comentário da `20260915210000` dizia que o `for update` no plano protegia contra
   * "um `pay_invoice` que commita no meio". Ele NÃO protege: `pay_invoice` escreve em
   * `card_invoices` e em `transactions` e **nunca toca em `installment_plans`** (conferido na
   * `20260911070000`), então o lock não serializa nada.
   *
   * A janela real: mede `travadas = 0` → um `pay_invoice` concorrente commita na fatura de uma
   * parcela irmã (soma `paid_cents`, marca as linhas) → o `update`/`delete` daqui mexe numa linha
   * de fatura já paga → `private.invoice_open_cents` (`sum(linhas) − paid_cents`) fica NEGATIVO e
   * `pay_invoice` passa a recusar a quitação com `aberto <= 0`. A fatura fica impossível de
   * fechar, sem uma linha de erro em lugar nenhum — é o terceiro caso de `parcela_travada`,
   * justamente o que o cabeçalho da `20260915210000` chama de "o que não aparece em teste nenhum".
   *
   * Travando as LINHAS antes de medir, o `pay_invoice` concorrente espera. `for update` não vale
   * em consulta com agregado, então é um `perform` à parte.
   */
  perform 1 from public.transactions t
   where t.installment_plan_id = p_plan_id and t.workspace_id = plano.workspace_id
   for update;

  -- ⚠️ O piso virou 1: `1` é "à vista", e ele DISSOLVE o plano (ramo mais abaixo).
  if p_installments is null or p_installments < 1 or p_installments > 72 then
    raise exception 'O número de parcelas precisa ficar entre 1 e 72.';
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

  -- Regra 2 do cabeçalho da 20260915210000: com parcela paga, só o dinheiro em aberto se
  -- redistribui. Como `1 <> plano.installments` sempre, este mesmo guarda RECUSA o dissolve
  -- quando há parcela paga — que é exatamente o que se quer, com a mensagem que já existia.
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
  -- em silêncio.
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

  nome := coalesce(p_description, p_merchant, 'Compra parcelada');

  /*
   * ── 1x: a compra deixa de ser parcelada ───────────────────────────────────
   *
   * Só chega aqui com `travadas = 0` (o guarda acima recusa `1 <> N` com parcela paga).
   *
   * ⚠️ **A ORDEM é o que impede apagar o dado.** `transactions.installment_plan_id` é
   * `on delete cascade`: apagar o plano primeiro levaria o sobrevivente junto, em silêncio.
   * Solta o sobrevivente → apaga os irmãos → apaga o plano.
   *
   * ⚠️ **O sobrevivente é a parcela 1**, não uma linha nova: mesmo motivo de sempre — o `id` é
   * referência viva para o agente e para o HITL.
   *
   * ⚠️ **`installment_plans.installments` tem `check between 2 and 72`**, então este ramo roda
   * ANTES do `update` do plano. Nada grava `1` ali.
   *
   * ⚠️ **O sufixo "(1/N)" tem que SAIR.** Ele é derivado; deixar "Mercado (1/3)" num lançamento
   * que não é mais parcelado é mentira na linha da fatura.
   */
  if p_installments = 1 then
    select t.id into sobrevivente
    from public.transactions t
    where t.installment_plan_id = p_plan_id
      and t.workspace_id = plano.workspace_id
    order by t.installment_no
    limit 1;
    if sobrevivente is null then
      raise exception 'Essa compra não tem parcela nenhuma para virar lançamento.';
    end if;

    update public.transactions t set
      installment_plan_id = null,
      installment_no      = null,
      amount_cents        = p_total_cents,
      occurred_at         = p_first_occurred_at,
      description         = nome,
      merchant            = p_merchant,
      category            = p_category,
      account_id          = p_account_id
    where t.id = sobrevivente and t.workspace_id = plano.workspace_id;

    -- ⚠️ `t.id <> sobrevivente` é cinto: sem ele, a ORDEM destas três linhas é a única coisa
    -- entre o dado do usuário e o `on delete cascade`. Custa nada e tira o peso da ordem.
    delete from public.transactions t
     where t.installment_plan_id = p_plan_id
       and t.workspace_id = plano.workspace_id
       and t.id <> sobrevivente;

    delete from public.installment_plans p
     where p.id = p_plan_id and p.workspace_id = plano.workspace_id;

    -- Mesma checagem de destino do outro ramo: a data nova não pode jogar a linha numa fatura
    -- já fechada.
    if (select private.parcela_travada('pending', t.invoice_id)
        from public.transactions t where t.id = sobrevivente) then
      raise exception 'Essa data (ou essa conta) joga o lançamento dentro de uma fatura já fechada. Escolha outra.';
    end if;

    return 1;
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

  if travadas = 0 then
    delete from public.transactions t
     where t.installment_plan_id = p_plan_id
       and t.workspace_id = plano.workspace_id
       and (t.installment_no is null or t.installment_no > p_installments);

    for i in 1..p_installments loop
      update public.transactions t set
        amount_cents = private.valor_da_parcela(p_total_cents, p_installments, i),
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
                private.valor_da_parcela(p_total_cents, p_installments, i),
                p_category, nome || ' (' || i || '/' || p_installments || ')',
                p_merchant, p_account_id,
                private.add_months(p_first_occurred_at, i - 1),
                'app', 'pending', p_plan_id, i);
      end if;
    end loop;

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
           set amount_cents = private.valor_da_parcela(restante, editaveis, ordem)
         where t.id = parcela.id and t.workspace_id = plano.workspace_id;
      end loop;
    end if;
  end if;

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
  'Edita a compra parcelada inteira: total, número de parcelas, nome, estabelecimento, categoria, conta e data da primeira. `p_installments = 1` DISSOLVE o plano e devolve um lançamento à vista (a parcela 1 sobrevive, com o mesmo id). Parcela já paga (ou em fatura paga, adiada ou parcialmente paga) nunca muda de valor, data ou conta; com qualquer parcela paga, o número de parcelas, a data e a conta ficam travados e só o saldo em aberto se redistribui. Grava o plano INTEIRO — quem chama manda todos os campos.';
