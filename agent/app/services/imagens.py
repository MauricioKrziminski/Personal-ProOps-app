"""Imagem pronta para o modelo: a API do Claude só lê JPEG/PNG/GIF/WebP, e a foto do iPhone chega
como HEIC (app e WhatsApp). Tudo vira JPEG; o resto é bônus (tamanho e privacidade)."""
from __future__ import annotations

import io

import pillow_heif
from PIL import Image, ImageOps

pillow_heif.register_heif_opener()

# Abaixo do limite de imagens múltiplas do Claude e ainda legível para cupom.
LADO = 2000


class ImagemInvalida(ValueError):
    pass


def normalizar(dados: bytes, mime: str) -> tuple[bytes, str]:
    """Devolve (JPEG, "image/jpeg"); não-imagem (PDF) passa intacta.

    Regravar sem EXIF/ICC tira o GPS de foto de comprovante antes de ir a um provedor de IA.
    """
    if not mime.startswith("image/"):
        return dados, mime
    try:
        img = Image.open(io.BytesIO(dados))
        if img.format == "JPEG":
            img.draft("RGB", (LADO, LADO))  # decodifica já reduzida: o caminho rápido
        img = ImageOps.exif_transpose(img)
        if img.mode in ("RGBA", "LA", "PA") or "transparency" in img.info:
            img = img.convert("RGBA")
            fundo = Image.new("RGB", img.size, "white")
            fundo.paste(img, mask=img.getchannel("A"))
            img = fundo
        else:
            img = img.convert("RGB")
        img.thumbnail((LADO, LADO))
        saida = io.BytesIO()
        img.save(saida, "JPEG", quality=85, optimize=True)
    except (OSError, SyntaxError, ValueError, Image.DecompressionBombError) as e:
        raise ImagemInvalida(str(e)) from e
    return saida.getvalue(), "image/jpeg"
