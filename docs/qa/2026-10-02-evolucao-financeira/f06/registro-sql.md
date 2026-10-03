# F06 — evidência de banco e integração

Data: 03/10/2026. Branch: `gabriel/financas-22-melhorias`.
Registro cronológico de implementação e validação. A confirmação final é o contrato
e o registro de aceite deste incremento; blocos antigos preservam os estados da execução.

## Alvo e aplicação

`scripts/supabase-target.sh` confirmou CLI e `.env.local` em staging
`utkqoiigimqzeenxkxdl`. Produção não foi usada.

O dry-run mostrou exatamente três migrations, sem roles, seeds ou atualização de Vault:

| Migration | SHA-256 aplicado |
|---|---|
| `20261003035203_expense_classification_snapshots.sql` | `5696dfc3ddb419de209ab76196fc161c0ca408e2c2d3ec3739b422c4cbde635d` |
| `20261003040215_category_classification_configuration.sql` | `be9badbc3c8d0c7273525914aa5ac70d5636e459ea5a5141b0959e5d37c4e6bf` |
| `20261003041235_expense_classification_writes.sql` | `17a77c29c104ea510ddd284becc78b1de3fbf4a6dd63ab1697be02d5cdd204a1` |

Comandos executados, ambos exit 0:

```sh
supabase db push --project-ref utkqoiigimqzeenxkxdl --skip-vault --dry-run
scripts/supabase-target.sh
supabase db push --project-ref utkqoiigimqzeenxkxdl --skip-vault --yes
supabase gen types typescript --project-id utkqoiigimqzeenxkxdl --schema public,graphql_public
```

Types gerados substituem `src/lib/database.types.ts`. O arquivo gerado não recebe edições
manuais. `database-contract.ts` declara apenas os argumentos nullable de cinco RPCs já
comprovados em SQL; a introspecção não descreve essa intenção dos parâmetros de função.
Essa separação segue a orientação de
[customização dos tipos gerados](https://supabase.com/docs/guides/api/rest/generating-types).

Logs locais: `/private/tmp/proops-f06-migration-dry-run.log`,
`proops-f06-migration-apply.log`, `proops-f06-types-full.stderr`.

## RED/GREEN e regressão antes da aplicação

Cada arquivo temporário compôs as três migrations com sua suíte. `scripts/sql-test.py`
executou em staging com rollback obrigatório, sem persistir fixtures. As 16 execuções
finais terminaram **exit 0**:

- `expense_classification`, `expense_classification_writes`,
  `category_classification_configuration`;
- `payment_methods`, `conversion_payment_method`, `materialize_payment_method`, `categorias`;
- `recurring_all_scope`, `recurring_future_scope`, `recurring_one_scope`;
- `installment_scope_atomic`, `installment_occurrence_atomic`;
- `debt_contract_scoped`, `debt_payment_scoped`, `down_payment`, `finance_write_preview`.

Logs: `/private/tmp/proops-f06-sql-<suite>-final.log`.
`finance_write_preview` foi executada com `--repeatable-read` como exige sua fixture.

Falhas reproduzidas e corrigidas antes da aplicação: calendário financeiro apagando
snapshots temporais; conversão para receita recorrente propagando classificação de gasto;
merge global transferindo defaults a um receptor virtual em outro workspace;
remoção da última exceção de dívida violando o CHECK antes da limpeza; edição somente de
classificação/revisão reconstruindo o histórico recorrente sem mudança de calendário.
As fixtures comprovam preservação de dimensões omitidas, null manual, defaults como
snapshot, alcances, replay/CAS, isolamento, materialização e previsão temporal.
A revisão estática independente não deixou achados concretos abertos; ela não é execução SQL.

Limite da regressão: `expected_recurring_occurrences.sql` contém uma data fixa de próximo
vencimento `2026-10-01`, anterior ao dia desta execução. A mesma falha ocorreu no staging
original **sem** F06 (`O próximo vencimento não pode ser antes de hoje`). Essa suíte não
foi contada como aprovada. O cenário temporal do F06 foi testado nas fixtures próprias.

## Confirmação no schema aplicado

Executados diretamente, sem recompor DDL, via
`agent/.venv/bin/python scripts/sql-test.py supabase/tests/<suite>.sql`:

| Suíte | Saída | Log local |
|---|---|---|
| `expense_classification` | 0 | `/private/tmp/proops-f06-stage-expense_classification.log` |
| `expense_classification_writes` | 0 | `/private/tmp/proops-f06-stage-expense_classification_writes.log` |
| `category_classification_configuration` | 0 | `/private/tmp/proops-f06-stage-category_classification_configuration.log` |
| `anon_sem_execute` | 0 | `/private/tmp/proops-f06-stage-anon_sem_execute.log` |

Todos usam rollback. Nenhuma fixture F06 persistente foi criada nesta etapa.

## Advisors

```sh
supabase db advisors --linked --project-ref utkqoiigimqzeenxkxdl \
  --type all --level warn --fail-on none --output json
```

Antes/depois: exit 0, **23 avisos em ambos**, nenhum `cache_key` novo ou removido.
Isso comprova ausência de regressão reportada pelos advisors, não ausência de toda falha.
JSONs locais: `/private/tmp/proops-f06-advisors-{before,after}.json`.

## Integração em andamento

Os campos de leitura, filtros, editor de categoria e formulários estão sendo integrados.
O teste de hooks iniciou com três falhas comportamentais: falta de revisão de contrato
na edição de parcela; categoria em duas RPCs; dimensão perdida na edição estrutural de compra.
O GREEN final de integração ainda será registrado depois dos forms completos.

Ainda pendentes: gates finais, prévia com classificação no fluxo real, persistência nativa,
iOS/Android, casos de erro/retry, fontes/temas/tablet, revisão visual e aceite do F06.

## Integração da prévia (quarta migration F06)

Migration aplicada no mesmo staging: `20261003053457_expense_classification_preview.sql`.
SHA-256: `6eb4a2eae92a350b01a97f4c232cc5082e2140a7d02de52eebc272e16ab1a070`.
As três migrations anteriores permaneceram intactas. O dry run listou somente esta migration,
sem seeds/roles; aplicação exit 0. Logs privados
`/private/tmp/proops-f06-preview-migration-{dry-run,apply}.log`.

RED real: a prévia F04 recusava a classificação válida com `Campos de prévia inválidos`.
A nova migration transforma sete trechos únicos da definição viva: amplia apenas as quatro
colunas admitidas e inclui os snapshots enquanto a escrita simulada ainda existe. Confere
os atributos completos de `pg_proc`, assinatura, identidade, dono, privilégios, modo invoker,
search_path e demais configurações; deriva somente `prosrc`. Drift aborta a transação.

A suíte `finance_write_preview.sql` agora compara classificação com escrita real independente:
39 hipóteses válidas nos quatro formatos, quatro combinações, origens explicit/default,
quatro nulls, null explícito e uma dimensão; entrada, taxa Pix independente, edição omissa/
parcial e receita. Também verifica duas entradas inválidas, totais canônicos e rollback de
modelos/revisões/histórico/intenção. Composição transacional e execução direta após a aplicação
passaram, exit 0 (`--repeatable-read`); `anon_sem_execute` composto passou, exit 0.

Comando direto executado pelo integrador:
`agent/.venv/bin/python scripts/sql-test.py supabase/tests/finance_write_preview.sql --repeatable-read`.
Log `/private/tmp/proops-f06-preview-stage-green.log`. Advisors após a quarta migration:
23 avisos com exatamente as mesmas chaves dos anteriores; nenhum aviso novo.

## Integração JavaScript

`npm test`: 1.652/1.652, exit 0; `npx tsc --noEmit` e `npm run lint`: exit 0.
Logs `/private/tmp/proops-f06-{node,ts,lint}-final.log`. Harnesses foram adaptados para executar
os módulos no mesmo realm de JavaScript do Metro, sem afrouxar o domínio de objetos/pares.
A leitura dos padrões de categoria é paginada e rejeita resultado truncado; testes cobrem
1.001 configurações e o teto de leitura. O parser da prévia também preserva e valida os quatro snapshots, recusa pares inconsistentes e metadados em receitas/transferências, e mantém campos legados ausentes. Estes resultados ainda não constituem aceite nativo.


## Concorrência real em duas conexões — categoria QA nativa

Execução corrigida concluída em **2026-10-03T06:25:28Z** (03:25:28 BRT), exit 0.
Categoria criada pela UI Android no staging: `e6136f90-090a-4794-ae2b-8a18a11813d3`,
`qa f06 android padrão`, autor QA `7ebb1a7e-5588-41b3-b62f-d8ebea5766a3`, workspace
`b94c2f3e-e1f1-450e-b549-bc570b5e8b0e`. Não usa dados pessoais.

O agente principal autorizou especificamente essa categoria e liberou uma janela sem saves
após os roteiros UI concluírem. `scripts/supabase-target.sh` confirmou staging antes de cada
cenário; `agent/.env` também exigiu o ref `utkqoiigimqzeenxkxdl`. Produção não foi acessada.

Preparação offline e execução autorizada:

```sh
agent/.venv/bin/python -m py_compile /private/tmp/proops-f06-category-concurrency.py
agent/.venv/bin/python /private/tmp/proops-f06-category-concurrency.py
scripts/supabase-target.sh
agent/.venv/bin/python /private/tmp/proops-f06-category-concurrency.py \
  --execute --category e6136f90-090a-4794-ae2b-8a18a11813d3
```

O script abriu **duas conexões Postgres distintas**, confirmou `pg_backend_pid()` real de
cada transação e executou todas as chamadas de `save_category_configuration` com
`SET LOCAL ROLE authenticated`, `auth.uid()` QA e RLS. Não simulou concorrência em uma sessão.
A leu/fixou nome, ícone, cor, defaults e CAS atuais; cada cenário reutilizou exatamente esse
payload nas duas sessões. `rename_from=null`, `juntar=false`, sem chaves de período: **nenhum
backfill, rename, merge ou comando financeiro** foi solicitado.

A primeira chamada de A retornou mantendo sua transação aberta. B executou em uma thread
separada. O monitor leu somente a atividade dos PIDs QA, exigindo `wait_event_type=Lock` e
A como bloqueador direto em `pg_blocking_pids(B)`. Para essa observabilidade somente, A
restaurou temporariamente o papel original da conexão e depois voltou a authenticated;
nenhuma mutação usou esse papel original. A contagem do audit privado também usou esse
papel somente para SELECT, restrito ao autor/workspace QA, pois o contrato revoga leitura
direta de authenticated. B só pôde confirmar depois do evento
`allow_commit`, liberado após observar o lock real e confirmar A. Abort/finally cancela B
antes de liberar A; statement/lock/join timeouts são limitados, e ambas as conexões fecham
explicitamente. Nenhum contexto de conexão faz commit automático na saída.

| Cenário | Contenção observada | Resultado | Revisão | Receipt |
|---|---|---|---|---|
| A — mesmo requestId/payload/CAS | Lock `transactionid`, A bloqueava B | Duas respostas JSON iguais, replay antes do CAS antigo | 1 → 2, uma vez | Uma linha finished |
| B — requestIds distintos, mesmo payload/CAS | Lock `advisory`, A bloqueava B | A confirmou; B recusou `CATEGORIA_CONFIGURACAO_DESATUALIZADA`, SQLSTATE `P0001` | 2 → 3, uma vez | Uma linha finished; intent recusada não persistiu |

A chamada inicial de A levou 76,18 ms; B ficou 232,68 ms até o replay.
No segundo cenário, A levou 20,22 ms e B 113,92 ms até a recusa.
Os tempos incluem latência e overhead de observação; não são benchmark de desempenho.
Ambos tiveram `backfill_updated=0`, `juntou=false` e **audit delta 0**, conforme esperado
quando não existe backfill. Não se espera uma linha de journal nesse comando; a prova de
exactly-once é receipt + resposta + revisão. Nome/ícone/cor/defaults/criação/autor/workspace
ficaram idênticos; somente `edit_revision` e o `updated_at` técnico avançaram.
Hash desses metadados estáveis: `d41aa61a310c8e917720fe0927dd41c1481fcdae5ca4e82ec0e18f9eb0600946`.

### Tentativa inicial interrompida e efeito persistido

A primeira execução parou com `REAL_LOCK_CONTENTION_NOT_OBSERVED`: o papel authenticated
ocultava os campos de atividade necessários ao monitor. O harness inicial também permitia
B confirmar logo após o retorno do comando e liberava A antes de cancelar B. Por essa corrida,
**B confirmou uma edição QA após o rollback de A**. Isso foi um erro do harness, não replay/CAS
comprovado; a tentativa não é contada como aprovada.

Uma consulta read-only independente confirmou exatamente revisão **1** (antes 0), **um receipt**
cujo `payload.input.category_id` era essa categoria, e defaults fixed/essential preservados.
O agente principal confirmou a mesma revisão por seu oracle. Antes de repetir, o harness foi
corrigido com `allow_commit/abort`, cancelamento antes de liberar A e observação permitida.
A rodada aprovada partiu da revisão real 1 e somou duas revisões, chegando a **3**. Portanto,
três revisões QA/receipts bem-sucedidos decorreram das duas execuções em conjunto; não houve
restauração artificial de revisão nem apagamento de receipts. A tentativa inicial não possui
um comparador financeiro final concluído e essa limitação fica explícita.

### Conservação financeira da rodada aprovada

Antes da rodada corrigida, foram congelados os IDs existentes no workspace QA. SELECTs
independentes, sob RLS, resumiram todas as colunas dessas linhas antes/depois; qualquer
remoção/alteração de registro congelado falharia. Novos IDs concorrentes não entram nesse
comparador. O agente principal também pausou saves durante a janela, permitindo comparar os
saldos derivados dos mesmos account IDs sem interferência de novos gastos.

**Todos os hashes ficaram idênticos** na rodada aprovada:

| Modelo/conjunto congelado | Linhas | SHA-256 antes = depois |
|---|---:|---|
| `transactions` | 125 | `de245a0d2ccf6b2619c0235e2432ade998c8a5776224b8532c611cccb3cf7ea5` |
| `installment_plans` | 10 | `3ee49e04fbe2dfcb101180be7bf745c75ee6bc1cbf430d1cb9054f8126ab29f9` |
| `recurring_transactions` | 7 | `27a1dae965f96db019daea8057a56e449982d6b068ab94ded691b6af3da4cfc0` |
| `debts` | 4 | `4408a2dc393017cf4be76cf0cbed763f07bdb6cb743672afd0ae1be7bb5b09cb` |
| `budgets` | 6 | `484cdb0181830f846ce8aa348baf8b8593a281d0058969b94081efc36bef4e98` |
| `accounts` | 20 | `34f5ebd898b24554cb1923432b34abd983c854aebc695542970d78087494f7c2` |
| `card_invoices` | 48 | `3df513afc22ec94eb456fb3f498518b5bf7f676f5b790e1abaf0b83535a953dc` |
| `other_categories` | 1 | `ffbbdcc71231d55e326c76a9921763844981f19e3bf1eb58a59ccb50da7088a0` |
| `balances` | 21 | `449e2eca8eb1898b87d3634a60f35cb7247e292d08f1acd6d35f1fa8569eabdd` |

A própria categoria QA é excluída de `other_categories`; seus metadados são conferidos à parte.
Não há escrita de transações, valores, saldos, parcelas, séries, dívidas ou orçamentos nesse teste.
O comparador cobre os registros existentes no baseline e não afirma conservação de registros
que fossem criados depois do congelamento.

Script privado: `/private/tmp/proops-f06-category-concurrency.py`.
Resultado sanitizado mode 0600: `/private/tmp/proops-f06-category-concurrency-result.json`,
incluindo o estado observado da tentativa inicial. Não guarda senhas, URLs de conexão,
queries completas, descrições financeiras ou IDs dos registros financeiros.

Limite: estes cenários provam contenção/replay/CAS reais nesta categoria staging sob chamadas
Postgres autenticadas. Não provam corrida nativa HTTP entre dois aparelhos, merge/backfill
concorrente, todos os workspaces ou ausência de quaisquer problemas futuros. A prova nativa
continua sendo registrada separadamente pelo integrador.

## Revisão de integração — baseline do editor de série

A revisão independente encontrou uma sobrescrita concorrente no editor direto de série:
o rascunho inicial era comparado com o registro atualizado por realtime e usava sua revisão
nova. Corrigido com snapshot completo da abertura, registrado/restaurado junto ao rascunho.
Diff e CAS agora usam a mesma baseline; retry do editor aberto conserva patch/revisão/intenção.
Reabertura após mudança de formato conserva a baseline; aceita estado legado de campos planos.

Seis regressões falharam antes da correção; sete passaram depois: dois alcances (future/all),
realtime, resposta perdida e retry, remount e estado legado. Root leu implementação/testes e
executou os sete casos reais do editor (exit0). Nova revisão independente confirmou o P2
resolvido estaticamente, sem emitir aceite nativo. UI completa 338/338; suite Node final
**1659/1659**, `npm run lint` e `npx tsc --noEmit` exit0. Logs privados
`proops-f06-series-baseline-{red,ui-full,domain}.log`, `proops-f06-series-root-check.log`,
`proops-f06-{node,lint}-post-review.log`; nenhum teste ou revisão representa release.

## Correções de formulário posteriores aos gates SQL

Nenhuma migration aplicada foi editada. O reteste nativo revelou perda de sugestões
ao trocar para financiamento e perda da última decisão ao retornar a um formato
já visitado. As correções ficaram nos corpos/harness de interface: nove + dezesseis
casos novos RED/GREEN, UI 363/363 e TypeScript exit0. O agente principal conferiu
a restauração dos três corpos e repetiu os 16 casos, exit0. Baseline/CAS da série
permanece congelado; defaults de categoria não são adotados implicitamente na edição.
Gates gerais finais ainda devem ser rodados após concluir a QA nativa.

## Gates finais e imutabilidade

Depois das correções de formato, origem de workspace, controles compartilhados e
nome do callback puro, gates do agente principal: 1703/1703 Node, TypeScript --noEmit
exit0 e EXPO_NO_DOTENV=1 npm run lint exit0. Todos os quatro SHA-256 das migrations
aplicadas foram conferidos novamente e correspondem ao registro; nenhum DDL já aplicado
foi editado. Sem mudança SQL depois das últimas suítes/concorrência/prévia aprovadas;
não repetir rollback apenas para inflar a contagem de evidência.

QA nativa e leitura independente final confirmaram criação/defaults/overrides/NULL,
alcances/backfill/filtros, preservação financeira e cancelamentos. A recuperação real
Android criou exatamente uma saída de 9 centavos com um recibo idempotente concluído;
seu efeito é explicitamente separado da reclassificação sem mudança financeira.
Ver registro-nativo.md, registro-http.md e navegacao-android.md para comandos/limites.
