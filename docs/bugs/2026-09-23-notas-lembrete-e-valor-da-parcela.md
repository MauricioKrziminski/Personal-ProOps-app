# 23/09/2026 — notas pelo WhatsApp, editor de nota, lembrete e valor da parcela

Sete queixas do dono do produto num lote só. Cada uma com a causa raiz ANTES da correção,
e como foi reproduzida.

## 1. "Crie a pasta X e ponha a nota Y" pelo WhatsApp: pergunta repetida, erro e nota fora da pasta

**Sintoma.** A confirmação listava a mesma nota duas vezes ("criar a nota «Y» na pasta app;
criar pasta App — nome: app; criar nota Y — conteúdo: Y"). Depois do SIM: "❌ Deu erro ao
processar uma parte da mensagem" e uma segunda nota Y **sem pasta**. No caso "Portfólio", duas
linhas "Não encontrei pasta nesse espaço" antes das notas.

**Prova (produção, `ai_events`, só leitura).** 04:43:58 e 04:47:38 UTC: `domains =
["cadastros", "notas"]`. O roteador acertou — a frase tem uma pasta (cadastro) e uma nota
(notas). O erro é depois dele.

**Causa raiz.** Os dois extratores rodam em paralelo sobre o MESMO texto e cada um extraiu a
mensagem inteira, não só a sua parte:

- `notas` → `create_note(folder="app")`. `notes.create_note` cria a pasta sozinho
  (`ensure_folder`, `on conflict do update`).
- `cadastros` → `resource_create folders "App"` **e** `resource_create notes "Y"`.

Criar nota existe nos dois catálogos (`NotesAction.create_note` e `ResourceAction` com
`resource=notes`), e nada decidia quem é o dono. Daí:

1. a nota em dobro (a do cadastro sem `folder_id` → "fora da pasta");
2. o erro: `_executar` roda notas antes de cadastros, então `ensure_folder` cria "app" e o
   `insert` do `resource_create folders "app"` bate no unique `(workspace_id, name)` → exceção
   genérica → "Deu erro ao processar uma parte";
3. "Não encontrei pasta": o cadastro de nota com `folder_id = "portfólio"` procura a pasta no
   `prepare`, ANTES de a pasta do mesmo lote existir — e a recusa ainda virava
   `resource_draft`, envenenando o turno seguinte com um "cadastro incompleto".

**Correção.**
- Nota e lembrete NOVOS têm um dono só: com `notas` no lote, o nó de cadastros descarta o
  `resource_create` de `notes`/`reminders` que o modelo tenha devolvido (regra de estrutura, não
  de texto).
- Pasta criada no mesmo lote roda ANTES de tudo (`_executar`, índice original preservado para a
  idempotência) — a nota do lote cai nela.
- Pasta que JÁ existe não é erro de execução: o `prepare` avisa ("já existe") sem virar rascunho.
- Cadastro de nota (quando só `cadastros` veio) com pasta que ainda não existe cria a pasta na
  execução, como `create_note` já fazia.

## 2. Valor do lançamento parcelado não edita; falta "valor da parcela"

**Sintoma.** No formulário do lançamento "wardogs" (uma parcela), o campo Valor parece
desabilitado. E só existe "valor total" para compra parcelada.

**Causa raiz.** O campo é `readOnly` de propósito quando a linha é parcela
(`valorTravado = Boolean(editing?.installment_plan_id)`), porque o número digitado ali era
ambíguo: a pessoa digitava o TOTAL num campo que era da PARCELA, e o escopo "esta e as futuras"
recalculava o total para uma compra que nunca existiu. A saída era um botão "Editar a compra
parcelada" que leva a outra tela — que a pessoa não achou.

A ambiguidade é o problema real, e a trava tratava o sintoma. Resolver a ambiguidade é deixar a
pessoa DIZER o que o número é.

**Correção.** Valor editável, com a unidade explícita (**Valor da parcela | Valor total**):
- editando uma parcela: a mudança de valor vira edição da COMPRA pela
  `update_installment_plan` (a mesma RPC do agente e de Parceladas, que respeita parcela
  paga/travada). "Parcela" = cada parcela em aberto passa a valer X;
- criando/convertendo em N×: "Parcela" = total X·N;
- em "Editar a compra" (Parceladas): a mesma escolha.

Receita parcelada não existe no produto (a RPC só parcela gasto no cartão/conta) — fica fora.

## 3. Título da nota sem espaço próprio

**Sintoma.** No modo edição, a nota é um `TextInput` só: a primeira linha (título) tem a mesma
cara do corpo, sem separação.

**Correção.** Campo de título próprio acima do corpo, no desenho do Notes do iPhone (título
grande e forte, corpo normal). O dado continua sendo `notes.content` (primeira linha = título),
então WhatsApp, busca e lista não mudam.

## 4. "Quando" do lembrete

**Sintoma.** Chips de data + seletor espremido (a data nem aparecia: `flex: 1` numa fileira
com `wrap` dá largura zero ao texto) e chips de hora + um campo de texto sem máscara. Com o
campo apagado não dá para digitar a hora: o teclado numérico do iPhone não tem ":", e
`isValidTime` exige `HH:MM`.

**Correção.** Bloco redesenhado: duas linhas (Data / Hora) com o valor à direita; a data abre o
calendário no lugar e a hora abre o seletor nativo (roda no iOS, relógio Material 3 no
Android). Sem chips.

## 5. Nota com lembrete ainda oferece "Criar lembrete"

**Causa raiz.** Não existe vínculo entre nota e lembrete: o menu só passava o título.

**Correção.** `reminders.note_id` (migration), um lembrete por nota; com lembrete, o menu diz
"Editar lembrete" e a nota mostra o lembrete.

## 6. Enter numa lista não continua a lista

**Correção.** Enter depois de um item (`- `, `- [ ] `, `1. `) abre o próximo item do mesmo
tipo (numerada incrementa); Enter num item vazio sai da lista — como no Notes.

## 7. Nota esvaziada: sair sem perguntar

**Causa raiz.** O autosave se recusa a esvaziar uma nota que tinha texto (`would-empty`, a trava
contra perda de dado de 28/08/2026). Correto, mas silencioso: a pessoa apagava tudo, saía, e a
nota voltava com o texto antigo sem explicação.

**Correção.** Sair de uma nota que ficou vazia pergunta: descartar a edição (o texto antigo
fica) ou apagar a nota (lixeira).
