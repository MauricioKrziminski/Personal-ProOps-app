-- Onde o ciclo começa e termina é pergunta para o BANCO, nunca conta no cliente.
--
-- O app precisa de três coisas antes de desenhar o painel: quantos dias pedir de projeção, que
-- data escrever no rótulo, e qual "mês" está corrente. As três saem da mesma aritmética que
-- `private.cycle_bounds` já tem. Reescrevê-la em TypeScript seria a segunda cópia da regra —
-- e o modo de falha dela é mudo: o app pediria 20 dias enquanto o banco agrupa 31, e os dois
-- números da tela discordariam sem erro nenhum.
--
-- Uma chamada, cacheada pelo TanStack Query, e o painel já esperava a projeção de qualquer jeito.
create or replace function public.cycle_now()
returns jsonb
language sql stable set search_path = public as $$
  with ws as (select array(select private.my_workspace_ids()) as ids),
  cfg as (select private.cycle_close_day((select ids from ws)) as dia),
  atual as (
    select private.cycle_month_of((select dia from cfg), current_date) as mes
  ),
  b as (
    select * from private.cycle_bounds((select dia from cfg), (select mes from atual))
  )
  select jsonb_build_object(
    'closeDay', (select dia from cfg),
    'mes', to_char((select mes from atual), 'YYYY-MM'),
    'de', (select ini from b),
    'ate', (select fim from b),
    -- piso 1: no ÚLTIMO dia do ciclo a projeção ainda precisa de uma janela para existir, e
    -- pedir 0 dias devolveria a série vazia e um painel sem número.
    'diasAteOFim', greatest(1, (select fim from b) - current_date)
  );
$$;
