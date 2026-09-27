-- Fatura ADIADA, ou paga EM PARTE e já vencida: as compras e parcelas dela ficam pagas
-- (27/09/2026, pedido do dono do produto).
--
-- Até aqui só a quitação TOTAL (`pay_invoice`, `settle_invoice`) dava baixa nas linhas. Na fatura
-- do Nubank de setembro de produção — paga em parte (R$ 2.889,00) e adiada —, as 30 compras
-- importadas do extrato estavam pagas (a importação já as grava assim) e as 7 parcelas lançadas
-- no app seguiam "em aberto": a compra parcelada contava menos parcelas pagas do que as que o
-- banco cobrou, e a fatura listava "previsto" em compras de agosto.
--
-- A regra: uma fatura está LIQUIDADA quando foi paga (já era), adiada, ou paga em parte com o
-- vencimento passado — o que faltou virou saldo adiado ou atraso da FATURA, não da compra. As
-- linhas dela ficam `cleared` com `paid_at` = o vencimento. Nenhum número de caixa muda: a
-- projeção e o "livre" leem a fatura (`invoice_open_cents`, `status not in ('paid','rolled')`),
-- nunca o status da linha.
--
-- Quem aplica:
-- 1. o gatilho `linhas_da_fatura_liquidada`, em toda mudança de estado da fatura (adiar pelo app,
--    pelo agente ou pelo cron do rotativo; pagar em parte uma vencida; desfazer o adiamento;
--    apagar o pagamento). Deixando de estar liquidada (sem ser por quitação total), as linhas que
--    ELA baixou — `paid_at` = vencimento, fora da importação — voltam a `pending`.
-- 2. `_liquidar_faturas_vencidas()`, na rodada de hora em hora do agendador: a fatura paga em
--    parte vence com o passar do dia, sem update nenhum para disparar o gatilho.
-- 3. esta migration, uma vez, para o que já está assim.
-- Teste: `supabase/tests/fatura_liquidada_baixa_as_linhas.sql`.

create or replace function private.fatura_liquidada(p_status text, p_paid_cents bigint, p_due_date date)
returns boolean
language sql
stable
set search_path = public
set timezone to 'America/Sao_Paulo'
as $$
  select p_status = 'rolled'
      or (p_status in ('open', 'closed') and coalesce(p_paid_cents, 0) > 0 and p_due_date < current_date)
$$;
grant execute on function private.fatura_liquidada(text, bigint, date) to authenticated, service_role;

create or replace function public.tg_card_invoices_liquidada()
returns trigger
language plpgsql
security invoker
set search_path = public
set timezone to 'America/Sao_Paulo'
as $$
begin
  if private.fatura_liquidada(new.status, new.paid_cents, new.due_date) then
    update public.transactions t
       set status = 'cleared', paid_at = new.due_date
     where t.invoice_id = new.id and t.workspace_id = new.workspace_id
       and t.kind = 'expense' and t.status = 'pending';
  elsif new.status <> 'paid'
        and private.fatura_liquidada(old.status, old.paid_cents, old.due_date) then
    -- Desfez o adiamento ou apagou o pagamento: volta o que ESTA regra baixou. A importação grava
    -- as compras já pagas, com o dia da compra — não são dela.
    update public.transactions t
       set status = 'pending', paid_at = null
     where t.invoice_id = new.id and t.workspace_id = new.workspace_id
       and t.kind = 'expense' and t.status = 'cleared'
       and t.paid_at = old.due_date and t.source <> 'import';
  end if;
  return null;
end;
$$;

revoke execute on function public.tg_card_invoices_liquidada() from public, anon, authenticated;

drop trigger if exists linhas_da_fatura_liquidada on public.card_invoices;
create trigger linhas_da_fatura_liquidada
  after update of status, paid_cents, due_date on public.card_invoices
  for each row
  when (old.status is distinct from new.status
        or old.paid_cents is distinct from new.paid_cents
        or old.due_date is distinct from new.due_date)
  execute function public.tg_card_invoices_liquidada();

-- A rodada de hora em hora: a fatura paga em parte que venceu hoje não teve update nenhum.
create or replace function public._liquidar_faturas_vencidas()
returns integer
language plpgsql
security definer
set search_path = public
set timezone to 'America/Sao_Paulo'
as $$
declare
  n integer;
begin
  update public.transactions t
     set status = 'cleared', paid_at = ci.due_date
    from public.card_invoices ci
   where t.invoice_id = ci.id and t.workspace_id = ci.workspace_id
     and t.kind = 'expense' and t.status = 'pending'
     and private.fatura_liquidada(ci.status, ci.paid_cents, ci.due_date);
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public._liquidar_faturas_vencidas() from public, anon, authenticated;

-- 3. o que já está assim (a fatura do Nubank de setembro de produção, entre outras)
select public._liquidar_faturas_vencidas();
