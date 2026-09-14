"""Crons. Disparados pelo Cloud Scheduler com token OIDC.

Deixaram de sair do pg_cron por dois motivos: o token literal em migration (a
0003 vazou a anon key para o histórico do git) e o fato de a lógica agora viver
aqui. O Scheduler autentica com OIDC — não há segredo para vazar.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.jobs import alerts, checkpoints, reminders, scheduler
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
    a mensagem sempre termina numa ação, e isso é decidido na RPC.

    Carrega junto o **expurgo dos checkpoints do LangGraph**, pelo mesmo motivo que o cron de
    lembretes carrega o `sweep`: um job de manutenção diária não merece um Cloud Scheduler
    próprio (que seria configuração nova no GCP para rodar uma vez por dia), e este cron já
    acorda o container todo dia. Medido no staging em 14/09/2026: as três tabelas de checkpoint
    eram **18 MB de um banco de 35 MB**, sem um único usuário real, e nada nunca apagou uma linha
    delas — o teto de 500 MB da camada gratuita chegaria por aí.

    ⚠️ **A falha do expurgo não derruba o alerta.** Alerta é produto e tem janela do dia; limpeza
    de disco pode esperar 24 h. O inverso — perder o alerta porque um `delete` travou — seria
    trocar o que o usuário vê por manutenção que ninguém vê.
    """
    avisos = await alerts.run()
    try:
        limpeza = await checkpoints.run()
    except Exception:  # noqa: BLE001
        limpeza = {"error": "expurgo de checkpoints falhou"}
    return {"alerts": avisos, "checkpoints": limpeza}
