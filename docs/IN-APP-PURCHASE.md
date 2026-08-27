# In-App Purchase — o que fazer do seu lado

Decisão (27/08/2026): **a cobrança é só pelas lojas.** App Store e Google Play, ~15%
nas duas, 7 dias de teste grátis. Não existe checkout web — a landing page é
informativa ("planos a partir de R$ 24,90 · baixe o app"), e landing page não é
governada por App Review, só o binário é.

O backend já está pronto e testado. O que falta é tudo que exige você logado nas
contas da Apple, do Google e da RevenueCat.

> **O Free não vem da loja.** A loja só avisa compra, renovação, cancelamento,
> expiração e reembolso. Free é o estado padrão — a ausência de assinatura ativa.
> Por isso o Free continua funcionando com a loja fora do ar.

---

## Fase 0 — contas e contratos

| # | O quê | Onde | Custo |
|---|---|---|---|
| 0.1 | Apple Developer Program | developer.apple.com | US$ 99/ano |
| 0.2 | Google Play Console | play.google.com/console | US$ 25, uma vez |

**0.3 — Escolha CNPJ, não CPF, na conta da Apple.** O nome do titular vira o
**nome do vendedor exibido na App Store**. Com CPF aparece seu nome civil; com
CNPJ aparece ProOps. Conta de organização exige CNPJ + número D-U-N-S (gratuito,
pedido no site da Dun & Bradstreet, leva alguns dias). Peça o D-U-N-S antes de
tudo — é o item mais lento desta lista.

**0.4 — Preencher Agreements, Tax and Banking** no App Store Connect e o perfil
de pagamentos no Play Console. Sem isso os produtos nem aparecem para venda.

**0.5 — ⚠️ Inscrever no App Store Small Business Program.**
`developer.apple.com/app-store/small-business-program/enroll/`

Isto **não é automático**. Sem a inscrição a Apple cobra **30%**, não 15%. E o
benefício só vale ~15 dias após o fim do mês fiscal em que a inscrição for
aprovada — então faça **antes** de publicar, não depois. Requisitos: ser Account
Holder, aceitar o Paid Apps Agreement (Schedule 2) e listar contas associadas.

No Google não precisa se inscrever em nada: os 10% + 5% do primeiro US$ 1 mi
valem automaticamente desde 30/06/2026.

---

## Fase 1 — criar os produtos

Os ids abaixo estão fixados em `src/lib/billing.ts` e replicados em
`supabase/functions/_shared/billing.ts`. **Digite exatamente assim.** Um id
diferente vira compra que a loja aprova e o nosso webhook não sabe traduzir — o
usuário paga e não recebe nada (aparece como `produto_desconhecido` em
`billing_events`). O teste `src/lib/billing.test.ts` trava a divergência entre os
dois arquivos, mas não tem como conferir o que você digitou na loja.

| Product ID | Plano | Período | Preço |
|---|---|---|---|
| `proops.personal.pro.monthly` | Pro | 1 mês | R$ 24,90 |
| `proops.personal.pro.annual` | Pro | 1 ano | R$ 249,00 |
| `proops.personal.family.monthly` | Família | 1 mês | R$ 39,90 |
| `proops.personal.family.annual` | Família | 1 ano | R$ 399,00 |

### 1.1 App Store Connect

1. Criar o app (bundle id — o mesmo do `app.json`).
2. **Um único Subscription Group** para os quatro. Nome sugerido: `ProOps Personal`.

   ⚠️ **Não crie dois grupos.** Só existe **um teste grátis por Apple ID por
   grupo**: com grupos separados a pessoa pega 7 dias no Pro, cancela, e pega
   mais 7 no Família. No mesmo grupo, a troca entre planos ainda sai proporcional
   e automática.
3. Criar as 4 assinaturas auto-renováveis com os ids da tabela.
4. **Rank dentro do grupo:** Família acima de Pro. O rank é o que a Apple usa
   para decidir o que é upgrade (vale na hora) e o que é downgrade (vale na
   renovação).
5. Em cada assinatura → **Introductory Offer**: tipo *Free Trial*, duração
   *1 week*, para *New Subscribers*.
6. Localização **pt-BR**: nome de exibição e descrição em cada uma.
7. Screenshot da tela de assinatura para a revisão.

### 1.2 Google Play Console

Monetização → Produtos → **Assinaturas**.

Crie **quatro assinaturas separadas**, cada uma com **um** base plan
auto-renovável. É mais trabalhoso que duas assinaturas com dois base plans cada,
mas mantém o `product_id` idêntico ao da Apple — e é isso que permite o mesmo
`planForProduct()` atender as duas lojas sem `if`.

Em cada base plan → **Offer** → *Free trial*, 7 dias, elegibilidade
"novos assinantes".

---

## Fase 2 — RevenueCat

Grátis até US$ 2.500/mês de receita rastreada, 1% depois. É ela que valida os
recibos com a Apple e o Google servidor a servidor — nós nunca validamos recibo
no aparelho.

1. Criar projeto.
2. **App iOS:** bundle id + a *In-App Purchase Key* do App Store Connect
   (Users and Access → Integrations → In-App Purchase).
3. **App Android:** package name + credenciais de uma *service account* do Google
   Cloud com permissão no Play Console (Financial data + Manage orders). É o
   passo mais chato dos dois; a RevenueCat tem um guia passo a passo.
4. **Entitlement:** criar um só, com o id **`premium`**.
5. **Products:** cadastrar os 4 ids e anexar todos ao entitlement `premium`.
6. **Offering** `default` com os 4 packages (para o app listar).
7. **Restore/Transfer behavior:** escolher **"Keep with original App User ID"**.
   Isso impede que uma mesma conta de loja seja usada para liberar Pro em várias
   contas nossas. Trocar de aparelho continua funcionando normal (é o mesmo App
   User ID).
8. **Webhook** (Integrations → Webhooks):
   - URL: `https://kwriuifcwyvdrxtspjiz.supabase.co/functions/v1/billing-webhook`
   - Authorization header: uma string aleatória longa, gerada por você
   - Guardar essa string: é o `REVENUECAT_WEBHOOK_SECRET`

```bash
npx supabase secrets set REVENUECAT_WEBHOOK_SECRET='<a mesma string>'
npx supabase functions deploy billing-webhook
```

---

## Fase 3 — o app

Precisa de **development build** (o SDK tem código nativo; não roda no Expo Go).
Você já precisa de dev build por causa do `expo-glass-effect` e do `NativeTabs`,
então não é custo novo.

```bash
npx expo install react-native-purchases
eas build --profile development --platform android   # e ios
```

**O vínculo que faz tudo funcionar** — o `appUserID` da RevenueCat tem que ser o
**id do usuário no Supabase**. É por ele que o webhook acha o workspace. Se isso
sair errado, a compra é aprovada pela loja e o plano nunca chega no WhatsApp:

```ts
import Purchases from 'react-native-purchases';
import { supabase } from '@/lib/supabase';

const { data } = await supabase.auth.getSession();
Purchases.configure({
  apiKey: Platform.OS === 'ios' ? APPLE_KEY : GOOGLE_KEY,
  appUserID: data.session!.user.id,   // ← NUNCA deixar a RevenueCat gerar um id anônimo
});
```

Depois da compra, **não confie no cliente**: refaça o `plan_status` (o hook
`usePlanStatus`). O plano só é verdade depois que o webhook gravou. Como o
webhook é assíncrono, vale um retry curto — algo como tentar de novo a cada 2s
por uns 20s antes de mostrar erro.

---

## Fase 4 — testar

**iOS:** criar Sandbox Tester em App Store Connect (Users and Access → Sandbox).
Sair da Apple ID de verdade no aparelho antes.
**Android:** adicionar sua conta em License Testing no Play Console e publicar
numa faixa de teste interno.

⚠️ **Por padrão, evento de sandbox NÃO concede plano** — é proteção, senão
qualquer um com StoreKit Testing viraria Pro de graça. Para testar ponta a ponta:

```bash
npx supabase secrets set BILLING_ALLOW_SANDBOX=true
```

**Essa chave tem que sair antes de publicar:**

```bash
npx supabase secrets unset BILLING_ALLOW_SANDBOX
```

O `environment` real fica gravado em `billing_events.payload` de qualquer jeito,
então dá para auditar depois se alguém entrou por sandbox.

O que conferir em `billing_events` (`result` de cada evento):

| Evento na loja | `result` esperado | Efeito |
|---|---|---|
| Comprar com trial | `concedido` | plano vira Pro, `status = trialing` |
| Renovar | `concedido` | `status = active`, `is_trial = false` |
| Cancelar | `concedido` | **continua Pro até vencer** — cancelar é "não vai renovar" |
| Deixar vencer | `revogado` | volta para Free |
| Reembolsar | `revogado` | volta para Free |
| Mesmo evento reenviado | `duplicado` | nada acontece |

---

## Fase 5 — antes de publicar

- [ ] `BILLING_ALLOW_SANDBOX` removida dos secrets
- [ ] Small Business Program aprovado (senão é 30%)
- [ ] Os 4 product ids conferidos letra por letra nas duas lojas
- [ ] Preços em BRL nas duas lojas
- [ ] Termos de uso e política de privacidade publicados (as duas lojas exigem)
- [ ] Texto obrigatório na tela de assinatura: preço, periodicidade, renovação
      automática e como cancelar — a Apple reprova sem isso
- [ ] Conta de teste para a revisão da Apple (eles precisam entrar no app)

---

## O que já está pronto no código

| Peça | Onde |
|---|---|
| Produtos, trial e entitlement (fonte única) | `src/lib/billing.ts` + cópia em `_shared/billing.ts`, travadas por `src/lib/billing.test.ts` |
| Webhook | `supabase/functions/billing-webhook/index.ts` |
| Concessão de plano (única porta de entrada) | `public._apply_entitlement` (`0035`) |
| Expiração automática se o webhook se perder | `private.effective_plan` (`0034`) |
| Auditoria e idempotência | `public.billing_events` (`0034`) |
| Cancelamento vai para a loja | `public.cancel_subscription` (`0036`) |
| Tela mostra trial / expirado / gerenciar na loja | `src/app/finance/plan.tsx` |

### Como o app está protegido

1. **O app nunca diz "sou Pro".** A `0033` tirou a policy de escrita em
   `subscriptions`; o trigger `guard_billing` recusa alteração das colunas de
   cobrança vinda de `authenticated`/`anon`. Recibo forjado no aparelho não tem
   onde ser gravado.
2. **Recibo nunca é validado no cliente.** Quem valida com Apple e Google é a
   RevenueCat, servidor a servidor.
3. **Header conferido em tempo constante.** Comparar com `===` vazaria o prefixo
   correto por timing.
4. **Sandbox não concede** (salvo a chave de teste acima).
5. **Idempotência** por `billing_events.id` — a RevenueCat reenvia até receber 2xx.
6. **Uma compra libera um workspace** — unique parcial em `(provider, external_id)`.
   Sem isso, o mesmo `original_transaction_id` pagaria por várias contas.
7. **Expiração é rede de segurança.** Mesmo que o webhook de EXPIRATION se perca,
   `current_period_end` no passado derruba o plano para Free na hora.

### O que ainda falta no código (depende da Fase 1 e 2)

- Instalar `react-native-purchases` e configurar com o `appUserID` correto
- Tela de paywall lendo os preços reais da loja via `getOfferings()`
- Refetch com retry depois da compra
