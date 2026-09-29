# Histórico de subidas para produção

Registro, não regra: o que está em cada banco HOJE se confere na fonte (`CLAUDE.md`, *Banco e
fila*). Entradas movidas do `CLAUDE.md` em 26/09/2026, na ordem em que estavam lá.

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
`supabase/tests/converter_registro.sql` (11 casos). Depende da `20260929120000` (a função de
criação); em produção sobe **antes** do app que a chama.

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
