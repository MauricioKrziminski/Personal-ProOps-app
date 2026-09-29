-- Categorias personalizáveis (spec 2026-09-29-formulario-unico-e-categorias-design, Parte 3).
--
-- Os registros continuam guardando a categoria como TEXTO, sem FK: WhatsApp, agente e importação
-- não mudam. Esta tabela guarda só a APARÊNCIA (ícone e cor) de um nome, por espaço, e uma
-- categoria criada no app antes de ter uso. Renomear, juntar e apagar reescrevem o texto em todas
-- as colunas que o guardam, numa transação só.
--
-- As colunas reescritas: transactions, recurring_transactions, installment_plans, budgets,
-- categorization_rules, debts.payment_category e o histórico de versões da recorrente. Fora dos
-- dois últimos, o pagamento da dívida e a ocorrência prevista voltariam com o nome antigo.

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default public.my_default_workspace()
    references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (name = lower(trim(name)) and char_length(name) between 1 and 40),
  -- nome de SF Symbol da lista fixa do app (ICONES_DE_CATEGORIA); nunca emoji
  icon text check (icon is null or char_length(icon) between 1 and 60),
  -- a paleta das notas (NOTE_COLOR_NAMES): cor de CONTEÚDO, nunca tint/danger/warning
  color text check (color is null or color in
    ('grafite','oceano','violeta','magenta','terra','mostarda','musgo','turquesa')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, name)
);
alter table public.categories enable row level security;
create policy "workspace rows" on public.categories
  for all using (workspace_id in (select private.my_workspace_ids()))
  with check (workspace_id in (select private.my_workspace_ids()));
create trigger set_updated_at before update on public.categories
  for each row execute function extensions.moddatetime(updated_at);
do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'categories') then
    alter publication supabase_realtime add table public.categories;
  end if;
end $$;

-- Duas categorias são a mesma quando o nome sem acento e minúsculo é igual (`foldCategory` no app).
create function private.fold(p text) returns text language sql stable
set search_path = public
as $$ select extensions.unaccent(lower(trim(p))) $$;

-- O tipo de retorno muda: as colunas NOVAS entram no FIM, e o APK antigo lê category e uses
-- por nome. Entra também a categoria que só tem aparência (criada no app, ainda sem uso).
drop function public.categories_used();
create function public.categories_used()
returns table (category text, uses bigint, icon text, color text, budgets bigint)
language sql stable security invoker set search_path = public
as $$
  with usadas as (
    select t.category, count(*)::bigint as uses from public.transactions t
     where t.workspace_id in (select private.my_workspace_ids()) and coalesce(t.category, '') <> ''
     group by t.category
  ), nomes as (
    select usadas.category from usadas
    union select c.name from public.categories c where c.workspace_id in (select private.my_workspace_ids())
  )
  select n.category, coalesce(u.uses, 0)::bigint, c.icon, c.color,
         (select count(*) from public.budgets b where b.category = n.category
            and b.workspace_id in (select private.my_workspace_ids()))::bigint
    from nomes n
    left join usadas u on u.category = n.category
    -- com vários espaços, UMA aparência por nome: a do espaço padrão primeiro
    left join lateral (
      select c.icon, c.color from public.categories c
       where c.name = lower(n.category) and c.workspace_id in (select private.my_workspace_ids())
       order by (c.workspace_id = public.my_default_workspace()) desc, c.created_at
       limit 1) c on true
   order by coalesce(u.uses, 0) desc, n.category;
$$;

create function public.save_category(p_name text, p_icon text, p_color text)
returns void language plpgsql security invoker set search_path = public
as $$
begin
  if coalesce(trim(p_name), '') = '' then raise exception 'Dê um nome à categoria.'; end if;
  insert into public.categories (user_id, name, icon, color)
  values (auth.uid(), lower(trim(p_name)), p_icon, p_color)
  on conflict (workspace_id, name) do update set icon = excluded.icon, color = excluded.color;
end $$;

-- O histórico de versões da recorrente só tem policy de LEITURA: um `update` sob o papel do
-- usuário afetaria ZERO linhas, sem erro, e a ocorrência prevista voltaria com o nome antigo.
-- Definer, e o escopo sai DE DENTRO (`my_workspace_ids()` lê o `auth.uid()` de quem chamou):
-- receber a lista de espaços por parâmetro deixaria qualquer um escrever no espaço de outro.
create function private.renomear_no_historico(p_de text, p_para text)
returns void language sql security definer set search_path = public
as $$
  update private.recurring_history_versions set category = p_para
   where workspace_id in (select private.my_workspace_ids()) and category = p_de;
$$;
revoke execute on function private.renomear_no_historico(text, text) from public, anon;
grant execute on function private.renomear_no_historico(text, text) to authenticated;

-- `p_from` casa EXATO (é o nome que `categories_used` devolveu, com a grafia gravada); `p_to` é
-- gravado minúsculo. Renomear para um nome que já existe (sem acento e sem caixa) em QUALQUER
-- coluna que guarda categoria é JUNTAR, e só acontece com `p_juntar`: sem ele a função recusa com
-- CATEGORIA_EXISTE e a tela pergunta. O alcance é o de `categories_used`: todos os espaços de quem
-- chama.
create function public.rename_category(p_from text, p_to text, p_juntar boolean default false)
returns jsonb language plpgsql security invoker set search_path = public
as $$
declare
  v_from text := trim(p_from);
  v_to text := lower(trim(p_to));
  v_ws uuid[] := array(select private.my_workspace_ids());
  v_existe text;
  v_desc int := 0;
begin
  if coalesce(v_to, '') = '' then raise exception 'Dê um nome à categoria.'; end if;
  if coalesce(v_from, '') = '' then raise exception 'Categoria não encontrada.'; end if;
  if v_from = v_to then return jsonb_build_object('juntou', false, 'orcamentos_descartados', 0); end if;
  select x.c into v_existe from (
    select category c from public.transactions where workspace_id = any(v_ws)
    union select name from public.categories where workspace_id = any(v_ws)
    union select category from public.budgets where workspace_id = any(v_ws)
    union select category from public.recurring_transactions where workspace_id = any(v_ws)
    union select category from public.installment_plans where workspace_id = any(v_ws)
    union select category from public.categorization_rules where workspace_id = any(v_ws)
    union select payment_category from public.debts where workspace_id = any(v_ws)
  ) x where x.c is not null and private.fold(x.c) = private.fold(v_to) and x.c <> v_from
  order by (x.c = v_to) desc, x.c limit 1;
  if v_existe is not null and not p_juntar then
    raise exception 'CATEGORIA_EXISTE: %', v_existe;
  end if;
  -- juntando, grava com a grafia da que RECEBE
  v_to := coalesce(v_existe, v_to);

  -- orçamento das duas no mesmo alcance (o padrão, ou o mesmo mês): fica o da que recebe
  with fora as (
    delete from public.budgets b where b.workspace_id = any(v_ws) and b.category = v_from
      and exists (select 1 from public.budgets o where o.workspace_id = b.workspace_id and o.category = v_to
                   and o.month is not distinct from b.month)
    returning 1)
  select count(*) into v_desc from fora;

  -- o gatilho do histórico da recorrente sai cedo com isto ligado (ver track_recurring_history)
  perform set_config('proops.renomeando_categoria', 'on', true);
  update public.transactions set category = v_to where workspace_id = any(v_ws) and category = v_from;
  update public.recurring_transactions set category = v_to where workspace_id = any(v_ws) and category = v_from;
  update public.installment_plans set category = v_to where workspace_id = any(v_ws) and category = v_from;
  update public.budgets set category = v_to where workspace_id = any(v_ws) and category = v_from;
  update public.categorization_rules set category = v_to where workspace_id = any(v_ws) and category = v_from;
  update public.debts set payment_category = v_to where workspace_id = any(v_ws) and payment_category = v_from;
  perform private.renomear_no_historico(v_from, v_to);
  perform set_config('proops.renomeando_categoria', '', true);

  -- a aparência vai junto, espaço a espaço; onde a que recebe já tem a dela, fica a dela
  delete from public.categories c where c.workspace_id = any(v_ws) and c.name = lower(v_from)
     and exists (select 1 from public.categories o where o.workspace_id = c.workspace_id and o.name = lower(v_to));
  update public.categories set name = lower(v_to) where workspace_id = any(v_ws) and name = lower(v_from);
  return jsonb_build_object('juntou', v_existe is not null, 'orcamentos_descartados', v_desc);
end $$;

-- Apagar a categoria não apaga registro nenhum: eles ficam sem categoria. O orçamento dela sai,
-- porque um limite sem categoria não mede nada.
create function public.delete_category(p_name text)
returns jsonb language plpgsql security invoker set search_path = public
as $$
declare
  v text := trim(p_name);
  v_ws uuid[] := array(select private.my_workspace_ids());
  v_tx int; v_orc int;
begin
  update public.transactions set category = null where workspace_id = any(v_ws) and category = v;
  get diagnostics v_tx = row_count;
  delete from public.budgets where workspace_id = any(v_ws) and category = v;
  get diagnostics v_orc = row_count;
  perform set_config('proops.renomeando_categoria', 'on', true);
  update public.recurring_transactions set category = null where workspace_id = any(v_ws) and category = v;
  update public.installment_plans set category = null where workspace_id = any(v_ws) and category = v;
  update public.categorization_rules set category = null where workspace_id = any(v_ws) and category = v;
  update public.debts set payment_category = null where workspace_id = any(v_ws) and payment_category = v;
  perform private.renomear_no_historico(v, null);
  perform set_config('proops.renomeando_categoria', '', true);
  delete from public.categories where workspace_id = any(v_ws) and name = lower(v);
  return jsonb_build_object('lancamentos', v_tx, 'orcamentos', v_orc);
end $$;


-- ── Os gatilhos que um UPDATE só de categoria não pode acordar ─────────────────────────────────
--
-- 1. O pagamento de dívida revalida conta, tipo e status em TODO update, e renomear a categoria de
--    um pagamento cuja conta pagadora foi arquivada depois recusava o rename INTEIRO ("Conta
--    pagadora inválida"). O gatilho passa a disparar só pelas colunas que ele confere ou calcula —
--    o formulário manda a linha inteira, então editar pelo app continua validando tudo.
drop trigger sync_debt_payment on public.transactions;
create trigger sync_debt_payment
  before insert or delete or update of account_id, amount_cents, debt_id, kind, status, workspace_id,
    debt_principal_cents, debt_interest_cents, debt_payment_no, debt_balance_after_cents
  on public.transactions
  for each row execute function public.tg_transactions_debt_payment();

-- 2. O histórico da recorrente versionava o rename: partia a série em hoje e, com uma versão
--    futura de calendário, a trocava por outra com a âncora antiga. Com `proops.renomeando_categoria`
--    ligado (só dentro de rename_category/delete_category), ele sai cedo; o histórico é reescrito
--    por `private.renomear_no_historico`. Corpo igual ao da 20260928200010, mais o `if` do topo.
CREATE OR REPLACE FUNCTION private.track_recurring_history()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  tz text;
  new_anchor date;
  boundary date;
  is_all boolean;
  original_start date;
  original_inferred date;
begin
  select coalesce(p.timezone,'America/Sao_Paulo') into tz
    from public.profiles p where p.id=new.user_id;
  tz:=coalesce(tz,'America/Sao_Paulo');
  if tg_op='INSERT' then
    new_anchor:=(coalesce(new.dtstart,new.next_run_at) at time zone tz)::date;
    insert into private.recurring_history_versions
      (recurring_id,workspace_id,valid_from,anchor_date,rrule,kind,
       amount_cents,category,description,account_id,end_date)
    values(new.id,new.workspace_id,new_anchor,new_anchor,new.rrule,new.kind,
      new.amount_cents,new.category,new.description,new.account_id,new.end_date);
    return new;
  end if;
  -- Renomear ou apagar uma categoria (20260929170000) reescreve o histórico por conta própria
  -- (`private.renomear_no_historico`). Versionar aqui partiria a série em hoje e, havendo uma
  -- versão futura de calendário, a trocaria por outra com a âncora antiga.
  if current_setting('proops.renomeando_categoria', true) = 'on'
     and row(old.rrule,old.dtstart,old.kind,old.amount_cents,
      old.description,old.account_id,old.end_date)
      is not distinct from
     row(new.rrule,new.dtstart,new.kind,new.amount_cents,
      new.description,new.account_id,new.end_date) then return new; end if;
  if row(old.rrule,old.dtstart,old.kind,old.amount_cents,old.category,
      old.description,old.account_id,old.end_date)
      is not distinct from
     row(new.rrule,new.dtstart,new.kind,new.amount_cents,new.category,
      new.description,new.account_id,new.end_date) then return new; end if;
  new_anchor:=(coalesce(new.dtstart,new.next_run_at) at time zone tz)::date;
  select exists(select 1 from private.recurring_all_edit_requests e
    where e.recurring_id=new.id and e.user_id=auth.uid() and e.result is null)
    into is_all;
  if is_all then
    select min(valid_from),min(inferred_before) into original_start,original_inferred
      from private.recurring_history_versions where recurring_id=new.id;
    if new.rrule ~ '^FREQ=MONTHLY' then
      -- "All" corrects the whole first eligible monthly period, even when the
      -- new day falls before the old first due date. Mark that edge as inferred.
      if date_trunc('month',original_start::timestamp)::date<original_start then
        original_inferred:=coalesce(original_inferred,original_start);
        original_start:=date_trunc('month',original_start::timestamp)::date;
      end if;
      if date_trunc('month',new.created_at at time zone tz)::date<original_start then
        original_inferred:=coalesce(original_inferred,original_start);
        original_start:=date_trunc('month',new.created_at at time zone tz)::date;
      end if;
    end if;
    delete from private.recurring_history_versions where recurring_id=new.id;
    insert into private.recurring_history_versions
      (recurring_id,workspace_id,valid_from,anchor_date,inferred_before,rrule,
       kind,amount_cents,category,description,account_id,end_date)
    values(new.id,new.workspace_id,original_start,original_start,
      original_inferred,new.rrule,new.kind,new.amount_cents,new.category,
      new.description,new.account_id,new.end_date);
  else
    boundary:=case when old.rrule is distinct from new.rrule
      or old.dtstart is distinct from new.dtstart then new_anchor
      else (now() at time zone tz)::date end;
    delete from private.recurring_history_versions
      where recurring_id=new.id and valid_from>=boundary;
    update private.recurring_history_versions
      set valid_through=boundary-1
      where recurring_id=new.id and valid_from<boundary
        and (valid_through is null or valid_through>=boundary);
    insert into private.recurring_history_versions
      (recurring_id,workspace_id,valid_from,anchor_date,rrule,kind,
       amount_cents,category,description,account_id,end_date)
    values(new.id,new.workspace_id,boundary,
      case when old.rrule is distinct from new.rrule
        or old.dtstart is distinct from new.dtstart then new_anchor
        else coalesce((select anchor_date from private.recurring_history_versions
          where recurring_id=new.id order by valid_from desc limit 1),new_anchor) end,
      new.rrule,new.kind,new.amount_cents,new.category,new.description,
      new.account_id,new.end_date);
  end if;
  return new;
end;
$function$;

revoke execute on function public.categories_used() from public, anon;
revoke execute on function public.save_category(text, text, text) from public, anon;
revoke execute on function public.rename_category(text, text, boolean) from public, anon;
revoke execute on function public.delete_category(text) from public, anon;
revoke execute on function private.fold(text) from public, anon;
grant execute on function public.categories_used() to authenticated;
grant execute on function public.save_category(text, text, text) to authenticated;
grant execute on function public.rename_category(text, text, boolean) to authenticated;
grant execute on function public.delete_category(text) to authenticated;
grant execute on function private.fold(text) to authenticated;
