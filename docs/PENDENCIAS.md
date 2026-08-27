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
7. ~~**Criar/editar lembrete pelo app**~~ — **feito em 26/08**, e **sem** `@react-native-community/datetimepicker`: a suposição de que precisava de dep nativa estava errada. `src/app/reminder-form.tsx` (modal) usa data/hora em texto + chips, o mesmo padrão que o form de transação já usava. Lista agora mostra pausados (antes filtrava `active=true` e não havia como retomar pelo app).
8. ~~**Editar meta/orçamento/conta**~~ — **feito em 26/08**. Toque no card abre o mesmo bloco de criação em modo edição; segurar continua arquivando/removendo. `useSaveGoal`/`useSaveAccount` viraram create-or-update (mesma forma de `useSaveTransaction`); orçamento já era upsert por `(user_id, category)`.
9. ~~**Transações recorrentes no app**~~ — **feito em 26/08**. `src/app/finance/recurring.tsx` lista, pausa, retoma e apaga, e mostra `last_error`/`run_attempts` quando uma série falha. Migration `0009` colocou a tabela no realtime. RRULE é traduzida para português por `src/lib/rrule-text.ts` (com testes).
10. **Plugin `expo-notifications` no `app.json`**: configura ícone/cor/canal padrão da notificação no Android. Exige asset de ícone (96x96 branco) e rebuild nativo.
11. **Cobertura de teste**: hoje só helpers puros (`dates.ts`, `rrule-text.ts`, `_shared/datetime.ts` — 23 casos). `_shared/recurrence.ts` não é testável com `node --test` (importa rrule de `https://esm.sh`) — testar com `deno test` quando o Deno estiver instalado.

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

## ✅ FASE 0 — fundação multi-tenant (concluída em 26/08/2026)

Decisão: o app vira **produto comercial** (conta compartilhada casal/família/PJ) e o financeiro
cresce **sem Open Finance** — agregador custa Pluggy ~R$2,5k/mês, Belvo ~R$6k/mês, Tecnospeed
~R$1,5k de entrada + R$540/mês. Substituto: ingestão inteligente (foto/PDF de fatura e extrato,
OFX/CSV, print de Pix). Plano completo em `~/.claude/plans/eu-tenho-ja-essa-resilient-shamir.md`.

- `0010_workspaces.sql` — `workspaces` + `workspace_members`; `workspace_id not null` em
  notes/reminders/transactions/accounts/goals/budgets/recurring_transactions com
  `default my_default_workspace()`; policies own-rows → workspace; uniques passam a ser por
  workspace; `handle_new_user` cria o workspace pessoal; `categories` legada dropada.
- `0011_workspace_rpcs.sql` — as 4 RPCs duplas + os 2 wrappers de back-compat reescritos no
  escopo de workspace (assinaturas intactas); `updated_at` + trigger `moddatetime` em 9 tabelas;
  índices `ai_events(user_id, created_at desc)` e `transactions(workspace_id, category)`.
- `0012_private_scope_helpers.sql` — fecha os 2 WARN dos advisors: `my_workspace_ids` vai para o
  schema `private` (não exposto pelo PostgREST) e `my_default_workspace` vira `security invoker`.
  Sobraram só os INFO pré-existentes (jobs/messages_raw/ai_events service_role-only) e pg_net.
- `process-jobs` (deployada) — resolve o workspace por `_default_workspace(uid)` e insere
  `workspace_id` explícito: service_role não tem `auth.uid()`, então o DEFAULT da coluna não vale.
  Contas/metas/undo filtram por workspace. `send-reminders` (deployada) idem na materialização.
- App — cliente tipado com `src/lib/database.types.ts` (types gerados) e interfaces derivadas do
  schema; categorias com fonte única em `src/lib/categories.ts`, travada por teste contra o prompt.
- Verificado: isolamento entre usuários (estranho vê 0 linhas, dono vê tudo), DEFAULT de workspace
  preenchendo insert do app, caminho service_role, `tsc`/`lint` limpos, 26 testes verdes.

## ✅ FASE 1 — cartão, fatura e parcelas (concluída em 26/08/2026)

É o gap nº1 da concorrência: há reclamação formal contra o Meu Assessor porque a IA não projeta
as parcelas seguintes no dashboard nem divide compra entre cartões.

- `0013_cards_and_installments.sql` — `accounts` ganha `closing_day`/`due_day`/`credit_limit_cents`/
  `payment_account_id` (check: null quando não é cartão); tabelas `card_invoices` e
  `installment_plans`; `transactions` ganha `status`, `due_at`, `invoice_id`,
  `installment_plan_id`, `installment_no`, `merchant`.
- **Regra de ciclo em um lugar só**: trigger `set_invoice` + `private.invoice_window()`. App,
  WhatsApp e (futuramente) importação acertam a fatura sem duplicar a regra em TS.
- RPCs: `create_installment_plan` (N transações, uma por mês, futuras `pending`, resto na última
  parcela), `pay_invoice` (transferência + fatura paga; nunca despesa nova) e o par
  `_card_summary`/`card_summary` (fatura aberta, total não pago, limite disponível).
- IA: 3 ações novas no schema do Gemini — `create_installment_purchase`, `pay_invoice`,
  `query_invoice`. `process-jobs` deployada com elas (e com o bug de narrowing de
  `query_category` corrigido). Agora entende "parcelei 1200 em 12x no nubank",
  "paguei a fatura do nubank", "quanto sobrou de limite?".
- App: telas `finance/cards.tsx` e `finance/invoice/[id].tsx`; campos de ciclo/limite no form de
  contas; chips de parcelamento (com prévia "12x de R$ 100") no form de lançamento; bloco
  "Faturas em aberto" no dashboard.
- Verificado em SQL (`node --test` não alcança plpgsql): 6 casos de `invoice_window` incluindo
  fechamento dia 31 em fevereiro e virada de ano; parcelamento 100000/3 → 33333+33333+33334 com
  cada parcela na fatura certa; `pay_invoice` rolando a fatura aberta para a próxima e devolvendo
  limite; partida dobrada conferida em `account_balances`. `tsc`/`lint` limpos, 26 testes.

## ✅ FASE 2 — pendentes, contas a pagar e projeção (concluída em 26/08/2026)

Gap nº2 do mercado: todo concorrente mostra só o retrovisor. Nenhum responde "quanto sobra dia 28"
nem "posso comprar isso em 10x?".

- `0014_forecast.sql` — recorrente aceita `transfer`, ganha `end_date`, `auto_confirm` e
  `materialized_until`; `transactions.recurring_id` com unique `(recurring_id, occurred_at)`
  (idempotência). RPCs `_promote_due_transactions`, `_close_due_invoices` e os pares
  `cash_flow_forecast`, `upcoming_bills`, `affordability`.
- `0015_recurring_dtstart.sql` — âncora imutável da série. Sem ela a expansão da RRULE usaria
  `next_run_at`, que anda a cada rodada, e a hora de parede derivaria.
- `0016_schedule_finance_scheduler.sql` — cron de hora em hora (`7 * * * *`), URL/token do Vault.
- **Edge Function nova `finance-scheduler`**: materializa recorrentes 90 dias à frente como
  `pending`, fecha faturas vencidas e promove pendentes que já aconteceram. A materialização
  **saiu do `send-reminders`**, que voltou a cuidar só de lembretes.
- IA: `query_forecast`, `simulate_purchase` e `mark_paid` (dá baixa em conta prevista, com
  desambiguação quando acha mais de uma parecida). `process-jobs` deployada.
- App: tela `finance/forecast.tsx` (gráfico de saldo dia a dia com linha do zero + simulador
  "posso comprar isso?"), bloco "A pagar nos próximos 7 dias" no dashboard, filtro "⏳ Previstos"
  e badge de previsto/parcela na lista de lançamentos.
- Verificado no banco: projeção de um cenário real (saldo 3.000, aluguel de 900 no dia 10,
  notebook 1.500 em 3x) devolvendo a saída do cartão **no vencimento da fatura** e não na compra;
  `affordability` reprovando 3.000 à vista (-1.400 em 10/09) e aprovando 500; scheduler rodando de
  verdade em produção (4 ocorrências criadas, `next_run_at` correto, segunda rodada `created: 0`)
  e dados de teste removidos. `tsc`/`lint` limpos, 26 testes.

## ✅ FASE 3 — ingestão inteligente (concluída em 26/08/2026)

O substituto do Open Finance. Em vez de R$2,5k/mês de agregador: foto de cupom, print de Pix e PDF
de fatura pelo WhatsApp + extrato OFX/CSV pelo app. Funciona até com banco fora do Open Finance.

- `0017_import_and_rules.sql` — `categorization_rules`, `import_batches`, `import_items`,
  `transactions.attachment_path`, bucket privado `receipts` (RLS pela primeira pasta = workspace),
  `_match_rule` e `approve_import_items`.
- `0018_rule_hits.sql` / `0019_import_preparation.sql` — contador de uso da regra e
  `_prepare_import_batch` (aplica regras + marca duplicatas numa chamada só).
  ⚠️ Pegadinha registrada no arquivo: LATERAL no FROM de um UPDATE não enxerga a tabela alvo.
- **Gemini multimodal**: `parseMessage` aceita `inline_data` e usa o MESMO `responseSchema`.
  `process-jobs` passa a tratar `image` e `document` (8MB, MIME na allowlist), com a legenda do
  usuário como contexto. Fim do "só entendo texto e áudio".
- **Edge Function nova `import-statement`**: parseia OFX e CSV (parser extraído para
  `_shared/statement-parser.ts`), aplica as regras, manda só o resto ao Gemini em UMA chamada e
  grava tudo como `import_items` para revisão — nada entra no extrato sem o usuário confirmar.
- Ação `set_rule` no WhatsApp ("sempre que eu falar ifood, põe em restaurante") e regra do usuário
  sobrepondo a IA em todo lançamento.
- App: telas `finance/import.tsx` (expo-document-picker + `new File(uri).text()` do SDK 57, revisão
  item a item com troca de categoria e descarte) e `finance/rules.tsx` (CRUD, com contador de uso).
- Verificado: importação real de um CSV de 5 linhas em produção — datas dd/mm/aaaa, valores BR
  (`5.000,00` → 500000), sinal virando kind, e o Gemini categorizando os 5 corretamente em uma
  chamada (ifood→restaurante, posto→transporte, zaffari→mercado, salário, uber→transporte);
  `approve_import_items` gerando as transações com `source='import'`; regra "ifood" e marcação de
  duplicata testadas em SQL. Dados de teste removidos. 34 testes (8 novos do parser), tsc/lint limpos.

⚠️ **Nota de teste:** `net.http_post` tem timeout padrão de 5s e ABORTA a Edge Function no meio
(a primeira tentativa gravou os itens mas perdeu a categorização). Ao testar function que chama IA
por pg_net, passar `timeout_milliseconds := 45000`.

## ✅ FASE 4 — correção conversacional e auditoria da IA (concluída em 26/08/2026)

Gap nº3: em todo concorrente (e no nosso app até aqui) só existia "desfazer o último". Errou a
categoria ou o valor? Sem conserto.

- `0020_ai_events_visibility.sql` — `ai_events` ganha leitura own-rows (era service_role-only) e
  a coluna `created_transaction_ids`, que liga o parse ao que ele criou.
- `0021_private_helpers_search_path.sql` — fecha os 5 WARN dos advisors nos helpers de `private`.
- IA: `update_transaction` (campos de BUSCA separados dos de CORREÇÃO — `new_amount_cents`,
  `new_category`, `new_occurred_at`) e `delete_item` com `target_type`
  (transaction/note/reminder/goal/recurring).
- **Resolver de referência** (`resolveTransactionRef`, TS puro): procura na janela dos 40
  lançamentos recentes filtrando por valor, categoria, texto e data. Sem pista nenhuma = "o
  último". Sobrou mais de um candidato → **pergunta em vez de chutar** e alterar o errado.
- `process-jobs` guarda os ids criados em `ai_events.created_transaction_ids`.
- App: tela `finance/ai-activity.tsx` — o que a IA entendeu de cada mensagem, confiança, modelo,
  tokens e botão de desfazer. Nenhum concorrente expõe isso.
- Verificado: policy de `ai_events` devolvendo só as linhas do dono; advisors de volta ao estado
  pré-existente; tsc/lint limpos; 34 testes.

## ✅ FASE 5 — orçamento por mês, metas com ledger, dívidas e alertas (concluída em 26/08/2026)

- `0022_budgets_month_and_goal_ledger.sql` — `budgets.month` (null = padrão) + `rollover`, com
  **dois unique parciais** porque NULL não colide com NULL no Postgres; `budgets_status` agora
  devolve `base_limit_cents`/`rollover_cents`/`month` além das colunas antigas (nomes preservados,
  app e Edge Function não mudaram). `goal_contributions` + `goal_deposit` atômica — o `+=` no
  cliente perdia aporte quando dois dispositivos lançavam junto.
- `0023_debts.sql` — dívidas com Tabela Price, `debt_schedule` (CTE recursiva),
  `payoff_strategy` (avalanche/snowball) e `pay_debt_installment`, que abate o saldo **já
  descontando os juros do mês**.
- `0024_alerts.sql` + `0025_schedule_send_alerts.sql` + Edge Function `send-alerts` — orçamento
  80%/100%, fatura e conta vencendo, saldo projetado negativo. Dedupe por (workspace, tipo, ref,
  DIA), reservado ANTES do envio: rodar o cron duas vezes não vira spam (e spam no WhatsApp custa
  template pago). Mensagem sempre acionável.
- App: tela `finance/debts.tsx` (amortização, quanto da parcela é juro, ordem de ataque), seletor
  de mês + toggles "acumula sobra"/"só este mês" em orçamentos, extrato de aportes na meta.
- Verificado: rollover (base 500 + sobra 300 = 800 efetivos) e override de mês; ledger somando
  500+300−100=700 com 3 linhas; amortização de R$10.000 em 12x a 2% a.m. fechando em R$945,60/mês
  com saldo zerando exato na 12ª; `_alerts_to_send` disparando os 3 tipos com texto acionável.
  34 testes, tsc/lint limpos.

⚠️ **Push ainda é o gargalo dos alertas.** Sem `extra.eas.projectId` + FCM (ver
`docs/PUSH-NOTIFICATIONS.md`), `expo_push_token` fica NULL e TODO alerta cai no template pago do
WhatsApp. A function já prefere push quando existe token — falta só a credencial.

## ✅ FASE 6 — patrimônio, investimentos e IR (concluída em 26/08/2026)

- `0026_net_worth.sql` — `assets` + `asset_valuations` (histórico de marcação) + `net_worth()`
  calculado na hora e `net_worth_snapshots` alimentado pelo `finance-scheduler`. **Histórico por
  snapshot, não por reconstrução**: saldo de conta dá para reconstruir das transações, mas valor
  de imóvel/investimento e saldo de dívida não — reconstruir seria inventar número.
- `0027_annual_reports_and_health.sql` — `annual_summary`, `annual_by_category`,
  `year_end_balances` (a ficha "Bens e Direitos" da declaração) e `financial_health`, com as
  4 parcelas do score expostas para o app poder explicar cada ponto.
- 🐛 **`0028_cash_includes_accountless.sql` — bug real encontrado testando**: o caixa (patrimônio
  E saldo inicial da projeção da Fase 2) somava só transações ligadas a uma conta. Lançamento do
  WhatsApp normalmente NÃO tem conta, então quem só usa o WhatsApp via caixa = soma dos saldos
  iniciais. `_account_balances` já tratava com a linha "Sem conta"; faltava nos outros dois.
  Corrigido com `private.cash_total()` reaproveitado pelos três.
- IA: `query_net_worth` e `update_asset_value` ("meu tesouro direto tá em 27 mil").
- App: `finance/net-worth.tsx` (composição, evolução, score explicado, CRUD de bens com marcação
  no histórico) e `finance/reports.tsx` (ano em números, gastos por categoria, saldos em 31/12,
  export CSV pelo share sheet).
- Verificado: patrimônio de um cenário completo (caixa + investimento + veículo − financiamento)
  batendo antes e depois da correção do caixa. 34 testes, tsc/lint limpos.

## ✅ FASE 7 — comercial (concluída em 26/08/2026)

- `0029_subscriptions_and_invites.sql` — `subscriptions` (com `provider`/`external_id` prontos
  para o gateway), `private.plan_limits` (limites num lugar só), `plan_status` (plano + consumo do
  mês + limites numa chamada, serve a tela E o gate da IA), `workspace_invites`,
  `accept_pending_invites` e `cancel_subscription`. `handle_new_user` passa a criar a assinatura
  free e a aceitar convite feito ANTES do cadastro.
- `0030_tighten_accept_invites.sql` — fecha o WARN do advisor: a função sai do alcance do `anon`.
- Limites aplicados de verdade: `process-jobs` corta na cota mensal do plano (mantendo o
  anti-flood por hora) e `import-statement` devolve 402 quando o plano não tem importação.
- App: `finance/plan.tsx` (plano, consumo, comparativo de planos, convite por telefone, pendentes e
  **cancelamento em um toque**), link no Perfil, e `useSession` aceitando convites no login.
- Preços definidos: Free (1 pessoa, 100 msgs) · Pro R$ 24,90 (3 pessoas, 1.000 msgs, importação)
  · Família R$ 39,90 (5 pessoas, 2.000 msgs). Abaixo de Meu Assessor e Financinha porque não
  pagamos conexão de Open Finance.
- Verificado: `plan_status` respondendo free e family com limites e consumo corretos; telefone do
  convite normalizado para o mesmo formato de `profiles.phone` (senão o aceite nunca casaria).

⚠️ **Plano agora é propriedade do backend** (`0033_subscription_is_backend_owned.sql`, 27/08/2026).
A policy `subscriptions: owner writes` era `for all`, então o dono do workspace podia dar `update`
na própria linha e se promover para `family` por REST, sem passar por cobrança nenhuma. **Não era
efeito de ambiente de teste — valia em produção**, e tornava decorativos os limites que o
`process-jobs` lê de `private.plan_limits`. Fechado com duas travas:

1. o cliente perdeu a policy de escrita (só `select` de membros continua);
2. o trigger `guard_billing` recusa alteração de `plan`/`status`/`provider`/`external_id`/
   `current_period_end` vinda de `authenticated`/`anon` — sobrevive a alguém recriar uma policy de
   escrita um dia por um campo inofensivo.

O discriminador do trigger é **`current_user`, não `auth.uid()`**: dentro de uma função
`security definer` o `auth.uid()` continua sendo o do usuário (sai do JWT), então ele não distingue
"app" de "backend". Já `current_user` vira o dono da função no definer e é `service_role` no
webhook.

`cancel_subscription` virou `security definer` para continuar funcionando sem a policy — travar
plano não pode virar travar saída.

Verificado com `set local role authenticated` + JWT do dono: update direto não move `plan`, leitura
continua, `cancel_subscription` funciona; e `service_role` escreve plano normalmente.

**Trocar de plano em teste agora é SQL** (a tela não tem mais botão de troca):

```sql
update public.subscriptions set plan = 'pro', status = 'active', canceled_at = null
where workspace_id = (select id from public.workspaces limit 1);
```

⚠️ **Gateway em aberto** — pesquisado em 27/08/2026, decisão **adiada a pedido do usuário**, que vai
pesquisar mais. O que já está levantado:

| Concorrente | Cobrança | Como se sabe |
|---|---|---|
| Foccum | **Cakto** | termos de uso citam a Cakto como processadora; vendem pagamento único de 24 meses, não assinatura |
| Meu Assessor | **Hotmart** | checkout em `pay.hotmart.com/D98698570Y` |
| Pierre | **Apple IAP** | App Store, vendedor CloudWalk Inc., IAP de R$ 39 / R$ 399 / R$ 199 / R$ 1.999 |

Custo por cobrança de **R$ 24,90** (nosso Pro) — a taxa **fixa** é o que decide nesse ticket:

| Plataforma | Custo | Efetivo |
|---|---|---|
| Mercado Pago (crédito, 30 dias) | R$ 0,75 | 3,0% |
| Asaas (crédito à vista) | R$ 1,23 | 4,9% |
| Stripe (cartão + Billing 0,7%) | R$ 1,56 | 6,3% |
| Cakto | R$ 3,46 | 13,9% |
| Hotmart | R$ 3,47 | 13,9% |
| Kiwify | R$ 4,73 | 19,0% |

Cakto/Kiwify/Hotmart são feitas para ticket de R$ 297–1.997, onde os ~R$ 2,49 fixos somem. Numa
assinatura de R$ 24,90 comem um sexto da receita todo mês. Copiar o Foccum aqui seria copiar a
ferramenta ignorando o motivo.

**Lojas de app (o que pesa mais que o gateway):**

- Apple: IAP = 15% no Small Business (< US$ 1 mi/ano). Pelo TCC do CADE (dez/2025), link externo
  clicável no Brasil paga 15% **somado à comissão-base** → ~27% efetivos; só menção em texto
  estático é 0%. Adesão ao contrato novo até 06/07/2026.
- Google Play: desde 30/06/2026, 10% no primeiro US$ 1 mi com faturamento externo (+5% se usar o
  billing do Google).
- **Apple Pay / Google Pay não são alternativa ao IAP** — são carteiras de cartão. A 3.1.1 proíbe
  usá-las para conteúdo digital dentro do app; na **web** são liberadas e custam taxa normal de
  cartão. Ou seja: checkout web dá Face ID em um toque **sem** comissão de loja.

Desenho sugerido (não decidido): paywall real no WhatsApp, disparado no momento em que o limite
estoura — que é onde o usuário está quando isso acontece. Android pode ter botão abrindo o checkout
no navegador; iOS sem botão de compra até valer a pena integrar IAP. `subscriptions.provider`
existe justamente para os dois conviverem.

⚠️ **Advisors aceitos de propósito:** `accept_pending_invites` e `cancel_subscription` ficam como
`SECURITY DEFINER` executáveis por `authenticated`. A primeira precisa escrever em
`workspace_members` de um workspace que o convidado ainda não enxerga; a segunda precisa cancelar
sem a policy de escrita. Ambas agem só sobre o `auth.uid()` do chamador.

⚠️ **Cobrança fechada: In-App Purchase nas duas lojas** (27/08/2026). Decisão do
usuário depois da pesquisa de mercado: **sem checkout web**. App Store + Google
Play, ~15% nos dois, 7 dias de trial. Landing page só informativa ("planos a
partir de R$ 24,90 · baixe o app") — landing não é governada por App Review, só o
binário é, então não existe link externo, entitlement nem transação a reportar.

Passo a passo do que falta fazer nas contas: **`docs/IN-APP-PURCHASE.md`**.

O que a pesquisa achou (para não refazer):

| Concorrente | Cobrança | Evidência |
|---|---|---|
| Foccum | Cakto (web) | termos citam a Cakto como processadora; vende pagamento único de 24 meses |
| Meu Assessor | Hotmart (web) | checkout em `pay.hotmart.com/D98698570Y` |
| Pierre | Apple IAP | App Store, vendedor CloudWalk Inc. |
| Mobills / Organizze | IAP + web | híbrido; a assinatura vale nas três plataformas |

Custo por cobrança de R$ 24,90: IAP 15% (R$ 3,74) · Asaas cartão+NFS-e 6,9%
(R$ 1,73) · Cakto 13,9% · Hotmart 13,9% · Kiwify 19,0%. O que decide em ticket
baixo é a **taxa fixa** — Cakto/Kiwify/Hotmart são feitas para R$ 297–1.997.

Regras de loja levantadas: Apple SBP = 15% (**precisa se inscrever**, senão 30%);
Google desde 30/06/2026 = 10% + 5% se usar o billing deles; link externo clicável
no app custa 15% (Apple) / 10% (Google) — pior que IAP; **texto estático é 0%**;
quem chega ao site por fora do app não gera comissão nenhuma. Apple Pay e Google
Pay **não** são alternativa ao IAP (são carteiras de cartão, proibidas para
conteúdo digital dentro do app pela 3.1.1).

⚠️ **Nem Apple nem Google aceitam Pix em assinatura recorrente** (Google aceita
Pix só em compra avulsa). Todo assinante precisa de cartão. É a maior perda de
conversão conhecida deste desenho — acompanhar abandono no paywall. Se doer, a
saída é ADICIONAR web depois, não trocar de estratégia.

Entregue nesta rodada:

- `0034_iap_entitlements.sql` — colunas de loja em `subscriptions`
  (`product_id`, `environment`, `is_trial`), `billing_events` (auditoria +
  idempotência, RLS sem policies), unique parcial `(provider, external_id)`
  (uma compra libera UM workspace) e **`private.effective_plan`**.
- `0035_apply_entitlement_public.sql` — a função de concessão sai de `private`
  para `public._apply_entitlement`: o PostgREST não expõe `private`, e a Edge
  Function chama por `supabase.rpc()`.
- `0036_cancel_goes_to_the_store.sql` — `plan_status` devolve `provider`, e
  `cancel_subscription` **recusa** cancelar assinatura de loja (devolve
  `cancelar_na_loja:apple|google`). Cancelar por aqui tiraria o acesso e deixaria
  a loja cobrando — o pior dos dois mundos.
- `supabase/functions/billing-webhook/` — webhook da RevenueCat.
- `src/lib/billing.ts` + `_shared/billing.ts` + `billing.test.ts` (trava a
  divergência, padrão de `categories.ts`).
- `plan.tsx` mostra trial, expirado e "gerenciar na loja".

🔒 **Buraco fechado de quebra:** `plan_status_for` lia `plan` e `status` e
IGNORAVA `current_period_end`. Um webhook de EXPIRATION perdido deixaria a pessoa
Pro para sempre. Agora `effective_plan` derruba para Free quando a data passou, e
o status volta como `expired` para a tela poder explicar. Verificado: linha
gravada como `pro`/`active` com `current_period_end` de ontem devolve
`free`/`expired`, 100 mensagens e sem importação.

Verificado também, via `_apply_entitlement`: compra legítima concede; reenvio do
mesmo evento devolve `duplicado` sem reaplicar; evento de sandbox devolve
`sandbox_ignorado`; produto fora do catálogo devolve `produto_desconhecido`;
`app_user_id` que não é uuid devolve `app_user_id_invalido`; **CANCELLATION
mantém o acesso** (cancelar é "não vai renovar") e só EXPIRATION revoga.

⚠️ `BILLING_ALLOW_SANDBOX=true` existe para testar em sandbox e **precisa ser
removida antes de publicar** — com ela ligada, qualquer um com StoreKit Testing
vira Pro de graça.

⚠️ **Advisors aceitos de propósito:** `accept_pending_invites` e
`cancel_subscription` ficam como `SECURITY DEFINER` executáveis por
`authenticated`; `billing_events` fica com RLS sem policies (tabela de infra, só
service_role, igual `jobs` e `messages_raw`).

---

## 🎯 Onde o produto está

As 7 fases do plano de mercado estão no ar. O que diferencia de Foccum / Meu Assessor / Pierre /
Financinha / ZapGastos hoje: parcelamento e fatura de verdade, projeção de fluxo de caixa com
simulador de compra, correção conversacional com auditoria da IA visível, ingestão inteligente no
lugar do Open Finance, patrimônio e IR, e cancelamento sem atrito.

**Nota de histórico de migrations:** o remoto tem 2 entradas a mais que os arquivos —
`import_preparation` + `import_preparation_fix` (a correção do LATERAL) foram aplicadas separadas e
o repo guarda só a versão final, em `0019`; e a numeração local (`0026_net_worth`/
`0027_annual_reports_and_health`) tem nome diferente da entrada remota. O SCHEMA é o mesmo: aplicar
os arquivos do zero produz o banco atual. Continua valendo: **nunca `supabase db push` sem
reconciliar antes**.

**Ordem de trabalho decidida em 26/08/2026** (deixar o produto redondo antes de mexer em infra):

1. **Conferir as 11 telas novas no device**, dark E light. É a única verificação que ninguém fez
   ainda e a regra do projeto exige. Telas: `cards`, `invoice/[id]`, `forecast`, `import`,
   `rules`, `ai-activity`, `debts`, `net-worth`, `reports`, `plan` + o dashboard alterado.
2. **Rodar o fluxo WhatsApp ponta a ponta** com as ações novas (`/verify-whatsapp`): parcelamento,
   pagar fatura, projeção, "posso comprar", correção de lançamento, foto de cupom, regra.
3. **Número WhatsApp de produção** — ⏰ **único item com prazo**: a janela de 90 dias do número de
   teste fecha por volta de **outubro/2026**.
4. **Gateway de pagamento + webhook de assinatura** (`subscriptions.provider`/`external_id` já
   existem; falta escolher Stripe/Kiwify/Hotmart e escrever o webhook que muda
   `plan`/`status`/`current_period_end`).
5. **Push, por último** (`docs/PUSH-NOTIFICATIONS.md`).

**Por que push ficou por último — decisão consciente, não esquecimento:**

- **Custo hoje é R$ 0.** O banco tem 1 profile e nenhum orçamento/fatura, então
  `_alerts_to_send()` volta vazio: não há alerta disparando nem template sendo pago. O custo só
  começa a existir quando houver usuário real com dado cadastrado.
- **É configuração, não arquitetura.** `send-alerts` e `send-reminders` já preferem push e usam
  template só como fallback — no dia em que `expo_push_token` existir, o código não muda.
- **Exige rebuild nativo**, então fazer antes das telas estabilizarem é retrabalho garantido.
- Custos confirmados nas fontes oficiais em 26/08: Expo Push **grátis** (600 notif./s por
  projeto), FCM grátis, EAS Free com 15 builds Android + 15 iOS por ciclo. **Android sai por
  R$ 0**; só o iOS exige US$ 99/ano (Apple Developer, sem ela não há APNs). Tabela completa e o
  cálculo do ponto de equilíbrio estão em `docs/PUSH-NOTIFICATIONS.md`.
- Detalhe que reduz o custo real: **template Utility dentro da janela de 24h é gratuito**, e neste
  produto o usuário manda mensagem quase todo dia. O gasto se concentra em usuário **inativo**.

## ⚠️ Gemini — cotas e limites de schema (medidos em 27/08/2026)

O parse parou de funcionar sem ninguém mexer em nada. Três causas empilhadas:

**1. Alias trocou de modelo.** `gemini-flash-latest` migrou para o Gemini 3.7 Flash. Os modelos
agora são **FIXADOS** em `_shared/gemini.ts` — o preço é revisar na depreciação (que avisa com 404),
em vez de quebrar em silêncio.

**2. Dois limites NÃO documentados do `responseSchema`** na geração nova (3.1/3.5-lite, 3.6, 3.7).
Ambos respondem `400 INVALID_ARGUMENT` sem nenhuma pista:

| Limite | Valor (busca binária) |
|---|---|
| Propriedades por ação | **15** (16 já falha) |
| Campos com `enum` | **1** no schema inteiro |

Não depende do tamanho do prompt. Por isso os campos do `AiAction` são multiuso — antes de somar
um campo, tem que tirar outro.

**3. Cota do nível gratuito, por modelo por DIA** (painel do AI Studio):

| Modelo | RPM | RPD |
|---|---|---|
| Gemini 3.6 / 3.7 Flash | 5 | **20** |
| Gemini 3.1 / 3.5 Flash-Lite | 15 | **500** |

Vinte por dia não roda nem uma sessão de teste. Por isso o principal é
**`gemini-3.5-flash-lite`** e o 3.6 Flash ficou só para escalonamento (caso raro).

**Rede de segurança contra parse incompleto** (`_shared/money-text.ts`): quando a ação exige valor
e a IA devolve sem, o executor extrai o número do **texto cru** da mensagem. Deliberadamente
conservador — só aceita quando há **exatamente um** número plausível ("12x", "dia 5", "8h" e "20%"
são descartados antes de contar). Com dois candidatos devolve null e o executor pede para
reformular, porque chutar qual é o dinheiro seria pior que perguntar. 7 casos em `npm test`.

Existe porque escalar para um modelo maior resolveria, mas o modelo maior tem 20 requisições/dia:
depender dele para um caso corriqueiro é frágil.

**Aprendizados que viraram código:**
- `confidence` é sinal ruim: o Lite devolve **1.0 e ainda assim omite o valor**. A escalada agora
  dispara também por **parse incompleto** (`parseIncompleto`), olhando o resultado e não o que o
  modelo diz de si.
- Escalonamento é best-effort: se o modelo maior falhar, segue com o resultado do menor. Perder um
  parse bom por causa do refinamento seria trocar resposta mediana por nenhuma.
- **Não dormir dentro do worker.** Fazer o retry esperar os 13s que o 429 pede estourou o tempo da
  Edge Function e deixou os jobs presos em `processing`. Numa fila com cron de 1 minuto, o próximo
  tick já é o backoff.

**Pendente:** com `billing` ativado, reavaliar se vale voltar para um Flash maior no parse — a
diferença de custo é ~R$ 5 por mil mensagens.

## 📝 Como verificar o pipeline (rápido)
Usar `/verify-whatsapp` ou manualmente: mandar mensagem → conferir `messages_raw` (inbound) → `jobs` (done) → `ai_events` (result/confidence) → tabela final (`transactions`/`notes`/...) → resposta no WhatsApp. Logs: MCP `get_logs` (edge-function).
