-- F18: transferência recorrente entre contas próprias + encerrar série.
--   cat supabase/migrations/20261005160000_recurring_transfers_and_end.sql supabase/tests/recurring_transfers_and_end.sql > <tmp> e
--   agent/.venv/bin/python scripts/sql-test.py <tmp>   (só staging, sempre em rollback)
\set ON_ERROR_STOP on
begin;
set local timezone to 'America/Sao_Paulo';
create function pg_temp.bad(q text, code text, frag text) returns void language plpgsql as $$
begin
  begin execute q;
  exception when others then
    assert sqlstate = code, format('esperava %s veio %s: %s', code, sqlstate, sqlerrm);
    assert sqlerrm like frag, format('mensagem inesperada: %s', sqlerrm);
    return;
  end;
  raise exception 'aceitou o que devia recusar: %', q;
end $$;
do $$
declare
  u uuid := gen_random_uuid(); o uuid := gen_random_uuid();
  w uuid := gen_random_uuid(); ow uuid := gen_random_uuid();
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); b2 uuid := gen_random_uuid();
  card uuid := gen_random_uuid(); oa uuid := gen_random_uuid();
  d0 date := current_date;
  s1 uuid := gen_random_uuid(); s2 uuid := gen_random_uuid(); st uuid := gen_random_uuid();
  sx uuid := gen_random_uuid(); s3 uuid := gen_random_uuid(); s4 uuid := gen_random_uuid(); s5 uuid := gen_random_uuid(); s6 uuid := gen_random_uuid();
  x5 uuid := gen_random_uuid(); x6 uuid := gen_random_uuid();
  t_paid1 uuid := gen_random_uuid(); t_paid2 uuid := gen_random_uuid(); t_over uuid := gen_random_uuid();
  t_f1 uuid := gen_random_uuid(); t_f2 uuid := gen_random_uuid(); t_f3 uuid := gen_random_uuid();
  c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid();
  inv1 uuid; inv2 uuid;
  req uuid := gen_random_uuid();
  r jsonb; r2 jsonb; n bigint; n0 bigint; nxt timestamptz; mid uuid; mid2 uuid; rev bigint;
  inc0 numeric; exp0 numeric; inc1 numeric; exp1 numeric; sin numeric; sout numeric;
  ids0 uuid[]; fut date; dw uuid; da uuid := gen_random_uuid(); db uuid := gen_random_uuid();
begin
  insert into auth.users(id,email) values(u,'f18-'||u||'@example.invalid'),(o,'f18-'||o||'@example.invalid');
  insert into public.profiles(id) values(u),(o) on conflict do nothing;
  insert into public.workspaces(id,owner_id,name) values(w,u,'F18'),(ow,o,'F18 outro');
  insert into public.workspace_members(workspace_id,user_id,role) values(w,u,'owner'),(ow,o,'owner');
  insert into public.accounts(id,workspace_id,user_id,name,type,initial_balance_cents) values
    (a,w,u,'Conta A','checking',500000),(b,w,u,'Conta B','savings',0),(b2,w,u,'Conta B2','checking',0),
    (oa,ow,o,'Conta alheia','checking',0);
  insert into public.accounts(id,workspace_id,user_id,name,type,closing_day,due_day,credit_limit_cents,payment_account_id)
    values(card,w,u,'Cartao','credit_card',10,20,1000000,a);

  -- ── B. recusas de escopo (gatilho) ────────────────────────────────────────
  perform pg_temp.bad(format($f$insert into public.recurring_transactions(user_id,workspace_id,kind,amount_cents,description,account_id,counterparty_account_id,rrule,next_run_at,dtstart)
    values(%L,%L,'transfer',1000,'x',%L,%L,'FREQ=MONTHLY;BYMONTHDAY=5',now()+interval '1 day',now())$f$,u,w,a,a),
    'P0001','A conta de origem e a de destino precisam ser diferentes.');
  perform pg_temp.bad(format($f$insert into public.recurring_transactions(user_id,workspace_id,kind,amount_cents,description,account_id,counterparty_account_id,rrule,next_run_at,dtstart)
    values(%L,%L,'transfer',1000,'x',%L,%L,'FREQ=MONTHLY;BYMONTHDAY=5',now()+interval '1 day',now())$f$,u,w,a,oa),
    'P0001','As duas contas precisam ser deste espaço.');
  perform pg_temp.bad(format($f$insert into public.recurring_transactions(user_id,workspace_id,kind,amount_cents,description,account_id,counterparty_account_id,rrule,next_run_at,dtstart)
    values(%L,%L,'transfer',1000,'x',%L,%L,'FREQ=MONTHLY;BYMONTHDAY=5',now()+interval '1 day',now())$f$,u,w,a,card),
    'P0001','O destino da transferência não pode ser um cartão.');
  perform pg_temp.bad(format($f$insert into public.recurring_transactions(user_id,workspace_id,kind,amount_cents,description,account_id,rrule,next_run_at,dtstart)
    values(%L,%L,'transfer',1000,'x',%L,'FREQ=MONTHLY;BYMONTHDAY=5',now()+interval '1 day',now())$f$,u,w,a),
    'P0001','Escolha de qual conta sai e para qual conta vai.');
  perform pg_temp.bad(format($f$insert into public.recurring_transactions(user_id,workspace_id,kind,amount_cents,description,account_id,counterparty_account_id,rrule,next_run_at,dtstart)
    values(%L,%L,'expense',1000,'x',%L,%L,'FREQ=MONTHLY;BYMONTHDAY=5',now()+interval '1 day',now())$f$,u,w,a,b),
    'P0001','Só a transferência tem conta de destino.');

  -- ── A. encerrar: assinatura com o próximo vencimento no mês seguinte ─────────
  insert into public.recurring_transactions(id,user_id,workspace_id,kind,amount_cents,description,category,account_id,
      rrule,next_run_at,dtstart,auto_confirm,materialized_until)
    values(s1,u,w,'expense',5000,'Assinatura','assinaturas',a,'FREQ=MONTHLY;BYMONTHDAY=15',
      (d0+25)::timestamp::timestamptz,(d0-60)::timestamp::timestamptz,false,(d0+85)::timestamp::timestamptz);
  insert into public.transactions(id,user_id,workspace_id,kind,amount_cents,description,account_id,occurred_at,due_at,status,source,recurring_id)
  values
    (t_paid1,u,w,'expense',5000,'Assinatura',a,d0-40,d0-40,'cleared','recurring',s1),
    (t_paid2,u,w,'expense',5000,'Assinatura',a,d0-10,d0-10,'cleared','recurring',s1),
    (t_over,u,w,'expense',5000,'Assinatura',a,d0-5,d0-5,'pending','recurring',s1),
    (t_f1,u,w,'expense',5000,'Assinatura',a,d0+25,d0+25,'pending','recurring',s1),
    (t_f2,u,w,'expense',5000,'Assinatura',a,d0+55,d0+55,'pending','recurring',s1),
    (t_f3,u,w,'expense',5000,'Assinatura',a,d0+85,d0+85,'pending','recurring',s1);
  select next_run_at into nxt from public.recurring_transactions where id = s1;
  select count(*) into n0 from public.transactions where recurring_id = s1;
  select coalesce(sum(amount_cents) filter(where kind='income'),0),coalesce(sum(amount_cents) filter(where kind='expense'),0)
    into inc0,exp0 from public.transactions where workspace_id = w;

  perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('role','authenticated',true);

  -- prévia = comando (mesmos números), e a prévia não escreve
  r := public.end_recurring_series_preview(s1, d0);
  assert (r->>'removed_count')::int = 3 and (r->>'removed_cents')::bigint = 15000, format('prévia: %s', r);
  assert (r->>'kept_paid_count')::int = 2 and (r->>'kept_overdue_count')::int = 1 and (r->>'kept_locked_count')::int = 0, format('prévia: %s', r);
  assert (select count(*) from public.transactions where recurring_id = s1) = n0, 'a prévia escreveu';
  assert (select end_date from public.recurring_transactions where id = s1) is null, 'a prévia mexeu na série';

  r2 := public.end_recurring_series(s1, d0, req);
  assert r2 - 'end_date' = r - 'end_date' and (r2->>'end_date')::date = d0, format('comando %s != prévia %s', r2, r);
  assert (select end_date from public.recurring_transactions where id = s1) = d0, 'fim não gravado';
  assert not exists(select 1 from public.transactions where id in (t_f1,t_f2,t_f3)), 'futuras não saíram';
  assert (select count(*) from public.transactions where id in (t_paid1,t_paid2,t_over)) = 3, 'paga/atrasada saiu';
  assert (select next_run_at from public.recurring_transactions where id = s1) = nxt, 'o próximo vencimento foi movido';
  assert (select count(*) from public.transactions where recurring_id = s1) = 3, 'criou ou moveu cobrança';
  assert (select materialized_until from public.recurring_transactions where id = s1) is null, 'materialized_until não ajustado';
  assert (select active from public.recurring_transactions where id = s1), 'encerrar não é pausar';
  -- apagar pelo encerramento não vira data "pulada" (senão reabrir nunca as traria de volta)
  assert not exists(select 1 from private.recurring_moved_occurrences where recurring_id = s1), 'marcou pulada';
  -- consolidados: o que saiu é só a cobrança futura removida
  select coalesce(sum(amount_cents) filter(where kind='income'),0),coalesce(sum(amount_cents) filter(where kind='expense'),0)
    into inc1,exp1 from public.transactions where workspace_id = w;
  assert inc1 = inc0 and exp1 = exp0 - 15000, 'receita/despesa consolidadas';

  -- idempotente: mesma requisição devolve o recibo; outra requisição com a mesma data não remove nada
  assert public.end_recurring_series(s1, d0, req) = r2, 'o recibo não foi devolvido';
  perform pg_temp.bad(format('select public.end_recurring_series(%L,%L,%L)', s1, d0 + 1, req),
    '22023','Identificador reutilizado com dados diferentes');
  r := public.end_recurring_series(s1, d0, gen_random_uuid());
  assert (r->>'removed_count')::int = 0 and (r->>'removed_cents')::bigint = 0, format('encerrar de novo removeu: %s', r);
  -- recusas
  perform pg_temp.bad(format('select public.end_recurring_series(%L,%L,%L)', s1, d0 - 90, gen_random_uuid()),
    'P0001','A última cobrança não pode ser antes do início da série%');
  perform pg_temp.bad(format('select public.end_recurring_series(%L,null,%L)', s1, gen_random_uuid()), '22023','Informe a série e a última cobrança');
  perform pg_temp.bad(format('select public.end_recurring_series(%L,%L,null)', s1, d0), '22023','Identificador da tentativa obrigatório');
  perform pg_temp.bad(format('select public.end_recurring_series(%L,%L,%L)', gen_random_uuid(), d0, gen_random_uuid()), 'P0001','Recorrência não encontrada');

  -- reabrir = editar o fim: o agendador volta a gerar (a projeção lê a regra de novo)
  assert not exists(select 1 from private.recurring_projection_for(array[w], d0, d0 + 100) where recurring_id = s1 and due_date > d0), 'projeção além do fim';
  perform public.update_recurring_series(s1, jsonb_build_object('end_date', (d0 + 200)::text));
  assert (select end_date from public.recurring_transactions where id = s1) = d0 + 200, 'fim não reaberto';
  assert (select materialized_until from public.recurring_transactions where id = s1) is null, 'reabrir não zerou o gerado';
  assert exists(select 1 from private.recurring_projection_for(array[w], d0, d0 + 100) where recurring_id = s1 and due_date > d0), 'reabrir não devolveu as datas';
  assert (select count(*) from public.transactions where recurring_id = s1) = 3, 'reabrir recriou à força';
  perform public.update_recurring_series(s1, '{"end_date":null}'::jsonb);
  assert (select end_date from public.recurring_transactions where id = s1) is null;

  -- ── A. cobrança numa fatura paga em parte fica e é contada ──────────────────
  reset role;
  insert into public.recurring_transactions(id,user_id,workspace_id,kind,amount_cents,description,category,account_id,
      rrule,next_run_at,dtstart,auto_confirm,materialized_until)
    values(s2,u,w,'expense',7000,'Streaming','assinaturas',card,'FREQ=MONTHLY;BYMONTHDAY=12',
      (d0+10)::timestamp::timestamptz,(d0-30)::timestamp::timestamptz,false,(d0+90)::timestamp::timestamptz);
  insert into public.transactions(id,user_id,workspace_id,kind,amount_cents,description,account_id,occurred_at,status,source,recurring_id)
  values(c1,u,w,'expense',7000,'Streaming',card,d0+10,'pending','recurring',s2),
        (c2,u,w,'expense',7000,'Streaming',card,d0+70,'pending','recurring',s2);
  select invoice_id into inv1 from public.transactions where id = c1;
  select invoice_id into inv2 from public.transactions where id = c2;
  assert inv1 is not null and inv2 is not null and inv1 <> inv2, 'faturas deveriam diferir';
  update public.card_invoices set paid_cents = 1000 where id = inv1;
  perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('role','authenticated',true);
  r := public.end_recurring_series(s2, d0, gen_random_uuid());
  assert (r->>'removed_count')::int = 1 and (r->>'kept_locked_count')::int = 1, format('travada: %s', r);
  assert exists(select 1 from public.transactions where id = c1), 'a da fatura paga em parte saiu';
  assert not exists(select 1 from public.transactions where id = c2), 'a da fatura aberta ficou';

  -- outro usuário não encerra a série alheia
  perform set_config('request.jwt.claim.sub',o::text,true);
  perform pg_temp.bad(format('select public.end_recurring_series(%L,%L,%L)', s1, d0, gen_random_uuid()), 'P0001','Recorrência não encontrada');
  perform pg_temp.bad(format('select public.end_recurring_series_preview(%L,%L)', s1, d0), 'P0001','Recorrência não encontrada');
  perform set_config('request.jwt.claim.sub',u::text,true);

  -- ── HIGH-1: reabrir depois que o tempo passou não grava o passado como pago ──
  reset role;
  insert into public.recurring_transactions(id,user_id,workspace_id,kind,amount_cents,description,account_id,
      rrule,next_run_at,dtstart,auto_confirm,end_date)
    values(s3,u,w,'expense',3000,'Parada',a,'FREQ=MONTHLY;BYMONTHDAY=15',
      (d0-40)::timestamp::timestamptz + interval '12 hours',(d0-100)::timestamp::timestamptz,true,d0-50);
  perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('role','authenticated',true);
  perform public.update_recurring_series(s3, '{"end_date":null}'::jsonb);
  assert (select next_run_at from public.recurring_transactions where id = s3) >= now(), 'reabrir deixou o próximo vencimento no passado';
  assert (select (next_run_at at time zone 'America/Sao_Paulo')::time from public.recurring_transactions where id = s3) = time '12:00', 'o horário não foi preservado';
  assert (select (next_run_at at time zone 'America/Sao_Paulo')::date from public.recurring_transactions where id = s3)
    in (select due_date from private.recurring_dates_for('FREQ=MONTHLY;BYMONTHDAY=15', d0 - 100, d0, d0 + 400)), 'o próximo vencimento não é uma data da regra';
  assert (select materialized_until from public.recurring_transactions where id = s3) is null;

  -- ── MEDIUM-1: o piso é o menor entre dtstart, versões e ocorrências ────────
  reset role;
  insert into public.recurring_transactions(id,user_id,workspace_id,kind,amount_cents,description,account_id,
      rrule,next_run_at,dtstart,auto_confirm)
    values(s4,u,w,'expense',4000,'Calendario editado',a,'FREQ=MONTHLY;BYMONTHDAY=10',
      (d0+30)::timestamp::timestamptz,(d0+30)::timestamp::timestamptz,false);
  insert into public.transactions(user_id,workspace_id,kind,amount_cents,description,account_id,occurred_at,due_at,status,source,recurring_id)
  values(u,w,'expense',4000,'Calendario editado',a,d0-70,d0-70,'cleared','recurring',s4),
        (u,w,'expense',4000,'Calendario editado',a,d0+30,d0+30,'pending','recurring',s4);
  perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('role','authenticated',true);
  perform pg_temp.bad(format('select public.end_recurring_series_preview(%L,%L)', s4, d0 - 90),
    'P0001','A última cobrança não pode ser antes do início da série%');
  r := public.end_recurring_series_preview(s4, d0 - 60);
  assert (r->>'removed_count')::int = 1 and (r->>'kept_paid_count')::int = 1, format('piso: %s', r);

  -- ── MEDIUM-3: o fim EDITADO usa a régua do Encerrar ─────────────────────────
  reset role;
  insert into public.recurring_transactions(id,user_id,workspace_id,kind,amount_cents,description,account_id,
      rrule,next_run_at,dtstart,auto_confirm)
    values(s5,u,w,'expense',500,'Compra com vencimento depois',a,'FREQ=MONTHLY;BYMONTHDAY=5',
      (d0+5)::timestamp::timestamptz,(d0-20)::timestamp::timestamptz,false),
      (s6,u,w,'expense',7000,'Fatura travada',card,'FREQ=MONTHLY;BYMONTHDAY=12',
      (d0+10)::timestamp::timestamptz,(d0-20)::timestamp::timestamptz,false);
  insert into public.transactions(id,user_id,workspace_id,kind,amount_cents,description,account_id,occurred_at,due_at,status,source,recurring_id)
  values(x5,u,w,'expense',500,'Compra com vencimento depois',a,d0+5,d0+20,'pending','recurring',s5),
        (x6,u,w,'expense',7000,'Fatura travada',card,d0+10,null,'pending','recurring',s6);
  assert (select invoice_id from public.transactions where id = x6) = inv1, 'a compra deveria cair na fatura paga em parte';
  perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('role','authenticated',true);
  -- fora do cartão vale o VENCIMENTO (20), não a data (5): com fim no dia 10 ela sai
  perform public.update_recurring_series(s5, jsonb_build_object('end_date', (d0 + 10)::text));
  assert not exists(select 1 from public.transactions where id = x5), 'o fim editado não usou o vencimento';
  -- fatura paga em parte: o fim editado NÃO apaga
  perform public.update_recurring_series(s6, jsonb_build_object('end_date', (d0 + 1)::text));
  assert exists(select 1 from public.transactions where id = x6), 'o fim editado apagou cobrança de fatura paga em parte';

  -- LOW-3 / LOW-7
  reset role;
  update public.accounts set archived = true where id = b2;
  perform pg_temp.bad(format($f$insert into public.recurring_transactions(user_id,workspace_id,kind,amount_cents,description,account_id,counterparty_account_id,rrule,next_run_at,dtstart)
    values(%L,%L,'transfer',1000,'x',%L,%L,'FREQ=MONTHLY;BYMONTHDAY=5',now()+interval '1 day',now())$f$,u,w,a,b2),
    'P0001','Conta arquivada não pode ser origem nem destino da transferência.');
  update public.accounts set archived = false where id = b2;
  perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('role','authenticated',true);
  perform pg_temp.bad(format($f$select public.update_recurring_series(%L,'{"kind":"transfer"}')$f$, s5),
    'P0001','Para trocar o tipo da série, converta o registro.');

  -- ── B. transferência recorrente: projeção, previstas, materialização ───────
  reset role;
  -- só a transferência fica no espaço: os eventos de caixa abaixo são dela
  update public.card_invoices set paid_cents = 0 where workspace_id = w;   -- o gatilho de apagar não deixa fatura paga em parte ficar abaixo do pago
  delete from public.transactions where workspace_id = w;
  delete from public.recurring_transactions where id in (s1, s2, s3, s4, s5, s6);
  select coalesce(sum(amount_cents) filter(where kind='income'),0),coalesce(sum(amount_cents) filter(where kind='expense'),0)
    into inc1,exp1 from public.transactions where workspace_id = w;
  insert into public.recurring_transactions(id,user_id,workspace_id,kind,amount_cents,description,account_id,rrule,next_run_at,dtstart,active)
    values(sx,u,w,'expense',900,'Despesa avulsa da regra',a,'FREQ=MONTHLY;BYMONTHDAY=3',(d0+3)::timestamp::timestamptz,(d0+3)::timestamp::timestamptz,false);
  insert into public.recurring_transactions(id,user_id,workspace_id,kind,amount_cents,description,account_id,counterparty_account_id,
      rrule,next_run_at,dtstart,auto_confirm)
    values(st,u,w,'transfer',20000,'Reserva mensal',a,b,'FREQ=MONTHLY;BYMONTHDAY=-1',
      (d0+3)::timestamp::timestamptz,(d0+3)::timestamp::timestamptz,false);
  assert (select counterparty_account_id from private.recurring_history_versions where recurring_id = st) = b, 'versão sem a contraparte';
  assert (select count(*) from private.recurring_projection_all_for(array[w], d0, d0 + 95) where recurring_id = st) >= 3, 'projeção da regra';

  -- as duas pontas, no mesmo dia, consolidado zero
  select coalesce(sum(in_cents),0), coalesce(sum(out_cents),0) into sin, sout
    from private.eventos_de_caixa(array[w], d0 + 95) where account_id in (a, b);
  assert sin = sout and sin > 0, format('consolidado da transferência: entra %s sai %s', sin, sout);
  assert (select coalesce(sum(out_cents),0) from private.eventos_de_caixa(array[w], d0 + 95) where account_id = a)
       = (select coalesce(sum(in_cents),0) from private.eventos_de_caixa(array[w], d0 + 95) where account_id = b), 'origem != destino';
  assert (select coalesce(sum(in_cents),0) from private.eventos_de_caixa(array[w], d0 + 95) where account_id = a) = 0, 'entrou na origem';
  assert (select coalesce(sum(out_cents),0) from private.eventos_de_caixa(array[w], d0 + 95) where account_id = b) = 0, 'saiu do destino';

  perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('role','authenticated',true);
  -- as listas (mês, ciclo, e-se) leem a porta SEM transferência: nada de linha "R$ 0,00" fantasma
  assert exists(select 1 from private.recurring_projection_all_for(array[w], d0, d0 + 95) where recurring_id = st and kind = 'transfer'), 'a porta completa perdeu a transferência';
  assert not exists(select 1 from private.recurring_projection_for(array[w], d0, d0 + 95) where recurring_id = st), 'a porta das listas devolveu a transferência';
  assert not exists(select 1 from public.month_lines(date_trunc('month', d0 + 40)::date) where origin = 'recurring_projection' and ref_id = st), 'linha 0/0 da transferência no mês';
  -- a linha prevista da lista diz origem E destino
  assert exists(select 1 from public.ledger_expected_lines_transfer(d0, d0 + 61, st)
    where kind = 'transfer' and account_id = a and counterparty_account_id = b), 'prevista sem as duas contas';

  -- tocar na prevista grava a transferência com o destino, uma vez
  select due_date into fut from private.recurring_projection_all_for(array[w], d0, d0 + 95) where recurring_id = st order by due_date limit 1;
  mid := public.materialize_recurring_occurrence(st, fut);
  mid2 := public.materialize_recurring_occurrence(st, fut);
  assert mid = mid2, 'tocar duas vezes criou duas';
  assert (select kind from public.transactions where id = mid) = 'transfer'
     and (select counterparty_account_id from public.transactions where id = mid) = b
     and (select account_id from public.transactions where id = mid) = a, 'ocorrência sem origem/destino';
  assert (select count(*) from public.transactions where recurring_id = st) = 1, 'duplicou';
  -- o agendador (Python) repete o mesmo caminho: o unique `(recurring_id, occurred_at)` segura
  begin
    insert into public.transactions(user_id,workspace_id,kind,amount_cents,description,account_id,counterparty_account_id,occurred_at,due_at,source,status,recurring_id)
      values(u,w,'transfer',20000,'Reserva mensal',a,b,fut,fut,'recurring','pending',st);
    raise exception 'unique não segurou';
  exception when unique_violation then null;
  end;
  -- receita/despesa consolidadas não mudam por causa da transferência
  select coalesce(sum(amount_cents) filter(where kind='income'),0),coalesce(sum(amount_cents) filter(where kind='expense'),0)
    into inc0,exp0 from public.transactions where workspace_id = w and recurring_id is distinct from st;
  assert inc0 = inc1 and exp0 = (select coalesce(sum(amount_cents) filter(where kind='expense'),0) from public.transactions where workspace_id = w), 'transferência virou receita/despesa';

  -- editar o destino: série e ocorrências em aberto
  perform public.update_recurring_series(st, jsonb_build_object('counterparty_account_id', b2::text));
  assert (select counterparty_account_id from public.recurring_transactions where id = st) = b2, 'destino não mudou';
  assert (select counterparty_account_id from public.transactions where id = mid) = b2, 'ocorrência em aberto sem o destino novo';
  reset role;
  assert (select counterparty_account_id from private.recurring_history_versions where recurring_id = st and valid_through is null) = b2, 'versão aberta sem o destino novo';
  perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('role','authenticated',true);
  -- recusas na edição
  perform pg_temp.bad(format($f$select public.update_recurring_series(%L,'{"counterparty_account_id":"%s"}')$f$, st, a),
    'P0001','A conta de origem e a de destino precisam ser diferentes.');
  perform pg_temp.bad(format($f$select public.update_recurring_series(%L,'{"counterparty_account_id":"%s"}')$f$, st, oa),
    'P0001','Escolha uma conta do espaço que não seja cartão para o destino.');
  perform pg_temp.bad(format($f$select public.update_recurring_series(%L,'{"counterparty_account_id":"%s"}')$f$, st, card),
    'P0001','Escolha uma conta do espaço que não seja cartão para o destino.');
  perform pg_temp.bad(format($f$select public.update_recurring_series(%L,'{"counterparty_account_id":null}')$f$, st),
    'P0001','Escolha de qual conta sai e para qual conta vai.');
  perform pg_temp.bad(format($f$select public.update_recurring_series(%L,'{"kind":"expense"}')$f$, st),
    'P0001','Para trocar o tipo da série, converta o registro.');
  perform pg_temp.bad(format($f$select public.update_recurring_series(%L,'{"counterparty_account_id":"%s"}')$f$, sx, b),
    'P0001','Só a transferência tem conta de destino.');
  -- "Todas": o destino vai pela camada nova
  select edit_revision into rev from public.recurring_transactions where id = st;
  perform public.update_recurring_all(st, '{}'::jsonb, jsonb_build_object('counterparty_account_id', b::text), rev, gen_random_uuid());
  assert (select counterparty_account_id from public.recurring_transactions where id = st) = b, 'todas: destino da série';
  assert (select counterparty_account_id from public.transactions where id = mid) = b, 'todas: destino da ocorrência';

  -- criar pela porta do app (`create_recurring_payment`): a transferência nasce com o destino.
  -- A criação grava no espaço PADRÃO de quem chama: as contas dela moram lá.
  dw := public.my_default_workspace();
  reset role;
  insert into public.accounts(id,workspace_id,user_id,name,type) values(da,dw,u,'Padrao A','checking'),(db,dw,u,'Padrao B','checking');
  perform set_config('request.jwt.claim.sub',u::text,true);perform set_config('role','authenticated',true);
  r := public.create_recurring_payment(jsonb_build_object('kind','transfer','amount_cents',15000,'description','Reserva nova',
    'account_id',da,'counterparty_account_id',db,'rrule','FREQ=MONTHLY;BYMONTHDAY=7',
    'next_run_at',((d0+5)::timestamp::timestamptz)::text,'dtstart',((d0+5)::timestamp::timestamptz)::text,'end_date',null,'auto_confirm',false), gen_random_uuid());
  assert (select kind from public.recurring_transactions where id = (r->>'id')::uuid) = 'transfer'
     and (select counterparty_account_id from public.recurring_transactions where id = (r->>'id')::uuid) = db, 'criada sem o destino';
  perform pg_temp.bad(format($f$select public.create_recurring_payment('{"kind":"transfer","amount_cents":1,"description":"x","account_id":"%s","counterparty_account_id":"%s","rrule":"FREQ=MONTHLY;BYMONTHDAY=7","next_run_at":"2030-01-07T12:00:00Z","dtstart":"2030-01-07T12:00:00Z","end_date":null,"auto_confirm":false}'::jsonb, gen_random_uuid())$f$, da, da),
    'P0001','A conta de origem e a de destino precisam ser diferentes.');

  -- encerrar a transferência: mesma regra
  r := public.end_recurring_series(st, d0 + 3, gen_random_uuid());
  assert (r->>'removed_count')::int = (case when fut > d0 + 3 then 1 else 0 end), format('encerrar a transferência: %s', r);
  assert (select end_date from public.recurring_transactions where id = st) = d0 + 3;

  -- uma série de transferência não vira outra coisa por UPDATE direto (conversão é explícita)
  reset role;
  perform pg_temp.bad(format($f$update public.recurring_transactions set kind='expense' where id=%L$f$, st), 'P0001', 'Só a transferência tem conta de destino.');
end $$;
rollback;
