# Hoje — `src/app/(tabs)/today/index.tsx`

Aba 1. Substitui a antiga aba "Notas" nesta rota e absorve a antiga aba "Lembretes".

## Estrutura de rota

`NativeTabs` **não tem header** — a doc do Expo manda aninhar um `<Stack>` dentro de cada aba para
ter large title. Então toda aba vira diretório com `_layout.tsx` próprio:

```
(tabs)/today/_layout.tsx    → <Stack>
(tabs)/today/index.tsx      → /today
src/app/index.tsx           → <Redirect href="/today" />
```

O redirect na raiz é o que mantém o deep link para `/` funcionando depois que `(tabs)/index.tsx`
deixa de existir. Três linhas, e nenhuma rota órfã.

> **Verificado no simulador**, não deduzido: removendo `(tabs)/index.tsx` sem pôr nada no lugar, o
> app abre em **"Unmatched Route — appproops:///"**. O redirect não é higiene, é requisito.

## Pergunta que responde

> "O que eu preciso saber agora?"

Uma tela, três segundos, e o usuário sabe se pode relaxar ou se tem algo para resolver hoje.

## Persona

- **Primária: Jorge, 46** — medo de fatura. Abre o app perto do vencimento para saber o que vence
  e quanto. Se ele não vir isso no primeiro terço da tela, o app falhou com ele.
- **Secundária: Rafa, 29** — autônomo, renda irregular. A pergunta dele é "posso gastar?", e a
  resposta é o card de destaque no topo.
- **Terciária: qualquer um** — confere se o que mandou no WhatsApp entrou certo.

## Entrada e saída

- **Entrada:** aba (cold start cai aqui), toque em notificação push de lembrete ou alerta.
- **Saída:**
  - card de destaque → `push /finance/forecast`
  - conta/fatura → `push /finance/invoice/[id]` ou detalhe da transação
  - lembrete → `modal /reminder-form?id=`
  - orçamento → `push /finance/budgets`
  - linha da IA → `push /ai-activity` (a tela sai de `finance/` para o Stack raiz: ela registra
    nota, lembrete e meta, não só dinheiro, e é alcançada de três abas — ver `atividade-ia.md`)
- **Back:** é aba raiz. Android back sai do app. Re-tap na aba volta ao topo do scroll.

## Anatomia

Ordem vertical, e o porquê de cada posição:

1. **Header nativo** — large title "Hoje" com colapso no scroll. Ações por `HeaderActions`:
   busca global (`magnifyingglass` → `/search`, ver `busca-global.md`) e nova nota
   (`square.and.pencil`, o MESMO ícone da aba Notas — mesma intenção, mesmo ícone). Dois botões é
   o teto: o terceiro vira menu. *Era `plus.circle.fill` ao lado do `magnifyingglass` — preenchido
   contra contorno no mesmo header, o que `design.md` §4 proíbe.*
2. **Card de destaque (o único `GlassCard` da tela) — "Sobra até dia 31"**
   Valor grande em `Fonts.rounded` com `tabular-nums`, linha secundária com entradas e saídas
   previstas, e uma `Sparkline` da projeção. É o card porque é a pergunta que mais gente tem, e
   porque é o único número que muda o comportamento de quem lê.

   > O `GlassCard` leva **hairline** (`theme.separator`). Vidro mostra o que está atrás; sobre o
   > `groupedBackground`, que é cor chapada, não há o que refratar e o card sumia por completo no
   > tema claro — o número de destaque ficava boiando no fundo da tela.

   > A `Sparkline` tira o domínio vertical **dos dados**, não de zero. Com zero forçado dentro do
   > domínio, uma série de R$ 2.500–2.800 desenhava em 6px de 56 e lia como divisor. Zero volta
   > sozinho quando a série fica negativa — que é quando ele informa algo. Área preenchida por
   > baixo: uma linha de 2px na largura de um card lê como régua.
   Fonte: `cash_flow_forecast(days até o fim do mês)`.
3. **"Vence hoje" / "Atrasado"** — `Section` de `Row`s. Atrasado vem primeiro, em `danger`.
   Cada linha: ícone (fatura vs conta), título, valor com `tabular-nums`, e ação **"Paguei"**
   direto na linha (swipe ou botão trailing), no `Button` **primário** — é a ação mais importante
   da tela e em cinza não parecia ação. Fonte: `upcoming_bills(7)`.
   *Vem em segundo porque é a única coisa da tela com consequência se ignorada.*
4. **"Lembretes de hoje"** — `Row`s com hora, título e recorrência resumida. Ações: concluir,
   adiar (`snooze`), editar. Fonte: `reminders` com `next_run_at` dentro do dia local do usuário
   (via `localISODate`, nunca `toISOString().slice(0,10)`).
5. **"Passando do orçamento"** — só aparece com item ≥ 80%. Barra + categoria + quanto falta.
   Fonte: `budgets_status()`.
6. **"A IA registrou"** — últimos itens vindos do WhatsApp, com o que foi entendido e **desfazer**
   em um toque. Fonte: `ai_events`. *Vem por último porque é confirmação, não decisão.*

**Seção sem dado não aparece.** Em dia tranquilo a tela é curta e diz isso — nunca empurra cinco
cabeçalhos vazios para parecer cheia.

## Dados

| Bloco | Hook | queryKey | Fonte | Realtime |
|---|---|---|---|---|
| Sobra | `useCashFlowForecast(dias)` | `['forecast', dias]` | RPC `cash_flow_forecast` | `transactions` |
| Vence | `useUpcomingBills(7)` | `['upcoming-bills', 7]` | RPC `upcoming_bills` | `transactions`, `card_invoices` |
| Lembretes | `useTodayReminders()` **(novo)** | `['reminders','today', dia]` | tabela `reminders` | `reminders` |
| Orçamento | `useBudgetsStatus()` | `['budgets-status', mês]` | RPC `budgets_status` | `transactions`, `budgets` |
| IA | `useAiEvents(5)` | `['ai-events', 5]` | tabela `ai_events` | — (refetch no focus; `ai_events` **não está** na publicação realtime) |

Cada bloco tem **seu próprio** loading/error. Falha em `upcoming_bills` não pode derrubar a tela
nem sumir em silêncio — hoje `(tabs)/finance.tsx:138` faz exatamente isso.

Pull-to-refresh na raiz refaz as cinco.

## Ação primária

**Marcar uma conta como paga.** É a única ação com consequência real disponível aqui, e precisa
caber num toque, sem abrir tela. Confirmação otimista + toast com desfazer.

## Ações secundárias

- Captura rápida no `headerRight` → compositor de nota (`formSheet`).
- Lembrete: concluir · adiar 1h / amanhã · editar — **context menu nativo** (`Link.Menu`).
- Item da IA: desfazer · ver detalhe.
- Toque no card de destaque → projeção completa.

## Estados

- **Loading** — `Skeleton` com a forma final: um bloco alto (card de destaque) + três linhas.
  Nunca spinner de tela cheia. Blocos resolvem independentes: o que chegou já aparece.
- **Empty absoluto** (usuário novo, nada em lugar nenhum) — `EmptyState` com ícone
  `sparkles`, título "Tudo começa no WhatsApp" e a dica acionável: *"Manda `gastei 45 no mercado`
  ou `me lembra de pagar aluguel dia 5`"*. É o onboarding real do produto.
- **Empty tranquilo** (tem dado, mas nada vence hoje) — mensagem curta e positiva: "Nada vence
  hoje." Sem seções vazias abaixo.
- **Error** — por bloco, inline, com "Tentar de novo". A tela nunca vira uma página de erro
  inteira por causa de uma query.
- **Conteúdo longo** — título de conta/lembrete trunca em uma linha; valor nunca trunca.

## Movimento

| O que | Propósito | Valor |
|---|---|---|
| Valor do card de destaque | mudança de estado | conta de/para em `Motion.base`, `tabular-nums` evita salto de largura |
| Sparkline | mudança de estado | path anima em `Motion.slow` |
| Barra de orçamento | mudança de estado | `scaleX` com `transformOrigin: left` em `Motion.slow`; nunca `width` (dispara layout fora do worklet) |
| Linha "Paguei" | feedback | some com `LinearTransition`, `Motion.fast`; haptic `notificationAsync(Success)` |
| Entrada dos blocos | continuidade | `FadeInDown` com stagger de 60 ms, cap 400 ms |
| Press em `Row` | feedback | highlight de fundo (não scale), 120 ms |
| Barra de orçamento | mudança de estado | `withSpring(Motion.spring.settle)` |

Transição de aba é a nativa. Nada desliza entre abas.

## Acessibilidade

- Toda `Row` tem `accessibilityRole="button"` e label que inclui o valor ("Aluguel, mil e
  oitocentos reais, vence hoje").
- Botão "Paguei" com `accessibilityLabel` explícito — ícone sozinho não basta.
- Alvos ≥ 44pt inclusive na ação de linha.
- Valores com `selectable` — é comum querer copiar.
- Dynamic Type XL: o card de destaque quebra em duas linhas em vez de truncar o valor.
- Cor nunca é o único sinal de "atrasado": vem com ícone e a palavra.

## Fora de escopo

- Widget de home screen (iOS/Android) — fase futura.
- Reordenar ou esconder blocos por preferência do usuário — só se pedirem; hoje a ordem é opinião
  do produto e é isso que faz a tela responder rápido.
- Gráfico completo de fluxo de caixa: mora em `/finance/forecast`, aqui é só a sparkline.
- Criar transação por aqui — a captura rápida desta tela é **nota**; dinheiro entra pelo WhatsApp
  ou pelo FAB do Financeiro.
