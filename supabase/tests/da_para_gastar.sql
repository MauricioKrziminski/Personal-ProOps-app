-- A identidade que impede a Hoje e o Financeiro de discordarem.
--
-- Os dois cards são os MESMOS três números lidos de dois jeitos:
--
--     caixa + a_receber_no_ciclo − comprometido_no_ciclo  ==  cycle_series.resultado
--
-- Se ela quebrar, um movimento de dinheiro está sendo contado duas vezes ou nenhuma — e o modo
-- de falha é MUDO nos dois lados: a Hoje mostraria um "livre" otimista e o Financeiro um
-- fechamento que não bate com ele. Foi literalmente a queixa que abriu este trabalho
-- (*"cada lugar fala uma coisa"*).
--
-- ⚠️ Ela fecha porque os eventos JÁ REALIZADOS de `[ini, hoje]` saem do somatório (`not
-- realizado`) e entram em `cash_total(hoje)`, e o ramo de atrasado grampeia em hoje tudo que
-- venceu antes. Era essa a contagem dupla: `cash_total(d)` conta `cleared` por `paid_at <= d` e
-- `cash_events` emite a MESMA linha no dia do `paid_at`.
--
-- ⚠️ Rodar como `authenticated`, nunca como dono do banco (a lição da `20260911220000`).
begin;

do $$
declare
  ws uuid;
  mes text;
  s record;
  resultado bigint;
  alvo uuid;
begin
  select id into ws from public.workspaces order by created_at limit 1;
  if ws is null then raise notice 'sem workspace — nada a testar'; return; end if;

  mes := public.cycle_now()->>'mes';

  select * into s from public.spendable();
  select c.resultado into resultado
  from public.cycle_series((mes || '-01')::date, (mes || '-01')::date) c;

  if s.caixa + s.a_receber_no_ciclo - s.comprometido_no_ciclo is distinct from resultado then
    raise exception 'spendable diz % e cycle_series diz %',
      s.caixa + s.a_receber_no_ciclo - s.comprometido_no_ciclo, resultado;
  end if;

  -- ⚠️ Anti-regressão da contagem dupla: dar baixa HOJE não pode mexer na identidade.
  -- Sem a coluna `realizado`, o valor pago entraria em `cash_total(hoje)` E continuaria em
  -- `comprometido`, então o número PIORARIA pelo valor que a pessoa acabou de pagar.
  select id into alvo from public.transactions
  where workspace_id = ws and status = 'pending' and kind = 'expense'
    and invoice_id is null and rollover_of_invoice_id is null
  order by occurred_at limit 1;

  if alvo is not null then
    update public.transactions
      set status = 'cleared', paid_at = current_date, occurred_at = current_date
      where id = alvo;

    select * into s from public.spendable();
    select c.resultado into resultado
    from public.cycle_series((mes || '-01')::date, (mes || '-01')::date) c;

    if s.caixa + s.a_receber_no_ciclo - s.comprometido_no_ciclo is distinct from resultado then
      raise exception 'depois da baixa de hoje: spendable % vs cycle_series % (contagem dupla)',
        s.caixa + s.a_receber_no_ciclo - s.comprometido_no_ciclo, resultado;
    end if;
    raise notice 'ok: a identidade sobrevive a uma baixa datada HOJE';
  else
    raise notice 'sem lançamento pendente para testar a baixa de hoje';
  end if;

  raise notice 'ok: spendable e cycle_series descrevem o mesmo ciclo pela mesma base';
end $$;

rollback;
