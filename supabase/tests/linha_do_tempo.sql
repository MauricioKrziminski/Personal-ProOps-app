-- A invariante da linha do tempo: num ciclo FECHADO, a soma dos eventos de caixa tem que
-- reproduzir `cash_total` no centavo. Se ela quebrar, um movimento de dinheiro está sendo contado
-- duas vezes ou nenhuma — e nenhum dos dois dá erro na tela, só um número que não fecha.
--
-- ⚠️ Rode como `authenticated`, não como dono do banco: `cash_events` e `cycle_series_for` são
-- `security invoker`, e privilégio testado como owner é privilégio não testado (a lição da
-- `20260911220000`, que passou por psql e derrubou duas telas no app).
begin;

do $$
declare
  ws uuid;
  r record;
  quebrou int := 0;
begin
  select id into ws from public.workspaces order by created_at limit 1;
  if ws is null then raise notice 'sem workspace — nada a testar'; return; end if;

  for r in
    select * from private.cycle_series_for(array[ws], current_date - interval '6 months',
                                           current_date + interval '3 months', 'cycle')
  loop
    if r.estado = 'fechado' and r.confere is distinct from true then
      quebrou := quebrou + 1;
      raise warning 'ciclo % (% a %): eventos somam % e o caixa real é %',
        r.mes, r.ini, r.fim, r.resultado, r.caixa_no_fim;
    end if;
    -- A corrente: ciclo previsto parte do resultado do anterior, nunca do caixa de hoje.
    if r.estado = 'previsto' and r.comecei_com is null then
      raise exception 'ciclo previsto % sem ponto de partida', r.mes;
    end if;
  end loop;

  if quebrou > 0 then
    raise exception '% ciclo(s) fechado(s) não reproduzem o caixa real', quebrou;
  end if;
  raise notice 'ok: todo ciclo fechado reproduz o caixa real';
end $$;

rollback;
