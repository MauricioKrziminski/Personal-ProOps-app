# Auditoria do agente de IA — 06/10/2026

Escopo: `agent/app` inteiro (~22 mil linhas), o grafo LangGraph, os prompts e schemas do Gemini,
a fila, o HITL, as rotas e a operação. Somente leitura: nada foi alterado.

**Como ler.** Cada achado diz **conferido** (li o código e reproduzi o raciocínio na fonte) ou
**reportado** (levantamento feito por leitura dirigida, sem eu ter reaberto o trecho). Os
CRÍTICOS e ALTOS estão todos conferidos, salvo onde o texto diz o contrário.

---

## 1. Veredito da arquitetura (a pergunta principal)

**A forma está certa e é a boa prática para um agente que mexe em dinheiro.** Modelo entende →
devolve objeto tipado → código fechado valida e executa → humano aprova a escrita. Essa é a
camada que você colocou "no meio" entre o prompt e o banco, e ela NÃO é o que deixa o agente
burro: é o que impede uma alucinação de virar lançamento. Tool-calling livre, em que o modelo
escolhe e executa funções em sequência, seria pior aqui, não melhor.

O que deixa o agente burro hoje são duas coisas pontuais:

1. **Um lugar onde listas de palavras passam por cima do que o modelo entendeu**:
   `query_transactions` (C2 abaixo). É a única violação real da regra que o próprio projeto
   escreveu ("padrão valida estrutura, nunca infere sentido").
2. **O teto de 252 do `FinanceAction` está forçando significado por convenção**:
   `installments == 1` quer dizer "desparcelar", `BYMONTHDAY=-1` quer dizer "último dia", e
   forma de pagamento, fixo/variável, essencial e subcategoria precisaram de uma SEGUNDA chamada
   de LLM (`tools/atributos.py`) só porque não cabiam no schema. O schema é a causa raiz, e há
   saída barata (seção 4).

O resto — HITL, idempotência, resolução de alvo, `ensure_owned`, envelope anti-injeção, modelo
por papel, reserva de disponibilidade — está acima da média do que se vê em produção.

---

## 2. Achados por severidade

### CRÍTICO

**C1. Imagem e PDF nunca chegam ao Gemini** — conferido.
- `worker.py:158-166` baixa o anexo e guarda `{mime_type, data_b64}` em `state["media"]`.
- Nenhum nó usa os bytes. `finance_node` (`graph/nodes.py:259-275`) só lê `state.get("media")`
  para escolher o prazo e para pôr `tem_anexo=True` no texto; `user_turn` acrescenta a frase
  "O usuário anexou um documento" e manda só texto.
- `git log -G data_b64` mostra que nunca existiu envio multimodal, desde o primeiro commit do
  agente Python (31/08). Não é regressão: a feature documentada em `ai-gemini.md` ("Imagem e PDF
  entram no mesmo nó…") **nunca funcionou** no agente Python.
- Efeito: o modelo é instruído a extrair os lançamentos de um documento que não vê. Ou devolve
  vazio e o fluxo pergunta o valor, ou inventa. O SIM contém o dano, mas a feature está morta.
- Efeito colateral: até ~10,7 MB de base64 por mensagem ficam gravados no checkpoint Postgres a
  cada passo do grafo daquele turno.
- **Correção:** montar a mensagem humana com uma parte de texto e uma parte de mídia no
  `finance_node`. **Conferir o formato de content part aceito pelo `langchain-google-genai`
  4.3.7 instalado antes de implementar** (não verifiquei o dict exato). Depois do parse, zerar
  `media` no estado. Teste com foto real no staging e um caso no `evaluate_*`.

**C2. Consulta decide janela e conta por substring, por cima do modelo** — conferido.
`tools/queries.py:152-290`:
- `termos_continuacao` contém `"mais"`, `"mes"`, `"fatura"`, `"parcelas"`, e a comparação é
  `t in texto_norm` (substring). `"mes"` casa "mesmo" e "semestre"; `"mais"` casa quase qualquer
  frase. Casou → `is_refinement = True` → **a consulta herda a conta da consulta anterior**.
- Pior: basta `not action.account` (linha ~198). Qualquer consulta sem conta citada, depois de
  uma consulta com conta, herda a conta. "Quanto gastei no Nubank?" e depois "quanto gastei no
  total esse mês?" responde **só o Nubank**, com um número errado apresentado como verdade.
- A janela é escolhida por escada de `any(...)`: "130 dias" casa `"30 dias"`, "11 meses" casa
  `"1 mes"`, "últimos 15 dias" cai em `"ultimos"` → 3 meses. Só quando o modelo deixa
  `query_from` vazio, mas o texto também vence o modelo em `is_explicit_broad_history`.
- É o "agente burro" que você descreveu: o modelo entendeu certo, e uma lista de palavras troca
  a resposta.
- **Correção:** o `FinanceQuery` (11×13 = 143, longe do teto) ganha campos para o modelo dizer o
  que hoje é adivinhado: `continua_anterior: bool` e, se preciso, `pagina: bool`. O modelo já
  recebe o histórico; ele sabe se "e no total?" continua a consulta anterior. A janela vem só de
  `query_from`/`query_to`. Sem eles, vale o ciclo corrente. O clique `qpage:` (estrutura nossa)
  continua. As listas saem inteiras.

**C3. Mensagem do WhatsApp presa em `processing` nunca é reprocessada** — conferido.
- `claim_thread_batch` (`supabase/migrations/0040_python_agent.sql:213-227`) só reivindica
  `status = 'pending'`.
- O sweep (`routes/worker.py:47`) seleciona a thread presa
  (`processing and claimed_at < now() - 5 min`) e chama `process_thread`, mas o claim ignora a
  linha. O sweep devolve `claimed: 0`.
- A única volta para `pending` é `mark_retry`, no `except Exception` do worker.
  `CancelledError`, SIGKILL, OOM, redeploy e o timeout de 300 s do Cloud Run não passam por ele.
- Não existe orçamento de tempo por turno. Áudio (Meta 20 s + Groq 60 s) × N, mais Lite 10 s +
  reserva 30 s por chamada, mais gate 30 s × 2, passa de 300 s num lote com alguns áudios. O
  Cloud Run mata, e a mensagem some sem resposta e sem alerta.
- **Correção (é MIGRATION, não Python):** o claim passa a aceitar
  `status = 'processing' and claimed_at < now() - interval '5 minutes'`, somando `retry_count`.
  Atualizar `supabase/tests/agent_migrations.sql`. Staging primeiro, produção pelo caminho de
  sempre. No Python: `asyncio.timeout(~240)` em volta do turno e
  `except BaseException → mark_retry`.
- Vale rodar no SQL Editor:
  `select count(*) from messages_queue where status = 'processing' and claimed_at < now() - interval '10 minutes';`

### ALTO

**A1. Lote de extrato truncado em 4.000 caracteres: o modelo classifica o que não vê** — conferido.
- `wrap_untrusted` → `sanitize_untrusted` corta em `MAX_UNTRUSTED_CHARS = 4000`
  (`security.py:179-194`).
- `classify_statement_lines` e `judge_statement_pairs` (`services/gemini.py`) mandam o lote
  INTEIRO num envelope só. `importer.py` não divide (`MAX_ITEMS = 500`, até 80 pares).
- 500 linhas × ~40 caracteres ≈ 20 mil. O modelo vê ~100 linhas e recebe a ordem de devolver
  "EXATAMENTE 500 itens".
- Ou ele devolve menos (o código completa com `None`), ou inventa. No julgamento de pares, um
  "mesmo" inventado **desmarca na prévia uma transação real como duplicata**.
- **Correção:** dividir o lote em pedaços que caibam, ou dar ao envelope de lote um teto
  próprio. **Não** subir `MAX_UNTRUSTED_CHARS` global: ele é o teto da mensagem do usuário.

**A2. O webhook responde 200 quando gravar a mensagem falhou** — conferido.
- `routes/inbound.py:72-75`: qualquer exceção dentro do laço, inclusive no `db.enqueue`, vira
  `log.exception` e 200. A Meta não reenvia, e a mensagem se perde.
- **Correção:** 5xx só quando o `enqueue` falhar. O dedupe por `wa_message_id` torna o reenvio da
  Meta seguro. Falha de `ensure_session` ou de agendamento continua 200, porque a linha já está
  na fila e o sweep cobre.

**A3. Escrita e carimbo de `result_id` são duas operações separadas** — conferido.
- `tools/registry.py:174` executa a tool (autocommit) e `:209` grava o `result_id` depois, fora
  de qualquer `try`.
- Se o processo morre ou a conexão cai entre as duas, a reserva fica órfã com a escrita feita.
- No retry, `ja_executada=False`. O par criar+apagar (`nodes.py:1213`) trata a criação como
  falha e responde "Não apaguei X porque não consegui registrar Y", com Y registrado. O usuário
  reenvia e duplica.
- O par em si também não é atômico: é ordenação em Python sobre um pool `autocommit=True`.
- **Correção:** gravar o `result_id` na mesma transação da escrita (a tool recebe a conexão), ou
  tratar reserva órfã antiga como "indeterminada" e perguntar, em vez de afirmar falha.

**A4. Verificação OIDC bloqueia o event loop** — conferido.
- `security.py:102` chama `id_token.verify_oauth2_token(..., ga_requests.Request())`, síncrono e
  sem cache de certificados, dentro de `require_internal` (async).
- Roda em todo `/worker/*` e `/cron/*`: 1.440×/dia só no cron, mais cada task.
- `auth.py:74` já faz certo com `asyncio.to_thread`.
- **Correção:** `await asyncio.to_thread(...)` e cache dos certificados.

**A5. Transcrição e importação chamam Groq/Gemini fora da cota** — conferido.
- `/internal/chat/transcriptions` (`routes/chat.py:365`) aceita áudio de até 20 MB e chama o
  Groq sem `check_limits` e sem `ai_events`.
- A importação faz duas chamadas de lote ao Gemini (classificação e pares) sem limite horário e
  sem `ai_events`.
- Um usuário autenticado gasta à vontade e a conta não aparece em lugar nenhum.
- **Correção:** `check_limits` nas duas rotas e uma linha em `ai_events` por chamada.

**A6. As chamadas mais caras não aparecem no Langfuse** — reportado; consistente com o código lido.
- O callback do Langfuse só vai no `graph().ainvoke`.
- `confirm.decide`, `draft.interpretar`, `escolher_candidato`, `classify_statement_lines` e
  `judge_statement_pairs` chamam `structured(...).ainvoke()` sem `config`.
- São as de Flash (4,9× o Lite) e as de segurança. Sem isso não dá para medir custo real, cache
  nem tokens de raciocínio (seção 5).
- **Correção:** `structured()` aceita e repassa os callbacks, ou essas chamadas rodam dentro de
  `telemetry.trace`. Também falta `flush` do Langfuse no shutdown (com scale-to-zero, traces do
  último turno se perdem), e o turno do app sai rotulado `whatsapp-message`.

**A7. Expurgo de checkpoint filtra um status que não existe** — conferido.
- `jobs/checkpoints.py:69` protege pendências com `p.status = 'pending'`. O CHECK de
  `pending_actions` só admite `awaiting|approved|rejected|expired`, então a trava nunca protege
  nada.
- Hoje o defeito está mascarado, porque o epoch não gira com pendência `awaiting`. Se girar, o
  expurgo apaga o checkpoint de uma confirmação aberta.
- `tests/test_checkpoint_purge.py:87` afirma o literal errado. Corrigir só o código quebra o
  teste: os dois mudam juntos para `'awaiting'`.

**A8. Pools pequenos para a concorrência configurada** — reportado.
- O pool de dados tem `max=4` e o do grafo `max=2` (`db.py:67-81`), contra `--concurrency 80` no
  Cloud Run e 20 dispatches no Cloud Tasks.
- O checkpointer grava a cada nó, e `PoolTimeout` vira `mark_retry`, que paga o LLM de novo.
- Falta `check=check_connection`: depois de ociosidade com `min_instances=0`, a primeira query
  pode pegar conexão morta.
- **Correção:** concurrency de 8 a 10 por instância, ou pools proporcionais; `check=` no pool.

**A9. Prompt e histórico com dado de usuário fora do envelope** — reportado; o desenho conferi
em `prompts.py`.
- O histórico entra como `f"{papel}: {conteudo}"` cru (`prompts.py:441-455`). A pergunta anterior
  de cadastro (`nodes.py:121,459`) interpola nomes de registros. Num workspace compartilhado, o
  nome que um membro deu a um registro chega ao prompt do outro sem delimitador.
- O SIM impede escrita sem consentimento. O risco realista é uma frase de confirmação
  manipulada.
- **Correção:** `wrap_untrusted("historico", ...)` e `wrap_untrusted("pergunta_anterior", ...)`.

### MÉDIO

- **M1. Retry do WhatsApp refaz router e parse** (temperatura 0,1, não determinístico). Se a
  ordem das ações mudar, o `action_index` não casa e a idempotência falha. O app tem
  `recover_turn` (`conversation.py:983`); o worker do WhatsApp não usa. Reportado.
- **M2. `infer_account_type` recebe a MENSAGEM inteira na consulta** (`queries.py:224`).
  "Parcela", "pix" e "limite" em qualquer lugar da frase mudam o tipo de conta procurado. Nos
  outros chamadores recebe só o nome da conta, que é o certo. Conferido.
- **M3. Forma de pagamento tem três implementações**: `domain/atributos.py` (com âncora),
  `routes/finance_draft.py:41-48,138-147` (regex própria, sem a âncora) e
  `domain/payment_method.py`. Na voz, "paguei o crédito consignado" vira `credit` e exige
  cartão. O rascunho por voz deveria usar a mesma leitura de `tools/atributos`. Reportado.
- **M4. `scope_from_text` vence o `InstallmentScope` do modelo quando há número**
  (`domain/installment_scope.py:18`). "Paguei até a 3 de agosto" vira `first:3`. A rede de
  dinheiro deveria entrar quando o modelo OMITE, não por cima. Reportado.
- **M5. `interpret_choice`: "outro" = "nenhuma"** (`domain/confirm.py:169-180`). Com dois
  candidatos, "o outro" cancela. Tirar "outro/outra" da lista e deixar cair no modelo. Reportado.
- **M6. "Sem conta" e "último dia do mês" com dialetos diferentes por caminho**:
  `matching.sem_conta_explicita` contra o literal em `resolve.py:841,873`, e quatro conjuntos de
  "último dia" em `resources.py` e `correcao_plano.py`. Reportado.
- **M7. Corrida na cota:** `ai_events` só é gravado depois do turno, e N conversas paralelas
  passam pela mesma contagem. Plano sem linha de `plan_status` → cota mensal não se aplica
  (fail-open). Reportado.
- **M8. Lembretes sem `for update skip locked`** (`jobs/reminders.py:64-77`), com o template pago
  enviado antes de marcar. Uma rodada de cron que passe de 60 s reenvia. Reportado.
- **M9. Sem CI.** `.github/workflows/` só publica o Android. `ruff`, `pytest`, a suíte SQL e o
  `evaluate_answer_forms.py` dependem de alguém lembrar. Conferido.
- **M10. Prompt remendado.** `FINANCE` repete a regra deítica três vezes; `FINANCE_QUERY` diz
  "NUNCA use query_forecast" três vezes; o `ROUTER` virou uma tabela de casos em prosa. Muitos
  NUNCA/SEMPRE leem pior num modelo Lite. Consolidar, medindo antes e depois — não reescrever no
  escuro.
- **M11. Funções gigantes:** `resources.prepare` (~610 linhas), `queries.query_transactions`
  (~410), `resources.validate_fields` (~300), `nodes._gate` (~280), `resolve.for_actions`
  (~245), `resources.execute` (~230), `conversation.run_turn` (~225). Dividir por recurso ou por
  tipo de pendência quando mexer nelas, não como projeto à parte.

### BAIXO

- `compare_digest` com `str` não-ASCII levanta `TypeError` → 500 em vez de 401
  (`security.py:35,73,110`). Comparar bytes.
- `hub.verify_token` comparado com `==` (`inbound.py:30`).
- `hooks.py:52` devolve `str(err)` no OTP; `whatsapp.py:72,256,318` loga corpo da Meta e o spec
  interativo (nomes e valores).
- `timezone` do corpo vai ao prompt sem validar (`finance_draft.py:54`). Validar com `ZoneInfo`.
- Áudio do WhatsApp sem teto de bytes antes do Groq (imagem tem 8 MB).
- `ilike '%termo%'` sem escapar `%`/`_` em `resolve.py:297` (`nodes.py:187` escapa).
- Langfuse recebe o texto das conversas, sem máscara. O telefone fica de fora. É decisão de LGPD:
  operador, região e retenção.
- `_checa_producao` não valida `GEMINI_API_KEY`, `WHATSAPP_TOKEN` nem `WHATSAPP_APP_SECRET`.
- Logs em texto, sem `thread_id`/`message_id` estruturados, e sem alerta de fila acumulada ou
  linha `failed`.
- `confidence` dos planos de domínio não decide nada (toda escrita já pede SIM). Só o 0,8 do
  router tem efeito. Saída gasta à toa; a confiança auto-relatada do Lite é mal calibrada.

---

## 3. O que está bem feito — não mexer

| O quê | Onde |
|---|---|
| Modelo devolve objeto tipado; registry fechado executa; nada de tool de escrita no modelo | `tools/registry.py` |
| Toda escrita pede SIM; clique por igualdade exata, texto pelo gate no Flash; falha do classificador = NÃO aprovado | `graph/policy.py`, `domain/confirm.py` |
| Política pura, testável sem subir o grafo | `graph/policy.py` |
| `ensure_owned` antes de reservar idempotência; filtro de `workspace_id` em todo UPDATE/DELETE lido; nenhum IDOR achado | `tools/base.py`, `tools/*` |
| Nenhuma injeção de SQL: tabela e coluna só de allowlist/catálogo, valores sempre `%s` | `tools/resources.py`, `tools/base.py` |
| JWT ES256 fixado com `aud`/`iss`/`exp`; usuário só do `sub`; `extra="forbid"` | `auth.py`, `routes/chat.py` |
| HMAC da Meta sobre corpo cru, falha fechado; OIDC exige `email_verified` e a SA exata | `security.py` |
| Envelope que fecha a própria tag; conteúdo do usuário fora do system prompt | `security.py` |
| Reserva de idempotência ANTES de executar; dedupe de entrada no mesmo INSERT | `db.py`, `routes/inbound.py` |
| Debounce no Cloud Tasks, não em memória; lote não mistura retry com mensagem nova | `services/tasks.py`, `0040` |
| Modelo fixado por papel numa tabela só; reserva de disponibilidade só quando o Lite FALHA; gate sem reserva para o Lite | `services/gemini.py` |
| Resposta ao usuário por template Python, nunca LLM reescrevendo número | `tools/*` |
| `llm_calls` separando fast-path de chamada real, para o paywall | `graph/state.py` |
| "Na dúvida pergunta"; empate nunca chuta; termo dito que não casa = "não achei", nunca a lista inteira | `tools/resolve.py` |
| Avaliação com Gemini real e seção adversarial que não pode aprovar nada | `scripts/evaluate_answer_forms.py` |

---

## 4. O teto de 252 e as alternativas

O que se sabe:
- O `langchain-google-genai` 4.3.7 já usa `method="json_schema"`, ou seja, `response_json_schema`
  nativo. **Trocar para o SDK direto não muda nada.** O limite é do servidor do Gemini.
- A doc oficial só diz "schemas muito grandes ou muito aninhados podem ser recusados", sem
  número. O 252 é medição de vocês.
- Inferência a testar: cada campo `Optional` do Pydantic vira `anyOf: [{tipo}, {null}]`. Com 18
  campos opcionais, isso multiplica os estados da gramática. O enum de 14 valores no `type` é o
  outro fator.

Em ordem de custo:

1. **Sonda de uma tarde, sem mudar arquitetura.**
   - Variante A: `type: str` com os 14 valores listados na `description`, validado no Pydantic
     depois.
   - Variante B: campos opcionais como `"type": ["string", "null"]` em vez de `anyOf`.
   - Rodar `diagnose_finance_schema.py` com cada variante, somando os 4–6 campos de atributos. Se
     passar, `tools/atributos.py` e a segunda chamada de LLM podem sair, e os campos-convenção
     (`installments == 1` = desparcelar) podem virar um campo `operacao` explícito.
2. **Function declarations por domínio, dentro do `finance_node`** (se a sonda não bastar).
   - Uma função pequena por ação (`create_expense`, `update_transaction`, `mark_paid`…), de 3 a 8
     parâmetros cada, em modo `ANY`, permitindo várias chamadas na mesma resposta.
   - O código converte cada chamada no `FinanceAction` interno, que não tem limite por não ir ao
     fio. Registry, gate, `interrupt` e resolve ficam iguais.
   - **Isto NÃO é o "tool-calling probabilístico" que `agent.md` proíbe:** o modelo só escolhe qual
     formulário preencher, quem executa continua sendo o código, e só depois do SIM. A regra
     precisa ser reescrita para dizer isso. É decisão sua.
   - A doc do Gemini recomenda 10 a 20 ferramentas ativas. Finanças tem 14 ações, cabe.
3. **Não recomendo juntar router e domínios numa chamada só.**
   - Finanças (14) + consulta (~11) + notas + cadastros passa de 30 funções, acima da faixa
     recomendada.
   - O `financial_entity` do router e a desambiguação parcelamento × dívida dependem de uma
     decisão tomada antes da extração.
   - Mantenha o router no Lite e ataque o teto por domínio.
4. **Duas etapas** (classificar o tipo, depois um schema específico): descartado, porque soma uma
   chamada sequencial e reabre a fronteira escrita × correção que o projeto decidiu não separar.

---

## 5. Custo de tokens: JEV, TOON, cache e raciocínio

**Tamanho real dos prompts de sistema** (medido em `prompts.py`, caracteres ÷ 4):

| Prompt | Caracteres | Tokens (aprox.) |
|---|---|---|
| `ROUTER` | 5.719 | ~1,4 mil |
| `FINANCE` | 12.125 | ~3,0 mil |
| `FINANCE_QUERY` | 7.314 | ~1,8 mil |
| `NOTES` | 4.381 | ~1,1 mil |

Some a isso o schema serializado e até ~2 mil tokens de histórico, enviado duas vezes por turno
(router e domínio). **`agent.md` diz "~800 tokens por domínio" e `ai-gemini.md` diz "US$ 0,0009
por turno": os dois números estão velhos.** "Cache não é alavanca" também foi decidido com o
prompt de 800 tokens. `FINANCE` + schema está perto do mínimo de 4.096 do cache implícito.

**Chamadas de LLM por turno:**

| Turno | Chamadas |
|---|---|
| Saudação exata | 0 |
| Clique em botão | 0 |
| Gasto simples | 2 Lite (3 com pista de atributo) |
| Consulta | 2 Lite |
| Gasto + consulta na mesma frase | 3 Lite (paralelas) |
| "Sim" digitado | 1 Flash |
| Escolha digitada | 1 Flash |
| Correção antes do SIM | 1 Flash + 2–3 Lite |
| Áudio | Groq + 2–3 Lite |

**JEV.** Existe: é o Jev, da TypeSafe AI.
- Não é técnica de compactação. É um modelo **classificador não generativo**: responde perguntas
  tipadas (escolha, sim/não) numa passada só, a US$ 0,042 por milhão de tokens de entrada e saída
  grátis.
- O acesso direto foi pausado em 22/09; hoje sai via OpenRouter ou Vercel AI Gateway.
- Ele poderia, no máximo, substituir o **router**. Não substitui o parse, porque não extrai valor
  nem data. A qualidade em português não está medida, e ele sai da decisão "IA é Gemini".
- **Não recomendo agora:** o router custa ~US$ 0,0004 por mensagem no Lite.

**TOON** (Token-Oriented Object Notation, −30 a −40% de tokens em dados tabulares). Não se
aplica: nenhum dado tabular grande vai ao prompt. O que pesa é instrução e histórico em prosa.
Só valeria se um dia a janela de 40 lançamentos ou o lote de extrato fossem serializados para o
modelo.

**Raciocínio (`thinking_level`).** Nenhuma chamada configura.
- Pela doc, o `gemini-3.7-flash` (o gate) tem default **Medium**, e raciocínio é cobrado como
  saída.
- O default do `3.1-flash-lite` não está documentado.
- **Medir primeiro:** `usage_metadata` no Langfuse, o que depende de A6. Depois testar `low` no
  router e no parse com o `evaluate_*`. **Nunca** baixar o gate sem rodar de novo a seção de
  segurança.

**Ordem certa para cortar custo:**
1. A6, rastrear as chamadas de Flash.
2. Um dia de tráfego para medir tokens reais, `cached_content_token_count` e tokens de raciocínio.
3. Decidir, com número na mão: raciocínio, cache, e a sonda do teto (que elimina a terceira
   chamada).
4. Fast-path de "sim" exato. A string normalizada INTEIRA igual a um conjunto fechado ("sim",
   "s", "ok", "pode", "confirma"); qualquer outra coisa cai no modelo. Isso tira o Flash do caso
   mais comum e é compatível com a regra de fast-path. Decisão sua, porque mexe no portão.

---

## 6. Ordem de ataque sugerida

| # | O quê | Tipo |
|---|---|---|
| 1 | C3: claim de linha presa + deadline por turno | migration + Python |
| 2 | C1: mandar a mídia ao Gemini e limpar o estado | Python + teste com foto real |
| 3 | C2: `continua_anterior` no `FinanceQuery`, apagar as listas de `query_transactions` | schema + prompt + `evaluate_*` |
| 4 | A1, A2, A7: lote dividido, 5xx no enqueue, `'awaiting'` (código e teste) | Python |
| 5 | A4, A8: OIDC em thread, pool com `check=` e concurrency coerente | Python + `setup-gcp.sh` |
| 6 | A5, A6: cota na transcrição/importação; Langfuse em todas as chamadas | Python |
| 7 | A3: `result_id` na mesma transação da escrita | Python/SQL |
| 8 | Sonda do teto de 252 (seção 4) | script |
| 9 | CI com `ruff` + `pytest` + suíte SQL | workflow |
| 10 | A9, M1–M8 | conforme mexer na área |

---

# Parte 2 — Evolução de arquitetura: o que somar

A Parte 1 é o que está quebrado. Esta é o que um time de IA maduro acrescentaria. **A régua é o
volume**, porque é ela que decide o que se paga:

| regime | quando | o que importa |
|---|---|---|
| **Agora** | dezenas a poucas centenas de chamadas/dia; o gasto maior é a suíte de avaliação | medir, avaliar, contexto melhor |
| **Primeiros pagantes** | centenas de usuários; o custo por usuário define o preço (Fase 6 de `PROXIMAS-FASES.md`) | unit economics, ciclo de dados, cortes de token medidos |
| **Escala** | milhares de chamadas/dia | cache, roteador barato, fine-tuning |

A ordem que uma empresa grande segue é **medição → avaliação → ciclo de dados → só então truques
de token**. Otimizar token sem medir economiza centavos e arrisca a qualidade.

## 7. Medição e governança de custo (FinOps de LLM) — agora

**7.1 Contabilidade de tokens por chamada.**
- `ai_events.input_tokens` e `output_tokens` existem desde a `0001` e **nunca são preenchidos**
  (`db.record_ai_event` não recebe esses campos).
- Gravar, por chamada e por nó: tokens de entrada, saída, cache (`cached_content_token_count`) e
  raciocínio; o modelo REAL (o principal ou a reserva); custo calculado; versão do prompt. Tudo
  sai do `usage_metadata` da resposta, sem mudar o schema.
- Por que é o item nº 1: a Fase 6 (preço) usa "US$ 0,0009 por mensagem, medido". Esse número foi
  medido quando o prompt de finanças tinha ~800 tokens; hoje tem ~3.000. **A decisão de preço
  está apoiada num custo velho.**

**7.2 Langfuse em 100% das chamadas** (A6), com o hash do prompt em cada trace. Hoje um trace não
diz que versão do prompt o gerou, então não dá para comparar antes e depois de uma mudança.

**7.3 Painel de unit economics:** custo de IA por usuário/mês contra o preço do plano, mais
alerta de orçamento no GCP Billing. É o que transforma "acho que dá lucro" em número.

## 8. Contexto melhor: o agente deixa de ser burro — agora

Aqui está o maior ganho de qualidade, e ele segue a regra do projeto: **o modelo interpreta, o
código valida**.

**8.1 As contas e cartões da pessoa no prompt.**
- Hoje o modelo extrai o nome cru ("roxinho", "cartão da Ana", "o do mercado livre") e o código
  casa por TEXTO (`match_accounts`, `infer_account_type`). Casamento por texto é lexical: não sabe
  que "roxinho" é o Nubank.
- Proposta: injetar uma lista compacta (nome, tipo, dia de fechamento) **envelopada**. Já existe o
  precedente exato: `user_turn` injeta os nomes de pasta com `wrap_untrusted("folder_names", ...)`.
- O modelo devolve o nome da lista; o código continua validando que é um id do workspace e
  perguntando no empate.
- Custo: ~10 contas × ~10 tokens. Vai DEPOIS do prefixo estático, para não quebrar o cache.
- Ganho: some a classe "não achei o cartão X" quando X existe com outro nome, e as heurísticas de
  `infer_account_type` (M2) podem sair.
- O mesmo vale, em listas curtas, para metas, dívidas e as categorias mais usadas.

**8.2 Busca semântica de lançamento (pgvector).**
- `resolve.por_transacao` busca por `ilike`/`unaccent` na janela dos 40. "Apaga o almoço de
  ontem" não acha "Restaurante Fulano".
- Proposta: busca híbrida, texto completo + embedding de `description`/`merchant`, gerando
  candidatos que o HITL confirma como hoje.
- O Supabase já tem pgvector; hoje o projeto só usa `tsvector` (`0038`). O embedding é gerado na
  escrita, uma vez por lançamento.
- O mesmo julgamento semântico que a conciliação de extrato já faz, aplicado à conversa.

**8.3 Exemplos dinâmicos (few-shot por recuperação) no lugar das regras de incidente.**
- O prompt de finanças acumulou regras NUNCA/SEMPRE, cada uma nascida de um bug (M10). Isso não
  escala: cada correção engorda o prompt de todo mundo e pode piorar outro caso.
- Padrão de mercado: um banco de exemplos (frase → ação certa). Na hora do turno, recuperam-se os
  k mais parecidos por embedding. Cada bug corrigido vira um EXEMPLO, não uma linha no prompt.
- ⚠️ **Privacidade:** exemplo vindo de turno de OUTRO usuário vaza o texto dele no prompt de
  alguém. O banco de exemplos é sintético, ou anonimizado e com consentimento (LGPD), ou só do
  próprio usuário.

**8.4 Memória estruturada de preferências.**
- Quando a pessoa corrige a proposta antes do SIM ("não, foi no Inter"), o agente aprende um
  apelido ou preferência e grava como dado estruturado. É a extensão natural de
  `categorization_rules`, que já existe ("regra do usuário ganha da IA").
- Nunca memória em texto livre lida pelo modelo: dado tipado, editável e apagável no app.

## 9. Ciclo de dados (data flywheel) — começa agora, rende nos pagantes

É o que separa um produto de IA de um protótipo, e vocês já têm a matéria-prima.

- **Todo HITL é um rótulo de graça.** SIM = parse certo. Corrigir antes do SIM = parse errado
  junto com a versão certa. NÃO = negativo.
- `pending_actions` já guarda `action` (jsonb), `summary` e o `status` final, e
  `executed_actions.origin_text` guarda o texto. **O que falta** é ligar explicitamente o texto
  de entrada, a proposta e a versão corrigida num registro só (`agent_feedback`), com o hash do
  prompt e o modelo.
- Desse registro saem:
  1. **Métricas de qualidade de produto:** aprovação de primeira, taxa de correção antes do SIM,
     taxa de pergunta, taxa de "não entendi", por tipo de ação e por versão de prompt. É o "task
     success rate" que times grandes acompanham.
  2. **Golden set que cresce sozinho** para a avaliação (seção 10).
  3. **O banco de exemplos** do 8.3.
  4. **Fine-tuning supervisionado do Flash-Lite**, quando houver milhares de pares rotulados.
     Antes disso, não.
- LGPD: anonimizar e prever o uso nos termos.

## 10. Engenharia de avaliação — agora

Vocês já têm o mais difícil, uma suíte com Gemini real e uma seção adversarial. O que falta é
transformá-la em processo:

| camada | o quê | estado |
|---|---|---|
| unitário | pytest com dublês | existe |
| contrato | sondas de schema (`probe_*`) | existe, manual |
| offline | golden set versionado, rodado no PR que toca `prompts.py`/`schemas.py`, com limiar e seção de segurança em zero falha | existe a suíte, **falta o portão no CI** |
| online | amostra do tráfego real no Langfuse, avaliada por um juiz-LLM com rubrica, os piores para revisão humana | não existe |
| produto | as métricas do ciclo de dados (seção 9) | não existe |

Corte de custo da própria suíte, que hoje é o maior gasto:
- **Cache de resultado por (caso, hash do prompt, modelo):** mudar o prompt de notas não reroda
  os casos de finanças. É o ganho verificável e imediato.
- **Batch API do Gemini** (mais barato e sem o limite de 5 RPM do Flash) para a rodada noturna.
  ⚠️ Preço e disponibilidade para a família 3.x **não foram verificados**.

**Modo sombra para trocar de modelo.**
- A política de "modelo fixado" é certa, mas o Google descontinua versões. Hoje a troca é no
  escuro.
- Padrão: o modelo novo roda EM PARALELO no tráfego real, sem efeito nenhum para o usuário. O
  `FinanceAction` dos dois é comparado campo a campo, e promove-se quando a divergência é aceitável.

## 11. Cortes de custo, com o "quando" de cada um

| corte | ganho | quando | condição |
|---|---|---|---|
| **Fast-path de "sim" exato** (string normalizada INTEIRA num conjunto fechado; o resto cai no modelo) | tira o Flash do caso mais comum de resposta digitada | agora | mexe no portão, decisão sua; rodar a seção de segurança |
| **Controle de raciocínio** (`thinking_level`) | o 3.7-flash (gate) está em Medium por padrão, e raciocínio é cobrado como saída | agora, depois do 7.1 | medir os tokens de raciocínio antes; nunca baixar o gate sem a suíte |
| **Disjuntor na reserva** | numa queda do Lite, hoje cada chamada espera 10 s antes da reserva; o disjuntor manda direto ao Flash por N minutos | agora | latência, não custo |
| **Sonda do teto de 252** (seção 4) | elimina a 3ª chamada (`atributos`) em todo lançamento com pista | agora | uma tarde de sonda |
| **Prompt modular por intenção** | o prompt de finanças (~3 mil tokens) vai inteiro até num "gastei 10 no café". O router (schema minúsculo, sobra folga) passa a devolver sub-intenções (criar, corrigir, parcelado, fatura, dívida, meta) e o nó monta só os módulos relevantes, em ordem canônica | primeiros pagantes | **tensão real com o cache**: prompt menor cai abaixo do mínimo de 4.096 do cache implícito. Volume baixo: prompt menor ganha. Volume alto: prefixo estável grande e cacheado ganha. Ordem canônica mantém o módulo-base cacheável nos dois casos |
| **Cache explícito** | entrada cacheada custa uma fração | escala | ponto de equilíbrio = custo de armazenamento/hora ÷ economia por chamada. ⚠️ Preço de cache do 3.1-flash-lite e do 3.7-flash não confirmado; calcular com a tabela oficial antes |
| **Cascata por falha OBJETIVA** (Lite → Flash só quando Pydantic, guard ou campo obrigatório falham; nunca por confiança auto-relatada) | menos "não consegui", menos perguntas | primeiros pagantes | compatível com `ai-gemini.md`, que proíbe escalar por confiança. A decisão de perguntar em vez de escalar veio da cota grátis do Flash (20/dia), e com faturamento ela pode ser revista |
| **Roteador por embedding** (kNN sobre exemplos rotulados; LLM só com margem baixa ou várias intenções) | ~metade das chamadas do router | escala | depende dos rótulos do ciclo de dados. Multi-intenção é a melhor qualidade do produto e o kNN só resolve o caso de uma intenção: o LLM continua no caminho |

## 12. Plataforma e confiabilidade

- **Orçamento de tempo por turno** com prazo propagado para cada chamada (C3).
- **SLOs com alerta:** p95 de latência por turno, taxa de erro, fila parada há mais de N minutos,
  custo diário acima do esperado.
- **Logs estruturados com correlação** (`thread_id`, `message_id`, `trace_id`), em JSON, para o
  Cloud Logging filtrar um turno inteiro.
- **Indicador de "digitando…" no WhatsApp** enquanto o turno roda. Melhora a latência percebida.
  ⚠️ Verificar o suporte na versão da Graph API em uso.

## 13. Segurança em profundidade

- **RLS como segunda camada para o agente.** Hoje o serviço usa um papel que ignora RLS, e todo o
  isolamento entre workspaces é código Python (`ensure_owned`, filtros). A auditoria não achou
  IDOR. Mesmo assim, empresas grandes não deixam o isolamento entre clientes depender só da
  aplicação.
  - `como_usuario` já põe o claim `sub` por transação. O passo seguinte é conectar com um papel
    que RESPEITA RLS e definir as claims por transação; aí um bug futuro no Python não atravessa
    workspaces.
  - É mudança grande, com toda RPC `security definer` revista. É seguro de vida, não correção
    urgente. Decisão sua.
- **Máscara de dado pessoal antes do Langfuse:** nomes próprios e chaves Pix; telefone já fica de
  fora. Também a região e a retenção dos dados.
- **Limite de taxa por usuário na borda** para as rotas do app (Cloud Armor ou equivalente), além
  da cota de IA.

## 14. O que um time maduro NÃO faria aqui

| tentação | por que não |
|---|---|
| Multi-agente com supervisor, ou loops ReAct autônomos | troca um caminho determinístico e auditável por raciocínio livre no caminho do dinheiro; mais chamadas, mais latência, menos previsível |
| LLM reescrevendo a resposta final "para soar natural" | alucina sobre número exato; o template Python é a decisão certa |
| Banco vetorial separado (Pinecone etc.) | pgvector no Supabase basta neste volume e mantém o isolamento por workspace no mesmo lugar |
| Fine-tuning agora | sem milhares de pares rotulados é dinheiro jogado; primeiro o ciclo de dados |
| Trocar LangGraph por outro framework | checkpointer, `interrupt` e retomada funcionam; os problemas achados são de uso, não do framework |
| TOON ou Jev | nada tabular vai ao prompt; o Jev só substituiria o router, que custa ~US$ 0,0004 |
| Tool-calling com execução pelo modelo | o modelo continua só preenchendo formulário; quem executa é o código, depois do SIM |
| Cache semântico de RESPOSTA | dado financeiro muda a cada lançamento, e resposta cacheada vira número velho. No máximo, cache da INTERPRETAÇÃO (texto + data → ação), com taxa de acerto baixa em finanças pessoais |

## 15. Roteiro consolidado

| horizonte | itens |
|---|---|
| **Agora** (junto com a Parte 1) | 7.1 tokens em `ai_events`; 7.2 Langfuse em tudo + hash do prompt; 8.1 contas no prompt; portão de avaliação no CI + cache de resultados; disjuntor; sonda do 252; fast-path do "sim" (sua decisão) |
| **Primeiros pagantes** | 7.3 painel de unit economics; 9 ciclo de dados (`agent_feedback` + métricas); 8.2 busca semântica; 8.3 exemplos dinâmicos; prompt modular; cascata objetiva; avaliação online; modo sombra |
| **Escala** | cache explícito com o equilíbrio calculado; roteador por embedding; fine-tuning do Flash-Lite; RLS como segunda camada (pode vir antes, se houver workspace compartilhado com terceiros) |

---

# Parte 3 — Execução (06/10/2026)

Tudo abaixo está em `main` (111+ commits de uma linha). Staging recebeu as migrations
`20261006100000` a `20261006160000` e o agente. **Produção não foi tocada.** Testes no fim:
`pytest` 1844 ok, `ruff` limpo, suíte SQL do staging 121/122 (a que falha oscila; ver o fim).

Três estados por item: **feito** (com o commit), **decidido não fazer** (com o motivo medido) e
**depende de você**.

## 16. Parte 1 — defeitos

| item | estado | onde |
|---|---|---|
| C1 mídia nunca chegava ao Gemini | feito | `25979968`: parte `file` base64 por `config.configurable`; JPEG e PDF lidos no Gemini real |
| C2 consulta por substring | feito | `f5bbd136`: `continua_anterior`/`mostrar` no `FinanceQuery` (13×13); as listas saíram |
| C3 `processing` preso | feito | `68bce8c5` + migration `20261006100000`; prazo de 240 s e `BaseException` devolve à fila |
| A1 lote truncado | feito | `0d3ed0bd`: lote em pedaços |
| A2 webhook 200 com enqueue falho | feito | `68bce8c5`: 503 só quando o `enqueue` falha |
| A3 escrita e carimbo separados | feito | `bd4e0a39`: `db.unidade_de_trabalho` |
| A4 OIDC bloqueando o loop | feito | `9de11681` |
| A5 transcrição e importação fora da cota | feito | `0d3ed0bd` |
| A6 Langfuse fora das chamadas caras | feito | `0d3ed0bd`, `7bbedaf9`: callbacks em todo cliente, flush no shutdown, nome por canal |
| A7 `'pending'` × `'awaiting'` | feito | `68bce8c5` (código e teste) |
| A8 pools × concorrência | feito | `68bce8c5`, `7d58fe7e`: 5/3 no session pooler, `--max-instances 4 --concurrency 10` |
| A9 histórico fora do envelope | feito | `b8f8e1e2` |
| M1 retry refazia o turno | feito | `recover_turn` no worker |
| M2 tipo de conta pela frase inteira | feito | `f5bbd136` |
| M3 três formas de pagamento | feito / decidido | a regex própria da voz saiu (`093e4035`); ficam `payment_method.py` (vocabulário) e `atributos.py` (leitura ancorada) — papéis diferentes, sem regra duplicada |
| M4 `scope_from_text` vencendo o modelo | feito | `6385b754` |
| M5 "outro" = "nenhuma" | feito | `6758d49c` |
| M6 dialetos de "sem conta"/"último dia" | feito | `6385b754`: `matching.sem_conta_explicita` e `ultimo_dia_do_mes` |
| M7 corrida na cota | feito | reserva sob advisory lock; sem linha de plano vale o limite mais restrito |
| M8 lembretes sem `skip locked` | decidido | `trava_de_sessao` + nova conferência antes de entregar dá a mesma garantia; entrega at-least-once escrita no código |
| M9 sem CI | feito | `28a3370a`, `363a59a9`: ruff, pytest, tsc, lint, npm test, SQL e avaliação (dispara em todo `graph/`, `gemini.py`, portão e rascunho; roda formas de resposta E compreensão de conversa) |
| M10 prompt remendado | feito atrás de flag | prompt v2 (`AGENT_PROMPT_V2`); a decisão de ligar está na seção 18 |
| M11 funções gigantes | decidido | dividir quando mexer, como o próprio relatório pede |
| BAIXO (10 itens) | feito | bytes no `compare_digest`, `verify_token` em tempo constante, OTP sem `str(err)`, corpo da Meta fora do log, fuso validado, teto de 16 MiB no áudio, `like_contem`, máscara no Langfuse, `_checa_producao`, logs JSON |
| BAIXO `confidence` dos planos | feito | `72e5bc55`: saiu dos 4 planos de domínio (só trocava o rótulo do motivo); a do router fica |

## 17. Parte 2 — arquitetura

| item | estado | onde |
|---|---|---|
| 7.1 tokens e custo por chamada | feito | `ai_events`: tokens, cache, raciocínio, custo, `calls` por chamada com papel, nó, versão do prompt, modelo real, `reserva_motivo` |
| 7.2 Langfuse em tudo + versão do prompt | feito | `versao_do_prompt` em toda chamada |
| 7.3 unit economics + orçamento | feito | `private.ai_unit_economics`, `scripts/agent_metrics.py`, orçamento em `setup-gcp.sh alertas` (os valores dependem de você) |
| 8.1 contas no prompt | feito | `b8f8e1e2` |
| 8.2 busca semântica | feito | `gemini-embedding-2`, pgvector, piso 0,64 calibrado |
| 8.3 exemplos dinâmicos | feito atrás de flag | 115 exemplos sintéticos, vetores pré-gerados (o índice em runtime estourava as 100 req/min do gratuito e refazia 113 embeddings por cold start), piso 0,62 calibrado |
| 8.4 memória de preferências | feito (apelido) / decidido (categoria) | `account_aliases` aprende e o app mostra/remove; preferência de categoria continua EXPLÍCITA (`set_rule`): aprender regra de uma correção seria regra implícita que a pessoa não pediu |
| 9 ciclo de dados | feito | `agent_feedback`, `agent_quality`, `export_dataset.py` |
| 10 portão no CI, cache, avaliação online, sombra | feito | ver M9; `eval_cache.py`; `avaliacao_online.py`; `GEMINI_SHADOW_<PAPEL>` |
| 10 Batch API | decidido não | a avaliação roda numa chave gratuita (custo zero), 24 h de latência não serve de portão de PR, e o grafo pediria duas rodadas encadeadas (router → domínio) |
| 11 fast-path do "sim" | feito | `6758d49c`; no E2E o "sim" não chamou modelo nenhum |
| 11 raciocínio | feito (ajuste) / depende do Gemini | o Lite gasta 0 token de raciocínio; `GEMINI_THINKING_<PAPEL>` existe; baixar o gate espera a seção de segurança com o 3.7-flash, que passou o dia em 503 no gratuito |
| 11 disjuntor | feito | 3 falhas/60 s abrem 120 s |
| 11 sonda do teto | feito | o teto de 252 caiu: 720 medido; atributos saíram da segunda chamada |
| 11 prompt modular | feito atrás de flag | seção 18 |
| 11 cache explícito | decidido não | medido: implícito deu 0 token em cache; explícito tem armazenamento ZERO no gratuito; break-even ~107 chamadas/dia por prompt — `agent_metrics.py` mostra o número que reabre a decisão |
| 11 cascata por falha objetiva | feito | `922839bb`: saída inválida vai à reserva com motivo |
| 11 router por embedding | decidido não | exemplos decidindo rota é regra por caso; o router custa ~US$ 0,0005 |
| 12 orçamento de tempo | feito | C3 |
| 12 SLO com alerta | feito | fila parada, falhas, 5xx, turno lento (> 30 s) e custo de IA em 24 h (> US$ 5) — métricas e políticas em `setup-gcp.sh alertas` |
| 12 logs com correlação | feito | `thread_id`/`message_id` em JSON; o elo com o Langfuse é o `thread_id` (= `session_id`); o `trace_id` que ninguém preenchia saiu |
| 12 "digitando…" | feito | Graph v25.0, no mesmo POST da lida |
| 13 RLS como segunda camada | feito atrás de flag | `AGENTE_RLS`; 59/59 no staging (negativos bloqueados); ligado no staging no deploy de 06/10 |
| 13 máscara de PII | feito / decidido | e-mail, CPF, CNPJ, telefone e números longos; nome próprio fica, de propósito; Langfuse na UE |
| 13 limite de taxa | feito / decidido | 120 req/min por usuário por instância; Cloud Armor não se paga com 4 instâncias no máximo |

## 18. O que a execução achou além do relatório

- **Troca de modelo por papel não funcionava** (`8889fa72`). Router, parse e batch usam o mesmo
  modelo, e o mapa nome→papel virava sempre `batch`: `GEMINI_MODEL_PARSE` não trocava nada, e o
  consumo rotulava tudo como batch. Achado no E2E. Consequência honesta: a sonda de atributos
  "18/21 no 3.5-flash-lite" do início do dia rodou no 3.1-flash-lite.
- **O checkpoint ia parar de desserializar** (`35cd69aa`). O LangGraph avisava que vai bloquear
  tipo não registrado (`FinanceActionType`); toda confirmação pendente deixaria de retomar.
- **Mensagem durante o turno esperava o sweep** (`0bc0d8f6`), até 1 min — e no staging, onde não
  há cron, para sempre.
- **Deploy apagava flag ligada à mão** (`fbe20b76`): `--set-env-vars` substitui tudo.
- **Índice de exemplos inviável no gratuito** (`c7c83cf8`) — ver 8.3.
- **O aporte em meta perdia valor e conta** (`aee680ec`), defeito que já estava na base: com
  `json_schema` o Gemini escreve as chaves NA ORDEM do schema e não volta. Ele começa o aporte pela
  meta (`target_ref`), que vinha depois de valor e conta. Movido para logo após `type`: **1/12 →
  12/12**. A mesma armadilha tira o valor de BUSCA das correções ("o mercado foi 120, não 100":
  0/6); pôr `description` antes do valor acertou 3/3 no primeiro caso, mas a cota acabou antes de
  medir as criações — que é o caminho de maior volume — e a troca NÃO foi feita sem medição.
- **Três critérios de avaliação tinham envelhecido**, e pareciam regressão: "encerrar série"
  passou a receber o `name` do alvo (`d9aaa929`) e recusava qualquer chave a mais; o SIM
  condicionado ("Sim, mas muda para 24 parcelas") passou a REVISAR a proposta, e o caso só aceitava
  segurar; `agent_quality` é global e o teste somava o feedback real do dia. Conferido contra o
  código de ANTES da auditoria (worktree em `0ee72152`): base 9/9, atual 5/9 pelo critério velho,
  9/9 pelo certo.

## 19. Medições com o Gemini real

- **Turno de gasto (E2E, sob RLS):** router 1.939 + parse 4.521 tokens de entrada, 106 de saída,
  **US$ 0,001774**. Com o Lite em 503, a reserva assumiu e o motivo foi gravado.
- **Prompt v1 × v2** (`comparar_prompts.py`, 40 frases): **−32% de tokens de entrada**
  (212.600 → 144.576). Extração: o v2 acertou onde o v1 errou em 6 frases (lembrete virando
  gasto, `query_forecast` proibido, conta perdida, cama 8×200, dois roteamentos); oscilação de
  roteamento consulta↔cadastros aparece NOS DOIS (rodadas repetidas trocam o resultado).
- **Compreensão de conversa** (mesmo portão nos dois lados): v1 18/22, v2 19/22. As falhas que
  sobram são as instabilidades já medidas no próprio script (~1 em 3).
- **Seção de segurança** (`evaluate_answer_forms --secao seguran`): 21/21, com o portão no Lite.
  A aprovação com o portão de produção (Flash) não rodou: o 3.7-flash passou o dia em 503 e esgotou
  as 20 chamadas gratuitas; o 3.6-flash também esgotou.
- **Formas de resposta, v1:** 282/302. Das 20 falhas: 7 timeouts com o principal fora, 2 do portão
  Lite ("aham", "claro"), 4 do critério envelhecido de "encerrar", 5 do aporte (corrigido depois) e
  2 de correção sem valor de busca. A v2 rodou até a cota diária acabar: os 53 primeiros casos
  bateram com a v1; o resto ficou contaminado (portão sem cota).
- **Por isso o `AGENT_PROMPT_V2` continua DESLIGADO.** Tudo o que foi medido aponta a favor
  (−32% de tokens, melhor em 6 extrações, igual em roteamento e segurança), mas a suíte oficial
  inteira não coube na cota gratuita do dia. Um job ficou agendado para rodar ao zerar a cota
  (ordem dos campos + suíte inteira com `--prompt-v2`).

## 20. O que depende de você

- **Alertas e orçamento:** `ALERT_EMAIL`, `BILLING_ACCOUNT` e `BUDGET_USD` para
  `./scripts/setup-gcp.sh alertas`.
- **Secret `GEMINI_API_KEY_EVAL`** no GitHub, para o portão de avaliação do CI rodar. E um `push`
  para ver o job `sql` verde uma vez num runner (ele segue não-bloqueante até isso).
- **Produção**, na ordem migrations → agente → app: as migrations `20261006100000` a
  `20261006160000` (o `db push` com `--project-ref` de produção e `PROOPS_PROD_OK=1`, como manda
  o `CLAUDE.md`) e depois o deploy do agente. `AGENTE_RLS` em produção só depois de alguns dias
  dele ligado no staging.
- **Ligar o prompt v2**, quando a suíte inteira aprovar.
