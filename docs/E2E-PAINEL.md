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

Defeitos já conhecidos estão como `test.fail()` com o código D#: o teste passa enquanto o defeito existe e **falha quando for corrigido** (remova o `test.fail`).

## Defeitos registrados (não corrigidos aqui)
| id | onde | reprodução | esperado × obtido |
|---|---|---|---|
| D1 | `agent/admin-web/src/pages/overview.tsx` (Signals) × `agent/app/routes/admin.py` (overview) | Visão geral → clicar em "Teste acaba em 48 h" (1), "Encerradas nos últimos 7 dias" (1), "Perto do limite do mês" (2), "Assinantes sem acesso há 30 dias" (1) | lista com o mesmo nº do sinal × lista só filtrada por acesso/ordem: 2, 2, 4, 4 contas. O sinal usa critério mais estreito (data/limite/inatividade) que o link |
| D2 | `admin_web.py:_csp` | abrir qualquer página e ver o console | fonte Plus Jakarta carrega × `Loading the font 'data:font/woff2…' violates CSP default-src 'self'` (falta `font-src 'self' data:`), repetido em toda página |
| D3 | `account-actions.tsx` (Textarea `maxLength=300`) × `admin.py` `SuspenderIn.reason` (`max_length=200`) | Suspender com motivo de 250 caracteres | suspende × 422 "Esse pedido não está no formato esperado." |
| D4 | `ratelimit` (120/min por usuário) × SPA | usar o painel intenso/vários carregamentos (3 telas abrem ~8 chamadas) | aviso de limite × tela "Não foi possível abrir o painel / Não foi possível concluir" (429 sem mensagem própria; derrubou o login nos testes até desligar o limite no ambiente) |
| D5 | `account-detail.tsx` Subscription / AuditRow | ficha de conta de loja | "Origem: App Store" × "Origem: app_store" (provider cru, `ORIGIN_LABEL` só conhece apple/google) |
| D6 | `account-detail.tsx` Usage (gráfico) | ficha com uso | meses em ordem cronológica × eixo "out/26, set/26, ago/26, jul/26…" (a API manda `months` do mais novo ao mais antigo e o gráfico não inverte) |
| D7 | PII mask do `/internal/errors` | enviar message com telefone `11988887777` | rótulo neutro × `[cpf]` para telefone (e CPF) — só cosmético |
| D8 | `account-actions.tsx` | conta sem e-mail → "Enviar código de senha" | ação indisponível × oferece, confirma e falha com 502 "Não consegui enviar o código" |
| D9 | toasts empilhados sobre a gaveta de erro | resolver e reabrir seguidos | toast do "Desfazer" fora do drawer × cobre o título da gaveta; dois "Desfazer" empilhados dificultam o clique |

## Não coberto
Fluxo real de compra/RevenueCat, push, importação de extrato, envio real de WhatsApp (falha de propósito), WebKit/Safari (o "mobile" é Chromium com a tela e o toque de iPhone), reativar conta e mandar WhatsApp (chamaria o modelo), 429 do painel (rate limit desligado no ambiente), retenção/limpeza de erros (90 dias), visão de erros do próprio agente (source=agent).
