"""Langfuse: rastro de cada nó, aresta, tool e token do grafo.

Registro honesto: isto contraria a regra escrita do projeto ("sem serviços
externos") e foi decisão explícita do dono em 30/08/2026. Consequência prática:
conteúdo de conversa financeira sai do Supabase e vai para um terceiro.

Sem chaves configuradas o grafo roda igual, sem tracing. Telemetria NUNCA pode
ser o motivo de uma mensagem do usuário não ser processada.

API do langfuse 4.x: o cliente `Langfuse(...)` é inicializado uma vez (singleton)
e o `CallbackHandler()` pega esse cliente. Atributos de trace (user, sessão) vão
pelo context manager `propagate_attributes`, não por metadata do LangChain — isso
mudou da v2 para a v4 e vale conferir ao subir versão.
"""

from __future__ import annotations

import contextlib
import logging
from typing import Any

from app.config import get_settings

log = logging.getLogger(__name__)

_handler: Any | None = None
_tentou = False


def handler() -> Any | None:
    global _handler, _tentou
    if _tentou:
        return _handler
    _tentou = True

    settings = get_settings()
    if not (settings.langfuse_public_key and settings.langfuse_secret_key):
        log.info("Langfuse desligado (sem chaves) — o grafo roda sem tracing")
        return None

    try:
        from langfuse import Langfuse
        from langfuse.langchain import CallbackHandler

        Langfuse(
            public_key=settings.langfuse_public_key,
            secret_key=settings.langfuse_secret_key,
            host=settings.langfuse_host,
        )
        _handler = CallbackHandler()
    except Exception:  # noqa: BLE001
        log.exception("Langfuse não inicializou — seguindo sem tracing")
        _handler = None
    return _handler


def callbacks() -> list[Any]:
    h = handler()
    return [h] if h else []


def trace(*, thread_id: str, user_id: str | None, trace_name: str = "whatsapp-message"):
    """Contexto do trace. Sem Langfuse, é um no-op.

    O TELEFONE não entra: é o identificador direto da pessoa e sairia do nosso
    banco para um terceiro. O hash da thread já agrupa a conversa.
    """
    if handler() is None:
        return contextlib.nullcontext()

    from langfuse import propagate_attributes

    return propagate_attributes(
        trace_name=trace_name,
        session_id=thread_id,
        user_id=str(user_id) if user_id else "desconhecido",
        tags=["whatsapp", "personal-proops"],
    )
