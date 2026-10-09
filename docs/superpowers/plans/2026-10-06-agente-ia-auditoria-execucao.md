# Execução da auditoria do agente — 06/10/2026

Fonte: `docs/qa/2026-10-06-auditoria-agente-ia.md` (Parte 1 = defeitos, Parte 2 = arquitetura).
Linha de base: `pytest` 1594 verdes, `ruff check app --select F,E9` limpo.

Travas: nada em produção (migration só no staging); Gemini só pela chave gratuita do
`agent/.env`, e se a cota estourar troca-se o modelo do papel por `GEMINI_MODEL_<PAPEL>`;
commit de uma linha sem co-autor; nenhuma tag.

## Onda 1 — paralela, arquivos disjuntos (worktrees)

| frente | itens | arquivos |
|---|---|---|
| W1a fila e borda | C3, A2, A7, A8, M1, M8, deadline por turno, `_pool` duplicado, `verify_token`, detalhe do 500 interno | migration nova do claim, `agent_migrations.sql`, `worker.py`, `routes/worker.py`, `routes/inbound.py`, `jobs/checkpoints.py`, `jobs/reminders.py`, `db.py` (pools/fila), `config.py`, `setup-gcp.sh` |
| W1b higiene de borda | A4, `compare_digest` em bytes, `hooks` sem `str(err)`, logs da Meta, `_checa_producao`, teto de áudio, cliente Groq, retry Meta/Groq, timeout do Cloud Tasks, logs JSON com correlação, "digitando…" | `security.py`, `routes/hooks.py`, `services/whatsapp.py`, `services/groq.py`, `services/tasks.py`, `main.py` |
| W2 camada LLM | A1, A5, A6, M5, M7, 7.1, 7.2, disjuntor, fast-path do "sim", máscara de PII no Langfuse, rótulo por canal | `services/gemini.py`, `services/telemetry.py`, `conversation.py`, `db.record_ai_event`, `domain/confirm.py`, `domain/draft.py`, `jobs/importer.py`, `routes/chat.py`, `app_chat.py`, migration de `ai_events` |
| W3 interpretação | C1, C2, M2, M3, M4, M6, A9, B1, `ilike`, 8.1 | `tools/queries.py`, `graph/schemas.py`, `graph/prompts.py`, `graph/nodes.py`, `domain/matching.py`, `tools/resolve.py`, `domain/installment_scope.py`, `routes/finance_draft.py`, `tools/resources.py` (só "último dia") |

## Onda 2 — depois do merge da onda 1

- W4 atomicidade (A3 + par criar/apagar numa transação): `db.py` (unidade de trabalho por
  contextvar), `tools/registry.py`, `nodes._executar`.
- Sonda do teto de 252 (eu, Gemini real) → decide o caminho do `FinanceAction`.
- W5 pgvector: busca semântica de lançamento (8.2) + exemplos dinâmicos (8.3).
- W6 ciclo de dados (9) + memória de apelidos (8.4) + unit economics (7.3).
- W7 CI, cache de resultado da avaliação, avaliação online, modo sombra (10).

## Onda 3

- Prompt modular / consolidação (M10, 11), cascata objetiva, `thinking_level` medido, cache
  explícito por limiar, roteador por embedding atrás de flag.
- RLS como segunda camada (13), limite de taxa por usuário, alertas e orçamento em `setup-gcp.sh`.
- Avaliação completa com Gemini real, suíte SQL inteira, docs (`agent.md`, `ia.md`).
