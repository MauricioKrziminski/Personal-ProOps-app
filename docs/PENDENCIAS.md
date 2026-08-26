# Pendências e próximas fases

> Estado em 26/08/2026, após a auditoria do repositório e a rodada de correções de fuso/retry.
> Este arquivo é a lista viva do que falta — riscar/remover conforme for entregue.

## ✅ Já entregue (contexto)

- `.claude/` modular (rules, commands `/db-migrate` `/deploy-functions` `/verify-whatsapp` `/new-screen`, agents `migration-reviewer`/`ui-polisher`), CLAUDE.md enxuto, README real.
- Banco: `accounts`, `transactions` (expense/income/transfer), `goals`, `budgets`, `recurring_transactions` + RPCs (`transactions_summary`, `monthly_cashflow`, `account_balances`, `budgets_status`, padrão duplo `_interna(uid)`); `expenses` migrada e dropada; `claim_jobs` versionada com recuperação de órfãos. **Migrations 0001–0006 aplicadas no projeto remoto via MCP.**
- WhatsApp/IA: multi-intent (listas → várias ações), receitas, transferências, metas, aportes, consultas (saldo/gastos/orçamentos/metas), `undo_last`, recorrências materializadas pelo cron, rate limit 60 parses/usuário/hora. `process-jobs` **v15** e `send-reminders` **v9** deployadas em 26/08 com as correções de fuso e de retry.
- App: grupo `(tabs)` + Stack, dashboard financeiro, lançamentos com filtros + form modal (rhf+zod, MoneyInput em centavos), metas/orçamentos/contas com CRUD, notas com quick-add/filtro/apagar, lembretes com pausar/apagar, perfil com ativação de push token, estados loading/empty/error em tudo.
- **Fuso corrigido nas Edge Functions** (`_shared/datetime.ts` + `_shared/recurrence.ts`): `occurred_at` usa o dia do usuário, `remind_at` sem offset é lido como hora local (não UTC) e RRULE é expandida no calendário do usuário com âncora na ocorrência atual (a hora da série não vira mais "o minuto em que o cron rodou").
- **Fim do retry infinito de lembrete**: `send_attempts`/`run_attempts` + `last_error` (migration `0007`); ao estourar 5 tentativas a série recorrente pula para a próxima ocorrência e o item único é desativado.
- **Testes**: `npm test` (`node --test`, sem framework) cobrindo `src/lib/dates.ts` e `supabase/functions/_shared/datetime.ts` — 13 casos, incluindo os de virada de dia em GMT-3.
- `npx tsc --noEmit`, `npx expo lint` e `npm test` limpos (o warning do React Compiler em `transaction-form.tsx` foi resolvido com `useWatch`).

## ✅ Concluído em 26/08

- Migration `0007` aplicada em produção (via MCP, com o nome `delivery_attempts`); `process-jobs` v15 e `send-reminders` v9 no ar. Confirmado pela resposta do cron trazendo o campo `givenUp` novo.
- Lembrete "Pagar o aluguel" estava ativo e **21 dias atrasado**, com o cron tentando reenviar a cada minuto desde 05/08 (~30.400 chamadas à Meta com template inexistente). `next_run_at` empurrado para 05/09.
- Transação de R$ 20,00 em `alimentacao` corrigida de 14/07 para 13/07 (vítima do bug de fuso).
- Prompt do Gemini passou a receber a hora local do usuário com offset, em vez de UTC.
- Migration `0008` aplicada: os dois `cron.schedule` leem URL e anon key do Vault (segredos `project_url`/`anon_key`, criados extraindo os valores do próprio cron antigo). Zero token literal em `cron.job`; ticks 200 confirmados depois da troca.

## 📡 Meta / WhatsApp — o que foi verificado na conta (26/08)

Via Graph API v21.0 com o token de System User do app:

- **Duas WABAs no negócio ProOps**, ambas `verified` / `APPROVED`:
  - **Produção (ERP)** `25506311055735818` "ProOps" → número `+55 35 8421-9483` (`1010710182120672`), verified_name "ProOps", quality GREEN, `account_mode LIVE`, `code_verification_status: EXPIRED`. **Apps assinados: só `ProOps` (2187114525360610)** — o Personal app NÃO recebe webhook de lá. ✅
  - **Teste** `1280843510763871` ("Test WhatsApp Business Account"), do negócio **ProOps** `908714208558515`, com `business_verification_status: verified` e `account_review_status: APPROVED`.
- **Os DOIS apps estão assinados na WABA de TESTE**: `Personal ProOps app` (1021879160698454) e `ProOps` (2187114525360610). Toda mensagem no número de teste é entregue aos dois webhooks. Na WABA de produção isso não acontece.
- **Ver ≠ receber**: os dois apps enxergam os dois números no dropdown "De" (acesso ao ativo, herdado do negócio), mas só quem está em `subscribed_apps` recebe webhook. Confirmado por dados: em 44 dias, `messages_raw` só tem `555192553295` (o número do Gabriel) e `5511988887777` (payload simulado do teste inicial) — zero tráfego de cliente do ERP.
- ⚠️ **Prazo real**: a própria UI da Meta diz "os números de telefone de teste permitem que você envie mensagens gratuitas por **90 dias**". A WABA de teste é de ~13/07/2026 → a janela fecha por volta de **outubro/2026**. É o único item com relógio correndo.
- ⚠️ **Blast radius do token**: o token do Personal app leu os detalhes do número de PRODUÇÃO do ERP sem erro. Como os escopos vêm sem `target_ids`, ele provavelmente também consegue **enviar** pelo número do ERP. Mitigação: System User dedicado, com acesso só à WABA deste produto.
- Número `+1 555-152-2865` (`956959177508886`): `verified_name: "Test Number"`, `code_verification_status: NOT_VERIFIED`, `is_official_business_account: false`, quality GREEN. É o número de teste da Meta, não serve para produção.
- Token: System User, `expires_at: 0` (não expira), app = Personal ProOps app, escopos `whatsapp_business_messaging` + `whatsapp_business_management` **sem `target_ids`** — não está restrito a uma WABA específica.
- **Templates próprios deste produto criados em 26/08** na WABA de teste:
  - `personal_proops_login_otp` (AUTHENTICATION, pt_BR) — id `1019655521065477`, **APPROVED na hora**.
  - `personal_proops_reminder` (UTILITY, pt_BR) — id `1097041035993071`, **PENDING** (Utility passa por revisão).
  - Motivo de não reaproveitar `proops_login_otp`: ele é do **ERP** (2FA do ERP quando o WhatsApp está ativado lá) e vive na mesma WABA de teste. Objeto compartilhado — se o time do ERP editar ou apagar, o login deste app cai junto.
- Nomes de template agora vêm de env (`WA_OTP_TEMPLATE`, `WA_REMINDER_TEMPLATE`); o hardcode em `send-reminders` saiu.
- Templates são **por WABA**: ao migrar para uma WABA própria de produção, recriar os dois **com os mesmos nomes** — aí nenhum código ou secret muda, só o `WHATSAPP_PHONE_NUMBER_ID`.

## 🔥 Aplicar agora (na ordem)

1. **Vault + migration `0008_cron_token_from_vault.sql`** — criar os segredos fora do repo (`select vault.create_secret('https://<ref>.supabase.co','project_url')` e `select vault.create_secret('<anon key>','anon_key')`) e só então aplicar a migration; ela **falha de propósito** se os segredos não existirem. Depois: **rotacionar a anon key** (ela está no histórico do git pela `0003`) e atualizar `EXPO_PUBLIC_SUPABASE_ANON_KEY` no `.env` e o segredo `anon_key` no Vault.
2. **Push notifications (Fase 4)** — **adiada conscientemente em 26/08**. Passo a passo completo,
   estado verificado, armadilhas e o código de recepção que ainda falta: **[docs/PUSH-NOTIFICATIONS.md](PUSH-NOTIFICATIONS.md)**.
   Resumo: sem `extra.eas.projectId` + credenciais FCM, `expo_push_token` fica `NULL` e **todo lembrete
   vira template Utility pago** em vez de push grátis.
3. **Sincronizar os secrets e redeployar o send-reminders** (o nome do template saiu do código):
   ```
   npx supabase secrets set --env-file supabase/.env --project-ref kwriuifcwyvdrxtspjiz
   npx supabase functions deploy send-reminders --project-ref kwriuifcwyvdrxtspjiz --use-api
   ```
4. **Ligar o OTP**: habilitar o provider Phone no Supabase Auth e registrar o hook Send SMS apontando para `/functions/v1/wa-send-otp`. Sem isso não existe login fora de build de desenvolvimento — `__DEV__` é `false` em preview/production, e o atalho de teste não renderiza.

## 🔴 Dívidas técnicas (resolver cedo)

1. **Histórico de migrations divergente**: o banco remoto usa versões timestamp (aplicadas via dashboard/MCP), enquanto o repo usa `000N_*.sql`. **Nunca rodar `supabase db push` sem antes reconciliar** (`supabase migration repair` ou continuar aplicando via MCP `apply_migration`, que é o fluxo atual). A project ref na `0003` (`kwriuifcwyvdrxtspjiz`) também diverge do `config.toml` (`app-proops`) — a `0008` já não repete ref literal.
2. **Acesso ao projeto Supabase**: resolvido em 26/08 trocando o access token do MCP (`~/.claude.json`) — mas agora o MCP enxerga **só** a org ProOps; `propostas-softcode` e `frigorifico` saíram. Para ter as duas, convidar a conta para a org ProOps ou registrar um segundo servidor MCP.
3. **Types do Supabase não gerados**: hooks usam interfaces manuais. Rodar `npx supabase gen types typescript --project-id kwriuifcwyvdrxtspjiz`.
4. **Número WhatsApp de teste** (`+1 555 152 2865`): só envia para números na allowed list. WABA dedicada continua sendo o caminho para produção.
5. **Tabela `categories` legada** existe e não é usada — dropar numa migration quando houver certeza de que ninguém lê.

## 🟡 Detalhes adiados do frontend

6. ~~**Splash/branding**~~ — **feito em 26/08**. Marca própria em `assets/images/brand/` (par preto/branco derivado de `icons/icon-512.png`), splash com variante dark, ícone adaptativo do Android com zona de segurança, e todo o kit do template Expo removido (`expo-logo`, `logo-glow`, `react-logo*`, `expo-badge*`, `tabIcons/`, `expo.icon/`). `AnimatedIcon`, que era código morto do template, saiu junto. **Falta só** um `icon.png` 1024×1024 para publicação em loja — hoje o `app.json` aponta para o `icon-512.png`, que serve para dev.
7. **Criar/editar lembrete pelo app**: adiado por depender de `@react-native-community/datetimepicker` (dep nativa → rebuild). Fluxo previsto: modal `src/app/reminder-form.tsx` (título + data/hora + chips de recorrência RRULE), registrar no Stack do `_layout.tsx`. Hoje: criação via WhatsApp; pausar/apagar já existem no app.
8. **Editar meta/orçamento/conta** (nome/valores): hoje só criar/arquivar/apagar.
9. **Transações recorrentes no app**: não há tela para listar/pausar `recurring_transactions` (só via WhatsApp). Com a `0007`, `last_error` já dá o que mostrar quando uma série falha.
10. **Plugin `expo-notifications` no `app.json`**: configura ícone/cor/canal padrão da notificação no Android. Exige asset de ícone (96x96 branco) e rebuild nativo.
11. **Cobertura de teste**: hoje só helpers puros. `_shared/recurrence.ts` não é testável com `node --test` (importa rrule de `https://esm.sh`) — testar com `deno test` quando o Deno estiver instalado.

## 🔵 FASE 4 — Roadmap v2 (ordem sugerida)

### 4.1 Push notifications de verdade
- **Documento próprio: [docs/PUSH-NOTIFICATIONS.md](PUSH-NOTIFICATIONS.md)** — setup (EAS + Firebase), o código de recepção que falta (`setNotificationHandler`, listener de resposta, deep link) e armadilhas.
- Destravado por ele: alertas de **orçamento a 80%/100%** (cron diário sobre `_budgets_status`) e push quando lançamento recorrente é materializado.

### 4.2 Foto de recibo (OCR)
- `process-jobs/extractText`: aceitar `message.type === 'image'` → `downloadMedia` → Gemini Vision (mesma API `generateContent`, part `inline_data` com o base64) com o MESMO responseSchema multi-ação.
- Prompt: extrair valor total, estabelecimento (description), categoria e data do cupom.
- Guardar `wa_media_id` no `ai_events.result` para auditoria. Remover a resposta "só entendo texto e áudio".

### 4.3 Import de extrato (CSV/OFX)
- Tela no app (perfil ou financeiro): `expo-document-picker` → parse local (CSV: papaparse; OFX: regex simples) → lote para Edge Function nova `import-statement` (service_role) que categoriza em batch com Gemini (1 chamada com N linhas) e insere com `source='import'`.
- **Dedupe**: por (user_id, occurred_at, amount_cents, description normalizada) — não criar unique index; checar via query antes do insert.
- UI de revisão antes de confirmar (lista com categoria editável).

### 4.4 Relatórios / fechamento de mês
- Cron mensal (dia 1, 08h): resumo do mês anterior por WhatsApp template Utility + push (gastos, receitas, saldo, top categorias, orçamentos estourados, progresso de metas). Usa `_tx_summary`/`_budgets_status`/`_monthly_cashflow`.
- Export CSV no app (share sheet) — gerar do lado do cliente com os dados de `useTransactions`.
- Score de saúde financeira simples (0–100: orçamento respeitado + taxa de poupança) no dashboard.

### 4.5 v3 (se fizer sentido)
- Fatura de cartão de crédito (fechamento/vencimento — hoje cartão é só um tipo de conta).
- `update_last` via WhatsApp ("muda o último pra 50", "era lazer, não mercado").
- Orçamento por mês específico (hoje o limite é fixo por categoria).
- Ledger de aportes em metas (`goal_contributions`) se precisar de extrato da meta.
- Orçamento compartilhado / família (multi-usuário por espaço).

## 📝 Como verificar o pipeline (rápido)
Usar `/verify-whatsapp` ou manualmente: mandar mensagem → conferir `messages_raw` (inbound) → `jobs` (done) → `ai_events` (result/confidence) → tabela final (`transactions`/`notes`/...) → resposta no WhatsApp. Logs: MCP `get_logs` (edge-function).
