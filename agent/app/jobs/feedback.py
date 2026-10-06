"""Retenção do ciclo de dados: `agent_feedback` guarda texto de conversa (já sanitizado) e é
apagado depois de 180 dias. Pega carona no cron diário de alertas, como o expurgo de checkpoints."""

from __future__ import annotations

import logging

from app import db

log = logging.getLogger(__name__)

RETENCAO_DIAS = 180


async def run() -> dict:
    apagadas = await db.execute(
        "delete from public.agent_feedback where created_at < now() - make_interval(days => %s)",
        RETENCAO_DIAS,
    )
    log.info("expurgo de agent_feedback: %s linhas", apagadas)
    return {"apagadas": apagadas}
