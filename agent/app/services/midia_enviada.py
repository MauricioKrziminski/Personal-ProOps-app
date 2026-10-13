"""Imagem enviada pelo app (multipart): valida e normaliza, uma vez só para todas as rotas.

A imagem NUNCA é guardada: vira `{mime_type, data_b64}` na memória do turno e some.
"""
from __future__ import annotations

import base64

from fastapi import HTTPException, UploadFile

from app.services import imagens

MAX_IMAGEM = 8 * 1024 * 1024  # o mesmo teto da mídia do WhatsApp (`worker.MAX_MEDIA_BYTES`)
IMAGENS = {"image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"}
# Texto que o grafo recebe quando a pessoa não escreveu legenda (o mesmo do worker do WhatsApp).
TEXTO_SEM_LEGENDA = "Extraia os lançamentos deste documento (cupom, comprovante ou fatura)."


def _erro(status: int, code: str, message: str) -> HTTPException:
    erro = HTTPException(status_code=status, detail=message)
    erro.code = code  # type: ignore[attr-defined]
    return erro


def assinatura_de_imagem(b: bytes) -> bool:
    """Estrutura: os bytes são mesmo de uma imagem do tipo aceito (não um PDF com nome de foto)."""
    return (
        b.startswith(b"\xff\xd8\xff")
        or b.startswith(b"\x89PNG\r\n\x1a\n")
        or (b[:4] == b"RIFF" and b[8:12] == b"WEBP")
        or (b[4:8] == b"ftyp" and b[8:12] in {b"heic", b"heix", b"mif1", b"msf1", b"heif"})
    )


async def ler_imagem(file: UploadFile) -> dict:
    """`{mime_type, data_b64}` já normalizado (JPEG), ou HTTPException com `.code`."""
    try:
        if file.content_type not in IMAGENS:
            raise _erro(415, "unsupported_image", "Formato de imagem não aceito.")
        dados = await file.read(MAX_IMAGEM + 1)
    finally:
        await file.close()
    if len(dados) > MAX_IMAGEM:
        raise _erro(413, "image_too_large", "A imagem é grande demais. Mande um print.")
    if not assinatura_de_imagem(dados):
        raise _erro(422, "invalid_image", "O arquivo não é uma imagem válida.")
    try:
        dados, mime = await imagens.normalizar_em_fila(dados, file.content_type)
    except imagens.ImagemInvalida:
        raise _erro(422, "invalid_image", "O arquivo não é uma imagem válida.") from None
    return {"mime_type": mime, "data_b64": base64.b64encode(dados).decode()}
