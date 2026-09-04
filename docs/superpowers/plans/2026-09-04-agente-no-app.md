# Agente no App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar a quinta aba **Agente**, com várias conversas persistentes, histórico completo, nova conversa, renomear, excluir, retry e HITL, mantendo memória do app totalmente separada da memória do WhatsApp.

**Architecture:** O FastAPI continua sendo a única borda privilegiada e reutiliza o mesmo LangGraph, tools, guards, cota e checkpointer. `user_sessions` ganha identidade UUID e canal; o WhatsApp preserva telefone/epoch e o app usa uma sessão por conversa. Mensagens do app ficam numa tabela de infraestrutura acessível somente pelo backend. A API deriva usuário e workspace do JWT/banco, serializa cada conversa com lease e usa um UUID do cliente para deduplicar todo turno.

**Tech Stack:** Expo SDK 57, Expo Router, React Native 0.86, TanStack Query 5, FlashList 2, react-native-keyboard-controller, FastAPI 0.141, Pydantic 2, psycopg 3, LangGraph 1.2, PostgreSQL/Supabase, PyJWT ES256, pytest e `node:test`.

## Global Constraints

- O desenho aprovado é [2026-09-04-agente-no-app-design.md](../specs/2026-09-04-agente-no-app-design.md). Se este plano e o desenho divergirem, pare e corrija o plano antes do código.
- Antes de editar Expo/React Native, leia as páginas exatas do SDK 57 usadas pela tarefa em `https://docs.expo.dev/versions/v57.0.0/`, especialmente Expo Router, Native Tabs e teclado/safe area. Não use comportamento lembrado de outra versão.
- Inicie em `feat/conta-e-agente`, cuja base funcional é `be15dcc`; o commit deste plano pode estar
  imediatamente acima dela. Exija `git status --short --branch` limpo e preserve mudanças do usuário
  se o estado já tiver avançado.
- Trabalhe em RED → GREEN → REFACTOR. Cada bloco abaixo começa pelo teste que prova o contrato e termina com o teste específico verde antes do commit.
- WhatsApp e app compartilham apenas motor, tools, guards, prompts, workspace e cota. Nenhuma consulta de histórico pode atravessar `channel` ou outro `user_id`.
- Contexto do prompt: app = 10 turnos e 12.000 caracteres; WhatsApp = 5 turnos e 8.000 caracteres. Remova mensagens antigas inteiras; nunca corte conteúdo no meio.
- A aba do app recebe apenas texto nesta fase e espera a resposta final. Áudio, imagem e PDF existentes no WhatsApp devem continuar funcionando.
- Não adicione dependência nativa. Gere o UUID do turno com um helper puro e uma fonte de bytes
  injetável: use `globalThis.crypto.getRandomValues` onde existir e um preenchimento por
  `Math.random` no runtime nativo. Esse valor serve somente para deduplicação, nunca como credencial,
  e o backend sempre o restringe ao usuário e à conversa. Isso mantém a fase compatível com o
  binário atual.
- Tabelas de conversa são infraestrutura: RLS ligada, sem policy e com privilégios de `anon`/`authenticated` revogados. O app fala apenas com o FastAPI.
- Produção é `kwriuifcwyvdrxtspjiz` e fica intocada. Staging é `utkqoiigimqzeenxkxdl`; qualquer `db push` exige `scripts/supabase-target.sh` e dry-run primeiro.
- Não fazer deploy do Cloud Run, EAS Build/Update, Edge Function, secrets ou configuração remota nesta execução. Não fazer `git push` sem autorização separada.
- Commits locais seguem `.claude/rules/workflow.md`: Conventional Commit em uma linha, sem corpo e sem coautor.

---

## Contract Map

| Responsabilidade | Arquivo atual | Mudança planejada |
|---|---|---|
| Sessão, pending, draft e idempotência | `supabase/migrations/0040_python_agent.sql`, `0043`, `0044`, `0053` | Nova `0055_app_agent_chat.sql`; migrations antigas não mudam |
| Acesso PostgreSQL | `agent/app/db.py` | Consultas por `session_id`, chave genérica de execução e primitives transacionais do chat |
| Motor do turno | `agent/app/worker.py` | Extrair para `agent/app/conversation.py`; worker fica como adaptador WhatsApp |
| Estado e prompt | `agent/app/graph/state.py`, `nodes.py`, `prompts.py` | Identidade/canal genéricos e janela de histórico parametrizada |
| Auth do app | `agent/app/routes/internal.py` | Mover contrato compartilhado para `agent/app/auth.py` e validar issuer |
| API do chat | inexistente | `agent/app/routes/chat.py` + `agent/app/app_chat.py` |
| Cliente HTTP | inexistente | `src/lib/agent-api.ts` e `src/hooks/use-agent-chat.ts` |
| Estado puro do cliente | inexistente | `src/lib/agent-chat.ts` + `src/lib/agent-chat.test.ts` |
| Quinta aba | três `src/components/app-tabs*` | Adicionar `agent` em iOS, Android e web |
| Pilha/telas | inexistente | `src/app/(tabs)/agent/{_layout,index,new,[id]}.tsx` |
| UI de chat | inexistente | `src/components/agent/*` |
| Vitrine visual | `src/app/design-preview.tsx` | Quinta raiz e fixture de conversas |

## API Contract

Todos os pedidos usam `Authorization: Bearer <access-token>` e respostas de erro usam `{ "code": string, "message": string }`, sem SQL, prompt ou stack trace.

| Método | Rota | Corpo | Sucesso |
|---|---|---|---|
| `GET` | `/internal/chat/conversations?cursor=&limit=20` | nenhum | `{ items, next_cursor }` |
| `POST` | `/internal/chat/conversations` | `{ client_message_id, content }` | `TurnEnvelope`, com a conversa criada |
| `PATCH` | `/internal/chat/conversations/{id}` | `{ title }` | conversa atualizada |
| `DELETE` | `/internal/chat/conversations/{id}` | nenhum | `204` |
| `GET` | `/internal/chat/conversations/{id}/messages?before=&limit=40` | nenhum | `{ items, next_cursor }` em ordem cronológica |
| `POST` | `/internal/chat/conversations/{id}/messages` | `{ client_message_id, content }` | `TurnEnvelope` |
| `POST` | `/internal/chat/conversations/{id}/actions/{pending_id}` | `{ client_message_id, decision, candidate_id }` | `TurnEnvelope` |

`decision` aceita `approve`, `reject` ou `choose`. `candidate_id` é obrigatório somente para `choose` e deve pertencer à lista congelada da própria pendência.

`TurnEnvelope.status` aceita `processing`, `completed` ou `failed`. Um UUID repetido devolve o estado já persistido; um UUID diferente durante lease vivo devolve `409 conversation_busy`. Limite mensal devolve `402 plan_limit`, rajada por hora devolve `429 rate_limit` e um segundo `401` após refresh encerra a sessão local.

---

### Task 0: Baseline e documentação da plataforma

**Files:**
- Read: `AGENTS.md`
- Read: `.claude/rules/agent.md`
- Read: `.claude/rules/design.md`
- Read: `.claude/rules/frontend.md`
- Read: `.claude/rules/supabase.md`
- Read: `.claude/rules/workflow.md`
- Read: `docs/superpowers/specs/2026-09-04-agente-no-app-design.md`

- [ ] Confirme diretório, branch e sujeira:

```bash
pwd
git status --short --branch
git log --oneline -3
```

Esperado no ponto de partida: branch `feat/conta-e-agente`, `be15dcc` visível no histórico recente
como base funcional e nenhum arquivo modificado.

- [ ] Leia as páginas versionadas do Expo SDK 57 sobre Router/Stack e Native Tabs antes de escrever TSX. Registre no log de execução quais páginas foram usadas.

- [ ] Rode a suíte curta de baseline:

```bash
npm test
agent/.venv/bin/pytest agent/tests -q
npx tsc --noEmit
npx expo lint
```

Esperado: tudo verde antes da primeira alteração funcional. Se algo já falhar, registre a falha preexistente e não a misture ao commit da fase.

---

### Task 1: Generalizar o schema de sessão sem apagar o WhatsApp

**Files:**
- Create: `supabase/migrations/0055_app_agent_chat.sql`
- Create: `supabase/tests/app_agent_chat.sql`
- Modify: `supabase/tests/agent_migrations.sql`
- Modify: `supabase/tests/phone_link.sql`

- [ ] Escreva primeiro `supabase/tests/app_agent_chat.sql` como transação descartável. O teste deve criar dois usuários/workspaces e provar estes casos:

  1. sessão omitindo `channel` continua nascendo como `whatsapp`;
  2. duas sessões `app` do mesmo usuário/workspace são aceitas;
  3. `whatsapp` sem telefone falha;
  4. `app` com telefone, sem usuário, sem workspace, sem título ou sem UUID inicial falha;
  5. `thread_id` e `id` são únicos;
  6. `pending_actions` e `draft_actions` apontam para `session_id` e aceitam `phone = null` no app;
  7. apagar uma conversa do app remove só mensagens/pending/draft daquela sessão;
  8. trocar o telefone remove a sessão WhatsApp antiga, mas preserva todas as conversas do app;
  9. `anon` e `authenticated` não têm privilégio sobre `app_chat_messages`;
  10. a chave de `executed_actions` se chama `source_message_id` e preserva as linhas antigas.

- [ ] Rode o teste antes da migration e veja RED por coluna/tabela inexistente:

```bash
docker exec -i supabase_db_app-proops psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/app_agent_chat.sql
```

- [ ] Implemente `0055_app_agent_chat.sql` sem editar migrations aplicadas. A forma final de `public.user_sessions` deve conter:

```sql
id uuid primary key default gen_random_uuid(),
thread_id text unique not null,
channel text not null default 'whatsapp' check (channel in ('whatsapp', 'app')),
phone text unique,
user_id uuid references public.profiles(id) on delete cascade,
workspace_id uuid references public.workspaces(id) on delete cascade,
title text,
first_client_message_id uuid,
lease_message_id uuid,
lease_expires_at timestamptz,
deleting_at timestamptz,
timezone text not null default 'America/Sao_Paulo',
session_epoch int not null default 0,
last_message_at timestamptz,
debounce_task_name text,
created_at timestamptz not null default now()
```

O check de forma deve aceitar exatamente:

- WhatsApp: `phone is not null`, `title is null`, `first_client_message_id is null`;
- app: `phone is null`, `user_id/workspace_id/title/first_client_message_id` não nulos, `session_epoch = 0` e `debounce_task_name is null`;
- título, quando presente: `btrim(title)` entre 1 e 80 caracteres.

Faça o backfill de `id` e `channel = 'whatsapp'` antes de `set not null`; troque a PK de `thread_id` para `id` e mantenha `thread_id` unique. Crie unique `(user_id, first_client_message_id)` para a criação idempotente do app.

- [ ] Adicione `session_id uuid` a `pending_actions` e `draft_actions`, preencha as linhas históricas pelo telefone, recuse backfill incompleto, aplique `not null` e FK `on delete cascade`. Torne `phone` anulável nas duas tabelas. Troque o unique de rascunho em telefone por unique em `session_id`; mantenha a trava de uma pendência aberta por thread e acrescente a mesma trava por sessão.

- [ ] Renomeie somente `executed_actions.wa_message_id` para `source_message_id`. `messages_queue.wa_message_id` continua com o nome da Meta porque essa tabela segue exclusiva do WhatsApp.

- [ ] Crie `public.app_chat_messages` com o contrato completo:

```sql
id uuid primary key default gen_random_uuid(),
session_id uuid not null references public.user_sessions(id) on delete cascade,
sequence bigint generated always as identity,
client_message_id uuid,
role text not null check (role in ('user', 'assistant')),
content text not null check (btrim(content) <> ''),
ui_payload jsonb,
in_reply_to uuid,
status text not null check (status in ('processing', 'completed', 'failed')),
error_code text,
created_at timestamptz not null default now(),
completed_at timestamptz,
unique (session_id, sequence),
unique (session_id, client_message_id),
unique (session_id, id),
foreign key (session_id, in_reply_to)
  references public.app_chat_messages(session_id, id) on delete cascade
```

Adicione checks para: mensagem `user` ter `client_message_id` e `in_reply_to is null`; mensagem `assistant` ter `client_message_id is null`, `in_reply_to is not null` e `status = 'completed'`; `error_code` existir apenas quando `status = 'failed'`.

- [ ] Crie índices para lista `(user_id, last_message_at desc, id desc)` filtrada por `channel = 'app' and deleting_at is null`, histórico `(session_id, sequence desc)` e resposta `(session_id, in_reply_to)`. Ligue RLS e execute `revoke all on public.app_chat_messages from anon, authenticated`.

- [ ] Redefina em `0055` a função viva `public.handle_auth_phone_link()` da `0053`, acrescentando `s.channel = 'whatsapp'` tanto no loop de checkpoints quanto no `delete from user_sessions`. Isso impede uma troca de telefone de apagar o histórico do app.

- [ ] Atualize os inserts de `pending_actions`/`draft_actions` nos dois testes antigos para preencher `session_id`. Acrescente em `phone_link.sql` uma sessão `app` do mesmo usuário e assira que ela sobrevive à troca.

- [ ] Aplique somente no Supabase local e rode GREEN:

```bash
SUPABASE_TELEMETRY_DISABLED=1 npx supabase migration up --local
docker exec -i supabase_db_app-proops psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/app_agent_chat.sql
docker exec -i supabase_db_app-proops psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/agent_migrations.sql
docker exec -i supabase_db_app-proops psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/phone_link.sql
```

- [ ] Commit:

```bash
git add supabase/migrations/0055_app_agent_chat.sql supabase/tests/app_agent_chat.sql supabase/tests/agent_migrations.sql supabase/tests/phone_link.sql
git commit -m "feat(db): prepara conversas do agente no app"
```

---

### Task 2: Tornar identidade, pending, draft e execução independentes de telefone

**Files:**
- Modify: `agent/app/db.py`
- Modify: `agent/app/tools/base.py`
- Modify: `agent/app/tools/registry.py`
- Modify: `agent/app/graph/state.py`
- Modify: `agent/app/graph/nodes.py`
- Modify: `agent/app/worker.py`
- Create: `agent/tests/test_conversation_identity.py`
- Modify: `agent/tests/test_hitl_flow.py`
- Modify: `agent/tests/test_draft_flow.py`
- Modify: `agent/tests/test_interactive_clicks_expiration.py`
- Modify: `agent/tests/test_cognitive_reading.py`
- Modify: `agent/tests/test_plano_alvo.py`
- Modify: `agent/tests/test_progressive_disclosure.py`
- Modify: `agent/tests/test_query_blueprint_and_button_sentry.py`
- Modify: `agent/tests/test_shifting_e_limite.py`
- Modify: `agent/tests/test_smart_windows_separation.py`
- Modify: `agent/tests/test_state_cache_locking.py`
- Modify: `agent/tests/test_unified_cumulative_pagination.py`
- Modify: `agent/tests/test_parcelas_retroativas.py`

- [ ] Em `test_conversation_identity.py`, escreva RED para provar:

  - `ExecContext.phone` aceita `None`;
  - `AgentState` usa `source_message_id` e `channel`, sem chave `wa_message_id`;
  - `open_pending`, `open_draft`, `delete_draft` e `save_draft` usam o UUID da sessão;
  - `reserve_execution`, `confirm_execution` e `release_execution` usam `source_message_id`;
  - `ensure_session` continua fazendo upsert por `phone` e devolve `channel = whatsapp` da linha.

- [ ] Rode RED:

```bash
agent/.venv/bin/pytest agent/tests/test_conversation_identity.py -q
```

- [ ] Em `tools/base.py`, altere o contrato para:

```python
@dataclass
class ExecContext:
    user_id: UUID
    workspace_id: UUID
    phone: str | None
    timezone: str
    texto: str
    source_message_id: str
    action_index: int = 0
    target: dict | None = None
    created: list[str] = field(default_factory=list)
    last_query_data: dict | None = None
    clicked_id: str | None = None
```

- [ ] Renomeie `wa_message_id` para `source_message_id` somente no estado do grafo, contexto e reserva de execução. O adaptador WhatsApp deve continuar lendo `lote[-1]['wa_message_id']` e convertê-lo ao construir o estado.

- [ ] Mude as funções de pending/draft em `db.py` para receber `session_id: UUID`; `phone` vira dado opcional apenas no insert/auditoria. Use `on conflict (session_id)` para o rascunho. Buscas e deleções são sempre por `session_id`, nunca por telefone.

- [ ] Atualize `_estado_base`, `_run_graph`, `_resposta_do_estado` e os fixtures existentes com `session_id`, `channel` e `source_message_id`. Não remova a limpeza/reset de nenhuma chave do `AgentState`.

- [ ] Rode GREEN específico e depois a suíte Python inteira:

```bash
agent/.venv/bin/pytest agent/tests/test_conversation_identity.py agent/tests/test_state_reset.py agent/tests/test_hitl_flow.py agent/tests/test_draft_flow.py agent/tests/test_interactive_clicks_expiration.py -q
agent/.venv/bin/pytest agent/tests -q
```

- [ ] Confirme que só a fila/serviço da Meta ainda usa o nome WhatsApp:

```bash
rg -n "wa_message_id" agent/app
```

Esperado: `routes/inbound.py`, `services/whatsapp.py`, fila de `db.py` e a conversão no adaptador; não `AgentState`, `ExecContext`, registry ou `executed_actions`.

- [ ] Commit:

```bash
git add agent/app agent/tests
git commit -m "refactor(agent): generaliza identidade de conversa"
```

---

### Task 3: Extrair o motor compartilhado e aplicar janelas 10/5

**Files:**
- Create: `agent/app/conversation.py`
- Modify: `agent/app/worker.py`
- Modify: `agent/app/graph/state.py`
- Modify: `agent/app/graph/nodes.py`
- Modify: `agent/app/graph/prompts.py`
- Modify: `agent/app/graph/build.py`
- Create: `agent/tests/test_prompt_history.py`
- Create: `agent/tests/test_whatsapp_media_regression.py`
- Modify: `agent/tests/test_short_term_memory.py`
- Modify: `agent/tests/test_state_reset.py`
- Modify: `agent/tests/test_ai_usage.py`

- [ ] Escreva `test_prompt_history.py` em RED para o helper puro abaixo:

```python
CHANNEL_LIMITS = {
    "app": {"turns": 10, "chars": 12_000},
    "whatsapp": {"turns": 5, "chars": 8_000},
}

def trim_prompt_history(messages: list[dict], channel: str) -> list[dict]:
    """Mantém as mensagens completas mais recentes dentro dos dois limites."""
```

Cubra exatamente: 11 pares no app viram 10; 6 pares no WhatsApp viram 5; orçamento remove as mais antigas; mensagem individual nunca é fatiada; lista original não é mutada; conteúdo de outra lista/thread não aparece.

- [ ] Em `test_whatsapp_media_regression.py`, escreva RED com dublês que prove:

  - áudio chama `whatsapp.download_media`, passa os bytes a `groq.transcribe` e entrega a transcrição sanitizada ao motor;
  - imagem e PDF válidos continuam em base64;
  - MIME inválido e arquivo acima de 8 MiB continuam recusados.

- [ ] Rode RED:

```bash
agent/.venv/bin/pytest agent/tests/test_prompt_history.py agent/tests/test_whatsapp_media_regression.py -q
```

- [ ] Mova de `worker.py` para `conversation.py` toda lógica que começa na checagem de limites e termina na materialização da resposta: `_check_limits`, estado base, rascunho, pending/HITL, execução do grafo, auditoria e builders de UI. `worker.py` fica responsável apenas por claim/retry da fila, download/transcrição de mídia, read receipt e envio pela Meta.

- [ ] Exponha no módulo compartilhado as funções assíncronas
  `run_turn(session: dict, *, source_message_id: str, content: dict, prompt_history: list[dict]) -> str | dict`
  e `recover_turn(session: dict, *, source_message_id: str) -> str | dict | None`, ambas com implementação
  completa. `recover_turn` lê `graph().aget_state()` e só reutiliza o checkpoint quando
  `source_message_id` coincide; isso recupera uma resposta/interrupt gravado no LangGraph antes de a
  persistência HTTP terminar, sem executar tools outra vez.

- [ ] Troque `messages` por um valor de substituição, não acumulação cega. A borda entrega o histórico já cortado mais a mensagem atual; `compose` devolve o mesmo vetor acrescido da resposta. No WhatsApp, carregue o estado anterior com `aget_state` e aplique a janela 5/8.000 antes do novo turno. No app, a API fornecerá o histórico da tabela e aplicará 10/12.000.

- [ ] Remova o `history[-6:]` de `prompts.user_turn`; ele deve renderizar exatamente o histórico já limitado. Generalize “mensagens de WhatsApp” nos prompts para “mensagens do assistente”, sem alterar a barreira `_ANTI_INJECTION`.

- [ ] Faça `_audit` usar `session['channel']`. Um turno do app grava `app`; o WhatsApp permanece `whatsapp`; ambos continuam usando o mesmo `workspace_id`, `ai_events_last_hour` e `plan_status`.

- [ ] Em `graph/build.py`, exponha:

```python
async def delete_thread(thread_id: str) -> None:
    if _checkpointer is None:
        raise RuntimeError("checkpointer não inicializado")
    await _checkpointer.adelete_thread(thread_id)
```

- [ ] Rode GREEN e a regressão do motor:

```bash
agent/.venv/bin/pytest agent/tests/test_prompt_history.py agent/tests/test_whatsapp_media_regression.py agent/tests/test_short_term_memory.py agent/tests/test_state_reset.py agent/tests/test_ai_usage.py -q
agent/.venv/bin/pytest agent/tests -q
```

- [ ] Commit:

```bash
git add agent/app/conversation.py agent/app/worker.py agent/app/graph agent/tests
git commit -m "refactor(agent): separa motor dos canais"
```

---

### Task 4: Persistir turnos, deduplicar e serializar cada conversa do app

**Files:**
- Create: `agent/app/app_chat.py`
- Modify: `agent/app/db.py`
- Modify: `agent/app/config.py`
- Modify: `agent/.env.example`
- Create: `agent/tests/test_app_chat.py`

- [ ] Escreva `test_app_chat.py` em RED com repositório dublê e relógio controlado. Cubra:

  1. título automático usa a primeira linha, colapsa espaços e limita em 48 caracteres;
  2. criação deriva workspace/timezone pelo usuário e grava sessão + primeira mensagem sem conversa vazia;
  3. mesmo `client_message_id` na criação devolve a mesma sessão;
  4. UUID completo retorna a resposta persistida;
  5. UUID em processamento retorna `processing` sem segundo grafo;
  6. UUID falho recupera checkpoint final antes de tentar o grafo;
  7. UUID falho sem checkpoint pode tentar novamente com o mesmo `source_message_id`;
  8. o UUID persistido chega ao motor exatamente como `app:<client_message_id>`;
  9. outro UUID durante lease vivo recebe `ConversationBusy`;
  10. lease vencido pode ser adquirido;
  11. sucesso persiste resposta antes de liberar lease;
  12. erro marca a mensagem como `failed`, grava apenas código seguro e libera lease;
  13. cota mensal e rajada viram códigos diferentes;
  14. ação HITL inventada, cruzada ou expirada nunca chama `run_turn`;
  15. exclusão marca `deleting_at`, apaga checkpoint e só então remove a sessão.

- [ ] Rode RED:

```bash
agent/.venv/bin/pytest agent/tests/test_app_chat.py -q
```

- [ ] Acrescente `app_turn_lease_seconds: int = 300` em `Settings` e `APP_TURN_LEASE_SECONDS=300` em `agent/.env.example`.

- [ ] Em `db.py`, crie primitives transacionais com `async with pool().connection()` e `async with conn.transaction()`. A aquisição deve fazer `select ... for update` na sessão, verificar `channel = 'app'`, `deleting_at is null`, usuário e membership antes de inserir/reabrir a mensagem e definir o lease. Nunca aceite `user_id` ou `workspace_id` vindo do corpo HTTP.

- [ ] Em `app_chat.py`, defina exceções de domínio (`ConversationNotFound`, `ConversationBusy`, `PlanLimit`, `RateLimit`, `PendingInvalid`) e estes DTOs internos:

```python
@dataclass
class TurnResult:
    status: Literal["processing", "completed", "failed"]
    conversation: dict
    user_message: dict
    assistant_message: dict | None

@dataclass
class TurnClaim:
    kind: Literal["run", "processing", "completed"]
    session: dict
    user_message: dict
    assistant_message: dict | None
```

- [ ] Implemente criação e envio pelo mesmo caminho `execute_turn`. Para um turno novo, persista a mensagem do usuário em `processing`, carregue somente mensagens `completed` da mesma `session_id`, derive `source_message_id` exatamente como `app:<client_message_id>`, rode `conversation.run_turn`, insira a resposta com `in_reply_to`, marque o usuário `completed`, atualize `last_message_at` e só então limpe o lease. O UUID cru continua nas tabelas e na API; o prefixo existe apenas no motor/checkpoint e na reserva das tools.

- [ ] Converta a resposta do motor em duas colunas: `content` recebe `reply['text']` ou a string; `ui_payload` recebe o dict estruturado, acrescido de `pending_id` quando houver HITL. `create_pending` deve, em corrida/recovery, devolver a pendência aberta existente da mesma sessão em vez de eliminar os botões.

- [ ] Na ação HITL, valide no servidor que `pending_id` pertence à sessão e que `candidate_id` consta em `pending.action.candidates`. Converta a decisão para o mesmo `clicked_id` já entendido por `confirm.decide` (`pa:{id}:ok`, `pa:{id}:no`, `pa:{id}:c:{candidate}`). Persista o rótulo visível como mensagem do usuário e marque o `ui_payload` anterior com a resolução.

- [ ] A exclusão deve: travar/ocultar a sessão com `deleting_at`, recusar lease vivo com `ConversationBusy`, chamar `graph.build.delete_thread(thread_id)`, e apagar a sessão em transação. Qualquer leitura posterior retorna not found; uma ação antiga não encontra pending e não executa.

- [ ] Rode GREEN:

```bash
agent/.venv/bin/pytest agent/tests/test_app_chat.py agent/tests/test_hitl_flow.py agent/tests/test_ai_usage.py -q
agent/.venv/bin/pytest agent/tests -q
```

- [ ] Commit:

```bash
git add agent/app/app_chat.py agent/app/db.py agent/app/config.py agent/.env.example agent/tests/test_app_chat.py
git commit -m "feat(agent): persiste conversas do app"
```

---

### Task 5: Expor API autenticada e fechar IDOR/JWT/CORS

**Files:**
- Create: `agent/app/auth.py`
- Create: `agent/app/routes/chat.py`
- Modify: `agent/app/routes/internal.py`
- Modify: `agent/app/main.py`
- Modify: `agent/app/config.py`
- Modify: `agent/.env.example`
- Modify: `agent/tests/test_jwt.py`
- Create: `agent/tests/test_app_chat_routes.py`
- Modify: `agent/tests/test_boot.py`

- [ ] Substitua o teste de source code de JWT por testes comportamentais RED. Gere uma chave EC de teste, assine tokens ES256 e prove: token correto aceita `aud=authenticated`, `iss=https://exemplo.supabase.co/auth/v1` e `exp` futuro; issuer errado, audience errada, token expirado, algoritmo diferente e `sub` ausente recebem 401.

- [ ] Em `test_app_chat_routes.py`, monte um FastAPI mínimo com o router e dependências dublês. Cubra todos os endpoints, validação 4.000/80, cursores inválidos, `404` indistinguível para outro usuário/outro canal/workspace removido, `409`, `402`, `429`, action inválida e `204` na exclusão.

- [ ] Rode RED:

```bash
agent/.venv/bin/pytest agent/tests/test_jwt.py agent/tests/test_app_chat_routes.py -q
```

- [ ] Mova `_jwks`, `_decode`, `current_user` e `ensure_member` para `agent/app/auth.py`. Adicione em `Settings`:

```python
@property
def jwt_issuer(self) -> str:
    return f"{self.supabase_url.rstrip('/')}/auth/v1"
```

E decodifique com `algorithms=['ES256']`, `audience='authenticated'`, `issuer=settings.jwt_issuer`, exigindo `exp`, `iss`, `aud` e `sub`.

- [ ] Crie os modelos Pydantic da API com `extra='forbid'`, trim de whitespace e limites exatos. O corpo nunca contém `user_id`, `workspace_id`, `thread_id`, `phone` ou `channel`. Registre handlers para erros de validação e autenticação, garantindo que inclusive `422` e `401` sigam `{ "code", "message" }` e não exponham o formato interno do FastAPI.

- [ ] Implemente paginação opaca:

  - conversas: cursor codifica `(last_message_at, id)` e a query usa comparação de tupla na ordem desc;
  - mensagens: `before` é o `sequence` mais antigo já carregado; busque desc, reverta antes de responder;
  - busque `limit + 1`, limite permitido 1..50 para conversas e 1..100 para mensagens.

- [ ] Mapeie as exceções de domínio para códigos HTTP estáveis. Toda lookup deve combinar `id`, `user_id`, `channel = 'app'`, `deleting_at is null` e membership atual; retorne sempre o mesmo `404 conversation_not_found` se qualquer parte falhar.

- [ ] Inclua `chat.router` em `main.py`. Adicione `APP_CORS_ORIGINS=http://localhost:8081,http://localhost:19006` ao exemplo e configure `CORSMiddleware` apenas para as origens enumeradas; métodos/headers mínimos, sem `*`.

- [ ] Rode GREEN e a suíte completa:

```bash
agent/.venv/bin/pytest agent/tests/test_jwt.py agent/tests/test_app_chat_routes.py agent/tests/test_boot.py -q
agent/.venv/bin/pytest agent/tests -q
```

- [ ] Commit:

```bash
git add agent/app/auth.py agent/app/routes/chat.py agent/app/routes/internal.py agent/app/main.py agent/app/config.py agent/.env.example agent/tests
git commit -m "feat(agent): expoe chat autenticado"
```

---

### Task 6: Criar cliente HTTP, cache e retry manual no Expo

**Files:**
- Create: `src/lib/agent-api.ts`
- Create: `src/lib/agent-chat.ts`
- Create: `src/lib/agent-chat.test.ts`
- Create: `src/hooks/use-agent-chat.ts`
- Modify: `.env.example`

- [ ] Escreva `src/lib/agent-chat.test.ts` em RED para helpers puros:

  - UUID v4 usa 16 bytes injetados, aplica bits de versão/variant e mantém o mesmo ID num retry;
  - a fonte padrão prefere `crypto.getRandomValues`, usa o fallback nativo quando ele não existe e
    nunca troca o UUID já guardado numa mensagem falha;
  - texto vazio/whitespace e texto acima de 4.000 não podem enviar;
  - título renomeado acima de 80 não pode salvar;
  - páginas de conversas são concatenadas sem duplicar IDs;
  - páginas antigas de mensagens são prefixadas sem mudar a ordem nem duplicar `sequence`;
  - `isNearChatEnd` distingue 80 px do fim;
  - resposta `402 plan_limit` pede paywall; `409` mantém composer bloqueado; falha de rede é retryable;
  - decisão HITL resolvida desabilita todos os controles.

- [ ] Rode RED:

```bash
node --test src/lib/agent-chat.test.ts
```

- [ ] Em `agent-api.ts`, declare os DTOs que espelham o contrato HTTP, `AgentApiError` e `agentFetch`. Leia `EXPO_PUBLIC_AGENT_URL`, remova barra final e falhe com mensagem segura se estiver vazio.

- [ ] `agentFetch` deve obter o access token com `supabase.auth.getSession()`, enviar Bearer, e em 401 executar `refreshSession()` exatamente uma vez. Se o retry também retornar 401, execute `signOut()` e lance `AgentAuthExpiredError`; nunca faça loop de refresh.

- [ ] Implemente o UUID sem nova dependência nativa. `newClientMessageId(fillRandomBytes = defaultRandomBytes)` recebe uma função que preenche 16 bytes; `defaultRandomBytes` prefere `globalThis.crypto?.getRandomValues` e, quando indisponível no React Native, preenche cada byte com `Math.floor(Math.random() * 256)`. Documente no código que o valor é uma chave opaca de deduplicação, não um segredo. Formate os bits RFC 4122 de versão 4/variant e valide o formato no servidor.

- [ ] Em `use-agent-chat.ts`, use chaves estáveis:

```typescript
const agentKeys = {
  conversations: ['agent', 'conversations'] as const,
  messages: (id: string) => ['agent', 'messages', id] as const,
};
```

Crie infinite queries para conversas/mensagens e mutations para create/send/action/rename/delete. `send` e `action` usam `retry: false`; retry manual reaproveita o UUID guardado na mensagem local. Atualize/invalide somente a conversa atingida e os agregados de `plan-status`.

- [ ] Para resposta `processing`, não reenvie instrução. Faça apenas refetch seguro do histórico enquanto a tela estiver montada; a nova tentativa de escrita só acontece quando a pessoa tocar **Tentar novamente**.

- [ ] Acrescente a `.env.example`:

```dotenv
EXPO_PUBLIC_AGENT_URL=
```

- [ ] Rode GREEN, TypeScript e lint:

```bash
node --test src/lib/agent-chat.test.ts
npx tsc --noEmit
npx expo lint
```

- [ ] Commit:

```bash
git add src/lib/agent-api.ts src/lib/agent-chat.ts src/lib/agent-chat.test.ts src/hooks/use-agent-chat.ts .env.example
git commit -m "feat(app): adiciona cliente do agente"
```

---

### Task 7: Adicionar quinta aba e lista de conversas

**Files:**
- Create: `src/app/(tabs)/agent/_layout.tsx`
- Create: `src/app/(tabs)/agent/index.tsx`
- Create: `src/components/agent/conversation-row.tsx`
- Create: `src/components/agent/rename-conversation-sheet.tsx`
- Modify: `src/components/app-tabs.tsx`
- Modify: `src/components/app-tabs.android.tsx`
- Modify: `src/components/app-tabs.web.tsx`
- Modify: `src/components/ui/icon.tsx`
- Modify: `src/app/design-preview.tsx`
- Modify: `src/components/ui/app-header.tsx`
- Modify: `.claude/rules/design.md`
- Modify: `.claude/rules/workflow.md`
- Modify: `src/lib/icon-map.test.ts`
- Create: `src/lib/agent-navigation.test.ts`

- [ ] Escreva `agent-navigation.test.ts` em RED para ler os três arquivos de tab bar e provar que todos contêm, uma única vez e na mesma ordem, `today`, `notes`, `finance`, `agent`, `profile`. Trave também os cinco destinos da vitrine.

- [ ] Rode RED:

```bash
node --test src/lib/agent-navigation.test.ts src/lib/icon-map.test.ts
```

- [ ] Adicione a aba com rótulo **Agente**, SF Symbols `bubble.left.and.bubble.right`/`.fill` e Material `forum`. Acrescente ambos os SF Symbols ao mapa central do `Icon`. No Android, estenda `TABS` e `HREFS` para `/agent`; não altere a matemática de `CurvedTabBar`, que já deriva o slot de `tabs.length`.

- [ ] Crie a pilha nativa do agente com `initialRouteName: 'index'`, raiz sem header nativo e `new`/`[id]` com Stack nativo e `stackHeaderFonts`.

- [ ] A raiz usa `Screen scroll={false} grouped`, `AppHeader title="Agente"` e `HeaderIconButton` **Nova conversa**. Renderize a infinite query com `FlashList`; `ConversationRow` memoizado recebe somente primitives, callback estável com ID, título, preview e horário. `onEndReached` busca o próximo cursor sem refetch concorrente.

- [ ] O vazio deve mostrar a marca, “Comece uma conversa” e três prompts tocáveis exatamente:

  - “Quanto gastei este mês?”
  - “Registre R$ 45 no mercado”
  - “O que vence esta semana?”

Cada prompt abre `/agent/new?prompt=...`, mas não cria linha no servidor.

- [ ] Long press abre `showItemActions` com **Renomear** e **Excluir**. Renomear usa `Sheet` + `TextField`, contador/limite 80 e mutation; excluir usa `confirmDestructive`, informa que histórico e confirmações serão apagados, remove a linha só depois do sucesso e mostra erro no toast se falhar.

- [ ] Loading usa seis skeletons com a forma da linha. Erro usa `EmptyState` com **Tentar novamente**. Preview e título usam `numberOfLines`; Dynamic Type não pode esconder as ações.

- [ ] Atualize `design-preview.tsx`: cinco raízes, aba Android na mesma ordem de produção, `AgentScreen` real e cache `['agent','conversations']` no formato de infinite query. Atualize apenas menções realmente referentes às raízes de quatro para cinco em `app-header.tsx`, `design.md` e `workflow.md`.

- [ ] Rode GREEN e gates rápidos:

```bash
node --test src/lib/agent-navigation.test.ts src/lib/icon-map.test.ts src/lib/agent-chat.test.ts
npx tsc --noEmit
npx expo lint
```

- [ ] Commit:

```bash
git add 'src/app/(tabs)/agent' src/components/agent/conversation-row.tsx src/components/agent/rename-conversation-sheet.tsx src/components/app-tabs.tsx src/components/app-tabs.android.tsx src/components/app-tabs.web.tsx src/components/ui/icon.tsx src/app/design-preview.tsx src/components/ui/app-header.tsx .claude/rules/design.md .claude/rules/workflow.md src/lib/agent-navigation.test.ts src/lib/icon-map.test.ts
git commit -m "feat(app): adiciona quinta aba do agente"
```

---

### Task 8: Implementar conversa, composer, histórico e HITL

**Files:**
- Create: `src/app/(tabs)/agent/new.tsx`
- Create: `src/app/(tabs)/agent/[id].tsx`
- Create: `src/components/agent/conversation-screen.tsx`
- Create: `src/components/agent/chat-message.tsx`
- Create: `src/components/agent/chat-composer.tsx`
- Create: `src/components/agent/chat-actions.tsx`
- Modify: `src/lib/agent-chat.ts`
- Modify: `src/lib/agent-chat.test.ts`

- [ ] Amplie primeiro os testes puros em RED para provar:

  - `/agent/new` mantém apenas estado local antes do primeiro envio;
  - sucesso de criação troca a rota por `/agent/{id}`;
  - falha conserva texto e UUID para retry manual;
  - composer bloqueia vazio, acima de 4.000, turno ativo e action ativa;
  - mensagens antigas entram no começo e não deslocam o primeiro item visível;
  - nova resposta só segue o fim quando `isNearChatEnd` era true;
  - botões aceitam approve/reject e somente candidatos presentes;
  - controles resolvidos/expirados ficam inertes;
  - mensagem `failed` exibe **Tentar novamente** com o mesmo UUID.

- [ ] Rode RED:

```bash
node --test src/lib/agent-chat.test.ts
```

- [ ] Faça `new.tsx` e `[id].tsx` apenas adaptarem parâmetros para `ConversationScreen`. O primeiro envio em `new` chama create e, ao receber o ID, usa `router.replace('/agent/' + id)`; abrir e voltar sem enviar não grava nada.

- [ ] Em `ConversationScreen`, use `FlashList` cronológica com:

```tsx
maintainVisibleContentPosition={{
  startRenderingFromBottom: true,
  autoscrollToBottomThreshold: 0.2,
}}
onStartReached={loadOlderMessages}
onStartReachedThreshold={0.3}
```

Use `getItemType` para `user`, `assistant`, `processing` e `failed`; itens memoizados recebem primitives. Controle distância do fim via `onScroll`. Se chegar resposta quando a pessoa está longe, mostre botão acessível **Ir para a mensagem mais recente** em vez de puxar a lista.

- [ ] `ChatMessage` alinha user à direita e assistant à esquerda, preserva quebras, usa `selectable`, tokens atuais, `borderCurve: 'continuous'` e nenhuma cor literal. Texto comum não vira card. Conteúdo longo precisa quebrar sem expandir além da largura.

- [ ] `ChatComposer` usa `TextField` multiline, `maxLength={4000}`, cresce até cinco linhas, mostra contador apenas perto do limite e usa `KeyboardStickyView`/safe area. Reserve `CURVED_BAR_SPACE` no Android quando o teclado estiver fechado. O botão send tem alvo mínimo 44, rótulo acessível e fica desabilitado durante `Pensando...`.

- [ ] Renderize `Pensando...` como uma linha estável com `accessibilityLiveRegion="polite"`, sem bolhas entrando/saindo que mudem toda a lista. Respeite Reduce Motion; nenhuma animação permanente.

- [ ] `ChatActions` renderiza `ui_payload` com botões nativos do design system. Mostre o resumo congelado; envie `pending_id`, decision e candidate. Após sucesso, cacheie a resolução e desabilite tudo. Para `pending_expired`, mantenha o resumo visível, marque **Expirada** e não envie novamente.

- [ ] O header nativo de `[id]` mostra o título e `HeaderMenu` com Renomear/Excluir. Em exclusão bem-sucedida, faça `router.replace('/agent')`; em `409`, mantenha a conversa aberta e informe que o turno ainda está terminando.

- [ ] `402 plan_limit` encerra `Pensando...`, mantém a mensagem falha/retryable e abre `/paywall`. Erros de rede e 5xx ficam na própria mensagem. Não use timer para reenviar conteúdo; somente toque explícito em **Tentar novamente** chama a mutation.

- [ ] Rode GREEN, todos os testes Node, TypeScript e lint:

```bash
node --test src/lib/agent-chat.test.ts src/lib/agent-navigation.test.ts src/lib/icon-map.test.ts
npm test
npx tsc --noEmit
npx expo lint
```

- [ ] Commit:

```bash
git add 'src/app/(tabs)/agent/new.tsx' 'src/app/(tabs)/agent/[id].tsx' src/components/agent src/lib/agent-chat.ts src/lib/agent-chat.test.ts
git commit -m "feat(app): adiciona conversa e hitl"
```

---

### Task 9: Provar isolamento, recovery, cota e WhatsApp intacto

**Files:**
- Create: `agent/tests/test_app_whatsapp_isolation.py`
- Modify: `agent/tests/test_app_chat.py`
- Modify: `agent/tests/test_ai_usage.py`
- Modify: `agent/tests/test_whatsapp_media_regression.py`
- Modify: `src/lib/ai-channel-contract.test.ts`

- [ ] Escreva em RED testes de integração do serviço com grafo/dublês para estes cenários completos:

  1. chat app A fala de Nubank; chat app B do mesmo usuário recebe “e no outro?” e não vê A;
  2. WhatsApp fala de Itaú; app recebe mensagem de continuação e não vê Itaú;
  3. app fala de C6; WhatsApp recebe mensagem de continuação e não vê C6;
  4. retry após tool executada usa checkpoint/resposta existente e não chama `reserve_execution` outra vez;
  5. dois aparelhos enviam UUIDs diferentes; apenas um entra no grafo;
  6. clique HITL correto retoma a mesma thread e grava resposta; cruzado/expirado não executa;
  7. turno app com LLM grava `channel='app'`; turno WhatsApp grava `channel='whatsapp'`;
  8. ao atingir a cota pelo app, o WhatsApp também é bloqueado, e vice-versa;
  9. áudio realista em WhatsApp continua percorrendo download → Groq → grafo.

- [ ] Rode RED e implemente somente as correções necessárias:

```bash
agent/.venv/bin/pytest agent/tests/test_app_whatsapp_isolation.py agent/tests/test_app_chat.py agent/tests/test_ai_usage.py agent/tests/test_whatsapp_media_regression.py -q
```

- [ ] Atualize `ai-channel-contract.test.ts` para exigir escritores explícitos dos dois canais sem prender a localização do código por source-inspection frágil. Prefira testar o helper/DTO puro exportado pelo serviço; use leitura de fonte apenas se importar Python no Node for impossível.

- [ ] Rode as suítes completas:

```bash
agent/.venv/bin/pytest agent/tests -q
npm test
```

- [ ] Entre em `agent/`, exporte `WHATSAPP_APP_SECRET` com o mesmo valor já presente no `.env`
  local sem imprimi-lo, suba o stack e mande payload Meta assinado pelo caminho documentado. Primeiro
  envie o pedido abaixo; depois copie o ID da opção de confirmação criada pelo fluxo para
  `PENDING_CLICK_ID` e envie o clique. Não desative HMAC:

```bash
cd agent
docker compose up -d
.venv/bin/python scripts/fake_meta.py "registre R$ 45 no mercado"
.venv/bin/python scripts/fake_meta.py --click "$PENDING_CLICK_ID" "Confirmar"
```

Esperado: o primeiro payload produz exatamente uma pendência e o segundo retoma a mesma thread,
executa uma vez e entrega a resposta final pelo adaptador WhatsApp.

- [ ] Commit:

```bash
git add agent/tests src/lib/ai-channel-contract.test.ts
git commit -m "test(agent): cobre canais e recuperacao"
```

---

### Task 10: Gates, inspeção visual e staging

**Files:**
- Modify: `src/lib/database.types.ts`
- Modify: `docs/CONTA-E-AGENTE-NO-APP.md`
- Modify: `docs/superpowers/specs/2026-09-04-agente-no-app-design.md` only if implementation required an approved correction

- [ ] Rode todos os testes SQL locais depois do schema final:

```bash
docker exec -i supabase_db_app-proops psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/app_agent_chat.sql
docker exec -i supabase_db_app-proops psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/agent_migrations.sql
docker exec -i supabase_db_app-proops psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/phone_link.sql
docker exec -i supabase_db_app-proops psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < supabase/tests/ai_usage_channels.sql
```

- [ ] Rode os gates de código:

```bash
agent/.venv/bin/pytest agent/tests -q
npm test
npx tsc --noEmit
npx expo lint
SUPABASE_TELEMETRY_DISABLED=1 npx supabase db lint --local --level warning
npx expo export --platform android --output-dir /tmp/personal-proops-agent-android
npx expo export --platform web --output-dir /tmp/personal-proops-agent-web
```

- [ ] Como múltiplos componentes React foram editados, execute a skill `react-doctor`. Se a política bloquear o download de código de terceiros, registre o gate como bloqueado e não tente contornar.

- [ ] Valide `design-preview` em 402×874, claro e escuro, no Android e iOS. Confira: cinco tabs sem sobreposição, raiz/lista loading/empty/error/long, título grande nas telas empurradas, Dynamic Type, TalkBack/VoiceOver labels e alvos de 44 pt.

- [ ] No fluxo autenticado local, prove manualmente: abrir/voltar de `new` sem criar; enviar primeira mensagem; criar segunda conversa; memória separada; renomear; excluir; retry offline com mesmo UUID; scroll com páginas antigas; chegada de resposta estando longe do fim; approve/reject/candidate HITL; cota abrindo paywall.

- [ ] **Antes do push, decida a janela de cutover.** A `0055` não é expand/contract: aplicada
  sozinha, o agente Python anterior quebra em rascunho, pendência e reserva de execução, e cada
  falha consome uma retentativa até a mensagem virar `failed` de vez. No staging isso só derruba
  o `agente-staging` até o próximo deploy, o que é aceitável dentro desta fase. Para produção,
  aplicar e fazer deploy como passo único com a fila do Cloud Tasks e os jobs do Cloud Scheduler
  pausados — ou quebrar em `0055`/`0056` (precedente `0043` → `0044`). O cabeçalho da migration
  registra as duas saídas.

- [ ] Confirme staging antes de qualquer escrita:

```bash
scripts/supabase-target.sh
SUPABASE_TELEMETRY_DISABLED=1 npx supabase db push --dry-run
```

Esperado: linked ref e `.env.local` apontam ambos para `utkqoiigimqzeenxkxdl`, e o dry-run lista somente `0055_app_agent_chat.sql`. Se aparecer produção ou outra migration, pare.

- [ ] Aplique a migration somente no staging e regenere tipos a partir dele:

```bash
SUPABASE_TELEMETRY_DISABLED=1 npx supabase db push
SUPABASE_TELEMETRY_DISABLED=1 npx supabase gen types typescript --linked > src/lib/database.types.ts
```

- [ ] Rode novamente `npx tsc --noEmit`, `npm test` e `scripts/supabase-target.sh`. Confira no histórico remoto que staging termina em `0055` e produção permanece em `0048`.

- [ ] Atualize `docs/CONTA-E-AGENTE-NO-APP.md` com três blocos separados:

  - **Implementado e provado localmente**;
  - **Schema aplicado no staging**;
  - **Ainda pendente**, incluindo deploy Cloud Run, configurar `EXPO_PUBLIC_AGENT_URL`/CORS nos ambientes, app publicado, aparelho físico, cota real entre canais e produção.

- [ ] Commit final local:

```bash
git add src/lib/database.types.ts docs/CONTA-E-AGENTE-NO-APP.md docs/superpowers/specs/2026-09-04-agente-no-app-design.md
git commit -m "docs: registra agente no app"
```

- [ ] Verifique o estado final sem publicar:

```bash
git status --short --branch
git log --oneline --decorate -12
git diff origin/feat/conta-e-agente...HEAD --stat
```

O handoff deve dizer explicitamente: quais gates passaram, quais inspeções foram manuais, que staging recebeu `0055`, que produção não mudou e que nenhum deploy/push foi feito.

---

## Self-review Checklist

- [ ] Cada requisito do desenho aprovado aparece em pelo menos uma tarefa e um teste.
- [ ] Nenhuma tarefa compartilha histórico entre canais nem consulta conversa apenas por ID.
- [ ] A troca de telefone não apaga chats do app.
- [ ] Retry de criação e turno conserva o mesmo UUID e consegue recuperar checkpoint antes de reexecutar.
- [ ] `messages_queue.wa_message_id` permanece específico da Meta; somente a chave de execução foi generalizada.
- [ ] Os limites 10/12.000 e 5/8.000 existem numa função pura e não também escondidos em `prompts.py`.
- [ ] Não há placeholder, pseudocódigo deixado no produto, segredo, nova dependência nativa ou mudança de cobrança.
- [ ] Produção, deploy e source push continuam fora do escopo.
