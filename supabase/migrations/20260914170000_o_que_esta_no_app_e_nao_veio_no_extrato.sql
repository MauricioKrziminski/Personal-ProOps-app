-- A outra metade da conciliação: o que está no APP e não veio no extrato.
--
-- O import de hoje olha numa direção só — arquivo → app —, e marca o que já existe. A pergunta que
-- fazia o dono do produto manter a planilha é a inversa: *"tem alguma coisa lançada aqui que o
-- banco não cobrou?"*. Cada linha dessas é uma de três coisas, e a tela diz isso: lançamento
-- manual que ainda não caiu, duplicata digitada à mão, ou erro de valor/data.
--
-- ⚠️ **A janela sai do próprio LOTE** (`min`/`max` de `occurred_at` dos itens), não de
-- `DTSTART`/`DTEND`: o OFX tem essas tags, o CSV não, e uma regra só serve os dois. Fora da janela
-- nada é julgado — um lançamento de setembro não "falta" num extrato de agosto.
--
-- ⚠️ **Só a CONTA do lote, e só quando ela existe.** Sem `account_id` (CSV solto) a função devolve
-- vazio em vez de listar o financeiro inteiro: "não sei de qual conta é este arquivo" não pode
-- virar "estas 200 linhas estão sobrando".
--
-- ⚠️ **Só o que a PESSOA lançou** (`source in ('app','whatsapp')`). Ocorrência de recorrente
-- (`source='recurring'`) é materializada pelo cron e não devia estar num extrato mesmo; e linha de
-- importação anterior (`source='import'`) FICA de fora do filtro de propósito — ela veio de um
-- extrato, então "não veio no extrato" não é uma acusação que faça sentido contra ela.
--
-- ⚠️ **Transferência nunca entra.** Pagamento de fatura é `transfer` e não aparece como linha no
-- extrato do CARTÃO — listá-lo diria que o pagamento está sobrando.
--
-- Par interna/wrapper de `supabase.md`: a interna para o agente (que não tem `auth.uid()`), o
-- wrapper `security invoker` para o app, sob RLS.

create or replace function private.import_unmatched_for(ws_ids uuid[], p_batch_id uuid)
returns table (id uuid, occurred_at date, amount_cents bigint, description text,
               category text, kind text, status text, source text)
language sql stable security invoker set search_path = public set timezone to 'America/Sao_Paulo'
as $$
  with lote as (
    select b.account_id, min(i.occurred_at) de, max(i.occurred_at) ate
    from public.import_batches b
    join public.import_items i on i.batch_id = b.id
    where b.id = p_batch_id and b.workspace_id = any(ws_ids)
    group by b.account_id
  )
  select t.id, t.occurred_at, t.amount_cents,
         coalesce(nullif(t.description,''), nullif(t.merchant,''), t.category, 'Lançamento'),
         t.category, t.kind, t.status, t.source
  from lote l
  join public.transactions t
    on t.workspace_id = any(ws_ids)
   and t.account_id = l.account_id
   and t.occurred_at between l.de and l.ate
  where l.account_id is not null
    and t.kind <> 'transfer'
    and t.source in ('app', 'whatsapp')
    -- Não casou com NENHUM item do lote: nem exato, nem aproximado, nem pelo alvo já gravado.
    and not exists (
      select 1 from public.import_items i
      where i.batch_id = p_batch_id
        and (
          i.transaction_id = t.id
          or (i.occurred_at = t.occurred_at and i.amount_cents = t.amount_cents
              and private.normalize_description(i.description)
                  = private.normalize_description(t.description))
          or (i.amount_cents = t.amount_cents and i.kind = t.kind
              and abs(i.occurred_at - t.occurred_at) <= 5)
        )
    )
  order by t.occurred_at, t.amount_cents desc;
$$;

revoke execute on function private.import_unmatched_for(uuid[], uuid) from public, anon;
grant execute on function private.import_unmatched_for(uuid[], uuid) to authenticated, service_role;

create or replace function public.import_unmatched(p_batch_id uuid)
returns table (id uuid, occurred_at date, amount_cents bigint, description text,
               category text, kind text, status text, source text)
language sql stable security invoker set search_path = public
as $$
  select * from private.import_unmatched_for(array(select private.my_workspace_ids()), p_batch_id);
$$;
