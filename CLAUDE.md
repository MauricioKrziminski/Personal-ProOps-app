@AGENTS.md

# ProOps

> **Nomenclatura:** o nome exibido do app é **"ProOps"** em desenvolvimento, staging e produção. Os IDs de bundle e os nomes dos projetos de infraestrutura continuam separados para não misturar ambientes.

App mobile pessoal de **notas rápidas, lembretes e controle financeiro operado via WhatsApp**. O usuário manda mensagens em linguagem natural ("gastei 45 no mercado", "recebi 500 de freela", "me lembra de pagar aluguel todo dia 5", "quanto gastei esse mês?") e a IA cria/consulta **notas, lembretes e o financeiro completo** (transações, contas, metas, orçamentos), que aparecem organizados no app em tempo real. Lembretes são disparados de volta (push e/ou WhatsApp).

## Decisões imutáveis (não trocar sem o usuário pedir)

- **Backend:** **Python 3.12 + FastAPI**, portável via Docker, hospedado no **Google Cloud Run**
  com `min_instances = 0`. Código em `agent/`.
- **Inteligência conversacional:** **LangGraph** (`StateGraph` em Python) com modelos **Gemini**,
  saída estruturada e caching. **Não usar Claude API.**
- **Banco e fila:** **Supabase Postgres** (camada gratuita) — `messages_queue` com controle de
  concorrência. O Supabase é banco e fila; deixou de ser onde a lógica roda.

  **São DOIS projetos, e os nomes se parecem. O que vale é o ref:**

  | ref | nome no dashboard | o que é |
  |---|---|---|
  | `kwriuifcwyvdrxtspjiz` | Personal ProOps app | **PRODUÇÃO** |
  | `utkqoiigimqzeenxkxdl` | Personal ProOps app - staging | staging — é o do `.env.local` |

  Todo trabalho do dia a dia acontece no **staging**. Escrever em produção (`db push`, `db reset`,
  `migration up`) é **pedido explícito do Gabriel**, nunca consequência de uma tarefa. O hook
  `PreToolUse` em `.claude/settings.json` chama `scripts/supabase-target.sh` e **bloqueia** esses
  comandos quando o alvo é produção; para liberar de propósito, `PROOPS_PROD_OK=1`.

  Isso já falhou **duas vezes** (03/09/2026): a `0049` e depois as `0050`/`0051` foram anunciadas
  como "aplicadas em produção" quando foram para o staging.

  **Qual migration está em qual banco se confere na fonte, nunca num número escrito aqui.** Um
  número neste arquivo já ficou 14 migrations atrás e, noutra vez, seis à frente — subestimar leva
  a reaplicar o que já está lá. No SQL Editor do projeto:
  `select version from supabase_migrations.schema_migrations order by version desc limit 3;`
  O registro de cada subida para produção mora em `docs/HISTORICO-DE-MIGRATIONS.md`.

  - **Escrita em produção é `--project-ref`, nunca `link` → `push` → `link`.** O hook lê a flag
    (`explicito`, em `supabase-target.sh`) e ela não mexe no `supabase/.temp/project-ref`; a
    corrente com `link`, falhando no meio, deixa o CLI apontado para produção, e `gen types`,
    `db diff` e `migration list` passam a ler prod em silêncio — o hook só barra escrita.
    `--db-url` também não serve: a flag passava por cima da trava
    (`scripts/supabase-target.test.sh` prende os casos).
  - **Quem roda é o Gabriel:** `PROOPS_PROD_OK=1 npx supabase db push --project-ref
    kwriuifcwyvdrxtspjiz`, depois de um `migration list --project-ref` para ver quantas estão
    pendentes. O hook `PreToolUse` roda em processo próprio, então `PROOPS_PROD_OK=1` exportado na
    sessão do agente não chega nele: um agente não libera a si mesmo, e isso é o desenho.
  - **Ordem de deploy em produção: migrations → agente → app.** O agente chama as RPCs direto, sem
    o toast do app para amortecer uma função ausente, e o app depende do contrato do agente (o
    agente antigo, com `extra='forbid'`, recusa campo novo com 422). Migrations que se completam
    (uma revoga um `execute`, a seguinte o devolve) sobem no mesmo push.
  - **Função nova em `public` leva o seu `revoke execute ... from public, anon`:** o PUBLIC do
    padrão global do Postgres reabre toda função nova, e `supabase/tests/anon_sem_execute.sql`
    acusa a que esquecer.
- **Observabilidade:** **Langfuse**, integrado por middleware/tracing do LangGraph.
- **WhatsApp:** Meta Cloud API **oficial** (nunca Baileys/não-oficial).
- **Áudio (STT):** **Groq** (Whisper).
- **Auth:** Supabase Auth com **e-mail e senha** como porta principal (confirmação de cadastro e
  recuperação de senha por **código de 6 dígitos** no e-mail, `verifyOtp`, nunca por link). O
  **Phone OTP continua** para quem já tinha conta por telefone (`/login-whatsapp`) e é o ÚNICO
  jeito de gravar `profiles.phone` — o telefone verificado é a chave de vínculo com o WhatsApp, e
  por isso ele **nunca** entra pelo cadastro sem verificação.

  O e-mail é a porta principal porque o produto vale sem WhatsApp (o agente também mora dentro do
  app), e exigir um número que só se confirma por OTP no WhatsApp era barreira para quem só
  queria o app. Plano e travas em `docs/CONTA-E-AGENTE-NO-APP.md`.
- **Dinheiro:** sempre `amount_cents` inteiro (nunca float).
- **Custo:** respostas na janela 24h do WhatsApp são grátis; proativo prefere push (Expo) e usa
  template Utility só como complemento. Deixou de ser ~zero: Cloud Run, Cloud Tasks e Langfuse
  entram na conta, e o cron de lembretes de 1 minuto acorda o container 1.440×/dia (o que, de
  quebra, mantém o webhook quente apesar do `min_instances = 0` — decida os dois juntos).

## Stack

| Camada | Escolha |
|---|---|
| App | Expo SDK 57 (managed) + expo-router + TypeScript, código em `src/` |
| Design | direção **Suave** (`.claude/rules/design.md`): Plus Jakarta Sans, monocromático, NativeTabs (Liquid Glass) no iOS e `PillTabBar` no Android; vidro só na chrome (expo-blur no `AppHeader`) |
| Animações | react-native-reanimated v4, react-native-gesture-handler, expo-haptics |
| Estado | TanStack Query (servidor) + useState local |
| Forms | react-hook-form + zod |
| Gráficos e movimento | Skia (curvas, cortina em onda, face do cartão, anel, rosca) e barras com Views |
| Kit das raízes | `BlockHeader`, `Tile`/`TileRow`/`TileGrid`, `RingGauge`, `ScrubChart`, `DonutChart`, `RunwayBar`, `LedgerRow` — a Hoje é uma **conversa organizada** (o app fala em bloco; a fala da pessoa vem em balão com o registro encaixado embaixo) |
| Backend | Python 3.12 + FastAPI em `agent/` — Docker, Cloud Run, Cloud Tasks |
| Agente | LangGraph `StateGraph` + checkpointer Postgres (schema `langgraph`) |
| Banco | Supabase Postgres — migrations em `supabase/migrations/` |
| Observabilidade | Langfuse (tracing do grafo) + tabela `ai_events` |
| Auth | Supabase Auth **e-mail + senha** (código por e-mail, sem link) · Phone OTP só para vincular o WhatsApp e para contas antigas |
| ~~Legado~~ | **Não há mais Edge Functions** — `supabase/functions/` foi apagado em 09/09/2026 |

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
  O serviço Python conecta com papel que **ignora RLS** — toda proteção de escopo virou código
  (`ensure_owned`, filtro obrigatório por `workspace_id`).
- Segredos no **GCP Secret Manager** (`agent/.env.example` documenta) — nunca no app ou no repo.
- Idempotência de **entrada** por `wa_message_id` único; de **execução** por
  `executed_actions (wa_message_id, action_index)`, reservada ANTES de executar.

## Corte em produção (Strangler Fig) — TERMINADO em 09/09/2026

**Não existe mais Edge Function.** `supabase/functions/` foi apagado, e o agente Python recebe
tudo diretamente:

| quem chama | onde bate |
|---|---|
| Meta (WhatsApp) | `POST /whatsapp-inbound` — Callback URL trocada no painel da Meta |
| Supabase Auth (Send SMS Hook) | `POST /hooks/otp` |
| RevenueCat | `POST /hooks/billing` |
| o app (importar extrato) | `POST /internal/import-statement` |
| Cloud Scheduler | `POST /cron/reminders`, `/cron/finance-scheduler`, `/cron/alerts` |

Não existe rollback de um comando: voltar ao Deno seria redeployar do histórico do git (o código
está até o commit `7e51e40`). Foi decidido de propósito — manter uma cópia da regra de negócio
viva "por segurança" é como a segunda cópia volta a divergir. Lógica nova vai em `agent/`, e o
app fala com o servidor por `agentFetch`, nunca `functions.invoke` (`supabase.md`).

## Regras detalhadas (obrigatórias)

`frontend.md`, `finance.md` e `workflow.md` carregam em toda sessão. As outras carregam quando um
arquivo da área é lido (`paths:` no topo de cada uma); numa tarefa da área, leia a regra antes de
planejar, mesmo sem ter aberto arquivo nenhum.

| regra | área |
|---|---|
| `.claude/rules/design.md` | `src/**`, `plugins/**`, `app.json` |
| `.claude/rules/agent.md`, `ai-gemini.md`, `whatsapp.md` | `agent/**` |
| `.claude/rules/supabase.md` | `supabase/**`, `scripts/supabase-target*` |

Não importe estas regras com `@` aqui: o import força a carga no início e anula o `paths:`.
E criar um arquivo novo na área sem ter lido nenhum NÃO carrega a regra (os dois testados em
26/09/2026) — por isso a leitura antes de planejar.

## Plano de desenvolvimento vigente

**As próximas fases estão em [`docs/PROXIMAS-FASES.md`](docs/PROXIMAS-FASES.md)** (escrito em
14/09/2026): higiene, "já caiu" no Financeiro, fechamento de ciclo, conciliação pelo extrato,
bloqueio por senha/biometria, loaders uniformes e — por último — planos, limites e preço com custo
medido. Cada fase traz o *por quê*, os arquivos exatos, as armadilhas e como verificar. As travas
que valem para todas (produção nunca sem pedido, **não criar tags**, a trava das projeções) estão
no topo do documento.
