# E2E do painel de admin (100% local)

Clica na UI de verdade (Playwright, Chromium) contra um ambiente que nunca sai de localhost.

```
scripts/e2e-painel.sh                 # sobe tudo, semeia, roda as 2 fases (~9 min) e deixa o ambiente de pé
scripts/e2e-painel.sh --no-build      # reaproveita o build do SPA já copiado
scripts/e2e-painel.sh --up [--mfa]    # só sobe/semeia (agente sem/com ADMIN_REQUIRE_MFA); rode o Playwright à mão
scripts/e2e-painel.sh -- -g Auditoria --project=desktop
scripts/e2e-painel-down.sh [--purge]  # derruba agente + Supabase local (--purge apaga o volume)
cd agent/admin-web && npm run e2e     # com o ambiente de pé; relatório: npx playwright show-report e2e/.report
```

Pré-requisitos: Docker, `agent/.venv`, Node, `npx playwright install chromium`.

## O que sobe
- **Supabase local** do projeto `proops-e2e` (`scripts/e2e/supabase/config.toml`, via `--workdir`): volume próprio, não toca no `app-proops` nem em remoto. MFA TOTP ligado, template de recuperação com `{{ .Token }}`, Mailpit em `http://127.0.0.1:54324`. As migrations são aplicadas pelo script, uma a uma via `psql` no container (a 0008 pede segredos no Vault; ele os cria), com controle em `public._e2e_migrations`.
- **Seed**: `scripts/e2e-seed.py` apaga as contas e2e da rodada anterior (`private.apagar_conta`), recria 52 contas pela API admin do GoTrue com **senhas novas** e roda `supabase/seed-e2e.sql` (a tabela de cenários e os números esperados estão no cabeçalho dele e em `agent/admin-web/e2e/seed-data.ts`). Saída: `scripts/e2e/.e2e-config.json` (gitignored; senhas, ids, chaves locais).
- **Agente** em `127.0.0.1:8095`, com `env -i` (nada do shell nem de `agent/.env`, que é staging), `DATABASE_URL` local, `RATE_LIMIT_PER_MINUTE=0`, WhatsApp com token inválido e `HTTPS_PROXY` morto (o envio falha sem sair do Mac). Serve o SPA buildado copiado para `agent/app/static/admin`.
- `support.ts` recusa rodar se algum endereço não for localhost.

## Fases
1. Sem MFA: projeto `mobile` (390x844, só specs de leitura, roda ANTES para ver o seed intacto) e `desktop` (1440, tudo). Ordem dos arquivos importa (1 worker).
2. `ADMIN_REQUIRE_MFA=true`: só os `@mfa` (`10-mfa`), com o admin `admin-mfa` e TOTP calculado no teste (RFC 6238).

Defeito novo conhecido entra como `test.fail()` com o código D#: o teste passa enquanto o defeito existe e **falha quando for corrigido** (remova o `test.fail`).

## Defeitos registrados (todos corrigidos)
Os `test.fail()` foram removidos; cada correção tem asserção própria na bateria.
| id | defeito | correção | prova |
|---|---|---|---|
| D1 | sinais da Visão geral abriam lista com mais contas que o número | `GET /accounts?signal=` com o MESMO SQL do overview (`_SINAIS` em `admin.py`, usado pelos dois); links da Visão geral usam `signal=`; chip "Sinal: … (limpar)" em Contas | `02`: número do sinal = total da lista (UI e API), chip limpa |
| D2 | CSP sem `font-src` bloqueava a fonte embutida (`data:`) | `font-src 'self' data:` em `admin_web.py:_csp` (a fonte é inlinada pelo Vite) | `07`: zero erro de console/CSP em todas as páginas |
| D3 | motivo: UI 300 × API 200 | um limite só: `MOTIVO_MAX = 300` (API) e `MOTIVO_MAX` na UI, com contador `n/300` | `04`: 350 digitados cortam em 300 e gravam; 301 na API = 422 |
| D4 | rate limit (120/min) derrubava a abertura do painel | limite próprio por admin em `/admin/api` (`ADMIN_RATE_LIMIT_PER_MINUTE`, 600), no `current_user`; 429 vira `{"error":"rate_limited","message":…}`; SPA repete GET com recuo (1/2/4 s) e mostra "Muitas ações seguidas; tente em alguns segundos." | `07`: 429 em `/me` no login é repetido e abre; 429 persistente mostra a frase; rajada de 40 chamadas passa |
| D5 | ficha mostrava `app_store` | detalhe devolve `subscription.origin` normalizado (igual à lista); UI usa o mesmo rótulo | `04`: "App Store" e origem do detalhe = origem da lista |
| D6 | gráfico de uso com meses ao contrário | a tela ordena os meses (mais antigo à esquerda) | `04`: rótulos do eixo em ordem cronológica |
| D7 | máscara rotulava telefone como `[cpf]` | `telemetry.py`: telefone antes do CPF sem pontuação (ambos têm 11 dígitos; o telefone exige o 9 na 3ª posição) | pytest com formatos BR (DDI, parênteses, sem formatação) e `08` |
| D8 | conta sem e-mail oferecia "Enviar código de senha" e dava 502 | API: 409 `no_email`; menu: item desabilitado com "(conta sem e-mail)" | `04`: item `aria-disabled`, 409 sem auditoria |
| D9 | toasts empilhados cobriam o título da gaveta | toasts embaixo (direita no desktop, centro no celular), um visível por vez, id fixo no "Erro resolvido/reaberto" | `08`: um toast, fora do cabeçalho da gaveta, "Desfazer" clicado sem `dispatchEvent` |
| extra | 422 devolvia `{"code"}` | `/admin/api/*` e `/internal/errors` devolvem `{"error":"invalid_request","message":…}` | pytest |

## Não coberto
Fluxo real de compra/RevenueCat, push, importação de extrato, envio real de WhatsApp (falha de propósito), WebKit/Safari (o "mobile" é Chromium com a tela e o toque de iPhone), reativar conta e mandar WhatsApp (chamaria o modelo), 429 REAL do painel (o ambiente roda com o limite próprio de 600/min; o 429 é simulado por `page.route`), retenção/limpeza de erros (90 dias), visão de erros do próprio agente (source=agent).
