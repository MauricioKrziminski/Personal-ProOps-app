-- `converter_registro` (20260929160000): encerra a ORIGEM pelo alcance e cria o DESTINO numa
-- transação só. Cada caso num bloco próprio, com o número na falha.
--
--   docker exec -i supabase_db_app-proops psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/converter_registro.sql

\set ON_ERROR_STOP on
begin;

-- `auth.uid()` lê esta configuração: com ela, as RPCs de criação chamadas na montagem (como
-- postgres) gravam o autor certo.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000f1d1', true);

do $$
declare
  usr uuid := '00000000-0000-0000-0000-00000000f1d1';
  ws uuid;
  a uuid; c uuid; c9 uuid; d uuid; s uuid; p9 uuid;
  nome text;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  insert into auth.users (id, email) values (usr, 'teste-converter@example.invalid') on conflict (id) do nothing;
  insert into public.profiles (id) values (usr) on conflict (id) do nothing;
  select id into ws from public.workspaces where owner_id = usr order by created_at limit 1;
  if ws is null then
    insert into public.workspaces (name, owner_id) values ('teste converter', usr) returning id into ws;
    insert into public.workspace_members (workspace_id, user_id, role) values (ws, usr, 'owner');
  end if;
  insert into public.accounts (workspace_id, user_id, name, type, initial_balance_cents)
    values (ws, usr, 'A', 'checking', 100000) returning id into a;
  insert into public.accounts (workspace_id, user_id, name, type, closing_day, due_day, credit_limit_cents, payment_account_id)
    values (ws, usr, 'C', 'credit_card', 3, 10, 500000, a) returning id into c;
  -- C9 é só da recusa: a fatura paga dela não pode travar parcela de outra compra
  insert into public.accounts (workspace_id, user_id, name, type, closing_day, due_day, credit_limit_cents, payment_account_id)
    values (ws, usr, 'C9', 'credit_card', 3, 10, 500000, a) returning id into c9;

  -- três séries iguais (S, S2, S3), cada uma com uma ocorrência PAGA (hoje − 30) e uma PENDENTE (hoje + 5)
  foreach nome in array array['S', 'S2', 'S3'] loop
    insert into public.recurring_transactions (workspace_id, user_id, kind, amount_cents, description, account_id,
      rrule, next_run_at, dtstart, auto_confirm)
    values (ws, usr, 'expense', 900, nome, a, 'FREQ=MONTHLY;BYMONTHDAY=' || extract(day from hoje + 5)::int,
      ((hoje + 5)::text || 'T12:00:00Z')::timestamptz, ((hoje - 30)::text || 'T12:00:00Z')::timestamptz, false)
    returning id into s;
    insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, account_id, occurred_at, status, source, recurring_id)
      values (ws, usr, 'expense', 900, nome, a, hoje - 30, 'cleared', 'recurring', s),
             (ws, usr, 'expense', 900, nome, a, hoje + 5, 'pending', 'recurring', s);
  end loop;

  -- S4 no cartão: uma compra PENDENTE que já aconteceu (hoje − 2, a fatura vence depois da âncora)
  -- e uma futura (hoje + 5)
  insert into public.recurring_transactions (workspace_id, user_id, kind, amount_cents, description, account_id,
    rrule, next_run_at, dtstart, auto_confirm)
  values (ws, usr, 'expense', 900, 'S4', c, 'FREQ=MONTHLY;BYMONTHDAY=' || extract(day from hoje + 5)::int,
    ((hoje + 5)::text || 'T12:00:00Z')::timestamptz, ((hoje - 2)::text || 'T12:00:00Z')::timestamptz, false)
  returning id into s;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, account_id, occurred_at, status, source, recurring_id)
    values (ws, usr, 'expense', 900, 'S4', c, hoje - 2, 'pending', 'recurring', s),
           (ws, usr, 'expense', 900, 'S4', c, hoje + 5, 'pending', 'recurring', s);

  -- compra P no cartão em 3x, a primeira paga; P7b em 4x com duas pagas
  perform public.create_installment_plan_with_history(c, 30000, 3, hoje - 60, 1, 'P', null, null);
  perform public.create_installment_plan_with_history(c, 40000, 4, hoje - 60, 2, 'P7b', null, null);

  -- dívida D de parcela fixa (3 × 100,00) com um pagamento
  insert into public.debts (workspace_id, user_id, name, kind, calculation_mode, principal_cents, remaining_cents,
    interest_rate_monthly, installments, installments_paid, installment_cents, account_id, due_day, first_due_date)
  values (ws, usr, 'D', 'financing', 'fixed_installments', 30000, 30000, 0, 3, 0, 10000, a,
    extract(day from hoje + 10)::int, hoje + 10)
  returning id into d;
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, account_id, occurred_at, status, source, debt_id)
    values (ws, usr, 'expense', 10000, 'pagamento D', a, hoje, 'cleared', 'app', d);

  -- avulsos: T (vira recorrente) e T3 (vira financiamento)
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, account_id, occurred_at, status, source)
    values (ws, usr, 'expense', 5000, 'T', a, hoje - 1, 'cleared', 'app'),
           (ws, usr, 'expense', 10000, 'T3', a, hoje - 1, 'cleared', 'app');

  -- P9: compra no cartão C9 com a parcela 1 (T2) numa fatura F marcada como PAGA
  p9 := public.create_installment_plan_with_history(c9, 20000, 2, hoje, 0, 'P9', null, null);
  update public.card_invoices set status = 'paid'
   where id = (select invoice_id from public.transactions where installment_plan_id = p9 and installment_no = 1);
end $$;

set local role authenticated;

do $$
declare
  r jsonb;
  antes bigint;
  antes_p9 bigint;
  a uuid := (select id from public.accounts where name = 'A' and workspace_id = any(array(select private.my_workspace_ids())));
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  s uuid := (select id from public.recurring_transactions where description = 'S');
  s2 uuid := (select id from public.recurring_transactions where description = 'S2');
  s3 uuid := (select id from public.recurring_transactions where description = 'S3');
  p uuid := (select id from public.installment_plans where description = 'P');
  p7b uuid := (select id from public.installment_plans where description = 'P7b');
  p9 uuid := (select id from public.installment_plans where description = 'P9');
  d uuid := (select id from public.debts where name = 'D');
  t uuid := (select id from public.transactions where description = 'T');
  t3 uuid := (select id from public.transactions where description = 'T3');
  pendente uuid := (select id from public.transactions where recurring_id = s and status = 'pending');
  paga_s2 uuid := (select id from public.transactions where recurring_id = s2 and status = 'cleared');
  paga_s uuid := (select id from public.transactions where recurring_id = s and status = 'cleared');
  s4 uuid := (select id from public.recurring_transactions where description = 'S4');
  ja_foi_s4 uuid := (select id from public.transactions where description = 'S4' and occurred_at = hoje - 2);
  paga_p uuid := (select id from public.transactions where installment_plan_id = p and installment_no = 1);
  recorrente jsonb := jsonb_build_object('kind', 'expense', 'amount_cents', 700, 'description', 'Nova', 'account_id', a,
    'rrule', 'FREQ=MONTHLY;BYMONTHDAY=' || extract(day from hoje + 5)::int,
    'next_run_at', ((hoje + 5)::text || 'T12:00:00Z')::timestamptz, 'dtstart', ((hoje + 5)::text || 'T12:00:00Z')::timestamptz);
  avulso jsonb := jsonb_build_object('linhas', jsonb_build_array(jsonb_build_object(
    'kind', 'expense', 'amount_cents', 800, 'description', 'Avulsa', 'account_id', a, 'counterparty_account_id', null,
    'occurred_at', hoje + 5, 'status', 'pending', 'due_at', null, 'auto_confirm', false, 'source', 'app')));
begin
  -- 1. manter: cria a recorrente nova e S fica intacta
  begin
    r := public.converter_registro(jsonb_build_object('tipo', 'serie', 'id', s), 'manter',
           jsonb_build_object('tipo', 'recorrente', 'dados', recorrente));
    if (select count(*) from public.recurring_transactions where id = s) <> 1 then raise exception 'a origem sumiu'; end if;
    if (select count(*) from public.transactions where recurring_id = s) <> 2 then raise exception 'a origem perdeu ocorrência'; end if;
    if (select description from public.recurring_transactions where id = (r->'ids'->>0)::uuid) is distinct from 'Nova' then
      raise exception 'o destino não nasceu: %', r;
    end if;
  exception when others then raise exception '1. %', sqlerrm;
  end;

  -- 2. converter T → recorrente: o MESMO id vira a 1ª ocorrência
  begin
    r := public.converter_registro(jsonb_build_object('tipo', 'transacao', 'id', t), 'converter',
           jsonb_build_object('tipo', 'recorrente', 'dados', recorrente
             || jsonb_build_object('rrule', 'FREQ=MONTHLY;BYMONTHDAY=' || extract(day from hoje - 1)::int,
                                   'next_run_at', ((hoje - 1)::text || 'T12:00:00Z')::timestamptz, 'dtstart', ((hoje - 1)::text || 'T12:00:00Z')::timestamptz)));
    if (select recurring_id from public.transactions where id = t) is distinct from (r->'ids'->>0)::uuid then
      raise exception 'T não foi adotado: %', r;
    end if;
    if (select occurred_at from public.transactions where id = t) <> hoje - 1 then raise exception 'T mudou de dia'; end if;
  exception when others then raise exception '2. %', sqlerrm;
  end;

  -- 3. converter um avulso PAGO → financiamento: vira o 1º pagamento, com o mesmo id
  begin
    r := public.converter_registro(jsonb_build_object('tipo', 'transacao', 'id', t3), 'converter',
           jsonb_build_object('tipo', 'financiamento', 'dados', jsonb_build_object(
             'name', 'F3', 'kind', 'financing', 'calculation_mode', 'fixed_installments', 'principal_cents', 30000,
             'remaining_cents', 30000, 'interest_rate_monthly', 0, 'installments', 3, 'installments_paid', 0,
             'installment_cents', 10000, 'account_id', a, 'due_day', extract(day from hoje - 1)::int, 'first_due_date', hoje - 1)));
    if (select installments_paid from public.debts where id = (r->'ids'->>0)::uuid) <> 1
       or (select remaining_cents from public.debts where id = (r->'ids'->>0)::uuid) <> 20000 then
      raise exception 'o contrato não contou o pagamento: %', (select to_jsonb(x) from public.debts x where id = (r->'ids'->>0)::uuid);
    end if;
    if (select debt_id from public.transactions where id = t3) is distinct from (r->'ids'->>0)::uuid then
      raise exception 'T3 não virou o pagamento';
    end if;
    if (select count(*) from public.transactions where description = 'T3') <> 1 then raise exception 'T3 duplicou'; end if;
  exception when others then raise exception '3. %', sqlerrm;
  end;

  -- 4. so_esta na ocorrência PENDENTE de S → lançamento: mesmo id, fora da série, data pulada
  begin
    r := public.converter_registro(jsonb_build_object('tipo', 'transacao', 'id', pendente), 'so_esta',
           jsonb_build_object('tipo', 'lancamento', 'dados', avulso));
    if (r->'ids'->>0)::uuid is distinct from pendente then raise exception 'o id mudou: %', r; end if;
    if (select recurring_id from public.transactions where id = pendente) is not null then raise exception 'continua na série'; end if;
    if (select amount_cents from public.transactions where id = pendente) <> 800 then raise exception 'o valor não veio do destino'; end if;
    if not exists (select 1 from private.recurring_moved_occurrences where recurring_id = s and original_date = hoje + 5) then
      raise exception 'a data não ficou pulada';
    end if;
    if (select count(*) from public.recurring_transactions where id = s) <> 1 then raise exception 'a série sumiu'; end if;
  exception when others then raise exception '4. %', sqlerrm;
  end;

  -- 5. desta_em_diante em S2: a paga continua ligada, a pendente sumiu, fim = âncora − 1
  begin
    r := public.converter_registro(jsonb_build_object('tipo', 'serie', 'id', s2), 'desta_em_diante',
           jsonb_build_object('tipo', 'recorrente', 'dados', recorrente));
    if (select recurring_id from public.transactions where id = paga_s2) is distinct from s2 then raise exception 'a paga saiu da série'; end if;
    if exists (select 1 from public.transactions where recurring_id = s2 and status = 'pending') then raise exception 'a pendente ficou'; end if;
    if (select end_date from public.recurring_transactions where id = s2) is distinct from hoje + 4 then
      raise exception 'end_date errado: %', (select end_date from public.recurring_transactions where id = s2);
    end if;
  exception when others then raise exception '5. %', sqlerrm;
  end;

  -- 6. todas em S3: nenhuma ocorrência e a série não existe
  begin
    r := public.converter_registro(jsonb_build_object('tipo', 'serie', 'id', s3), 'todas',
           jsonb_build_object('tipo', 'recorrente', 'dados', recorrente));
    if exists (select 1 from public.transactions where recurring_id = s3) then raise exception 'sobrou ocorrência'; end if;
    if exists (select 1 from public.transactions where description = 'S3') then raise exception 'sobrou a paga'; end if;
    if exists (select 1 from public.recurring_transactions where id = s3) then raise exception 'a série ficou'; end if;
  exception when others then raise exception '6. %', sqlerrm;
  end;

  -- 7. desta_em_diante em P: fica só a parcela paga. Uma parcela não é compra parcelada (o banco
  --    pede 2 ou mais): o plano se desfaz e ela segue como lançamento, com o mesmo id.
  begin
    r := public.converter_registro(jsonb_build_object('tipo', 'plano', 'id', p), 'desta_em_diante',
           jsonb_build_object('tipo', 'lancamento', 'dados', avulso));
    if exists (select 1 from public.installment_plans where id = p) then raise exception 'o plano ficou'; end if;
    if not exists (select 1 from public.transactions where id = paga_p and installment_plan_id is null and status = 'cleared') then
      raise exception 'a parcela paga não ficou como lançamento';
    end if;
    if exists (select 1 from public.transactions where description like 'P (%' and id <> paga_p) then raise exception 'sobrou parcela em aberto'; end if;
  exception when others then raise exception '7. %', sqlerrm;
  end;

  -- 7b. com duas pagas o plano fica: 2 parcelas e o total é a soma delas
  begin
    r := public.converter_registro(jsonb_build_object('tipo', 'plano', 'id', p7b), 'desta_em_diante',
           jsonb_build_object('tipo', 'lancamento', 'dados', avulso));
    if (select installments from public.installment_plans where id = p7b) <> 2 then raise exception 'installments errado'; end if;
    if (select total_cents from public.installment_plans where id = p7b)
       <> (select sum(amount_cents) from public.transactions where installment_plan_id = p7b) then
      raise exception 'o total não é a soma do que ficou';
    end if;
    if (select count(*) from public.transactions where installment_plan_id = p7b) <> 2 then raise exception 'parcelas erradas'; end if;
  exception when others then raise exception '7b. %', sqlerrm;
  end;

  -- 8. todas em D: a dívida e o pagamento somem
  begin
    r := public.converter_registro(jsonb_build_object('tipo', 'divida', 'id', d), 'todas',
           jsonb_build_object('tipo', 'lancamento', 'dados', avulso));
    if exists (select 1 from public.debts where id = d) then raise exception 'a dívida ficou'; end if;
    if exists (select 1 from public.transactions where description = 'pagamento D') then raise exception 'o pagamento ficou'; end if;
  exception when others then raise exception '8. %', sqlerrm;
  end;

  -- 9. recusa: todas numa compra com parcela em fatura PAGA → erro, e nada muda (nem a origem
  --    perde parcela, nem o destino nasce)
  antes := (select count(*) from public.transactions);
  antes_p9 := (select count(*) from public.transactions where installment_plan_id = p9);
  begin
    r := public.converter_registro(jsonb_build_object('tipo', 'plano', 'id', p9), 'todas',
           jsonb_build_object('tipo', 'lancamento', 'dados', avulso));
    raise exception 'deveria recusar';
  exception when others then
    if sqlerrm not like '%fatura%' then raise exception '9. recusa errada: %', sqlerrm; end if;
  end;
  if (select count(*) from public.transactions where installment_plan_id = p9) <> antes_p9
     or not exists (select 1 from public.installment_plans where id = p9) then
    raise exception '9. a recusa deixou a compra pela metade';
  end if;
  if (select count(*) from public.transactions) <> antes then
    raise exception '9. a contagem de lançamentos mudou: antes %, depois %', antes, (select count(*) from public.transactions);
  end if;

  -- 10. alcance desconhecido → erro
  begin
    r := public.converter_registro(jsonb_build_object('tipo', 'transacao', 'id', t), 'tudo',
           jsonb_build_object('tipo', 'lancamento', 'dados', avulso));
    raise exception 'deveria recusar';
  exception when others then
    if sqlerrm not like 'Alcance desconhecido%' then raise exception '10. recusa errada: %', sqlerrm; end if;
  end;

  -- 11. so_esta na ocorrência PAGA de S → financiamento: vira o 1º pagamento, fora da série
  begin
    r := public.converter_registro(jsonb_build_object('tipo', 'transacao', 'id', paga_s), 'so_esta',
           jsonb_build_object('tipo', 'financiamento', 'dados', jsonb_build_object(
             'name', 'F11', 'kind', 'financing', 'calculation_mode', 'fixed_installments', 'principal_cents', 2700,
             'remaining_cents', 2700, 'interest_rate_monthly', 0, 'installments', 3, 'installments_paid', 0,
             'installment_cents', 900, 'account_id', a, 'due_day', extract(day from hoje - 30)::int, 'first_due_date', hoje - 30)));
    if (select recurring_id from public.transactions where id = paga_s) is not null then raise exception 'o pagamento continua na série'; end if;
    if (select debt_id from public.transactions where id = paga_s) is distinct from (r->'ids'->>0)::uuid then
      raise exception 'não virou o pagamento';
    end if;
    if (select installments_paid from public.debts where id = (r->'ids'->>0)::uuid) <> 1 then raise exception 'o contrato não contou'; end if;
  exception when others then raise exception '11. %', sqlerrm;
  end;

  -- 12. desta_em_diante numa série de CARTÃO: a compra pendente que já aconteceu fica (o vencimento
  --     da fatura dela é depois da âncora, mas no cartão vale a data da compra); a futura sai
  begin
    r := public.converter_registro(jsonb_build_object('tipo', 'serie', 'id', s4), 'desta_em_diante',
           jsonb_build_object('tipo', 'recorrente', 'dados', recorrente));
    if (select recurring_id from public.transactions where id = ja_foi_s4) is distinct from s4 then
      raise exception 'a compra que já aconteceu saiu';
    end if;
    if exists (select 1 from public.transactions where recurring_id = s4 and occurred_at = hoje + 5) then
      raise exception 'a futura ficou';
    end if;
  exception when others then raise exception '12. %', sqlerrm;
  end;
end $$;

select 'converter_registro: ok' as resultado;
rollback;
