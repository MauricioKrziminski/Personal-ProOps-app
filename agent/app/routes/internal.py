"""Rotas chamadas pelo APP (usuário autenticado com JWT do Supabase).

⚠️ Correção de segurança em relação à Edge Function que isto substitui.
A `import-statement` recebia `user_id` e `workspace_id` NO CORPO e confiava
neles: o `verify_jwt = true` do Supabase só provava que ALGUM usuário válido
chamou, não que fosse aquele usuário. Qualquer autenticado podia importar
lançamentos para o workspace de outro só mudando o corpo do POST.

Aqui o user_id sai do `sub` do token — nunca do corpo — e a participação no
workspace é verificada antes de qualquer escrita.
"""

from __future__ import annotations

import asyncio
import logging
from functools import lru_cache
from uuid import UUID

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from app import db
from app.config import get_settings
from app.jobs import importer

log = logging.getLogger(__name__)
router = APIRouter(prefix="/internal", tags=["app"])


@lru_cache
def _jwks() -> jwt.PyJWKClient:
    """Cliente de JWKS, com cache das chaves.

    O projeto assina os tokens com **ES256** (chave assimétrica), não com o
    segredo simétrico legado — conferido no endpoint jwks.json. Verificar com
    HS256 rejeitaria todo token, silenciosamente, com um 401 que parece problema
    de permissão.
    """
    return jwt.PyJWKClient(get_settings().jwks_url, cache_keys=True, lifespan=3600)


def _decode(token: str) -> dict:
    # PyJWKClient busca a chave por HTTP na primeira vez; roda em thread para não
    # travar o event loop (depois vem do cache).
    chave = _jwks().get_signing_key_from_jwt(token)
    return jwt.decode(token, chave.key, algorithms=["ES256"], audience="authenticated")


async def current_user(request: Request) -> UUID:
    """Valida o JWT do Supabase Auth e devolve o dono dele."""
    settings = get_settings()
    auth = request.headers.get("authorization", "")
    if not auth.startswith("Bearer ") or not settings.supabase_url:
        raise HTTPException(status_code=401, detail="unauthorized")
    try:
        payload = await asyncio.to_thread(_decode, auth.removeprefix("Bearer "))
    except jwt.InvalidTokenError as err:
        raise HTTPException(status_code=401, detail="token inválido") from err
    except Exception as err:  # noqa: BLE001 — JWKS fora do ar não é 500 nosso
        log.warning("não consegui verificar o JWT: %s", err)
        raise HTTPException(status_code=401, detail="não foi possível validar o token") from err

    sub = payload.get("sub")
    if not sub:
        raise HTTPException(status_code=401, detail="token sem sub")
    return UUID(sub)


async def ensure_member(user_id: UUID, workspace_id: UUID) -> None:
    row = await db.fetch_one(
        """
        select 1 from public.workspace_members
        where workspace_id = %s and user_id = %s
        """,
        workspace_id,
        user_id,
    )
    if row is None:
        raise HTTPException(status_code=403, detail="workspace não é seu")


class ImportRequest(BaseModel):
    workspace_id: UUID
    content: str = Field(max_length=5_000_000)
    source: str
    filename: str | None = None
    account_id: UUID | None = None


@router.post("/import-statement")
async def import_statement(
    body: ImportRequest, user_id: UUID = Depends(current_user)
) -> dict:
    if body.source not in ("ofx", "csv"):
        raise HTTPException(status_code=400, detail="source tem que ser ofx ou csv")
    await ensure_member(user_id, body.workspace_id)

    try:
        return await importer.run(
            user_id=user_id,
            workspace_id=body.workspace_id,
            content=body.content,
            source=body.source,
            filename=body.filename,
            account_id=body.account_id,
        )
    except importer.ImportError_ as err:
        raise HTTPException(status_code=err.status, detail=err.mensagem) from err
