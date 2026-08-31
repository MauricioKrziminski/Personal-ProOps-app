"""Rotas internas do worker. Só Cloud Tasks / Cloud Scheduler entram aqui."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app import db, worker
from app.security import require_internal

log = logging.getLogger(__name__)
router = APIRouter(prefix="/worker", tags=["worker"], dependencies=[Depends(require_internal)])


class ThreadRequest(BaseModel):
    thread_id: str


@router.post("/process-thread")
async def process_thread(body: ThreadRequest) -> dict:
    """Chamada pela task de debounce, 3s depois da última mensagem.

    Erro aqui devolve 500 DE PROPÓSITO: é o retry com backoff do Cloud Tasks que
    dá a segunda chance. Engolir o erro devolvendo 200 seria perder a mensagem.
    """
    try:
        return await worker.process_thread(body.thread_id)
    except Exception as err:  # noqa: BLE001
        log.exception("process_thread falhou")
        raise HTTPException(status_code=500, detail=str(err)) from err


@router.post("/sweep")
async def sweep() -> dict:
    """Rede de segurança: threads com mensagem pendente que ninguém acordou.

    Existe porque o debounce depende do Cloud Tasks, e serviço externo cai. Sem
    isto, uma falha ao agendar a task deixaria a mensagem parada para sempre.
    """
    threads = await db.fetch(
        """
        select distinct thread_id
        from public.messages_queue
        where status = 'pending' and created_at < now() - interval '1 minute'
           or (status = 'processing' and claimed_at < now() - interval '5 minutes')
        limit 50
        """
    )
    processadas = 0
    for linha in threads:
        try:
            await worker.process_thread(linha["thread_id"])
            processadas += 1
        except Exception:  # noqa: BLE001
            log.exception("sweep: thread %s falhou", linha["thread_id"])
    return {"threads": len(threads), "processed": processadas}
