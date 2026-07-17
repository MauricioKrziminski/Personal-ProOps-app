# Pendências e próximas fases

> Estado em 17/07/2026, após as Fases 0–3 (setup .claude, schema financeiro, IA multi-intent, frontend financeiro completo). Este arquivo é a lista viva do que falta — riscar/remover conforme for entregue.

## ✅ Já entregue (contexto)

- `.claude/` modular (rules, commands `/db-migrate` `/deploy-functions` `/verify-whatsapp` `/new-screen`, agents `migration-reviewer`/`ui-polisher`), CLAUDE.md enxuto, README real.
- Banco: `accounts`, `transactions` (expense/income/transfer), `goals`, `budgets`, `recurring_transactions` + RPCs (`transactions_summary`, `monthly_cashflow`, `account_balances`, `budgets_status`, padrão duplo `_interna(uid)`); `expenses` migrada e dropada; `claim_jobs` versionada com recuperação de órfãos. **Migrations aplicadas no projeto remoto via MCP.**
- WhatsApp/IA: multi-intent (listas → várias ações), receitas, transferências, metas, aportes, consultas (saldo/gastos/orçamentos/metas), `undo_last`, recorrências materializadas pelo cron, rate limit 60 parses/usuário/hora. `process-jobs` v14 e `send-reminders` v8 deployadas.
- App: grupo `(tabs)` + Stack, dashboard financeiro, lançamentos com filtros + form modal (rhf+zod, MoneyInput em centavos), metas/orçamentos/contas com CRUD, notas com quick-add/filtro/apagar, lembretes com pausar/apagar, perfil com ativação de push token, estados loading/empty/error em tudo, tokens `success`/`warning` no tema, datas via `localISODate` (nunca `toISOString` — bug GMT-3).

## 🔴 Dívidas técnicas (resolver cedo)

1. **JWT anon hardcoded na migration `0003_schedule_jobs_and_reminders.sql`** (linhas do `cron.schedule`). Rotacionar a anon key e mover o token para o Supabase Vault (`vault.decrypted_secrets`) numa migration nova que refaça os dois `cron.schedule`. A project ref na 0003 (`kwriuifcwyvdrxtspjiz`) também diverge do `config.toml` (`app-proops`).
2. **Histórico de migrations divergente**: o banco remoto usa versões timestamp (aplicadas via dashboard/MCP: `init_schema`, `security_hardening`, `schedule_jobs_and_reminders`, `atomic_claim_jobs`, `claim_jobs_orphan_recovery`, `finance_core`, `drop_expenses`), enquanto o repo usa `000N_*.sql`. **Nunca rodar `supabase db push` sem antes reconciliar** (`supabase migration repair` ou continuar aplicando via MCP `apply_migration`, que é o fluxo atual).
3. **Types do Supabase não gerados**: hooks usam interfaces manuais. Rodar `npx supabase gen types typescript` e adotar nos hooks quando houver acesso via CLI.
4. **Conta Supabase**: o acesso hoje é via MCP na conta ProOps (reconectada via `/mcp`). O CLI local segue logado na conta pessoal do Gabriel — para usar CLI, `npx supabase login` na conta ProOps ou convidar `gestao@proops.com.br` para a organização.

## 🟡 Detalhes adiados do frontend

5. **Splash/branding**: `src/components/animated-icon.tsx` ainda usa o logo do Expo (`expo-logo.png`, `logo-glow.png`). Precisa de assets de marca (logo Personal ProOps) — trocar imagens e conferir `app.json` (ícone/splash).
6. **Criar/editar lembrete pelo app**: adiado por depender de `@react-native-community/datetimepicker` (dep nativa → rebuild). Fluxo previsto: modal `src/app/reminder-form.tsx` (título + data/hora + chips de recorrência RRULE), registrar no Stack do `_layout.tsx`. Hoje: criação via WhatsApp; pausar/apagar já existem no app.
7. **Editar meta/orçamento/conta** (nome/valores): hoje só criar/arquivar/apagar. Adicionar edição inline (tap no card) se sentir falta.
8. **Transações recorrentes no app**: não há tela para listar/pausar `recurring_transactions` (só via WhatsApp). Adicionar seção em `/finance/transactions` ou tela própria.
9. **Warning do React Compiler** em `transaction-form.tsx` (`watch` do react-hook-form não memoizável) — inofensivo; se incomodar, trocar `watch('kind')` por `useWatch({ control, name: 'kind' })`.
10. **Testes**: zero testes automatizados no app. Mínimo sugerido: teste de `localISODate`/`monthBounds` (fuso) e do reducer de saldo.

## 🔵 FASE 4 — Roadmap v2 (ordem sugerida)

### 4.1 Push notifications de verdade
- Token já é registrado pelo perfil (`profiles.expo_push_token`) e o `send-reminders` já envia push quando há token. Falta:
  - Configurar credenciais FCM/APNs no projeto EAS (`extra.eas.projectId` no app.json se ainda não houver).
  - Alertas de **orçamento a 80%/100%**: função/cron diário que consulta `_budgets_status` e envia push (e template Utility como fallback).
  - Push quando lançamento recorrente é materializado.
  - Deep link da notificação para a tela certa (`scheme appproops`).

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
