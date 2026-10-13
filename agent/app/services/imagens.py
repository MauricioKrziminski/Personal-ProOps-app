"""Imagem pronta para o modelo: a API do Claude só lê JPEG/PNG/GIF/WebP, e a foto do iPhone chega
como HEIC (app e WhatsApp). Tudo vira JPEG; o resto é bônus (tamanho e privacidade)."""
from __future__ import annotations

import io
import threading

import pillow_heif
from PIL import Image, ImageOps

pillow_heif.register_heif_opener()

# Abaixo do limite de imagens múltiplas do Claude e ainda legível para cupom.
LADO = 2000
# Memória: o Cloud Run tem 1 GiB e atende 10 requisições por instância. HEIC, PNG e WebP decodificam em
# tamanho cheio (48 MP de iPhone ≈ 150 MB em RGB), e um PNG de 8 MB pode descrever 150 MP. O teto é lido
# do CABEÇALHO, antes de decodificar; o JPEG decodifica já reduzido (`draft`, até 1/8) e aceita mais.
MAX_PIXELS = 50_000_000
MAX_PIXELS_JPEG = 260_000_000
# No máximo duas decodificações ao mesmo tempo por instância (app e WhatsApp juntos).
_DECODIFICANDO = threading.BoundedSemaphore(2)


class ImagemInvalida(ValueError):
    pass


def normalizar(dados: bytes, mime: str) -> tuple[bytes, str]:
    """Devolve (JPEG, "image/jpeg"); não-imagem (PDF) passa intacta.

    Regravar sem EXIF/ICC tira o GPS de foto de comprovante antes de ir a um provedor de IA.
    """
    if not mime.startswith("image/"):
        return dados, mime
    with _DECODIFICANDO:
        return _para_jpeg(dados)


def _para_jpeg(dados: bytes) -> tuple[bytes, str]:
    try:
        img = Image.open(io.BytesIO(dados))
        largura, altura = img.size
        if largura * altura > (MAX_PIXELS_JPEG if img.format == "JPEG" else MAX_PIXELS):
            raise ImagemInvalida(f"imagem grande demais: {largura}x{altura}")
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
    except ImagemInvalida:
        raise
    except (OSError, SyntaxError, ValueError, RuntimeError, Image.DecompressionBombError) as e:
        raise ImagemInvalida(str(e)) from e
    return saida.getvalue(), "image/jpeg"
