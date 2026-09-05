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
- **Teto MEDIDO do schema: 15 propriedades e UM enum por objeto.** A 16ª devolve
  `400 INVALID_ARGUMENT` sem detalhe. `tests/test_schemas.py` prende o limite — somar campo exige
  tirar outro.

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
