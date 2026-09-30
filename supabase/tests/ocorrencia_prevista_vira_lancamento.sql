-- A prevista vira lançamento no toque (uma vez só), a leitura não mostra fantasma e a apagada
-- não volta como prevista.
\set ON_ERROR_STOP on
begin;
do $$
declare
  u uuid := '00000000-0000-0000-0000-00000000e1a1';
  stranger uuid := '00000000-0000-0000-0000-00000000e1a2';
  w uuid := '00000000-0000-0000-0000-00000000e1b1';
  serie uuid := '00000000-0000-0000-0000-00000000e1c1';
  paga uuid := '00000000-0000-0000-0000-00000000e1c2';
  fundacred uuid := '00000000-0000-0000-0000-00000000e1c3';
  intocada uuid := '00000000-0000-0000-0000-00000000e1c4';
  gemeas uuid := '00000000-0000-0000-0000-00000000e1c5';
  base date := date_trunc('month', current_date)::date;
  primeira date := private.add_months(base, 1) + 7;
  segunda date := private.add_months(base, 2) + 7;
  terceira date := private.add_months(base, 3) + 7;
  quarta date := private.add_months(base, 4) + 7;
  passada date := private.add_months(base, -1) + 4;
  id1 uuid;
  id2 uuid;
  solta uuid;
  linha record;
begin
  insert into auth.users(id, email) values
    (u, 'prevista-dono@example.invalid'), (stranger, 'prevista-outro@example.invalid')
    on conflict (id) do nothing;
  insert into public.profiles(id) values (u), (stranger) on conflict (id) do nothing;
  insert into public.workspaces(id, owner_id, name) values (w, u, 'Prevista');
  insert into public.workspace_members(workspace_id, user_id, role) values (w, u, 'owner');
  insert into public.recurring_transactions
    (id, workspace_id, user_id, kind, amount_cents, description, merchant, rrule, dtstart, next_run_at)
  values (serie, w, u, 'expense', 12000, 'Internet', 'Vivo', 'FREQ=MONTHLY;BYMONTHDAY=8', primeira, primeira);
  insert into public.recurring_transactions
    (id, workspace_id, user_id, kind, amount_cents, description, rrule, dtstart, next_run_at, auto_confirm)
  values (paga, w, u, 'expense', 5000, 'Academia', 'FREQ=MONTHLY;BYMONTHDAY=5', passada, passada, true);
  -- o Fundacred: regra no dia 30, a linha do mês tem data 04 e vencimento 30
  insert into public.recurring_transactions
    (id, workspace_id, user_id, kind, amount_cents, description, rrule, dtstart, next_run_at)
  values (fundacred, w, u, 'expense', 119885, 'Fundacred', 'FREQ=MONTHLY;BYMONTHDAY=30',
          private.add_months(base, 1) + 3, private.add_months(base, 1) + 3);
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, due_at, source, status, recurring_id)
  values (w, u, 'expense', 119885, 'Fundacred', private.add_months(base, 1) + 3,
          private.day_in_month(private.add_months(base, 1), 30), 'recurring', 'pending', fundacred);
  insert into public.recurring_transactions
    (id, workspace_id, user_id, kind, amount_cents, description, rrule, dtstart, next_run_at)
  values (intocada, w, u, 'expense', 3000, 'Streaming', 'FREQ=MONTHLY;BYMONTHDAY=12',
          private.add_months(base, 1) + 11, private.add_months(base, 1) + 11);
  -- a gêmea: lançada à mão no dia, antes de a série existir
  -- A âncora também é o dia 3: base - 28 pode cair no dia 4, depois da
  -- ocorrência que o teste pede. Uma data anterior ao dtstart não é prevista.
  insert into public.recurring_transactions
    (id, workspace_id, user_id, kind, amount_cents, description, rrule, dtstart, next_run_at)
  values (gemeas, w, u, 'expense', 8000, 'Água', 'FREQ=MONTHLY;BYMONTHDAY=3',
          private.day_in_month(base - 28, 3), private.day_in_month(base - 28, 3));
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, source, status)
  values (w, u, 'expense', 8000, 'agua', private.day_in_month(base - 28, 3), 'app', 'cleared')
  returning id into solta;

  perform set_config('request.jwt.claim.sub', u::text, true);
  perform set_config('role', 'authenticated', true);

  -- toque: vira a linha que o agendador criaria, e o segundo toque devolve a MESMA
  id1 := public.materialize_recurring_occurrence(serie, segunda);
  id2 := public.materialize_recurring_occurrence(serie, segunda);
  assert id1 = id2, 'o segundo toque não cria outra linha';
  select * into linha from public.transactions where id = id1;
  assert linha.occurred_at = segunda and linha.due_at = segunda, 'data e vencimento no dia da ocorrência';
  assert linha.status = 'pending' and linha.source = 'recurring' and linha.recurring_id = serie;
  assert linha.amount_cents = 12000 and linha.merchant = 'Vivo' and linha.description = 'Internet';
  assert (select count(*) from public.transactions where recurring_id = serie) = 1;
  assert not exists (select 1 from public.ledger_expected_lines(segunda, segunda, serie)),
    'materializada, a ocorrência deixa de ser prevista';

  -- dia que não é da regra: recusa
  begin
    perform public.materialize_recurring_occurrence(serie, segunda + 1);
    raise exception 'dia fora da regra aceito';
  exception when others then
    assert sqlerrm like '%não existe mais%', sqlerrm;
  end;

  -- a prevista já diz o estado que a linha terá
  assert (select status from public.ledger_expected_lines(passada, passada, paga)) = 'cleared',
    'passada com "entra como pago" não é atrasada';
  assert (select status from public.ledger_expected_lines(terceira, terceira, serie)) = 'pending';

  -- passado com "entra como pago": nasce baixado, como no agendador
  id2 := public.materialize_recurring_occurrence(paga, passada);
  assert (select status from public.transactions where id = id2) = 'cleared', 'passada com auto_confirm entra paga';

  -- a gêmea solta do mesmo dia é adotada, não duplicada
  id2 := public.materialize_recurring_occurrence(gemeas, private.day_in_month(base - 28, 3));
  assert id2 = solta, 'adota o lançamento solto idêntico';
  assert (select recurring_id from public.transactions where id = solta) = gemeas;
  assert (select count(*) from public.transactions where occurred_at = private.day_in_month(base - 28, 3)
          and workspace_id = w) = 1, 'sem cobrança em dobro';

  -- Fundacred: o mês já tem a cobrança dele (vence 30) — o dia 30 não aparece nem vira outra linha
  assert not exists (select 1 from public.ledger_expected_lines(private.add_months(base, 1),
    private.day_in_month(private.add_months(base, 1), 31), fundacred)),
    'o vencimento 30 do Fundacred não aparece ao lado da linha de 04';
  begin
    perform public.materialize_recurring_occurrence(fundacred, private.day_in_month(private.add_months(base, 1), 30));
    raise exception 'Fundacred em dobro';
  exception when others then
    assert sqlerrm like '%não existe mais%', sqlerrm;
  end;

  -- apagar UMA ocorrência: ela não volta como prevista, nem pelo toque
  delete from public.transactions where id = id1;
  assert not exists (select 1 from public.ledger_expected_lines(segunda, segunda, serie)),
    'a ocorrência apagada não reaparece como prevista';
  begin
    perform public.materialize_recurring_occurrence(serie, segunda);
    raise exception 'apagada recriada';
  exception when others then
    assert sqlerrm like '%não existe mais%', sqlerrm;
  end;

  -- refazer o calendário apaga as em aberto SEM marcar o dia, e o dia antigo não vira fantasma
  -- (a primeira em aberto MUDA de data; a seguinte é a apagada)
  perform public.materialize_recurring_occurrence(serie, terceira);
  perform public.materialize_recurring_occurrence(serie, quarta);
  perform public.update_recurring_series(serie, jsonb_build_object(
    'rrule', 'FREQ=MONTHLY;BYMONTHDAY=9', 'next_run_at', (terceira + 1)::timestamptz), true);
  assert not exists (select 1 from public.transactions where recurring_id = serie and occurred_at = quarta),
    'o calendário refeito apagou a em aberto';
  assert not exists (select 1 from private.recurring_moved_occurrences m
    where m.recurring_id = serie and m.original_date = quarta),
    'o calendário refeito não vira ocorrência apagada';
  assert not exists (select 1 from public.ledger_expected_lines(terceira, terceira, serie)),
    'o dia 8 antigo não aparece ao lado da linha movida para o 9';

  -- no trecho que o agendador gerou (1ª linha até materialized_until) o dia sem linha foi tirado
  -- de propósito; antes da 1ª linha e depois do horizonte continua previsto
  insert into public.transactions (workspace_id, user_id, kind, amount_cents, description, occurred_at, due_at, source, status, recurring_id)
  values (w, u, 'expense', 3000, 'Streaming', private.add_months(base, 1) + 11, private.add_months(base, 1) + 11, 'recurring', 'pending', intocada),
         (w, u, 'expense', 3000, 'Streaming', private.add_months(base, 3) + 11, private.add_months(base, 3) + 11, 'recurring', 'pending', intocada);
  update public.recurring_transactions set materialized_until = (private.add_months(base, 3) + 20)::timestamptz
   where id = intocada;
  assert not exists (select 1 from public.ledger_expected_lines(private.add_months(base, 2) + 11,
    private.add_months(base, 2) + 11, intocada)), 'dentro do trecho gerado, sem linha = apagada';
  assert exists (select 1 from public.ledger_expected_lines(private.add_months(base, 4) + 11,
    private.add_months(base, 4) + 11, intocada)), 'além do horizonte continua prevista';

  -- apagar a PREVISTA: só a marca, e ela some
  perform public.skip_recurring_occurrence(intocada, private.add_months(base, 4) + 11);
  assert not exists (select 1 from public.ledger_expected_lines(private.add_months(base, 4) + 11,
    private.add_months(base, 4) + 11, intocada)), 'a prevista apagada some';
  begin
    perform public.skip_recurring_occurrence(paga, passada);
    raise exception 'apagou lançamento pela prevista';
  exception when others then
    assert sqlerrm like '%já é um lançamento%', sqlerrm;
  end;

  -- outro workspace não materializa nem apaga
  perform set_config('request.jwt.claim.sub', stranger::text, true);
  begin
    perform public.materialize_recurring_occurrence(serie, private.add_months(base, 5) + 8);
    raise exception 'outro workspace materializou';
  exception when others then
    assert sqlerrm like '%não existe mais%', sqlerrm;
  end;
  begin
    perform public.skip_recurring_occurrence(serie, private.add_months(base, 5) + 8);
    raise exception 'outro workspace apagou';
  exception when others then
    assert sqlerrm like '%não existe mais%', sqlerrm;
  end;
end $$;

-- apagar a série inteira, com uma série que NÃO foi atualizada nesta transação (sem a marca):
-- apagar uma ocorrência grava a marca; apagar a série leva as futuras e a marca no cascade
do $$
declare
  u uuid := '00000000-0000-0000-0000-00000000e1a1';
  w uuid := '00000000-0000-0000-0000-00000000e1b1';
  outra uuid := '00000000-0000-0000-0000-00000000e1c6';
  base date := date_trunc('month', current_date)::date;
  uma uuid;
begin
  perform set_config('request.jwt.claim.sub', u::text, true);
  perform set_config('role', 'authenticated', true);
  insert into public.recurring_transactions
    (id, workspace_id, user_id, kind, amount_cents, description, rrule, dtstart, next_run_at)
  values (outra, w, u, 'expense', 4000, 'Seguro', 'FREQ=MONTHLY;BYMONTHDAY=20',
          private.add_months(base, 1) + 19, private.add_months(base, 1) + 19);
  uma := public.materialize_recurring_occurrence(outra, private.add_months(base, 1) + 19);
  perform public.materialize_recurring_occurrence(outra, private.add_months(base, 2) + 19);
  delete from public.transactions where id = uma;
  assert exists (select 1 from private.recurring_moved_occurrences
    where recurring_id = outra and original_date = private.add_months(base, 1) + 19), 'apagar uma grava a marca';
  delete from public.recurring_transactions where id = outra;
  assert not exists (select 1 from private.recurring_moved_occurrences where recurring_id = outra);
  assert not exists (select 1 from public.transactions where recurring_id = outra);
end $$;
-- trocar o dia deixa UMA prevista por mês: a versão velha (dia 15) fecha na véspera do vencimento
-- novo, no meio do mês; entre as duas no mesmo mês vale a mais nova (o último dia)
do $$
declare
  u uuid := '00000000-0000-0000-0000-00000000e1a1';
  w uuid := '00000000-0000-0000-0000-00000000e1b1';
  troca uuid := '00000000-0000-0000-0000-00000000e1c7';
  base date := date_trunc('month', current_date)::date;
  mes date;
  fim date;
begin
  perform set_config('request.jwt.claim.sub', u::text, true);
  perform set_config('role', 'authenticated', true);
  mes := private.add_months(base, 2);
  fim := (mes + interval '1 month - 1 day')::date;
  insert into public.recurring_transactions
    (id, workspace_id, user_id, kind, amount_cents, description, rrule, dtstart, next_run_at)
  values (troca, w, u, 'expense', 2500, 'Troca de dia', 'FREQ=MONTHLY;BYMONTHDAY=15',
          private.add_months(base, 1) + 14, private.add_months(base, 1) + 14);
  perform public.update_recurring_series(troca, jsonb_build_object(
    'rrule', 'FREQ=MONTHLY;BYMONTHDAY=-1', 'next_run_at', fim::timestamptz), true);
  assert (select count(*) from public.ledger_expected_lines(mes, fim, troca)) = 1,
    format('duas previstas no mesmo mês: %s',
      (select string_agg(due_date::text, ', ') from public.ledger_expected_lines(mes, fim, troca)));
  assert (select due_date from public.ledger_expected_lines(mes, fim, troca)) = fim, 'vale a regra nova';
  -- apagada a prevista da regra nova, a da regra velha NÃO ocupa o lugar dela
  perform public.skip_recurring_occurrence(troca, fim);
  assert not exists (select 1 from public.ledger_expected_lines(mes, fim, troca)),
    format('a regra velha voltou: %s', (select string_agg(due_date::text, ', ') from public.ledger_expected_lines(mes, fim, troca)));
end $$;
rollback;
