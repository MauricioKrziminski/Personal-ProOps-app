"""Debounce por Cloud Tasks — o container pode dormir entre mensagens.

Timer em memória (`asyncio.sleep`) obrigaria uma instância sempre ligada, o que
mata o scale-to-zero do Cloud Run. Aqui cada mensagem APAGA a task agendada da
thread e cria outra a +3s: janela deslizante de verdade, não bucket de tempo.

Se a task anterior já executou, o delete falha com NOT_FOUND (ignorado) e o
worker daquela execução simplesmente não acha mensagem pendente — no-op barato.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import timedelta

from app.config import get_settings
from app.domain.dates import now_utc

log = logging.getLogger(__name__)

_client = None


def _tasks_client():
    global _client
    if _client is None:
        from google.cloud import tasks_v2

        _client = tasks_v2.CloudTasksAsyncClient()
    return _client


async def cancel(task_name: str | None) -> None:
    """Cancela a task de debounce anterior. NOT_FOUND é esperado, não é erro."""
    if not task_name or get_settings().debounce_backend != "cloud_tasks":
        return
    try:
        await _tasks_client().delete_task(request={"name": task_name})
    except Exception as err:  # noqa: BLE001
        log.debug("delete_task ignorado (%s): %s", task_name, err)


async def schedule_debounce(thread_id: str) -> str | None:
    """Agenda o worker para daqui a DEBOUNCE_SECONDS. Devolve o nome da task."""
    settings = get_settings()

    if settings.debounce_backend == "inline":
        # Dev local: sem GCP. Dorme e chama o worker no mesmo processo.
        asyncio.create_task(_inline_worker(thread_id, settings.debounce_seconds))
        return None

    from google.cloud import tasks_v2
    from google.protobuf import timestamp_pb2

    client = _tasks_client()
    parent = client.queue_path(settings.gcp_project, settings.gcp_location, settings.tasks_queue)
    # Nome sempre novo: o Cloud Tasks bloqueia reuso de nome por ~1h depois da
    # execução, então reaproveitar um id determinístico faria a 2ª mensagem da
    # conversa perder o debounce em silêncio.
    task_id = f"deb-{thread_id[:16]}-{uuid.uuid4().hex[:12]}"

    quando = timestamp_pb2.Timestamp()
    quando.FromDatetime(now_utc() + timedelta(seconds=settings.debounce_seconds))

    task = {
        "name": client.task_path(
            settings.gcp_project, settings.gcp_location, settings.tasks_queue, task_id
        ),
        "schedule_time": quando,
        "http_request": {
            "http_method": tasks_v2.HttpMethod.POST,
            "url": settings.worker_url,
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps({"thread_id": thread_id}).encode(),
            "oidc_token": {
                "service_account_email": settings.tasks_sa_email,
                "audience": settings.oidc_audience or settings.worker_url,
            },
        },
    }
    criada = await client.create_task(request={"parent": parent, "task": task})
    return criada.name


async def _inline_worker(thread_id: str, delay: int) -> None:
    await asyncio.sleep(delay)
    from app.worker import process_thread  # import tardio: evita ciclo

    try:
        await process_thread(thread_id)
    except Exception:  # noqa: BLE001
        log.exception("worker inline falhou (thread=%s)", thread_id)
