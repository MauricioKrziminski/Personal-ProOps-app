-- A compra parcelada nasceu SEM NOME, e o nome existia — só não chegava aqui.
--
-- Medido em produção em 15/09/2026. O dono do produto cadastrou uma compra pelo app e depois
-- não achou nada: *"eu cadastrei o lançamento nuuvem wardog e nao encontrei nada no app, mas
-- parece que esta contando no saldo do ciclo"*. E estava mesmo contando — o plano
-- `96c70258` (R$ 104,99 em 2x) tinha `description`, `merchant` e `category` todos NULL, e as
-- duas parcelas na fatura de outubro liam **"Compra parcelada (1/2)"**.
--
-- Eram DOIS defeitos no mesmo caminho, e só corrigir um deixa a tela igual:
--
-- 1. **O app nunca mandava `p_merchant`.** `useCreateInstallmentPlan` monta o payload da RPC
--    campo a campo e o 8º parâmetro não estava lá — o formulário tem "Estabelecimento", a
--    pessoa preenche, e o valor morria no hook. Medida na produção: de 311 transações, UMA
--    tinha `merchant`, e veio de `import`; dos 11 planos, ZERO. Corrigido no app, não aqui.
--
-- 2. **Esta função escondia o `merchant` mesmo quando ele chegava** — é o que esta migration
--    conserta. O texto de cada parcela era `coalesce(p_description, 'Compra parcelada')`, que
--    força a linha a ter nome próprio SEMPRE: com descrição vazia e estabelecimento
--    preenchido, `merchant` ia para a coluna e nunca aparecia, porque quem lê a linha
--    (`tx.description ?? tx.merchant`, na tela da fatura e no detalhe) nunca chegava no
--    segundo termo. `installments.tsx` já era `merchant || description` e teria mostrado o
--    nome; a fatura, não.
--
-- A correção é uma palavra: `coalesce(p_description, p_merchant, 'Compra parcelada')`. O
-- literal continua existindo para quem não informou nem um nem outro.
--
-- ⚠️ **`CREATE OR REPLACE` apaga toda cláusula que a definição nova não repetir** — é a
-- armadilha escrita em `finance.md`, que já custou a `security definer` de um trigger e o
-- `set timezone` de `cycle_now`. O cabeçalho vai INTEIRO abaixo (`language plpgsql`,
-- `security invoker`, `set search_path = public`), idêntico ao da `20260908153143`. Não há
-- `set timezone` a preservar: `current_date` não aparece nem na assinatura nem no corpo desta
-- função — quem tem o default na assinatura é a casca `create_installment_plan`, que esta
-- migration não toca.
--
-- ⚠️ **Tipo de retorno inalterado (`uuid`)**, então é `replace` de verdade: não precisa de
-- `drop`, e os grants (`revoke ... from public, anon` + `grant ... to authenticated,
-- service_role`) sobrevivem. Foi o par `200000`/`220000` que ensinou a conferir isso.
--
-- ⚠️ **O passado NÃO é reescrito.** O plano que já nasceu sem nome continua sem nome — o
-- caminho é editar a parcela no app com escopo "esta e as futuras", que propaga `merchant`.
-- Um `update` retroativo aqui mexeria em linha de fatura já fechada para adivinhar um texto.

create or replace function public.create_installment_plan_with_history(
  p_account_id uuid,
  p_total_cents bigint,
  p_installments int,
  p_occurred_at date,
  p_paid_installments int,
  p_description text default null,
  p_category text default null,
  p_merchant text default null
)
returns uuid
language plpgsql security invoker
set search_path = public
as $$
declare
  acc record;
  plan_id uuid;
  base_cents bigint;
  parcela_cents bigint;
  data_parcela date;
  i int;
begin
  if p_installments is null or p_installments < 2 or p_installments > 72 then
    raise exception 'parcelas fora do intervalo 2..72: %', p_installments;
  end if;
  if p_total_cents is null or p_total_cents < p_installments then
    raise exception 'total precisa permitir pelo menos um centavo por parcela';
  end if;
  if p_occurred_at is null then raise exception 'Informe a data da primeira parcela'; end if;
  if p_paid_installments is null or p_paid_installments < 0 or p_paid_installments > p_installments then
    raise exception 'Informe quantas parcelas iniciais já foram pagas, entre 0 e %', p_installments;
  end if;

  select a.id, a.workspace_id, a.user_id into acc
  from public.accounts a where a.id = p_account_id and not a.archived;
  if acc.id is null then
    raise exception 'conta % não encontrada', p_account_id;
  end if;

  insert into public.installment_plans
    (workspace_id, user_id, account_id, description, merchant, category,
     total_cents, installments, first_occurred_at)
  values (acc.workspace_id, coalesce((select auth.uid()), acc.user_id), p_account_id,
          p_description, p_merchant, p_category, p_total_cents, p_installments, p_occurred_at)
  returning id into plan_id;

  base_cents := p_total_cents / p_installments;  -- divisão inteira: nunca float
  for i in 1..p_installments loop
    parcela_cents := case when i = p_installments
      then p_total_cents - base_cents * (p_installments - 1)
      else base_cents end;
    data_parcela := private.add_months(p_occurred_at, i - 1);

    insert into public.transactions
      (workspace_id, user_id, kind, amount_cents, category, description, merchant,
       account_id, occurred_at, source, status, installment_plan_id, installment_no)
    values (acc.workspace_id, coalesce((select auth.uid()), acc.user_id), 'expense',
            parcela_cents, p_category,
            -- ⚠️ `p_merchant` no meio do coalesce é a correção de 15/09/2026. Quem informou
            -- só o estabelecimento tinha a compra gravada como "Compra parcelada (1/2)", e
            -- o nome ficava numa coluna que a tela da fatura não lê.
            coalesce(p_description, p_merchant, 'Compra parcelada')
              || ' (' || i || '/' || p_installments || ')',
            p_merchant, p_account_id, data_parcela, 'app',
            case when i <= p_paid_installments then 'cleared' else 'pending' end,
            plan_id, i);
  end loop;

  return plan_id;
end;
$$;
