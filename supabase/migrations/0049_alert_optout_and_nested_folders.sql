-- =============================================================================
-- 0049 — o direito de não ser avisado, e pastas dentro de pastas
-- =============================================================================
--
-- ## 1. `profiles.alerts_enabled`
--
-- Até aqui NÃO existia nenhuma forma de desligar os alertas proativos:
-- `_alerts_to_send` varria todo dono de workspace com telefone, sem filtro de
-- preferência nenhum, e `profiles` não tinha coluna para isso.
--
-- Pior: o único controle que existia (`expo_push_token`) piorava a situação.
-- Sem token, `agent/app/jobs/alerts.py` cai no `send_template` do WhatsApp, que
-- é PAGO. Ou seja, quem não ligasse o push recebia tudo pelo canal caro, e quem
-- ligasse não conseguia mais desligar (o Switch do Perfil era
-- `disabled={pushOn}` — porta de mão única).
--
-- Um booleano só, não um por tipo. Seis chaves de preferência para um produto
-- que ainda tem um usuário seriam seis coisas para manter em sincronia com
-- `_alerts_to_send`; granularidade entra quando alguém pedir para silenciar UM
-- tipo, não antes.
--
-- ## 2. `note_folders.parent_id`
--
-- Pasta dentro de pasta. `on delete set null` e não `cascade`: apagar "Trabalho"
-- não pode levar junto "Trabalho / 2026" e as notas dentro dela — a subpasta
-- sobe para a raiz e o usuário decide. Perder nota por causa de arrumação é o
-- tipo de coisa que faz alguém parar de confiar no app.
-- =============================================================================

alter table public.profiles
  add column if not exists alerts_enabled boolean not null default true;

comment on column public.profiles.alerts_enabled is
  'Alertas proativos (orçamento, fatura, projeção). false = o cron pula este dono.';

alter table public.note_folders
  add column if not exists parent_id uuid references public.note_folders(id) on delete set null;

create index if not exists note_folders_parent_idx
  on public.note_folders (workspace_id, parent_id);

-- =============================================================================
-- `_alerts_to_send` passa a respeitar a preferência.
--
-- O corpo abaixo é **cópia literal da 0037** (a última a redefinir a função) com
-- uma linha a mais. Não foi redigitado: uma primeira tentativa reescreveu a
-- função de memória e trocou nome de CTE, texto de mensagem, janela de datas e
-- até a função da projeção (`_cash_flow_forecast` virou `cash_flow_for`) — tudo
-- silenciosamente, porque `create or replace` aceita qualquer corpo válido.
-- Ao mexer aqui de novo: copie a definição vigente e edite o mínimo.
-- =============================================================================

create or replace function public._alerts_to_send()
returns table(
  workspace_id uuid, user_id uuid, phone text, expo_push_token text,
  kind text, ref text, title text, body text
)
language sql stable security definer
set search_path = public
as $fn$
  with donos as (
    select w.id as workspace_id, w.owner_id as user_id, p.phone, p.expo_push_token, p.timezone
    from public.workspaces w
    join public.profiles p on p.id = w.owner_id
    -- A ÚNICA linha que a 0049 acrescenta. Ela entra em `donos` porque é a CTE de
    -- onde os cinco ramos puxam: filtrar aqui é o único lugar em que a preferência
    -- não precisa ser repetida — e repetida é como ela ficaria esquecida no próximo
    -- ramo que alguém acrescentar.
    where p.alerts_enabled
  ),
  teste as (
    select d.workspace_id, d.user_id, d.phone, d.expo_push_token,
           'trial_ending' as kind,
           s.current_period_end::text as ref,
           'Seu teste acaba em 2 dias' as title,
           case when uso.lancamentos > 0
                then 'Voce ja registrou ' || uso.lancamentos
                     || ' lancamento' || case when uso.lancamentos = 1 then '' else 's' end
                     || ' nesta semana. Dia ' || to_char(s.current_period_end, 'DD/MM')
                     || ' o teste vira assinatura automaticamente. '
                     || 'Se nao quiser continuar, cancele na loja antes disso — '
                     || 'sao dois toques e nao precisa falar com ninguem.'
                else 'Dia ' || to_char(s.current_period_end, 'DD/MM')
                     || ' o teste vira assinatura automaticamente. '
                     || 'Manda um gasto aqui pra experimentar antes de decidir — '
                     || 'ou cancele na loja, sao dois toques.' end as body
    from donos d
    join public.subscriptions s on s.workspace_id = d.workspace_id
    cross join lateral (
      select count(*)::int as lancamentos
      from public.transactions t
      where t.workspace_id = d.workspace_id
        and t.created_at >= now() - interval '7 days'
    ) uso
    where s.is_trial
      and s.status = 'trialing'
      and s.current_period_end = current_date + 2
  ),
  orcamento as (
    select d.workspace_id, d.user_id, d.phone, d.expo_push_token,
           case when b.spent_cents >= b.limit_cents then 'budget_100' else 'budget_80' end as kind,
           b.category as ref,
           case when b.spent_cents >= b.limit_cents
                then 'Orcamento estourado'
                else 'Orcamento no limite' end as title,
           case when b.spent_cents >= b.limit_cents
                then 'Voce ja gastou ' || round(b.spent_cents::numeric / 100, 2)
                     || ' de ' || round(b.limit_cents::numeric / 100, 2)
                     || ' em ' || b.category || '. Quer que eu remaneje de outra categoria?'
                else 'Voce ja usou ' || round(100.0 * b.spent_cents / b.limit_cents)
                     || '% do orcamento de ' || b.category
                     || '. Faltam ' || round((b.limit_cents - b.spent_cents)::numeric / 100, 2)
                     || ' ate o fim do mes.' end as body
    from donos d
    cross join lateral private.budgets_status_for(array[d.workspace_id], current_date) b
    where b.limit_cents > 0 and b.spent_cents >= b.limit_cents * 0.8
  ),
  fatura as (
    select d.workspace_id, d.user_id, d.phone, d.expo_push_token,
           'invoice_due' as kind, ci.id::text as ref,
           'Fatura do ' || a.name as title,
           'Fatura de ' || round(coalesce(sum(t.amount_cents), 0)::numeric / 100, 2)
             || ' vence em ' || to_char(ci.due_date, 'DD/MM')
             || '. Ja pagou? Me manda "paguei a fatura do ' || a.name || '".' as body
    from donos d
    join public.card_invoices ci on ci.workspace_id = d.workspace_id and ci.status <> 'paid'
    join public.accounts a on a.id = ci.account_id
    join public.transactions t on t.invoice_id = ci.id and t.kind = 'expense'
    where ci.due_date <= current_date + 3
    group by d.workspace_id, d.user_id, d.phone, d.expo_push_token, ci.id, ci.due_date, a.name
  ),
  conta as (
    select d.workspace_id, d.user_id, d.phone, d.expo_push_token,
           'bill_due' as kind, t.id::text as ref,
           'Conta vencendo' as title,
           coalesce(t.description, t.category, 'Conta') || ' de '
             || round(t.amount_cents::numeric / 100, 2)
             || ' vence ' || case when coalesce(t.due_at, t.occurred_at) = current_date
                                  then 'hoje' else 'amanha' end
             || '. Depois me diz "paguei" que eu dou baixa.' as body
    from donos d
    join public.transactions t on t.workspace_id = d.workspace_id
    where t.status = 'pending' and t.kind = 'expense' and t.invoice_id is null
      and coalesce(t.due_at, t.occurred_at) between current_date and current_date + 1
  ),
  vermelho as (
    select d.workspace_id, d.user_id, d.phone, d.expo_push_token,
           'negative_forecast' as kind, f.day::text as ref,
           'Saldo vai ficar negativo' as title,
           'Do jeito que esta, dia ' || to_char(f.day, 'DD/MM')
             || ' seu saldo fica em ' || round(f.balance_cents::numeric / 100, 2)
             || '. Quer ver o que da pra adiar?' as body
    from donos d
    cross join lateral (
      select day, balance_cents
      from public._cash_flow_forecast(d.user_id, 30)
      where balance_cents < 0
      order by day
      limit 1
    ) f
  )
  -- `teste` vem PRIMEIRO de propósito: o teto de 4 alertas por usuário na
  -- Edge Function corta pelo fim da lista, e este é o único que tem prazo.
  select * from teste
  union all select * from orcamento
  union all select * from fatura
  union all select * from conta
  union all select * from vermelho;
$fn$;

revoke execute on function public._alerts_to_send() from public, anon, authenticated;
