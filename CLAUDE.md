@AGENTS.md

# Personal ProOps app

> **Nomenclatura:** este repositório **não é "o ProOps"**. ProOps é o produto/marca maior; este é um **aplicativo pessoal que faz parte do produto ProOps**. Enquanto não houver nome definitivo, usar o nome genérico **"Personal ProOps app"** ao se referir ao app (em código, docs e UI).

App mobile pessoal de **notas rápidas, lembretes e controle financeiro operado via WhatsApp**. O usuário manda mensagens em linguagem natural ("gastei 45 no mercado", "lembrar de pagar aluguel todo dia 5") e a IA categoriza automaticamente em **notas / lembretes / gastos**, que aparecem organizados no app. Lembretes são disparados de volta (push e/ou WhatsApp). O financeiro soma gastos por categoria/mês e futuramente importará extratos.

## 🎨 Diretriz de design (obrigatória)

O app deve ser **totalmente moderno e bonito, estilo iOS**:

- **Liquid Glass** nas superfícies-chave (cards, headers, sheets) — usar `expo-glass-effect` (`GlassView`, nativo no iOS 26+) com fallback `expo-blur` (`BlurView`) em iOS antigo/Android. Componente central: `src/components/glass/`.
- **Navbar/tab bar em liquid glass** — usamos `NativeTabs` do expo-router, que renderiza a tab bar nativa em Liquid Glass no iOS 26.
- **Animações fluidas em tudo**: react-native-reanimated v4 + moti para micro-interações; `expo-haptics` em ações importantes.
- Dark mode completo (`userInterfaceStyle: automatic`), tipografia iOS (`ui-rounded`/`system-ui`), cantos generosos, profundidade e translucidez.
- Nunca entregar telas "cruas": toda tela nova nasce com estados de loading/vazio bonitos e transições.

## Decisões imutáveis (não trocar sem o usuário pedir)

- **WhatsApp:** Meta Cloud API **oficial** (nunca Baileys/não-oficial).
- **Backend:** **Supabase** (Postgres + Auth Phone OTP + Edge Functions + Realtime + pg_cron) — não Firebase.
- **IA:** **Google Gemini** (Flash p/ volume, Pro fallback, saída estruturada via `responseSchema`) — **não usar Claude API**.
- **Áudio (STT):** **Groq** (Whisper).
- **Observabilidade:** logs nativos do Supabase + tabelas `messages_raw`/`ai_events` — **sem Sentry** ou serviços externos.
- **Dinheiro:** sempre `amount_cents` inteiro (nunca float).
- **Custo ~zero no início:** respostas dentro da janela 24h do WhatsApp são grátis; lembretes proativos preferem push (Expo Notifications) e usam template Utility do WhatsApp só como complemento.

## Stack

| Camada | Escolha |
|---|---|
| App | Expo SDK 57 (managed) + expo-router + TypeScript, código em `src/` |
| Glass/Design | expo-glass-effect + expo-blur (fallback), NativeTabs (tab bar liquid glass) |
| Animações | react-native-reanimated v4, moti, expo-haptics |
| Estado | TanStack Query (servidor) + Zustand (local) |
| Forms | react-hook-form + zod |
| Backend | Supabase — migrations em `supabase/migrations/`, Edge Functions (Deno) em `supabase/functions/` |
| Auth | Supabase Auth **Phone OTP** (o telefone é a chave de vínculo com o WhatsApp) |

## Arquitetura (resumo)

```
WhatsApp → Meta → Edge Function whatsapp-webhook (valida HMAC, dedupe, grava messages_raw,
enfileira em jobs, responde 200 <5s) → process-jobs (Groq p/ áudio → Gemini classifica →
insere em notes/reminders/expenses → confirma no WhatsApp) → Realtime atualiza o app.
send-reminders (via pg_cron/agendador) dispara lembretes vencidos e recalcula next_run_at (RRULE + timezone).
```

- **RLS deny-by-default em todas as tabelas**; `service_role` só nas Edge Functions; app usa anon key + JWT.
- Segredos (Gemini, Groq, WhatsApp) só em secrets das functions — nunca no app ou no repo (`supabase/.env.example` documenta).
- Idempotência por `wa_message_id` único; rate limiting por telefone no webhook.

## Plano de arquitetura completo

`C:\Users\Maumis\.claude\plans\quero-desenvolver-um-projeto-dynamic-book.md` (aprovado pelo usuário).
