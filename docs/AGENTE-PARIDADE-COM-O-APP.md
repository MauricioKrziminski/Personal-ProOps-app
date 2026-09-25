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

A recorrência fechou no mesmo dia: `resource_update` sobre `recurring` já existia, mas fazia um
UPDATE só na REGRA. Como o `finance-scheduler` materializa 90 dias à frente e o unique
`(recurring_id, occurred_at)` impede reescrita, os três meses seguintes ficavam com o valor velho
e o quarto com o novo. Agora, quando o patch toca valor, categoria, descrição ou conta, a execução
cai na mesma RPC do botão do app; `active`, `rrule` e afins seguem no UPDATE normal, porque a RPC
os recusa de propósito.

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
| **Juros do Pix no crédito** (campo em `transaction-form`, grava compra + linha `juros` na mesma fatura) | sim, sem código novo | multi-intent: *"paguei 84,20 do DAS e 1,85 de juros do pix no crédito"* vira dois `create_expense`. `'juros'` entrou em `categories.py`, então a categoria sai igual dos dois lados. |
| **Editar a série a partir de um lançamento** (linha "Repete …" no detalhe → `recurring?edit=`) | sim, já fazia | `ResourceAction` em `recurring` propaga por `update_recurring_series` (fechado na própria auditoria). O que mudou foi só o caminho no app. |
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
| "+ Nova pasta" na aba Notas e "Nova subpasta" dentro da pasta (`NovaPastaSheet`, 25/09/2026) | sim | `resource_create folders` — com `parent_id` ("cria a pasta viagem dentro de trabalho"); o mesmo `useSaveFolder` de "Organizar pastas", agora à mão onde a pessoa está |
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
nada quebra: "Este e as próximas" só grava o pagamento com o encargo, como antes.

## Dicas no lugar e "Como usar o ProOps" (24/09/2026)

Spec: `docs/superpowers/specs/2026-09-24-dicas-e-guia-design.md`.

| app | agente |
|---|---|
| "Entendi" das dicas, "Mostrar" do guia, "Conhecer o app" nos Primeiros passos | **não — exclusão declarada.** Não é mutação: nada vai ao banco. É ajuda sobre GESTOS da tela (arrastar, tocar no painel, deslizar o cartão), guardada no aparelho (`dicas:<userId>`). Pela conversa a pergunta equivalente ("o que dá para fazer?") já é respondida pelo nó `geral` |
