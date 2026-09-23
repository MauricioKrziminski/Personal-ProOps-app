-- `20260923140000`: o mês financeiro fecha em qualquer dia de 1 a 30 (o 31 é o `null`, "último
-- dia do mês"), e em mês mais curto 29 e 30 fecham no último dia.
--
--   docker exec -i supabase_db_app-proops psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/mes_fecha_ate_o_31.sql
--
-- As asserções 1–3 são das funções puras (a primeira linha da 1 é o caso do dono do produto,
-- fechamento no dia 10, que não pode mudar); a 4 prende o `check`.

\set ON_ERROR_STOP on
begin;

do $$
declare
  b record;
  caso record;
begin
  -- 1. As bordas, com o esperado escrito à mão (nunca recalculado pela mesma regra).
  for caso in
    select * from (values
      -- fecha, rótulo,            início esperado,   fim esperado
      (10, date '2026-09-01', date '2026-08-11', date '2026-09-10'),  -- o de sempre
      (28, date '2026-03-01', date '2026-03-01', date '2026-03-28'),  -- 28/02 + 1
      (30, date '2027-02-01', date '2027-01-31', date '2027-02-28'),  -- fevereiro comum
      (30, date '2027-03-01', date '2027-03-01', date '2027-03-30'),  -- depois de fevereiro
      (30, date '2027-04-01', date '2027-03-31', date '2027-04-30'),  -- mês de 30
      (30, date '2027-05-01', date '2027-05-01', date '2027-05-30'),  -- depois do mês de 30
      (29, date '2028-02-01', date '2028-01-30', date '2028-02-29'),  -- bissexto
      (29, date '2027-02-01', date '2027-01-30', date '2027-02-28'),  -- não bissexto
      (29, date '2027-03-01', date '2027-03-01', date '2027-03-29')
    ) as t(fecha, rotulo, ini, fim)
  loop
    select * into b from private.cycle_bounds(caso.fecha, caso.rotulo);
    if b.ini <> caso.ini or b.fim <> caso.fim then
      raise exception 'fecha % em %: deu % a %, esperado % a %',
        caso.fecha, caso.rotulo, b.ini, b.fim, caso.ini, caso.fim;
    end if;
  end loop;

  -- 2. null segue sendo o mês civil.
  select * into b from private.cycle_bounds(null, date '2027-02-01');
  if b.ini <> date '2027-02-01' or b.fim <> date '2027-02-28' then
    raise exception 'null em fevereiro deu % a %', b.ini, b.fim;
  end if;

  -- 3. Todo dia cai em EXATAMENTE um ciclo, e é o ciclo que o `cycle_month_of` nomeia.
  --    Dois anos inteiros, para cada fechamento de 1 a 30: sem buraco e sem sobreposição.
  for caso in
    select f.fecha, d::date as dia
    from generate_series(1, 30) as f(fecha),
         generate_series(date '2027-01-01', date '2028-12-31', interval '1 day') as d
  loop
    select * into b from private.cycle_bounds(caso.fecha, private.cycle_month_of(caso.fecha, caso.dia));
    if caso.dia < b.ini or caso.dia > b.fim then
      raise exception 'fecha %: o dia % caiu fora do próprio ciclo (% a %)',
        caso.fecha, caso.dia, b.ini, b.fim;
    end if;
  end loop;

  -- 3b. E os ciclos se ENCOSTAM: o fim de um mês + 1 é o início do seguinte, para todo
  --     fechamento e todo mês de dois anos (sem sobreposição, que a 3 sozinha não prova).
  for caso in
    select f.fecha, m::date as mes
    from generate_series(1, 30) as f(fecha),
         generate_series(date '2027-01-01', date '2028-12-01', interval '1 month') as m
  loop
    if (select fim from private.cycle_bounds(caso.fecha, caso.mes)) + 1
       <> (select ini from private.cycle_bounds(caso.fecha, (caso.mes + interval '1 month')::date)) then
      raise exception 'fecha %: o ciclo de % não encosta no seguinte', caso.fecha, caso.mes;
    end if;
  end loop;
end $$;

-- 4. O `check`: 30 entra, 31 não (o 31 é o null).
do $$
declare ws uuid;
begin
  select id into ws from public.workspaces order by created_at limit 1;
  if ws is null then raise notice 'sem workspace — check não testado'; return; end if;
  update public.workspaces set cycle_close_day = 30 where id = ws;
  begin
    update public.workspaces set cycle_close_day = 31 where id = ws;
    raise exception 'o check aceitou 31';
  exception when check_violation then null;
  end;
end $$;

rollback;
