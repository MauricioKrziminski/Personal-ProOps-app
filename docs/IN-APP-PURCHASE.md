# In-App Purchase — o que fazer do seu lado

Decisão (27/08/2026): **a cobrança é só pelas lojas.** App Store e Google Play, ~15%
nas duas, 7 dias de teste grátis. Não existe checkout web — a landing page é
informativa ("planos a partir de R$ 24,90 · baixe o app"), e landing page não é
governada por App Review, só o binário é.

O backend já está pronto e testado. O que falta é tudo que exige você logado nas
contas da Apple, do Google e da RevenueCat.

> **Não existe plano grátis (09/10/2026).** A porta de entrada é o teste de 7 dias
> da loja, com cartão. `plan = 'free'` no banco é o estado **sem assinatura**: quem
> nunca assinou só vê a tela de assinar; quem venceu entra e só LÊ (o banco recusa
> escrita com `PT402`). Regra completa em `.claude/rules/finance.md` → *Planos e limites*.
> **Nenhum preço entra no código** — o paywall lê da loja.

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

**0.6 — ⚠️ No Google, registre como ORGANIZAÇÃO (CNPJ), não como pessoal.**

Conta pessoal criada depois de 13/11/2023 precisa passar por um **teste fechado com
12 testadores por 14 dias corridos** antes de poder pedir acesso à produção.
**Conta de organização, registrada com CNPJ, é isenta disso.** Como já vamos ter
CNPJ para a Apple, usar o mesmo no Google economiza duas semanas e a caçada por
12 pessoas dispostas a instalar.

Isso não atrapalha teste: a faixa de **teste interno** (até 100 testadores, no ar
em minutos) funciona desde o primeiro dia nos dois tipos de conta — ela só não
conta para o requisito de produção.

---

## Fase 1 — criar os produtos

Os ids abaixo estão fixados em `src/lib/billing.ts` e replicados em
`agent/app/domain/billing.py`. **Digite exatamente assim.** Um id
diferente vira compra que a loja aprova e o nosso webhook não sabe traduzir — o
usuário paga e não recebe nada (aparece como `produto_desconhecido` em
`billing_events`). O teste `src/lib/billing.test.ts` trava a divergência entre os
dois arquivos, mas não tem como conferir o que você digitou na loja.

| Product ID | Plano | Período |
|---|---|---|
| `proops.personal.pro.monthly` | Pro | 1 mês |
| `proops.personal.pro.annual` | Pro | 1 ano |
| `proops.personal.family.monthly` | Família | 1 mês |
| `proops.personal.family.annual` | Família | 1 ano |

**Preço: a decidir.** A proposta com a conta de custo está em `docs/CUSTOS-E-PRECOS.md` §6.
O preço só existe na loja; mudar o preço nunca exige build.

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
   - URL: `<URL do Cloud Run do agente>/hooks/billing` (o `setup-gcp.sh` imprime no fim)
   - Authorization header: uma string aleatória longa, gerada por você
   - Guardar essa string: é o `REVENUECAT_WEBHOOK_SECRET`, no **GCP Secret Manager**
     (`agent/.env.example` documenta; `./scripts/setup-gcp.sh secrets` sobe)
9. **API keys públicas** (Project settings → API keys): a do iOS (`appl_…`) e a do
   Android (`goog_…`) vão em `EXPO_PUBLIC_REVENUECAT_IOS_KEY` /
   `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` (variáveis do EAS por ambiente). Sem elas o
   paywall diz "Assinatura indisponível" — não quebra.

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

`BILLING_ALLOW_SANDBOX=true` no agente do **staging** (variável do Cloud Run).
**Em produção ela nunca existe.**

O `environment` real fica gravado em `billing_events.payload` de qualquer jeito,
então dá para auditar depois se alguém entrou por sandbox.

O que conferir em `billing_events` (`result` de cada evento):

| Evento na loja | `result` esperado | Efeito |
|---|---|---|
| Comprar com trial | `concedido` | plano vira Pro, `status = trialing` |
| Renovar | `concedido` | `status = active`, `is_trial = false` |
| Cancelar | `concedido` | **continua Pro até vencer** — cancelar é "não vai renovar" |
| Deixar vencer | `revogado` | sem assinatura: entra e só lê |
| Reembolsar | `revogado` | sem assinatura: entra e só lê |
| Mesmo evento reenviado | `duplicado` | nada acontece |

---

## Fase 5 — antes de publicar

- [ ] `BILLING_ALLOW_SANDBOX` ausente no agente de produção
- [ ] Small Business Program aprovado (senão é 30%)
- [ ] Os 4 product ids conferidos letra por letra nas duas lojas
- [ ] Preços em BRL nas duas lojas
- [ ] Termos de uso e política de privacidade publicados nas URLs de `src/lib/links-legais.ts` (as duas lojas exigem)
- [ ] Google Play: URL de exclusão de conta (Data safety) — o app já tem Perfil → Apagar conta; a loja pede também um link web
- [ ] Texto obrigatório na tela de assinatura: preço, periodicidade, renovação
      automática e como cancelar — a Apple reprova sem isso
- [ ] Conta de teste para a revisão da Apple (eles precisam entrar no app)
- [ ] ⚠️ **A revisão da Apple compra em SANDBOX, e sandbox não concede em produção.** O revisor
      assina, a loja aprova e o webhook recusa (`sandbox`): ele fica preso na tela de assinar e o
      app é reprovado por "compra não desbloqueia". Antes de mandar para revisão: a conta de teste
      ganha cortesia `manual` (comando abaixo) E as notas da revisão dizem que ela já é assinante —
      ou decide-se liberar sandbox só para um `app_user_id` da lista. Decisão do Gabriel.

### Subir para produção sem trancar ninguém

O fim do plano grátis (`20261010180000_sem_assinatura.sql`) põe todo espaço em `free` como "nunca
assinou" no instante em que cai. Ordem:

1. **Cortesia primeiro** (funciona no schema de hoje), para a sua conta e testadores, no SQL
   Editor de produção:
   ```sql
   update public.subscriptions s
      set plan = 'family', status = 'active', provider = 'manual',
          current_period_end = null, is_trial = false
     from public.workspaces w join auth.users u on u.id = w.owner_id
    where s.workspace_id = w.id and u.email in ('<seu e-mail>', '<testador>');
   ```
2. `migration list --project-ref` e depois o `db push --project-ref` (CLAUDE.md).
3. Agente (`./scripts/setup-gcp.sh deploy`).
4. App **1.12.0** por build (dependência nativa nova: nunca OTA). App antigo em campo recebe
   `PT402` como erro genérico ao salvar, sem paywall — mais um motivo para a cortesia vir antes.

---

---

## O que dá para testar antes de ter as contas

O bloqueio não é tudo ou nada — são três camadas independentes.

| Camada | Precisa de quê | Testável hoje? |
|---|---|---|
| **Nossa metade** (webhook → plano liberado) | nada | **Sim** — POST no `billing-webhook` com um payload de exemplo, ou chamando `_apply_entitlement` direto no SQL |
| **Compra real no Android** | conta Google (US$ 25) | **Quase** — sem D-U-N-S, sem espera; teste interno no ar em minutos |
| **Compra real no iOS** | conta Apple (US$ 99 + D-U-N-S) | Não |

**O Android destrava muito antes do iOS.** A conta do Google custa US$ 25, não
exige D-U-N-S e a faixa de teste interno fica disponível em minutos. Dá para
validar o fluxo inteiro — compra, trial, renovação, cancelamento, expiração e o
nosso webhook — no Android, semanas antes de a Apple estar pronta.

Não vale abrir conta Apple **individual** só para adiantar: virar organização
depois não é um botão, é criar outra conta e transferir os apps.

### Notificações: nada a ver com as lojas

- **Alertas por WhatsApp** (orçamento, fatura, conta vencendo, fim do teste
  grátis) **já funcionam hoje** e não dependem de loja nenhuma. Testam-se
  disparando o `send-alerts` pelo SQL, como no roteiro de teste.
- **Push (Expo)** exige **development build** — desde o SDK 53 o Expo Go não
  recebe push remoto no Android. Com dev build + credenciais FCM (grátis, no
  Firebase, sem conta de loja), o push funciona **no emulador Android** com Google
  Play services. No iOS, push exige a conta Apple.

Push segue adiado por decisão registrada em `docs/PUSH-NOTIFICATIONS.md`. Sem ele,
os alertas caem para template do WhatsApp — que é pago, mas funciona.

---

## O que já está pronto no código

| Peça | Onde |
|---|---|
| Produtos, trial e entitlement (fonte única) | `src/lib/billing.ts` + cópia em `agent/app/domain/billing.py`, travadas por `src/lib/billing.test.ts` |
| Webhook | `POST /hooks/billing` (`agent/app/routes/hooks.py`) |
| Concessão de plano (única porta de entrada) | `public._apply_entitlement` (`0035`) |
| Expiração automática se o webhook se perder | `private.effective_plan` (`0034`) |
| Auditoria e idempotência | `public.billing_events` (`0034`) |
| Cancelamento vai para a loja | `public.cancel_subscription` (`0036`) |
| Tela mostra trial / expirado / gerenciar na loja | `src/app/finance/plan.tsx` |
| Aviso de fim de teste, 2 dias antes | `_alerts_to_send` (`0037`), entregue pelo `/cron/alerts` |

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
   `current_period_end` no passado tira o acesso na hora.

### No app (09/10/2026)

`react-native-purchases` com `appUserID` = id do Supabase (`src/lib/compras.ts`), paywall lendo
`getOfferings()`, Restaurar, refetch com retry e o portão `/assinar`. **Nunca compilado ainda**:
compra, restaurar e `logIn/logOut` se conferem no primeiro dev client novo (iOS pode pedir
`pod install` à mão). Sem chave ou sem o módulo, o paywall diz "indisponível".
