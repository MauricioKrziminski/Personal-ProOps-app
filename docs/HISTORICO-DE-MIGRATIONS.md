# Histórico de subidas para produção

Registro, não regra: o que está em cada banco HOJE se confere na fonte (`CLAUDE.md`, *Banco e
fila*). Entradas movidas do `CLAUDE.md` em 26/09/2026, na ordem em que estavam lá.

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
