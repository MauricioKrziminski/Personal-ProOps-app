# Personal ProOps — agente (FastAPI + LangGraph)

Serviço Python que substitui as Edge Functions `whatsapp-webhook` e `process-jobs`
(e, na Fase 4, as demais). O Supabase segue sendo o Postgres — nada mais.

## Como as peças se encaixam

```
Meta ──► POST /whatsapp-inbound        valida HMAC, grava em messages_queue,
                                        agenda a task de debounce, 200 em <50ms
             │
   Cloud Tasks (schedule_time = +3s, OIDC)
             │
         POST /worker/process-thread    lock por thread, claim do LOTE,
                                        LangGraph, resposta única no WhatsApp
             │
       Supabase Postgres (fila, dados, checkpoints em schema `langgraph`)
```

O debounce nunca dorme em memória: quem espera os 3 segundos é o Cloud Tasks, e o
container pode ser desligado no meio (`min-instances=0`).

## Rodar local

```bash
cp .env.example .env          # preencher; DEBOUNCE_BACKEND=inline no local
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/uvicorn app.main:app --reload --port 8080

# testes (não tocam rede nem banco)
.venv/bin/pytest

# webhook assinado de verdade
export WHATSAPP_APP_SECRET=...
python scripts/fake_meta.py "gastei 45 no mercado"
python scripts/fake_meta.py --burst "mercado 45" "uber 30"   # testa o debounce
```

Para receber da Meta em dev: `cloudflared tunnel --url http://localhost:8080`.

## Deploy (Cloud Run)

Tudo automatizado em `scripts/setup-gcp.sh` (na raiz do repo). Idempotente:
rodar de novo não quebra nada.

```bash
cp agent/.env.example agent/.env    # preencher com os valores reais
./scripts/setup-gcp.sh              # projeto, APIs, SA, segredos, fila, deploy, crons
./scripts/setup-gcp.sh deploy       # só redeploy depois de mexer no código
./scripts/setup-gcp.sh secrets      # só regravar segredos
```

O script imprime a URL do serviço no fim — é ela que vai no webhook da Meta.

**Por que `--allow-unauthenticated`:** a Meta não manda token OIDC. Por isso cada
rota carrega a própria autenticação — HMAC no webhook, OIDC verificado em
`/worker` e `/cron`, standardwebhooks no OTP, segredo constante-time no billing.

**Por que `--concurrency 80`:** o trabalho é I/O (Postgres, Gemini, Graph API) e o
event loop aguenta. Menos multiplicaria container e conexão de banco à toa; muito
mais estrangularia o pool de 4 conexões.

## Validações de Dia 1

```bash
# os schemas passam no Gemini de verdade? (3 chamadas do Flash-Lite)
export GEMINI_API_KEY=...
.venv/bin/python scripts/validate_gemini_schemas.py
.venv/bin/python scripts/validate_gemini_schemas.py --probe   # acha o teto real

# as migrations 0040/0041 se comportam num Postgres de verdade?
npx supabase start
docker exec -i supabase_db_app-proops psql -U postgres -d postgres \
  -v ON_ERROR_STOP=1 -f - < ../supabase/tests/agent_migrations.sql
```

## Portar para VPS

`docker compose up` com `DEBOUNCE_BACKEND=inline` e `INTERNAL_SECRET` preenchido.
O `require_internal` aceita o header `X-Internal-Secret` quando não há OIDC, e é
só isso que muda — nenhuma lógica de negócio conhece o Cloud Run.

## Onde ficam as decisões

| Assunto | Arquivo |
|---|---|
| O que exige confirmação humana | `app/graph/policy.py` |
| Validação antes do banco | `app/tools/guards.py` |
| Envelope anti-injection | `app/security.py` (`wrap_untrusted`) |
| Modelos do Gemini (fixados) | `app/services/gemini.py` |
| Mapa ação -> função | `app/tools/registry.py` |
| Prompts por domínio | `app/graph/prompts.py` |

## O que ainda NÃO foi feito

- Fase 5: reescrever `CLAUDE.md` e `.claude/rules/*` (hoje eles descrevem a
  arquitetura antiga e dizem que ela é imutável).
- Rotacionar a anon key exposta na migration `0003`.
- Validar em produção o teto de 15 propriedades por schema pelo caminho do
  `with_structured_output` (o teste `test_schemas.py` prende o limite, mas quem
  mediu o 400 foi o `responseSchema` cru).
