"""Borda do WhatsApp: recebe da Meta e devolve 200 o mais rápido possível.

Três coisas e só três: valida HMAC, grava na fila, agenda o debounce. Qualquer
trabalho a mais aqui é risco de estourar os 5 segundos da Meta e provocar
reentrega — e reentrega multiplicada por processamento pesado é como um webhook
vira tempestade.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Request, Response

from app import db
from app.config import get_settings
from app.security import thread_id_for, verify_meta_signature
from app.services import tasks

log = logging.getLogger(__name__)
router = APIRouter(tags=["whatsapp"])


@router.get("/whatsapp-inbound")
async def verify(request: Request) -> Response:
    """Verificação do webhook, feita uma vez no painel da Meta."""
    params = request.query_params
    if (
        params.get("hub.mode") == "subscribe"
        and params.get("hub.verify_token") == get_settings().whatsapp_verify_token
    ):
        return Response(content=params.get("hub.challenge", ""), status_code=200)
    return Response(content="forbidden", status_code=403)


@router.post("/whatsapp-inbound")
async def inbound(request: Request) -> Response:
    raw = await request.body()
    if not verify_meta_signature(raw, request.headers.get("x-hub-signature-256")):
        return Response(content="invalid signature", status_code=401)

    # thread_id -> nome da task de debounce anterior (para cancelar)
    threads: dict[str, str | None] = {}
    try:
        import orjson

        corpo = orjson.loads(raw)
        for entry in corpo.get("entry") or []:
            for change in entry.get("changes") or []:
                for mensagem in (change.get("value") or {}).get("messages") or []:
                    phone = mensagem.get("from")
                    wa_id = mensagem.get("id")
                    if not (phone and wa_id):
                        continue
                    thread = thread_id_for(phone)
                    # um insert só: idempotência de entrada e enfileiramento na
                    # MESMA operação (no fluxo antigo eram dois inserts sem
                    # transação, e a falha do segundo sumia com a mensagem)
                    novo = await db.enqueue(
                        wa_message_id=wa_id,
                        thread_id=thread,
                        phone=phone,
                        message_type=mensagem.get("type"),
                        payload=mensagem,
                    )
                    if novo:
                        # ensure_session já devolve a linha com o nome da task
                        # anterior: uma ida ao banco, não duas (o alvo aqui é
                        # responder à Meta em menos de 50ms)
                        sessao = await db.ensure_session(phone, thread)
                        threads[thread] = sessao.get("debounce_task_name")
    except Exception:  # noqa: BLE001
        # NUNCA propagar erro interno para a Meta: 5xx dispara retry storm.
        # A mensagem já pode estar na fila; o cron/próxima task recupera.
        log.exception("webhook: falha ao enfileirar")

    for thread, task_anterior in threads.items():
        try:
            # cancela a espera anterior e recomeça a contagem: janela DESLIZANTE.
            # Sem o cancelamento, a 1ª task dispararia no meio da rajada e o
            # usuário levaria duas respostas para uma sequência só.
            await tasks.cancel(task_anterior)
            nome = await tasks.schedule_debounce(thread)
            await db.set_debounce_task(thread, nome)
        except Exception:  # noqa: BLE001
            # o /worker/sweep é a rede embaixo: mensagem parada há mais de 1
            # minuto é processada mesmo sem a task
            log.exception("debounce falhou (thread=%s) — o sweep recupera", thread)

    return Response(content="ok", status_code=200)
