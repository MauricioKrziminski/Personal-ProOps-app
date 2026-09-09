# O agente faz tudo que o dedo faz — auditoria de 09/09/2026

> Pedido do dono do produto: *"garanta que o agente consiga fazer tudo que o usuário possa fazer
> manualmente dentro do app, sem perder na segurança e sempre validando com o usuário."*

Método: enumerar **toda** mutação do app (`useMutation` em `src/hooks/`, 52) e casar cada uma com
o caminho do agente que faz a mesma coisa. Nada de amostragem — a queixa que originou esta
auditoria foi *"se deixou passar o nome, com certeza tem mais coisas"*, e amostragem é como o
nome tinha passado.

## Resultado

| | |
|---|---|
| mutações do app | 52 |
| já cobertas antes desta auditoria | 39 |
| **lacunas fechadas aqui** | **4** |
| fora do escopo por decisão, com motivo | 9 |

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
(*"você pode mudar as parcelas pagas ou excluir o plano"*) e agora chama
`public.update_transaction_scoped`, a MESMA RPC do botão. A frase da confirmação diz o escopo —
*"só as parcelas em aberto; as pagas ficam como estão"*.

| app | agente |
|---|---|
| escolher "esta e as futuras" no formulário | `update_transaction` sobre a compra parcelada |
| "Editar" no menu do plano | idem — a âncora é a primeira parcela EM ABERTO nos dois |
| "Editar" numa recorrência | **pendente**: a série ainda não é alvo de `update_transaction` |

A linha pendente é deliberada e está aqui em vez de ficar em silêncio, que é a regra desta tabela.

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
