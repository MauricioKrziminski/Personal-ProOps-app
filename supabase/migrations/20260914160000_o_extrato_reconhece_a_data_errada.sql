-- O extrato passa a reconhecer o lançamento que JÁ EXISTE no app com a data errada.
--
-- Conciliando a fatura Nubank de outubro contra o app em 14/09/2026 (OFX, 23 débitos,
-- R$ 3.660,25), o valor batia no centavo e mesmo assim **6 lançamentos estavam com a data
-- errada**. O dedupe de hoje exige data IGUAL, valor IGUAL e descrição normalizada IGUAL — então
-- um lançamento 2 dias fora não casa, entra como novo, e o usuário fica com a compra em
-- duplicidade. Foi preciso cruzar na mão, em SQL, para achar; é essa conciliação que mantém a
-- planilha viva.
--
-- ⚠️ **Um `near_match` é uma OFERTA de alterar um lançamento real.** Falso positivo não gera
-- erro: ele corrompe a data de OUTRA compra, e o estrago aparece meses depois num mês fechado.
-- Por isso a régua é mais estreita que "mesmo valor em 5 dias", que num extrato de verdade casa
-- dois cafés de R$ 12 na mesma semana. São QUATRO travas, e as duas últimas são de unicidade:
--
--   1. mesmo valor, mesmo `kind` e, quando o lote tem conta, a MESMA conta — um gasto de R$ 50
--      no cartão não pode casar com um Pix de R$ 50 na corrente;
--   2. diferença de data de até 5 dias, e a transação não pode já ter casado EXATO com nenhum
--      item deste lote (essa já virou `duplicate`);
--   3. **o item tem exatamente UM candidato** — dois, e ele fica `pending`. É "na dúvida,
--      PERGUNTA, nunca deduz" (`.claude/rules/agent.md`) aplicado à importação: uma linha a mais
--      para revisar é barata, alterar a compra errada não é;
--   4. **cada transação é reivindicada por UM item só** — dois itens de mesmo valor a 3 dias um
--      do outro apontariam para a mesma compra. O `row_number()` decide pelo mais próximo em
--      data, e o índice parcial abaixo segura a regra mesmo se `_prepare_import_batch` rodar de
--      novo no mesmo lote.
--
-- ⚠️ **Descrição NÃO entra na régua, de propósito.** Exigir descrição igual mataria justamente o
-- caso em que o usuário renomeou o lançamento à mão ("Mercado" → "Feira da semana"). Quem decide
-- se é a mesma compra é a PESSOA, na tela, com a descrição do app e a do extrato lado a lado —
-- o código só oferece o par.
--
-- ⚠️ `create or replace`, sem `drop`: o tipo de retorno não muda, e assim a ACL
-- (`postgres=X | service_role=X`) é preservada. Conferida antes de escrever, pelo mesmo motivo
-- que a `20260914140000` documenta. O cabeçalho (`security definer`, `search_path`) vai repetido
-- porque `create or replace` apaga o que a definição nova não trouxer.

alter table public.import_items drop constraint if exists import_items_status_check;
alter table public.import_items add constraint import_items_status_check
  check (status in ('pending', 'approved', 'discarded', 'duplicate', 'near_match'));

-- Trava 4, no banco e não só na query: um lançamento do app é alvo de um item por vez.
create unique index if not exists import_items_near_match_unico
  on public.import_items (transaction_id)
  where status = 'near_match';

create or replace function public._prepare_import_batch(p_batch_id uuid)
returns table (total integer, categorizados integer, duplicados integer)
language plpgsql security definer set search_path = public
as $function$
declare
  ws_id uuid;
  acct_id uuid;
begin
  select b.workspace_id, b.account_id into ws_id, acct_id
  from public.import_batches b where b.id = p_batch_id;
  if ws_id is null then
    raise exception 'lote % não encontrado', p_batch_id;
  end if;

  update public.import_items i
  set suggested_category = m.category,
      suggested_account_id = coalesce(i.suggested_account_id, m.account_id)
  from (
    select it.id, r.category, r.account_id
    from public.import_items it
    cross join lateral public._match_rule(ws_id, it.description) r
    where it.batch_id = p_batch_id and it.suggested_category is null
  ) m
  where i.id = m.id and m.category is not null;

  -- 1. Casamento EXATO: data, valor e descrição normalizada. Continua igual.
  update public.import_items i
  set status = 'duplicate'
  where i.batch_id = p_batch_id
    and i.status = 'pending'
    and exists (
      select 1 from public.transactions t
      where t.workspace_id = ws_id
        and t.occurred_at = i.occurred_at
        and t.amount_cents = i.amount_cents
        and private.normalize_description(t.description)
            = private.normalize_description(i.description)
    );

  -- 2. Casamento APROXIMADO: o mesmo dinheiro, alguns dias fora. Ver as quatro travas no topo.
  with candidatos as (
    select i.id as item_id, t.id as tx_id,
           count(*) over (partition by i.id) as candidatos_do_item,
           row_number() over (
             partition by t.id
             order by abs(t.occurred_at - i.occurred_at), i.occurred_at, i.id
           ) as posicao_no_alvo
    from public.import_items i
    join public.transactions t
      on t.workspace_id = ws_id
     and t.amount_cents = i.amount_cents
     and t.kind = i.kind
     and abs(t.occurred_at - i.occurred_at) <= 5
     and (acct_id is null or t.account_id = acct_id)
     -- Já existe um item deste lote que casa EXATO com ela: aquele é o dono.
     and not exists (
       select 1 from public.import_items e
       where e.batch_id = p_batch_id
         and e.occurred_at = t.occurred_at
         and e.amount_cents = t.amount_cents
         and private.normalize_description(e.description)
             = private.normalize_description(t.description)
     )
     -- E ela não pode já estar reservada por outro lote em revisão.
     and not exists (
       select 1 from public.import_items o
       where o.transaction_id = t.id and o.status = 'near_match'
     )
    where i.batch_id = p_batch_id and i.status = 'pending'
  )
  update public.import_items i
  set status = 'near_match', transaction_id = c.tx_id
  from candidatos c
  where i.id = c.item_id
    and c.candidatos_do_item = 1
    and c.posicao_no_alvo = 1;

  return query
  select count(*)::int,
         count(*) filter (where i.suggested_category is not null)::int,
         -- `duplicados` continua contando só o casamento EXATO: é o número que a tela já mostra
         -- ("N possíveis repetidos ficam de fora"), e somar os aproximados aqui mudaria o
         -- significado de uma coluna que três lugares já leem.
         count(*) filter (where i.status = 'duplicate')::int
  from public.import_items i
  where i.batch_id = p_batch_id;
end;
$function$;
