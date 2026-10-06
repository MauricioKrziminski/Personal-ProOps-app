---
paths:
  - "agent/**"
---

# IA — Gemini (classificação) + Groq (áudio)

**Decisão imutável: a IA do produto é Google Gemini. Nunca usar Claude API.** STT é Groq Whisper.

## Onde vive

Tudo em `agent/` (o serviço Python). Mudança de comportamento da IA acontece nestes lugares e em
nenhum outro:

| O quê | Arquivo |
|---|---|
| Prompts por domínio + envelope `<user_input>` | `app/graph/prompts.py` |
| Schemas de saída (Pydantic) | `app/graph/schemas.py` |
| Cliente e modelos fixados | `app/services/gemini.py` |
| Nós e roteamento | `app/graph/nodes.py`, `app/graph/build.py` |
| O que exige confirmação | `app/graph/policy.py` |
| Execução das ações | `app/tools/` |

## Regras de chamada

- **Sempre saída estruturada** (`with_structured_output` com modelo Pydantic) — nunca parsear texto
  livre do modelo. É o schema que segura a saída, não a temperatura.
- `temperature: 0.1` está no código (`tests/test_schemas.py` confere). A medição de que o Lite a
  ignora foi no 3.5, que não está em uso: remeça no modelo da tabela antes de mexer nela.
- **Modelos FIXADOS, nunca alias `-latest`** — o alias já migrou sozinho e quebrou o parse em
  produção. Escolha de modelo aqui é **cota E risco**, não só qualidade:

  | papel | modelo | por quê |
  |---|---|---|
  | `router` / `parse` | `gemini-3.1-flash-lite` | duas chamadas por mensagem — é o volume |
  | `gate` | `gemini-3.7-flash` | só em resposta DIGITADA, e é o portão de segurança |
  | `batch` | `gemini-3.1-flash-lite` | extrato, lote inteiro numa chamada |

  **`GEMINI_ROUTER/PARSE/BATCH/GATE` (`app/services/gemini.py`) são os PAPÉIS** (`"router"`,
  `"parse"`, `"batch"`, `"gate"`), não nomes de modelo; o nome sai de `gemini.modelo(papel)`. Antes
  eram nomes, e três papéis com o mesmo modelo viravam `batch` no mapa reverso: `GEMINI_MODEL_PARSE`
  e `GEMINI_MODEL_ROUTER` NÃO trocavam nada e o consumo rotulava router e parse como batch (achado
  no E2E de 06/10/2026). Troca por ambiente: `GEMINI_MODEL_<PAPEL>`.

  **A divisão veio de medição, em 09/09/2026.** Entre 01 e 09/09 tudo ficou em `gemini-3.7-flash`
  (commit `bb927ea`, "upgrade"). Rodando `evaluate_answer_forms.py` inteiro no Lite: **86/94**, e
  uma das quedas é do lado que não pode cair — *"apaga todos"* voltou `approved: True`. As oito
  saem todas de `domain/confirm.py` e `domain/draft.py`, que chamavam o modelo PADRÃO; nenhuma é
  do router nem do parse. Daí `GEMINI_GATE`, que é o antigo `GEMINI_ESCALATE` finalmente ligado em
  alguma coisa. `tests/test_confirm_semantic.py` quebra se o portão cair para o padrão.

  **O Lite do parse é o 3.1, não o 3.5, e a diferença é DINHEIRO.** Em "48x de 1470" o
  3.5-flash-lite devolveu `705600` em vez de `7056000` — uma ordem de grandeza — em 1 de 3
  execuções. `parse_valor_em_centavos` **não** protege: a rede só entra quando a IA OMITE o valor,
  não quando ela erra. Medido em 15 amostras por modelo: 3.1-lite 15/15, 3.5-lite 14/15.
- **Confiança baixa NÃO escala para o modelo maior — ela pede confirmação.** O Flash tem 20
  requisições/dia no nível gratuito, e escalonamento automático estourava isso rápido; perguntar
  "confirma?" é grátis e, quando o modelo entendeu errado, é a resposta mais útil de qualquer
  forma.
- **Modelo FORA DO AR é outra coisa: router, parse e batch têm reserva no modelo do papel `gate`**
  (`gemini.structured` → `with_fallbacks`, 22/09/2026). O Lite respondeu `503 high demand` e
  `ReadTimeout` por horas, e sem reserva TODA mensagem virava "Não consegui processar". A reserva
  só roda quando a chamada FALHA — não é escalonamento por confiança, e não remover achando que
  é. **Custo a conhecer:** durante uma queda do Lite, todo turno de produção vai para o Flash
  (4,9× o preço, conta pré-paga). O **portão não tem reserva** de propósito: a reserva natural
  seria o Lite, medido aprovando "apaga todos". **Com reserva, o principal tem 10 s e nenhuma
  nova tentativa** (`PRAZO_COM_RESERVA`, 06/10/2026): com 30 s o Lite parado segurava a resposta e o
  "Montar lançamento" da voz levou 33,7 s. Lote de extrato e anexo usam `PRAZO_LONGO` (30 s); sem
  reserva (portão) continua 30 s e UMA nova tentativa (o Lite degradado levou
  15,7 s para "diga ok").

  **Disjuntor** (`gemini.py`, `FALHAS_PARA_ABRIR`): 3 falhas de disponibilidade em 60 s abrem o
  disjuntor por 120 s e o principal é pulado, indo direto à reserva. O motivo da reserva
  (`indisponivel` | `invalida`) vai nos metadados da chamada e em `ai_events.calls[].reserva_motivo`.

  **Raciocínio (`thinking_level`)**: o Lite mediu 0 token de raciocínio (06/10/2026), então router e
  parse não têm o que baixar. O `gemini-3.7-flash` (gate) roda em `medium` por padrão, cobrado como
  saída. `GEMINI_THINKING_<PAPEL>` (`minimal|low|medium|high`, `gemini.raciocinio`) liga o nível por
  papel; sem ela vale o padrão do modelo. **Baixar o gate só depois da seção de segurança do
  `evaluate_answer_forms.py` com a variável ligada** — é o portão do SIM.
- **Valor de dinheiro tem rede de segurança determinística.** Se a ação exige `amount_cents` e a
  IA omitiu, `parse_valor_em_centavos` (`app/domain/money.py`) tira do texto cru — mas só com UM
  número plausível. Nunca chutar entre dois: pedir para reformular é melhor que gravar errado.
- **O limite do schema é o PRODUTO propriedades × valores de enum, não cada um.** Medido contra a
  API real em 30/08/2026 (`agent/scripts/diagnose_finance_schema.py`, uma variável por vez):
  `15×22 = 330` recusa; `9×22 = 198`, `15×10 = 150` e `15×7 = 105` passam. Campos INTEGER são
  inocentes — a recusa é igual com tudo STRING. `tests/test_schemas.py` quebra o build se passar.

  **O antigo teto de 252 caiu em 06/10/2026**: medido no Gemini real (`gemini-3.1-flash-lite`,
  `method="json_schema"`, o do langchain-google-genai 4.3.7; o de agosto era outro método de envio)
  passaram 24×14 = 336 (com e sem `anyOf` null), 30 e 36 propriedades sem null e 36×20 = 720.
  `tests/test_schemas.py` prende o produto exato de cada schema e o teto medido (720). O Lite usa 0
  tokens de raciocínio. A reserva (modelo do papel `gate`) deve ser medida antes de crescer mais.
  Antes de somar campo, rode o probe (`probe_rename_schema.py`, `diagnose_finance_schema.py`): a
  recusa é um `400 INVALID_ARGUMENT` sem detalhe, e estimar aqui já custou uma quebra em produção.
  `ResourceAction` segue em 5×5 e aceita campo novo de graça; capacidade nova também sai por ALVO
  resolvido (foi assim que quitar fatura sem caixa virou `mark_paid`). Ver
  `docs/AGENTE-PARIDADE-COM-O-APP.md`.
- **A ORDEM das propriedades é a ordem em que o Gemini ESCREVE** (`json_schema`, decodificação
  restrita): passada uma chave, ele não volta a uma anterior. Campo que ANCORA o sentido de uma ação
  vem antes dos dados dela. `target_ref` ficava depois de valor e conta: o aporte em meta, que o
  modelo começa pela meta, saía sem valor e sem conta — **1/12 → 12/12** ao mover o campo para logo
  depois de `type` (06/10/2026, defeito que já estava na base). Campo novo entra pensando nisso.
- Por isso Finanças são **dois** schemas: escrita/correção (`FinanceAction`: 22 campos × 14 = 308) e consulta (`FinanceQuery`: 13 × 13 = 169, com `continua_anterior` e `mostrar`; medido em 06/10/2026). Escrita e
  correção ficam juntas de propósito — separá-las obrigaria o router a decidir se "o mercado de
  ontem foi 120" é lançamento novo ou correção, e errar isso cria a duplicata que o produto
  inteiro luta para evitar.
- A crença anterior ("15 propriedades e UM enum") estava errada nos dois números e custou uma
  recusa em produção. Antes de somar campo, rode o diagnóstico — não estime.
- Objeto flat, sem `anyOf`/union (o structured output do Gemini lida mal). Multi-intent continua:
  uma ação por item da mensagem, máx. 10, e o router devolve LISTA de domínios para
  "gastei 45 e me lembra do aluguel" não perder metade.
- **Forma de pagamento, fixo/variável, essencial e detalhe saem do PARSE PRINCIPAL** (06/10/2026):
  quatro campos opcionais do `FinanceAction` (`payment_method`, `expense_pattern`,
  `expense_necessity`, `detalhe`), validados e congelados em `tools/atributos.congelar` (chamada de
  `resolve_node`, sem modelo). Eram uma segunda chamada (`AtributosLote`) só porque o schema não
  cabia mais campo. O que o modelo propõe só vale se a frase sustenta (ancoragem em
  `domain/atributos`: um Pix que a frase não disse é descartado; detalhe sem "detalhe X" só vale com
  o nome exato de um existente); falha do banco lança SEM atributos. Não roda em consulta,
  transferência, pagar fatura nem correção. Sonda: `scripts/probe_atributos_lote_c.py`; seções
  `loteC/*` do `evaluate_answer_forms.py`.
- Sem segunda chamada de LLM para formatar resposta de consulta — a saída do WhatsApp é template
  Python puro (`cents_to_brl`). Um modelo escrevendo "você gastou aproximadamente" em cima de um
  valor exato é alucinação com custo extra.
- Retry: `max_retries` do `ChatGoogleGenerativeAI` (429/5xx).

## Correção (nunca criar para "consertar")

- Corrigir item existente é `update_transaction` / `delete_transaction`, nunca um lançamento novo.
  O prompt diz isso explicitamente.
- Campos de BUSCA (`amount_cents`, `category`, `description`, `occurred_at`) são separados dos de
  CORREÇÃO (`new_amount_cents`, `new_category`, `new_occurred_at`, `new_description`,
  `new_account`) — sem isso o modelo confunde "era 45, virou 54". Em `new_description` a confusão
  é pior e silenciosa: o modelo procuraria pelo nome que o usuário AINDA NÃO DEU, e a correção
  volta vazia. `scripts/probe_rename_schema.py` mede a separação com o Gemini real, em quatro
  redações diferentes.
- `resolve.por_transacao` procura na janela dos 40 mais recentes (`finance.reference_window`).
  **Empate pergunta, não chuta**: alterar o lançamento errado é pior que uma mensagem a mais.
  (A cópia morta `finance.resolve_transaction` foi apagada em 15/09/2026 — ela tinha o mesmo
  defeito abaixo e zero chamadores.)

  **Termo que o usuário DEU e não casa com nada é "não achei", nunca "então toma a lista".**
  O filtro por texto tinha uma guarda legítima — termo que não bate não pode ZERAR uma busca que
  já achou por valor — e ela estava escrita como `if por_texto:` sem `else`: quando o termo era a
  ÚNICA pista, o filtro se descartava em silêncio, `filtrou` ficava `False` e a função caía na
  janela inteira. Medido em produção em 15/09/2026: *"remove o lançamento nuuvem"* devolveu IOF do
  rotativo, dentista, cabeleireiro e dois planos de parcelamento, e a queixa foi literal — *"ele
  nunca deve generalizar algo que eu especifiquei"*. A lista era o ramo MENOS perigoso: com
  recência junto ("apaga o último da nuuvem") o mesmo `filtrou=False` devolvia `found` na
  transação mais recente, ou seja, um DELETE confirmado com uma frase nomeando outro lançamento.
  Hoje é `elif not filtrou: return "none", []`, no ramo do texto **e** no da data, e o `elif`
  guarda o caso para o qual a guarda foi escrita.

  **E o "não achei" CITA o termo** (`registry._sem_alvo`). "Não achei esse item por aqui" é a
  frase de quem não apontou nada; devolvê-la a quem escreveu um nome faz a pessoa remandar a mesma
  mensagem. O termo sai de `resolve.termo_de`, que é o MESMO caminho que `for_actions` usa para
  resolver — duas cadeias de campos divergiriam, e divergir aqui é a frase voltar a ser genérica.

## Auditoria e custo

- 💸 **Como NÃO gastar enquanto testa** (11/09/2026). O que custa não é a quantidade de
  chamadas, é o MODELO: o Flash-Lite tem **500 requisições/dia** grátis e o Flash tem **20**.
  Uma execução de `evaluate_answer_forms.py` manda ~40 no gate (Flash) — da segunda execução
  do dia em diante, ela inteira é paga. Três execuções num dia consumiram quase todo o
  crédito da conta.

  **A escolha de modelo mora em UM lugar: `gemini.MODELOS`**, uma tabela por PAPEL (`router`,
  `parse`, `batch`, `gate`), lida por `gemini.modelo(papel)`. `GEMINI_MODEL_<PAPEL>` troca o
  modelo daquele papel sem tocar no código — vazias em produção, e `modelo()` grava WARNING
  quando estão ligadas, porque modelo trocado em silêncio é medição que deixa de valer sem
  ninguém perceber. Papel desconhecido levanta, em vez de cair num default.

  **Não existe modelo global, e ele não volta.** Um `GEMINI_MODEL` (ou `settings.gemini_model`)
  lido antes do papel já tirou router e parse do Lite (500/dia grátis) para o Flash (20/dia) em
  silêncio e, noutra vez, levou o gate de confirmação para o Lite em produção — a combinação que
  a suíte reprova (o Lite aprova "apaga todos"). A troca de modelo é por papel
  (`GEMINI_MODEL_<PAPEL>`), e `tests/test_schemas.py` quebra o build se um nome de modelo
  aparecer fora da tabela.

  | quando | comando |
  |---|---|
  | iterando em prompt | `evaluate_answer_forms.py --secao <x> --barato` (gate no Lite, de graça) |
  | a execução que APROVA | `evaluate_answer_forms.py`, sem flag, **uma vez** |
  | sonda de turno inteiro | `probe_pergunta_ou_supoe.py` — já é toda Lite |

  **NEM `ai_events` NEM o Langfuse enxergam as suítes — só a fatura enxerga** (medido em
  15/09/2026). Entre 08 e 11/09 a API do Gemini recebeu **5.923 chamadas** (Cloud Monitoring,
  `serviceruntime.googleapis.com/api/request_count` no projeto `gen-lang-client-0373931877`) e o
  Langfuse traçou **~500**: os scripts de avaliação e os `probe_*` chamam o modelo fora do grafo,
  então não passam pelo handler de tracing. Ler "o Langfuse diz US$ 0,83 no mês" como se fosse o
  gasto é como a conta some. Custo real: console de faturamento da conta `01ED4C-C3849B-0169D7`
  (Relatórios, por serviço e SKU) ou o export para o BigQuery.

  📏 **Unidade oficial, conferida em 15/09/2026** contra `ai.google.dev/gemini-api/docs/pricing` —
  e o Langfuse bate na sexta casa decimal, então a tabela DELE serve de calculadora (só não serve
  de auditoria, pelo motivo acima): `gemini-3.1-flash-lite` US$ 0,25/1,50 por 1 M de tokens
  (in/out) = **US$ 0,000459/chamada**; `gemini-3.7-flash` US$ 0,75/3,75 = **US$ 0,002253/chamada**,
  4,9× mais caro. Medido no E2E de 06/10/2026, um turno de gasto
  (router 1.939 tokens de entrada + `finance_parse` 4.521 = 6.460 de entrada, 106 de saída) custa
  **US$ 0,001774** no Lite. O prompt v2 (`AGENT_PROMPT_V2`, padrão desligada) estima o parse de um
  gasto simples em ~1.525 tokens contra 4.080 do v1 (`scripts/comparar_prompts.py --so-prompts`).

  **A execução que APROVA não cabe num dia com a chave do staging** (medido em 23/09/2026).
  Desde 21/09 o `agent/.env` usa um projeto SEM faturamento (a cota grátis vale por projeto): o
  Flash dá **20 chamadas/dia** e a suíte manda ~40 ao gate. Na rodada de 23/09 vieram 49 × `429
  RESOURCE_EXHAUSTED` no `gemini-3.7-flash` e o gate caiu no "não aprovado" de segurança — 95/148,
  todas as 53 falhas eram 429 ou `503` do Lite, nenhuma resposta errada. Para aprovar: dividir por
  `--secao` em dias diferentes, ou rodar UMA vez com uma chave de projeto com faturamento, por
  decisão do Gabriel (nunca a de produção por engano). E a cota é a mesma do agente do staging:
  esgotada pela suíte, as confirmações digitadas no staging também caem no "não aprovado" até
  a cota voltar.

  **`--barato` não aprova nada.** O gate está no Flash porque o Lite FOI MEDIDO e reprova
  8 dos 94 casos — e uma das quedas é do lado que não pode cair ("apaga todos" voltou
  `approved: True`). Ler 86/94 do modo barato como regressão é perder tempo; lê-lo como
  aprovação é pior.

  Toda sonda imprime quantas chamadas vai fazer ANTES de fazer.

  **No nível gratuito as avaliações tentam de novo em 503/429** (`scripts/eval_cache.com_paciencia`,
  06/10/2026). Se um modelo estiver sem cota, troque-o por papel com `GEMINI_MODEL_<PAPEL>` em vez
  de reexecutar a suíte inteira.

- **Cache: nenhuma das duas formas vale hoje** (medido em 06/10/2026). O cache IMPLÍCITO deu 0
  `cached_tokens` em chamadas repetidas com o mesmo prefixo de ~1.875 tokens no 3.1-flash-lite. O
  EXPLÍCITO tem limite de armazenamento ZERO no nível gratuito (`429
  TotalCachedContentStorageTokensPerModelFreeTier limit=0`). Break-even estimado do explícito:
  ~107 chamadas/dia por versão de prompt (US$ 0,025/M em cache contra 0,25/M, armazenamento US$ 1/M
  tok/h). **Decisão: não construir camada de cache explícito agora.**
  `agent/scripts/agent_metrics.py` imprime as chamadas/dia por versão de prompt contra o
  break-even (`BREAK_EVEN_CHAMADAS_DIA`); quando uma versão passar dele, reavalie.

- **O custo NÃO está no tráfego, está nas suítes.** Em 09/09/2026 a produção tinha 29 chamadas
  em `ai_events` desde que existe, e o staging 130 — e mesmo assim 04/09 custou R$ 10. Quem gasta é
  `evaluate_answer_forms.py` (~94 chamadas por execução) mais os `probe_*`, e **nenhum deles grava
  em `ai_events`**: não aparecem em contagem nenhuma. Com o gate em Flash, cada execução completa é
  paga. Rode a suíte **uma vez, no fim**, e use `--secao` enquanto estiver iterando.

  ⏱️ **Ela passou de ~90s para ~8 min** depois da divisão de modelos: o Flash tem **5 RPM** e a
  seção de confirmação/rascunho tem ~40 casos, todos no gate. Não é travamento — é a cota. Espere
  o processo terminar em vez de reexecutar; duas execuções em paralelo custam o dobro e uma delas
  é jogada fora (aconteceu em 09/09/2026).
- **Todo parse que CHAMOU o modelo grava linha em `ai_events`** (`llm_calls > 0` no estado do
  grafo). Isso não é só auditoria: `private.plan_status_for` **conta essas linhas** para saber
  quantas mensagens de IA o workspace gastou no mês. Não gravar derruba o paywall em silêncio, e
  contar fast-path (saudação, SIM/NÃO) cobraria mensagem que não gastou token.
  A linha tem `cached_tokens`, `reasoning_tokens`, `estimated_cost_usd`, `calls` (jsonb por
  chamada: papel, nó, versão do prompt, modelo real, tokens, custo, reserva, `reserva_motivo`),
  `kind` (só `turn` conta na cota) e `reserved` (reserva atômica de cota sob advisory lock; solta se
  o turno não usou modelo). **Custo de modelo sem preço na tabela é `None`, nunca chutado.**
- Tracing detalhado (nós, arestas, tools, tokens) vai para o **Langfuse**. **Só isso: `ai_events` não é tela.** Havia uma "Atividade da IA" listando modelo, confiança em % e as ações geradas, mais um bloco igual no detalhe do lançamento; os dois foram removidos em 30/08/2026. Nome de modelo e confiança são telemetria de quem CONSTRÓI o produto, e mostrar isso pede ao usuário que audite a IA em vez de confiar nela. O que o usuário precisa é ver o item certo e poder corrigi-lo onde ele mora — o que já existe no próprio item e no `undo_last` do WhatsApp.
- Duas camadas, com propósitos diferentes, ambas em `conversation.check_limits` (chamada por `app/worker.py`), **antes** de
  gastar Groq/Gemini: a **hora** protege o custo contra rajada (contagem em `ai_events`); o **mês**
  é o produto (`_plan_status`). Estourou → responde e marca a mensagem done.
- **Nunca dormir esperando 429 dentro do worker**: prende a conversa em `processing`. Falha rápido
  — o retry do Cloud Tasks e o sweep de 1 minuto são o backoff.

## Prompt (convenções de conteúdo)

- Português informal BR; datas relativas ("ontem", "todo dia 5") resolvidas pelo modelo usando a
  data/hora LOCAL do usuário, injetada no turno humano por `local_datetime_iso` — nunca em UTC (o
  modelo erra perto da meia-noite).
- Categorias: curtas, minúsculas, da lista sugerida — texto livre, sem FK. Fonte no Python:
  `app/domain/categories.py`.
- Recorrência sempre como **RRULE** (`FREQ=MONTHLY;BYMONTHDAY=5`) — mesmo formato dos reminders.
- Dinheiro sempre `amount_cents` inteiro ("45 reais" → 4500).

## Embeddings e few-shot (06/10/2026)

- Modelo `gemini-embedding-2`, 768 dimensões normalizadas. **Nível gratuito: 100 requisições/min de
  embedding, e CADA texto de um lote conta como uma.**
- **Busca semântica de lançamento** (`resolve._por_semantica`) sobre `transaction_embeddings`
  (preenchida por um job no cron de lembretes): `SIMILARIDADE_MINIMA = 0.64` e `FOLGA_MINIMA = 0.05`,
  calibrados com `scripts/probe_busca_semantica.py`.
- **Few-shot dinâmico, só com `AGENT_PROMPT_V2`**: banco sintético `app/graph/exemplos.json` (115
  frases) com vetores PRÉ-GERADOS em `app/graph/exemplos_vetores.json` (float16 base64) por
  `scripts/vetorizar_exemplos.py`; o teste acusa arquivo defasado. Piso `SIMILARIDADE_MINIMA = 0.62`
  (em `app/graph/exemplos.py`), calibrado por `scripts/probe_exemplos.py`: domínio 0,640–0,972, fora
  0,508–0,771 — as faixas se sobrepõem, e quem desvia o que não é finanças é o router. Uma chamada
  de embedding por turno.
- **Router por embedding: avaliado e RECUSADO.** Exemplos sintéticos decidindo roteamento é regra
  por caso, e o router no Lite custa ~US$ 0,0005/turno — não é o centro de custo.

## Imagem e PDF (multimodal)

- Foto de cupom, print de Pix e PDF de fatura entram no **mesmo nó de domínio e no mesmo schema** —
  nunca um segundo prompt só para imagem. Limite de 8MB e MIME na allowlist (`VISION_MIME` em
  `app/worker.py`). A mídia chega ao Gemini pelo `config["configurable"]` (`CHAVE_MIDIA`) e vira
  parte `file` base64 no turno humano; o download recusa mídia acima de 16 MiB
  (`MidiaGrandeDemais`) com mensagem à pessoa. Anexo pula o router e vai direto para finanças (é quase sempre cupom/fatura).
- Importação de extrato (OFX/CSV) tem prompt próprio e enxuto: `gemini.classify_statement_lines` manda o lote
  INTEIRO numa chamada e recebe um array na mesma ordem. O índice é o contrato.
- **Regra do usuário ganha da IA**: `_match_rule` roda depois do parse (WhatsApp) e antes do Gemini
  (importação, economizando chamada). É a resposta à queixa de "categorizou errado e não dá para
  consertar". Não se aplica a ação de NOTA: lá `folder` é pasta e `search_term` é busca, e deixar
  a regra reescrever isso trocaria a pasta pedida e a consulta voltaria vazia, em silêncio.

## Áudio

- `type == "audio"` → `download_media` (Meta) → `groq.transcribe` (`whisper-large-v3-turbo`,
  `language=pt`) → o texto segue o fluxo normal. A extração acontece no **worker, antes do grafo**:
  URL de mídia da Meta expira, e um resume de HITL horas depois não conseguiria baixar de novo.
