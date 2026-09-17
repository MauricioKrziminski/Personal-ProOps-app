# Hoje e Financeiro — "Conversa organizada" (17/09/2026)

Aprovado pelo dono do produto em 17/09/2026 ("pode seguir"), a partir do pedido:

> *"refatore a tela hoje. Ela é a tela inicial de quando abre o app, um usuário novo que abre o
> app pela primeira vez, o design da tela hoje é essencial para passar uma boa impressão… os
> cards maiores e menores que estão muito simples… seria bom padronizar em todas as outras telas
> iniciais… Faça o mesmo para a tela financeiro também… Deixe apenas o cartão como está… pode
> melhorar o texto 'cartões' em cima e o 'ver todos', reposicionar os componentes também com um
> novo layout… só a animação ao clicar e dentro de cartões que você mantém… quero algo bem
> diferente do que existe hoje por aí… código robusto, nada de correções superficiais."*

## Decisões tomadas com o dono do produto

| pergunta | resposta |
|---|---|
| mundo visual | **Suave continua e é enriquecido** — papel morno, tinta, Plus Jakarta Sans; muda composição, cards, profundidade, gráficos e movimento |
| primeira abertura | **Primeiros passos** — card com progresso ligado a dado real, some quando tudo está feito |
| as três regras (um destaque por tela; sem degradê/brilho em conteúdo; vidro só na chrome) | **liberadas nestas telas** — decide o resultado visual |
| estrutura (sorteio impeccable, semente `47d141a7`, escopo de superfície, modo Operate) | **Conversa organizada**, sobre "Régua da semana" e "Briefing em manchete" |
| o balão | **texto REAL** que o usuário mandou — leitura nova no banco (staging) e o agente passa a gravar a origem |

Bibliotecas novas: **nenhuma**. Skia 2.6, Reanimated 4.5 e Gesture Handler 2.32 cobrem tudo
abaixo; um kit de UI pronto brigaria com os tokens e com o `Icon`, que é caminho único.

## Contrato de direção

- **THESIS** — a Hoje lê como um diálogo com duas vozes: o app fala à esquerda (o que está livre,
  o que venceu, o que vem), a pessoa fala à direita (o texto real que ela mandou) e embaixo de
  cada fala encaixa o registro que ela virou. Recusa o painel de fintech de sempre: número
  grande + fileira de atalhos + lista cinza.
- **OWN-WORLD** — papel `#F2F1EE`, superfície branca, tinta `#0B0B0C`; balão de tinta com canto
  18 e cauda à direita; cards do app com a marca num selo de 20; herói em "tinta viva" (grão fino
  + luz que acompanha a rolagem); trilhos verticais de 2dp; anéis e rosca em escala tonal de
  tinta; semântica só em verde/tijolo/âmbar.
- **STORY** — a pessoa abre o app, vê quanto está livre até o próximo dinheiro, o que exige ação
  hoje, e reconhece as próprias palavras organizadas; entende que pode simplesmente falar.
- **FIRST VIEWPORT** — data pequena e "Bom dia, Gabriel"; o herói de tinta com o número livre e
  a Pista arrastável; os contadores; (usuário novo: Primeiros passos); a pílula "Diga ao
  agente…". A ação primária da tela é falar com o agente.
- **FORM** — Conversa organizada, 5ª da lista ordenada por ressonância (1 Régua da semana,
  2 Bento, 3 Briefing em manchete, 4 Instrumentos, 5 Conversa organizada, 6 Livro-caixa,
  7 Baralho), semente `47d141a7`.
- **FINISH** — unreviewed and undocumented is unfinished; this build ends with the finish
  review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## Regra 0 — nenhuma função perde acesso

Posição, agrupamento e pele mudam; destino e ação não somem. Cada fase fecha conferindo esta
tabela no aparelho.

### Hoje

| hoje | depois |
|---|---|
| saudação "Bom dia, Nome" (some sem nome) | cabeçalho do dia: data curta + saudação (mesma regra do nome) |
| herói "Livre até": número, veredito, barra "já comprometi", "entra DD/MM", rodapé "Compromissos até" | herói com tinta viva: número, veredito, **Pista** (substitui a barra; mostra "entra DD/MM" no fim do trilho), rodapé igual |
| menu do herói: Ver o que fecha o ciclo, Projeção, Patrimônio, Metas | igual (mesmo `showItemActions`, mesmos destinos e parâmetros) |
| olho de esconder saldo | igual |
| contadores Vencendo → Lançamentos, Lembretes → /reminders, No limite → /finance/budgets (só se algum > 0) | faixa de contadores, mesmos destinos, mesma regra |
| Atrasado: abrir lançamento; Pagar fatura / Ver dívida / Paguei | bloco **Agora**, mesmas ações |
| O que vence (7 dias): abrir; Pagar fatura / Ver dívida / Paguei | bloco **Próximos dias** (dias seguintes) — mesmas ações; o que vence HOJE sobe para **Agora** |
| O que entra: abrir; Recebi | **Próximos dias** (entrada em verde), mesma ação; receita atrasada ("não caiu") fica em **Agora** |
| Vai cair no cartão: abrir; Ver fatura | **Próximos dias**, com a minifase do cartão; mesmas ações |
| Lembretes de hoje: abrir o lembrete | **Lembretes** em linha do tempo, mesmo destino; ação "Todos" → /reminders |
| Passando do limite: barra por categoria | **No limite**: anéis; toque → /finance/budgets |
| Capturado no WhatsApp: último lançamento via WhatsApp + Editar | **Conversa**: pares balão→card (inclui WhatsApp e app); toque no card → registro; Editar continua no detalhe |
| estado vazio "Nada para hoje" | Primeiros passos + "Diga ao agente…" + a linha "Nada vence hoje" |
| pull-to-refresh | igual, refazendo também as leituras novas |
| badge da aba | igual (não muda de régua) |

### Financeiro

| hoje | depois |
|---|---|
| seletor de mês (‹ ›, toque no título abre o `MonthSheet`), Mês \| Ciclo, janela "11/09 – 10/10" | **Período** em uma linha, mesmas funções |
| herói: rótulo `describeCycle`, número, variação vs mês anterior, curva do ciclo, rodapé "Sobrou na conta", olho | herói com tinta viva e **gráfico arrastável**; mesmos dados |
| menu do herói (6 itens) | igual |
| O que entra / O que sai (→ ciclo filtrado, subtítulo "já caiu") | ladrilhos **Entra \| Sai**, mesmos destinos, "já caiu" como barra + número |
| Projeção "Saldo mês a mês" | ladrilho no mosaico |
| Gerenciar + Ver tudo; Lançamentos (com mês e régua), Contas, Cartões, Orçamentos, Dívidas (se existir) | **mosaico**: os mesmos seis destinos (Cartões fica no bloco Cartões) |
| Passando do limite | anéis, → /finance/budgets |
| Cartões + Ver todos; `CardStack` (voo, Carteira, "fecha ›") | cabeçalho novo; **pilha, voo e Carteira intocados** |
| Últimos lançamentos + Ver todos; linha: abrir, menu Ver detalhe / Editar / Apagar | lista nova (`LedgerRow`), mesmas ações; citação da mensagem quando existir |
| Tendência mensal: 6/12 meses, legenda, "Sobrou em <último>" | tendência com seleção de mês; rodapé segue o mês escolhido |
| Onde o dinheiro foi + Ver tudo; nota "por data da compra"; categoria → lançamentos filtrados | **Para onde foi**: rosca + lista; mesma nota em pílula; mesmos destinos |
| vazio "Ainda não tem movimento" | igual |
| FAB Lançar (3 opções) | igual, recolhe ao rolar para baixo |

## Hoje — anatomia

Ordem (de cima para baixo). Cada bloco só existe com conteúdo; cada bloco com consulta própria
mostra o próprio erro (§7 do design).

1. **Cabeçalho do dia** — `caption` com a data curta ("qui, 17 set", `lib/dates`), e a saudação em
   `title`. Sem nome, a saudação fica só com a data.
2. **Herói "Livre até DD/MM"** (`HeroPanel` com `surface="live"`) — número (`CountUpMoney`),
   veredito (a mesma regra de hoje: atrasado > vence hoje > por dia > nada vence), **Pista**,
   rodapé "Compromissos até DD/MM · R$ X" tocável. Menu "…" e olho.
3. **Contadores** — três ladrilhos compactos (`Tile size="compact"`), só se algum > 0.
4. **Primeiros passos** (`SetupChecklist`) — enquanto houver passo aberto e o usuário não tiver
   escondido neste aparelho.
5. **Diga ao agente…** (`AgentPrompt`) — toque → `/agent/new`.
6. **Agora** — voz do app: atrasado + vence hoje + receita que não caiu; trilho à esquerda
   (`DayRail`, nó tijolo para atraso).
7. **Conversa** — voz da pessoa: até 6 `ConversationPair`, do mais recente ao mais antigo, com o
   rótulo do dia quando não é hoje ("ontem", "ter, 15 set").
8. **Lembretes** — linha do tempo dos lembretes de hoje.
9. **Próximos dias** — voz do app: vence, entra e cai no cartão nos próximos 7 dias, agrupado por
   dia sob o trilho.
10. **No limite** — `RingGauge` numa fileira horizontal.
11. **Dia calmo** — sem Agora, sem Próximos dias e sem lembrete: uma linha
    "Nada vence hoje · entra dinheiro DD/MM" (ou "Nada vence nos próximos dias").

### A Pista

Um trilho horizontal de hoje até a próxima entrada (ou o fim do ciclo, sem entrada). O
preenchimento é o comprometido; cada saída é um entalhe na posição da sua data; na ponta, o
ponto verde "entra DD/MM". Arrastar o dedo mostra "DD/MM · livre R$ X" (saldo livre depois das
saídas até aquele dia), com `selectionAsync` ao cruzar um entalhe; soltar volta ao resumo.

⚠️ **A Pista lê a MESMA lista de eventos que produz o número grande.** O número é
`caixa − comprometido_ate_entrada`, e `comprometido_ate_entrada` é a soma de
`private.cash_events(ws, hoje, fim) where not realizado and day <= entrada`. A leitura nova
`spendable_path` devolve exatamente esses eventos (ver Dados). Invariante, com teste SQL e teste
puro: `caixa − Σ out_cents(path) = livre`. Se a identidade não fechar no cliente (cache de idades
diferentes), a Pista desenha só o preenchimento, sem entalhes nem arraste — nunca um valor que
contradiga o herói.

### Primeiros passos

| passo | feito quando | destino |
|---|---|---|
| Ligar o WhatsApp | `profiles.phone` preenchido | `/link-phone` |
| Cadastrar conta ou cartão | `accounts` com ≥ 1 linha | `/finance/accounts` |
| Primeiro lançamento | existe ≥ 1 transação | `/agent/new` |

Anel de progresso "N de 3". Passo feito ganha o check e o risco animados; com os três feitos o
card recolhe (layout transition) e não volta. "Agora não" (menu do card) esconde neste aparelho
(`useBoolPref`, chave por usuário) — conveniência local, nunca estado que precise sobreviver.

### Conversa

`ConversationPair` = `MessageBubble` (direita, tinta, texto real até quebrar; ≥ 5 linhas mostra
as 4 primeiras e "mais", que expande no lugar — é prévia de corpo, §7) + carimbo
"WhatsApp · 09:14" / "App · 09:14" + ícone `mic` quando a origem foi áudio + um ou mais
`RecordCard` (esquerda) ligados por um fio.

`RecordCard` por tipo: lançamento (ícone da categoria, título `description || merchant ||
category`, valor com sinal, meta "categoria · conta"), parcelada ("10× de R$ X"), recorrente,
lembrete (título + quando), nota (título/primeira linha), conta, meta, dívida; qualquer outro
tipo vira um card genérico com o verbo ("Orçamento salvo"). Ação alterou → pílula "alterado";
registro que não existe mais → card apagado com "apagado". Toque → o destino do registro.

Balão do canal app → `/agent/[session]`.

## Financeiro — anatomia

1. **Período** — linha única: `‹` Outubro de 2026 `›` (toque no título abre o `MonthSheet`),
   `MonthRuler` à direita; embaixo, a janela em `code`. Sem card.
2. **Herói** (`HeroPanel surface="live"`) — `describeCycle`, número, chip de variação, **gráfico
   do ciclo arrastável** (`ScrubChart` no lugar do `Sparkline`; só no ciclo corrente), rodapé,
   menu, olho.
3. **Entra \| Sai** — dois `Tile` lado a lado: seta, rótulo, valor (`Money`), barra fina do
   realizado com "já caiu R$ X" (sai de `describeRealizado`).
4. **Cartões** — `BlockHeader title="Cartões" count={n} action={{ label: 'Ver todos' }}`;
   `CardStack` sem mudança.
5. **Mosaico** — `TileGrid`: Lançamentos (largo), Projeção (minicurva da série já buscada),
   Contas (contagem), Orçamentos (contagem + anel do mais apertado), Dívidas (falta pagar; só se
   existir), Ver tudo.
6. **Passando do limite** — `RingGauge`.
7. **Últimos lançamentos** — `BlockHeader` + `LedgerRow` (selo de categoria, título, meta, valor
   e data à direita); com mensagem de origem, a citação embaixo em `footnote` com a marca do
   canal (dado de `agent_activity`, casado por `result_id`).
8. **Para onde foi** — `DonutChart` (6 fatias + "outras", escala tonal de tinta, total no
   centro); tocar numa fatia ou linha destaca as duas; lista com barra `data` e variação.
   Pílula "por data da compra" no cabeçalho.
9. **Tendência** — barras duplas como hoje; tocar/arrastar seleciona o mês (háptico), o rodapé
   mostra "Sobrou em <mês selecionado>"; seletor 6/12.
10. **FAB Lançar** — pílula que recolhe para círculo ao rolar para baixo e estende ao rolar para
    cima (`onScroll` do `Screen` num shared value).

## Kit de componentes

Primitivos novos em `src/components/ui/` (cartão/gráfico) e `src/components/feed/` (conversa).
Cada um com contrato de props tipado; o que é aritmética mora em `src/design/` ou `src/lib/` com
`node --test`.

| componente | arquivo | faz | depende |
|---|---|---|---|
| `BlockHeader` | `ui/block-header.tsx` | título (`title2`), contagem em pílula, ação em pílula com chevron, variante `voice="app"` com o selo da marca | `Mark`, tokens |
| `Tile`, `TileGrid` | `ui/tile.tsx` | ladrilho (tamanhos `compact`, `half`, `wide`), ícone, rótulo, valor, slot de minigráfico, press 0,96 + háptico; grade de 2 colunas com spans | `PressableScale` |
| `InkSurface` | `ui/ink-surface.tsx` | o fundo do herói: tinta + grão (`RuntimeEffect`) + luz radial cuja posição segue um `SharedValue` de rolagem | `SkiaCanvas` |
| `HeroPanel` | `ui/hero-panel.tsx` | ganha `surface?: 'flat' \| 'live'` e passa a ler a rolagem do `Screen` | `InkSurface` |
| `ScrubChart` | `ui/scrub-chart.tsx` | linha + área, zero, marca de hoje, arraste com rótulo e háptico por marcador; acessível como `adjustable` | `scrub-math`, Skia, RNGH |
| `RunwayBar` | `ui/runway-bar.tsx` | a Pista | `runway` |
| `RingGauge` | `ui/ring-gauge.tsx` | anel com rótulo central; nasce no valor real, anima na mudança | Skia |
| `DonutChart` | `ui/donut-chart.tsx` | rosca tonal com seleção | `donut-math`, Skia |
| `DayRail` | `ui/day-rail.tsx` | trilho vertical com nó por grupo (neutro, tijolo, verde) | tokens |
| `LedgerRow` | `ui/ledger-row.tsx` | linha de lançamento das raízes | `Money`, `Icon` |
| `MessageBubble` | `feed/message-bubble.tsx` | o balão (texto, canal, hora, áudio, "mais") | tokens |
| `RecordCard` | `feed/record-card.tsx` | o registro que a fala virou, por tipo | `activity-feed` |
| `ConversationPair` | `feed/conversation-pair.tsx` | balão + fio + cards; o encaixe | Reanimated, Skia |
| `SetupChecklist` | `feed/setup-checklist.tsx` | primeiros passos | `RingGauge`, `setup-steps` |
| `AgentPrompt` | `feed/agent-prompt.tsx` | pílula "Diga ao agente…" com exemplos alternando | Reanimated |

Aritmética pura (com teste):

- `src/lib/runway.ts` — eventos → entalhes (posição 0..1 por data), saldo livre por dia, a
  identidade com o herói.
- `src/design/scrub-math.ts` — x do dedo → índice, marcador mais próximo, posição do rótulo
  preso às bordas.
- `src/design/donut-math.ts` — fatias (ângulos, "outras" acima de 6), escala tonal.
- `src/lib/activity-feed.ts` — linhas do RPC → pares (agrupa por `source_message_id`, ordena,
  rótulo do dia, verbo por `action_type`, destino por tipo de registro).
- `src/lib/setup-steps.ts` — passos a partir do perfil, contas e existência de lançamento.

Hooks novos (`src/hooks/`): `useAgentActivity(limit)`, `useSpendablePath(view)`,
`useSetupProgress()` (compõe `useProfile`, `useAccounts`, `useRecentTransactions(1)`).

## Dados — o balão real e a Pista (staging)

Migration `supabase/migrations/20260918120000_a_conversa_que_virou_registro.sql`:

1. **`executed_actions` ganha dono e origem**: `user_id uuid references profiles(id) on delete
   cascade`, `workspace_id uuid references workspaces(id) on delete cascade`, `origin_text text`;
   índice `(user_id, executed_at desc) where user_id is not null`. A tabela continua sem policy
   (infra).
2. **Retropreenchimento** — canal app: `source_message_id = 'app:' || client_message_id` casa com
   `app_chat_messages` (role `user`) → `content`, e a sessão dá `user_id`/`workspace_id`. Canal
   WhatsApp: `source_message_id = messages_queue.wa_message_id` → `user_sessions` pelo
   `thread_id` (canal `whatsapp`) dá o dono; o texto é o de todas as mensagens de texto do mesmo
   `batch_id`, na ordem. Linha sem dono resolvido fica nula e não aparece.
3. **`public.agent_activity(p_limit int default 6)`** — `security definer`,
   `set search_path = public`, `set timezone to 'America/Sao_Paulo'` no cabeçalho; `revoke` de
   `public`, `anon`; `grant` a `authenticated`. Devolve as ações das `p_limit` falas mais recentes
   **do próprio chamador** (`user_id = auth.uid()`) e de workspaces dele
   (`workspace_id in (select private.my_workspace_ids())`):
   `source_message_id, executed_at, channel ('whatsapp'|'app'), input_kind
   ('text'|'audio'|'image'|'document'|'click'), origin_text, session_id (só app), action_index,
   action_type, result_id, record jsonb`. `record` é o registro ATUAL por `left join` em
   `transactions`, `installment_plans`, `recurring_transactions`, `reminders`, `notes`, `accounts`,
   `goals`, `debts` (todos filtrados pelo workspace); nulo quando não existe mais. `input_kind`
   sai de `messages_queue.message_type` do lote de `source_message_id`. **Nunca devolve
   `payload`** (carrega telefone).
4. **`private.spendable_events_for(ws_ids, p_view)`** — o `ev` de `spendable_for` extraído para
   uma função (`day, in_cents, out_cents, title, origin, ref_id`), e `spendable_for` recriado
   sobre ela com o MESMO cabeçalho (invoker, fuso). **`public.spendable_path(p_view)`** devolve os
   eventos `day <= entrada` (os que formam `comprometido_ate_entrada`), `security invoker` sobre
   `my_workspace_ids()` como as outras portas.
5. Teste `supabase/tests/agent_activity.sql`: isolamento entre dois usuários do mesmo workspace
   (um não vê o texto do outro), registro apagado → `record` nulo, lote com três mensagens → um
   texto, `anon` sem `execute`; e a identidade `caixa − Σ path = livre`.

Agente (`agent/`):

- `db.reserve_execution(source_message_id, action_index, action_type, *, user_id,
  workspace_id, origin_text)` grava os três na reserva; `registry` passa `ctx.user_id`,
  `ctx.workspace_id`, `ctx.texto`. `ctx.texto` já é a frase original nos três caminhos (turno
  comum; retomada do "sim" — o estado do checkpoint; rascunho completado — `raw_text`).
- pytest dos dublês atualizado; `ruff` e `pytest` verdes; **deploy no staging** (pedido ao dono
  antes de rodar).

App: `database.types.ts` regenerado; `useAgentActivity` invalida junto de `transactions`,
`reminders` e `notes` (que já têm tempo real — `executed_actions` não entra na publicação: sem
policy, o Realtime não entregaria nada).

Produção: **não**. Fica pendente junto com a `20260917120000`, decisão do dono.

## Movimento

| momento | movimento | regra |
|---|---|---|
| a tela fica visível | cascata do `Screen` (mantida) | `useRelogioDeEntrada` |
| fala nova chega com a tela aberta | balão entra (escala 0,92→1 + opacidade, mola `snap`); o fio se desenha (trim 0→1, 180 ms); o card sobe 8dp e assenta (mola `encaixe`); háptico leve | **só** para `source_message_id` que chegou depois da montagem — nunca no mount (lição do alfinete) |
| rolagem | a luz do herói desliza com o deslocamento; o FAB do Financeiro recolhe/estende | valor na UI thread; zero custo parado |
| arraste da Pista / gráfico / tendência | o rótulo segue o dedo; `selectionAsync` ao cruzar marcador; soltar volta com mola `settle` | gesto com `activeOffsetX` para não roubar o scroll vertical |
| valor muda | `CountUpMoney`; anéis e barras animam da posição anterior | nascem no valor real |
| passo concluído | check desenha, risco atravessa, card recolhe com `LinearTransition` | — |
| exemplos do `AgentPrompt` | troca a cada 3,5 s com cross-fade + subida de 6dp | para com o app em segundo plano e fora de vista |

**Reduzir Movimento**: sem trajeto nem luz; entradas viram cross-fade; o encaixe vira
aparecimento simples; os exemplos param no primeiro.

**Desempenho**: desenho de Skia e gestos na UI thread; `SkiaCanvas` só onde há desenho; linhas e
pares memoizados; `useMemo` em toda série passada para gráfico (a lição do `Sparkline`); a
tinta viva usa um shader com uniformes, sem recriar a imagem.

## Regras que mudam (`.claude/rules/design.md`, com data e a fala)

- **Um destaque por tela** → na Hoje convivem o herói e os Primeiros passos.
- **Sem degradê/brilho em conteúdo** → o herói ganha a tinta viva.
- **Vidro só na chrome** → liberado e **não usado**: sobre papel chapado não há o que refratar
  (o motivo original continua verdadeiro).
- `anti-slop.test.ts` acompanha onde prende essas regras; o resto (hex, `fontSize`, truncagem,
  `useTelaPronta` só com consulta, `Money`/`useBRL`, `Screen` obrigatório) continua.

## Estados

- **Carregando**: esqueleto com a forma nova (cabeçalho, herói, dois ladrilhos, lista).
- **Erro**: cada bloco com `ErrorCard` e "Tentar de novo"; `simple-finance-ui.test.ts` continua
  exigindo isso no Financeiro com `cycle_range` falhando.
- **Vazio**: bloco some; a Hoje nunca fica em branco (ver "Dia calmo" e Primeiros passos).
- **Conteúdo longo**: 384dp × fonte 1,3; nada trunca exceto a prévia do balão (com "mais").
- **Vitrine** (`design-preview.tsx`): fixtures das chaves novas (`agent-activity`,
  `spendable-path`, passos).

## Fases

Cada fase: implementar → `tsc`, `lint`, `npm test` (e `ruff`/`pytest` quando tocar o agente) →
iOS e Android, claro e escuro, 384dp × 1,3 → commit. Sem tag, sem produção.

1. **Kit base + Hoje** — `BlockHeader`, `Tile`, `InkSurface`, `HeroPanel` vivo, `RunwayBar`,
   `RingGauge`, `DayRail`, `SetupChecklist`, `AgentPrompt`; a Hoje nova sem o bloco Conversa
   (a Pista começa só com o preenchimento até a fase 2 trazer `spendable_path`).
2. **Dados + Conversa** — migration no staging, types, agente + deploy no staging,
   `useAgentActivity`, `useSpendablePath`, `MessageBubble`/`RecordCard`/`ConversationPair`,
   entalhes e arraste da Pista.
3. **Financeiro** — `ScrubChart`, `DonutChart`, `LedgerRow`, mosaico, período, tendência com
   seleção, FAB que recolhe, citação nos lançamentos.
4. **Notas, Agente e Perfil adotam o kit** — `BlockHeader` no lugar de `SectionHead` nas raízes,
   `Tile` onde houver atalho; sem mudar comportamento.
5. **Fechamento** — `design.md`, `DESIGN.md` (documentador), `CLAUDE.md` (estado das
   migrations), "como ficou" nesta spec, revisão final.

## Riscos

- **Deploy do agente** é pré-requisito para a Conversa ter dado novo; o retropreenchimento cobre
  o histórico que já existe.
- **Shader no Android** (Skia `RuntimeEffect`): medir quadros no emulador; sem desempenho, o
  herói cai para tinta chapada com grão estático.
- **Gestos horizontais dentro do scroll vertical**: `activeOffsetX` + `failOffsetY` no arraste,
  conferido nos dois sistemas.
- **Muitas leituras na Hoje**: o portão `useTelaPronta` recebe as novas consultas; a Hoje não
  pode abrir por partes.

## Fora de escopo

Regra de negócio, cálculo de caixa (além de expor a lista que já existe), `CardStack`, voo,
Carteira, fatura, telas empurradas, tab bars, marca, ícone do app, produção.
