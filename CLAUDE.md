@AGENTS.md

# Personal ProOps app

> **Nomenclatura:** este repositório **não é "o ProOps"**. ProOps é o produto/marca maior; este é um **aplicativo pessoal que faz parte do produto ProOps**. Enquanto não houver nome definitivo, usar o nome genérico **"Personal ProOps app"** (em código, docs e UI).

App mobile pessoal de **notas rápidas, lembretes e controle financeiro operado via WhatsApp**. O usuário manda mensagens em linguagem natural ("gastei 45 no mercado", "recebi 500 de freela", "me lembra de pagar aluguel todo dia 5", "quanto gastei esse mês?") e a IA cria/consulta **notas, lembretes e o financeiro completo** (transações, contas, metas, orçamentos), que aparecem organizados no app em tempo real. Lembretes são disparados de volta (push e/ou WhatsApp).

## Decisões imutáveis (não trocar sem o usuário pedir)

- **WhatsApp:** Meta Cloud API **oficial** (nunca Baileys/não-oficial).
- **Backend:** **Supabase** (Postgres + Auth Phone OTP + Edge Functions + Realtime + pg_cron) — não Firebase.
- **IA:** **Google Gemini** (Flash p/ volume, Pro fallback, saída estruturada via `responseSchema`) — **não usar Claude API**.
- **Áudio (STT):** **Groq** (Whisper).
- **Observabilidade:** logs nativos do Supabase + tabelas `messages_raw`/`ai_events` — **sem Sentry** ou serviços externos.
- **Dinheiro:** sempre `amount_cents` inteiro (nunca float).
- **Custo ~zero no início:** respostas na janela 24h do WhatsApp são grátis; proativo prefere push (Expo) e usa template Utility só como complemento.

## Stack

| Camada | Escolha |
|---|---|
| App | Expo SDK 57 (managed) + expo-router + TypeScript, código em `src/` |
| Glass/Design | expo-glass-effect + expo-blur (fallback), NativeTabs (tab bar liquid glass) |
| Animações | react-native-reanimated v4, moti, expo-haptics |
| Estado | TanStack Query (servidor) + useState local |
| Forms | react-hook-form + zod |
| Gráficos | barras custom com Views (consistentes com o design glass) |
| Backend | Supabase — migrations em `supabase/migrations/`, Edge Functions (Deno) em `supabase/functions/` |
| Auth | Supabase Auth **Phone OTP** (o telefone é a chave de vínculo com o WhatsApp) |

## Arquitetura (resumo)

```
WhatsApp → Meta → Edge Function whatsapp-webhook (valida HMAC, dedupe, grava messages_raw,
enfileira em jobs, responde 200 <5s) → process-jobs (Groq p/ áudio → Gemini gera ações
multi-intent → executa creates/queries/undo → confirma no WhatsApp em 1 mensagem) →
Realtime atualiza o app. send-reminders (pg_cron por minuto) dispara lembretes vencidos
(RRULE + timezone) e materializa transações recorrentes.
```

- **RLS deny-by-default em todas as tabelas**; `service_role` só nas Edge Functions; app usa anon key + JWT.
- Segredos só em secrets das functions (`supabase/.env.example` documenta) — nunca no app ou no repo.
- Idempotência por `wa_message_id` único; rate limiting por usuário antes do Gemini.

## Regras detalhadas (obrigatórias)

@.claude/rules/design.md
@.claude/rules/frontend.md
@.claude/rules/supabase.md
@.claude/rules/ai-gemini.md
@.claude/rules/whatsapp.md
@.claude/rules/finance.md
@.claude/rules/workflow.md

## Plano de desenvolvimento vigente

Roadmap por fases (backend → IA → frontend → v2) em `C:\Users\Gabriel\.claude\plans\seguinte-tenho-esse-projeto-logical-nova.md`.
