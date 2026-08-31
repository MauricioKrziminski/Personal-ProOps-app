"""Fronteiras de confiança do serviço.

Três entradas públicas na internet, cada uma com o seu próprio segredo:
  - /whatsapp-inbound  -> HMAC SHA-256 da Meta sobre o corpo CRU
  - /hooks/otp         -> standardwebhooks do Supabase Auth
  - /hooks/billing     -> segredo constante-time da RevenueCat
E as rotas internas (/worker, /cron), que exigem OIDC do Cloud Tasks/Scheduler,
com fallback para segredo compartilhado quando isso rodar num VPS.
"""

import base64
import hashlib
import hmac
import re
import time

from fastapi import HTTPException, Request

from app.config import get_settings
from app.domain.phone import canonical

# --------------------------------------------------------------------------
# assinaturas de entrada
# --------------------------------------------------------------------------


def verify_meta_signature(raw_body: bytes, signature_header: str | None) -> bool:
    """X-Hub-Signature-256 = "sha256=<hmac do corpo cru com o app secret>"."""
    secret = get_settings().whatsapp_app_secret
    if not secret or not signature_header or not signature_header.startswith("sha256="):
        return False
    expected = "sha256=" + hmac.new(
        secret.encode(), raw_body, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature_header)


def verify_standardwebhooks(
    raw_body: bytes,
    webhook_id: str | None,
    timestamp: str | None,
    signature_header: str | None,
    secret: str,
    tolerance_seconds: int = 300,
) -> bool:
    """Hook de OTP do Supabase Auth (formato standardwebhooks).

    O header traz uma ou mais assinaturas separadas por espaço ("v1,<b64> v1,<b64>")
    porque o segredo pode estar em rotação — basta UMA casar.
    """
    if not (webhook_id and timestamp and signature_header and secret):
        return False
    try:
        if abs(time.time() - int(timestamp)) > tolerance_seconds:
            return False  # replay
    except ValueError:
        return False

    key = base64.b64decode(secret.removeprefix("v1,").removeprefix("whsec_"))
    signed = f"{webhook_id}.{timestamp}.".encode() + raw_body
    expected = base64.b64encode(hmac.new(key, signed, hashlib.sha256).digest()).decode()

    for part in signature_header.split(" "):
        _, _, value = part.partition(",")
        if value and hmac.compare_digest(expected, value):
            return True
    return False


def verify_shared_secret(header_value: str | None, expected: str) -> bool:
    if not expected or not header_value:
        return False
    return hmac.compare_digest(header_value, expected)


# --------------------------------------------------------------------------
# rotas internas: OIDC (Cloud Tasks / Cloud Scheduler) ou segredo compartilhado
# --------------------------------------------------------------------------


def _verify_oidc(token: str, audience: str) -> bool:
    # import tardio: num VPS sem GCP essas libs podem nem estar configuradas
    from google.auth.transport import requests as ga_requests
    from google.oauth2 import id_token

    try:
        id_token.verify_oauth2_token(token, ga_requests.Request(), audience)
        return True
    except Exception:  # noqa: BLE001 — token inválido é 401, não 500
        return False


async def require_internal(request: Request) -> None:
    """Dependency das rotas /worker/* e /cron/*.

    Cloud Run é público na internet: sem isso, qualquer um dispara o worker.
    O ramo do segredo compartilhado é o que mantém a portabilidade para VPS —
    lá não existe OIDC do Cloud Tasks.
    """
    settings = get_settings()

    auth = request.headers.get("authorization", "")
    if auth.startswith("Bearer ") and settings.oidc_audience:
        if _verify_oidc(auth.removeprefix("Bearer "), settings.oidc_audience):
            return

    if verify_shared_secret(
        request.headers.get("x-internal-secret"), settings.internal_secret
    ):
        return

    raise HTTPException(status_code=401, detail="unauthorized")


# --------------------------------------------------------------------------
# identidade da conversa
# --------------------------------------------------------------------------


def thread_id_for(phone: str) -> str:
    """sha256(salt + telefone canônico).

    Hash e não o telefone cru: o checkpoint guarda valores, contas e notas, e o
    identificador não precisa ser reversível para nada que a gente faz.
    """
    salt = get_settings().thread_salt
    return hashlib.sha256((salt + canonical(phone)).encode()).hexdigest()[:32]


def effective_thread_id(thread_id: str, epoch: int) -> str:
    """O id que vai no config do LangGraph. Epoch corta a conversa por inatividade."""
    return thread_id if epoch == 0 else f"{thread_id}:{epoch}"


# --------------------------------------------------------------------------
# conteúdo não confiável -> prompt
# --------------------------------------------------------------------------

# Fecha qualquer tag do nosso envelope que o usuário (ou um PDF preparado) tente
# escrever, além de tags de papel do modelo.
_TAG_INJECTION = re.compile(
    r"</?\s*(user_input|document_content|system|assistant|model|tool_\w*)\s*/?>",
    re.IGNORECASE,
)
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")

MAX_UNTRUSTED_CHARS = 4000


def sanitize_untrusted(text: str | None) -> str:
    """Neutraliza delimitadores antes de o texto entrar no prompt.

    Não tenta detectar "instrução maliciosa" — isso é filtro de conteúdo e não
    funciona. O que funciona é o texto não conseguir SAIR do envelope, somado ao
    fato de a IA só preencher argumento (quem escreve no banco é tool tipada).
    """
    if not text:
        return ""
    clean = _TAG_INJECTION.sub(" ", text)
    clean = _CONTROL.sub(" ", clean)
    clean = clean.strip()
    if len(clean) > MAX_UNTRUSTED_CHARS:
        clean = clean[:MAX_UNTRUSTED_CHARS] + " […truncado]"
    return clean


def wrap_untrusted(tag: str, text: str | None) -> str:
    """Envelopa conteúdo do usuário/documento como DADO."""
    content = sanitize_untrusted(text)
    return f"<{tag}>\n{content}\n</{tag}>"
