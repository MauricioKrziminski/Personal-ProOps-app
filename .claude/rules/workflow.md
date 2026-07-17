# Workflow — git, verificação e deploy

## Git

- Commits **conventional, 1 linha, sem corpo e SEM co-autor** (`feat(finance): ...`, `fix(webhook): ...`, `chore: ...`). Único autor: Gabriel.
- Branch por feature a partir de `main` (`<user>/<slug>`). Nunca commitar direto na `main`.
- Nunca commitar `.env*` (só `*.example`), `android/`, `ios/`.

## Antes de commitar

1. `npx tsc --noEmit` limpo.
2. `npx expo lint` limpo.
3. Mudou tela → conferir no device/emulador (dark E light) — nada de "deve funcionar".
4. Mudou Edge Function → testar com `npx supabase functions serve` + payload de exemplo antes do deploy.
5. Mudou schema → migration nova aplicada com `db push` + types regenerados.

## Deploy

- Edge Functions: `npx supabase functions deploy <nome>` (conferir `verify_jwt` em `supabase/config.toml` e secrets necessários — `supabase/.env.example` é a lista).
- App: builds via EAS (`eas.json`: development/preview/production).
- Fluxo WhatsApp ponta-a-ponta: usar o checklist do comando `/verify-whatsapp`.

## Observabilidade

- Debug do pipeline: `messages_raw` (entrada), `jobs` (fila/erros em `last_error`), `ai_events` (o que a IA entendeu, custo, confidence) + logs nativos das functions. Sem Sentry — não adicionar serviço externo.
