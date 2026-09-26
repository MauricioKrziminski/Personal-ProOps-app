---
description: Verificação ponta-a-ponta do pipeline WhatsApp → agente → banco → resposta
argument-hint: "[mensagem de teste opcional]"
---

Verifique o pipeline WhatsApp de ponta a ponta. Mensagem de teste sugerida: $ARGUMENTS (default: "gastei 45 no mercado").

Ambiente: staging, salvo pedido explícito do Gabriel (`CLAUDE.md`, *Banco e fila*).

## Com acesso ao banco

1. **Entrada**: a linha de `messages_queue` com o `wa_message_id` da mensagem — chegou uma vez só? `status` terminou em `done`? Se `failed`, ou parada em `pending`/`processing` com `retry_count` > 0, ler `last_error`.
2. **Confirmação**: toda escrita pede SIM (`agent.md`), então a primeira resposta é uma pergunta — há linha em `pending_actions` com `status = 'awaiting'` e o `summary` descreve o efeito certo? Depois do SIM, ela vai para `approved`.
3. **Execução**: `executed_actions` tem `(wa_message_id, action_index)` com `result_id` preenchido. Reserva sem `result_id` é execução que morreu no meio.
4. **IA**: a linha mais recente de `ai_events` do usuário com `channel = 'whatsapp'` (só existe quando o modelo foi chamado; saudação e SIM/NÃO não gravam) — o `result` bate com a intenção? Confiança baixa não troca de modelo, vira pergunta de confirmação. O trace por nó está no Langfuse.
5. **Persistência**: o item na tabela certa (`transactions`/`notes`/`reminders`/`goals`) com `workspace_id` e `user_id` corretos (em `transactions`, `source='whatsapp'`).
6. **Envio**: Cloud Logging do agente sem erro no envio da resposta (falha de envio é tolerada, mas deve estar logada, e nunca reprocessa a mensagem).

## Sem acesso ao banco

1. Local: o passo 6 de `.claude/rules/workflow.md` (agente no `docker compose` com o override sem envio, e `scripts/fake_meta.py` mandando payload assinado), acompanhando os logs.
2. Real: pedir para o Gabriel mandar a mensagem no WhatsApp e conferir se o item aparece no app via Realtime.

Reporte cada etapa com ✅/❌ e, para qualquer ❌, a causa raiz provável e o arquivo a corrigir.
