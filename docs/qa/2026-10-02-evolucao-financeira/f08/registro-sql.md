# F08 — registro de verificação SQL

Em 03/10/2026, as três migrations abaixo foram aplicadas somente em **staging `utkqoiigimqzeenxkxdl`**, na branch `gabriel/financas-22-melhorias`. O guard `scripts/supabase-target.sh < /dev/null` confirmou o CLI e o app apontando para staging; os runners também verificaram o destino da conexão. Produção não foi acessada. Este registro cobre SQL e não declara F08 aceito nem validação nativa.

## Aplicação

| Migration | Efeito | Evidência CLI |
| --- | --- | --- |
| [20261003164859_goal_plans.sql](../../../../supabase/migrations/20261003164859_goal_plans.sql) | Intenções por workspace, CAS, recibos selados e resolução terminal | [dry-run](evidence/sql/push-dry-run.log), [push](evidence/sql/push.log) |
| [20261003164902_goal_planning_projection.sql](../../../../supabase/migrations/20261003164902_goal_planning_projection.sql) | Projeção com fontes de caixa existentes, calendário civil e períodos civil/ciclo | [dry-run](evidence/sql/push-dry-run.log), [push](evidence/sql/push.log) |
| [20261003172501_goal_planning_workspace_context.sql](../../../../supabase/migrations/20261003172501_goal_planning_workspace_context.sql) | Nome e dia de fechamento do workspace efetivamente consultado | [dry-run](evidence/sql/context-dry-run.log), [push](evidence/sql/context-push.log) |

Os dry-runs listam exclusivamente as migrations correspondentes e os pushes registram sua aplicação. A execução de concorrência também verificou três versões F08 aplicadas ([resultados](evidence/sql/races-results.jsonl), evento `connections_verified`).

## RED, controle negativo e fixtures com rollback

O **RED comportamental** instalou, dentro de uma transação descartada, um protótipo que retornava sucesso ao salvar sem persistir o plano. O teste falhou com `P0004: Committed plan absent`; houve chamada válida ao comando, portanto a falha não foi ausência de API ([log RED](evidence/sql/sql-red.log), [runner](evidence/sql/sql_runner.py), modo `red`).

Separadamente, o **controle negativo da projeção** substituiu temporariamente a contribuição planejada por zero. A asserção `Two intentions must sum` falhou com `P0004`, demonstrando sensibilidade ao resultado financeiro da simulação. Essa alteração foi descartada por rollback e não foi aplicada como migration ([log negativo](evidence/sql/projection-negative.log), runner, modo `projection-negative`).

Os resultados GREEN anteriores à aplicação estão em [comando](evidence/sql/sql-green.log) e [projeção](evidence/sql/projection-green.log). A terceira migration foi testada em transação descartada com as duas fixtures ([context-green](evidence/sql/context-green.log)). Depois da aplicação das três migrations, **ambas as fixtures passaram novamente**, com `committed: false` ([sql-applied](evidence/sql/sql-applied.log)).

| Fixture preservada | Comportamentos verificados |
| --- | --- |
| [goal-plans.test.sql](evidence/sql/goal-plans.test.sql) | Persistência/revisão, CAS, replay, recibo genérico não substitui recibo selado, cancelamento terminal, fingerprint financeiro, isolamento/FKs e ausência de movimentação financeira pelo plano |
| [goal-planning-projection.test.sql](evidence/sql/goal-planning-projection.test.sql) | Soma de duas metas e últimas parcelas limitadas ao restante; caixa igual às fontes existentes; isolamento de workspace; prazos passado/hoje/ausente; clamp de dia 31/ano bissexto; civil/ciclo; horizonte; dados incompletos/exclusão; nova meta/concluída/arquivada; pressão/ausência de renda; backing compartilhado e ativo fora do caixa; reserva não confirmada; rejeição de soma insegura e privilégios anon |

As fixtures criam dados próprios, executam as chamadas com role `authenticated` e retornam ao estado anterior com rollback. O runner verifica também a presença/ausência original de `goal_plans` depois do rollback. As cópias preservadas correspondem ao estado dos testes capturado para este registro; hashes estão no [manifesto](evidence/sql/artifact-manifest.json).

## Concorrência real em duas conexões

[Resultados JSONL](evidence/sql/races-results.jsonl), [resumo original](evidence/sql/races-summary.md), [manifesto das fixtures](evidence/sql/races-fixtures.json) e [runner portátil](evidence/sql/races_runner.py) preservam os quatro casos executados. Cada caso usou uma fixture nova; o holder executou sem commit, o segundo backend iniciou a operação e `pg_stat_activity` confirmou bloqueio advisory pelo holder antes da liberação. Foram usados `READ COMMITTED`, timeout de statement de 10 s e de lock de 8 s.

| Caso | Resultado e efeitos após commit |
| --- | --- |
| Mesmo request/input | Ambos retornaram revisão 1; 1 plano, 2 itens, 1 recibo selado e 1 recibo genérico |
| Requests diferentes, mesma revisão esperada | Um sucesso na revisão 1; perdedor `PT409` exato, sem recibo selado/genérico nem mudança do plano vencedor |
| Resolve antes do save atrasado | Ambos retornaram `cancelled: true`; 0 planos/itens, 1 recibo selado, 0 recibos genéricos |
| Save antes de resolve concorrente | Ambos retornaram revisão 1; 1 plano, 2 itens, 1 recibo selado e 1 recibo genérico |

Em todos os casos, o replay de save e resolve retornou exatamente o resultado selado, sem alteração de linhas. A comparação de linhas completas de **33 tabelas públicas com `workspace_id`**, excluídas apenas as duas tabelas de intenção F08, e de `cash_total` não encontrou mudança durante as operações testadas. Cada fixture continha uma conta, duas metas e um aporte inicial próprio; esse preparo foi separado das comparações.

O `finally` removeu **4 usuários sintéticos e 8 workspaces próprios** (incluindo os criados pelo trigger). As quatro auditorias de cleanup verificaram 82 colunas UUID de fronteira `user_id`/`workspace_id`, com zero resíduo, inclusive usuários, perfis e workspaces; o manifesto registra `cleaned: true`. Não foram usados usuários com senha, identidade de login ou sessão, nem dados QA existentes.

## Advisors após a terceira DDL

Os baselines [before](evidence/sql/advisors-before.json) e [after](evidence/sql/advisors-after.json) contêm 23 WARN e zero ERROR. Seus JSONs têm envelope `results` e chave `cacheKey`, compatíveis com a saída do conector; a invocação histórica exata não foi recuperada e não é atribuída a um comando específico.

O check atual somente de leitura, confirmado pelo [help da CLI](evidence/sql/advisors-help.txt), usou Supabase CLI 2.117.0:

```sh
scripts/supabase-target.sh < /dev/null
supabase db advisors --linked --project-ref utkqoiigimqzeenxkxdl \
  --type all --level warn --fail-on none -o json
```

[Saída após a terceira migration](evidence/sql/advisors-post-context.json), [stderr](evidence/sql/advisors-post-context.stderr) e [delta](evidence/sql/advisors-delta.json): **23 WARN, zero ERROR; adicionados `[]`, removidos `[]` contra ambos os baselines**. A comparação considera todos os campos de cada registro, normalizando somente o envelope, `cacheKey`/`cache_key`, escapes de backticks Markdown e ordem das chaves. Os avisos existentes permanecem: search path (3), extensão pública (1), funções SECURITY DEFINER expostas (5), proteção de senhas vazadas (1), políticas permissivas múltiplas (12) e índice duplicado (1). Não houve correção de schema ou dados neste check.

## Reprodução e limites

Com o mesmo staging, branch e dependências locais já presentes, os comandos executados para a prova aplicada e de concorrência foram o guard, `agent/.venv/bin/python /private/tmp/proops-f08-sql-runner.py applied` e `agent/.venv/bin/python /private/tmp/proops-f08-races-runner.py --execute`. Os runners leem `DATABASE_URL` de `agent/.env` internamente, sem credencial literal nos artefatos.

As [cópias portáteis](evidence/sql/artifact-manifest.json) descobrem a raiz pelo próprio caminho; o runner de concorrência importa [helpers adjacentes](evidence/sql/races_helpers.py) extraídos da dependência realmente usada, e grava o manifesto de recuperação no diretório temporário do sistema. Os hashes dos originais e as adaptações estão registrados. Estas cópias foram compiladas e o modo de preview foi executado sem conexão; os logs de banco vêm dos scripts originais. Para repetir a prova aplicada usando as cópias:

```sh
agent/.venv/bin/python docs/qa/2026-10-02-evolucao-financeira/f08/evidence/sql/sql_runner.py applied
agent/.venv/bin/python docs/qa/2026-10-02-evolucao-financeira/f08/evidence/sql/races_runner.py --execute
```

Os modos pré-aplicação RED/GREEN exigem schema F08 ausente; o modo `context` pressupõe somente as duas primeiras migrations presentes. Não correspondem ao estado atual do staging. A concorrência prova o protocolo por conexões PostgreSQL com role autenticada, **sem passagem por HTTP/PostgREST ou perda real de resposta de rede**. O cleanup observado cobre esta execução e o caminho normal de `finally`, não interrupção por SIGKILL, falha do host ou indisponibilidade do banco. Não houve validação de dispositivo nesta tarefa.
