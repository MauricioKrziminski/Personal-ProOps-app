-- As hipóteses do "E se…?" dentro do detalhe do ciclo (28/09/2026, pedido do dono do produto: "se
-- eu tiver feito algumas hipóteses e clicar para ver o detalhe de um ciclo ou mês, ele tem que
-- mostrar com aqueles valores da projeção de hipótese (sem salvar)… como se fosse real").
--
-- Uma LEITURA sobre o motor que já existe (`private.draft_ocorrencias`) — nenhuma aritmética de
-- hipótese nova. Chama o motor uma vez por hipótese (para a tela saber de qual é cada linha) e
-- devolve, para a janela do ciclo:
--   * `linhas`: cada ocorrência que cai entre `p_from` e `p_to` — índice da hipótese, dia, tipo e
--     valor (negativo no `cancel`, a parcela adiantada que deixa de sair);
--   * `antes`: o efeito líquido das ocorrências ANTERIORES ao ciclo, que entra no "Comecei com" —
--     uma hipótese de outubro muda o saldo com que novembro começa.
--
-- JSON e sem tabela: o rascunho vive só na memória do app, e nada aqui lê dado de ninguém.
create or replace function public.draft_lines(p_drafts jsonb, p_from date, p_to date)
returns jsonb
language sql
stable
security invoker
set search_path = public
set timezone to 'America/Sao_Paulo'
as $$
  with d as (
    select (t.ord - 1)::int as i, t.x
    from jsonb_array_elements(coalesce(p_drafts, '[]'::jsonb)) with ordinality as t(x, ord)
  ),
  o as (
    select d.i, oc.kind, oc.vence, oc.cents
    from d cross join lateral private.draft_ocorrencias(jsonb_build_array(d.x), p_to) oc
  )
  select jsonb_build_object(
    'antes', coalesce((select sum(case when o.kind = 'income' then o.cents else -o.cents end)
                       from o where o.vence < p_from), 0),
    'linhas', coalesce((select jsonb_agg(jsonb_build_object('i', o.i, 'day', o.vence, 'kind', o.kind, 'cents', o.cents)
                                         order by o.vence, o.i)
                        from o where o.vence between p_from and p_to), '[]'::jsonb)
  );
$$;
revoke execute on function public.draft_lines(jsonb, date, date) from public, anon;
grant execute on function public.draft_lines(jsonb, date, date) to authenticated;
