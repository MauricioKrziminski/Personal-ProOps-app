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

Erros de regra: **409** `{"error":"<codigo>","message":"<frase pt-BR para a tela>"}`. Entrada inválida: **422**
`{"error":"invalid_request","message":"Esse pedido não está no formato esperado."}` (também em `/internal/errors`).

Limite de taxa: `/admin/api/*` tem limite PRÓPRIO, por admin (`ADMIN_RATE_LIMIT_PER_MINUTE`, padrão 600; 0 desliga),
separado do geral do agente (`RATE_LIMIT_PER_MINUTE`). Estourou → **429**
`{"error":"rate_limited","message":"Muitas ações seguidas; tente em alguns segundos."}` com `Retry-After`.
O SPA repete leituras (GET) em 429 com recuo de 1 s, 2 s e 4 s.

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
`signal` (`trial_ending_48h|lapsed_7d|near_limit|inactive_subscribers_30d`: o MESMO critério SQL que conta `signals` no
`/overview` — `_SINAIS` em `admin.py` —, então o `total` da lista é o número do sinal),
`sort` (`created_desc` padrão, `created_asc`, `last_sign_in_desc`, `last_sign_in_asc`, `ai_used_desc`, `email_asc`),
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
                   "canceled_at": "iso|null", "store_managed": false,
                   "origin": "apple|google|manual|test_store|null"},
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
`months`: últimos 6, do mês mais novo ao mais antigo (a tela os ordena do mais antigo ao mais novo).
`subscription.provider` é o valor cru da tabela (`app_store`…); `subscription.origin` é o normalizado, igual ao `origin` da lista. `billing_events` e `admin_events`: últimos 50.

### Ações (todas `POST`, corpo JSON, resposta = o `GET /accounts/{user_id}` atualizado)
| rota | corpo | regra |
|---|---|---|
| `/accounts/{id}/plan` | `{"plan": "free|pro|family", "period_end": "date|null", "force": false}` | grava `provider='manual'`, `status='active'` (`free` → `canceled`). Assinatura de LOJA (`apple`/`google`) → 409 `store_managed` salvo `force: true` (o SPA exige digitar o e-mail; a próxima notificação da loja sobrescreve) |
| `/accounts/{id}/suspend` | `{"reason": "str"}` (até 300 caracteres, o mesmo limite do campo na tela) | `auth.users.banned_until` longe no futuro + apaga `auth.sessions`. O agente para de responder pelo WhatsApp (aviso 1x/dia) |
| `/accounts/{id}/reactivate` | `{}` | limpa `banned_until` |
| `/accounts/{id}/sign-out` | `{}` | apaga `auth.sessions` |
| `/accounts/{id}/password-reset` | `{}` | envia o código de recuperação (`/auth/v1/recover` com a anon key). Conta sem e-mail → 409 `no_email` (a tela desabilita a ação) |
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

## Observabilidade (erros agrupados, no padrão do ERP)

### Captura — `POST /internal/errors` (não é rota de admin)
Recebe erros do APP (React Native) e do PAINEL (SPA). O agente grava os PRÓPRIOS erros direto,
sem HTTP (`app/services/observabilidade.py`, best-effort: nunca derruba quem chamou).
- Auth: `Authorization: Bearer <JWT>` opcional (sem login também vale: erro da tela de entrar).
  Com JWT, `user_id` sai do `sub`; NUNCA do corpo.
- Limites: corpo ≤ 32 KB, até 20 erros por chamada, rate limit por IP e por usuário. Excesso → 429.
- Corpo: `{"errors": [{"source": "app"|"admin", "kind": "crash"|"error"|"unhandled_rejection"|"render",
  "name": str, "message": str, "stack": str|null, "route": str|null, "platform": "ios"|"android"|"web"|null,
  "app_version": str|null, "occurred_at": iso|null, "context": {…} }]}`. Resposta `202 {"accepted": n}`.
- O servidor MASCARA e-mail, CPF, CNPJ, telefone e números longos em `message`/`stack`/`context`
  (a mesma régua do Langfuse, `telemetry.py`), corta `stack` em 8 KB e `message` em 500 chars.
- Fingerprint = sha256(source + name + primeiros 3 frames normalizados, sem número de linha/coluna e
  sem query), ou de `name + message` normalizada (dígitos → `#`) quando não há stack.

### Admin — `GET /admin/api/issues`
Query: `status` (`open|resolved|ignored`, padrão `open`), `source` (`app|admin|agent`),
`severity` (`critical|error|warning`), `period` (`1h|24h|7d|30d`, padrão `7d`, filtra por `last_seen`),
`q` (título/mensagem/rota), `sort` (`last_seen_desc` padrão, `count_desc`, `users_desc`, `first_seen_desc`),
`page`, `page_size`.
```json
{"items": [Issue], "total": 0, "page": 1, "page_size": 25,
 "summary": {"open": 0, "events_24h": 0, "users_affected_24h": 0, "new_24h": 0,
             "by_source_24h": {"app": 0, "admin": 0, "agent": 0}}}
```
`Issue`: `{"id","fingerprint","source","kind","severity","title","message","route","status",
"first_seen","last_seen","count","users_affected","last_app_version","platforms":["ios"]}`.
Severidade: `critical` = crash/erro não tratado no agente que derrubou o turno ou 5xx; `error` = erro tratado
relevante; `warning` = o resto. Reabre sozinha (`resolved` → `open`) quando volta a acontecer depois de
resolvida; `ignored` continua ignorada mas conta.

### `GET /admin/api/issues/{id}`
```json
{"issue": Issue, "stack": str|null, "hourly_24h": [{"hour": iso, "count": 0}],
 "daily_30d": [{"day": "2026-10-09", "count": 0}],
 "events": [{"id","created_at","user_id","user_email","platform","app_version","route","message","context"}],
 "triage": [AuditEvent]}
```
`events`: últimos 50.

### `POST /admin/api/issues/{id}/status`
Corpo `{"status": "open"|"resolved"|"ignored"}`. Grava auditoria `issue_triaged` (payload com de/para).
Resposta: o detalhe atualizado.

`/admin/api/overview` ganha `"observability": {"open": 0, "events_24h": 0, "critical_open": 0}`.

Retenção: eventos 30 dias; issue resolvida ou ignorada sem evento há 90 dias sai.
