"""Contexto de correlação dos logs: `thread_id` e `message_id`.

Quem processa uma mensagem faz `with bind(thread_id=..., message_id=...):` e toda linha de log
emitida dentro (inclusive em tasks filhas, que herdam o contextvars) sai com esses campos —
em JSON no Cloud Run (ver `main._configura_logs`).

O elo com o Langfuse é o próprio `thread_id`: ele é o `session_id` de todo trace do turno
(`telemetry.trace`). Havia um campo `trace_id` aqui que ninguém preenchia — gerar um por turno
exigiria um handler do Langfuse por turno, e o handler é compartilhado por todos os clientes.
"""

from __future__ import annotations

import contextvars
from contextlib import contextmanager

CAMPOS = ("thread_id", "message_id")
_vars = {c: contextvars.ContextVar(f"log_{c}", default=None) for c in CAMPOS}


@contextmanager
def bind(**campos):
    """Define campos de correlação enquanto o bloco roda e restaura os anteriores ao sair.

    Campo desconhecido levanta (typo mudo = log sem correlação); valor `None` não altera.
    """
    desconhecidos = set(campos) - set(CAMPOS)
    if desconhecidos:
        raise ValueError(f"campo de log desconhecido: {sorted(desconhecidos)}")
    tokens = [(_vars[k], _vars[k].set(v)) for k, v in campos.items() if v is not None]
    try:
        yield
    finally:
        for var, token in reversed(tokens):
            var.reset(token)


def atuais() -> dict[str, str]:
    """Campos de correlação em vigor (só os preenchidos)."""
    return {c: v for c, var in _vars.items() if (v := var.get()) is not None}
