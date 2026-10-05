-- F15: "por que o gasto mudou" — contribuição de cada categoria/detalhe/pagamento/tipo à diferença
-- entre dois períodos JÁ RESOLVIDOS pela tela. Lente = a de `transactions_summary` (por occurred_at,
-- previsto incluído, sem transferência) mais duas exclusões que a lista de Lançamentos também aplica
-- no link: sem pagamento de fatura e sem o principal adiado (`rollover_of_invoice_id`, já contado
-- no mês da compra). Item é lido como é HOJE: categoria nova vale nos dois períodos.
create or replace function public.spending_change(p_cur_from date, p_cur_to date, p_prev_from date, p_prev_to date,
  p_dimension text)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'Autenticação obrigatória' using errcode = '42501'; end if;
  if p_cur_from is null or p_cur_to is null or p_prev_from is null or p_prev_to is null then
    raise exception 'Informe o início e o fim do período.' using errcode = 'P0001';
  end if;
  if p_cur_to < p_cur_from or p_prev_to < p_prev_from then
    raise exception 'Período inválido: o início não pode ser depois do fim.' using errcode = 'P0001';
  end if;
  if p_cur_to - p_cur_from > 400 or p_prev_to - p_prev_from > 400 then
    raise exception 'Período longo demais: use no máximo 400 dias.' using errcode = 'P0001';
  end if;
  if p_dimension is null or p_dimension not in ('category','subcategory','payment_method','pattern','necessity') then
    raise exception 'Dimensão inválida.' using errcode = 'P0001';
  end if;
  with src as (
    select case p_dimension when 'category' then nullif(btrim(t.category), '')
             when 'subcategory' then t.subcategory_id::text
             when 'payment_method' then t.payment_method
             when 'pattern' then t.expense_pattern
             else t.expense_necessity end as k,
           case p_dimension when 'category' then nullif(btrim(t.category), '')
             when 'subcategory' then s.parent_category || ' · ' || s.name
             when 'payment_method' then case t.payment_method when 'pix' then 'Pix' when 'credit' then 'Crédito'
               when 'debit' then 'Débito' when 'cash' then 'Dinheiro' when 'bank_transfer' then 'Transferência'
               when 'boleto' then 'Boleto' else t.payment_method end
             when 'pattern' then case t.expense_pattern when 'fixed' then 'Fixo' when 'variable' then 'Variável' end
             else case t.expense_necessity when 'essential' then 'Essencial' when 'discretionary' then 'Não essencial' end
           end as l,
           sum(t.amount_cents) filter (where t.occurred_at between p_cur_from and p_cur_to)::bigint as cur,
           sum(t.amount_cents) filter (where t.occurred_at between p_prev_from and p_prev_to)::bigint as prev
    from public.transactions t
    left join public.subcategories s on s.id = t.subcategory_id
    where t.workspace_id in (select private.my_workspace_ids())
      and t.kind = 'expense' and t.pays_invoice_id is null and t.rollover_of_invoice_id is null
      and (t.occurred_at between p_cur_from and p_cur_to or t.occurred_at between p_prev_from and p_prev_to)
    group by 1, 2
  ), rws as (
    select k, coalesce(l, case p_dimension when 'category' then 'Sem categoria'
             when 'subcategory' then 'Sem detalhe' else 'Não informado' end) as l,
           coalesce(cur, 0) as cur, coalesce(prev, 0) as prev from src
  ), tot as (select coalesce(sum(cur), 0) as cur, coalesce(sum(prev), 0) as prev from rws)
  select jsonb_build_object(
    'current_cents', tot.cur::text, 'previous_cents', tot.prev::text, 'delta_cents', (tot.cur - tot.prev)::text,
    'percent_bp', case when tot.prev > 0 then round((tot.cur - tot.prev) * 10000.0 / tot.prev)::bigint end,
    'rows', coalesce((select jsonb_agg(jsonb_build_object('key', r.k, 'label', r.l,
        'current_cents', r.cur::text, 'previous_cents', r.prev::text, 'delta_cents', (r.cur - r.prev)::text)
        order by abs(r.cur - r.prev) desc, r.l, r.k) from rws r), '[]'::jsonb)
  ) into result from tot;
  return result;
end $$;
revoke execute on function public.spending_change(date,date,date,date,text) from public, anon;
grant execute on function public.spending_change(date,date,date,date,text) to authenticated;
