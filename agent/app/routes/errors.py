"""Captura de erros do APP e do PAINEL (docs/ADMIN-API.md, seção Observabilidade).

Aberta de propósito: o erro da tela de entrar acontece SEM login. Por isso o JWT é opcional, e quando
vem (e vale) o `user_id` sai do `sub` e de NENHUM outro lugar — o corpo não carrega identidade.
Token vencido ou inválido não derruba o relato: vira anônimo (o crash por sessão expirada é justamente
o que se quer ver).

Defesa de uma rota anônima: corpo ≤ 32 KB, ≤ 20 erros, 429 por IP e por usuário. Máscara de PII e
corte de tamanho em `observabilidade.registrar`.

ponytail: o limite é em memória e por instância (como `ratelimit.py`), e o IP é o último do
`X-Forwarded-For` (o que o balanceador do Cloud Run acrescenta). Contador compartilhado ou Cloud Armor
se virar alvo de abuso real.
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ValidationError

from app import ratelimit
from app.auth import decode_token
from app.services import observabilidade

log = logging.getLogger(__name__)
router = APIRouter(prefix="/internal", tags=["app"])

MAX_CORPO = 32 * 1024
MAX_ERROS = 20
POR_IP_MIN = 30
POR_USUARIO_MIN = 20


# crash derruba o app; render/rejeição são erro não tratado; o resto é relato tratado
_SEVERIDADE = {"crash": "critical", "render": "error", "unhandled_rejection": "error", "error": "warning"}


class ErroIn(BaseModel):
    source: Literal["app", "admin"]
    kind: Literal["crash", "error", "unhandled_rejection", "render"] = "error"
    name: str = "Error"
    message: str = ""
    stack: str | None = None
    route: str | None = None
    platform: str | None = None
    app_version: str | None = None
    occurred_at: datetime | None = None  # aceito pelo contrato; o servidor usa a hora em que recebeu
    context: dict | None = None


class LoteIn(BaseModel):
    errors: list[ErroIn]


def _invalido(mensagem: str) -> JSONResponse:
    return JSONResponse({"error": "invalid_request", "message": mensagem}, status_code=422)


def _ip(request: Request) -> str:
    xff = request.headers.get("x-forwarded-for", "")
    return xff.split(",")[-1].strip() or (request.client.host if request.client else "?")


async def _usuario(request: Request) -> UUID | None:
    auth = request.headers.get("authorization", "")
    if not auth.startswith("Bearer "):
        return None
    try:
        return UUID((await asyncio.to_thread(decode_token, auth.removeprefix("Bearer ")))["sub"])
    except Exception:  # noqa: BLE001 — token ruim = anônimo, nunca recusa o relato
        return None


@router.post("/errors", status_code=202)
async def receber(request: Request):
    ratelimit.checar(f"err-ip:{_ip(request)}", POR_IP_MIN)
    if int(request.headers.get("content-length") or 0) > MAX_CORPO:
        raise HTTPException(status_code=413, detail="corpo grande demais")
    bruto = await request.body()
    if len(bruto) > MAX_CORPO:
        raise HTTPException(status_code=413, detail="corpo grande demais")
    try:
        lote = LoteIn.model_validate(json.loads(bruto))
    except (ValueError, ValidationError):
        return _invalido("Formato inválido.")
    if not lote.errors or len(lote.errors) > MAX_ERROS:
        return _invalido(f"Envie de 1 a {MAX_ERROS} erros.")

    user_id = await _usuario(request)
    if user_id:
        ratelimit.checar(f"err-user:{user_id}", POR_USUARIO_MIN)

    gravados = 0
    for e in lote.errors:
        try:
            await observabilidade.registrar(
                source=e.source, kind=e.kind, severity=_SEVERIDADE[e.kind],
                name=e.name, message=e.message, stack=e.stack, route=e.route, user_id=user_id,
                platform=e.platform if e.platform in ("ios", "android", "web") else None, app_version=e.app_version, context=e.context)
            gravados += 1
        except Exception:  # noqa: BLE001 — best-effort: o app não pode tratar isto como falha dele
            log.warning("erro do app não gravou", exc_info=True)
    return JSONResponse({"accepted": gravados}, status_code=202)
