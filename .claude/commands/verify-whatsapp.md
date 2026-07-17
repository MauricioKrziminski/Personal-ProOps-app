---
description: Verificação ponta-a-ponta do pipeline WhatsApp → IA → banco → confirmação
argument-hint: "[mensagem de teste opcional]"
---

Verifique o pipeline WhatsApp de ponta a ponta. Mensagem de teste sugerida: $ARGUMENTS (default: "gastei 45 no mercado").

## Com acesso ao banco (MCP Supabase ou CLI linkado)

1. **Entrada**: última linha de `messages_raw` (direction=inbound) — chegou? `wa_message_id` preenchido?
2. **Fila**: job correspondente em `jobs` — `status` deve terminar `done`. Se `failed`/`pending` com attempts>1, ler `last_error`.
3. **IA**: linha em `ai_events` — `model` usado, `confidence`, e o `result` jsonb bate com a intenção da mensagem? Se confidence < 0.6, confirmar que houve segunda linha com o Pro.
4. **Persistência**: item criado na tabela certa (`transactions`/`notes`/`reminders`/`goals`) com `source='whatsapp'` e `user_id` correto.
5. **Confirmação**: logs da function `process-jobs` sem erro de `sendText` (falha de envio é tolerada, mas deve estar logada).
6. **Cron**: `select * from cron.job` — `process-jobs` e `send-reminders` agendados e com última execução recente (`cron.job_run_details`).

## Sem acesso ao banco

1. `npx supabase functions serve` local + POST de payload de webhook simulado (montar o JSON da Meta com a mensagem de teste; assinar com `WHATSAPP_APP_SECRET` local) e acompanhar os logs.
2. Alternativa real: pedir para o usuário mandar a mensagem no WhatsApp e conferir se o item aparece no app via Realtime.

Reporte cada etapa com ✅/❌ e, para qualquer ❌, a causa raiz provável e o arquivo a corrigir.
