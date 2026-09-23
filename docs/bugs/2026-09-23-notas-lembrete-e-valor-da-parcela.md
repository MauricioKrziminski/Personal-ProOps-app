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

**Correção.** Sair de uma nota que ficou vazia pergunta: descartar a edição (volta o texto de
quando a nota foi aberta — o autosave vai gravando pedaços enquanto se apaga, então "o último
gravado" já não é a nota) ou apagar a nota (lixeira, restaurável).

---

## Como cada um foi validado

| # | teste automatizado | no aparelho |
|---|---|---|
| 1 | `agent/tests/test_nota_e_pasta_no_mesmo_lote.py` — o grafo inteiro com os dois domínios, um banco de mentira que tem o unique da pasta: pasta+nota, "Portfólio" (duas notas), só cadastros, pasta que já existe. Os 4 falhavam antes (nota 3× na pergunta, "Não encontrei pasta", "Deu erro"). | Agente novo no **staging**; a conversa real ficou pendente — o Gemini gratuito do staging respondeu `503 high demand` o dia todo (nos dois modelos). |
| 2 | `finance-form.test.ts` (unidade, total por parcela, ida e volta sem centavo, nome da compra sem "(k/N)") | Android: tv 10× com a 1ª paga → "Cada parcela" R$ 250 gravou total 2.550, a paga intacta, datas e nomes preservados; "Total da compra" R$ 3.000 devolveu 10× 300. Criar em 3× com "Cada parcela" R$ 100 gravou 300. "Editar a compra" com a mesma escolha. |
| 3 | `note-blocks.test.ts` (`separarTitulo`/`juntarTitulo`, ida e volta — nada pula de campo ao reabrir) | iOS e Android, claro e escuro, 384dp × fonte 1,3. |
| 4 | `dates.test.ts` (`horaComoData`) | Android: relógio Material 3 nas cores do app, "Cancelar"/"OK"; calendário no lugar. iOS: roda nativa no lugar, teclado fecha ao abrir. |
| 5 | — | Android: "Criar lembrete" pela nota grava `note_id` no espaço da nota; a nota mostra o chip e o menu vira "Editar lembrete"; apagar o lembrete devolve "Criar lembrete". Migration aplicada no staging. |
| 6 | `note-blocks.test.ts` (`continuarLista`: marcador, numerada, recuo, autocorretor junto, sair no item vazio, colar não inventa) | iOS e Android. |
| 7 | — | iOS: esvaziar e voltar pergunta; "Descartar edição" devolve o texto de quando a nota abriu; "Apagar nota" manda para a lixeira; "Cancelar" continua editando. |

## Achados no caminho (corrigidos junto)

- **`Segmented` do Android com o polegar preso num quadro do meio** (bolinha solta / esticado
  sobre as duas células). Parado agora é uma `View` comum; a animada só existe durante a troca.
- **Toda animação de layout (`LinearTransition`) prendia a view na posição antiga no Android** —
  abrir o calendário deixava o "Repetir" por cima do próprio rótulo; abrir a lista de contas do
  lançamento deixava a data desenhada sobre as opções, e o toque nelas não chegava. Ponto único
  `transicaoDeLayout` (deslize no iOS, nada no Android) e trava no `anti-slop.test.ts`.
- **Enter no título com a ação "próximo" do Android perdia a primeira tecla do corpo** (o "-" de
  uma lista). O título deixou de usar ação de envio; o Enter chega como "\n".

## Revisão de design (depois das correções)

- A compra da parcela vem por **id** (`useInstallmentPlan`), não da lista limitada a 200; falhar
  vira card de erro com "Tentar de novo", nunca um campo travado com dica cinza.
- "Criar/Editar lembrete" pergunta de novo quando a consulta do lembrete ainda não chegou ou
  falhou (senão abria um segundo lembrete, que o banco recusa); a falha aparece na barra da nota.
- Nota criada e esvaziada na MESMA sessão só oferece a lixeira — não havia "como estava" para
  onde descartar. Um rótulo só: "Mandar para a lixeira".
- "Valor" é o rótulo nos três lugares; a unidade é dita pelo `Segmented` (lista única em
  `finance-form.ts`, com a mesma frase de recusa).
- "Quando" com vidro no iOS 26 (fechado), um haptic por toque, data por extenso no leitor de
  tela e o ano quando não é o corrente (`rotuloDoDia`).
- `Segmented`: molas em `Motion.spring`, e ligar/desligar o Reduce Motion com a tela aberta não
  prende mais o polegar animado.
- Conferido no Android: parcela abre e troca de unidade; o relógio abre na hora do campo (sem
  deslocamento de fuso); nota nova esvaziada → só "Mandar para a lixeira", e ela vai.

## Pendente

- Conversa real do bug 1 pelo agente de staging, quando o Gemini voltar.
- Produção: migration `20260923120000` ANTES do build/OTA do app (ver `CLAUDE.md`), e o agente
  novo (bug 1).
