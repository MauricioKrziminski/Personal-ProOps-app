-- O buraco de 20260909090000: apagar uma linha de fatura paga EM PARTE deixava "o que falta"
-- negativo e pay_invoice passava a recusar a quitação. Vale para todo caminho de apagar.
-- `pg_trigger_depth() > 1` = cascade (apagar a conta ou o espaço) ou gatilho (recurring_drop_future,
-- que só leva pendente futura): esses ficam de fora.
create or replace function private.apagar_nao_derruba_fatura()
returns trigger language plpgsql security definer set search_path = '' as $$
declare f public.card_invoices%rowtype;
begin
  if pg_trigger_depth() > 1 or old.invoice_id is null or not private.conta_na_fatura(old.kind) then
    return old;
  end if;
  select * into f from public.card_invoices i where i.id = old.invoice_id;
  if f.id is not null and f.status not in ('paid', 'rolled') and f.paid_cents > 0
     and private.invoice_open_cents(f.id) - old.amount_cents < 0 then
    raise exception using errcode = 'P0001',
      message = 'A fatura de ' || to_char(f.due_date, 'DD/MM') || ' já tem pagamento: sem esta compra o total '
                || 'ficaria abaixo do que foi pago. Desfaça o pagamento da fatura antes.';
  end if;
  return old;
end $$;
revoke execute on function private.apagar_nao_derruba_fatura() from public, anon, authenticated;
drop trigger if exists apagar_nao_derruba_fatura on public.transactions;
create trigger apagar_nao_derruba_fatura before delete on public.transactions
  for each row execute function private.apagar_nao_derruba_fatura();
