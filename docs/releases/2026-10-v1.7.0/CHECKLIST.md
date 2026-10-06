# v1.7.0 — checklist de produção (preparado em 05/10/2026, NÃO executado)

Branch `gabriel/financas-22-melhorias`. Nada disto foi feito: produção, merge na `main`, push e
tag são do Gabriel. Conferido em leitura em 05/10/2026: produção está em `20261001194502` e tem
**42 migrations pendentes** (`20261002134032` … `20261005220000`), nenhuma só no remoto.

Versão: `1.6.3 → 1.7.0` (MINOR: funcionalidade nova e RPCs novas; sem quebra — as migrations são
aditivas e o agente continua aceitando o contrato anterior). Sem mudança nativa: a 1.7.0 fecha o
OTA para a 1.6.x e sai como build nova pela tag.

## Decisões tomadas

1. **Avaliação no Gemini real**: feita com a chave de produção, uma execução completa e depois só
   as seções corrigidas (ver `docs/qa/2026-10-02-evolucao-financeira/final/aceite.md`).
2. **Agente**: o da branch inteira (paridade A–D), já no staging como `agente-staging-00221`.

## Ordem (migrations → agente → app)

1. Portão, na branch: `npx tsc --noEmit`, `npx expo lint`, `npm test` (exit code),
   `cd agent && .venv/bin/ruff check app --select F,E9 && .venv/bin/pytest` — verdes em 05/10.
2. Migrations (Gabriel):
   ```sh
   npx supabase migration list --project-ref kwriuifcwyvdrxtspjiz   # confere as 42
   PROOPS_PROD_OK=1 npx supabase db push --project-ref kwriuifcwyvdrxtspjiz
   ```
   Depois: `supabase/tests/anon_sem_execute.sql` e o registro em `docs/HISTORICO-DE-MIGRATIONS.md`
   (rascunho abaixo).
3. Agente: `./scripts/setup-gcp.sh deploy` (pede `PRODUCAO`), na conta gcloud do projeto.
4. App: na `main` (merge da branch), `app.json` `expo.version` = `1.7.0`, commit `chore: v1.7.0`,
   `git push origin main`, tag leve `v1.7.0` no commit, `git push origin v1.7.0`
   (`publish-android-release.yml` faz o APK, ~10 min).
5. Depois da release, em produção: registrar a 8ª parcela do carro pelo "Paguei" (ou recriar o
   financiamento respondendo Sim em "A 8ª já saiu da conta?") e conferir a Fatura atual do BB.

## Rascunho para `docs/HISTORICO-DE-MIGRATIONS.md`

> **Produção e staging ALINHADOS em `20261005220000`** — promoção autorizada pelo Gabriel em
> DD/MM/2026 para a v1.7.0 (programa de 22 pontos + correções de 05/10). Dry run mostrou as 42
> migrations `20261002134032` … `20261005220000`; aplicadas com `--project-ref
> kwriuifcwyvdrxtspjiz`, sem seed e sem trocar o link local de staging. Conferência posterior:
> versões presentes nos dois bancos; `anon_sem_execute.sql` passou. Evidências:
> `docs/qa/2026-10-02-evolucao-financeira/` e `docs/releases/2026-10-v1.7.0/`.

## O que esta release corrige do que foi visto em produção

Valor da linha minúsculo depois de buscar; trava do app por baixo do formulário e das folhas;
data da parcela do financiamento que "voltava" e parcela vencida que deslizava; parcela paga no
ciclo que não aparecia em "o que entra e sai"; Fatura atual do BB mostrando a de 10/11 em vez da
de 10/10; abertura sem rede caindo no login.
