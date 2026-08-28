# Assinar — `src/app/paywall.tsx` *(tela nova, `modal` no Stack raiz)*

Hoje **não existe** tela de compra, e o que parece uma é um comparativo inerte: `plan.tsx:159-184`
renderiza os três planos com preço escrito à mão em `PLANS` (`use-finance.ts:995`) e **tocar não
faz nada** — está no roteiro de teste como comportamento esperado (`TESTE-E2E.md` 9.9).
`react-native-purchases` não está instalado (não aparece no `package.json`).

Do outro lado, o backend está pronto e testado: `_apply_entitlement` (`0035`) é a porta única de
concessão, `billing-webhook` recebe a RevenueCat, `private.effective_plan` (`0034`) derruba plano
vencido sozinho, `billing_events` dá idempotência, e a `0033` tirou do app qualquer escrita em
`subscriptions`. **Falta a tela.**

Decisões já fechadas em `docs/IN-APP-PURCHASE.md`, que este documento não redecide: cobrança **só
pelas lojas** (~15%), **7 dias** de teste grátis, **sem checkout web**, preço vindo de
`getOfferings()` e `appUserID` = `user.id` do Supabase. Este documento é sobre **a tela**; a
integração da RevenueCat é decisão à parte.

## Pergunta que responde

> "O que eu ganho pagando, quanto custa, e o que acontece se eu desistir?"

A terceira parte é a que converte neste produto. O diferencial declarado é cancelar fácil — a tela
que vende tem que dizer isso **antes** da compra, não escondido nos termos.

## Persona

- **Primária: quem esbarrou num limite agora.** Ninguém abre esta tela por curiosidade: ela abre
  porque o extrato foi recusado, a cota de IA acabou ou o convite não coube.
- **Secundária: Camila, 34** — a única que compara planos de propósito, e a que mais valoriza
  "5 pessoas" (workspace do casal + família).
- **Terciária: quem trocou de aparelho** — vem só para **Restaurar compra**.

## Entrada e saída

- **Entrada** (sempre com um motivo, e o motivo muda o título):

  | Origem | Título |
  |---|---|
  | `import` (402 de `import-statement/index.ts:50`) | "Importar extrato é do Pro" |
  | `ai_quota` (cota do mês, `plan_status`) | "Sua cota de mensagens acabou" |
  | `members` (limite de `private.plan_limits`) | "Convidar mais gente é do Família" |
  | `plan` ("Ver planos") | "Escolha seu plano" |
  | `trial_ending` (alerta do `0037`, 2 dias antes) | "Seu teste grátis acaba em 2 dias" |

- **Saída:** compra concluída → **dismiss** e a tela de origem já mostra o novo estado.
- **Back:** é `modal` com **Cancelar/X** próprio, fechável sempre. **Paywall que não fecha é a
  primeira coisa que a App Review reprova — e a segunda é o usuário desinstalar.**
- **Porta de mão única:** depois da compra a tela não volta. Fecha e não fica na pilha; nunca
  mostrar "assinar Pro" para quem acabou de assinar Pro.

## Anatomia

1. **Header do modal** — X à esquerda, **"Restaurar"** à direita. *Restaurar no header é exigência
   prática da Apple e o caminho de quem trocou de aparelho; enterrado no rodapé vira ticket.*
2. **Título e uma linha** — o par da tabela acima. A linha explica o ganho concreto daquela
   origem, não adjetivo: *"Traga o extrato do banco e revise tudo de uma vez."*
3. **Seletor mensal / anual** — segmented. Anual mostra a economia calculada **a partir dos preços
   da loja**, nunca de conta feita à mão no código.
4. **Card de destaque (o único `GlassCard`) — o plano selecionado**: nome, preço da loja,
   periodicidade, e as três linhas que são os limites de verdade (`private.plan_limits`, `0029`):
   pessoas, mensagens de IA por mês, importação de extrato.
5. **O outro plano**, como `Card` opaco tocável. **Dois planos, não três**: Free não é um produto à
   venda, é o estado padrão (`0034`) — aparece como uma linha de texto (*"O Free continua
   funcionando: 1 pessoa, 100 mensagens por mês"*), não como cartão de compra.
6. **Botão de compra** — "Começar 7 dias grátis" (`TRIAL_DAYS`, `src/lib/billing.ts:39`) ou
   "Assinar" quando a loja disser que o usuário não tem mais direito ao teste. Abaixo dele, a
   frase de renovação, obrigatória na revisão da Apple: *"R$ 24,90/mês depois do teste. Renova
   sozinho até você cancelar — e cancelar é um toque, na App Store."*
7. **Rodapé legal** — Termos de uso · Política de privacidade (links; as duas lojas exigem que
   estejam publicados e alcançáveis daqui).

**Sem contagem regressiva, sem "oferta acaba hoje", sem preço riscado inventado.** O produto se
posiciona contra dark pattern de cobrança; a tela de cobrança é onde isso é verdade ou mentira.

## Dados

| Bloco | Hook | queryKey | Fonte | Realtime |
|---|---|---|---|---|
| Preços e pacotes | `useOfferings()` **(novo)** | `['offerings']` | `Purchases.getOfferings()` (RevenueCat) | — |
| Comprar | `usePurchasePackage()` **(novo)** | — | `Purchases.purchasePackage()` | — |
| Restaurar | `useRestorePurchases()` **(novo)** | — | `Purchases.restorePurchases()` | — |
| Estado do plano | `usePlanStatus()` | `['plan-status']` | RPC `plan_status()` | — |

**Preço nunca sai do código.** `STORE_PRODUCTS[].fallbackPrice` (`src/lib/billing.ts:32-35`) é
rótulo de fallback, e o próprio arquivo diz: *"o preço que vale é o que a loja devolve no device"*.
Preço varia por país, por promoção e por imposto. Regra desta tela: **o botão de compra só aparece
com preço vindo de `getOfferings()`**; o `fallbackPrice` só pode ser usado em texto que não compra
("planos a partir de R$ 24,90").

**Depois da compra, o app não decide nada.** Quem concede é o webhook, servidor a servidor
(`_apply_entitlement`, `0035`) — o cliente nunca valida recibo e nem consegue escrever em
`subscriptions` (`0033`). Então o fluxo de sucesso é: compra aprovada pela loja → **refetch de
`plan_status` com retry curto** (a cada 2s por ~20s, conforme `IN-APP-PURCHASE.md` Fase 3) → plano
novo na tela. É assíncrono e a tela tem que mostrar isso, não fingir instantaneidade.

## Ação primária

**Assinar com o teste grátis.** Um botão, um toque, o sheet nativo da loja por cima. Nada de
formulário nosso: não coletamos cartão, não existe checkout web, não há campo nenhum nesta tela.

## Ações secundárias

- Trocar entre mensal e anual.
- Trocar entre Pro e Família.
- **Restaurar compra** (header).
- Termos e privacidade.

## Estados

Esta tela é quase toda estado. Cada um com texto próprio:

- **Loading (preços)** — `Skeleton` na forma dos dois cards. **Sem preço, sem botão de compra.**
- **Error (offerings)** — *"Não consegui falar com a App Store agora."* + "Tentar de novo". Não
  mostra preço nenhum e não some com a tela: o usuário chegou aqui por um motivo, e precisa ao
  menos entender o plano.
- **Comprando** — botão em loading, tela **não** bloqueada (o sheet da loja já bloqueia).
- **Compra cancelada pelo usuário** — silêncio. Volta ao normal, sem toast, sem "tem certeza?".
  Insistir aqui é o que faz desinstalar.
- **Liberando (webhook em voo)** — estado próprio, ~20s: *"Compra aprovada. Liberando seu
  plano…"*, com o retry rodando. **Nunca dizer "erro" nesse intervalo.**
- **Liberou** — haptic `notificationAsync(Success)`, o card vira o plano novo por um instante e o
  modal fecha. A tela de origem já mostra o estado novo.
- **Não liberou em 20s** — não é falha do usuário nem do pagamento: *"Sua compra foi aprovada e o
  plano entra em instantes. Pode fechar — a gente avisa no WhatsApp."* Fechar precisa ser seguro,
  porque o dinheiro já saiu e o webhook vai chegar.
- **Compra recusada pela loja** — mensagem da loja, sem tradução criativa, + "Tentar de novo".
- **Já assinante** (comprou em outro aparelho) — *"Você já tem o Pro nesta conta da loja"* +
  "Restaurar".
- **Restaurar sem nada para restaurar** — *"Nenhuma assinatura encontrada nesta conta da App
  Store."* — e não "erro".
- **Web** — o app tem build web (`app-tabs.web.tsx`) e IAP não existe lá: a tela explica
  *"Assinatura só pelo aplicativo"* e some com o botão. Botão que não pode funcionar é pior que
  botão ausente.
- **Conteúdo longo** — preço e periodicidade nunca truncam.

## Movimento

| O que | Propósito | Valor |
|---|---|---|
| Abertura do modal | continuidade espacial | `modal` nativo, mola `Motion.spring.sheet` — nada customizado |
| Troca mensal/anual | mudança de estado | preço faz cross-fade em `Motion.fast`; card não redimensiona com salto |
| Troca de plano selecionado | feedback | seleção com `withSpring(Motion.spring.settle)`; haptic `selectionAsync` |
| Botão de compra | feedback | press-in `scale 0.97` em 120 ms; haptic `impactAsync(Medium)` no toque |
| "Liberando…" | explicação | pulso lento (`Motion.slow`) na linha de status — o único movimento contínuo da tela, e existe para dizer "estamos esperando a loja" |
| Sucesso | mudança de estado | haptic `notificationAsync(Success)`, card assenta e o modal fecha em `Motion.base` |

Nada de confete. A pessoa acabou de gastar dinheiro; o tom é de confirmação, não de festa.

## Acessibilidade

- O botão de compra anuncia a frase inteira: *"Começar 7 dias grátis, depois 24 reais e 90 por
  mês, renovação automática"*. Preço e recorrência **precisam** ser lidos — é requisito de revisão
  e é o mínimo honesto.
- Plano selecionado anuncia `accessibilityState={{ selected: true }}`, não só cor de borda.
- "Restaurar" com `accessibilityLabel` explícito.
- Alvos ≥ 44pt, inclusive nos links do rodapé.
- Dynamic Type XL: os cards viram lista vertical e o botão nunca some abaixo da dobra.
- Estado "Liberando…" é anunciado por `accessibilityLiveRegion` — quem não vê a tela precisa saber
  que a compra passou.

## Fora de escopo

- **A integração da RevenueCat** (chaves, `configure`, `appUserID`, offering `default`): é decisão
  e checklist à parte, em `docs/IN-APP-PURCHASE.md`. Aqui só se declara o que a tela consome.
- **Checkout web / Pix / cartão direto**: decidido — não existe. Landing page é informativa.
- **Trocar de plano por aqui**: os quatro produtos vivem no mesmo subscription group
  (`src/lib/billing.ts`), então upgrade e downgrade são da loja, proporcionais e automáticos.
- **Cancelar por aqui**: é da tela de Plano, e para assinatura de loja é a loja (`0036`).
- **A/B de preço e paywall múltiplo**: sem base de usuário para isso, e cada variante é um produto
  a mais para manter nas duas lojas.
- **Trial próprio nosso** (marcar `trialing` na mão): o teste é *introductory offer* configurada
  nas lojas; duplicar aqui criaria dois relógios diferentes e um deles estaria errado.
