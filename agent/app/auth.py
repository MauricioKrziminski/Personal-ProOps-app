"""Quem está chamando: JWT do Supabase Auth.

Estava dentro de `routes/internal.py`. Saiu de lá quando a aba Agente passou a
precisar da mesma verificação: duas cópias da checagem de token é como uma delas
deixa de validar o issuer e ninguém percebe até alguém tentar.

⚠️ O `user_id` sai do `sub` do token e de NENHUM outro lugar. A
`import-statement` antiga lia `user_id` e `workspace_id` do corpo do POST e
confiava neles: o `verify_jwt = true` do Supabase só provava que ALGUM usuário
válido chamou, não que fosse aquele. Qualquer autenticado importava lançamentos
para o workspace de outro.
"""

from __future__ import annotations

import asyncio
import logging
from functools import lru_cache
from uuid import UUID

import jwt
from fastapi import HTTPException, Request

from app import db
from app.config import get_settings

log = logging.getLogger(__name__)


@lru_cache
def _jwks() -> jwt.PyJWKClient:
    """Cliente de JWKS, com cache das chaves.

    O projeto assina os tokens com **ES256** (chave assimétrica), não com o
    segredo simétrico legado — conferido no endpoint jwks.json. Verificar com
    HS256 rejeitaria todo token, silenciosamente, com um 401 que parece problema
    de permissão.
    """
    return jwt.PyJWKClient(get_settings().jwks_url, cache_keys=True, lifespan=3600)


def decode_token(token: str) -> dict:
    """O corpo do token, ou `InvalidTokenError`.

    Cada trava aqui fecha um jeito diferente de entrar:

    - `algorithms=["ES256"]` — sem isso, `alg: HS256` assinado com a chave
      PÚBLICA (que é pública) passaria: a confusão de algoritmo clássica.
    - `issuer` — o `aud` é `authenticated` em TODO projeto Supabase do mundo.
      Sem checar o issuer, um token de outro projeto entra aqui.
    - `require` — `exp` ausente é token eterno, e `sub` ausente é um usuário sem
      dono. As duas coisas precisam ser exigidas, não só lidas.
    """
    chave = _jwks().get_signing_key_from_jwt(token)
    return jwt.decode(
        token,
        chave.key,
        algorithms=["ES256"],
        audience="authenticated",
        issuer=get_settings().jwt_issuer,
        options={"require": ["exp", "iss", "aud", "sub"]},
    )


async def current_user(request: Request) -> UUID:
    """Valida o JWT do Supabase Auth e devolve o dono dele."""
    settings = get_settings()
    auth = request.headers.get("authorization", "")
    if not auth.startswith("Bearer ") or not settings.supabase_url:
        raise HTTPException(status_code=401, detail="unauthorized")
    try:
        # PyJWKClient busca a chave por HTTP na primeira vez; roda em thread para
        # não travar o event loop (depois vem do cache).
        payload = await asyncio.to_thread(decode_token, auth.removeprefix("Bearer "))
    except jwt.InvalidTokenError as err:
        raise HTTPException(status_code=401, detail="token inválido") from err
    except Exception as err:  # noqa: BLE001 — JWKS fora do ar não é 500 nosso
        log.warning("não consegui verificar o JWT: %s", err)
        raise HTTPException(status_code=401, detail="não foi possível validar o token") from err

    return UUID(payload["sub"])


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
        raise HTTPException(status_code=403, detail="fora do workspace")
