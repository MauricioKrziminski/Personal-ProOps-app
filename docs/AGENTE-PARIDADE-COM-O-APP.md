# O agente faz tudo que o dedo faz — auditoria de 09/09/2026

> Pedido do dono do produto: *"garanta que o agente consiga fazer tudo que o usuário possa fazer
> manualmente dentro do app, sem perder na segurança e sempre validando com o usuário."*

Método: enumerar **toda** mutação do app (`useMutation` em `src/hooks/`, 53) e casar cada uma com
o caminho do agente que faz a mesma coisa. Nada de amostragem — a queixa que originou esta
auditoria foi *"se deixou passar o nome, com certeza tem mais coisas"*, e amostragem é como o
nome tinha passado.

## Resultado

| | |
|---|---|
| mutações do app | 53 |
| já cobertas antes desta auditoria | 39 |
| **lacunas fechadas aqui** | **4** |
| fora do escopo por decisão, com motivo | 10 |

## As quatro lacunas fechadas

| app | agente (antes) | agente (agora) |
|---|---|---|
| `useSettleInvoice` — "Quitar sem caixa" | nada | `mark_paid` com alvo em `card_invoices` |
| `useSetDefaultAccount` | nada | `resource_update accounts is_default` |
| `useRestoreNote` | só apagava, nunca restaurava | `resource_update notes trashed=false` |
| `usePurgeNote` — esvaziar a lixeira | nada | `resource_delete` numa nota já na lixeira |

**Nenhuma custou orçamento de schema.** `FinanceAction` está no teto MEDIDO de 252/32 e a API
recusou as duas ampliações possíveis em 09/09/2026 — 19×14 = 266 (uma propriedade) e 18×15 = 270
(um valor de enum), as duas com `400 INVALID_ARGUMENT`. Por isso:

- **Quitar sem caixa é `mark_paid`, não um tipo novo.** O verbo já é o de dar baixa, e quem
  distingue é o ALVO resolvido (`card_invoices` em vez de `transactions`) — o mesmo desenho que
  `installment_plans` já usava. A fatura só entra na lista de candidatos quando o termo casa com
  o **nome do cartão**, então "marca a conta de luz como paga" continua achando só a conta
  prevista; casando os dois, vira empate e o usuário escolhe.
- **`is_default` e `trashed` são campos VIRTUAIS** do catálogo de `ResourceAction` (que segue em
  5×5, com folga de sobra). Não existe coluna com esses nomes: `prepare` traduz `is_default` para
  `workspaces.default_account_id` e `trashed` para `notes.deleted_at`, e o SQL nunca vê o nome que
  o modelo escreveu.

### Segurança: nada afrouxou

- **A confirmação continua derivada, não listada.** `needs_confirmation` devolve
  `"cadastro ou alteração estrutural"` para todo `ResourceAction` e `"alterar item existente"`
  sempre que há alvo resolvido. As quatro entram nessa regra **de graça** — nenhuma lista foi
  atualizada, que é exatamente o ponto de a regra ser derivada.
- **A frase do SIM distingue pagar de quitar.** Os dois terminam com a fatura "paga" e mexem no
  caixa de forma diferente, então `describe_for_confirmation` escreve *"marcar como paga, SEM
  tirar do caixa"*. Confirmar "a fatura do Nubank" não separava os dois efeitos.
- **Apagar de vez não lê igual a mandar para a lixeira.** O verbo da confirmação virou
  *"apagar DE VEZ (não dá para desfazer)"*; antes os dois diziam "excluir".
- **Escopo continua no código.** O serviço ignora RLS: `card_invoices` já estava na allowlist do
  `ensure_owned`, e `settle_invoice` (que é `security invoker`) é chamada com id já validado.
- **A conta padrão não repete a regra do banco.** O trigger `tg_workspaces_default_account`
  (`20260909035000`) já recusa cartão de crédito e conta arquivada; duplicar em Python criaria a
  segunda cópia que diverge. Desmarcar só zera se o padrão AINDA for aquela conta — senão "essa
  não é mais a padrão" derrubaria uma escolha feita no meio.

### Como foi medido

Dublê sempre concorda, então cada lacuna tem uma sonda contra o Gemini **real**:

| sonda | o que mede | resultado |
|---|---|---|
| `scripts/probe_settle_vs_pay.py` | 4 redações de quitar × 3 de pagar não se cruzam | 7/7 |
| `scripts/probe_app_parity.py` | a frase chega no campo virtual certo | 5/5 |
| `tests/test_settle_invoice.py` | a RPC certa, e a frase do SIM | 3 casos |
| `tests/test_resource_actions.py` | campo virtual sai de `values`; a lixeira é alcançável | 3 casos |

O cruzamento em `probe_settle_vs_pay` bloqueou o envio uma vez: *"marca a fatura do nubank como
paga, o dinheiro já saiu"* virava `pay_invoice`, que inventaria uma transferência. O prompt passou
a dizer que o verbo decide e que "o dinheiro já saiu" é passado, não agora.

## Edição com escopo (09/09/2026, mesmo dia)

Pedido do dono do produto logo depois desta auditoria: *"eu quero poder editar os valores, editar
completamente aquela parcela ou lançamento... posso editar somente aquele ou de todos as demais
parcelas futuras... Note que nao edita as passadas."*

O app ganhou a pergunta "Aplicar em: só esta / esta e as futuras" no salvar, e o agente **entrou
junto no mesmo lugar**: `update_transaction` com alvo numa compra parcelada era um beco
(*"você pode mudar as parcelas pagas ou excluir o plano"*) e passou a chamar
`public.update_transaction_scoped`, a MESMA RPC do botão. A frase da confirmação dizia o escopo —
*"só as parcelas em aberto; as pagas ficam como estão"*.

⚠️ **Isto mudou em 21/09/2026 (Task 3, "correção de compra parcelada sem menu"): o agente não
chama mais `update_transaction_scoped` para compra parcelada.** O menu ("Mudar parcelas
pagas"/"Excluir plano") saiu de vez; corrigir a COMPRA inteira (valor, nome, categoria) passa por
`update_installment_plan` (`finance._corrigir_plano`/`_renomear_plano`), e corrigir UMA parcela
sincroniza `installment_plans.total_cents` num UPDATE direto — ver "Reparcelar a compra"
abaixo, seção atualizada. `update_transaction_scoped` continua existindo para outros escopos
(ver a régua em `finance.md`), mas não é mais chamada pelo agente para plano nenhum
(`agent/app/tools/finance.py:925` registra o porquê).

| app | agente |
|---|---|
| escolher "esta e as futuras" no formulário, numa compra parcelada | `update_transaction` sobre a compra parcelada → `update_installment_plan` (valor/nome/categoria) ou UPDATE direto (uma parcela) |
| "Editar" no menu do plano | idem — a âncora é a primeira parcela EM ABERTO nos dois |
| "Editar" numa recorrência | `resource_update recurring` — roteado para `update_recurring_series` (isto não mudou) |
| "Só esta \| Esta e as próximas" no topo do lançamento de uma série (26/09/2026) | "Só esta": `update_transaction` sobre a ocorrência. "Esta e as próximas": `resource_update recurring` — valor/título/categoria/conta propagam pela RPC, e regra ou início pelo calendário da mesma `update_recurring_series`, que move a primeira em aberto de data (mesmo id) em vez de apagá-la |

A recorrência fechou no mesmo dia: `resource_update` sobre `recurring` já existia, mas fazia um
UPDATE só na REGRA. Como o `finance-scheduler` materializa 90 dias à frente e o unique
`(recurring_id, occurred_at)` impede reescrita, os três meses seguintes ficavam com o valor velho
e o quarto com o novo. Agora, quando o patch toca valor, categoria, descrição ou conta, a execução
cai na mesma RPC do botão do app; `active` segue no UPDATE normal.

> **Mudou em 26/09/2026** (`20260926120000`): a RPC passou a aceitar tipo, estabelecimento e o
> CALENDÁRIO (`rrule` + `next_run_at`, juntos). No app a série se edita inteira — Repete, A cada,
> Próximo vencimento, Tipo, Estabelecimento. No agente, `rrule`/`dtstart` e `kind` vão pela RPC
> (`resources._editar_serie`): o próximo vencimento é o início dito (ou a próxima ocorrência dele,
> se já passou) e a RPC refaz as futuras em aberto. Pelo UPDATE cru o calendário velho ficava
> materializado por um ano ao lado do novo. Regra fora do que o app monta (diária, vários dias
> da semana) é recusada com a frase da RPC. **Estabelecimento da série não está no catálogo do
> agente** — somar campo ao prompt de cadastros exige a rodada paga de `evaluate_answer_forms.py`;
> o agente segue gravando o nome da série, e a ocorrência herda o estabelecimento que a série já
> tiver.
>
> **Ordem de deploy:** a `20260926120000` antes do agente (o agendador passa a ler
> `recurring_transactions.merchant`, e a coluna ausente derruba a rodada do cron inteira) e antes
> do app (que lê a coluna na lista de Recorrentes).

## Fora do escopo — decisão, não esquecimento

**Revisão de importação de extrato** (`useImportStatement`, `useApproveImportItems`,
`useDiscardImportItems`, `useUpdateImportItem`, `useDeleteImportBatch`). Ingerir o arquivo o
agente já faz (OFX/CSV/PDF chegam como anexo). O que fica no app é a **revisão**, que é uma lista
de dezenas de linhas com caixinhas: "aprova tudo" por texto ou aprovaria o que a pessoa não leu,
ou exigiria ler a lista em voz alta no WhatsApp. O app é o lugar certo para isso.

**A conversa do agente dentro do app** (`useSendAgentMessage`, `useCreateAgentConversation`,
`useRenameAgentConversation`, `useDeleteAgentConversation`, `useResolveAgentPending`). É a
interface do próprio agente — ele operar isso é ele operar a si mesmo.

**Conta e dispositivo** (`useUpdateProfile`, `useRegisterPush`, `useSetAlertPreference`,
`useInviteMember`, `useRevokeInvite`). Não é financeiro: é administração de conta. `useRegisterPush`
nem faz sentido fora do aparelho (grava o token daquele device). Convite de membro dá acesso ao
dinheiro de outra pessoa e a porta certa para isso é a tela, não uma frase interpretada.

**Lembrete VINCULADO a uma nota** (`useSaveReminder` com `note_id`, 23/09/2026). "Criar lembrete"
no menu da nota grava `reminders.note_id` (um por nota), e a nota passa a oferecer "Editar
lembrete". O agente cria lembrete (`create_reminder`) mas sem vínculo: "me lembra da nota do
mercado amanhã" gera um lembrete solto, com o título que a pessoa disse. Lacuna declarada — o
vínculo pede resolver QUAL nota (alvo em `notes`) dentro de uma ação de lembrete, e `NotesAction`
não tem campo para isso; o custo é a nota não mostrar o lembrete criado pelo WhatsApp.

**Lembrete de CONTA** (`bill_reminders`, `save_bill_reminder`, 07/10/2026). "Lembrar" no lançamento,
na dívida, na fatura, na série e na compra grava avisos (dias antes + hora + canal) que o cron de
1 minuto entrega pelo vencimento ATUAL. O agente NÃO cria nem edita esse lembrete: "me lembra da
parcela do carro 2 dias antes" vira lembrete solto (`create_reminder`). Lacuna declarada — pede
resolver o registro-alvo dentro de uma ação de lembrete. Desde 09/10/2026 a tela de UMA parcela
do financiamento também tem "Lembrar" (Só esta / Todas as próximas), e o alvo mais específico de um
vencimento substitui o mais geral naquele vencimento (`20261009130000`).

**Apagar com alcance** (`delete_scoped`, `delete_scoped_preview`, 07/10/2026). No app, apagar uma
ocorrência de recorrente, parcela ou pagamento de financiamento pergunta "Só esta / Esta e as
próximas / Todas" (pelo contrato: "Das próximas em diante / Todas"; a dívida pela ficha: só
"Todas"; a vez de um lembrete: "Só esta / Todas"), numa RPC atômica com prévia do estrago; as parcelas que ficam
são renumeradas. O agente segue como antes (apaga a série inteira, a compra ou a dívida): "apaga o
aluguel daqui pra frente" é lacuna declarada.

**Pausar com prazo e carência** (`pause_recurring`, `resume_recurring`, `debt_pause`, 07/10/2026).
No app: "Pausar…" na recorrente (período [de, até), as ocorrências em aberto do período saem e
voltam no fim), no lembrete que repete (`paused_from/paused_until`) e "Pausar pagamentos…" no
financiamento (empurra o cronograma; com juros, capitaliza e recalcula a parcela). O agente NÃO
pausa com prazo nem dá carência — lacuna declarada; "pausa a academia" continua sendo a pausa sem
prazo (`active = false`).

**`useCancelSubscription` — decisão do dono do produto, não omissão.** A regra do domínio diz que
cancelamento é uma chamada sem formulário, porque dificultar cancelamento é a queixa nº 1 contra
os concorrentes. Pelo mesmo argumento, "cancela minha assinatura" pelo WhatsApp seria o caminho
mais honesto que existe. Não foi construído porque é cobrança, não finanças pessoais, e um
cancelamento disparado por interpretação errada é caro de desfazer. **Se for para construir, é
pedido explícito** — a confirmação já cobriria o risco.

## O que NÃO era lacuna (verificado, não presumido)

- `useDeleteInstallmentPlan`: `delete_transaction` com alvo em `installment_plans` chama
  `_apagar_plano`, que apaga o plano inteiro por cascade.
- `useToggleNotePin`, `useTrashNote`: `pinned` é coluna editável do catálogo e `resource_delete`
  em `notes` já era o soft delete.
- `useToggleRecurring`, `useToggleReminder`: `active` é coluna editável dos dois.
- Trocar a conta de uma parcela solta: o app permite o mesmo (`useSaveTransaction` não distingue),
  então não é diferença entre os dois — é uma decisão de produto igual dos dois lados.

## Mudanças no app depois da auditoria (09/09/2026)

A regra do `agent.md` é "botão novo no app = linha nova nesta tabela". Estas são as do mesmo dia.

| botão novo no app | o agente faz? | por onde |
|---|---|---|
| **Juros do Pix no crédito** (campo do formulário único `/finance/lancar`, grava compra + linha `juros` na mesma fatura) | sim, sem código novo | multi-intent: *"paguei 84,20 do DAS e 1,85 de juros do pix no crédito"* vira dois `create_expense`. `'juros'` entrou em `categories.py`, então a categoria sai igual dos dois lados. |
| **Pix no crédito para conta própria** (transferência saindo do cartão + juro, 28/09/2026) | **ainda não** | o caminho mecânico existe (`create_transfer` com o cartão de origem + `create_expense` do juro), mas medido no Gemini real *"fiz um pix no crédito de 340 pro itaú"* virou GASTO na conta Itaú. Falta o trecho de prompt em `docs/superpowers/plans/2026-09-28-pix-no-credito-conta-propria.md`, medido antes de entrar. |
| **Editar a série a partir de um lançamento** (linha "Repete …" no detalhe → `/finance/lancar`, tipo Recorrente) | sim, já fazia | `ResourceAction` em `recurring` propaga por `update_recurring_series` (fechado na própria auditoria). O que mudou foi só o caminho no app. |
| **Seletor de categoria com as usadas** (`categories_used()`) | não se aplica | categoria é texto livre no agente desde sempre — ele nunca esteve preso às 13 sugestões. A lacuna era só do app. |

**Nada disso mexeu no `FinanceAction`**, que segue no teto medido de 252/32.

## Receita prevista × recebida (09/09/2026, segunda leva)

| botão novo no app | o agente faz? | por onde |
|---|---|---|
| **"Recebi" na Hoje e na Projeção** | sim, já fazia | `mark_paid` com o lançamento como alvo. O que mudou foi `upcoming_bills` passar a devolver receita (`kind='income'`) e as telas pararem de cravar "Paguei". |
| **Interruptor "entra sozinho na data"** (`transactions.auto_confirm`) | **sim, e é campo do catálogo** | `auto_confirm` já existia em `recurring`; agora existe também na linha. `resources.py` propaga. Sem tocar no `FinanceAction` (teto 252). |
| **Alerta "Chegou o dinheiro?"** | é do agente, não do app | `_alerts_to_send` → `POST /cron/alerts`. O app só recebe o push. |
| **Menu do card de destaque** | não se aplica | navegação. |

**A dívida foi paga na mesma leva.** `query_balance` somava `balance_cents` (com previsto dentro)
E somava o cartão no mesmo total: com uma fatura aberta de R$ 21.360,00, o "Saldo total" respondia
**−R$ 16.070,00** — um número que não é o saldo de nada. Agora ele espelha a tela Contas: dinheiro
disponível (`cleared_cents`, contas não-cartão), investido, dívida de cartão à parte, e o previsto
como AVISO fora do total, com a ação junto ("me manda recebi").

⚠️ **Foi preciso corrigir nos DOIS lugares.** `supabase/functions/process-jobs/index.ts:961` tem a
sua própria cópia da mesma resposta, e a tabela `agent_routing` está vazia — ou seja, o caminho
Deno é o que responde hoje. `agent/tests/test_query_balance.py` prende os três defeitos com os
números reais do staging; a cópia Deno é a mesma aritmética, linha a linha.

---

# A outra metade: LEITURA — auditoria de 09/09/2026 (parte 2)

> Pedido do dono do produto: *"Corrija o agente completamente... ele tem que saber de tudo, mas
> cuidado com os guard rails e segurança de dados daquele user."*

A auditoria de cima enumerou as 53 **mutações** e parou aí. Leitura nunca foi auditada, e a
lacuna apareceu do jeito mais caro possível: o dono cadastrou um salário recorrente, ele não
apareceu no mês seguinte, e a pergunta natural — *"o agente saberia me ajudar com isso?"* — tinha
como resposta **não**.

Método igual: enumerar todo hook de leitura (`useQuery`/`useInfiniteQuery` em `src/hooks/`) e
casar com o caminho do agente.

## Resultado

| | |
|---|---|
| hooks de leitura | 47 |
| já cobertos | 27 |
| **lacunas fechadas aqui** | **3** |
| fora do escopo por decisão, com motivo | 17 |

## As três lacunas fechadas

| o app mostra | o agente (antes) | o agente (agora) |
|---|---|---|
| `useRecurringTransactions` — a tela Recorrentes | `resource_list recurring`, que devolve **só a descrição** | `query_recurring`: valor, regra em português, próxima data, data de fim e as pausadas |
| `useReminders` / `useTodayReminders` | criava e apagava; **não sabia listar** | `query_reminders`: título, hoje/amanhã/data, hora e recorrência, com filtro por termo e período |
| `useDebts` / `useDebtSchedule` / `usePayoffStrategy` | `resource_list debts`, só o nome | `query_debts`: saldo, principal, prestação, taxa mensal, parcelas pagas e vencimento |

**Por que `resource_list` não bastava.** Ele é `select {identity} from {tabela}` — por desenho,
devolve o rótulo e mais nada. Serve para "quais pastas eu tenho?"; não serve para nada que tenha
VALOR ou DATA, que é o que a pessoa pergunta sobre dinheiro.

**Nenhuma custou orçamento de schema, e o teto foi MEDIDO antes** (`scripts/probe_query_schema.py`,
09/09/2026): `FinanceQuery` 7×12 = 84 passa — ficamos em 7×11 = 77; `NotesAction` 9×8 = 72 passa e
é onde ficamos. Estimar aqui já custou uma quebra em produção (`ai-gemini.md`).

## O roteador precisou de uma linha

"quais minhas recorrências?" caía em **`cadastros`** — que tem `resource_list` e devolveria os
nomes secos, exatamente o defeito que esta auditoria fecha. A fronteira agora está escrita no
prompt do roteador: *perguntar VALOR, QUANDO cai ou QUANTO falta é `financas_consulta`;
`cadastros` é para MEXER no cadastro*.

## Segurança, uma linha por consulta

As três são leitura pura (`read_only=True`), não gravam idempotência e não passam por HITL.

| | escopo | id do modelo | tabela |
|---|---|---|---|
| `query_recurring` | `workspace_id = %s` obrigatório | nenhum | literal |
| `query_debts` | `workspace_id = %s` + `archived = false` | nenhum | literal |
| `query_reminders` | `workspace_id = %s` + `active = true` | nenhum | literal |

⚠️ **O serviço conecta com papel que IGNORA RLS**, então esse filtro é a única proteção que
existe — e por isso ele é TESTE, não vistoria: `tests/test_query_reads.py` falha se a cláusula
sair do SQL ou se o argumento deixar de ser `ctx.workspace_id`. Termo de busca entra
parametrizado (`ilike %s`), nunca concatenado.

## Fuso: o defeito que não dá para ver lendo o código

Todo instante vem do Postgres em **UTC** e o usuário lê em **America/Sao_Paulo**. Um lembrete das
23h30 de Brasília é 02h30 do **dia seguinte** em UTC: formatar o instante cru faria o agente
dizer *"amanhã"* para algo que toca hoje à noite. O mesmo vale para `recurring.next_run_at`, cuja
ocorrência costuma cair de madrugada — é quando o materializador roda.

Quem converte é `local_iso_date` / `local_now` com `ctx.timezone`, que já cai em
America/Sao_Paulo quando o profile não tem fuso. `tests/test_query_reads.py` prende os dois casos
com instantes que cruzam a meia-noite, e os dois testes foram **verificados falhando** com a
conversão removida — guarda que não morde não é guarda.

## Fora do escopo, com motivo

| hook | por quê |
|---|---|
| `usePlanStatus`, `useAiMonthStats` | paywall e telemetria: é o que COBRA pelo agente, não o que ele responde |
| `useImportBatches`, `useImportItems`, `useImportStatement`, `useUpdateImportItem` | fluxo de conferência de extrato, feito com o dedo numa lista |
| `useInvites`, `useWorkspaceMembers` | administração de workspace |
| `useProfile`, `usePushStatus`, `useAlertPreferences`, `useAlertsSent` | configuração do app |
| `useAgentConversations`, `useAgentMessages` | é a própria conversa |
| `useCategoriesUsed`, `useFirstTransactionYear`, `useGlobalSearch` | alimentam seletor e busca da UI |
| `useAnnualReport`, `useFinancialHealth` | alcançáveis por `query_transactions` com período e por `query_net_worth`; um tipo próprio seria enum gasto em pergunta que ninguém faz por texto |

## ⚠️ Isto só vale no APP enquanto o corte não acontecer

O chat de dentro do app fala **direto com o serviço Python** (`EXPO_PUBLIC_AGENT_URL` →
`/app/conversations`), então as três consultas novas valem lá assim que houver deploy.

O **WhatsApp não**: o roteador Deno lê `agent_routing.use_python_agent` pelo telefone e a tabela
está **vazia**, então quem responde continua sendo `process-jobs` em Deno, que não conhece nenhum
`query_*` novo. Ligar o número na `agent_routing` é o que faz o WhatsApp herdar tudo isto — e é
decisão do Gabriel, não consequência desta auditoria.

## Evidência da validação (09/09/2026)

| gate | resultado |
|---|---|
| `ruff check app --select F,E9` | limpo |
| `pytest` | **624** (eram 604; +20 em `test_query_reads.py`) |
| `npx tsc --noEmit` · `npm test` | limpos |
| SQL das três consultas contra o Postgres do **staging** | executado, com dado real — pytest usa dublê e o SQL nunca tinha rodado |
| `evaluate_answer_forms.py` (Gemini real) | **93/94** |

A única falha foi `confirmação/aprovar: 'sim, pode registrar'`. Reexecutada a seção inteira
(`--secao confirma`): **26/26**, incluindo o caso exato. Nada nesta mudança toca `domain/confirm.py`
nem o `GEMINI_GATE` — é variação do modelo, não regressão. **A seção de segurança passou inteira**,
que é o lado que não pode cair: aprovar o que não devia apaga dado do usuário.

---

# "E se…?" — a terceira leva (10/09/2026)

> A tela de Projeção ganhou o simulador de cenário em 10/09/2026 e **subiu sem linha nesta
> tabela** — que é exatamente o que a regra do `agent.md` existe para impedir. A auditoria de
> 09/09 cobriu MUTAÇÃO; leitura entrou na parte 2; **feature de leitura NOVA escapou das duas.**

| o que a tela faz | o agente fazia? | agora |
|---|---|---|
| supor um **GASTO** parcelado | sim, por `simulate_purchase` → `_affordability` | `simulate_scenario` → `_forecast_with_drafts` |
| supor uma **RECEITA** | **não** — `_affordability` crava `'kind','expense'` | `kind='income'` |
| hipótese que **REPETE todo mês** | **não** — só `total`, que reparte | `mode='monthly'` |
| escolher **QUANDO** começa | **não** — cravava `current_date` | `query_from` |
| **EMPILHAR** hipóteses | **não** — array de um elemento | as ações irmãs do plano somam numa resposta só (`ExecContext.siblings`) |
| ver a **série** | **não** — só veredito + pior dia | veredito no 1º dia negativo + saldo no fim |
| **hipótese com conta e forma**, o **"Onde muda"** por conta e cartão e o **Aplicar** pelo formulário completo (29/09/2026) | não | **só no app, por decisão**: o agente segue com `simulate_scenario` (visão geral); criar de verdade ele já faz pelos caminhos de sempre |

## O número podia discordar, e discordava por construção

Não era só capacidade faltando: para a hipótese **idêntica**, o agente e a tela davam respostas
diferentes. Três causas, todas medidas na produção em 10/09/2026:

1. **Janela.** `_affordability` filtra `day <= add_months(current_date, parcelas)` — numa compra
   à vista, **um mês**. O pior ponto em 1 mês era **−3.547,28** (04/10); no horizonte da tela,
   **−3.781,13** (04/11). O agente enxergava R$ 233,85 a menos de buraco — e é esse delta que
   vira "✅ Cabe" numa conta que não está negativa.
2. **Pior ≠ primeiro.** `_affordability` devolve o **mínimo** da série (`order by balance_cents
   limit 1`); a tela avisa no **primeiro dia negativo** (`serie.find`). Mesma hipótese: agente
   dizia 04/11/2026, tela dizia 10/09/2026.
3. **A tela abandonou o `affordability` no mesmo dia.** `useAffordability` ficou com **zero**
   chamadas — o veredito passou a sair de `primeiroNegativo` sobre a série. O agente ficou
   sozinho num caminho que o app já não usava.

⚠️ **`affordability` e `_affordability` continuam existindo e intactas.** APK antigo em campo
ainda chama `rpc('affordability')`, e `useAffordability` fica no `use-finance.ts` por isso —
apagar o hook convidaria a apagar a RPC junto, que é a regressão silenciosa clássica: quebra só
para quem não atualizou.

## O schema coube, e isso foi MEDIDO

`FinanceQuery` foi de **8×11 = 88** para **10×11 = 110**, com `kind` e `mode`.
`scripts/probe_scenario_schema.py` (Gemini real) provou **121** — sobra uma propriedade.
`query_from` e `query_to` fazem dobradinha como início da hipótese e horizonte: o probe mostra
que campos próprios caberiam, então reusar é decisão, não aperto — dois campos com a mesma forma
e o mesmo sentido seriam a duplicação que diverge.

`SIMULATE_PURCHASE` virou `SIMULATE_SCENARIO`. O nome antigo era um **prior forte** para o
modelo: *"e se eu receber 1.500 por mês?"* nunca casaria com algo chamado *purchase*, caía em
`query_forecast` — que roda a projeção **real**, ignora a premissa e devolve um número confiante
que responde outra pergunta. Era o defeito mais caro dos seis, porque não parece defeito.

## Qual metade do conserto é que segura — medido, não suposto

`scripts/probe_scenario_routing.py` roda as perguntas contra o Gemini real (o pytest usa dublê,
e dublê sempre concorda). Três formas, os mesmos casos:

| forma | resultado |
|---|---|
| **antes** (`simulate_purchase`, sem `kind`/`mode`, prompt antigo) | **3 de 4 hipóteses de receita caem fora** — *"e se eu passar a receber 1.500 por mês, fico no vermelho?"* vai para `query_forecast` com `amount_cents=None`, e *"supondo que eu ganhe 2 mil a mais"* não gera ação nenhuma |
| **nome e campos novos, prompt ANTIGO** | 3/3 certos |
| **tudo novo** | **10/10** (7 hipóteses + 3 perguntas sem hipótese, que têm que continuar em `query_forecast`) |

⚠️ **A alavanca é o NOME do tipo e a existência de `kind`/`mode` — não a prosa do prompt.** A
linha do meio prova: com a redação antiga, mas o enum chamado `simulate_scenario` e os campos
disponíveis, o modelo já acerta. O texto que foi somado ao prompt é cinto e suspensório, e é
honesto dizer isso: se um dia alguém precisar cortar prompt por token, é ele que sai, não o nome.

## Adiar a fatura para a próxima — FECHADA (11/09/2026)

`useRollInvoice` ("Jogar para a próxima", o rotativo) nasceu só no app e ficou um dia como lacuna
declarada. O agente faz desde 11/09: **`resource_roll`**, `resource=cards`, o nome do cartão e
nenhum campo.

| app | agente |
|---|---|
| `useRollInvoice` — "Jogar para a próxima" | `resource_roll cards <nome>` |
| `useSetCycleCloseDay` — Perfil → Meu mês | `resource_update mes cycle_close_day` |
| campos de rotativo do cartão | `resource_update cards rotativo_auto / rotativo_rate_monthly` |

As duas últimas linhas eram lacunas que **nunca tinham sido declaradas** — a regra desta página é
que botão novo vira linha aqui, e as duas passaram batido quando o ciclo e o rotativo entraram.

### O argumento que caiu, e o que ficou de pé

A versão de 10/09 rejeitava as duas saídas baratas. **Uma das duas rejeições estava errada:**

- ~~"Não é campo de `ResourceAction`. O catálogo escreve COLUNA; aqui o efeito é uma RPC."~~
  **Falso, e já era falso quando foi escrito.** `resource_pay` chama `public.pay_debt_installment`
  e não escreve coluna nenhuma (`resources.py`). O catálogo nunca foi "só coluna" — ele é o lugar
  das operações que não cabem no orçamento de `FinanceAction`, e uma RPC cabe nele tanto quanto
  um UPDATE. `resource_roll` é o 6º valor do enum: **5×6 = 30**, contra o teto de 252/32 de
  `FinanceAction`, onde não cabia nada.
- **"Não é alvo novo de uma ação existente" continua de pé, e foi respeitado.** Adiar NÃO virou
  alvo de `mark_paid`. Medido com o Gemini real em 11/09 (`scripts/probe_mes_vs_cartao.py` e o
  router): "paguei a fatura", "paguei 800 da fatura", "já tinha pago" e "quitei" vão os quatro
  para `financas`; "joga pra próxima", "adia", "não vou conseguir pagar esse mês" e "deixa pro
  mês que vem" vão os quatro para `cadastros`. 8/8 e 17/17 — os três verbos não se cruzam.

### O que a confirmação diz, e o que ela não promete

A frase do SIM traz o **principal** e avisa que juros e IOF entram junto — mas **não promete o
número deles**. `roll_invoice` só devolve `juros_cents`, `iof_cents` e `taxa_usada` depois de
executar, e recalcular a fórmula em Python seria a segunda cópia de duas regras que não são
nossas: o IOF é lei (Decretos 12.466/2025 e 12.499/2025) e a taxa sai de
`private.rotativo_rate_for`, que **aprende** do histórico do próprio cartão.

Isso não é limitação do agente: **a tela faz exatamente igual** — pergunta "Jogar R$ X para a
próxima fatura?" e detalha no toast depois, com o comentário dizendo por quê ("o que interessa é
o que ENTROU na próxima fatura, e isso a pessoa confere na fatura seguinte").

Os três avisos da RPC chegam ao usuário: `sem_taxa` ("não estimei juros"), `juros_estimados` (com
a taxa que os gerou, porque dizer "estimados" sem dizer com que taxa é pedir confiança cega) e
`segundo_ciclo` ("essa fatura já carregava saldo adiado").

### O que ficou de fora, e por quê

Fatura que **ainda não venceu** não é adiada — a mesma regra da tela (`invoice/[id].tsx`: "adiar
só faz sentido depois do vencimento"). A recusa diz a data do vencimento, em vez de só negar.

---

## "Todo último dia do mês" (13/09/2026)

O campo **"Vence quando"** (Dia do mês | Último dia) saiu do formulário de recorrentes: a data
escolhida passou a decidir sozinha. 31/10 é o último dia de outubro, então grava
`FREQ=MONTHLY;BYMONTHDAY=-1`; 05/10 grava `BYMONTHDAY=5`.

**Isso mudou o que o APP produz, então o agente tinha que aprender a mesma forma.** Um botão novo
não foi somado — mas uma forma de dado nova foi, que é a outra metade da mesma regra ("botão novo
no app = linha nova nesta tabela").

| ponta | estado | o que foi feito |
|---|---|---|
| `clean_rrule` (`tools/guards.py`) | **já aceitava** | o regex permite `-` nos valores. Teste somado para prender (`test_guards.py`) |
| `descreve_rrule` (`domain/recurrence.py`) | **não sabia** | dizia *"todo dia -1"* no WhatsApp enquanto o app escrevia "todo último dia do mês". Ramo somado, espelhando `src/lib/rrule-text.ts`, com dois casos em `test_query_reads.py` |
| prompt (`graph/prompts.py`) | **não ensinava** | só `BYMONTHDAY=5`. Agora ensina `-1` para "fim de mês", com o aviso de que **31 não é sinônimo** |
| schema (`graph/schemas.py`) | **não ensinava** | mesma coisa na descrição do campo `recurrence` |
| projeção (`recurring_projection_for`) | **rejeitava** | filtrava `BYMONTHDAY=[0-9]+`, sem o sinal de menos — série "último dia" **não projetava nada**. Migration `20260913170000`, com `supabase/tests/ultimo_dia_do_mes.sql` |

⚠️ **A ponta que quase passou batido foi a projeção.** A migration `20260910140000` justifica o
"falha fechada" dizendo que `-1` era 0% da produção; tornar `-1` o padrão do formulário inverte
essa premissa. Removido o campo sem o SQL, a recorrência de fim de mês sumiria da projeção sem
erro nenhum — dinheiro faltando em silêncio, que é a classe de bug mais cara deste produto.

## A tela de Notas ganhou organização (14/09/2026)

A aba Notas passou a ter pin de pasta, cor, arquivar, ordem manual, tag de pasta e ícone
(migration `20260914180000`). Pela regra do `agent.md` — *botão novo no app = linha nova nesta
tabela* —, cada um deles entra aqui.

| botão novo no app | o agente faz? | por onde |
|---|---|---|
| `useToggleFolderPin` | sim | `resource_update folders pinned` |
| `useSetNoteColor` / `useSetFolderColor` | sim | `resource_update … color`, com o nome do TOKEN (`oceano`) — a pessoa fala "azul" e o catálogo traduz |
| `useArchiveNote` / `useArchiveFolder` (e desarquivar) | sim | `resource_update … archived=true/false`, campo **virtual** traduzido para `archived_at` |
| `useSetFolderTags` | **parcial** | `resource_update folders tags` ACRESCENTA; tirar uma tag continua sendo do app (ver abaixo) |
| ícone da pasta (`folders.tsx`) | sim | `resource_update folders icon`, com os nomes em português aceitos ("maleta", "carrinho") |
| "Nova pasta" no "…" da aba Notas e "Nova subpasta" no menu da pasta (`NovaPastaSheet`, 25/09/2026) | sim | `resource_create folders` — com `parent_id` ("cria a pasta viagem dentro de trabalho"); o mesmo `useSaveFolder` de "Organizar pastas", agora à mão onde a pessoa está |
| Criar e editar ONDE a coisa está (25/09/2026): "Editar este cartão"/"Novo cartão" na Carteira, "Nova compra neste cartão"/"Editar cartão" na fatura e em Faturas, "Editar/Arquivar cartão" em Cartões, "Editar conta" nos lançamentos de uma conta, "+" em Parceladas, editar/arquivar bem em Patrimônio, "Apagar pasta" dentro da pasta, "Lançar" na Hoje | sim — nenhuma mutação nova: são portas para `resource_update/archive accounts`, `create_expense` (com a conta dita), `resource_update assets`, `resource_delete folders` e os lançamentos/lembretes/notas que o agente já cria |
| `useReorderNotes` / `useReorderFolders` | **não — exclusão declarada** | ordem manual é GESTO, não frase: "põe a nota do mercado em terceiro" pede que a pessoa conheça a numeração de uma lista que ela está vendo, e arrastar já resolve em um movimento. O que o agente faz é FIXAR, que é a mesma intenção ("deixa isso no topo") dita em palavras. |

**Nada disso custou orçamento de schema.** `ResourceAction.resource` é `str` e `color`/`icon`
viajam como VALOR de campo: o produto propriedades × enum do schema não se mexeu, e
`tests/test_schemas.py` prende isso. O que cresceu foi o texto do prompt, que não tem esse teto.

### Três correções que vieram junto

- **Nota se identifica pelo TRECHO.** `resource_update` em `notes` procurava `content = %s`
  **exato** — ou seja, "fixa a nota do mercado" nunca achava nada, e metade do catálogo novo
  nasceria inalcançável por voz. Agora tenta o exato e cai num `ilike`; **empate PERGUNTA**, com
  a primeira linha de cada candidata na frase. Nota é a única exceção do catálogo: todo o resto
  tem nome curto e digitável.
- **`query_notes` ordena por `pinned desc`** e esconde arquivada. Sem isso o "topo" do agente e o
  topo da tela discordavam — a pessoa fixa uma nota, pergunta "o que eu anotei?" e recebe outra
  lista, sem erro nenhum.
- **`QUERY_REMINDERS` virou `READ_ONLY`.** Uma leitura pura reservava e liberava slot de
  idempotência em `executed_actions` a cada "quais meus lembretes?".

### Lacuna declarada: tirar uma tag

`tags` SOMA. Gravar só o que veio na frase apagaria em silêncio as outras tags da pasta, e a
confirmação ("tags: urgente") não daria pista nenhuma disso. Remover exige dizer QUAL sai, e o
catálogo tem um campo por coluna, não uma operação por campo — o `TagPicker` do app resolve com
um toque. Se virar pedido, o caminho é um campo virtual `untag`, sem custo de schema.

### O formato do texto é do agente também

O `NOTES` ensina a escrever no formato que o app DESENHA: enumeração vira `- ` (ou `- [ ] `
quando é coisa a fazer), passo a passo vira `1. `, título vira `# `, e ênfase usa a marcação do
WhatsApp (`*negrito*`), que é a mesma que o editor lê e escreve. Medido no staging em 14/09/2026:
*"anota na pasta ia: testar o agente, revisar o prompt e medir o custo"* virou três linhas
`- [ ]` dentro da pasta `ia` — que já existia, porque as pastas do workspace entram no turno
(delimitadas por `wrap_untrusted`, que nome de pasta é conteúdo do usuário).

## Reparcelar a compra (15/09/2026) — ATUALIZADO em 21/09/2026 (Tasks 3 e 4)

O app ganhou **`useUpdateInstallmentPlan`** — o sheet "Editar a compra" de Parceladas, que grava
total, número de parcelas, título, estabelecimento, categoria, conta e data da primeira pela RPC
`update_installment_plan`. Em 15/09/2026 a linha abaixo dizia "exclusão declarada" para quase
tudo, por causa do teto de 252 do `FinanceAction`. **A Task 3 entrou por outro caminho: sem campo
novo**, reaproveitando `new_amount_cents`/`new_description`/`new_category` que já existiam, e uma
pergunta extra ("é o total ou cada parcela?") para decidir a unidade — que é `choice`, não schema.
Botão novo, linha atualizada:

| botão novo no app | o agente faz? | por onde |
|---|---|---|
| `useUpdateInstallmentPlan` — **nome, estabelecimento e categoria** da compra | sim | `update_transaction` sobre a compra parcelada, sem valor → `finance._renomear_plano` (UPDATE direto no plano e em todas as linhas, inclusive as pagas; não mexe em dinheiro, data nem conta). **Não é mais `update_transaction_scoped`** — ver a seção acima. |
| `useUpdateInstallmentPlan` — **total** (valor) | **sim, desde 21/09/2026 (Task 3)** | `update_transaction` sobre a compra parcelada, com valor → pergunta "é o total da compra ou cada parcela?" (`interrupt` `kind=choice, purpose=amount_unit`); a resposta some no alvo (`amount_unit`) e `finance._corrigir_plano` chama `update_installment_plan` com o MESMO número de parcelas, redistribuindo só o saldo em aberto (`agent/app/tools/finance.py:1033`). |
| `useUpdateInstallmentPlan` — **número de parcelas, conta e data da 1ª parcela** | **sim, desde 21/09/2026 (virou pedido)** | `update_transaction` sobre a compra inteira: `installments` diferente do N atual (2..72), `new_account`, `new_occurred_at` — sem campo novo. `finance._corrigir_plano` chama `update_installment_plan` com os 8 argumentos atuais trocando só o pedido. Recusado antes do SIM com qualquer parcela travada (`plano_travado`, a regra 2 da RPC). A conta que a compra JÁ tem, citada, é descrição e não troca. A frase do SIM mostra o contrato novo ("de 10x para 12x de R$ 250,00"). |
| `useUpdateInstallmentPlan` — **"À vista" (`p_installments = 1`, dissolve o plano)** | **sim, desde 21/09/2026** | `update_transaction` com `installments = 1` sobre a compra parcelada (sem campo novo) → `finance._desparcelar` chama `update_installment_plan(plano, total atual, 1, data real da parcela 1, …)` com os 8 argumentos atuais; a parcela 1 fica com o total e o MESMO id. Recusado ANTES do SIM (também depois da escolha num empate de duas compras): parcela travada (`private.parcela_travada`, congelada pelo resolvedor), valor novo junto (mensagem neutra, o 1 pode ser ruído), data/conta. No empate a pergunta já diz o efeito ("volta a ser à vista num lançamento só. Qual delas?") e, escolhida a compra, o SIM diz total, data da parcela 1, cartão e quantas parcelas viram uma. Antes, "desparcela a compra da tv" virava `delete_transaction`. |
| `useConvertToInstallments` (20/09/2026) — parcelar um lançamento QUE JÁ EXISTE, pela RPC `convert_transaction_to_installments` | **sim, desde 21/09/2026 (Task 4)** | `update_transaction` com `installments >= 2` sobre um lançamento AVULSO (não é parcela de plano nenhum) → `finance._parcelar` (`agent/app/tools/finance.py:1052`). **Cartão é obrigatório** (`cartao.get("id")` senão `CARTAO_FALTANDO`, read_only) e resolvido só entre cartões (`resolve.conversoes`/`_cartao_citado`); **sem rascunho** para essa pergunta — exclusão declarada em `_cartao_citado` (a pessoa remanda a frase com o nome do cartão). |

⚠️ **Mudar N deixou de ser exclusão em 21/09/2026.** O motivo antigo — *"refaz a nuuvem em 3x"*
reescreve N linhas, algumas em faturas já emitidas, sem o contrato na tela — é resolvido pelas
duas travas que já existiam: com QUALQUER parcela travada o N não muda (recusado antes do SIM,
como na RPC), e sem trava nenhuma parcela está em fatura fechada; a frase do SIM mostra o
contrato novo numa linha ("de 2x para 3x de R$ 34,99 (a última acerta os centavos)").

**O que o agente NÃO perdeu:** apagar a compra inteira (`delete_transaction` com alvo em
`installment_plans`) e renomear a série continuam funcionando, e continuam sendo duas das coisas
que as pessoas pedem por voz — ao lado, agora, de corrigir o total e de parcelar um lançamento
avulso.

## Financiamento maleável (23/09/2026)

Spec: `docs/superpowers/specs/2026-09-23-financiamento-maleavel-design.md`. Botões novos no app,
cada um com o caminho do agente (tudo pelo catálogo de `ResourceAction` — `FinanceAction` segue no
teto de 252):

| app | agente |
|---|---|
| "Primeira parcela" (cadastro) / "Próxima parcela" (edição) | `first_due_date` no cadastro; na edição, `next_due_date` (campo virtual) vira `first_due_date = próxima − pagas`, como no app. O `due_day` sai da data quando não foi dito |
| editar parcela, nº de parcelas e pagas de um contrato FIXO, mesmo com "Paguei" lançado | `resource_update` com `installment_cents` / `installments` / `installments_paid`: principal e saldo são rederivados (`_derive_fixed_installments`); principal, saldo e taxa diretos continuam recusados, porque saem da parcela. A trava "já tem pagamento registrado" caiu nos dois lados (decisão do dono do produto: libera e recalcula). O piso das pagas é o número de pagamentos LANÇADOS, nos dois lados — abaixo dele o próximo "Paguei" repetiria um número de parcela |
| "Arquivadas" + Desarquivar | `resource_update debts archived=false` — a busca por nome de `debts` nunca filtrou `archived` |
| "Excluir por completo" | `resource_delete debts` com `trashed=true` → `public.delete_debt` (pagamentos + dívida numa transação), com `workspace_id` e `xmin` conferidos no SIM; a frase conta os pagamentos e o valor que voltam ao saldo. Sem `trashed`, `resource_delete` continua ARQUIVANDO |

**Ordem de deploy:** as migrations `20260923160000` e `20260923170000` vêm antes do agente — sem ela `delete_debt` não
existe e o `first_due_date` bate numa coluna que não há.

## Tudo que se cria se edita (26/09/2026)

Regra do dono do produto para o app inteiro (`frontend.md`). O que cada botão novo de editar ou
desfazer é no agente — `FinanceAction` segue no teto de 252, então nada disto somou campo lá:

| app | agente |
|---|---|
| Parcela: "Só esta parcela \| A compra toda" e os campos da criação (`CamposDaCompra`) | "Só esta": `update_transaction` sobre a parcela. "A compra toda": `update_transaction` sobre a compra → `update_installment_plan`, com as MESMAS travas novas do banco (`TRAVAS_DO_PLANO`: nº de parcelas muda com parcela paga, nunca abaixo da última paga; data e conta só sem parcela em fatura paga/adiada/paga em parte) |
| "Parcelas já pagas" na edição da compra e ao parcelar um lançamento que existe (`p_paid_installments`) | `update_transaction` sobre a compra com `already_paid_count` (o campo só mudou de descrição — o teto de 252 não mexe): "na verdade só paguei 2 da tv" → a MESMA `update_installment_plan` com o 9º argumento, para mais ou para menos. A frase do SIM diz quais voltam a previstas ou recebem baixa; abaixo das pagas junto com uma fatura de verdade é recusado antes do SIM (`piso_pagas`). "paguei a 3ª parcela" continua `mark_paid` |
| Modo da dívida (parcela fixa ↔ com juros) na edição | `resource_update debts calculation_mode` → `_converter_modo_da_divida` (a trava do agente caiu junto com a do banco) |
| Pagamento de dívida: editar valor/data e apagar QUALQUER um | `update_transaction` / `delete_transaction` sobre o pagamento — o trigger da dívida refaz o saldo (`20260926140000`) nos dois caminhos |
| Orçamento: editar categoria e alcance ("Vale para") | `resource_update budgets` com `category`/`month`; trocar o alcance MOVE o limite como o `edit_budget` do app (`_editar_alcance_do_limite` — a RPC acha o espaço pelo `auth.uid()`, que o agente não tem) |
| Meta: aporte com data, e editar um aporte já feito | `goal_deposit` já recebia a data. Editar: `resource_update goals` com os campos virtuais `aporte_do_dia` (ou `ultimo`), `novo_valor_do_aporte`, `nova_data_do_aporte`, `nova_nota_do_aporte` → `edit_goal_contribution`. Mora no cadastro da meta porque `update_transaction` com `target_ref` voltava SEM os valores no Gemini real, em toda redação medida (`scripts/probe_tudo_se_edita.py`) |
| Conta: tipo troca entre corrente/poupança/dinheiro/investimento; cartão: fechamento e vencimento refazem as faturas abertas | `resource_update accounts type` (a recusa caiu); `resource_update cards closing_day/due_day` — o trigger do banco refaz as faturas nos dois caminhos |
| Pagamento da fatura: editar e apagar (a fatura acompanha) | `update_transaction` / `delete_transaction` sobre o pagamento — o trigger `sync_invoice_payment` refaz `paid_cents` e o status. A recusa da fatura adiada chega escrita (`registry.execute` traduz o P0001 de trigger) |
| "Desmarcar como paga" e "Desfazer adiamento" na fatura | `resource_update cards` com `fatura_paga=false` / `fatura_adiada=false` (campos virtuais, simétricos ao `resource_roll`; `target_month` escolhe o mês) → `unsettle_invoice` / `unroll_invoice`. Fatura paga COM pagamento manda apagar o pagamento; cartão que adia sozinho e fatura seguinte já paga são recusados antes do SIM |
| Recorrente: regra do WhatsApp aparece por extenso e se troca num "Substituir" | não se aplica: é a tela não mentir sobre uma regra que o agente escreveu |
| Importação: título da linha editável na prévia | fora do escopo (revisão de extrato é do app, ver abaixo) |

**Medido no Gemini real** (`scripts/probe_tudo_se_edita.py`, 26/26 no Flash-Lite; e as seções de
extração de `evaluate_answer_forms.py`). **Ordem de deploy:** migrations `20260926120000`…`20260926180000` antes do agente e do app
(o agente chama `unsettle_invoice`, `unroll_invoice` e o 9º argumento de `update_installment_plan`). Sem a
`20260926180000`, o app lê `transactions.pays_invoice_id` (coluna ausente → a fatura não abre) e
chama `unsettle_invoice`/`unroll_invoice` (ausentes).

## Pagar com o valor que de fato saiu (25/09/2026)

Pedido do dono do produto: *"às vezes eu posso ter pago menos ou mais em uma parcela, dívida ou
lançamento"*. `FinanceAction` segue no teto de 252: o valor pago reusa `new_amount_cents`.

| app | agente |
|---|---|
| "Paguei"/"Recebi" confirma o valor (folha "Quanto saiu?", `useConfirmarBaixa`) | `mark_paid` com `new_amount_cents` — *"paguei a luz, foi 230"* (sonda `probe_baixa_com_valor.py`, 5/5 no Gemini real). Numa conta prevista `amount_cents` também serve (`policy.valor_pago`: a busca de `pendentes` é só por texto). O SIM diz "com R$ 230,00 pagos" e a tool grava valor e baixa numa escrita, com a trava `parcela_travada`. UMA parcela de compra também (`_baixa_em_parcelas`, total do plano junto); várias parcelas com valor, ou fatura quitada fora do app com valor, são recusadas antes do SIM. |
| "Usar este valor nas próximas" (série) | recorrente: `resource_update recurring` com o valor, que propaga por `update_recurring_series` (já fazia); parcela de compra: `update_transaction` sobre a compra inteira (já fazia). |
| Pagar parcela FIXA com outro valor (folha de Dívidas) | `resource_pay debts` com o valor pago: o SIM diz "conta como 1 parcela, com R$ X de encargo/desconto" e os limites do trigger (metade até menos do dobro) viram pergunta antes do SIM. |
| "Usar este valor nas próximas" na dívida, e "Este e as próximas parcelas" ao editar um pagamento | `resource_update debts installment_cents` (principal e saldo rederivados, já fazia). Só o pagamento: `update_transaction` sobre ele — o trigger calcula o encargo. Mudando o contrato ANTES e corrigindo o pagamento mais recente para o valor novo, ele vira a parcela inteira, sem encargo (`20260925140000`), nos dois caminhos. |
| Formulário de pagamento de dívida sem tipo, sem "vou pagar depois" e sem cartão | não se aplica: é trava de tela para o que o trigger da dívida sempre recusaria. |

**Ordem de deploy:** as migrations `20260925120000`, `20260925130000` e `20260925140000` antes
do agente e do app — sem a primeira o banco recusa qualquer valor diferente da parcela fixa (o
trigger antigo), e a frase do SIM prometeria um encargo que o banco não aceita. Sem a terceira
nada quebra: "Este e as próximas" só grava o pagamento com o encargo, como antes. A `20260925150000`
vai junto (independe de agente e app): apagar o pagamento mais recente de parcela fixa depois de
editar o contrato era recusado — visto em produção no mesmo dia.

## Dicas no lugar e "Como usar o ProOps" (24/09/2026)

Spec: `docs/superpowers/specs/2026-09-24-dicas-e-guia-design.md`.

| app | agente |
|---|---|
| "Entendi" das dicas, "Mostrar" do guia, "Conhecer o app" nos Primeiros passos | **não — exclusão declarada.** Não é mutação: nada vai ao banco. É ajuda sobre GESTOS da tela (arrastar, tocar no painel, deslizar o cartão), guardada no aparelho (`dicas:<userId>`). Pela conversa a pergunta equivalente ("o que dá para fazer?") já é respondida pelo nó `geral` |

## Previstas na lista e "último dia" em tudo que se repete (28/09/2026)

`docs/bugs/2026-09-28-previstas-na-lista-e-ultimo-dia.md`.

| app | agente |
|---|---|
| Tocar / "Paguei" / "Editar" numa recorrente PREVISTA em Lançamentos (`materialize_recurring_occurrence`) | `mark_paid` / `update_transaction` como sempre: antes de procurar o alvo, `nodes._ocorrencias_gravadas` pede ao agendador as séries NUNCA gravadas daquele espaço (`materialize_horizon(so_novas=True, workspace_id=…)`, o mesmo código do cron). Fecha o staging (sem cron) e o minuto antes do cron. Falhando, o turno segue como antes. **Fica de fora** a ocorrência além do horizonte de um ano. |
| "Apagar" numa prevista (`skip_recurring_occurrence`) | `delete_transaction` sobre a ocorrência (gravada pelo passo acima) chega ao mesmo lugar: o gatilho `ocorrencia_apagada_nao_volta` marca a data, e o agendador a respeita. |
| Data de pagamento de dívida com "Este e os próximos"/"Todos" → dia do contrato e pagamentos do alcance (`update_debt_payment_due_day`) | `resource_update debts due_day` (-1 = último dia) muda o contrato; a data de um pagamento, `update_transaction`. São dois pedidos na conversa, não um. |
| "Último dia de todo mês" na compra parcelada fora do cartão (`*_last_day`) | Correção da compra: `update_transaction` com `recurrence="FREQ=MONTHLY;BYMONTHDAY=-1"` (sem campo novo — o schema está no teto). A política recusa no cartão antes do SIM e a frase diz "parcelas no último dia de cada mês"; a tool grava `update_installment_plan` + `private.parcelas_no_ultimo_dia` numa instrução só. CRIAR parcelada pelo agente continua só no cartão, onde o último dia não vale. Sonda: `scripts/probe_parcelas_no_ultimo_dia.py`. |

## Mudar o tipo de um registro (29/09/2026)

Spec: `docs/superpowers/specs/2026-09-29-formulario-unico-e-categorias-design.md` (o formulário único, `/finance/lancar`).

| app | agente |
|---|---|
| Editar um registro, trocar Uma vez \| Recorrente \| Financiamento e salvar: Converter / Só esta / Desta em diante / Todas, apagando as anteriores / Manter e criar um novo (`converter_registro`) | **não — só no app, por decisão.** O agente não converte: pela conversa o mesmo resultado sai em dois pedidos que ele já faz (criar o registro novo; apagar ou editar o antigo), cada um com o SIM dele. Juntar os dois numa ação exigiria campo novo em `FinanceAction`, que está no teto de 252, e a opção "Todas" apaga o que já foi pago — caminho destrutivo que a tela confirma à parte |
| Categorias: criar, dar ícone e cor, renomear, juntar e apagar (tela Categorias; `save_category`, `rename_category`, `delete_category`) | **não — só no app.** O agente grava o NOME, como sempre (texto livre), e a aparência vem sozinha da tabela `categories`. Renomear e juntar reescrevem sete colunas de uma vez e perguntam antes de juntar; trazer isso para a conversa exigiria campo novo em `FinanceAction` (teto de 252) |

## Criar conta ou cartão durante o lançamento — F02 (02/10/2026)

| app | agente |
|---|---|
| "Criar conta" / "Criar cartão" no seletor de origem de `/finance/lancar` | O cadastro já existe por `resource_create accounts` / `resource_create cards`. O novo subfluxo preserva o formulário montado e seleciona a entidade confirmada; esse comportamento de tela não cria uma ação conversacional. |
| "Cancelar cadastro" / "Verificar cadastro" no formulário contextual | Controles da tentativa local: cancelar conserva o lançamento; verificar reutiliza o mesmo UUID e payload de `create_account`. O agente mantém seu fluxo atual de confirmação; não usa essa nova RPC. |

O app passa a criar contas por `useCreateAccount` → `create_account`, com recibo idempotente
e retorno da disponibilidade atual da entidade. A edição continua em `useSaveAccount`.
O agente conserva suas escritas e proteções existentes; a idempotência dessa RPC do app
não certifica um contrato novo para o agente. Nenhum campo de `FinanceAction`, prompt ou
tool foi alterado no F02, e não foi executada uma nova sonda de criação no Gemini real.

Contrato e evidência: `docs/qa/2026-10-02-evolucao-financeira/f02/`.

## Reserva dedicada — F07 (03/10/2026)

| app | agente |
|---|---|
| Configurar/editar base essencial, horizonte e valores separados de contas/investimentos (`save_emergency_reserve`) | **Fica só no app, por decisão (Lote D, 05/10/2026).** `save_emergency_reserve` SUBSTITUI o conjunto inteiro (base, horizonte, alocações e meses revisados, com revisão e recibo selado): uma palavra mal entendida numa frase apagaria a configuração toda, e a revisão dos 3 meses pede olhar o consumo mês a mês, que não cabe numa conversa. O agente CONSULTA: `resource_list reserva` lê `emergency_reserve_state` como a pessoa e responde cobertura (`reservado ÷ base`, em décimos por divisão inteira, como `formatEmergencyReserveCoverage`), meta (base × meses) e quanto falta, mais o déficit de lastro quando o escolhido passa do saldo. Base ausente, sem classificar, sem revisão ou zerada diz isso e **não escreve número** (nunca "0 meses", nunca infinito); reserva zerada com base boa diz que não há nada separado. O resumo é espelho Python de `getEmergencyReserveSummary` (`app/tools/lote_d.py`); `tests/fixtures/reserva_paridade.json` foi gerado RODANDO o TypeScript e o pytest compara os dois. Configurar pelo agente pede `resource_update` e é recusado com o caminho ("configurar é no app"). |
| Retirar vínculo de uma fonte e cancelar rascunho | O app retira somente a alocação de reserva; não apaga conta/bem e não lança dinheiro. Cancelamento pertence à sessão local. |
| Confirmar tentativa de resultado desconhecido | Retry conserva payload e UUID até recibo selado ou recusa específica comprovada do comando. Não certifica idempotência de uma operação nova do agente. |
| Conferir e encerrar tentativa (`resolve_emergency_reserve_attempt`) | Devolve o sucesso já selado ou sela um cancelamento terminal sob o mesmo lock/UUID/payload. Original atrasada recebe esse comprovante antes de qualquer efeito. Caminho do agente ainda pendente. |

Contrato e evidência: `docs/qa/2026-10-02-evolucao-financeira/f07/`. O F07 não
promete configuração da reserva pelo WhatsApp antes da implementação/avaliação da paridade.

## Metas: onde está o dinheiro — F11 (04/10/2026)

| app | agente |
|---|---|
| Guardar/Retirar com origem: separar na conta, transferir, vincular transferência, liberar, transferir de volta e desfazer (`goal_money_command`) | **Paridade (Lote B, 05/10/2026), tudo em `app/tools/movimentos.py`.** Guardar COM conta é o `goal_deposit` de sempre (sem campo novo no `FinanceAction`): `account` sozinha = `allocate` (o dinheiro FICA na conta, só reservado); `account` + `counterparty_account` = `transfer_in` (origem → conta da meta, transferência de verdade). Sem conta nenhuma segue o `goal_deposit` antigo (dinheiro "sem origem", o mesmo que o `release` sem conta retira); só a conta de destino, sem origem, pergunta. Retirar é `resource_update goals` com campos virtuais: `retirar_cents`, `retirar_da_conta` (→ `release`: o saldo não muda) e `retirar_para_conta` (→ `transfer_out`: move de verdade), `retirar_data`; sem conta e com dinheiro separado em conta, PERGUNTA de qual (lista com os valores). A frase do SIM distingue os dois ("o saldo dela NÃO muda, ele só fica reservado" × "é uma transferência de verdade, o saldo das duas contas muda") e traz os números do BANCO: o comando roda numa transação que é DESFEITA (`_previa`, como o `preview_finance_write` do app) e a frase lê o `goal_money_state` de antes e depois — saldo insuficiente chega ANTES do SIM, em reais. O SIM roda o mesmo comando com `p_request_id = uuid5(ns, mensagem:índice)` por `db.como_usuario`. **Resta:** vincular transferência já lançada (`link_in`) e desfazer movimentação (`undo`) — sem seleção de id pelo WhatsApp; data futura em separar/liberar o banco recusa. |

## Metas: marcos e identidade visual — F19 (05/10/2026)

| app | agente |
|---|---|
| Ícone e cor da meta (`goals.icon`/`color`), marcos em valor ou % do alvo (`goal_milestones`, escrita direta com RLS por espaço) e celebração única ao atravessar um marco | **Paridade (Lote D, 05/10/2026), `app/tools/lote_d.py`.** `resource_update goals` (ou `resource_create`) com campos virtuais: `marcos` (lista com `;`, cada item em % — `25%`, `33,3%` — ou em centavos; percentual vira centavos como `percentualParaCentavos`, meio para cima, calculado contra o alvo FINAL da mesma frase), `icone` e `cor`. A lista de marcos SUBSTITUI a atual, como o formulário do app (todos os itens com `+` somam; `nenhum` tira todos); a frase do SIM mostra `marcos: 25% = R$ 2.500,00; … (antes: …)`. Marco ≥ alvo (100% é o próprio alvo), repetido, 0 ou percentual inválido é recusado ANTES do SIM. Ícone é o NOME em português da grade do app (`Avião`, `Casa`…; `app/domain/goal_appearance.py`, com teste que lê `src/lib/categorias.ts`) e cor é a paleta das notas (mesmos apelidos); fora da lista PERGUNTA com as opções, nunca inventa. O SIM grava a meta e depois apaga/insere só a diferença dos marcos (a tabela não tem UPDATE). **Próximo marco:** `query_goals` (e `search_term`=meta) acrescenta `Próximo marco: R$ X (50%) · faltam R$ Y` (`textoDoProximoMarco`). **Resta:** a celebração é só do app (memória no aparelho); a etapa continua derivada do ledger. |

## Investimentos: aplicar e resgatar com origem e destino — F12 (04/10/2026)

| app | agente |
|---|---|
| Aplicar, resgatar, vincular transferência já lançada, editar valor/data e desfazer movimento de uma conta de investimento (`investment_command`) | **Paridade (Lote B, 05/10/2026):** a transferência (`create_transfer`) em que uma ponta é conta `type='investment'` vira `contribute` (destino) ou `redeem` (origem) — o tipo é lido na resolução (`movimentos.congelar`, que guarda o comando e a frase no alvo; origem não citada = a conta padrão congelada). Duas pontas de investimento são recusadas antes do SIM. A frase diz "aplicar R$ X em *CDB*, saindo de *Nubank*: é uma transferência de verdade entre as contas, não é gasto nem receita; saldo da posição A → B; valor atual C → D. O patrimônio só muda quando houver rendimento", com os números de `investment_positions` antes e depois da prévia desfeita; resgate maior que a posição ("faltam R$ X em DD/MM") chega antes do SIM. **Resta:** vincular transferência já lançada (`link`), editar e desfazer movimento. |

## Investimentos: principal, resultado e reavaliação — F13 (04/10/2026)

| app | agente |
|---|---|
| Atualizar valor, informar aplicado (abertura), registrar rendimento recebido e corrigir/apagar uma atualização de uma posição (`investment_value_command`); apagar marcação de um bem (`delete_asset_valuation`) | **Paridade (Lote B, 05/10/2026):** `resource_update accounts` (conta de tipo investimento, pelo nome) com campos virtuais: `valor_atual_cents` (+ `data_do_valor`) → `valuation` ("só o patrimônio muda, nenhum dinheiro entra nem sai") e `rendimento_cents` (+ `rendimento_na_conta`; o padrão é a própria posição, como o app) → `income` (receita de verdade, categoria rendimentos). Os dois juntos, ou nenhum, perguntam; conta que não é de investimento não é achada; atualização repetida no mesmo dia chega recusada com o caminho. A frase traz valor atual e resultado antes → depois (`indisponível` quando o banco não tem como calcular, nunca R$ 0,00). Bem (`assets`) continua `update_asset_value`. **Resta:** informar aplicado (`opening`), editar e apagar atualização. |

## Orçamentos: planejar por percentual — F14 (04/10/2026)

| app | agente |
|---|---|
| Planejar a renda-base por grupos e categorias em % (`budget_plan_command` save), ver os reais calculados no servidor, comparar planejado × realizado e aplicar aos limites (padrão ou do mês) com antes → depois (`apply`) | **Paridade (Lote B, 05/10/2026):** recurso novo `plano` no catálogo de `ResourceAction` (custo zero de schema; `FinanceQuery` está no teto 11×13). `resource_list plano` = `budget_plan_state`: cada linha com % ("12,5%"), reais, quanto gastou no ciclo e o limite de hoje. `resource_update plano` com `aplicar_categorias` (nomes ou `todas`), `aplicar_alcance` (`padrao`|`mes`) e `aplicar_mes` = `apply`; a frase do SIM traz o antes → depois que o `apply` devolve (rodado numa transação desfeita; em "só o mês" o antes é o limite padrão que vale) e o SIM envia a `version` lida, então plano editado entre a pergunta e o SIM cai em `PT409` ("mudou enquanto eu perguntava"). `budget_plan_*` valem para o espaço PADRÃO de quem chama: espaço diferente da conversa é recusado antes do SIM. **Resta:** montar e salvar o plano (`save`) fica só no app. |

## Por que o gasto mudou — F15 (04/10/2026)

| app | agente |
|---|---|
| "Por que mudou?" no bloco "Para onde foi" do Financeiro (`/finance/why`, RPC `spending_change`): contribuição de cada categoria, detalhe, forma de pagamento e tipo à diferença entre dois períodos, com link para os lançamentos de cada período | **Paridade (Lote A, 05/10/2026):** consulta `query_spending_change` (`FinanceQuery`, 11×13 = 143, medido) sobre a MESMA RPC, chamada `como_usuario` (`db.como_usuario`: a RPC lê `auth.uid()`). Período atual: o dito (`query_from`/`query_to`) ou o ciclo corrente; anterior: o ciclo do mês anterior pelo RÓTULO (`mes_anterior`, espelho de `shiftMonth`) ou, para janela dita, o equivalente imediatamente antes (`periodo_anterior`: meses inteiros voltam meses inteiros, o resto volta os mesmos dias). A frase traz total atual x anterior e até 5 categorias que mais explicam. **Resta:** só a dimensão categoria (as outras quatro — detalhe, forma, fixo/variável, essencial — não cabem sem campo novo no schema); a RPC soma TODOS os espaços do usuário, como a tela. |

## Lançar por voz (F16, 05/10/2026)

| app | agente |
|---|---|
| atalho "Por voz" dos menus Lançar: grava, transcreve, edita o texto e abre `/finance/lancar` pré-preenchido | `POST /internal/finance/draft` só interpreta (mesmo classificador, sem campo novo no schema): não executa tool, não grava `pending_actions`/`executed_actions`, não manda mensagem. Quem salva é o formulário. Não é mutação nova: nada a casar. |

## Explicações e avisos que abrem o item — F17 (05/10/2026)

| app | agente |
|---|---|
| "Como é calculado" (i) em saúde financeira, reserva, orçamentos, projeção e investimentos; toque no aviso de fatura/conta abre a fatura/o lançamento (alvos `invoice` e `transaction`); item apagado mostra "Isto não existe mais" | Sem equivalente por desenho: é leitura e navegação do app. O agente continua respondendo o número; o alerta no WhatsApp não muda (só o push ganhou o alvo de item). |

## Recorrente: transferência entre contas e encerrar série — F18 (05/10/2026)

| app | agente |
|---|---|
| Recorrente do tipo Transferência (origem, destino, valor, calendário e fim; editar só esta, esta e as próximas ou todas) e **Encerrar** série com prévia do que fica e do que sai (`end_recurring_series`, `end_recurring_series_preview`), mais Reabrir (tirar o fim) | **Paridade (Lote A, 05/10/2026):** `resource_create recurring` com `kind=transfer` + `counterparty_account_id` (pelo nome; origem em `account_id`; sem categoria; origem = destino e destino cartão recusados ANTES do SIM; frase "criar transferência de R$ X todo dia N da conta A para a conta B"). Encerrar/reabrir por campos VIRTUAIS de `resource_update recurring`: `encerrar_em` (última cobrança; vazio = a mais recente que já venceu, como o app) e `reabrir=true`. A frase do SIM sai de `end_recurring_series_preview` ("Ficam 1 paga e 0 atrasadas. Saem 2 cobranças futuras (R$ 79,80)…"), o SIM chama `end_recurring_series` com `p_request_id = uuid5(ns, mensagem:índice)` e a resposta usa os números que o banco devolveu ao executar. **Resta:** editar origem/destino de uma série de transferência existente passa pelo `update_recurring_series` (campo `counterparty_account_id`), sem teste de ponta a ponta no banco; tipo da série não troca por aqui (`converter_registro` é do app). |

## Duplicar e favoritos de lançamento — F22 (05/10/2026; Lote D reverteu o "fora do escopo" no mesmo dia)

| app | agente |
|---|---|
| Duplicar abre o formulário pré-preenchido; favoritos (`transaction_templates`) salvam, usam, renomeiam, arquivam e apagam modelos | **REVERTIDO em 05/10/2026 (Lote D, pedido do dono do produto: "Sim, todos"); antes era "fora do escopo" (o modelo seria atalho de digitação do app).** `app/tools/copias.py`, dois recursos no catálogo (custo zero de schema): `resource_update favoritos` com `lancar=true` ("lança meu favorito Almoço"; `amount_cents`, `conta` e `categoria` só se a pessoa disser) e `resource_create duplicar` ("repete o lançamento do mercado de ontem"; `name` = o termo, `data_do_original` = a data do original; sem nome e sem data é "o último"). **Sempre com SIM e com a data de HOJE**; a frase diz tudo ("lançar, hoje (05/10/2026), a partir do favorito *Almoço*: gasto de R$ 42,00 — *Almoço* (estabelecimento Zé), categoria alimentação, na conta Nubank, Pix"). As réguas são as do app, com paridade provada contra o TypeScript (`tests/fixtures/copias_paridade.json`, gerado rodando `decodeModelo`/`paramsDaCopia`/`podeDuplicar`): chave desconhecida é ignorada e valor inválido zera o campo (`decode_modelo`); só `COLUNAS_COPIADAS` viajam — nunca id, fatura, plano, série, dívida, `pays_invoice_id`, `rollover_of_invoice_id`, juro do Pix, entrada, `status`/`paid_at`/`auto_confirm`, `due_at`, anexo, `source`; parcela vira lançamento à vista no valor dela e sem o `(n/N)`; pagamento de dívida, de fatura e juro do Pix não duplicam. A conta do favorito que não existe mais ou foi arquivada NÃO é trocada em silêncio: PERGUNTA (com as contas que existem); favorito sem valor pergunta; o detalhe de categoria que sumiu sai e a frase conta. Categoria é texto livre e não tem estado "arquivada": ela vai como está. A prévia é o próprio INSERT numa transação desfeita, com os gatilhos diferidos de forma de pagamento e de detalhe forçados a `immediate` (sem isso a prova passava e a recusa só viria depois do SIM): "Escolha uma carteira para pagar em dinheiro" chega antes. A busca do duplicar é `resolve.por_transacao` (a mesma de apagar/corrigir): empate pergunta listando as datas, termo que não casa é "não achei". Ao gravar, o `use_count` do favorito sobe. **Revisão (05/10/2026):** forma `credit` sem cartão PERGUNTA o cartão pelo texto do lote C (`PERGUNTA_CARTAO`, só cartões, a conta dita resolve com `only_cards`); `duplicar` também aceita `conta`, `categoria` e `amount_cents` ditos (a resposta à conta arquivada resolve); sem conta no original vale a conta PADRÃO do espaço e a frase diz "(a conta padrão)"; o espaço vai congelado na cópia e é reconferido ao gravar; lançamento e contagem de uso do favorito saem num statement só; a frase mostra detalhe e classificação no formato do lote C. **Resta:** salvar, renomear, arquivar e apagar favorito, e "Virar favorito", são só do app. |

## Evolução financeira — pontos sem linha própria (verificação final, 05/10/2026)

Os 22 pontos do plano `docs/superpowers/plans/2026-10-02-evolucao-financeira-22-pontos.md`. As
linhas acima cobrem F02, F07, F11–F19 e F22; estas registram os outros. Nenhum mudou tool, prompt
nem `FinanceAction` (teto de 252).

| ponto | app | agente |
|---|---|---|
| F01 forma de pagamento | `payment_method` no formulário único (avulso, série, compra, financiamento) e no detalhe | **Paridade (Lote C):** ao CRIAR (gasto/receita, recorrente, parcelada) a forma dita ("no pix", "no débito", "em dinheiro", "boleto", "TED") é gravada; não dita fica `null` (nunca vira Pix) e uma forma que a frase não sustenta é descartada. Vem do parse principal (campos do `FinanceAction`, validados e congelados em `tools/atributos.py`; antes era uma segunda chamada, enquanto o schema não cabia campo). A compatibilidade com a conta espelha `payment-method.ts` (`domain/atributos.erro_da_forma`, teste de paridade): crédito sem cartão PERGUNTA o cartão, e **"Pix no crédito" é Pix cobrado no cartão** (como o "Juros do Pix" do app): `forma = pix` e a conta TEM de ser cartão, senão a mesma pergunta — que nasce como rascunho de slot de conta só com cartões, e a resposta relê a frase original (`raw_text`), então a forma dita antes não se perde. As demais incompatibilidades ficam sem forma e a frase do SIM avisa. A frase do SIM diz o entendido, inclusive o padrão que veio da categoria ("essencial (padrão de mercado)"). Falha do banco na validação lança sem os atributos. A negação ("não essencial", "não é fixo") é por item da frase: com dois lançamentos na mesma frase ela pode vetar o outro (erra para o lado seguro: grava menos). Parcelada vai por `create_purchase` (o caminho do app). Corrigir a forma de um lançamento que existe segue só no app. |
| F03 saldo e limite no seletor | saldo da conta e limite disponível do cartão ao escolher a origem | Sem equivalente por desenho: é leitura da tela. O agente já responde saldo e limite por `query`. |
| F04 prévia do efeito | "Ao salvar" com antes → depois (`finance_write_preview`) | Sem equivalente por desenho: no agente, a frase do SIM (HITL) é a prévia. |
| F05 filtro por forma de pagamento | Lançamentos filtrados por forma, "Não informado" incluso | **Paridade (Lote A):** `payment_method` em `FinanceQuery` filtra `query_transactions` no SQL (`not_informed` = `is null`), viaja no blueprint (o "ver mais" mantém o filtro) e a resposta diz o recorte. Forma desconhecida é recusada com a lista das aceitas, nunca vira consulta sem filtro. Gravar a forma pela conversa segue lacuna (F01). |
| F06 fixo/variável e essencial | classificação por categoria, por lançamento e por alcance | **Paridade na criação (Lote C):** "gasto fixo", "variável", "essencial", "supérfluo/não essencial" ditos na frase gravam `expense_pattern`/`expense_necessity` com `*_source = explicit`; sem menção vale o padrão da categoria (`public.categories.default_expense_*`, lido com a categoria FINAL e gravado como `category_default`, como o app faz). O banco só herda de série, compra e dívida — NÃO de lançamento avulso, então o agente aplica o padrão. Só gasto classifica (receita e transferência nunca). Reclassificar um lançamento que já existe segue só no app. |
| F08 meta no planejamento | "Cabe no plano?" e ajustar o plano da meta | **Consulta (Lote D, 05/10/2026):** `resource_list plano_metas` lê `goal_planning_state_v2` como a pessoa (365 dias, régua do espaço, por mês) e diz as metas incluídas com o aporte mensal e o prazo, as que não chegam no prazo ou estão incompletas, a primeira data em que aperta e o menor disponível. **Sem renda lançada no período a resposta é "não dá para dizer que cabe" — nunca aprovação** (`income_present=false`; a disponibilidade do banco não conta o que ainda vai entrar). "Cabe" só sai com tudo calculado (sem meta incompleta, sem prazo perdido e sem valor de meta sem origem); senão a resposta diz "pelo que dá para calcular nos próximos 12 meses, não aperta, mas…" e lista o que ficou fora. Ajustar/salvar o plano (`save_goal_plan_v2`, fingerprint e itens) fica só no app. |
| F09 subcategorias | criar, mover, juntar e remover; detalhe no lançamento | Parcial: `resource_update` aceita `subcategory_id` em séries, regras e dívidas pelo NOME (Lote A) e, **desde o Lote C, o lançamento novo também**: "gastei 80 no mercado, detalhe feira" resolve o nome dentro da categoria-pai pelo MESMO resolvedor (`atributos.escolher_detalhe`, igual e depois "contém"), o detalhe dito ganha da regra do usuário, e só vale se a categoria final (após a regra) continuar a do pai. Não casa ou casa com dois = pergunta com a lista, antes do SIM; detalhe novo nunca é criado. Criar, mover e juntar segue só no app. |
| F10 prazo pela contribuição | "Tenho um prazo" / "Posso guardar por mês" ao criar a meta | **Paridade na criação e na simulação (Lote D, 05/10/2026), a conta é do BANCO** (`private.goal_contribution_result`, a mesma que o app espelha em `goal-contribution.ts`; staging e TypeScript deram idêntico em 3 casos): "quero juntar 10 mil até dezembro de 2027" segue `create_goal` e a frase do SIM acrescenta "para chegar em 31/12/2027 dá R$ 666,67 por mês, em 15 aportes, do dia 05/10/2026 ao dia 05/12/2027 (o último sai R$ 666,62)" (calculada na resolução, `lote_d.congelar`). "Guardando 500 por mês" é o campo virtual `mensal_cents` em `resource_create/update goals`: "a meta chega em 05/05/2028 (20 aportes)", comparando com o prazo da meta quando existe. Numa meta que JÁ existe, só dizer o quanto guarda (`resource_list goals` + `mensal_cents`) responde sem gravar e sem SIM. A âncora é hoje, o mesmo `first_on` que o planejamento sugere. O cálculo é intenção: **não grava plano** (`save_goal_plan_v2` fica no app) nem aporte. |
| F20 quanto vou acumular | simulação no aparelho, nada gravado | Sem equivalente por desenho: não é mutação; as premissas ficam no aparelho. |
| F21 primeiro cadastro guiado | `/finance/comecar` sobre `create_account` | O cadastro já existe por `resource_create accounts`/`cards`; o roteiro em passos é da tela. |

## Aplicar o adiantamento do "E se…?" (08/10/2026)

| app | agente |
|---|---|
| "Aplicar" no adiantamento da Projeção abre `/finance/aplicar-adiantamento` e grava UM lançamento que cobre as parcelas (`apply_anticipation`); "Editar adiantamento" muda título, valor, data e conta (`edit_anticipation`) | **Não aplica nem edita**: o "E se…?" não existe na conversa. **Apagar desfaz**: `delete_transaction`/`undo_last` sobre o lançamento de uma compra chamam `private.desfazer_adiantamento_da_compra` (as parcelas voltam com o id); dívida e série desfazem pelo gatilho do próprio DELETE. Corrigir valor, data, título ou conta é recusado com "muda no app, em *Editar adiantamento*" (o banco os mantém, e dizer "pronto" seria mentir); a categoria muda por aqui. |
