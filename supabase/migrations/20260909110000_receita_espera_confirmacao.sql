-- Receita não vira dinheiro real sozinha — a menos que o usuário diga que pode.
--
-- O dono do produto: *"não tem que marcar sozinho essas entradas que não for salário. Esses que
-- não são, são Pix e coisas que precisam de comprovação"*, e depois: *"diferencie a receita de
-- salário na hora de criar uma receita, **não separando somente por tag ou categoria, e sim nas
-- lógicas**"*.
--
-- Então a distinção é uma COLUNA, não uma inferência de categoria. E ela mora na LINHA, não só na
-- série, por um motivo que só aparece lendo o materializador:
--
--   `agent/app/jobs/scheduler.py:101` cria a ocorrência **já `cleared`** quando a data é passada e
--   a série tem `auto_confirm` — sem passar por `_promote_due_transactions`. Uma regra que vivesse
--   só no promote deixaria o Pix vencido virar dinheiro real por esse caminho. Com a coluna na
--   linha e o valor herdado da série na materialização, os dois caminhos leem a mesma verdade.
--
-- `default false` na tabela inteira preserva o comportamento de todo o histórico: hoje nada
-- promove lançamento avulso (o promote antigo só tocava linha com `recurring_id`).

alter table public.transactions
  add column if not exists auto_confirm boolean not null default false;

comment on column public.transactions.auto_confirm is
  'true = ao chegar a data vira cleared sozinho. false (padrão) = espera o usuário confirmar. '
  'Receita de terceiro (Pix) fica false; salário é o caso em que ligar faz sentido.';

-- O promote passa a olhar a LINHA. Antes era `from recurring_transactions r ... and r.auto_confirm`,
-- o que deixava de fora todo lançamento avulso — inclusive um que o usuário queira automático.
create or replace function public._promote_due_transactions()
returns int language sql security definer set search_path = public as $$
  with promoted as (
    update public.transactions t set status = 'cleared'
     where t.status = 'pending'
       and t.occurred_at <= current_date
       -- parcela de compra parcelada continua esperando pagamento, como sempre
       and t.installment_plan_id is null
       and t.auto_confirm
    returning t.id
  ) select count(*)::int from promoted;
$$;
revoke execute on function public._promote_due_transactions() from public, anon, authenticated;

-- ── estado inicial das linhas que já existem ────────────────────────────────
--
-- Ocorrência já materializada herda o que a série dizia até agora. É o único ponto em que a
-- categoria aparece, e é de propósito pontual: serve para ACERTAR o estado inicial das 6 séries
-- que já estão cadastradas, não para virar regra. A regra é a coluna.
--
-- `sal%rio` porque as duas grafias convivem em produção (`salario` 7 usos, `salário` 6) — o
-- seletor de categoria já junta as duas na tela, mas o dado segue partido.
update public.transactions t
   set auto_confirm = r.auto_confirm
  from public.recurring_transactions r
 where t.recurring_id = r.id
   and t.status = 'pending';

update public.recurring_transactions
   set auto_confirm = false
 where kind = 'income'
   and coalesce(category, '') not ilike 'sal%rio';

-- e as ocorrências futuras das séries que acabaram de ser desligadas
update public.transactions t
   set auto_confirm = false
  from public.recurring_transactions r
 where t.recurring_id = r.id
   and t.status = 'pending'
   and not r.auto_confirm;
