# Painel de admin — contrato da API (`/admin/api/*`)

Servido pelo agente. O SPA (`agent/admin-web/`, build copiado para `app/static/admin/` no Docker) fala só com estas rotas.

## Autenticação

- Toda rota (menos `/admin/api/config`) exige `Authorization: Bearer <JWT do Supabase>`.
- `ADMIN_USER_IDS` vazio → toda rota `/admin*` responde **404**.
- Sem token / token inválido → **401** `{"error":"unauthorized"}`.
- `sub` fora da lista → **403** `{"error":"forbidden"}`.
- `ADMIN_REQUIRE_MFA=true` e o JWT sem `aal: "aal2"` → **403** `{"error":"mfa_required"}`. O SPA abre o
  fluxo de TOTP do supabase-js (`auth.mfa.enroll/challenge/verify`) e repete.
- Toda escrita grava em `public.admin_audit_events` na MESMA transação.
- Nenhuma resposta traz conteúdo financeiro (lançamentos, valores, saldos, notas, lembretes): só
  cadastro, assinatura, uso e CONTAGENS.

Erros de regra: **409** `{"error":"<codigo>","message":"<frase pt-BR para a tela>"}`. Entrada inválida: **422**.

## Rotas

### `GET /admin/api/config` (sem auth)
`{"supabase_url": str, "supabase_anon_key": str, "revenuecat_dashboard_url": str}`

### `GET /admin/api/me`
`{"user_id": uuid, "email": str, "aal": "aal1"|"aal2", "mfa_required": bool}`

### `GET /admin/api/overview`
```json
{
  "accounts": {"total": 0, "new_7d": 0, "new_30d": 0},
  "access": {"subscriber": 0, "trialing": 0, "lapsed": 0, "never": 0, "courtesy": 0, "suspended": 0},
  "plans": {"pro": 0, "family": 0},
  "usage_month": {"ai_turns": 0, "whatsapp_replies": 0, "notices": 0, "ai_cost_usd": "0.00"},
  "signups_by_month": [{"month": "2026-10", "count": 0}],
  "ai_cost_by_day": [{"day": "2026-10-09", "usd": "0.0000"}],
  "signals": {"trial_ending_48h": 0, "lapsed_7d": 0, "near_limit": 0, "inactive_subscribers_30d": 0}
}
```
`signups_by_month`: 12 meses, zerados inclusive. `ai_cost_by_day`: 30 dias, zerados inclusive.
`near_limit`: assinante com IA ou WhatsApp >= 80% do limite do mês. Dinheiro sempre texto decimal.

### `GET /admin/api/accounts`
Query: `q` (e-mail ou nome), `access` (`subscriber|trialing|lapsed|never|courtesy|suspended`),
`plan` (`free|pro|family`), `origin` (`apple|google|manual|test_store|none`),
`sort` (`created_desc` padrão, `created_asc`, `last_sign_in_desc`, `ai_used_desc`, `email_asc`),
`page` (1..), `page_size` (padrão 25, máx 100). Paginação NO SERVIDOR.
`{"items": [AccountRow], "total": 0, "page": 1, "page_size": 25}`

`AccountRow`:
```json
{
  "user_id": "uuid", "workspace_id": "uuid|null", "email": "str", "name": "str|null",
  "created_at": "iso", "last_sign_in_at": "iso|null", "suspended": false,
  "plan": "free|pro|family", "status": "str", "access": "subscriber|never|lapsed",
  "is_trial": false, "period_end": "date|null", "origin": "apple|google|manual|test_store|null",
  "ai_used": 0, "ai_max": 0, "wa_used": 0, "wa_max": 0, "whatsapp_linked": false
}
```

### `GET /admin/api/accounts/{user_id}`
```json
{
  "account": "AccountRow",
  "profile": {"phone": "str|null", "email_confirmed_at": "iso|null", "onboarding_completed": false,
              "banned_until": "iso|null", "sessions": 0},
  "subscription": {"plan": "", "status": "", "provider": "", "external_id": "", "product_id": "",
                   "environment": "", "is_trial": false, "current_period_end": "date|null",
                   "canceled_at": "iso|null", "store_managed": false},
  "usage": {"current": {"ai_used": 0, "ai_max": 0, "wa_used": 0, "wa_max": 0, "notices_today": 0,
                        "notices_max": 0, "ai_cost_usd": "0.0000"},
            "months": [{"month": "2026-10", "ai_turns": 0, "whatsapp_replies": 0, "ai_cost_usd": "0.0000"}]},
  "counts": {"transactions": 0, "accounts": 0, "cards": 0, "notes": 0, "reminders": 0, "goals": 0,
             "debts": 0, "recurring": 0},
  "members": [{"user_id": "uuid", "email": "str", "name": "str|null", "role": "owner|member"}],
  "invites": [{"phone": "str", "status": "str", "created_at": "iso"}],
  "billing_events": [{"id": "", "type": "", "result": "", "created_at": "iso"}],
  "admin_events": ["AuditEvent"]
}
```
`months`: últimos 6. `billing_events` e `admin_events`: últimos 50.

### Ações (todas `POST`, corpo JSON, resposta = o `GET /accounts/{user_id}` atualizado)
| rota | corpo | regra |
|---|---|---|
| `/accounts/{id}/plan` | `{"plan": "free|pro|family", "period_end": "date|null", "force": false}` | grava `provider='manual'`, `status='active'` (`free` → `canceled`). Assinatura de LOJA (`apple`/`google`) → 409 `store_managed` salvo `force: true` (o SPA exige digitar o e-mail; a próxima notificação da loja sobrescreve) |
| `/accounts/{id}/suspend` | `{"reason": "str"}` | `auth.users.banned_until` longe no futuro + apaga `auth.sessions`. O agente para de responder pelo WhatsApp (aviso 1x/dia) |
| `/accounts/{id}/reactivate` | `{}` | limpa `banned_until` |
| `/accounts/{id}/sign-out` | `{}` | apaga `auth.sessions` |
| `/accounts/{id}/password-reset` | `{}` | envia o código de recuperação (`/auth/v1/recover` com a anon key) |
| `/accounts/{id}/unlink-whatsapp` | `{}` | `profiles.phone = null` e a sessão do WhatsApp sai |
| `/accounts/{id}/delete` | `{"confirm_email": "str"}` | `confirm_email` igual ao da conta, sem caixa; apaga como `delete_my_account`. Resposta `{"deleted": true}` |

### `GET /admin/api/audit`
Query: `action`, `admin_user_id`, `target_user_id`, `page`, `page_size`.
`{"items": [AuditEvent], "total": 0, "page": 1, "page_size": 50}`
`AuditEvent`: `{"id","created_at","action","admin_user_id","admin_email","target_user_id","target_email","payload"}`.
`action`: `plan_changed`, `plan_forced`, `suspended`, `reactivated`, `signed_out`, `password_reset_sent`,
`whatsapp_unlinked`, `account_deleted`.

### `GET /admin/api/billing-events`
Query: `q` (app_user_id ou e-mail), `type`, `result`, `page`, `page_size`.
`{"items": [{"id","created_at","type","provider","result","app_user_id","email","product_id","environment"}], "total", "page", "page_size"}`

### `GET /admin/api/system`
```json
{"queue": {"pending": 0, "processing": 0, "failed_24h": 0, "oldest_pending_seconds": 0},
 "recent_failures": [{"created_at": "iso", "status": "str", "last_error": "até 200 chars, sem texto do usuário"}],
 "ai_cost": {"last_24h_usd": "0.0000", "last_7d_usd": "0.0000"},
 "whatsapp_month": {"replies": 0, "notices": 0}}
```
