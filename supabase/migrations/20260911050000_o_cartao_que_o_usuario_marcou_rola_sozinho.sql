-- O adiamento automático, só para os cartões em que o usuário ligou.
--
-- `rotativo_auto` é escolha no cadastro do cartão e nasce DESLIGADO. Ligado para todos, um
-- cartão que a pessoa sempre paga em dia nunca mais apareceria como atrasado — o aviso que
-- mais importa sumiria justamente de quem não precisa da feature.
--
-- ⚠️ **Roda um dia DEPOIS do vencimento, não no dia.** Pagar no próprio dia do vencimento é o
-- normal, e adiar a fatura às 00h05 do dia 10 seria o app decidindo por quem ainda vai pagar à
-- tarde. `due_date < today` (não `<=`) é a diferença inteira.
--
-- Idempotente pelo status: `roll_invoice` marca a origem como `rolled`, e a varredura seguinte
-- não a enxerga mais. Cron rodando duas vezes não duplica nada.
create or replace function public._roll_overdue_invoices()
returns int
language plpgsql security definer set search_path = public
set timezone to 'America/Sao_Paulo' as $$
declare
  r record;
  n int := 0;
begin
  for r in
    select ci.id
    from public.card_invoices ci
    join public.accounts a on a.id = ci.account_id
    where a.rotativo_auto
      and ci.status in ('open','closed')
      and ci.due_date < current_date
      and private.invoice_open_cents(ci.id) > 0
    order by ci.due_date
  loop
    begin
      perform public.roll_invoice(r.id);
      n := n + 1;
    exception when others then
      -- Uma fatura que recusa não pode parar as outras: o cron atende o workspace inteiro.
      raise warning 'roll_invoice(%) falhou: %', r.id, sqlerrm;
    end;
  end loop;
  return n;
end;
$$;

revoke execute on function public._roll_overdue_invoices() from public, anon, authenticated;
