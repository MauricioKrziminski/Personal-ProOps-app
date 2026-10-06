"""Transcrição de áudio (Groq Whisper) — decisão imutável do projeto.

Áudio do WhatsApp vira texto e segue o fluxo normal do Gemini. Não existe
"entender áudio direto": um texto no meio dá auditoria, teste e correção.
"""

from __future__ import annotations

import asyncio

import httpx

from app.config import get_settings

GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
MODEL = "whisper-large-v3-turbo"
_TENTATIVAS = 3  # 1 + 2 novas: transcrever é idempotente
_BACKOFF = 0.5

_client: httpx.AsyncClient | None = None


def client() -> httpx.AsyncClient:
    """Um cliente por processo: handshake TLS por áudio é custo à toa."""
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=60.0)
    return _client


async def close_client() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


async def transcribe(audio: bytes, filename: str = "audio.ogg") -> str:
    settings = get_settings()
    if not settings.groq_api_key:
        raise RuntimeError("GROQ_API_KEY ausente")

    for tentativa in range(_TENTATIVAS):
        ultima = tentativa == _TENTATIVAS - 1
        try:
            res = await client().post(
                GROQ_URL,
                headers={"Authorization": f"Bearer {settings.groq_api_key}"},
                files={"file": (filename, audio, "application/octet-stream")},
                data={"model": MODEL, "language": "pt"},
            )
        except (httpx.TransportError, httpx.TimeoutException):
            if ultima:
                raise
        else:
            transitorio = res.status_code == 429 or res.status_code >= 500
            if ultima or not transitorio:
                break
        await asyncio.sleep(_BACKOFF * (tentativa + 1))
    if res.status_code >= 400:
        # sem o corpo: pode ecoar o áudio/transcrição
        raise RuntimeError(f"Groq falhou ({res.status_code})")
    return res.json().get("text", "")
