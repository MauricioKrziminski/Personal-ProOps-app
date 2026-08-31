"""Transcrição de áudio (Groq Whisper) — decisão imutável do projeto.

Áudio do WhatsApp vira texto e segue o fluxo normal do Gemini. Não existe
"entender áudio direto": um texto no meio dá auditoria, teste e correção.
"""

from __future__ import annotations

import httpx

from app.config import get_settings

GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
MODEL = "whisper-large-v3-turbo"


async def transcribe(audio: bytes, filename: str = "audio.ogg") -> str:
    settings = get_settings()
    if not settings.groq_api_key:
        raise RuntimeError("GROQ_API_KEY ausente")

    async with httpx.AsyncClient(timeout=60.0) as client:
        res = await client.post(
            GROQ_URL,
            headers={"Authorization": f"Bearer {settings.groq_api_key}"},
            files={"file": (filename, audio, "application/octet-stream")},
            data={"model": MODEL, "language": "pt"},
        )
    if res.status_code >= 400:
        raise RuntimeError(f"Groq falhou ({res.status_code}): {res.text}")
    return res.json().get("text", "")
