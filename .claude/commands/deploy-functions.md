---
description: Deploy de Edge Function(s) do Supabase com checagem de config e secrets
argument-hint: "[nome-da-function | vazio = todas]"
---

Faça o deploy de Edge Functions do projeto seguindo `.claude/rules/supabase.md`:

1. Se `$ARGUMENTS` nomeia uma function, deployar só ela; vazio = perguntar se é para deployar todas (`whatsapp-webhook`, `process-jobs`, `send-reminders`, `wa-send-otp`).
2. Antes do deploy:
   - Conferir `verify_jwt` da function em `supabase/config.toml` (webhooks externos = false; internas de cron = true) e avisar se estiver incoerente.
   - Listar os secrets que a function usa (grep por `Deno.env.get` no código dela) e conferir contra `supabase/.env.example`. Se houver secret novo não documentado, adicionar ao `.env.example` e lembrar de rodar `npx supabase secrets set`.
   - Se a mudança for em `_shared/`, avisar que TODAS as functions que importam o módulo precisam de redeploy e incluí-las.
3. Deploy: `npx supabase functions deploy <nome>`.
4. Depois: conferir logs (`npx supabase functions logs <nome>` ou MCP `get_logs`) por erro de boot, e sugerir `/verify-whatsapp` se a function fizer parte do pipeline de mensagens.
