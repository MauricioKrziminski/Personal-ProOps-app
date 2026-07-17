# WhatsApp — Meta Cloud API oficial

**Decisão imutável: só a Meta Cloud API oficial. Nunca Baileys ou qualquer cliente não-oficial.** Graph API v21.0, helpers em `supabase/functions/_shared/whatsapp.ts` (`sendText`, `sendTemplate`, `sendAuthCode`, `downloadMedia`, `verifySignature`).

## Webhook (`whatsapp-webhook`)

- Responder **200 em <5s** sempre — processamento pesado vai para a fila `jobs` (o processamento roda no `process-jobs`, disparado fire-and-forget + cron por minuto).
- **HMAC obrigatório**: `verifySignature` (SHA-256 constant-time com `WHATSAPP_APP_SECRET`) sobre o raw body antes de qualquer parse. Assinatura inválida = 401.
- **Dedupe** por `messages_raw.wa_message_id` unique (erro 23505 = mensagem já vista → skip silencioso).
- Nunca propagar erro interno para a Meta (evita retry storm) — logar e responder 200.

## Custo (~zero no início)

- **Texto livre (`sendText`) só é grátis dentro da janela de 24h** após a última mensagem do usuário. Confirmações de itens criados sempre cabem na janela (são resposta imediata).
- Mensagem **proativa** (lembrete, resumo mensal) fora da janela = **template Utility pago** (`sendTemplate`, ex.: `proops_reminder`). Preferir **push (Expo Notifications)** como canal principal proativo; WhatsApp template só como complemento.
- OTP de login: template Authentication via `wa-send-otp` (Send SMS Hook do Supabase Auth).

## Envio best-effort

- Confirmações usam `trySend` (try/catch que só loga). **Falha de envio nunca reprocessa o job** — o dado já foi persistido e reprocessar duplicaria inserts.
- Telefones BR: casar profile com e sem o 9º dígito (`phoneCandidates` no process-jobs) — a Meta às vezes manda sem o 9.
