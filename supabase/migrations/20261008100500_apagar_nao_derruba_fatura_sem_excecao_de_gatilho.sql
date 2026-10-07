-- Corrige 20261008100400: a isenção por `pg_trigger_depth() > 1` deixava passar justamente o apagar
-- por gatilho (recurring_drop_future ao apagar a série) e por cascade (juros do Pix). Agora só fica de
-- fora quem está saindo JUNTO com o dono: a fatura, a conta ou o espaço já não existem (FK cascade).
create or replace function private.apagar_nao_derruba_fatura()
returns trigger language plpgsql security definer set search_path = '' as $$
declare f public.card_invoices%rowtype;
begin
  if old.invoice_id is null or not private.conta_na_fatura(old.kind) then
    return old;
  end if;
  select * into f from public.card_invoices i where i.id = old.invoice_id;
  if f.id is null
     or not exists (select 1 from public.accounts a where a.id = f.account_id)
     or not exists (select 1 from public.workspaces w where w.id = f.workspace_id) then
    return old;
  end if;
  if f.status not in ('paid', 'rolled') and f.paid_cents > 0
     and private.invoice_open_cents(f.id) - old.amount_cents < 0 then
    raise exception using errcode = 'P0001',
      message = 'A fatura de ' || to_char(f.due_date, 'DD/MM') || ' já tem pagamento: sem este lançamento o total '
                || 'ficaria abaixo do que foi pago. Desfaça o pagamento da fatura antes.';
  end if;
  return old;
end $$;
revoke execute on function private.apagar_nao_derruba_fatura() from public, anon, authenticated;
