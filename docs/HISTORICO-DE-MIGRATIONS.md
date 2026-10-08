# Histórico de subidas para produção

Registro, não regra: o que está em cada banco HOJE se confere na fonte (`CLAUDE.md`, *Banco e
fila*). Entradas movidas do `CLAUDE.md` em 26/09/2026, na ordem em que estavam lá.

**Produção e staging ALINHADOS em `20261009140000`** — 17 migrations para a v1.9.0, de
`20261007120000` a `20261009140000` (lembrete de conta, apagar com alcance, pausa com prazo,
carência, "só esta" e lembrete por pessoa). `migration list --project-ref` mostrou exatamente essas
17 pendentes; aplicadas pelo Gabriel em 07/10/2026 com `PROOPS_PROD_OK=1` e `--project-ref`.
Conferência em leitura: `20261009140000`, `130000` e `120400` no topo de `schema_migrations`;
`_bill_reminders_due()` e `_alerts_to_send()` respondem sem erro.

**Produção e staging ALINHADOS em `20261006160000`** — as 6 da auditoria do agente
(`docs/qa/2026-10-06-auditoria-agente-ia.md`): `20261006100000_claim_recupera_processing`,
`110000_ai_events_uso`, `120000_transacao_embeddings`, `130000_agent_feedback`,
`150000_apelido_como_foi_dito` e `160000_agente_rls`. `migration list --project-ref` mostrou
exatamente essas 6 pendentes; aplicadas pelo Gabriel em 06/10/2026 com `PROOPS_PROD_OK=1` e
`--project-ref`. Na ordem migrations → agente: logo depois, o deploy `agente-00103-ccs` com
`AGENTE_RLS=true` e `AGENT_PROMPT_V2=true` (a mesma configuração do staging), conferido com
health 200, `/cron/reminders` 200 e nenhum erro no log da revisão.

**Antes, ALINHADOS em `20261005230000`** — promoção autorizada pelo Gabriel em
06/10/2026 para a v1.7.0 — publicada como v1.7.1: a tag v1.7.0 parou no teste do CI, sem build (programa de 22 pontos + correções de 05/10). `migration list` mostrou
as 43 migrations `20261002134032` … `20261005230000`, nenhuma só no remoto; aplicadas pelo
próprio Gabriel com `PROOPS_PROD_OK=1` e `--project-ref`, sem seed e sem trocar o link local de
staging. Conferência posterior em leitura: as três versões mais novas em `schema_migrations` são
`20261005230000`, `20261005220000` e `20261005210000`; `anon_sem_execute.sql` passou (transação
com rollback). Evidências: `docs/qa/2026-10-02-evolucao-financeira/` e
`docs/releases/2026-10-v1.7.0/`.

**Só no STAGING: `20261002134032_payment_methods.sql`** — aplicada em 02/10/2026 no projeto
`utkqoiigimqzeenxkxdl`, após `supabase-target.sh` e dry run com somente essa migration,
sem roles ou seeds. F01 adiciona método de pagamento independente de conta/status, revisões e
RPCs atômicas/idempotentes de lançamento com taxa Pix explicitamente vinculada e de criação
recorrente. Adapta compra, entrada, conversão, importação, edição com alcance e projeção,
preservando os contratos anteriores e o histórico por data. Cores privados revogados e
portas públicas autenticadas; nenhuma mudança remota foi feita em produção nesta execução.

Antes da aplicação, a migration exata e `payment_methods.sql` passaram em transação com
rollback, assim como as 18 suítes de regressão financeira selecionadas. SHA-256 da migration:
`01a54fd1f3ca6f0eadeb7aa37f5e80bc0d56a0721cad75c62dfb25a5632a17cd`.
Tipos gerados diretamente do staging, com nulabilidade SQL aceita preservada (o gerador não
expressa argumentos nullable de função). Testes nativos e aceite ainda em curso; evidência em
`docs/qa/2026-10-02-evolucao-financeira/`. Agente e app não foram publicados; promoção para
produção depende de uma etapa futura de release.

**Histórico: produção e staging ALINHADOS em `20260930164920`** — promoção da entrada de compras
explicitamente autorizada pelo Gabriel em 01/10/2026 para a v1.6.0. O dry run mostrou somente
`20260930164920_purchase_down_payment.sql`; aplicada com
`--project-ref kwriuifcwyvdrxtspjiz --skip-vault --yes`, sem seed e sem trocar o link local de
staging. Conferência posterior em leitura: versão presente nos dois bancos; as duas colunas
de entrada em `transactions`; nove definições de função e respectivas permissões idênticas;
quatro gatilhos de integridade ativos; dois índices únicos; RLS e policy da tabela privada de
idempotência idênticas ao staging. Nenhuma função de `public` executável por `anon`.
Advisors de segurança: zero erros, os mesmos 11 avisos anteriores, nenhum novo achado.
O agente não mudou nesta release. Evidências: `docs/releases/2026-10-01-v1.6.0/`.

**Histórico: produção e staging ALINHADOS em `20260930163000`** — promoção explicitamente autorizada pelo
Gabriel em 30/09/2026. Dry run de produção mostrou exatamente as nove migrações
`20260929120000`, `20260929130000`, `20260929140000`, `20260929150000`, `20260929160000`,
`20260929170000`, `20260930133521`, `20260930160000` e `20260930163000`. Aplicadas pelo CLI com
`--project-ref kwriuifcwyvdrxtspjiz --skip-vault`, sem seed e sem trocar o link local de staging.
Categorias foi aplicada e testada primeiro no staging. Conferência posterior em leitura:
as nove versões presentes nos dois bancos; 13 definições de função idênticas; RLS e Realtime de
`categories` ativos; CRUD para `authenticated`; RPCs da release sem execute para `anon`.
Advisors de segurança de produção: nenhum erro. As matrizes de conversão/edição (106 casos),
projeções, pagamento de dívida e recusa de anônimo passaram no staging com categorias presente,
sempre com rollback. Registro anterior das pendências abaixo preservado como histórico.

**Só no STAGING: `20260929120000_simular_hipoteses`** (29/09/2026) — `public.simular`: cria as
hipóteses detalhadas do "E se…?" de verdade numa subtransação, roda as leituras (Projeção, meses,
ciclo) e desfaz tudo. `security invoker`, sem `execute` para `anon`. Teste:
`supabase/tests/simular.sql` (10 casos, incluindo banco intacto e falha no meio). Em produção sobe
pelo Gabriel, **antes** do app que a chama.

**Só no STAGING: `20260929130000_simular_codigo_do_erro`** (29/09/2026) — a mesma `simular`, com
`codigo` (SQLSTATE) em cada erro, para o app mostrar só a frase nossa (P0001) e nunca o texto cru
do Postgres. Sobe no MESMO `db push` da anterior.

**Só no STAGING: `20260929140000_caixa_por_conta` e `20260929150000_horizonte_por_conta`**
(29/09/2026) — o caixa e os eventos da projeção passam a dizer a conta (`caixa_das_contas`,
`eventos_de_caixa`; `cash_total` e as duas `cash_flow_forecast` leem deles — a projeção do `dev@`
saiu IDÊNTICA nos 3.651 dias e no mês a mês, antes e depois) e o horizonte por conta e cartão
(`accounts_horizon`, `cards_horizon`, leituras `contas`/`cartoes` do `simular`). Sobem no MESMO
`db push` das duas `simular`, antes do app.

**Só no STAGING: `20260929160000_converter_registro`** (staging 29/09/2026; produção pendente) —
`public.converter_registro(p_origem, p_alcance, p_destino)`: muda o tipo de um registro que
existe numa transação só (encerra a origem pelo alcance e cria o destino por
`private.criar_registro_da_hipotese`). `security invoker`, sem `execute` para `anon`. Teste:
`supabase/tests/converter_registro.sql` (14 casos: 1–13 e 7b). Depende da `20260929120000` (a função de
criação); em produção sobe **antes** do app que a chama.

**AINDA EM NENHUM BANCO REMOTO: `20260929170000_categorias`** (29/09/2026, testada só no
Postgres LOCAL: a sessão que a escreveu não tinha acesso ao staging) — a tabela `categories`
(ícone e cor de um nome, por espaço; RLS `workspace rows`, na publicação do Realtime),
`categories_used` com `icon`, `color` e `budgets` no FIM (o APK antigo lê `category`/`uses` por
nome) e `save_category`, `rename_category` (juntar com `p_juntar`, recusa `CATEGORIA_EXISTE`) e
`delete_category`, que reescrevem o nome nas sete colunas. `security invoker`, sem `execute` para
`anon`. Mexe em dois gatilhos para um UPDATE só de categoria não acordá-los: `sync_debt_payment`
passa a `update of` as colunas que confere (antes, um pagamento com a conta pagadora arquivada
derrubava o rename inteiro) e `private.track_recurring_history` sai cedo com
`proops.renomeando_categoria` ligado (antes, versionava o rename e trocava uma versão futura de
calendário por outra com a âncora antiga). Teste: `supabase/tests/categorias.sql` (os dois
defeitos conferidos com o gatilho antigo: o teste falha). **Próximo passo: `db push` no staging**; em
produção sobe **antes** do app que a chama.

**Produção e staging ALINHADOS em `20260928237000`** — a `20260928236000` e esta aplicadas em
produção pelo Gabriel em 28/09/2026 (`db push --project-ref`) e conferidas na fonte:
`schema_migrations` devolve `20260928237000`, `20260928236000`, `20260928235000`; `draft_lines`
com `execute` para `authenticated` e sem para `anon`; `set_paid_at` com o limite de hoje; zero
lançamentos pagos no futuro fora de cartão; nenhuma função de `public` executável por `anon`.
`20260928237000_pago_nunca_no_futuro` (28/09/2026) — `paid_at` nunca passa de
hoje no que mexe no caixa (o cartão fica de fora). Repara o que já estava assim: no staging, um
lançamento ("Fone", pago em 01/12); em produção, nenhum (conferido antes). Conferida no staging
depois de aplicar: o ciclo de setembro e a Projeção em 30/09 fecham no mesmo número
(R$ 34.657,69, diferença zero). Em produção sobe pelo Gabriel, junto com a `20260928236000`.

`20260928236000_rascunho_no_detalhe_do_ciclo` (28/09/2026) — `draft_lines`, a
leitura das hipóteses do "E se…?" dentro do detalhe do ciclo, sobre o motor que já existia
(`private.draft_ocorrencias`). Só computa (não lê lançamento), `security invoker`, sem `execute`
para `anon`. Em produção sobe pelo Gabriel, **antes** do app que a chama.

**Produção e staging ALINHADOS em `20260928235000_valor_muda_em_fatura_fechada`** — aplicada
em produção pelo Gabriel em 28/09/2026 (`db push --project-ref`) e conferida na fonte:
`schema_migrations` devolve `20260928235000`, `20260928230000`, `20260928220000`; o gatilho
`valor_corrigido_na_fatura` ativo; as três RPCs sem a trava de valor, com `execute` para
`authenticated` e sem para `anon`; nenhuma função de `public` executável por `anon`. (28/09/2026) — o VALOR de uma
parcela, ocorrência ou compra muda mesmo numa fatura paga, adiada ou paga em parte, e o gatilho
`valor_corrigido_na_fatura` mantém a fatura honesta (paga: o pagamento fica, e reabre se o total
passar do que foi pago por transferência; adiada: o saldo levado anda junto; paga em parte: fecha
no zero, recusa abaixo). Conferida no staging depois de aplicar: gatilho ativo, as três RPCs sem a
trava de valor, `anon` sem execute. Teste: `supabase/tests/valor_em_fatura_fechada.sql`. Depois
dela, o agente e o app.

**Produção e staging ALINHADOS em `20260928230000_pix_no_credito_na_fatura`** — aplicada em
produção pelo Gabriel em 28/09/2026 (`db push --project-ref`, depois de `migration list` mostrar
só ela no `local`) e conferida na fonte: `schema_migrations` devolve `20260928230000`,
`20260928220000`, `20260928210080`; `private.conta_na_fatura(text)` existe (o `execute` de
`anon` é o padrão do Postgres e não alcança nada: `anon` não tem `usage` em `private`); nenhuma
função de `public` executável por `anon`. A transferência que sai do cartão (Pix no crédito para
conta própria) entra na fatura e, no caixa, é entrada na conta. Teste:
`supabase/tests/pix_no_credito.sql`. Na ordem: depois dela, o acerto do dado
(`scripts/prod-dados/2026-09-28-pix-no-credito-itau.sql`), o agente e a tag `v1.4.0`.

**Produção e staging ALINHADOS em `20260928220000`** — as 31 de `20260927212119` a
`20260928220000` aplicadas em produção pelo Gabriel em 28/09/2026 (`db push --project-ref`,
depois de `migration list --project-ref` mostrar as 31 só no `local`) e conferidas na fonte:
`schema_migrations` devolve `20260928220000`, `20260928210080`, `20260928210070`;
`daily_spending` em uma versão, com `execute` para `authenticated` e sem para `anon`;
`_daily_spending` sem `execute` para os dois; e nenhuma função de `public` executável por `anon`.
Seguida a ordem migrations → agente → app no mesmo dia: agente `agente-00092-9kk` (`/health`
200, `/internal/chat` 401 sem login, `/cron/reminders` 200 na revisão nova) e depois a tag
`v1.3.53` e o build no iPhone. `20260928220000`: o gasto e a entrada de cada dia, pela régua de
`transactions_summary`, para a semana da Hoje.

**Produção e staging ALINHADOS em `20260920130000`** — aplicadas em produção pelo Gabriel em
21/09/2026 e conferidas na fonte (`schema_migrations` devolve `20260920130000`,
`20260920120000`, `20260918220000`; as duas RPCs existem em uma versão cada, com `execute` para
`authenticated` e sem para `anon`). Agente de produção `agente-00074` e app `v1.3.42` subiram
depois. O parágrafo abaixo é o histórico da subida: (Histórico) as pendentes eram
`20260920120000` e `20260920130000` (parcelar um lançamento que já existe, e desparcelar —
`convert_transaction_to_installments` e a nova `update_installment_plan` que aceita
`p_installments = 1`). As duas sobem juntas, e sobem ANTES do build/OTA que leva os dois botões
novos ("Parcelar" na linha e "À vista" no editor da compra) para o telefone do usuário: sem
elas em produção, `convert_transaction_to_installments` não existe
(`supabase.rpc` volta `PGRST202` e o toast cai em "Não deu para parcelar") e o chip "À vista"
bate na `update_installment_plan` antiga, cujo piso ainda é 2. **Nada corrompe; os dois botões
simplesmente não funcionam.** O mesmo vale para o AGENTE: parcelar um lançamento e desparcelar
("desparcela a compra da tv" → `update_installment_plan` com 1 parcela) dependem das duas —
sem elas a chamada falha (função ausente, ou o piso 2 da `update_installment_plan` antiga) e nada muda.

**Produção e staging ALINHADOS em `20260921120000`** — aplicada em produção pelo Gabriel em
21/09/2026 ("E se…" adiantando parcelas: `draft_ocorrencias` com `mode = 'cancel'` e
`anticipation_candidates`) e conferida na fonte (`schema_migrations` devolve `20260921120000`,
`20260920130000`, `20260920120000`; as duas funções com fuso no cabeçalho, `execute` para
`authenticated` e sem para `anon`). Agente `agente-00078-k5f` (produção) e
`agente-staging-00146-7nr` subiram no mesmo dia; app `v1.3.43`.

**Produção e staging ALINHADOS em `20260922130000`** — aplicada em produção pelo Gabriel em
22/09/2026 (`goal_deposit` recusa retirar mais que o guardado; conferida na fonte: uma versão,
`search_path=public`, `execute` para `authenticated`), junto com a `20260922120000`, aplicada em
22/09/2026 ("E se… adiantar": conta fixa listada até o teto da Projeção, 10 anos) e conferida
na fonte (`schema_migrations` devolve `20260922120000`, `20260921120000`, `20260920130000`;
`anticipation_candidates` em uma versão, fuso no cabeçalho, `execute` para `authenticated` e
sem para `anon`). App `v1.3.46`.

**Produção e staging ALINHADOS em `20260922150000`** — aplicadas em produção pelo Gabriel em
22/09/2026 (`db push --project-ref`) e conferidas na fonte (`migration list --project-ref`
devolve `20260922150000` e `20260922140000` com `remote` preenchido).
`20260922140000`: parcelar no cartão um lançamento que já existe gravava a parcela 1 `cleared`,
e `parcela_travada` a lia como paga — a compra inteira travava (a queixa da wardogs); a
migration grava `pending` na adoção em cartão e conserta as parcelas 1 que já nasceram assim.
`20260922150000`: importação inteligente (colunas novas em `import_items`, status `uncertain`,
`finish_import_batch`, fatura do histórico nascendo quitada). ⚠️ **Ordem: migrations → app →
agente.** O agente novo exige a conta no import (o app antigo a deixava opcional → 422 claro).
Seguida nessa ordem no mesmo dia: build de produção no iPhone e agente `agente-00080-4cl`.

**Produção e staging ALINHADOS em `20260924120000`** — aplicadas em produção pelo Gabriel em
24/09/2026 (`db push --project-ref`) e conferidas na fonte (`migration list --project-ref` devolve
as cinco com `remote` preenchido: `20260923120000`, `20260923140000`, `20260923160000`,
`20260923170000`, `20260924120000`; a anon key recebe `42501 permission denied for function` em
`cycle_now`). Seguida a ordem migrations → agente → app no mesmo dia: agente `agente-00082-zvx`
(`/health` 200) e depois a tag `v1.3.48` e o build de produção no iPhone.
`20260923120000`: lembrete vinculado à nota (`reminders.note_id`, FK composta, um por nota).
`20260923140000`: o mês fecha em qualquer dia até o 31 (`check` 1..30, clamp do `day_in_month`).
`20260923160000` + `20260923170000`: financiamento maleável (`debts.first_due_date`, contrato
fixo editável com pagamento lançado, `public.delete_debt`, âncora sem o ramo "paga no ciclo").
`20260924120000`: `anon` sem EXECUTE nas funções de public. ⚠️ O PUBLIC do padrão global do
Postgres reabre toda função NOVA: migration que cria função em public continua com o seu
`revoke execute ... from public, anon`, e `supabase/tests/anon_sem_execute.sql` acusa a que
esquecer.

**Produção e staging ALINHADOS em `20260927130000`** — aplicadas em produção pelo Gabriel em
27/09/2026 (`db push --project-ref`, depois de `migration list --project-ref` mostrar as duas só no
`local`) e conferidas na fonte: `schema_migrations` devolve `20260927130000`, `20260927120000`;
`update_recurring_series` com o laço que desliza o calendário; o gatilho
`linhas_da_fatura_liquidada` ligado; `_liquidar_faturas_vencidas` e o gatilho sem `execute` para
`authenticated` e `anon`; e a fatura adiada do Nubank de setembro com as 37 linhas pagas (as 7
parcelas do app, antes em aberto, com `paid_at` 10/09) e nenhuma linha pendente em fatura adiada
ou paga em parte e vencida. Seguida a ordem migrations → agente → app no mesmo dia: agente
`agente-00086-4wl` (`/health` 200, `/cron/reminders` 200) e depois a tag `v1.3.52` e o build no
iPhone. `20260927120000`: mudar o dia de uma série desliza para o primeiro mês livre em vez de
recusar; a parcela paga fora do cartão fica no dia dela quando a data da compra muda.
`20260927130000`: fatura adiada, ou paga em parte e vencida, dá baixa nas compras e parcelas dela.

**Produção e staging ALINHADOS em `20260926180000`** — aplicadas em produção pelo Gabriel em
27/09/2026 (`db push --project-ref`, depois de `migration list --project-ref` mostrar as onze só
no `local`) e conferidas na fonte: `schema_migrations` devolve `20260926180000`,
`20260926170000`; `unsettle_invoice`, `unroll_invoice`, `edit_budget`,
`edit_goal_contribution`, `update_installment_plan` (9 argumentos) e `update_recurring_series`
com `execute` para `authenticated` e sem para `anon`; os helpers `private` que funções
`security invoker` chamam com `execute` para `authenticated`; o trigger `sync_invoice_payment`
ligado; e os 4 pagamentos de fatura com `pays_invoice_id` apontando para a fatura (nenhum
`payment_transaction_id` sem o par). Seguida a ordem migrations → agente → app no mesmo dia:
agente `agente-00084-xbs` (`/health` 200) e depois a tag `v1.3.51` e o build no iPhone.
`20260925120000`–`20260925150000`: parcela fixa paga com outro valor (encargo/desconto), ciclo
fechado só com o que aconteceu, "este e as próximas" no pagamento, apagar o pagamento mais
recente de parcela fixa. `20260926120000`–`20260926170000`: tudo que se cria se edita (série
recorrente inteira, parcelas pagas na compra, pagamento de dívida, limite do orçamento, aporte da
meta, cartão refazendo as faturas abertas). `20260926180000`: o pagamento da fatura se edita e se
apaga, e "Marcar como paga" e o adiamento se desfazem.

⚠️ **OTA/build do chat exige a revisão nova do agente em produção** (21/09/2026): o app novo
manda `id` no `POST /internal/chat/conversations` para abrir a conversa na hora, e o agente
antigo (`extra='forbid'`) recusa com 422 — TODA primeira mensagem falha. Sem migration: é só
a ordem dos deploys (agente antes do app).

⚠️ **O AGENTE também depende das duas, desde 21/09/2026** (Task 4 do plano "agente sem
engessar": `finance._parcelar`, `agent/app/tools/finance.py`, chama a MESMA
`convert_transaction_to_installments`). A ordem de deploy em produção é
**migrations → agente → app**: subir o agente novo em produção antes das duas migrations faz
"parcela isso em 2x" (sobre um lançamento avulso) devolver o mesmo P0001/erro de função
inexistente do app — RPC chamada direto pelo agente, sem o toast do app para amortecer.

**Este parágrafo é sobre a PENDÊNCIA em si; não altere os números de versão de staging/produção
aqui em cima ao mexer nesta seção** — quem atualiza `20260920130000`/`20260918220000` é quem de
fato aplicou a migration, com a fonte conferida (ver a régua desta seção).

(Histórico) **Produção e staging estiveram ALINHADOS em `20260918220000`** — conferido na fonte
em 19/09/2026 (`schema_migrations` de produção devolve `20260918220000`, `20260918120000`,
`20260917120000`, e `executed_actions` já tem `user_id`/`workspace_id`/`origin_text`). Os
parágrafos abaixo são o histórico da subida.

Produção estava em **`20260915230000`** (o quarto slot de rascunho cabe no CHECK), aplicada em
15/09/2026 pelo Gabriel junto da `20260915210000` (reparcelar a compra: `update_installment_plan`
e `private.parcela_travada`), depois da `20260915190000` (a parcela herda o nome do
estabelecimento) e da `20260915120000` (a coluna `atrasada` de `cycle_lines`).

(Histórico) **O staging esteve DUAS à frente: `20260917120000` e `20260918120000`.** A primeira (17/09/2026, `card_summary` e
`_card_summary` ganham `invoice_open_cents` no fim — o que falta na fatura corrente, líquido do
pagamento parcial). Conferida no staging depois de aplicar: a coluna é a última das duas
assinaturas, `_card_summary` segue `security definer` e sem `execute` para `anon` e
`authenticated`, e `card_summary` tem os mesmos grants das outras portas públicas. **Produção
ainda não tem** — subir é decisão do Gabriel. O app novo lê a coluna em Cartões e, sem ela
em produção, volta à conta antiga pelo total bruto (`outrasFaturas`) — que só erra quando a
fatura corrente tem pagamento parcial. Nada quebra.

A `20260918120000` (aplicada no staging em 17/09/2026) dá dono e frase de origem a
`executed_actions`, abre `public.agent_activity` (a Conversa da Hoje, `security definer`, só as
falas do próprio chamador, sem `payload`) e `public.spendable_path` (a Pista, a mesma lista que
forma o "livre"). Conferida no staging depois de aplicar: `supabase/tests/agent_activity.sql`
verde (isolamento entre duas pessoas do mesmo workspace, registro apagado, lote com áudio,
`anon` sem execute), `da_para_gastar.sql` verde, e a soma da Pista igual ao comprometido na
conta `dev@`. Produção sem ela: a Hoje mostra a Conversa com erro e a Pista sem entalhes — o
resto funciona. ⚠️ **Ela sobe ANTES do deploy do agente que grava as colunas novas**
(`agent/app/db.py`, `reserve_execution`): o agente novo contra um banco sem
`user_id`/`workspace_id`/`origin_text` em `executed_actions` quebra TODA escrita.

Todas conferidas na fonte DEPOIS de aplicar (`scripts/` não guarda isso; a conferência da leva
de 15/09 está no histórico desta linha): a `atrasada` é a última coluna de `cycle_lines`,
`_cycle_lines` segue revogada, o CHECK de `draft_actions.slot` lista os quatro valores,
`update_installment_plan` e `parcela_travada` existem em UMA versão cada com
`search_path=public`, `authenticated` mantém `execute` nas portas públicas e **`anon` não o
tem** — e o `create or replace` das duas levas preservou o `TimeZone=America/Sao_Paulo` da casca
de 7 argumentos de `create_installment_plan` (que nenhuma delas toca).

Conferido na fonte depois da leva de 14/09: as 43 RPCs que o app chama existem e continuam com `execute`
para `authenticated` (é o modo de falha do par `200000`/`220000`, abaixo), e
`public._alerts_to_send()` ficou sem `execute` para `anon` e `authenticated` — era um vazamento
de telefone e push token de todos os workspaces, alcançável com a anon key e sem login.

⚠️ **A `200000` e a `220000` são um PAR e sobem juntas.** A primeira cria
`private.debt_paid_in_cycle` com `revoke`, e a segunda devolve o `execute`; só a primeira
derruba a Hoje e a Projeção com `42501 permission denied`, porque `debt_schedule_for` é
`security invoker` e a chamada aninhada usa o privilégio do `authenticated`.

**Lembrete de conta** — `20261007120000`, `20261007120100` e `20261007120200`: staging 07/10/2026, produção 07/10/2026.
Sobem juntas (a segunda faz o lembrete próprio substituir o aviso automático).

**Apagar com alcance** — `20261008100000`, `20261008100100`, `20261008100200`, `20261008100300`, `20261008100400` e `20261008100500`: staging 07/10/2026, produção 07/10/2026.
Sobem juntas (`100400`/`100500` são o gatilho que impede o apagar comum de deixar fatura paga em parte abaixo do pago).

**Apagar com alcance, revisão final** — `20261008100600`: staging 07/10/2026, produção 07/10/2026. Sobe junto das seis de `20261008100000` a `20261008100500` (espaço do pai na série e no lembrete; "Esta e as próximas" leva a paga depois da âncora).

**Pausar com prazo e carência** — `20261009120000` (pausa da série) e `20261009120100` (carência da dívida): staging 07/10/2026, produção 07/10/2026.
Sobem juntas, depois das de `20261008…`.

**Carência, correções** — `20261009120200`: staging 07/10/2026, produção 07/10/2026. Sobe junto de `20261009120000` e `20261009120100`.

**Carência, ordem e âncora** — `20261009120300`: staging 07/10/2026, produção 07/10/2026. Sobe junto de `20261009120000`, `120100` e `120200`.

**Carência, revisão final** — `20261009120400`: staging 07/10/2026, produção 07/10/2026. Sobe junto de `20261009120000`, `120100`, `120200` e `120300`.
Ordem de deploy em produção: migrations, depois o agente (confirmar a revisão nova do Cloud Run servindo) e só então a tag do app. Agente antigo re-materializa as linhas pausadas; agente novo antes das migrations quebra o agendador e o cron de lembretes, que selecionam as colunas novas.

**Lembrete: "só esta" e parcela da dívida** — `20261009130000`; **lembrete por pessoa e envio único** — `20261009140000`: staging e produção 07/10/2026. Sobem depois das de `20261009120…`.
