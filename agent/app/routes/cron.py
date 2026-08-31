"""Crons. Disparados pelo Cloud Scheduler com token OIDC.

Deixaram de sair do pg_cron por dois motivos: o token literal em migration (a
0003 vazou a anon key para o histórico do git) e o fato de a lógica agora viver
aqui. O Scheduler autentica com OIDC — não há segredo para vazar.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.jobs import alerts, reminders, scheduler
from app.routes.worker import sweep
from app.security import require_internal

router = APIRouter(prefix="/cron", tags=["cron"], dependencies=[Depends(require_internal)])


@router.post("/reminders")
async def run_reminders() -> dict:
    """A cada minuto. Pontualidade de lembrete é o produto.

    Carrega junto o `sweep` da fila: se o agendamento no Cloud Tasks falhar (ou a
    task se perder), a mensagem ficaria parada para sempre — que é exatamente o
    bug de perda silenciosa que esta migração existe para matar. Rede embaixo da
    rede, e de graça: este cron já acorda o container todo minuto.
    """
    lembretes = await reminders.run()
    try:
        resgate = await sweep()
    except Exception:  # noqa: BLE001
        resgate = {"error": "sweep falhou"}
    return {"reminders": lembretes, "sweep": resgate}


@router.post("/finance-scheduler")
async def run_scheduler() -> dict:
    """De hora em hora: materializa recorrentes, fecha faturas, tira o snapshot."""
    return await scheduler.run()


@router.post("/alerts")
async def run_alerts() -> dict:
    """Diário. Alerta que só informa é o que faz desinstalar no segundo mês —
    a mensagem sempre termina numa ação, e isso é decidido na RPC."""
    return await alerts.run()
