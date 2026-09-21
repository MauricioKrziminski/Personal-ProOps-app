-- A `private.valor_da_parcela` se anunciava como "régua única da CRIAÇÃO, da edição e da
-- conversão", e a criação nunca a usou: `create_installment_plan_with_history` continua com a
-- expressão à mão (`20260915190000:89-93`), e ela é o caminho mais usado — a `create_installment_plan`
-- de 7 argumentos é casca sobre ele.
--
-- ⚠️ São DUAS cópias, não zero, e é o comentário que faz o próximo leitor acreditar no contrário —
-- que é exatamente como a segunda cópia divergiu nas outras vezes que este repositório registrou.
-- Unificar de verdade é migration própria, com `reparcelar_a_compra.sql` de não-regressão (ele
-- cria por essa função em 6 pontos). Aqui só a frase deixa de mentir.
--
-- ⚠️ Esta migration existe porque `comment on function` é OBJETO DO BANCO. Corrigi-lo editando a
-- `20260920120000`, que já estava aplicada, faria o arquivo e o banco discordarem — é a regra de
-- `supabase.md`. Comentário `--` pode ser corrigido no lugar; `comment on` não.

comment on function private.valor_da_parcela(bigint, int, int) is
  'O valor da i-ésima parcela: divisão inteira, com o resto na última. Régua da edição e da conversão. A criação ainda tem a cópia dela em create_installment_plan_with_history (20260915190000:89) — unificar é migration própria.';
