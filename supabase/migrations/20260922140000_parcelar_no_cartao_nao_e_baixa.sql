-- Parcelar no CARTÃO um lançamento que já existe não pode travar a compra para sempre.
--
-- A queixa (22/09/2026): *"não consegui editar o lançamento wardogs, ele já está criado como
-- parcelado em 2x, mas se eu tento mudar de parcelado para à vista, eu não consigo, não consigo
-- mudar o valor, tá tudo travado"*.
--
-- ⚠️ **A causa é o default da coluna, não a régua.** `transactions.status` nasce `'cleared'`
-- (`0013`), e é assim que toda compra À VISTA no cartão é gravada — pelo app (o form só marca
-- `pending` no "vou pagar depois", que não existe em cartão) e pelo agente. Numa linha de cartão
-- esse `cleared` não quer dizer "paga": quem diz se o dinheiro saiu é a FATURA. Mas
-- `convert_transaction_to_installments` (`20260920120000`) ADOTA a linha como parcela 1 e
-- "mantém o status" — então a parcela 1 de toda compra parcelada DEPOIS no cartão nascia
-- `cleared`, e `private.parcela_travada` a lia como paga. Com uma parcela "paga", a
-- `update_installment_plan` recusa 1x, a data, a conta e o número de parcelas, e o editor da
-- compra desliga tudo menos nome e categoria. Nada estava pago: a fatura seguia aberta.
--
-- ⚠️ **A régua (`parcela_travada`) NÃO muda, e isso é decisão.** Numa linha de cartão `cleared`
-- também é pagamento de verdade: o histórico da criação ("3 das 12 já foram pagas",
-- `create_installment_plan_with_history`) grava as antigas `cleared` dentro de faturas que o app
-- nunca viu serem pagas. Afrouxar a régua liberaria reescrever esse passado. O erro é UM
-- caminho escrever `cleared` sem ter havido baixa, e é ele que se corrige:
--
--   1. a conversão PARA um cartão grava a parcela 1 como `pending`, igual às 2..N e igual à
--      criação — quem baixa linha de cartão é o pagamento da fatura (`pay_invoice`);
--   2. fora do cartão o `cleared` continua (o dinheiro saiu da conta), e converter um lançamento
--      baixado segue de mão única, com o aviso da tela;
--   3. as parcelas 1 que JÁ nasceram assim são consertadas aqui (ver o fim do arquivo).
--
-- ⚠️ `create or replace` preserva dono e grants e APAGA o resto: `security invoker` e
-- `search_path` vão no cabeçalho, como na `20260920120000`. O corpo é o mesmo, exceto `acc.type`
-- e o `status` da adoção.

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
  select a.id, a.workspace_id, a.type into acc
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
    -- ⚠️ No CARTÃO a linha adotada vira `pending`, como as irmãs: o `cleared` que ela trazia é
    -- o default da compra à vista, não uma baixa — e lido como baixa por `parcela_travada`, ele
    -- travava a compra inteira (ver o cabeçalho). Fora do cartão o dinheiro já saiu: mantém.
    status              = case when acc.type = 'credit_card' then 'pending' else tx.status end,
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

-- --------------------------------------------------------------------------
-- as parcelas 1 que já nasceram travadas por engano
-- --------------------------------------------------------------------------
-- Adotada = a linha é MAIS VELHA que o plano (a criação grava plano e parcelas no mesmo
-- statement, com o mesmo `now()`, e o histórico "já pagas" nasce junto). Só cartão, só `cleared`,
-- e só com a fatura ABERTA: fatura paga, adiada ou paga em parte continua travando pela própria
-- régua, e a quitação (`pay_invoice`) já marca as linhas dela `cleared` de verdade.
-- Idempotente: rodar de novo não acha mais nada.
update public.transactions t
   set status = 'pending'
  from public.installment_plans p, public.accounts a
 where t.installment_plan_id = p.id
   and t.installment_no = 1
   and t.status = 'cleared'
   and t.created_at < p.created_at
   and a.id = t.account_id
   and a.type = 'credit_card'
   and not private.parcela_travada('pending', t.invoice_id);
