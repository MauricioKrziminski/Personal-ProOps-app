# WhatsApp — Meta Cloud API oficial

**Decisão imutável: só a Meta Cloud API oficial. Nunca Baileys ou qualquer cliente não-oficial.**
Graph API v21.0, helpers em `agent/app/services/whatsapp.py` (`send_text`, `send_template`,
`send_auth_code`, `download_media`, `try_send`) e assinatura em `agent/app/security.py`.
`_shared/whatsapp.ts` é legado.

## Webhook (`POST /whatsapp-inbound`)

- Responder **200 em <5s** sempre (alvo: <50ms). Só três coisas acontecem ali: valida HMAC, grava
  em `messages_queue`, agenda o debounce. Qualquer trabalho a mais é risco de reentrega, e
  reentrega multiplicada por processamento pesado é como um webhook vira tempestade.
- **HMAC obrigatório**: `verify_meta_signature` (SHA-256 constant-time com `WHATSAPP_APP_SECRET`)
  sobre o corpo CRU, antes de qualquer parse. Assinatura inválida = 401. Vale também para o corpo
  repassado pelo roteador Strangler: o Python **revalida**, não confia no Deno.
- **Dedupe** por `messages_queue.wa_message_id` unique, no MESMO insert que enfileira. Eram dois
  inserts sem transação, e a falha do segundo fazia a mensagem sumir para sempre.
- Nunca propagar erro interno para a Meta (evita retry storm) — logar e responder 200. **A exceção
  é o roteador Strangler**: repasse que falha devolve não-200 DE PROPÓSITO, para a Meta reentregar.
- **Debounce de 3s pelo Cloud Tasks**, nunca timer em memória: mensagens picotadas viram UM lote e
  UMA resposta, e o container continua podendo dormir.

## Custo

- **Texto livre (`send_text`) só é grátis dentro da janela de 24h** após a última mensagem do usuário. Confirmações de itens criados sempre cabem na janela (são resposta imediata).
- Mensagem **proativa** (lembrete, resumo mensal) fora da janela = **template Utility pago** (`send_template`, nome em `WA_REMINDER_TEMPLATE`). Preferir **push (Expo Notifications)** como canal principal proativo; WhatsApp template só como complemento.
- OTP de login: template Authentication via `POST /hooks/otp` (Send SMS Hook do Supabase Auth), nome em `WA_OTP_TEMPLATE`.
- **Nomes de template sempre em env var** (`WA_OTP_TEMPLATE`, `WA_REMINDER_TEMPLATE`), nunca hardcoded: templates são objetos POR WABA, então trocar de WABA (teste → produção) significa recriar com o mesmo nome e não tocar em código. Usar templates próprios deste produto (prefixo `personal_proops_`) — não pendurar em templates do ERP, que vivem na mesma WABA de teste e podem ser editados por outra equipe.

## Envio best-effort

- Confirmações usam `try_send` (try/except que só loga). **Falha de envio nunca reprocessa a
  mensagem** — o dado já foi persistido e reprocessar duplicaria escrita.
- Telefones BR: casar profile com e sem o 9º dígito (`app/domain/phone.py`) — a Meta às vezes manda
  sem o 9. O `thread_id` sai da forma **canônica** (sempre com o 9): se ele mudasse no meio da
  conversa, uma confirmação pendente ficaria órfã e o "sim" do usuário cairia no vazio.
