@AGENTS.md

# Personal ProOps app

> **Nomenclatura:** este repositório **não é "o ProOps"**. ProOps é o produto/marca maior; este é um **aplicativo pessoal que faz parte do produto ProOps**. Enquanto não houver nome definitivo, usar o nome genérico **"Personal ProOps app"** (em código, docs e UI).

App mobile pessoal de **notas rápidas, lembretes e controle financeiro operado via WhatsApp**. O usuário manda mensagens em linguagem natural ("gastei 45 no mercado", "recebi 500 de freela", "me lembra de pagar aluguel todo dia 5", "quanto gastei esse mês?") e a IA cria/consulta **notas, lembretes e o financeiro completo** (transações, contas, metas, orçamentos), que aparecem organizados no app em tempo real. Lembretes são disparados de volta (push e/ou WhatsApp).

## Decisões imutáveis (não trocar sem o usuário pedir)

- **Backend:** **Python 3.12 + FastAPI**, portável via Docker, hospedado no **Google Cloud Run**
  com `min_instances = 0`. Código em `agent/`.
- **Inteligência conversacional:** **LangGraph** (`StateGraph` em Python) com modelos **Gemini**,
  saída estruturada e caching. **Não usar Claude API.**
- **Banco e fila:** **Supabase Postgres** (camada gratuita) — `messages_queue` com controle de
  concorrência. O Supabase é banco e fila; deixou de ser onde a lógica roda.
- **Observabilidade:** **Langfuse**, integrado por middleware/tracing do LangGraph.
- **WhatsApp:** Meta Cloud API **oficial** (nunca Baileys/não-oficial).
- **Áudio (STT):** **Groq** (Whisper).
- **Auth:** Supabase Auth **Phone OTP** (o telefone é a chave de vínculo com o WhatsApp).
- **Dinheiro:** sempre `amount_cents` inteiro (nunca float).
- **Custo:** respostas na janela 24h do WhatsApp são grátis; proativo prefere push (Expo) e usa
  template Utility só como complemento. Deixou de ser ~zero: Cloud Run, Cloud Tasks e Langfuse
  entram na conta, e o cron de lembretes de 1 minuto acorda o container 1.440×/dia (o que, de
  quebra, mantém o webhook quente apesar do `min_instances = 0` — decida os dois juntos).

> **Esta seção mudou em 30/08/2026.** Até então ela dizia "Backend: Supabase Edge Functions" e
> "sem serviços externos", e as Edge Functions em `supabase/functions/` eram onde tudo rodava.
> Elas são **legado em desmonte** — ver *Corte em produção* abaixo. Se algum arquivo ainda
> afirmar o contrário, ele está desatualizado, não a arquitetura.

## Stack

| Camada | Escolha |
|---|---|
| App | Expo SDK 57 (managed) + expo-router + TypeScript, código em `src/` |
| Glass/Design | expo-glass-effect + expo-blur (fallback), NativeTabs (tab bar liquid glass) |
| Animações | react-native-reanimated v4, moti, expo-haptics |
| Estado | TanStack Query (servidor) + useState local |
| Forms | react-hook-form + zod |
| Gráficos | barras custom com Views (consistentes com o design glass) |
| Backend | Python 3.12 + FastAPI em `agent/` — Docker, Cloud Run, Cloud Tasks |
| Agente | LangGraph `StateGraph` + checkpointer Postgres (schema `langgraph`) |
| Banco | Supabase Postgres — migrations em `supabase/migrations/` |
| Observabilidade | Langfuse (tracing do grafo) + tabela `ai_events` |
| Auth | Supabase Auth **Phone OTP** (o telefone é a chave de vínculo com o WhatsApp) |
| Legado | Edge Functions (Deno) em `supabase/functions/` — em desmonte |

## Arquitetura (resumo)

```
WhatsApp → Meta → POST /whatsapp-inbound (valida HMAC, grava em messages_queue,
agenda debounce no Cloud Tasks, responde 200 em <50ms)
                     ↓ +3s
        POST /worker/process-thread (lock por conversa, claim do LOTE,
        Groq p/ áudio → LangGraph: router → domínio → gate (HITL) → tools
        determinísticas → UMA resposta no WhatsApp) → Realtime atualiza o app.
Cloud Scheduler: /cron/reminders (1 min, leva junto o sweep da fila),
/cron/finance-scheduler (1 h), /cron/alerts (diário).
```

- O debounce **nunca dorme em memória**: quem espera os 3 segundos é o Cloud Tasks, para o
  container poder ser desligado (`min_instances = 0`).
- **RLS deny-by-default em todas as tabelas** continua valendo para o APP (anon key + JWT).
  ⚠️ O serviço Python conecta com papel que **ignora RLS** — toda proteção de escopo virou código
  (`ensure_owned`, filtro obrigatório por `workspace_id`).
- Segredos no **GCP Secret Manager** (`agent/.env.example` documenta) — nunca no app ou no repo.
- Idempotência de **entrada** por `wa_message_id` único; de **execução** por
  `executed_actions (wa_message_id, action_index)`, reservada ANTES de executar.

## Corte em produção (Strangler Fig)

A Edge Function `whatsapp-webhook` sobrevive como **roteador fino**: lê
`agent_routing.use_python_agent` pelo telefone e repassa o corpo cru para o Cloud Run quando for
`true`. Rollback é um `update` numa linha.

Se o repasse não voltar 2xx, o roteador devolve **não-200** para a Meta reentregar. Cair no fluxo
Deno antigo como fallback seria pior: uma conversa esperando "SIM" no Python teria a resposta
processada pelo fluxo velho, que não sabe que uma pergunta foi feita, e o "sim" viraria uma nota.
`supabase/functions/` só é deletado quando todos os números estiverem migrados.

## Regras detalhadas (obrigatórias)

@.claude/rules/design.md
@.claude/rules/frontend.md
@.claude/rules/agent.md
@.claude/rules/supabase.md
@.claude/rules/ai-gemini.md
@.claude/rules/whatsapp.md
@.claude/rules/finance.md
@.claude/rules/workflow.md

## Plano de desenvolvimento vigente

Migração para o agente Python/LangGraph (fases 0 a 5, com auditoria do código antigo e
especificação do grafo) em `~/.claude/plans/voc-um-engenheiro-glittery-pike.md`.
