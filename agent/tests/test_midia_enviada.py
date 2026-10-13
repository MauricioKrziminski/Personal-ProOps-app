"""Helper compartilhado de imagem enviada pelo app: MIME, assinatura, tamanho e HEIC."""
import io

import pytest
from fastapi import HTTPException, UploadFile
from starlette.datastructures import Headers

from app.services import midia_enviada


def _arquivo(dados: bytes, mime: str) -> UploadFile:
    return UploadFile(io.BytesIO(dados), filename="f", headers=Headers({"content-type": mime}))


def _imagem(formato: str) -> bytes:
    import pillow_heif  # noqa: F401
    from PIL import Image

    b = io.BytesIO()
    Image.new("RGB", (16, 16), "red").save(b, formato)
    return b.getvalue()


async def _erro(dados, mime) -> HTTPException:
    with pytest.raises(HTTPException) as e:
        await midia_enviada.ler_imagem(_arquivo(dados, mime))
    return e.value


@pytest.mark.asyncio
async def test_jpeg_e_heic_saem_como_jpeg_em_base64():
    for formato, mime in (("JPEG", "image/jpeg"), ("HEIF", "image/heic")):
        m = await midia_enviada.ler_imagem(_arquivo(_imagem(formato), mime))
        assert m["mime_type"] == "image/jpeg" and m["data_b64"]


@pytest.mark.asyncio
async def test_mime_fora_da_lista_e_415():
    e = await _erro(_imagem("JPEG"), "application/pdf")
    assert (e.status_code, e.code) == (415, "unsupported_image")


@pytest.mark.asyncio
async def test_assinatura_falsa_e_422():
    e = await _erro(b"%PDF-1.4 ...", "image/jpeg")
    assert (e.status_code, e.code) == (422, "invalid_image")


@pytest.mark.asyncio
async def test_grande_demais_e_413():
    e = await _erro(_imagem("JPEG") + b"0" * midia_enviada.MAX_IMAGEM, "image/jpeg")
    assert (e.status_code, e.code) == (413, "image_too_large")
