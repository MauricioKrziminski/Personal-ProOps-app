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

  ⚠️ **São DOIS projetos, e os nomes se parecem. O que vale é o ref:**

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

  **Produção e staging ALINHADOS em `20260920130000`** — aplicadas em produção pelo Gabriel em
  21/09/2026 e conferidas na fonte (`schema_migrations` devolve `20260920130000`,
  `20260920120000`, `20260918220000`; as duas RPCs existem em uma versão cada, com `execute` para
  `authenticated` e sem para `anon`). Agente de produção `agente-00074` e app `v1.3.42` subiram
  depois. O parágrafo abaixo é o histórico da subida: (Histórico) as pendentes eram
  `20260920120000` e `20260920130000` (parcelar um lançamento que já existe, e desparcelar —
  `convert_transaction_to_installments` e a nova `update_installment_plan` que aceita
  `p_installments = 1`). As duas sobem juntas, e sobem ANTES do build/OTA que leva os dois botões
  novos ("Parcelar" na linha e "À vista" no editor da compra) para o telefone do usuário: sem
  elas em produção, `convert_transaction_to_installments` não existe
  (`supabase.rpc` volta `PGRST202` e o toast cai em "Não deu para parcelar") e o chip "À vista"
  bate na `update_installment_plan` antiga, cujo piso ainda é 2. **Nada corrompe; os dois botões
  simplesmente não funcionam.** O mesmo vale para o AGENTE: parcelar um lançamento e desparcelar
  ("desparcela a compra da tv" → `update_installment_plan` com 1 parcela) dependem das duas —
  sem elas a chamada falha (função ausente, ou o piso 2 da `update_installment_plan` antiga) e nada muda.

  **Produção e staging ALINHADOS em `20260921120000`** — aplicada em produção pelo Gabriel em
  21/09/2026 ("E se…" adiantando parcelas: `draft_ocorrencias` com `mode = 'cancel'` e
  `anticipation_candidates`) e conferida na fonte (`schema_migrations` devolve `20260921120000`,
  `20260920130000`, `20260920120000`; as duas funções com fuso no cabeçalho, `execute` para
  `authenticated` e sem para `anon`). Agente `agente-00078-k5f` (produção) e
  `agente-staging-00146-7nr` subiram no mesmo dia; app `v1.3.43`.

  **Produção e staging ALINHADOS em `20260922130000`** — aplicada em produção pelo Gabriel em
  22/09/2026 (`goal_deposit` recusa retirar mais que o guardado; conferida na fonte: uma versão,
  `search_path=public`, `execute` para `authenticated`), junto com a `20260922120000`, aplicada em
  22/09/2026 ("E se… adiantar": conta fixa listada até o teto da Projeção, 10 anos) e conferida
  na fonte (`schema_migrations` devolve `20260922120000`, `20260921120000`, `20260920130000`;
  `anticipation_candidates` em uma versão, fuso no cabeçalho, `execute` para `authenticated` e
  sem para `anon`). App `v1.3.46`.

  **Staging UMA à frente: `20260922140000`** (22/09/2026, aplicada só no staging). Parcelar no
  cartão um lançamento que já existe gravava a parcela 1 `cleared` (o default da compra à vista),
  e `parcela_travada` a lia como paga: a compra inteira travava (sem 1x, data, conta) com a
  fatura aberta — a queixa da wardogs. A migration grava `pending` na adoção em cartão e conserta
  as parcelas 1 que já nasceram assim (backfill idempotente, só fatura aberta). Mesma assinatura
  de RPC: não exige deploy de agente nem de app. Subir é decisão do Gabriel.

  ⚠️ **OTA/build do chat exige a revisão nova do agente em produção** (21/09/2026): o app novo
  manda `id` no `POST /internal/chat/conversations` para abrir a conversa na hora, e o agente
  antigo (`extra='forbid'`) recusa com 422 — TODA primeira mensagem falha. Sem migration: é só
  a ordem dos deploys (agente antes do app).

  ⚠️ **O AGENTE também depende das duas, desde 21/09/2026** (Task 4 do plano "agente sem
  engessar": `finance._parcelar`, `agent/app/tools/finance.py:1085`, chama a MESMA
  `convert_transaction_to_installments`). A ordem de deploy em produção é
  **migrations → agente → app**: subir o agente novo em produção antes das duas migrations faz
  "parcela isso em 2x" (sobre um lançamento avulso) devolver o mesmo P0001/erro de função
  inexistente do app — RPC chamada direto pelo agente, sem o toast do app para amortecer.

  **Este parágrafo é sobre a PENDÊNCIA em si; não altere os números de versão de staging/produção
  aqui em cima ao mexer nesta seção** — quem atualiza `20260920130000`/`20260918220000` é quem de
  fato aplicou a migration, com a fonte conferida (ver a régua desta seção).

  (Histórico) **Produção e staging estiveram ALINHADOS em `20260918220000`** — conferido na fonte
  em 19/09/2026 (`schema_migrations` de produção devolve `20260918220000`, `20260918120000`,
  `20260917120000`, e `executed_actions` já tem `user_id`/`workspace_id`/`origin_text`). Os
  parágrafos abaixo são o histórico da subida.

  Produção estava em **`20260915230000`** (o quarto slot de rascunho cabe no CHECK), aplicada em
  15/09/2026 pelo Gabriel junto da `20260915210000` (reparcelar a compra: `update_installment_plan`
  e `private.parcela_travada`), depois da `20260915190000` (a parcela herda o nome do
  estabelecimento) e da `20260915120000` (a coluna `atrasada` de `cycle_lines`).

  (Histórico) **O staging esteve DUAS à frente: `20260917120000` e `20260918120000`.** A primeira (17/09/2026, `card_summary` e
  `_card_summary` ganham `invoice_open_cents` no fim — o que falta na fatura corrente, líquido do
  pagamento parcial). Conferida no staging depois de aplicar: a coluna é a última das duas
  assinaturas, `_card_summary` segue `security definer` e sem `execute` para `anon` e
  `authenticated`, e `card_summary` tem os mesmos grants das outras portas públicas. **Produção
  ainda não tem** — subir é decisão do Gabriel. O app novo lê a coluna em Cartões e, sem ela
  em produção, volta à conta antiga pelo total bruto (`outrasFaturas`) — que só erra quando a
  fatura corrente tem pagamento parcial. Nada quebra.

  A `20260918120000` (aplicada no staging em 17/09/2026) dá dono e frase de origem a
  `executed_actions`, abre `public.agent_activity` (a Conversa da Hoje, `security definer`, só as
  falas do próprio chamador, sem `payload`) e `public.spendable_path` (a Pista, a mesma lista que
  forma o "livre"). Conferida no staging depois de aplicar: `supabase/tests/agent_activity.sql`
  verde (isolamento entre duas pessoas do mesmo workspace, registro apagado, lote com áudio,
  `anon` sem execute), `da_para_gastar.sql` verde, e a soma da Pista igual ao comprometido na
  conta `dev@`. Produção sem ela: a Hoje mostra a Conversa com erro e a Pista sem entalhes — o
  resto funciona. ⚠️ **Ela sobe ANTES do deploy do agente que grava as colunas novas**
  (`agent/app/db.py`, `reserve_execution`): o agente novo contra um banco sem
  `user_id`/`workspace_id`/`origin_text` em `executed_actions` quebra TODA escrita.

  Todas conferidas na fonte DEPOIS de aplicar (`scripts/` não guarda isso; a conferência da leva
  de 15/09 está no histórico desta linha): a `atrasada` é a última coluna de `cycle_lines`,
  `_cycle_lines` segue revogada, o CHECK de `draft_actions.slot` lista os quatro valores,
  `update_installment_plan` e `parcela_travada` existem em UMA versão cada com
  `search_path=public`, `authenticated` mantém `execute` nas portas públicas e **`anon` não o
  tem** — e o `create or replace` das duas levas preservou o `TimeZone=America/Sao_Paulo` da casca
  de 7 argumentos de `create_installment_plan` (que nenhuma delas toca).

  Conferido na fonte depois da leva de 14/09: as 43 RPCs que o app chama existem e continuam com `execute`
  para `authenticated` (é o modo de falha do par `200000`/`220000`, abaixo), e
  `public._alerts_to_send()` ficou sem `execute` para `anon` e `authenticated` — era um vazamento
  de telefone e push token de todos os workspaces, alcançável com a anon key e sem login.

  ⚠️ **`--project-ref` na escrita, não `link` → `push` → `link`.** O hook lê a flag
  (`explicito`, em `supabase-target.sh`) e ela não mexe no `supabase/.temp/project-ref`. A
  corrente com `link` tem um furo: falhando no meio, ela deixa o CLI apontado para PRODUÇÃO, e aí
  `gen types`, `db diff` e `migration list` passam a ler prod em silêncio — o hook só barra
  escrita.

  ⚠️ **A `200000` e a `220000` são um PAR e sobem juntas.** A primeira cria
  `private.debt_paid_in_cycle` com `revoke`, e a segunda devolve o `execute`; só a primeira
  derruba a Hoje e a Projeção com `42501 permission denied`, porque `debt_schedule_for` é
  `security invoker` e a chamada aninhada usa o privilégio do `authenticated`.

  O caminho é `PROOPS_PROD_OK=1 npx supabase db push --project-ref kwriuifcwyvdrxtspjiz`, rodado
  pelo Gabriel, e antes dele um `migration list --project-ref` para VER quantas estão
  pendentes. **`--db-url` não serve**: o hook lê o projeto LINKADO e a
  flag passava por cima da trava em silêncio — buraco fechado no mesmo dia, com
  `scripts/supabase-target.test.sh` prendendo os sete casos.

  ⚠️ **A trava só abre com o Gabriel, e isso é o desenho, não um atrito a contornar.** O hook
  `PreToolUse` roda em processo próprio: `PROOPS_PROD_OK=1` exportado dentro da sessão do agente
  **não** chega nele. Um agente não consegue liberar a si mesmo — quem roda o comando é o dono do
  banco. Foi assim que as duas de 11/09/2026 subiram.

  ⚠️ **Este número envelhece calado, e envelhecer aqui é caro — nos DOIS sentidos.** Ele já ficou
  14 migrations atrasado, e em 09/09/2026 quase virou "não suba o OTA, produção está sem as
  RPCs". Em 11/09/2026 o erro foi o contrário: a linha dizia `20260909210000` com a produção em
  `20260911061000`, seis à frente — subestimar leva a reaplicar o que já está lá. Antes de
  decidir qualquer coisa com base nesta linha, confirme na fonte, no SQL Editor de produção:
  `select version from supabase_migrations.schema_migrations order by version desc limit 3;`
- **Observabilidade:** **Langfuse**, integrado por middleware/tracing do LangGraph.
- **WhatsApp:** Meta Cloud API **oficial** (nunca Baileys/não-oficial).
- **Áudio (STT):** **Groq** (Whisper).
- **Auth:** Supabase Auth com **e-mail e senha** como porta principal (confirmação de cadastro e
  recuperação de senha por **código de 6 dígitos** no e-mail, `verifyOtp`, nunca por link). O
  **Phone OTP continua** para quem já tinha conta por telefone (`/login-whatsapp`) e é o ÚNICO
  jeito de gravar `profiles.phone` — o telefone verificado é a chave de vínculo com o WhatsApp, e
  por isso ele **nunca** entra pelo cadastro sem verificação.

  > **Mudou em 03/09/2026** (era "Phone OTP" só, telefone obrigatório). Motivo: o produto passou
  > a valer sem WhatsApp — o agente vai morar dentro do app —, e obrigar um número que chega por
  > OTP no WhatsApp do dono era barreira de entrada para quem só queria o app. Migration `0051`.
  > Plano e travas em `docs/CONTA-E-AGENTE-NO-APP.md`.
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
  ⚠️ O serviço Python conecta com papel que **ignora RLS** — toda proteção de escopo virou código
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

Verificado em log no dia: a mensagem chegou com user-agent `facebookexternalua` vindo de
`2a03:2880:…` (faixa da Meta), e o OTP com `Go-http-client` (o GoTrue do Supabase). Nenhum dos
dois passa mais pelo Deno.

⚠️ **A ordem importava, e é a lição que fica: repontar → testar → apagar.** Apagar o CÓDIGO não
desliga a função PUBLICADA — ela serve até um `functions delete` explícito. Quem derruba o
WhatsApp é trocar a URL errado, não remover o arquivo. Por isso o repositório só deixou de ter o
diretório depois de as duas pontas externas estarem provadas.

⚠️ **Duas coisas quase foram apagadas junto e não podiam:** o app ainda chamava
`import-statement` (que lia o dono do dado do CORPO do POST — qualquer autenticado importava
para o workspace de outro), e três testes de paridade LIAM os arquivos Deno. O primeiro virou
rota no agente com o usuário saindo do JWT; os outros trocaram de alvo para os arquivos Python,
porque o que eles protegem nunca foi "o Deno está igual". `src/lib/anti-slop.test.ts` quebra o
build se o app voltar a chamar `functions.invoke`.

⚠️ **As sete funções PUBLICADAS foram desligadas em 09/09/2026** (`functions delete`, uma a uma):
`import-statement` primeiro, porque era a que lia o dono do dado do corpo do POST e continuava
respondendo em produção depois de o app já ter parado de chamá-la; `whatsapp-webhook` por último,
porque era o rollback. `supabase functions list --project-ref kwriuifcwyvdrxtspjiz` devolve `[]`.

**Não existe mais rollback de um comando.** Enquanto o roteador estava publicado, voltar para o
Deno era um `update` numa linha de `agent_routing`; agora é redeployar do histórico do git (o
código está até o commit `7e51e40`, e as URLs eram
`https://kwriuifcwyvdrxtspjiz.supabase.co/functions/v1/<nome>`). Isso foi decidido de propósito,
com o WhatsApp já rodando pelo Python e mensagem real chegando: manter uma cópia da regra de
negócio viva "por segurança" é como a segunda cópia volta a divergir.

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

**As próximas fases estão em [`docs/PROXIMAS-FASES.md`](docs/PROXIMAS-FASES.md)** (escrito em
14/09/2026): higiene, "já caiu" no Financeiro, fechamento de ciclo, conciliação pelo extrato,
bloqueio por senha/biometria, loaders uniformes e — por último — planos, limites e preço com custo
medido. Cada fase traz o *por quê*, os arquivos exatos, as armadilhas e como verificar. As travas
que valem para todas (produção nunca sem pedido, **não criar tags**, a trava das projeções) estão
no topo do documento.

Migração para o agente Python/LangGraph (fases 0 a 5, com auditoria do código antigo e
especificação do grafo) em `~/.claude/plans/voc-um-engenheiro-glittery-pike.md`.
