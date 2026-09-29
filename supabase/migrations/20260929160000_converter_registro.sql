-- A conversão de tipo de um registro que existe (spec 2026-09-29-formulario-unico, Parte 2):
-- encerra a ORIGEM pelo alcance escolhido e cria o DESTINO numa transação só. Qualquer recusa
-- desfaz tudo.
--
-- `p_destino` é o MESMO `{tipo, dados}` de `registroDaHipotese` (src/lib/hipotese.ts), e o destino
-- nasce por `private.criar_registro_da_hipotese` — o caminho de criação do `simular`, para não
-- nascer uma segunda cópia da regra. Só a conversão NO LUGAR (a linha adotada) escreve à mão.
--
-- Alcances: `so_esta` (ocorrência de recorrente), `desta_em_diante`, `todas`, `manter` e
-- `converter` (lançamento avulso). Sem passado, "Todas" da série/compra/dívida continua sendo
-- `todas` aqui — `converter` é só do avulso.
create or replace function public.converter_registro(p_origem jsonb, p_alcance text, p_destino jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
set timezone to 'America/Sao_Paulo'
as $$
declare
  v_tipo text := p_origem->>'tipo';
  v_id uuid := (p_origem->>'id')::uuid;
  v_tx public.transactions;
  v_serie uuid;
  v_plano uuid;
  v_divida uuid;
  v_ancora date;
  v_novo jsonb;
  v_linha jsonb;
  v_resto jsonb;
  v_ids jsonb;
  v_dia date;
  v_importados uuid[];
  v_restam int;
  v_dados jsonb := p_destino->'dados';
  v_destino text := p_destino->>'tipo';
begin
  if p_alcance is null or p_alcance not in ('so_esta', 'desta_em_diante', 'todas', 'manter', 'converter') then
    raise exception 'Alcance desconhecido: %', p_alcance;
  end if;

  if v_tipo = 'transacao' then
    select * into v_tx from public.transactions where id = v_id for update;
    if v_tx.id is null then raise exception 'Esse lançamento não existe mais.'; end if;
    v_serie := v_tx.recurring_id;
    v_plano := v_tx.installment_plan_id;
    v_divida := v_tx.debt_id;
    -- Fora do cartão a data que conta é o vencimento; no cartão `due_at` é o da FATURA, e a
    -- compra já aconteceu na data dela (a régua de `update_recurring_series`).
    v_ancora := case when v_tx.invoice_id is null then coalesce(v_tx.due_at, v_tx.occurred_at) else v_tx.occurred_at end;
  elsif v_tipo = 'serie' then
    select id, (next_run_at at time zone 'America/Sao_Paulo')::date into v_serie, v_ancora
      from public.recurring_transactions where id = v_id for update;
    if v_serie is null then raise exception 'Essa recorrência não existe mais.'; end if;
  elsif v_tipo = 'plano' then
    select id into v_plano from public.installment_plans where id = v_id for update;
    if v_plano is null then raise exception 'Essa compra não existe mais.'; end if;
  elsif v_tipo = 'divida' then
    select id into v_divida from public.debts where id = v_id for update;
    if v_divida is null then raise exception 'Essa dívida não existe mais.'; end if;
  else
    raise exception 'Origem desconhecida: %', v_tipo;
  end if;

  -- MANTER: nada muda na origem
  if p_alcance = 'manter' then
    v_novo := private.criar_registro_da_hipotese(v_destino, v_dados);
    return jsonb_build_object('ids', v_novo->'ids');
  end if;

  -- Um lançamento avulso não tem passado nem futuro: ele se converte ou fica.
  if v_tx.id is not null and v_serie is null and v_plano is null and v_divida is null
     and p_alcance in ('desta_em_diante', 'todas') then
    raise exception 'Um lançamento avulso se converte ou fica: "Desta em diante" e "Todas" são de série, compra ou dívida.';
  end if;

  -- SÓ ESTA: a ocorrência sai da série (a data fica "pulada") e segue como avulsa. A ordem importa:
  -- `skip_recurring_occurrence` recusa a data que ainda tem lançamento da série.
  if p_alcance = 'so_esta' then
    if v_tx.id is null or v_serie is null then
      raise exception '"Só esta" vale para uma ocorrência de recorrente.';
    end if;
    update public.transactions set recurring_id = null where id = v_tx.id;
    perform public.skip_recurring_occurrence(v_serie, v_tx.occurred_at);
    v_serie := null;
    v_tx.recurring_id := null;  -- a cópia em memória também: o financiamento reinsere a partir dela
  end if;

  -- CONVERTER (ou o que sobrou do "Só esta"): a própria linha vira o destino, com o mesmo id
  if p_alcance in ('converter', 'so_esta') then
    if v_tx.id is null or v_serie is not null or v_plano is not null or v_divida is not null then
      raise exception 'Só um lançamento avulso se converte no lugar.';
    end if;
    if private.parcela_travada('pending', v_tx.invoice_id) then
      raise exception 'A fatura desse lançamento já foi paga, adiada ou paga em parte: desfaça o pagamento da fatura antes.';
    end if;

    if v_destino = 'lancamento' then
      v_linha := v_dados->'linhas'->0;
      if v_linha is null then raise exception 'hipótese sem linhas'; end if;
      -- `source` é procedência (WhatsApp, importação): a linha adotada guarda a dela.
      update public.transactions set
        kind = v_linha->>'kind', amount_cents = (v_linha->>'amount_cents')::bigint,
        category = v_linha->>'category', description = v_linha->>'description',
        merchant = v_linha->>'merchant', account_id = (v_linha->>'account_id')::uuid,
        counterparty_account_id = (v_linha->>'counterparty_account_id')::uuid,
        occurred_at = (v_linha->>'occurred_at')::date, status = v_linha->>'status',
        due_at = (v_linha->>'due_at')::date, auto_confirm = coalesce((v_linha->>'auto_confirm')::boolean, false)
      where id = v_tx.id;
      v_ids := jsonb_build_array(v_tx.id);
      -- A segunda linha (os juros do Pix no crédito) nasce pelo caminho de criação.
      v_resto := (v_dados->'linhas') - 0;
      if jsonb_array_length(v_resto) > 0 then
        v_ids := v_ids || (private.criar_registro_da_hipotese('lancamento', jsonb_build_object('linhas', v_resto))->'ids');
      end if;
      return jsonb_build_object('ids', v_ids);

    elsif v_destino = 'parcelada' then
      if coalesce((v_dados->>'ultimo_dia')::boolean, false) then
        raise exception 'Converter um lançamento em parcelas no último dia do mês ainda não é possível: escolha um dia fixo.';
      end if;
      v_plano := public.convert_transaction_to_installments(
        v_tx.id, (v_dados->>'p_total_cents')::bigint, (v_dados->>'p_installments')::int,
        (v_dados->>'p_occurred_at')::date, v_dados->>'p_description', v_dados->>'p_category',
        v_dados->>'p_merchant', (v_dados->>'p_account_id')::uuid,
        coalesce((v_dados->>'p_paid_installments')::int, 0));
      return jsonb_build_object('ids', to_jsonb(v_plano || array(
        select t.id from public.transactions t where t.installment_plan_id = v_plano order by t.installment_no)));

    elsif v_destino = 'recorrente' then
      v_novo := private.criar_registro_da_hipotese('recorrente', v_dados);
      -- A 1ª ocorrência da série é o dia do `dtstart`: o agendador materializa a partir dele e só
      -- pula a data que já tem linha (unique `(recurring_id, occurred_at)`). Em outro dia, nasceria
      -- uma gêmea ao lado da adotada.
      v_dia := (coalesce((v_dados->>'dtstart')::timestamptz, (v_dados->>'next_run_at')::timestamptz)
                at time zone 'America/Sao_Paulo')::date;
      update public.transactions set
        recurring_id = (v_novo->'ids'->>0)::uuid, kind = v_dados->>'kind',
        amount_cents = (v_dados->>'amount_cents')::bigint, description = v_dados->>'description',
        merchant = v_dados->>'merchant', category = v_dados->>'category',
        account_id = (v_dados->>'account_id')::uuid, occurred_at = v_dia,
        auto_confirm = coalesce((v_dados->>'auto_confirm')::boolean, auto_confirm)
      where id = v_tx.id;
      return jsonb_build_object('ids', v_novo->'ids');

    elsif v_destino = 'financiamento' then
      if v_tx.kind <> 'expense' then
        raise exception 'Só gasto vira pagamento de financiamento.';
      end if;
      v_novo := private.criar_registro_da_hipotese('financiamento', v_dados);
      -- O gatilho do contrato só conta pagamento INSERIDO (e recusa trocar `debt_id` num update):
      -- a linha sai e volta, com o MESMO id, como 1º pagamento. Em aberto, ela não foi paga — o
      -- cronograma do financiamento é quem passa a mostrá-la.
      select array_agg(i.id) into v_importados from public.import_items i where i.transaction_id = v_tx.id;
      delete from public.transactions where id = v_tx.id;
      if v_tx.status = 'cleared' then
        insert into public.transactions
        select * from jsonb_populate_record(null::public.transactions,
          to_jsonb(v_tx) || jsonb_build_object('debt_id', v_novo->'ids'->>0, 'invoice_id', null,
            'debt_payment_no', null, 'debt_principal_cents', null, 'debt_interest_cents', null,
            'debt_balance_after_cents', null));
        -- A importação continua apontando para a linha (senão reimportar o extrato a duplicaria).
        update public.import_items set transaction_id = v_tx.id where id = any(v_importados);
      end if;
      return jsonb_build_object('ids', v_novo->'ids');
    end if;
    raise exception 'Destino desconhecido: %', v_destino;
  end if;

  -- TODAS: a origem some inteira (inclusive o pago), com a trava da fatura fechada
  if p_alcance = 'todas' then
    if exists (select 1 from public.transactions t
               where (t.recurring_id = v_serie or t.installment_plan_id = v_plano)
                 and private.parcela_travada('pending', t.invoice_id)) then
      raise exception 'Há lançamento numa fatura paga, adiada ou paga em parte. Desfaça o pagamento da fatura antes.';
    end if;
    if v_serie is not null then
      delete from public.transactions where recurring_id = v_serie;
      delete from public.recurring_transactions where id = v_serie;
    elsif v_plano is not null then
      delete from public.installment_plans where id = v_plano;  -- as parcelas vão no cascade
    elsif v_divida is not null then
      perform public.delete_debt(v_divida);
    end if;
  end if;

  -- DESTA EM DIANTE: o passado fica como histórico; o futuro da origem sai
  if p_alcance = 'desta_em_diante' then
    if v_serie is not null then
      perform public.update_recurring_series(v_serie, jsonb_build_object('end_date', v_ancora - 1), false);
      -- a atrasada também (a série termina antes dela); no cartão, pela data da compra
      delete from public.transactions
        where recurring_id = v_serie and status = 'pending'
          and case when invoice_id is null then coalesce(due_at, occurred_at) else occurred_at end >= v_ancora;
    elsif v_plano is not null then
      delete from public.transactions t
        where t.installment_plan_id = v_plano and not private.parcela_travada(t.status, t.invoice_id)
          and (v_tx.id is null or t.installment_no >= v_tx.installment_no);
      select count(*) into v_restam from public.transactions where installment_plan_id = v_plano;
      if v_restam >= 2 then
        update public.installment_plans p set
          installments = v_restam,
          total_cents = (select sum(amount_cents) from public.transactions where installment_plan_id = v_plano)
        where p.id = v_plano;
      else
        -- Uma parcela não é compra parcelada (o banco pede 2 ou mais): a que sobrou segue como
        -- lançamento, e ela se solta ANTES de o plano sair (o cascade a levaria junto).
        update public.transactions set installment_plan_id = null, installment_no = null
          where installment_plan_id = v_plano;
        delete from public.installment_plans where id = v_plano;
      end if;
    elsif v_divida is not null then
      update public.debts set archived = true where id = v_divida;
    end if;
  end if;

  v_novo := private.criar_registro_da_hipotese(v_destino, v_dados);
  return jsonb_build_object('ids', v_novo->'ids');
end;
$$;

revoke execute on function public.converter_registro(jsonb, text, jsonb) from public, anon;
grant execute on function public.converter_registro(jsonb, text, jsonb) to authenticated;
