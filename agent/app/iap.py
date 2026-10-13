"""Assinatura do IAP (Identity-Aware Proxy) na frente do painel /admin.

Com o IAP ligado no serviço do Cloud Run, só chega aqui quem passou pelo login do Google e está na
política do IAP. Conferir a assinatura é a segunda trava que a documentação do IAP pede: se o IAP for
desligado por engano, ou a requisição chegar por outro caminho, o header falta (ou é forjado) e o
painel recusa. Doc: https://cloud.google.com/iap/docs/signed-headers-howto
"""

from __future__ import annotations

import asyncio
from functools import lru_cache

import jwt

CHAVES = "https://www.gstatic.com/iap/verify/public_key-jwk"
EMISSOR = "https://cloud.google.com/iap"


@lru_cache
def _jwks() -> jwt.PyJWKClient:
    return jwt.PyJWKClient(CHAVES, cache_keys=True, lifespan=3600)


def verificar(assercao: str, audiencia: str) -> dict:
    """Claims do IAP, ou levanta. ES256, `aud` e `iss` exatos, `exp`/`iat` obrigatórios."""
    if not assercao or not audiencia:
        raise jwt.InvalidTokenError("sem asserção do IAP ou sem audiência configurada")
    chave = _jwks().get_signing_key_from_jwt(assercao)
    return jwt.decode(
        assercao, chave.key, algorithms=["ES256"], audience=audiencia, issuer=EMISSOR,
        options={"require": ["exp", "iat", "aud", "iss", "sub", "email"]}, leeway=30,
    )


async def email_autorizado(assercao: str | None, audiencia: str, emails: set[str]) -> str | None:
    """O e-mail do IAP, se a asserção é válida e o e-mail está na lista; senão None."""
    try:
        # PyJWKClient busca as chaves por HTTP na primeira vez (depois, cache de 1 h): fora do loop
        claims = await asyncio.to_thread(verificar, assercao or "", audiencia)
    except Exception:  # noqa: BLE001 — qualquer falha de verificação é "não passou"
        return None
    # O claim `email` da asserção vem sem prefixo (o `accounts.google.com:` é do header
    # `x-goog-authenticated-user-email`, que NÃO é usado): igualdade exata, sem recorte.
    email = str(claims.get("email") or "").strip().lower()
    return email if email and email in emails else None
