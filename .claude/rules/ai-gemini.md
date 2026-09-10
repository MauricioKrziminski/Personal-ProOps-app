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

Os equivalentes em Deno (`_shared/gemini.ts`, `process-jobs/index.ts`) foram **apagados** em
09/09/2026. Ver `.claude/rules/agent.md`.

## Regras de chamada

- **Sempre saída estruturada** (`with_structured_output` com modelo Pydantic) — nunca parsear texto
  livre do modelo. É o schema que segura a saída, não a temperatura.
- `temperature: 0.1` continua no código mas o **Flash-Lite 3.5 a IGNORA** ("uses fixed sampling
  defaults", medido em 30/08/2026). Não gaste tempo ajustando temperatura neste modelo.
- **Modelos FIXADOS, nunca alias `-latest`** — o alias já migrou sozinho e quebrou o parse em
  produção. Escolha de modelo aqui é **cota E risco**, não só qualidade:

  | constante | modelo | por quê |
  |---|---|---|
  | `GEMINI_ROUTER` / `GEMINI_PARSE` | `gemini-3.1-flash-lite` | duas chamadas por mensagem — é o volume |
  | `GEMINI_GATE` | `gemini-3.7-flash` | só em resposta DIGITADA, e é o portão de segurança |
  | `GEMINI_BATCH` | `gemini-3.1-flash-lite` | extrato, lote inteiro numa chamada |

  **A divisão veio de medição, em 09/09/2026.** Entre 01 e 09/09 tudo ficou em `gemini-3.7-flash`
  (commit `bb927ea`, "upgrade"). Rodando `evaluate_answer_forms.py` inteiro no Lite: **86/94**, e
  uma das quedas é do lado que não pode cair — *"apaga todos"* voltou `approved: True`. As oito
  saem todas de `domain/confirm.py` e `domain/draft.py`, que chamavam o modelo PADRÃO; nenhuma é
  do router nem do parse. Daí `GEMINI_GATE`, que é o antigo `GEMINI_ESCALATE` finalmente ligado em
  alguma coisa. `tests/test_confirm_semantic.py` quebra se o portão cair para o padrão.

  ⚠️ **O Lite do parse é o 3.1, não o 3.5, e a diferença é DINHEIRO.** Em "48x de 1470" o
  3.5-flash-lite devolveu `705600` em vez de `7056000` — uma ordem de grandeza — em 1 de 3
  execuções. `parse_valor_em_centavos` **não** protege: a rede só entra quando a IA OMITE o valor,
  não quando ela erra. Medido em 15 amostras por modelo: 3.1-lite 15/15, 3.5-lite 14/15.
- **Confiança baixa NÃO escala para o modelo maior — ela pede confirmação.** O Flash tem 20
  requisições/dia no nível gratuito, e escalonamento automático estourava isso rápido; perguntar
  "confirma?" é grátis e, quando o modelo entendeu errado, é a resposta mais útil de qualquer
  forma.
- **Valor de dinheiro tem rede de segurança determinística.** Se a ação exige `amount_cents` e a
  IA omitiu, `parse_valor_em_centavos` (`app/domain/money.py`) tira do texto cru — mas só com UM
  número plausível. Nunca chutar entre dois: pedir para reformular é melhor que gravar errado.
- **O limite do schema é o PRODUTO propriedades × valores de enum, não cada um.** Medido contra a
  API real em 30/08/2026 (`agent/scripts/diagnose_finance_schema.py`, uma variável por vez):
  `15×22 = 330` recusa; `9×22 = 198`, `15×10 = 150` e `15×7 = 105` passam. Campos INTEGER são
  inocentes — a recusa é igual com tudo STRING. `tests/test_schemas.py` quebra o build se passar.

  **O teto do `FinanceAction` subiu duas vezes, sempre MEDINDO**: 238 (`probe_bounded_installments`,
  08/09/2026) e **252 com soma 32** (`probe_rename_schema.py`, 09/09/2026, ao somar
  `new_description`). Os outros schemas seguem em 198/31. Antes de somar campo, rode o probe — a
  recusa é um `400 INVALID_ARGUMENT` sem detalhe, e estimar aqui já custou uma quebra em produção.

  **252 é o TETO, não um degrau.** Em 09/09/2026 as duas ampliações possíveis foram medidas e
  recusadas: 19×14 = 266 (uma propriedade a mais) e 18×15 = 270 (um valor de enum a mais).
  `FinanceAction` está cheio — capacidade nova ali sai por ALVO resolvido (foi assim que quitar
  fatura sem caixa virou `mark_paid` sobre `card_invoices`) ou pelo catálogo de `ResourceAction`,
  que segue em 5×5 e aceita campo novo de graça. Ver `docs/AGENTE-PARIDADE-COM-O-APP.md`.
- Por isso Finanças são **dois** schemas: escrita/correção (13×14) e consulta (7×9). Escrita e
  correção ficam juntas de propósito — separá-las obrigaria o router a decidir se "o mercado de
  ontem foi 120" é lançamento novo ou correção, e errar isso cria a duplicata que o produto
  inteiro luta para evitar.
- A crença anterior ("15 propriedades e UM enum") estava errada nos dois números e custou uma
  recusa em produção. Antes de somar campo, rode o diagnóstico — não estime.
- Objeto flat, sem `anyOf`/union (o structured output do Gemini lida mal). Multi-intent continua:
  uma ação por item da mensagem, máx. 10, e o router devolve LISTA de domínios para
  "gastei 45 e me lembra do aluguel" não perder metade.
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
- `resolve_transaction` (`app/tools/finance.py`) procura na janela dos 40 mais recentes. **Empate
  pergunta, não chuta**: alterar o lançamento errado é pior que uma mensagem a mais.

## Auditoria e custo

- ⚠️ **O custo NÃO está no tráfego, está nas suítes.** Em 09/09/2026 a produção tinha 29 chamadas
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
- Tracing detalhado (nós, arestas, tools, tokens) vai para o **Langfuse**. **Só isso: `ai_events` não é tela.** Havia uma "Atividade da IA" listando modelo, confiança em % e as ações geradas, mais um bloco igual no detalhe do lançamento; os dois foram removidos em 30/08/2026. Nome de modelo e confiança são telemetria de quem CONSTRÓI o produto, e mostrar isso pede ao usuário que audite a IA em vez de confiar nela. O que o usuário precisa é ver o item certo e poder corrigi-lo onde ele mora — o que já existe no próprio item e no `undo_last` do WhatsApp.
- Duas camadas, com propósitos diferentes, ambas em `_check_limits` (`app/worker.py`), **antes** de
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

## Imagem e PDF (multimodal)

- Foto de cupom, print de Pix e PDF de fatura entram no **mesmo nó de domínio e no mesmo schema** —
  nunca um segundo prompt só para imagem. Limite de 8MB e MIME na allowlist (`VISION_MIME` em
  `app/worker.py`). Anexo pula o router e vai direto para finanças (é quase sempre cupom/fatura).
- Importação de extrato (OFX/CSV) tem prompt próprio e enxuto: `categorize_batch` manda o lote
  INTEIRO numa chamada e recebe um array na mesma ordem. O índice é o contrato.
- **Regra do usuário ganha da IA**: `_match_rule` roda depois do parse (WhatsApp) e antes do Gemini
  (importação, economizando chamada). É a resposta à queixa de "categorizou errado e não dá para
  consertar". Não se aplica a ação de NOTA: lá `folder` é pasta e `search_term` é busca, e deixar
  a regra reescrever isso trocaria a pasta pedida e a consulta voltaria vazia, em silêncio.

## Áudio

- `type == "audio"` → `download_media` (Meta) → `groq.transcribe` (`whisper-large-v3-turbo`,
  `language=pt`) → o texto segue o fluxo normal. A extração acontece no **worker, antes do grafo**:
  URL de mídia da Meta expira, e um resume de HITL horas depois não conseguiria baixar de novo.
