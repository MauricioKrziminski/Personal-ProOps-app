# Painel de admin — contrato da API (`/admin/api/*`)

Servido por um serviço PRÓPRIO do Cloud Run (`painel` / `painel-staging`, a mesma imagem do agente com
`SERVICO=admin`), atrás do IAP — `./scripts/setup-gcp.sh painel`. O agente público (`SERVICO=agente`) responde
**404** em toda rota `/admin*`. O SPA (`agent/admin-web/`, build copiado para `app/static/admin/` no Docker) fala só
com estas rotas. Guia de operação: `docs/PAINEL-ADMIN.md`.

## Autenticação

Três camadas, nesta ordem:

1. **IAP**: sem login Google de um e-mail da política do IAP a requisição nem chega ao container (302 para o login
   do Google; 401 em chamada de API).
2. **Asserção do IAP** conferida no container (`app/iap.py`, `main._fronteira`): `x-goog-iap-jwt-assertion` ES256 do
   Google, `aud` = `/projects/<n>/locations/<região>/services/<serviço>`, e-mail em `ADMIN_IAP_EMAILS`. Falhou →
   **403** `{"error":"forbidden"}`. `ADMIN_EXIGE_IAP=false` só no laptop; no Cloud Run o painel recusa subir sem ela.
3. **Supabase** (abaixo).

- Toda rota (menos `/admin/api/config`) exige `Authorization: Bearer <JWT do Supabase>`.
- `ADMIN_USER_IDS` vazio, ou o processo não é `SERVICO=admin` → toda rota `/admin*` responde **404**.
- Sem token / token inválido → **401** `{"error":"unauthorized"}`.
- `sub` fora da lista → **403** `{"error":"forbidden"}`.
- `ADMIN_REQUIRE_MFA` é **`true` por padrão** (variável ausente ou vazia = ligada; `setup-gcp.sh` RECUSA subir
  produção sem `true`). Ligada e o JWT sem `aal: "aal2"` → **403** `{"error":"mfa_required"}`. O SPA abre o
  fluxo de TOTP do supabase-js (`auth.mfa.enroll/challenge/verify`) e repete. Só o staging e o E2E local passam `false`.
- A sessão do Supabase no SPA mora no `sessionStorage` (fechou a aba, saiu).
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
  "signals": {"trial_ending_48h": 0, "lapsed_7d": 0, "near_limit": 0, "inactive_subscribers_30d": 0},
  "versions": [{"platform": "ios|android|web", "version": "1.4.2", "users": 0}]
}
```
`versions`: quem abriu o app nos últimos 30 dias (`profiles.last_seen_at`), por plataforma e versão, do mais usado ao menos.
`inactive_subscribers_30d`: assinante sem uso há 30 dias, lendo `coalesce(last_seen_at, last_sign_in_at)` (login não é uso).
`signups_by_month`: 12 meses, zerados inclusive. `ai_cost_by_day`: 30 dias, zerados inclusive.
`near_limit`: assinante com IA ou WhatsApp >= 80% do limite do mês. Dinheiro sempre texto decimal.

### `GET /admin/api/accounts`
Query: `q` (e-mail ou nome; com 4 ou mais dígitos em `q` também casa o TELEFONE, comparando só os dígitos dele),
`access` (`subscriber|trialing|lapsed|never|courtesy|suspended`),
`plan` (`free|pro|family`), `origin` (`apple|google|manual|test_store|none`),
`signal` (`trial_ending_48h|lapsed_7d|near_limit|inactive_subscribers_30d`: o MESMO critério SQL que conta `signals` no
`/overview` — `_SINAIS` em `admin.py` —, então o `total` da lista é o número do sinal),
`sort` (`created_desc` padrão, `created_asc`, `last_sign_in_desc`, `last_sign_in_asc`, `ai_used_desc`, `email_asc`,
`last_seen_desc`, `last_seen_asc`),
`page` (1..), `page_size` (padrão 25, máx 100). Paginação NO SERVIDOR.
`{"items": [AccountRow], "total": 0, "page": 1, "page_size": 25}`

`AccountRow`:
```json
{
  "user_id": "uuid", "workspace_id": "uuid|null", "email": "str", "name": "str|null",
  "created_at": "iso", "last_sign_in_at": "iso|null", "suspended": false,
  "plan": "free|pro|family", "status": "str", "access": "subscriber|never|lapsed",
  "is_trial": false, "period_end": "date|null", "origin": "apple|google|manual|test_store|null",
  "ai_used": 0, "ai_max": 0, "wa_used": 0, "wa_max": 0, "whatsapp_linked": false,
  "last_app_version": "str|null", "last_seen_at": "iso|null",
  "contact_ok": true
}
```

### `GET /admin/api/accounts.csv`
Os MESMOS filtros e a MESMA ordem de `/accounts` (`q`, `access`, `plan`, `origin`, `signal`, `sort`), sem paginação.
Mais de **10.000** linhas → **422** `{"error":"too_many_rows","message":…}` (nada é gravado). `text/csv; charset=utf-8`
com BOM, `Content-Disposition: attachment; filename="contas-AAAA-MM-DD.csv"`. Colunas: `user_id, email, name,
created_at, last_sign_in_at, last_seen_at, last_app_version, plan, status, access, is_trial, period_end, origin,
ai_used, ai_max, wa_used, wa_max, whatsapp_linked, suspended, contact_ok, whatsapp` (`contact_ok=false` = pediu
para não receber novidades e ofertas, e fica de fora de qualquer contato comercial; `whatsapp` = link `wa.me` só de quem
aceita contato e tem o WhatsApp vinculado, o telefone cru nunca sai). Texto que começa com `= + - @` ganha `'`
na frente (a planilha não executa como fórmula). Auditoria `accounts_exported` (`payload`: `filters` e `total`).

### `GET /admin/api/accounts/{user_id}`
```json
{
  "account": "AccountRow",
  "profile": {"phone": "str|null", "email_confirmed_at": "iso|null", "onboarding_completed": false,
              "banned_until": "iso|null", "sessions": 0,
              "terms_version": "str|null", "terms_accepted_at": "iso|null", "ai_consent_at": "iso|null",
              "marketing_opt_out_at": "iso|null",
              "last_app_version": "str|null", "last_app_platform": "ios|android|web|null",
              "last_seen_at": "iso|null", "push_tokens": 0, "notes_count": 0},
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
  "invites": [{"id": "uuid", "phone": "str", "status": "str", "created_at": "iso"}],
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
| `/accounts/{id}/invites/{invite_id}/revoke` | `{}` | a regra do app (`status = 'revoked'`); só convite PENDENTE do espaço desta conta: outro estado → 409 `invite_not_pending`, outro espaço → 404. Auditoria `invite_revoked` (só o id, sem o telefone do convidado) |
| `/accounts/{id}/members/{member_user_id}/remove` | `{}` | tira o membro do espaço da conta. O dono → 409 `cannot_remove_owner`; quem não é membro → 404. Auditoria `member_removed` |
| `/accounts/{id}/notify` | `{"title": "str ≤ 60", "body": "str ≤ 180"}` | push Expo para o aparelho da conta (serviço de push do agente). Sem aparelho → 409 `no_push_tokens`; Expo fora → 502 `push_failed` (sem auditoria). Resposta `{"sent": 1}` (não é o detalhe). Auditoria `push_sent` (só o título) |
| `/accounts/{id}/contact` | `{"channel": "whatsapp\|email"}` | contato comercial (Política §2-A): devolve `{"url": "https://wa.me/…?text=…"}` ou `{"url": "mailto:…"}` com uma saudação curta; a mensagem é escrita por quem clica. Quem desligou "Receber novidades e ofertas" → 409 `contact_opted_out`; sem WhatsApp vinculado ou sem e-mail → 409 `no_channel` (sem auditoria). Auditoria `contact_started` (`channel`). O painel só mostra "Entrar em contato" para `contact_ok` |

### Notas internas — `GET|POST /accounts/{id}/notes`, `DELETE /accounts/{id}/notes/{note_id}`
Nota livre do time sobre a conta (`public.admin_account_notes`, inacessível ao app; some junto com a conta).
`GET` → `{"items": [{"id","body","created_at","admin_user_id","admin_email"}]}`, mais recente primeiro.
`POST {"body": "1..2000 caracteres (espaços das pontas saem)"}` → a nota criada. `DELETE` → `{"deleted": true}`
(nota de outra conta → 404). Auditorias `note_added` e `note_deleted` guardam só o `note_id`, nunca o texto.

### Configuração do app — `GET|PUT /app-config`
Linha única `public.app_config` (o app a lê pelo Supabase, anon): versão mínima/recomendada por plataforma, link da
loja e aviso. `GET` → os 10 campos + `updated_at` + `updated_by`:
`min_version_ios|android` (bloqueio), `latest_version_ios|android` (aviso dispensável), `store_url_ios` (só `https://apps.apple.com/` ou `https://itunes.apple.com/`), `store_url_android` (só `https://play.google.com/`),
`notice_title` (≤ 120), `notice_body` (≤ 1000), `notice_level` (`info|warning|critical`), `notice_until` (iso; `null` = sem prazo).
`PUT` com os 10 campos (substitui; campo ausente ou texto vazio vira `null`; `updated_at`/`updated_by` no corpo são ignorados).
Versão `MAJOR.MINOR.PATCH`, URL de loja nos hosts acima, nível da lista; fora disso 422. Sem nenhuma mudança não grava nem audita.
Auditoria `app_config_changed` (`payload.changes`: `{campo: {"from","to"}}`).

### `GET /admin/api/audit`
Query: `action`, `admin_user_id`, `target_user_id`, `page`, `page_size`.
`{"items": [AuditEvent], "total": 0, "page": 1, "page_size": 50}`
`AuditEvent`: `{"id","created_at","action","admin_user_id","admin_email","target_user_id","target_email","payload"}`.
`action`: `plan_changed`, `plan_forced`, `suspended`, `reactivated`, `signed_out`, `password_reset_sent`,
`whatsapp_unlinked`, `account_deleted`, `accounts_exported`, `note_added`, `note_deleted`, `invite_revoked`,
`member_removed`, `push_sent`, `app_config_changed`.

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


## Fora do painel: exportar os dados da pessoa (LGPD)

`GET /internal/export` (JWT do APP, não é rota de admin): JSON com o perfil dela (sem o token de push) e os dados dos espaços de que
é membro, lidos SOB RLS como ela (sai o que o app mostra a ela, nada que a policy esconde num espaço compartilhado), mais o texto que mandou pelo WhatsApp (`Content-Disposition: attachment; filename="proops-dados-AAAA-MM-DD.json"`), no máximo 3 por hora por
usuário (429 `{"error":"rate_limited"}`). Para quem não tem o app: `agent/scripts/exportar_dados.py <user_id>`. **O painel
NÃO exporta dado financeiro.** O que fica de fora (fila e execução do agente, billing, telemetria) está em
`app/services/exportar_dados.py`.

## Consentimento de IA

`AI_CONSENT_REQUIRED` (padrão `false`; staging liga). Ligada e sem `profiles.ai_consent_at`, `conversation.check_limits`
recusa antes de qualquer modelo: rotas do app (chat, voz `/internal/finance/draft`, transcrição de áudio) →
**403** `{"error":"ai_consent_required"}`; WhatsApp → um aviso por dia (`alerts_sent`, kind `sem_consentimento_ia`) e nada
em `ai_events`; a importação de extrato segue, só sem categoria/natureza/julgamento por IA.
