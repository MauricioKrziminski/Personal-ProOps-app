-- `cycle_now` responde pelo ciclo CORRENTE; as telas que navegam entre meses precisam das
-- bordas de um mês qualquer.
--
-- Sem isto o Financeiro ficava dizendo duas coisas ao mesmo tempo: o painel somava a janela do
-- ciclo (11/08–10/09) e a linha "entrou · saiu" logo abaixo somava o mês civil (01/09–30/09).
-- Dois números que não fecham, colados, sem nada na tela explicando — que é a forma mais cara
-- de errar, porque parece bug de conta.
--
-- Uma chamada por mês visitado, cacheada. A alternativa era reescrever `private.cycle_bounds`
-- em TypeScript, que é a segunda cópia da regra.
create or replace function public.cycle_range(p_month date)
returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object('de', b.ini, 'ate', b.fim)
  from private.cycle_bounds(
         private.cycle_close_day(array(select private.my_workspace_ids())),
         date_trunc('month', p_month)::date) b;
$$;
