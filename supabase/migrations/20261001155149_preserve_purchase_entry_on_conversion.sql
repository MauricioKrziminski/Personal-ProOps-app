-- A entrada já paga é histórico, nunca uma prestação do contrato.
-- Desfazer o plano vazio conserva esse fato como avulso; 'todas'/exclusão explícita
-- apagam entrada e contrato deliberadamente. Não há GUC, bypass de RLS ou reinserção.
-- O núcleo da conversão mantém alcances/destinos e passa a travar compra antes de parcela.

create or replace function private.guard_purchase_down_payment()
returns trigger language plpgsql security definer set search_path = ''
set timezone to 'America/Sao_Paulo' as $$
declare parent_workspace uuid; account_workspace uuid; account_type text; account_archived boolean;
  valid_card_invoice boolean;
begin
  if tg_op = 'UPDATE' and
    (new.down_payment_debt_id is distinct from old.down_payment_debt_id
     or new.down_payment_plan_id is distinct from old.down_payment_plan_id) then
    -- Só o DELETE de um plano já sem parcelas pode soltar sua entrada histórica.
    -- UPDATE direto/reassociação continuam recusados, sem chave/GUC que o cliente possa forjar.
    if pg_trigger_depth() > 1
      and old.down_payment_plan_id is not null and new.down_payment_plan_id is null
      and exists(select 1 from public.installment_plans p
        where p.id=old.down_payment_plan_id and p.workspace_id=old.workspace_id)
      and not exists(select 1 from public.transactions t where t.installment_plan_id=old.down_payment_plan_id)
      and new.edit_revision = old.edit_revision + 1
      and (to_jsonb(new) - 'down_payment_plan_id' - 'edit_revision') =
          (to_jsonb(old) - 'down_payment_plan_id' - 'edit_revision') then
      return new;
    end if;
    raise exception 'O vínculo da entrada não pode ser alterado: apague e registre uma nova entrada';
  end if;
  if new.down_payment_debt_id is null and new.down_payment_plan_id is null then return new; end if;
  select a.workspace_id,a.type,a.archived into account_workspace,account_type,account_archived
    from public.accounts a where a.id=new.account_id for share;
  -- Arquivar uma conta conserva seu historico e o fluxo das faturas existentes.
  -- Nova entrada ou troca de conta/espaco continua exigindo conta ativa.
  if account_archived and (tg_op <> 'UPDATE' or new.account_id is distinct from old.account_id
    or new.workspace_id is distinct from old.workspace_id) then
    raise exception 'Escolha uma conta ativa para registrar ou mover a entrada';
  end if;
  valid_card_invoice := account_type='credit_card' and new.invoice_id is not null and exists(
    select 1 from public.card_invoices i where i.id=new.invoice_id and i.account_id=new.account_id
      and i.workspace_id=new.workspace_id);
  if (new.down_payment_debt_id is not null and new.down_payment_plan_id is not null)
    or new.debt_id is not null or new.installment_plan_id is not null or new.recurring_id is not null
    or new.installment_no is not null or new.debt_payment_no is not null
    or new.debt_principal_cents is not null or new.debt_interest_cents is not null
    or new.debt_balance_after_cents is not null or new.counterparty_account_id is not null
    or new.kind is distinct from 'expense'
    -- A compra no cartao ja aconteceu; pagar/desfazer a fatura governa o estado de caixa dela.
    or (new.status is distinct from 'cleared' and not(coalesce(valid_card_invoice,false) and new.status='pending'))
    or (account_type='credit_card' and not coalesce(valid_card_invoice,false))
    or (account_type<>'credit_card' and new.invoice_id is not null)
    or new.amount_cents is null or new.amount_cents <= 0
    or new.occurred_at is null or new.occurred_at > current_date then
    raise exception 'Entrada exige despesa positiva já realizada, sem vínculo de parcela, dívida ou recorrente';
  end if;
  if new.down_payment_debt_id is not null then
    select d.workspace_id into parent_workspace from public.debts d where d.id=new.down_payment_debt_id for share;
  else
    select p.workspace_id into parent_workspace from public.installment_plans p where p.id=new.down_payment_plan_id for share;
  end if;
  if parent_workspace is distinct from new.workspace_id or account_workspace is distinct from new.workspace_id
     or parent_workspace is null or account_workspace is null then
    raise exception 'Contrato e conta da entrada devem pertencer ao mesmo workspace ativo';
  end if;
  return new;
end $$;
revoke execute on function private.guard_purchase_down_payment() from public, anon, authenticated;

-- Um plano desfeito (0/1 prestações históricas, ou redução a 1x) já não tem
-- parcelas vinculadas. Sua entrada permanece avulsa, com MESMO id/fatura/data/conta.
-- A regra também conserva o fato pago ao remover um plano esvaziado manualmente.
-- Excluir a compra inteira deliberadamente usa delete_installment_purchase abaixo.
create or replace function private.preserve_down_payment_before_plan_delete()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if not exists(select 1 from public.transactions t where t.installment_plan_id=old.id) then
    update public.transactions set down_payment_plan_id = null
      where down_payment_plan_id = old.id;
  end if;
  return old;
end $$;
revoke execute on function private.preserve_down_payment_before_plan_delete() from public, anon, authenticated;
drop trigger if exists preserve_down_payment_before_plan_delete on public.installment_plans;
create trigger preserve_down_payment_before_plan_delete before delete on public.installment_plans
  for each row execute function private.preserve_down_payment_before_plan_delete();

-- Exclusão explícita da compra: entrada + parcelas, inclusive se o plano já estiver vazio.
-- Sem mudança de role/RLS; a trava do pai precede filhos como na criação/anexação.
create or replace function public.delete_installment_purchase(p_plan_id uuid)
returns int language plpgsql security invoker set search_path = public as $$
declare removed int;
begin
  perform 1 from public.installment_plans p where p.id=p_plan_id for update;
  if not found then return 0; end if;
  if exists(select 1 from public.transactions t
    where (t.installment_plan_id=p_plan_id or t.down_payment_plan_id=p_plan_id)
      and private.parcela_travada('pending',t.invoice_id)) then
    raise exception 'Há lançamento numa fatura paga, adiada ou paga em parte. Desfaça o pagamento da fatura antes.';
  end if;
  delete from public.transactions where down_payment_plan_id=p_plan_id;
  delete from public.installment_plans where id=p_plan_id;
  get diagnostics removed = row_count;
  return removed;
end $$;
revoke execute on function public.delete_installment_purchase(uuid) from public, anon;
grant execute on function public.delete_installment_purchase(uuid) to authenticated;

create or replace function private.converter_registro_sem_entrada(p_origem jsonb, p_alcance text, p_destino jsonb)
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
  v_plano_lido uuid;
  v_divida uuid;
  v_ancora date;
  v_novo jsonb;
  v_linha jsonb;
  v_resto jsonb;
  v_ids jsonb;
  v_dia date;
  v_importados uuid[];
  v_restam int;
  v_ws uuid;
  v_dados jsonb := p_destino->'dados';
  v_destino text := p_destino->>'tipo';
begin
  if p_alcance is null or p_alcance not in ('so_esta', 'desta_em_diante', 'todas', 'manter', 'converter') then
    raise exception 'Alcance desconhecido: %', p_alcance;
  end if;

  if v_tipo = 'transacao' then
    -- Compra antes das parcelas, também ao abrir a conversão pelo lançamento.
    select installment_plan_id into v_plano_lido from public.transactions where id=v_id;
    if v_plano_lido is not null then
      perform 1 from public.installment_plans where id=v_plano_lido for update;
    end if;
    select * into v_tx from public.transactions where id = v_id for update;
    if v_tx.id is null then raise exception 'Esse lançamento não existe mais.'; end if;
    if v_tx.installment_plan_id is distinct from v_plano_lido then
      raise exception 'A compra mudou enquanto a conversão era preparada. Feche e abra novamente.';
    end if;
    v_ws := v_tx.workspace_id;
    v_serie := v_tx.recurring_id;
    v_plano := v_tx.installment_plan_id;
    v_divida := v_tx.debt_id;
    -- Fora do cartão a data que conta é o vencimento; no cartão `due_at` é o da FATURA, e a
    -- compra já aconteceu na data dela (a régua de `update_recurring_series`).
    v_ancora := case when v_tx.invoice_id is null then coalesce(v_tx.due_at, v_tx.occurred_at) else v_tx.occurred_at end;
  elsif v_tipo = 'serie' then
    select id, (next_run_at at time zone 'America/Sao_Paulo')::date, workspace_id into v_serie, v_ancora, v_ws
      from public.recurring_transactions where id = v_id for update;
    if v_serie is null then raise exception 'Essa recorrência não existe mais.'; end if;
  elsif v_tipo = 'plano' then
    select id, workspace_id into v_plano, v_ws from public.installment_plans where id = v_id for update;
    if v_plano is null then raise exception 'Essa compra não existe mais.'; end if;
  elsif v_tipo = 'divida' then
    select id, workspace_id into v_divida, v_ws from public.debts where id = v_id for update;
    if v_divida is null then raise exception 'Essa dívida não existe mais.'; end if;
  else
    raise exception 'Origem desconhecida: %', v_tipo;
  end if;

  -- O destino nasce no espaço PADRÃO de quem chama (`criar_registro_da_hipotese` usa o default da
  -- coluna). Com a origem em outro espaço, a conversão ligaria uma linha do espaço A a uma série do
  -- B, ou levaria a continuação de uma série compartilhada para o espaço pessoal — em silêncio.
  -- Até a criação receber o espaço, recusa em todo alcance, "manter" inclusive.
  if v_ws is distinct from public.my_default_workspace() then
    raise exception 'Esse registro é de outro espaço. Mude o tipo dele a partir do espaço dele.';
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
        -- Fora do cartão, a pendência vence na ocorrência adotada. No cartão,
        -- o trigger da conta/data substitui pelo vencimento da fatura.
        due_at = case when v_tx.status = 'pending' then v_dia else due_at end,
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
      perform public.delete_installment_purchase(v_plano);  -- todas inclui a entrada, mesmo com plano vazio
    elsif v_divida is not null then
      perform public.delete_debt(v_divida);
    end if;
  end if;

  -- DESTA EM DIANTE: o passado fica como histórico; o futuro da origem sai
  if p_alcance = 'desta_em_diante' then
    if v_serie is not null then
      -- A conversão corta pelo vencimento fora do cartão, não pela data
      -- contábil da linha. O helper de edição apagava primeiro por occurred_at
      -- e levava pendências que ainda pertencem ao histórico anterior ao corte.
      update public.recurring_transactions set end_date = v_ancora - 1 where id = v_serie;
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

revoke execute on function private.converter_registro_sem_entrada(jsonb, text, jsonb) from public, anon;
grant execute on function private.converter_registro_sem_entrada(jsonb, text, jsonb) to authenticated;
