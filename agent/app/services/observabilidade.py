"""Erros agrupados (docs/ADMIN-API.md, seção Observabilidade): captura do agente e do que chega por HTTP.

`capturar` é BEST-EFFORT: nunca levanta e nunca demora (prazo curto). Telemetria não pode ser o
motivo de uma resposta falhar. O agrupamento mora no banco (`private.registrar_erro`, upsert atômico);
aqui ficam a normalização, o fingerprint e a máscara de dado pessoal.

Fingerprint = sha256(source + name + primeiros 3 frames normalizados), onde "normalizado" é sem
número de linha/coluna e sem query; sem stack, sha256(source + name + message com dígitos → `#`).
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
import traceback
from typing import Any
from uuid import UUID

from app import db
from app.services import telemetry

log = logging.getLogger(__name__)

MAX_STACK = 8 * 1024
MAX_MESSAGE = 500
MAX_CONTEXT = 4 * 1024
PRAZO_S = 5

_PY = re.compile(r'File "(?P<f>[^"]+)", line \d+, in (?P<fn>.+)')
_UUID = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")
_LINHA_COL = re.compile(r"(:\d+){1,2}(?=\)|$|\s)")
_QUERY = re.compile(r"\?[^)\s:]*")
_JS = re.compile(r"^\s*(at\s+|[\w$<>.\[\] ]*@)")


def _frame(linha: str) -> str | None:
    m = _PY.search(linha)
    if m:  # só os dois últimos segmentos do caminho: o mesmo erro em .venv ou na imagem agrupa igual
        return "/".join(m["f"].split("/")[-2:]) + ":" + m["fn"].strip()
    if _JS.match(linha):
        f = _QUERY.sub("", linha.strip())
        f = _LINHA_COL.sub("", f)
        return re.sub(r"\s+", " ", f.replace("address at ", ""))
    return None


def frames(stack: str | None, n: int = 3) -> list[str]:
    out: list[str] = []
    linhas = (stack or "").splitlines()
    if linhas and linhas[0].startswith("Traceback"):
        linhas.reverse()  # Python lista do mais externo para o mais interno; o que distingue é o interno
    for linha in linhas:
        f = _frame(linha)
        if f:
            out.append(f)
            if len(out) == n:
                break
    return out


def normalizar_mensagem(msg: str) -> str:
    return re.sub(r"\d+", "#", _UUID.sub("<id>", msg or ""))


def fingerprint(source: str, name: str, message: str, stack: str | None) -> str:
    fr = frames(stack)
    partes = [source, name, *fr] if fr else [source, name, normalizar_mensagem(message)]
    return hashlib.sha256("\n".join(partes).encode()).hexdigest()


def _txt(v: Any, limite: int) -> str:
    return telemetry.mascarar_texto(str(v or ""))[:limite]


def _contexto(ctx: Any) -> dict:
    if not isinstance(ctx, dict):
        return {}
    ctx = telemetry.mascarar(data=ctx)
    if len(json.dumps(ctx, default=str)) > MAX_CONTEXT:
        return {"truncado": True}
    return json.loads(json.dumps(ctx, default=str))


def _rota(route: str | None) -> str | None:
    return (route or "").split("?")[0][:200] or None


async def registrar(
    *, source: str, kind: str, severity: str, name: str, message: str, stack: str | None = None,
    route: str | None = None, user_id: UUID | str | None = None, platform: str | None = None,
    app_version: str | None = None, context: dict | None = None,
) -> None:
    """Mascara, calcula o fingerprint e grava. LEVANTA se o banco falhar (use `capturar` no agente)."""
    nome = _txt(name or "Error", 200)
    msg = _txt(message, MAX_MESSAGE)
    pilha = _txt(stack, MAX_STACK) or None
    await db.execute(
        "select private.registrar_erro(%s, %s, %s, %s, %s, %s, %s, %s, %s::uuid, %s, %s, %s::jsonb)",
        fingerprint(source, nome, msg, stack), source, kind, severity,
        f"{nome}: {msg}"[:200] if msg else nome, msg, _rota(route), pilha,
        str(user_id) if user_id else None, (platform or None) and platform[:20],
        (app_version or None) and app_version[:40],
        json.dumps(_contexto(context)),
    )


async def capturar(
    exc: BaseException | None = None, *, nome: str | None = None, mensagem: str | None = None,
    source: str = "agent", kind: str = "error", severity: str = "error", route: str | None = None,
    user_id: UUID | str | None = None, context: dict | None = None,
) -> None:
    """Erro do PRÓPRIO agente. Nunca levanta: falha de gravação vira log."""
    try:
        if exc is not None:
            stack = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
            nome, mensagem = type(exc).__name__, str(exc)
        else:
            stack = None
        async with asyncio.timeout(PRAZO_S):
            await registrar(source=source, kind=kind, severity=severity, name=nome or "Error",
                            message=mensagem or "", stack=stack, route=route, user_id=user_id,
                            context=context)
    except Exception:  # noqa: BLE001 — observabilidade nunca derruba quem chamou
        log.warning("não consegui registrar o erro (%s)", nome or type(exc).__name__, exc_info=True)
