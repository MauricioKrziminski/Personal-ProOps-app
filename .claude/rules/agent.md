# Agente Python — FastAPI + LangGraph (`agent/`)

O serviço que recebe do WhatsApp, decide e escreve. Substituiu o par
`whatsapp-webhook` / `process-jobs` em Deno. Roda em Docker no Cloud Run com
`min_instances = 0` — e todo o resto desta página é consequência disso.

## Segurança conversacional

- **Todo input do usuário vai encapsulado em `<user_input>...</user_input>`**, e conteúdo de
  documento (OCR de cupom, PDF de fatura) em `<document_content>`. O system prompt diz, com todas
  as letras, que o que está lá dentro é DADO e nunca instrução. Caminho único:
  `wrap_untrusted()` / `sanitize_untrusted()` em `app/security.py`, que fecha as tags que o
  próprio texto tente escrever.
- **Conteúdo do usuário NUNCA entra no system prompt.** O system prompt é constante e é o único
  lugar com autoridade; o texto vai na mensagem humana.
- **A delimitação é a segunda linha de defesa, não a primeira.** A primeira é o modelo não ter
  nenhuma ferramenta de escrita: ele devolve um objeto e pronto. Filtro de conteúdo ("detectar
  instrução maliciosa") não entra aqui — não funciona e dá falsa sensação de proteção.

## Lógica de negócio determinística

- **Nada de tool-calling probabilístico do LangChain.** O LLM devolve um schema Pydantic estrito
  e quem executa é um **mapa fechado** (`app/tools/registry.py`) escrito à mão. Tool-calling
  deixaria o modelo escolher *quais* funções chamar e em que ordem — que é exatamente o
  raciocínio livre que este produto quer fora do caminho da escrita.
- **Nenhum cálculo sai do modelo.** Regra que já mora no banco continua no banco (ciclo de fatura
  no trigger `set_invoice`, parcelamento em `create_installment_plan`, aporte em `goal_deposit`).
  Duplicar em Python cria a segunda cópia da regra, e duas cópias divergem.
- **Validação de Nível 1 em `app/tools/guards.py`**, depois do modelo e antes do banco: valor
  inteiro e plausível, data dentro de ±5 anos, categoria normalizada, parcelas 2..99. É código
  puro e testado — é a única forma de o comportamento não mudar quando o modelo mudar.
- **Resposta ao usuário é template Python.** Zero segunda chamada de LLM para escrever texto sobre
  números que já lemos: um modelo escrevendo "você gastou aproximadamente" em cima de um valor
  exato é alucinação com custo extra. O nó `geral` (saudação, ajuda) também não chama modelo.
- **Teto MEDIDO do schema: o PRODUTO propriedades × valores de enum, não cada um.** O
  `FinanceAction` está no teto de **252** (soma 32); os outros seguem em 198/31. Passar disso
  devolve `400 INVALID_ARGUMENT` sem detalhe. `tests/test_schemas.py` prende o limite — somar campo
  exige tirar outro, ou rodar o probe antes. Números e histórico em `ai-gemini.md`.

## Padrão de texto: valida estrutura, nunca infere sentido

**Casamento de padrão pode VALIDAR ESTRUTURA** (data ISO, RRULE, MIME, o payload
dos nossos próprios botões) **e pode ser fast-path grátis cuja falha CAI NO MODELO.
Nunca pode ser o único intérprete de sentido, e nunca pode VETAR uma ação por causa
de uma palavra na mensagem.** Quem entende o que o usuário quis dizer é o modelo;
quem valida e executa é o código.

A exceção deliberada é DINHEIRO: o modelo diz o que o número SIGNIFICA, o código diz
QUANTO ele é (`parse_valor_em_centavos`, `scope_from_text`). Ali o padrão é rede de
segurança POR CIMA do modelo num caminho destrutivo, não inferência de intenção.

Três violações foram removidas em 08/09/2026, e as três eram o mesmo defeito:
uma lista de palavras decidindo o que a pessoa quis.

| era | o que quebrava | o que protege agora |
|---|---|---|
| `_guard_debt_history`: `\b(parcelas\|anteriores)\b` vetava pagamento de dívida | "paguei as parcelas de setembro" era recusado; "quitei as anteriores" passava | aritmética do contrato: valor múltiplo exato da prestação PERGUNTA se é histórico ou amortização |
| `route()`: `status_request`/`creating`/`explicit_debt` decidiam desambiguação | "quitei as anteriores da moto" não casava e a pergunta nunca aparecia | `financial_entity` (que o modelo preenche) + a consulta ao banco |
| `interpret_choice` era o único intérprete de "qual deles?" | só número, ordinal e rótulo exato; "o do mercado" virava intenção nova | regex continua como fast-path grátis, e a falha cai em `escolher_candidato` |

⚠️ **Um SIM não resolve uma pergunta "qual deles?"** (09/09/2026, medido em produção).
`decide()` cai no classificador de SIM/NÃO quando o de ESCOLHA não casa — e ele não tem índice
para devolver, então o `approved: True` volta sem `candidate_id`, o grafo não acha o candidato e
responde "não mexi em nada", matando a pergunta e as opções junto. Prova:
`pending_actions` com `kind=choice`, `cand=9`, `status=approved` e nenhuma escrita. Numa pergunta
de escolha só a RECUSA age; a aprovação mantém a pendência e repete a lista numerada.

⚠️ **Pergunta com 3+ candidatos vira lista do WhatsApp, e a lista ESCONDE as opções** atrás de um
toque em "Escolher". O corpo tem que repetir a lista numerada — senão a tela mostra a pergunta e
nenhuma resposta possível, e a pessoa tenta responder por escrito (que é o caminho caro e o que
mais erra). O caminho de botões (≤2 candidatos) já fazia isso.

⚠️ **Demonstrativo aponta para o que a CONVERSA escreveu, não para a linha mais nova do banco**
(09/09/2026). "Apague esse lançamento" logo depois de "gastei 20 no café" tem antecedente, e ele
é o café. O estado do grafo carrega `last_write_id` (escrito por `executar` e por `seguras`, lido
por `alvos`), e a janela não precisa de constante em minutos: o checkpoint é chaveado pelo
`thread_id` EFETIVO, que já embute o `session_epoch`. Três travas que não caíram: a existência da
linha é reconferida (o id de um DELETE também é gravado, e antecedente morto vira pergunta), quem
DISSE um termo de busca nunca é redirecionado para o antecedente, e apagar/corrigir continuam
passando pelo `interrupt()` — o que mudou é o usuário parar de escolher entre nove opções para
dizer o que ele já tinha dito.

⚠️ **Ponteiro e termo de busca se separam por uma lista de substantivos só** (`_SUBSTANTIVO` em
`domain/reference.py`). Eram duas listas divergentes: `_VAGO` conhecia "esse item" e não conhecia
"esse lançamento", então o ponteiro virava busca literal por `%esse lançamento%`. O padrão é
ancorado no texto INTEIRO de propósito — como substring destruiria "essa nota da reunião", que é
nome legítimo. E o substantivo opcional pende do GRUPO de demonstrativos: escrito como
`a|b|c(\s+N)?` a alternância corta antes do parêntese e só `c` aceita substantivo.

⚠️ **Candidato de empate precisa do que o DISTINGUE.** Uma série recorrente produz ocorrências que
só diferem na data, e a lista saía com quatro linhas escritas `receita de R$ 4.000,00 em *salário*
(Salário PJ)`, idênticas. `veredito` recebe `detalhe`; para transação é a data. Isso também é o
que o classificador semântico vê, então "o de outubro" só passa a ser respondível depois disso.

⚠️ **Escolha semântica só vale em lista de REGISTROS (`kind == "choice"`).** Em
`soft_warning` os "candidatos" são AÇÕES (Confirmar / Trocar de Cartão), e deixar um
classificador de escolha pescar "Confirmar" de uma hesitação ressuscita o defeito de
"clicar Trocar de Cartão autoriza a compra".

**Interpretação liberal exige confirmação.** O par é indivisível: o modelo pode
inferir o que a pessoa quis dizer PORQUE ela vê o efeito e aprova antes da escrita.
Afrouxar um lado sem o outro é o que transforma "entendeu bem" em "apagou errado".

⚠️ **Duas cópias do mesmo defeito saíram em 21/09/2026: regex generalizando conta e nome
a partir de qualquer palavra.** `extract_account_fallback` (`agent/app/tools/guards.py:148`, único
chamador `nodes.py:288`) tinha um ramo genérico `no|na|pelo <palavra>` que virava conta: "Na
verdade eu comprei em 2x no cartão" inferia o cartão *verdade*, "paguei na hora" virava *hora*.
Hoje ele só aceita a ESTRUTURA `no|na|pelo|pela|com o|com a cartão [de crédito/débito] [do|da]
<nome>` — fora dela, `account` fica vazio e `required.py` pergunta. `extract_description_fallback`
tinha o mesmo defeito para a descrição ("comprei mais um em 3x" → *mais*, "gastei tudo, 200
reais" → *tudo*) e foi REMOVIDO por inteiro (junto com `_NOUN_EXTRACTOR`/`_IGNORE_NOUNS`): medido
com o fallback desligado, ele só acrescentava valor quando estava INVENTANDO um nome — nas frases
com nome de verdade, o próprio modelo já preenchia. Sem ele, a pergunta "Do que se trata?" volta
a aparecer quando falta.

## Avaliação: "funciona de infinitas formas" é medido, não afirmado

`scripts/evaluate_answer_forms.py` roda o Gemini REAL sobre muitas redações por
costura — campo de cadastro, escolha de item, sim/não, slot de rascunho — e sobre um
conjunto adversarial que **não pode aprovar nada**. O pytest usa dublês, e dublê
sempre concorda: só esta suíte responde se a pessoa pode escrever do jeito dela.

**Mexeu em prompt, schema de classificador ou catálogo → roda ela.** As duas metades
têm que passar: regressão em "aceitar" é o agente ficando surdo; regressão em
"recusar" apaga dado do usuário.

## Paridade com o app

**O agente faz tudo que o usuário faz com o dedo.** As 53 mutações do app (`useMutation` em
`src/hooks/`) foram casadas uma a uma com o caminho do agente em 09/09/2026; a tabela, as quatro
lacunas fechadas e as dez exclusões com motivo estão em `docs/AGENTE-PARIDADE-COM-O-APP.md`.
**Botão novo no app = linha nova naquela tabela**, senão a diferença volta a crescer sozinha —
foi assim que renomear um lançamento ficou de fora por meses.

Onde a capacidade nova cabe, em ordem: **campo no catálogo de `ResourceAction`** (5×5, sobra
folga, e campo virtual traduzido no `prepare` não precisa nem existir como coluna) → **alvo novo
resolvido** para uma ação que já existe → tipo de ação novo, que hoje **não cabe** em
`FinanceAction` (teto medido de 252/32).

## Correção de compra parcelada, sem menu (21/09/2026)

⚠️ **`update_transaction` NUNCA dá baixa.** Havia um desvio para `_baixa_em_parcelas` dentro
dela — corrigir ("muda a 3ª parcela para 300") também marcava parcelas como pagas, em silêncio.
Ele foi removido (`agent/app/tools/finance.py:856`); dar baixa é caminho de `mark_paid`
(`agent/app/tools/finance.py:724`), nunca efeito colateral de um UPDATE.

- **O menu "Mudar parcelas pagas" / "Excluir plano" saiu.** Corrigir o VALOR da compra inteira
  pergunta "é o total da compra ou cada parcela?" (`interrupt` `kind=choice,
  purpose=amount_unit`, helper `_perguntar_unidade`) em vez de abrir um menu de ações — a
  resposta congela `amount_unit` no alvo, e só então o SIM confirma. Sem a unidade — checkpoint
  antigo, de antes do deploy, sem `editaveis` — a correção é RECUSADA ("Não sei se o valor era o
  total da compra ou cada parcela... me pede a correção de novo.", `agent/app/tools/finance.py:992-993`),
  nunca executada com um default (parcela × total é uma ordem de grandeza de diferença); a
  pergunta só volta a aparecer se a pessoa reenviar a correção.
- **Toda correção da compra inteira passa por `update_installment_plan`** (valor em qualquer
  unidade, nome, categoria — `finance._corrigir_plano`); renomear/categoria SEM valor é um UPDATE
  direto (`finance._renomear_plano`, sem RPC, sem mexer em dinheiro, data ou conta). Corrigir UMA
  parcela sincroniza `installment_plans.total_cents` na mesma operação, para o total continuar
  sendo a soma do que está embaixo dele.
- **Recusas antes do SIM, não depois:** várias parcelas no snapshot, parcela travada (paga ou em
  fatura fechada/paga em parte), data ou conta da compra inteira. `policy.erro_de_correcao` roda
  no `gate` e de novo dentro do helper de unidade (no empate a data só some depois da escolha).

## Human-In-The-Loop

- Disparam `interrupt()` no LangGraph: **deleções** (`delete_transaction`, `undo_last`,
  `delete_note`, `delete_reminder`), **valor acima de `HITL_AMOUNT_THRESHOLD_CENTS`** (R$ 1.000
  por padrão) e **confiança < 0,6**.
- A política vive em `app/graph/policy.py`, **pura e sem LangGraph**: regra de segurança que só dá
  para testar subindo o grafo inteiro é regra que ninguém testa.
- O grafo **para**; quem fala com o mundo é o worker — manda a pergunta e grava `pending_actions`.
  A retomada usa `Command(resume=...)` **no mesmo `thread_id`** (o gravado no pendente, nunca um
  recalculado).
- **Confirmação: clique por IGUALDADE EXATA, texto digitado por SEMÂNTICA** (31/08/2026). O
  payload do botão (`pa:<uuid do pendente>:ok|no|none|c:<id>`) é escrito por nós e comparado
  campo a campo — não há o que interpretar. Texto livre ("manda bala", "cancela isso") vai para
  o modelo, porque a lista de padrões que fazia isso antes era frágil demais.
  **A trava não mudou:** só `approve` aprova. Ambíguo ("acho que sim"), resposta fora do enum,
  cota estourada ou modelo fora do ar devolvem None, que vira intenção NOVA — nunca aprovação.
  Um portão que abre quando o classificador falha não é portão. Custo: uma chamada por
  confirmação digitada; o clique continua custando zero.
- A pergunta descreve o **efeito**, não o nome interno da ação. Ninguém confirma
  "delete_transaction"; todo mundo entende "apagar o gasto de R$ 45".

⚠️ **Lote que CRIA algo novo e MUDA o que já existe é UM SIM atômico** (`policy.par_de_substituicao`,
21/09/2026) — é a REDE DE SEGURANÇA para quando o modelo devolve apagar/corrigir + criar no
MESMO lote, não o caminho normal de uma correção. Hoje o prompt já ensina que "na verdade eu
comprei em 2x no cartão" é UMA `update_transaction` com `installments=2` (`agent/app/graph/prompts.py:141-143`,
"NUNCA delete_transaction + create_*: a compra é a mesma, só muda a forma de pagar"), mas antes
da Task 5 o modelo respondia com o par — foi o incidente das wardogs: "Na verdade eu comprei em
2x no cartao" voltou `[delete_transaction(wardogs, found), create_installment_purchase(2x)]`, e
sem esta regra o `_gate` perguntava só o apagar, escondendo a criação da frase de confirmação.
Um lote pode legitimamente misturar as duas coisas quando são DUAS intenções explícitas na
mesma mensagem — "apaga o café de ontem e lança 30 no almoço" também cai na regra (um
`delete_transaction` com alvo achado + um `create_expense`), e mesmo aí o SIM tem que cobrir os
dois efeitos juntos. Três regras:

- **Nada é gravado antes da pergunta.** Com o par incompleto (falta valor, cartão não existe), o
  `_gate` para ANTES do `interrupt()`, sem montar rascunho — "Ainda não apaguei nem criei nada."
  O motivo de não montar rascunho é estrutural, não de contexto perdido: `_rascunho`
  (`agent/app/graph/nodes.py:632-650`) guarda **uma** ação só. Guardando a criação, a outra
  metade (apagar/corrigir) se perderia — completar o rascunho depois criaria a compra nova ao
  lado da antiga, ou, se o apagar já tivesse rodado, a compra nunca nasceria.
- **Criação primeiro, e o resto só roda se ela escreveu** (`nodes._executar`,
  `agent/app/graph/nodes.py:1082`): as ações do par são reordenadas com os `create_*` na frente
  antes de rodar; se uma criação volta `read_only` (erro, exceção), o apagar/corrigir E as
  criações seguintes do par são PULADOS — "⚠️ Não apaguei X porque não consegui registrar Y."
- **Retentativa sem `result_id` não conta como escrita.** A idempotência (`executed_actions`)
  reserva ANTES de executar; se o worker morre entre a reserva e o fim da tool, a reserva fica
  ÓRFÃ (sem `result_id`). `db.execution_result_id` (`agent/app/db.py:454`) distingue os dois
  casos, e `registry.execute` só marca `ja_executada=True` quando `result_id` não é nulo — senão
  a retentativa rodaria o apagar sozinho, sem a criação ter de fato acontecido.

## Na dúvida, PERGUNTA — nunca deduz

Regra do dono do produto (11/09/2026), e ela vale para o agente inteiro:
*"ele tem que perguntar sempre que tiver dúvida, nunca deduzir. Isso para qualquer
situação do agente."*

A fronteira é uma só: **o que o usuário DISSE, o agente resolve; o que ele NÃO disse
pode cair numa preferência que ele mesmo gravou; o que ele disse e não bate vira
pergunta.** Deduzir é a terceira coisa, e ela não existe.

| situação | o que fazer |
|---|---|
| não citou nada | preferência GRAVADA pelo usuário (`workspaces.default_account_id`, `accounts.payment_account_id`) — não é palpite, é configuração |
| citou e não existe | pergunta, listando o que existe — **quando a lista é curta e útil** (contas, cartões). Para LANÇAMENTO ela não é: listar os 40 mais recentes é exatamente a queixa de 15/09/2026 (*"pedi para remover o nuuvem e ele me deu um monte de lançamento nada a ver"*), então ali a pergunta cita o termo — "não achei nada com «nuuvem»; confere o nome, ou me diz o valor ou a data?". Rationale em `ai-gemini.md`. |
| citou e casa com duas | pergunta, com os dois nomes |
| campo obrigatório faltando | pergunta ("Para cadastrar X, informe Y. **Ainda não salvei nada.**") |
| dois itens candidatos | `interrupt()` com a lista — já era assim |

⚠️ **`resolve_account` devolvia `None` para as três situações e ninguém distinguia.**
Os chamadores faziam `resolve_account(...) or default_account(...)`, então "gastei 45
no bradesco", sem Bradesco cadastrado, gravava na conta padrão — calado. Pior: o ramo
de casamento EXATO fazia `return certos[0]["id"]` sem contar quantas casaram, e com
"Nubank Conta" e "Nubank Cartão" a escolha era a ordem do banco. É o mesmo defeito que
lançou um salário de R$ 4.000 dentro da fatura pelo app, sem nem a tela para mostrar a
escolha. Hoje empate devolve `None` e **`conta_citada`** (`app/tools/finance.py`) é
quem transforma "citou e não achei" em pergunta. Gasto, receita, transferência,
parcelamento e pagamento de fatura passam por ela.

⚠️ **Fallback copiado de outro caminho não herda o motivo dele.** A conta padrão do
workspace decide onde cai o gasto do dia a dia de quem não citou conta; ela foi copiada
para `_conta_que_paga` e lá decidiria a ORIGEM de uma transferência de mil reais que a
pessoa não citou — com a frase do SIM sem dizer qual era. Saiu. `payment_account_id`
ficou, porque é campo que o usuário preencheu no cartão.

⚠️ **A resposta diz o que foi DECIDIDO por ela.** "✅ Fatura paga" não contava de qual
conta o dinheiro saiu, num movimento que muda dois saldos. Toda escolha que o agente
fez sozinho (ainda que por preferência gravada) aparece na frase.

⚠️ **A frase da confirmação descreve a AÇÃO, não a tabela do alvo.** `pay_invoice`
passou a resolver a fatura como alvo e herdou a frase de `mark_paid`: o agente
perguntava *"marcar como paga, SEM tirar do caixa?"* para a ação que TIRA do caixa —
na tela que o usuário aprova. Condição por `action.type`, sempre.

### Perguntar não basta: a pergunta precisa ter RESPOSTA (15/09/2026)

⚠️ **"Qual delas?" sem rascunho é um beco, e ele era pior que não perguntar.** Medido:

    paguei 45 no mercado com o cartao
    🤔 "cartao" casa com mais de uma: *Cartão da casa*, *Cartão da viagem*… Qual delas?
    nubank
    Para trocar a conta de uma compra parcelada, edite a parcela individual no app.

Os R$ 45 nunca foram registrados. A pergunta saía como TEXTO e não guardava rascunho
nenhum, então o turno seguinte era uma mensagem nova, sem a compra — o modelo tinha que
adivinhar um gasto a partir da palavra "nubank".

Hoje `contas_citadas` marca **`account_error`** junto do `correction_error`
(`app/tools/resolve.py`), e `_rascunho` (`app/graph/nodes.py`) o transforma num rascunho
de slot `account`. A partir daí tudo que já existia vale: a pergunta vira lista de
botões, a resposta digitada cai em `draft.interpretar`, e um nome que não existe vira
oferta de cadastro. Mesmo formato que `resource_node` já usava para cadastro incompleto.

⚠️ **UMA pergunta por turno.** "comprei uma tv em 10x no itau" respondia *"faltou o
valor"* **e** *"não achei o cartão itau"* no mesmo balão, e a pessoa não sabe qual das
duas responder. `contas_citadas` recebe `pular` com os índices que `_incompletas` já
bloqueou — `faltando` declara a ordem (valor primeiro, cartão depois) e a pergunta do
cartão volta sozinha no turno seguinte.

⚠️ **A resposta VENCE no campo perguntado** (`draft.mesclar`). A guarda "não sobrescreve
o que já estava lá" travava exatamente o caso novo: a ação guardada tinha
`account = "cartao"`, a escolha na lista era descartada e a mesma pergunta voltava em
loop. Só o VALOR mantém a guarda — ali, um campo já preenchido quer dizer que a pergunta
não era para existir, e para dinheiro manter o que estava é o lado seguro do erro.

⚠️ **Nem todo slot `account` é CARTÃO.** A régua mora em `_CONTAS_CITADAS`
(`resolve.conta_e_cartao`) e é a MESMA que valida a citação — perguntar por uma lista
diferente da que valida é oferecer o que a validação vai recusar. Dela saem também a
ausência de "É financiamento" fora do parcelamento e o texto ("conta" x "cartão").

⚠️ **Numa lista, um cartão e uma conta corrente têm a mesma cara.** A linha leva o TIPO
por extenso (e o dia de fechamento no cartão) — é a mesma resposta que o `AccountPicker`
do app deu ao salário de R$ 4.000 lançado dentro da fatura. Em lista SÓ de cartões o
tipo some: seria a mesma palavra em toda linha.

⚠️ **Só o campo `account` vira rascunho, e a restrição EVITA um loop pior que o beco.**
O rascunho conhece um campo: `parse_slot_click`, `_cartao_do_rascunho`, `draft.mesclar` e
o CHECK de `draft_actions.slot` falam todos de `account`. Marcando também a falha de
`counterparty_account`, a resposta seria gravada no campo errado — em "transferi 100 da
nubank pro bradesco" (sem Bradesco), escolher *Inter* na lista APAGARIA a origem correta
e deixaria o destino quebrado, e a pergunta voltaria para sempre destruindo mais um dado
a cada resposta. Campo novo exige slot novo e migration.

**Continuam em TEXTO, exclusões declaradas** (a lista de contas continua na frase, mas
sem botão e sem rascunho):

| onde | por quê |
|---|---|
| destino de uma transferência (`counterparty_account`) | campo que o rascunho não sabe preencher — ver acima |
| conta que paga a fatura, quando CITADA (`counterparty_account` de `pay_invoice`) | idem |
| conta que paga a fatura, quando NÃO citada (`_conta_que_paga`, `app/tools/finance.py`) | é levantada dentro da tool, depois do gate, onde não há rascunho em que pendurar o clique; rotear o erro da `registry` para um rascunho é mecanismo novo |
| **categoria** | é texto livre que o modelo normaliza, não registro cadastrado. Um seletor de 25 categorias dentro da conversa é exatamente o *"aparecer tudo"* que o dono do produto pediu para evitar |

## Proteção de propriedade (IDOR)

**O serviço conecta no Postgres com papel que IGNORA RLS** (`auth.uid()` é null). Tudo que o banco
garantia sozinho virou responsabilidade do código:

- Toda leitura e toda escrita filtra por `workspace_id`.
- Todo id vindo do modelo passa por `ensure_owned()` (`app/tools/base.py`) antes de virar
  argumento de RPC. As RPCs públicas (`goal_deposit`, `pay_invoice`, ...) são `security invoker` e
  confiavam na RLS — chamadas daqui, **não checam nada**.
- Rota chamada pelo app tira o usuário do **`sub` do JWT**, nunca do corpo. A `import-statement`
  antiga lia `user_id`/`workspace_id` do corpo do POST: qualquer autenticado importava para o
  workspace de outro. Não repetir.
- Nome de tabela nunca vem do modelo — só de allowlist literal.

## Concorrência e idempotência

- **Uma conversa, um worker.** `claim_thread_batch` recusa thread com `processing` recente (5 min
  = worker morto). O advisory lock sozinho não serve: ele é transacional e solta antes de o Gemini
  responder.
- **O upsert de `user_sessions` tem árbitro em `phone`, nunca em `thread_id`.** A tabela tem duas
  restrições únicas e o `ON CONFLICT` só trata a que a query nomeia. Com árbitro em `thread_id`,
  trocar o `THREAD_SALT` viraria 23505 em toda mensagem de usuário existente. A análise completa
  está em comentário na `0040`, e as asserções em `supabase/tests/agent_migrations.sql` cobrem os
  cinco casos (inclusive 40 upserts paralelos no mesmo telefone novo).
- **Idempotência de entrada** por `messages_queue.wa_message_id` unique.
- **Idempotência de execução** por `executed_actions (wa_message_id, action_index)`, **reservada
  ANTES de executar** e liberada se falhar. A ordem é a correção do bug antigo: lá as ações
  rodavam e só depois o job era marcado done, então morrer no meio duplicava lançamento. Com a
  reserva antes, a pior consequência é a ação NÃO acontecer e o usuário remandar — para dinheiro,
  isso é melhor que gravar dois lançamentos que ele não pediu.
- **Retentativa não se mistura com mensagem nova** no mesmo lote: a chave de idempotência é o
  `wa_message_id` da última mensagem, e recompor o lote mudaria a chave.

## Debounce e custo

- **Nunca `asyncio.sleep` para debounce.** Quem espera os 3 segundos é o Cloud Tasks: cada
  mensagem cancela a task anterior da thread e agenda outra (janela deslizante). Timer em memória
  obrigaria instância sempre ligada.
- `/worker/sweep` roda junto do cron de lembretes: se o agendamento no Cloud Tasks falhar, a
  mensagem seria perdida em silêncio — que é o bug que esta arquitetura existe para matar.
- **Prompt caching não é alavanca aqui e não deve ser "otimizado".** O mínimo para cache implícito
  é 4.096 tokens nos modelos 3.5/3.6/3.7 Flash; os prompts por domínio têm ~800. Medido em
  30/08/2026.
- Router + domínio são **duas** chamadas por mensagem (a cota grátis do Flash-Lite é 500/dia).
  Os fast-paths determinísticos — saudação, resposta SIM/NÃO, documento anexo — existem para
  devolver parte disso.

## Portabilidade

Um container só, um processo só. `require_internal` aceita OIDC (Cloud Tasks/Scheduler) **ou**
`X-Internal-Secret` — é só isso que muda num VPS. Nenhuma lógica de negócio conhece o Cloud Run.

## Ambientes

**`agent/.env` é o STAGING e `agent/.env.production` é a produção** (invertido em 04/09/2026).
A regra é uma só: *o arquivo sem qualificador é o ambiente descartável*, porque tudo que não
escolhe ambiente — `docker compose up`, `env_file=".env"` do pydantic, `source` no terminal — lê
justamente esse. Produção tem nome próprio e só é lida por `setup-gcp.sh deploy|secrets`, que
pede confirmação explícita.

`THREAD_SALT` é o MESMO nos dois ambientes. Não é falha de segurança (`thread_id` só é chave
dentro de um banco, e os bancos são outros), mas se um dia for rotacionado, rotacione um de cada
vez e saiba que sessões e confirmações pendentes daquele ambiente recomeçam.

## Qualidade

`.venv/bin/pytest` verde antes de commitar. Teste que fala com rede ou banco não entra: os nós que
falam com o mundo são substituídos por dublês (`tests/test_hitl_flow.py`), e o resto é puro.
