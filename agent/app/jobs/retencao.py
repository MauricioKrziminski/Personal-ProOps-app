"""Retenção da infraestrutura do agente (LGPD: não guardar além do que o produto usa).

Pega carona no cron diário de alertas, como `checkpoints` e `feedback`. Cada tabela tem prazo
curto e um motivo; quem lê o quê foi conferido antes de cortar:

| tabela | prazo | por quê |
|---|---|---|
| `messages_queue` done/failed | 30 dias | o payload é o texto/mídia do WhatsApp; a idempotência de entrada só precisa de horas/dias (a Meta reenvia em minutos) |
| `pending_actions` resolvida ou expirada | 30 dias | HITL encerrado; o `awaiting` vivo nunca entra (o expurgo de checkpoints depende dele) |
| `draft_actions` expirado | 30 dias | rascunho vale 24 h; guarda o texto cru da pessoa |
| `executed_actions` | 90 dias | idempotência de execução precisa de dias; o feed `agent_activity` mostra só as últimas |
| `alerts_sent` | 90 dias | dedupe é por dia |
| `error_events` | 30 dias | mensagem e contexto de erro (já mascarados); o painel mostra os 50 últimos |
| `error_issues` resolvida/ignorada | 90 dias sem ocorrência | issue aberta nunca sai; os eventos vão pelo prazo acima |
| `whatsapp_sends`, `ai_events` | 13 meses | limite de respostas e custo leem o mês corrente e o anterior; sobra para comparar o mesmo mês do ano anterior |

`app_chat_messages` NÃO entra: é conteúdo da pessoa, visível no app, e sai com a conta.
Teto por tabela e por execução: a sobra vai amanhã e nenhum `delete` segura lock enquanto o
worker responde.
"""

from __future__ import annotations

import logging

from app import db
from app.services import observabilidade

log = logging.getLogger(__name__)

TETO_POR_TABELA = 5000

# (nome, tabela, condição). A condição é SQL fixo daqui, nunca entrada de usuário.
_REGRAS = [
    ("messages_queue", "public.messages_queue",
     "status in ('done', 'failed') and created_at < now() - interval '30 days'"),
    ("pending_actions", "public.pending_actions",
     "(status <> 'awaiting' and coalesce(resolved_at, created_at) < now() - interval '30 days')"
     " or expires_at < now() - interval '30 days'"),
    ("draft_actions", "public.draft_actions", "expires_at < now() - interval '30 days'"),
    ("executed_actions", "public.executed_actions", "executed_at < now() - interval '90 days'"),
    ("alerts_sent", "public.alerts_sent", "sent_on < current_date - 90"),
    ("whatsapp_sends", "public.whatsapp_sends", "created_at < now() - interval '13 months'"),
    ("ai_events", "public.ai_events", "created_at < now() - interval '13 months'"),
    # observabilidade: o evento guarda mensagem e contexto de erro; o issue só sai quando está encerrado
    # (resolvido/ignorado) e sem nenhum evento recente (eventos de 30 dias já saíram pela regra acima)
    ("error_events", "public.error_events", "created_at < now() - interval '30 days'"),
    ("error_issues", "public.error_issues",
     "status in ('resolved', 'ignored') and last_seen < now() - interval '90 days'"),
]


async def run() -> dict:
    """Idempotente. Falha de uma tabela não impede as outras."""
    out: dict = {}
    for nome, tabela, cond in _REGRAS:
        try:
            out[nome] = await db.execute(
                f"delete from {tabela} where ctid = any(array("
                f"select ctid from {tabela} where {cond} limit %s))",
                TETO_POR_TABELA,
            )
        except Exception as err:  # noqa: BLE001 — retenção nunca derruba o cron
            log.exception("retenção de %s falhou", nome)
            await observabilidade.capturar(err, route=f"cron:retencao/{nome}")
            out[nome] = "erro"
    log.info("retenção: %s", out)
    return out
