# Plano — `src/app/(tabs)/finance/plan.tsx`

Hoje a tela tem 350 linhas e **três assuntos diferentes** no mesmo scroll: o estado da assinatura,
um catálogo de planos que não faz nada quando tocado (`TESTE-E2E.md` 9.9) e o formulário de
convite de membro. Depois desta rodada ela fica com **um**: *qual é o meu plano, o que ele me dá,
e como eu mexo nisso*. O catálogo vira `docs/design/paywall.md`; os convites vão para
`docs/design/membros.md`, junto com as pessoas que eles viram.

`plan_status()` (`0036`) devolve tudo numa chamada: `plan, status, current_period_end, is_trial,
provider, members, max_members, ai_messages_month, max_ai_messages_month, can_import`. Os limites
moram em `private.plan_limits` (`0029`), num lugar só — **Free** 1 pessoa / 100 mensagens / sem
importação · **Pro** 3 / 1.000 / com · **Família** 5 / 2.000 / com.

> A tela é alcançada pelo Perfil, mas mora na pilha do Financeiro (é lá que ela conversa com cota
> de IA e importação). O toque troca de aba — comportamento nativo do `NativeTabs`.

## Pergunta que responde

> "O que eu tenho, quanto já usei, e como eu saio disso se quiser?"

As três partes importam na mesma medida. A terceira é a que ganha confiança: **cancelamento é uma
chamada, sem formulário** (`cancel_subscription`, `0029`/`0036`) porque dificultar cancelamento é
a reclamação nº1 contra os concorrentes no Reclame Aqui.

## Persona

- **Primária: qualquer assinante**, em momento raro — perto do fim do teste grátis, ou quando a IA
  avisou que a cota acabou.
- **Secundária: Camila, 34** — chega aqui porque quer importação de extrato e descobre que é do
  Pro.
- **Terciária: o casal** — quer saber quantas pessoas cabem antes de convidar.

## Entrada e saída

- **Entrada:** Perfil › Conta › Plano e cobrança. Também é o destino do alerta de fim de teste
  (`_alerts_to_send`, `0037`, disparado 2 dias antes) e do 402 da importação.
- **Saída:**
  - "Ver planos" → `modal /paywall`
  - "Pessoas" → `push (tabs)/profile/members`
  - "Gerenciar assinatura" → App Store / Google Play (sai do app)
- **Back:** `pop`.

## Anatomia

1. **Header nativo** — large title "Plano".
2. **Card de destaque (o único `GlassCard`) — "Pro · teste grátis até 03/09"**
   Nome do plano, selo de estado, e **a barra de consumo de mensagens de IA** com o número escrito
   (`87 de 1.000 mensagens este mês`, `tabular-nums`). É o card porque é o único número da tela que
   muda comportamento: cota estourada corta a IA no `process-jobs`.
   Selos (a partir de `status`, `is_trial` e `current_period_end`, lógica que já existe em
   `plan.tsx:43-53`): `trialing` → *teste grátis até DD/MM* · `canceled` → *ativo até DD/MM* ·
   `past_due` → *pagamento pendente* (em `danger`) · `expired` → *expirou* (em `danger`).
   **`expired` é derivado** (`private.effective_plan`, `0034`): plano pago que passou da data cai
   para Free sozinho, e a tela precisa poder dizer isso — senão o usuário acha que perdeu dinheiro.
3. **"O que seu plano dá"** — três `Row`s com o estado real, não com marketing:
   - **Pessoas** — `2 de 3` → leva para Membros;
   - **Mensagens da IA** — `87 de 1.000 este mês`, com a data em que zera;
   - **Importar extrato** — *liberada* / *não entra no Free* → leva para o paywall.
   *Esses três são exatamente as três colunas de `private.plan_limits`. Um lugar só no banco, um
   lugar só na tela.*
4. **"Ver planos"** — uma `Row` com `chevron`, abrindo o paywall. **Nenhum preço aqui.** Preço é
   coisa da loja e só existe de verdade em `getOfferings()`; a `PLANS` de `use-finance.ts:995` tem
   `R$ 24,90` escrito à mão e não pode ser fonte de exibição.
5. **"Cobrança"** — só aparece com plano pago:
   - onde foi comprado (`provider`: App Store / Google Play);
   - quando renova (`current_period_end`);
   - **"Gerenciar assinatura"** (leva para a loja) ou **"Cancelar assinatura"**, conforme o
     backend mandar (ver abaixo).
6. **Nada mais.** Sem depoimento, sem selo de segurança, sem comparativo. Isto é uma tela de conta;
   quem vende é o paywall.

## Dados

| Bloco | Hook | queryKey | RPC / tabela | Realtime |
|---|---|---|---|---|
| Tudo da tela | `usePlanStatus()` | `['plan-status']` | RPC `plan_status()` (`0036`) | — (refetch no focus) |
| Cancelar | `useCancelSubscription()` | — | RPC `cancel_subscription()` (`0036`) | invalida `['plan-status']` |

Uma query só, de propósito: `plan_status` foi desenhada para servir a tela **e** o gate da IA na
mesma chamada. Não há o que paralelizar.

Sem realtime: `subscriptions` não está na publicação e não deveria estar — quem escreve é o
webhook, e o caminho de volta para a tela é o refetch depois da compra (ver `paywall.md`).

## Ação primária

**Cancelar — e ser levado ao lugar certo para isso.**

É a ação que o produto trata como sagrada, e hoje ela está meio implementada. `cancel_subscription`
(`0036`) devolve `'cancelado'` **ou** `'cancelar_na_loja:apple'` / `'cancelar_na_loja:google'` — a
regra de para onde mandar a pessoa **já mora no banco**. Mas `useCancelSubscription`
(`use-finance.ts:1078`) **descarta o retorno**, e a tela reimplementa a decisão em TS
(`plan.tsx:73`, `naLoja = provider === 'apple' || 'google'`), abrindo a loja **sem nem chamar a
RPC** (`:76-79`).

Funciona hoje e é duplicação de regra amanhã. O desenho certo: o botão chama a RPC sempre, e o
**retorno** decide:

| Retorno | O que a tela faz |
|---|---|
| `cancelado` | toast *"Assinatura cancelada. Você continua no Pro até DD/MM."* + refetch |
| `cancelar_na_loja:apple` | abre `apps.apple.com/account/subscriptions` |
| `cancelar_na_loja:google` | abre `play.google.com/store/account/subscriptions` |

E o texto do action sheet continua sendo o que já está em `plan.tsx:83`, que está certo: *"Seu
plano volta para o Free no fim do período. Nenhum dado é apagado — e dá para voltar quando quiser,
aqui mesmo."* Cancelar assinatura de loja **por dentro do app** seria o pior dos mundos: tira o
acesso e deixa a cobrança rodando (é o bug que a `0036` fecha).

## Ações secundárias

- Ver planos → paywall.
- Pessoas → Membros.
- Gerenciar assinatura na loja.
- **Restaurar compra** — só aparece quando `plan = 'free'` e a loja pode ter uma assinatura ativa;
  o botão de verdade mora no paywall, aqui é atalho para quem trocou de aparelho.

## Estados

- **Loading** — `Skeleton` com a forma: um bloco alto + três linhas.
- **Empty** — não existe. Free **é** um estado válido e completo, nunca "sem plano": o card mostra
  Free com a cota de 100 mensagens. `private.effective_plan` (`0034`) garante que Free é o padrão,
  inclusive com a loja fora do ar.
- **Error** — inline com "Tentar de novo". Falhar aqui não pode virar "você é Free": sem dado, a
  tela diz que não conseguiu ler, e não inventa plano.
- **`expired`** — tratamento próprio: card em `danger`, *"Sua assinatura expirou em DD/MM"*, e a
  ação óbvia é assinar de novo. Nada é apagado — e a tela diz isso.
- **`past_due`** — *"A loja não conseguiu cobrar"* + "Atualizar forma de pagamento na loja". Nós
  não temos como resolver isso do nosso lado, e fingir que temos gera ticket.
- **Cota estourada** — a barra fica em `danger` (já é assim em `plan.tsx:137`) e o card ganha uma
  linha acionável: *"A IA para de responder até DD/MM. Subir para o Pro libera 1.000 por mês."*
- **Conteúdo longo** — nome do plano e datas não truncam; a linha inteira quebra.

## Movimento

| O que | Propósito | Valor |
|---|---|---|
| Barra de consumo | mudança de estado | `withSpring(Motion.spring.settle)` ao chegar o dado; nunca aparece "cheia" e depois encolhe |
| Contador de mensagens | mudança de estado | conta de/para em `Motion.base`, `tabular-nums` |
| Entrada das seções | continuidade | `FadeInDown`, stagger 60 ms (`plan.tsx:108` já faz) |
| Cancelar | feedback | haptic `notificationAsync(Warning)` no confirm; card atualiza com `LinearTransition` |
| Ida para a loja | — | sem animação própria; quem anima é o sistema |

Tela de conta é o pior lugar para movimento decorativo. Só a barra e o número se mexem.

## Acessibilidade

- A cota é **texto** antes de ser barra: "87 de 1.000 mensagens usadas este mês".
- Selo de estado nunca é só cor: "expirou" e "pagamento pendente" são palavras.
- "Cancelar assinatura" com `accessibilityRole="button"` e confirmação — nunca destrutivo em um
  toque.
- Alvos ≥ 44pt em todas as `Row`.
- Dynamic Type XL: `Row` com valor trailing empilha em duas linhas.
- Datas com `tabular-nums` e lidas por extenso.

## Fora de escopo

- **Comparar planos e comprar**: é o paywall, tela separada, `modal`.
- **Trocar de plano dentro do app** (Pro → Família): Apple e Google resolvem isso sozinhas, e os
  quatro produtos estão no **mesmo subscription group** de propósito (`src/lib/billing.ts`), o que
  já faz upgrade valer na hora e downgrade valer na renovação, proporcional. Reimplementar seria
  errar.
- Histórico de cobranças e recibos: quem tem é a loja, e ela mostra melhor.
- Cupom, desconto, indicação: não existe backend para nada disso, e a cobrança é da loja.
- Excluir conta: decisão de produto pendente (ver `perfil.md`).
