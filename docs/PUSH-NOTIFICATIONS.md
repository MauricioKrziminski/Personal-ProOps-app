# Push notifications — estado e validação pendente

> O código, EAS e o primeiro APK foram configurados na Fase 7 em 04/09/2026. A entrega em
> aparelho físico ainda precisa ser validada; a seção histórica de 26/08 abaixo não representa
> mais o estado atual.

## Por que isso importa (o argumento de custo)

Um lembrete pessoal respeita `reminders.channel`; quando a pessoa pediu push e o token não está
disponível, `send-reminders` ainda pode cair no WhatsApp:

```ts
if (wantsPush && profile?.expo_push_token) { await sendExpoPush(...) }
// sem token -> fallback para sendTemplate(), que é template Utility PAGO
```

Nos avisos financeiros inferidos pelo sistema isso não vale: desde a `0052`, push e WhatsApp têm
preferências independentes, desligadas por padrão, e nunca existe fallback para um canal que a
pessoa não ativou. `expo_push_token` é capacidade compartilhada com lembretes, não preferência.

## Estado atualizado em 04/09/2026

| Item | Estado |
|---|---|
| `profiles.expo_push_token` | capacidade preservada; entrega física ainda não validada |
| `app.json` → `extra.eas.projectId` | `8313579c-3979-4ecd-ba6a-4dc0bf702f05` |
| EAS | projeto, build e update configurados na Fase 7 |
| Package Android / bundle iOS | `com.proops.personal` (os dois) |
| Plugin `expo-notifications` no `app.json` | ausente |
| `setNotificationHandler` / listener no app | existem em `src/lib/notifications.ts` |

## O que JÁ está pronto (não refazer)

- **Coluna** `profiles.expo_push_token` (migration `0001`).
- **Registro do token**: `src/hooks/use-push.ts`, hook `useRegisterPush` — pede permissão,
  lê o `projectId`, chama `getExpoPushTokenAsync` e grava no profile. Já falha com mensagem
  útil quando o `projectId` não existe ("App ainda não vinculado ao EAS...").
- **Envio**: `supabase/functions/send-reminders/index.ts`, `sendExpoPush()` → `POST
  https://exp.host/--/api/v2/push/send`. Push e WhatsApp são tentados de forma independente;
  se o push falhar, o WhatsApp ainda é tentado antes de contar a tentativa.
- **Dependências**: `expo-notifications`, `expo-device` e `expo-constants` já no `package.json`.

Ou seja: falta **configuração de plataforma** e um **pedaço de código de recepção** (abaixo).

## As três peças que faltam

### 1. `projectId` — identidade do app no EAS

`getExpoPushTokenAsync` resolve o projeto por `Constants.expoConfig.extra.eas.projectId`.
Sem ele, o token nunca é emitido fora do Expo Go. Quem grava isso é o `eas init`.

### 2. Credenciais do fabricante

O Expo não entrega a notificação: ele repassa para o **FCM** (Android) ou **APNs** (iOS).
Sem credenciais, o token é emitido mas nada chega no aparelho — falha silenciosa, difícil de
diagnosticar depois.

- **Android**: projeto no Firebase + chave de conta de serviço (**FCM V1**, não a legada).
- **iOS**: conta paga Apple Developer (US$ 99/ano); o EAS gera a APNs key sozinho.

### 3. Um build

Push **não funciona no Expo Go**. Precisa de build EAS.

⚠️ Use o perfil **`development`**. Em `preview`/`production` o `__DEV__` é `false`, o atalho de
login de teste some da `LoginScreen` e só resta o OTP. (O OTP funciona desde 26/08, mas o build
de development continua sendo o mais prático para iterar.)

## Recomendação: comece por Android, sozinho

iOS custa US$ 99/ano e este é um app pessoal de um usuário. Android é gratuito ponta a ponta.
O caminho para iOS é o mesmo, só acrescenta a assinatura da Apple.

## Passo a passo (Android)

```bash
npx eas login
npx eas init          # grava extra.eas.projectId no app.json — commitar essa mudança
```

**Firebase** (uma vez só):

1. <https://console.firebase.google.com> → criar projeto
2. Adicionar app **Android** com o package **`com.proops.personal`** — tem que bater
   exatamente com o `app.json`, senão o FCM rejeita sem explicar
3. Configurações do projeto → **Contas de serviço** → *Gerar nova chave privada* → baixa um JSON

```bash
npx eas credentials   # Android → FCM V1 → upload do JSON baixado
npx eas build --profile development --platform android
```

O build roda na nuvem (a fila do plano gratuito pode demorar). Baixe o APK e instale **num
aparelho físico** — emulador não emite token de push.

## Código que ainda falta escrever

Registrar o token faz a notificação **chegar**, não faz ela **aparecer direito**. Hoje o app não
tem nada disso — é trabalho de código, não de configuração:

1. **`setNotificationHandler`** (no `src/app/_layout.tsx`, fora do componente): sem ele,
   notificação recebida com o app em primeiro plano não é exibida. É a pegadinha clássica:
   "funciona com o app fechado, some com o app aberto".

   ```ts
   Notifications.setNotificationHandler({
     handleNotification: async () => ({
       shouldShowBanner: true, shouldShowList: true,
       shouldPlaySound: true, shouldSetBadge: false,
     }),
   });
   ```
   ⚠️ A forma desse retorno mudou entre versões do SDK — **conferir em
   <https://docs.expo.dev/versions/v57.0.0/sdk/notifications/> antes de escrever**.

2. **Listener de resposta** (`addNotificationResponseReceivedListener`) + tratamento do
   `getLastNotificationResponseAsync` para o caso de app aberto pela notificação: hoje tocar
   na notificação só abre o app na última tela. O `scheme` já é `appproops`.

3. **Payload com destino**: o `sendExpoPush` manda só `title` e `body`. Para deep link, incluir
   `data: { route: '/reminders', reminderId }` e navegar com o `router` no listener.

## Como verificar que funcionou

1. **No app**: Perfil → "Ativar notificações" → o card vira "✅ Ativadas". Se falhar, a tela
   mostra o motivo exato (permissão negada, emulador, ou projectId ausente).
2. **No banco**:
   ```sql
   select phone, expo_push_token from public.profiles;
   ```
   Deve deixar de ser `NULL` e começar com `ExponentPushToken[`.
3. **Teste real**: criar um lembrete com `next_run_at` uns 2 minutos à frente e observar o
   cron entregar:
   ```sql
   insert into public.reminders (user_id, title, next_run_at, channel, timezone, source)
   select id, 'Teste de push', now() + interval '2 minutes', 'push', timezone, 'app'
   from public.profiles limit 1;

   -- depois, conferir o resultado:
   select title, active, send_attempts, last_error, next_run_at from public.reminders;
   ```
   `send_attempts = 0` e `last_error = null` depois do disparo = entregou.
   Apagar a linha de teste no fim.

## Armadilhas conhecidas

- **Emulador não emite token.** O código já barra isso com `Device.isDevice`.
- **Package divergente** entre Firebase e `app.json` = falha silenciosa no FCM.
- **FCM V1**, não a API legada (descontinuada pelo Google).
- **Token muda**: reinstalar o app ou limpar dados gera token novo. O `usePushToken` só grava
  quando você toca no botão — se o push parar do nada, é o primeiro suspeito. Um dia vale
  revalidar o token no boot do app.
- **Expo Go não serve** para push.

## Custos (verificados nas fontes oficiais em 26/08/2026)

| Item | Custo | Fonte |
|---|---|---|
| Expo Push Service | **grátis** — *"There is no cost associated with sending notifications through Expo push notification service."* Limite técnico de 600 notificações/segundo por projeto. Não exige EAS pago. | [docs.expo.dev/push-notifications/faq](https://docs.expo.dev/push-notifications/faq/) |
| Firebase (só FCM) | grátis e ilimitado nesse uso | — |
| EAS Build | plano **Free** inclui 15 builds Android + 15 iOS por ciclo; Starter US$ 19/mês | [expo.dev/pricing](https://expo.dev/pricing) |
| Apple Developer | US$ 99/**ano** — **só se quiser iOS** (sem conta não existe chave APNs) | — |
| Google Play Console | US$ 25 **uma vez**, sem renovação — só para publicar na loja | — |

**Android sai por R$ 0.** O custo obrigatório só aparece quando o iOS entra.

### O que se economiza do outro lado

Tarifas do WhatsApp no Brasil (o rate card oficial vive no **seu** WhatsApp Manager; os valores
abaixo são de fontes de mercado e precisam ser confirmados lá antes de virar planilha):

| Categoria | Brasil 2026 (aprox.) | Grátis dentro da janela de 24h? |
|---|---|---|
| Utility (alertas, lembretes) | R$ 0,04 – 0,05 | **Sim** |
| Authentication (OTP de login) | R$ 0,15 – 0,19 | Sim |
| Marketing | R$ 0,31 – 0,38 | Não |
| Service (resposta ao cliente) | R$ 0 | — |

Pior caso por usuário: 4 alertas/dia (o teto de `MAX_ALERTS_PER_USER`) × 30 dias × R$ 0,045 ≈
**R$ 5,40/mês**.

⚠️ **Mas atenção a este detalhe, que reduz muito o número real:** template Utility entregue
**dentro da janela de 24h é gratuito**, e este produto é justamente um em que o usuário manda
mensagem todo dia. Se ele escreveu nas últimas 24h, o alerta das 9h sai de graça **mesmo sem
push**. O custo se concentra em **usuário inativo** — que é justamente quem você mais quer
trazer de volta.

Ponto de equilíbrio do iOS: US$ 99/ano ≈ R$ 45/mês fixos contra até R$ 5,40/mês por usuário
inativo → compensa a partir de ~8–10 usuários inativos.

Push **nunca** zera a conta da Meta: o OTP de login continua sendo Authentication a cada acesso
novo, e quem não instalou o app ou revogou a permissão continua caindo no template.

## Histórico: decisão de 26/08/2026, superada pela Fase 7

Depois de entregar as 7 fases do plano de mercado, a decisão (do Mauricio) foi **deixar push por
último**, quando o app estiver redondo e testado. O raciocínio:

- **O custo hoje é R$ 0.** O banco tem 1 profile e nenhum orçamento/fatura cadastrado, então
  `_alerts_to_send()` volta vazio — não há alerta sendo disparado nem template sendo pago.
- **Arquitetura atual:** `send-reminders` mantém o fallback próprio dos lembretes; `send-alerts`
  exige a preferência explícita de cada canal e nunca escolhe WhatsApp só porque o token falta.
- **Exige rebuild nativo**, ou seja, é retrabalho garantido se feito antes das telas estabilizarem.

⚠️ **O item com relógio correndo NÃO é o push** — é a janela de 90 dias do número WhatsApp de
teste, que fecha por volta de **outubro/2026**. Esse não pode ser adiado junto.

## Depois que funcionar

Da Fase 4.1 do roadmap, destravada por isto:

- **Alertas de orçamento** a 80% / 100%: cron diário consultando `_budgets_status` e mandando push.
- **Push quando lançamento recorrente é materializado** pelo `send-reminders`.
- **Plugin `expo-notifications`** no `app.json` (ícone 96×96 branco, cor, canal padrão do
  Android) — cosmético, exige rebuild nativo.
