-- Categorias personalizáveis (20260929170000): aparência, renomear, juntar (com orçamento das
-- duas no mesmo mês) e apagar, nas sete colunas que guardam o nome.
--
--   docker exec -i supabase_db_app-proops psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/categorias.sql

\set ON_ERROR_STOP on
begin;

do $$
declare
  usr uuid := '00000000-0000-0000-0000-00000000c47e';
  ws uuid; ws2 uuid;
  a uuid; pag uuid;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  insert into auth.users (id, email) values (usr, 'teste-categorias@example.invalid') on conflict (id) do nothing;
  insert into public.profiles (id) values (usr) on conflict (id) do nothing;
  select id into ws from public.workspaces where owner_id = usr order by created_at limit 1;
  if ws is null then
    insert into public.workspaces (name, owner_id) values ('teste categorias', usr) returning id into ws;
    insert into public.workspace_members (workspace_id, user_id, role) values (ws, usr, 'owner');
  end if;
  insert into public.accounts (workspace_id, user_id, name, type, initial_balance_cents)
    values (ws, usr, 'A', 'checking', 100000) returning id into a;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, account_id, occurred_at, category)
    values (ws, usr, 'expense', 1000, 'camisa', a, hoje, 'roupa'),
           (ws, usr, 'expense', 2000, 'calça', a, hoje - 3, 'roupa'),
           (ws, usr, 'expense', 3000, 'meia', a, hoje - 5, 'roupas'),
           (ws, usr, 'expense', 4000, 'cinema', a, hoje - 1, 'lazer');
  insert into public.recurring_transactions (workspace_id, user_id, kind, amount_cents, description, category, account_id,
      rrule, next_run_at, dtstart)
    values (ws, usr, 'expense', 900, 'assinatura de roupa', 'roupa', a, 'FREQ=MONTHLY;BYMONTHDAY=' || least(extract(day from hoje + 5)::int, 28),
      ((hoje + 5)::text || 'T12:00:00Z')::timestamptz, ((hoje + 5)::text || 'T12:00:00Z')::timestamptz);
  insert into public.installment_plans (workspace_id, user_id, account_id, description, category, total_cents, installments, first_occurred_at)
    values (ws, usr, a, 'Jaqueta', 'roupa', 30000, 3, hoje);
  insert into public.categorization_rules (workspace_id, user_id, match_type, pattern, category)
    values (ws, usr, 'contains', 'renner', 'roupa');
  insert into public.debts (workspace_id, user_id, name, kind, principal_cents, remaining_cents, interest_rate_monthly, payment_category)
    values (ws, usr, 'Crediário', 'loan', 100000, 100000, 0, 'roupa');
  insert into public.budgets (workspace_id, user_id, category, limit_cents, month)
    values (ws, usr, 'roupa', 30000, null),
           (ws, usr, 'roupa', 40000, date '2026-10-01'),
           (ws, usr, 'roupas', 50000, date '2026-10-01');
  -- pagamento de dívida com categoria, e a conta pagadora arquivada DEPOIS (o gatilho da dívida
  -- revalidava a conta em todo update e derrubava o rename inteiro)
  insert into public.accounts (workspace_id, user_id, name, type, initial_balance_cents)
    values (ws, usr, 'Pagadora', 'checking', 0) returning id into pag;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, account_id, occurred_at, status, category, debt_id)
    values (ws, usr, 'expense', 1000, 'parcela do crediário', pag, hoje - 2, 'cleared', 'roupa',
            (select id from public.debts where name = 'Crediário' and workspace_id = ws));
  update public.accounts set archived = true where id = pag;
  -- uma versão FUTURA de calendário no histórico da série: o rename não pode mexer nela
  insert into private.recurring_history_versions (recurring_id, workspace_id, valid_from, anchor_date, rrule, kind, amount_cents, category)
    select id, ws, hoje + 60, hoje + 60, 'FREQ=MONTHLY;BYMONTHDAY=1', 'expense', 900, 'roupa'
      from public.recurring_transactions where description = 'assinatura de roupa';
  update private.recurring_history_versions set valid_through = hoje + 59
   where valid_from < hoje + 60 and recurring_id = (select id from public.recurring_transactions where description = 'assinatura de roupa');
  -- grafia com maiúscula vinda de fora do app (juntar nela gravava o nome maiúsculo em categories)
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, account_id, occurred_at, category)
    values (ws, usr, 'expense', 500, 'pão', a, hoje, 'Mercado'),
           (ws, usr, 'expense', 700, 'feira', a, hoje, 'feira');
  -- um segundo espaço com a MESMA categoria personalizada: categories_used devolve uma linha só
  -- (um espaço COMPARTILHADO: de outra pessoa, com quem chama como membro)
  insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000c47f', 'teste-categorias-2@example.invalid') on conflict (id) do nothing;
  insert into public.profiles (id) values ('00000000-0000-0000-0000-00000000c47f') on conflict (id) do nothing;
  insert into public.workspaces (name, owner_id) values ('teste categorias 2', '00000000-0000-0000-0000-00000000c47f') returning id into ws2;
  insert into public.workspace_members (workspace_id, user_id, role) values (ws2, usr, 'member');
  insert into public.categories (workspace_id, user_id, name, icon, color)
    values (ws2, '00000000-0000-0000-0000-00000000c47f', 'lazer', 'airplane', 'terra');
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000c47e', true);
set local role authenticated;

do $$
declare r jsonb;
begin
  -- 0. a série tem versão no histórico com o nome antigo (senão o passo 4 não confere nada)
  if not exists (select 1 from private.recurring_history_versions where category = 'roupa') then
    raise exception '0. a recorrente não tem versão para conferir';
  end if;

  -- 1. aparência: cria e atualiza a linha, sem mexer em registro nenhum
  perform public.save_category('lazer', 'gamecontroller', 'oceano');
  perform public.save_category('Lazer ', 'film', 'musgo');
  if (select icon || '/' || color from public.categories where name = 'lazer' and workspace_id = public.my_default_workspace()) <> 'film/musgo' then
    raise exception '1. upsert';
  end if;
  if (select count(*) from public.categories where workspace_id = public.my_default_workspace()) <> 1 then raise exception '1. duplicou'; end if;

  -- 2. cor fora da paleta é recusada
  begin
    perform public.save_category('lazer', 'film', 'vermelho');
    raise exception '2. aceitou cor';
  exception when check_violation then null;
  end;

  -- 3. renomear para um nome que existe (sem acento e sem caixa) sem "juntar" é recusado, e nada muda
  begin
    perform public.rename_category('roupa', 'Roupás', false);
    raise exception '3. não recusou';
  exception when others then
    if sqlerrm not like 'CATEGORIA_EXISTE: roupas%' then raise; end if;
  end;
  if (select count(*) from public.transactions where category = 'roupa') <> 3 then raise exception '3. mudou algo'; end if;

  -- 4. juntar: tudo que era "roupa" vira "roupas", e o orçamento de outubro da que recebe fica
  r := public.rename_category('roupa', 'Roupás', true);
  if not (r->>'juntou')::boolean or (r->>'orcamentos_descartados')::int <> 1 then raise exception '4. retorno %', r; end if;
  if (select count(*) from public.transactions where category = 'roupas') <> 4 then raise exception '4. transações'; end if;
  if exists (select 1 from public.transactions where category in ('roupa', 'roupás')) then raise exception '4. grafia'; end if;
  if exists (select 1 from public.recurring_transactions where category = 'roupa')
     or exists (select 1 from public.installment_plans where category = 'roupa')
     or exists (select 1 from public.categorization_rules where category = 'roupa')
     or exists (select 1 from public.debts where payment_category = 'roupa') then raise exception '4. sobrou roupa'; end if;
  if exists (select 1 from private.recurring_history_versions where category = 'roupa') then raise exception '4. histórico'; end if;
  if not exists (select 1 from private.recurring_history_versions where category = 'roupas') then raise exception '4. histórico novo'; end if;
  if (select limit_cents from public.budgets where category = 'roupas' and month = date '2026-10-01') <> 50000 then raise exception '4. orçamento de outubro'; end if;
  if (select limit_cents from public.budgets where category = 'roupas' and month is null) <> 30000 then raise exception '4. o padrão veio junto'; end if;

  -- 5. renomear simples (nome novo livre) leva a aparência junto
  perform public.save_category('roupas', 'tshirt', 'terra');
  r := public.rename_category('roupas', 'Vestuário');
  if (r->>'juntou')::boolean then raise exception '5. juntou'; end if;
  if (select color from public.categories where name = 'vestuário') is distinct from 'terra' then raise exception '5. aparência'; end if;
  if exists (select 1 from public.categories where name = 'roupas') then raise exception '5. a antiga ficou'; end if;

  -- 6. apagar: registros sem categoria, orçamentos fora, contagem certa
  r := public.delete_category('vestuário');
  if (r->>'lancamentos')::int <> 4 or (r->>'orcamentos')::int <> 2 then raise exception '6. contagem %', r; end if;
  if exists (select 1 from public.transactions where category = 'vestuário')
     or exists (select 1 from public.budgets where category = 'vestuário')
     or exists (select 1 from public.recurring_transactions where category = 'vestuário')
     or exists (select 1 from public.debts where payment_category = 'vestuário')
     or exists (select 1 from public.categories where name = 'vestuário') then raise exception '6. sobrou'; end if;

  -- 7. categories_used: a do texto com a aparência dela; a que só tem aparência aparece com 0 usos
  if not exists (select 1 from public.categories_used() where category = 'lazer' and icon = 'film' and color = 'musgo' and uses = 1 and budgets = 0) then
    raise exception '7. lazer';
  end if;
  perform public.save_category('viagem', 'airplane', null);
  if not exists (select 1 from public.categories_used() where category = 'viagem' and uses = 0 and color is null) then raise exception '7. viagem'; end if;

  if (select count(*) from public.categories_used() where category = 'lazer') <> 1 then raise exception '7. lazer duplicado entre espaços'; end if;

  -- 9. o pagamento da dívida com a conta arquivada foi renomeado e apagado sem recusa
  if exists (select 1 from public.transactions where description = 'parcela do crediário' and category is not null) then
    raise exception '9. pagamento de dívida';
  end if;

  -- 10. a versão futura de calendário ficou (âncora e regra), só com o nome novo — e nenhuma versão nova nasceu
  if not exists (select 1 from private.recurring_history_versions
                  where valid_from = (now() at time zone 'America/Sao_Paulo')::date + 60
                    and anchor_date = (now() at time zone 'America/Sao_Paulo')::date + 60
                    and rrule = 'FREQ=MONTHLY;BYMONTHDAY=1' and category is null) then
    raise exception '10. versão futura';
  end if;
  if (select count(*) from private.recurring_history_versions v join public.recurring_transactions r on r.id = v.recurring_id
       where r.description = 'assinatura de roupa') <> 2 then raise exception '10. versionou o rename'; end if;

  -- 11. juntar numa grafia com maiúscula: os registros ficam com ela, a aparência minúscula
  perform public.save_category('feira', 'cart', 'musgo');
  r := public.rename_category('feira', 'mercado', true);
  if not (r->>'juntou')::boolean then raise exception '11. não juntou %', r; end if;
  if (select count(*) from public.transactions where category = 'Mercado') <> 2 then raise exception '11. grafia'; end if;
  if (select color from public.categories where name = 'mercado') is distinct from 'musgo' then raise exception '11. aparência'; end if;

  -- 12. nome que só existe numa regra de categorização também é "já existe"
  insert into public.categorization_rules (user_id, match_type, pattern, category)
    values ('00000000-0000-0000-0000-00000000c47e', 'contains', 'petz', 'pet');
  begin
    perform public.rename_category('lazer', 'Pét', false);
    raise exception '12. não recusou';
  exception when others then
    if sqlerrm not like 'CATEGORIA_EXISTE: pet%' then raise; end if;
  end;

  -- 8. renomear para o mesmo nome não faz nada
  r := public.rename_category('lazer', ' LAZER ');
  if (r->>'juntou')::boolean or (select count(*) from public.transactions where category = 'lazer') <> 1 then raise exception '8. mesmo nome'; end if;

  raise notice 'categorias: ok';
end $$;

rollback;
