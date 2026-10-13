import io

import pytest
from PIL import Image

from app.services import imagens


def _abre(b):
    return Image.open(io.BytesIO(b))


def test_heic_com_orientacao_vira_jpeg_transposto_sem_exif():
    img = Image.new("RGB", (3000, 1000), "red")
    exif = Image.Exif()
    exif[0x0112] = 6  # gira 90 graus: 3000x1000 vira 1000x3000
    buf = io.BytesIO()
    img.save(buf, "HEIF", exif=exif.tobytes())
    saida, mime = imagens.normalizar(buf.getvalue(), "image/heic")
    assert mime == "image/jpeg" and saida.startswith(b"\xff\xd8\xff")
    r = _abre(saida)
    assert r.size[1] == 2000 and r.size[0] < r.size[1]
    assert not r.getexif()


def test_png_com_transparencia_vira_jpeg_rgb():
    buf = io.BytesIO()
    Image.new("RGBA", (50, 50), (0, 0, 0, 0)).save(buf, "PNG")
    saida, mime = imagens.normalizar(buf.getvalue(), "image/png")
    r = _abre(saida)
    assert mime == "image/jpeg" and r.mode == "RGB" and r.getpixel((5, 5))[0] > 240


def test_jpeg_grande_reduz_o_maior_lado():
    buf = io.BytesIO()
    Image.new("RGB", (4000, 3000), "blue").save(buf, "JPEG")
    saida, _ = imagens.normalizar(buf.getvalue(), "image/jpeg")
    assert max(_abre(saida).size) == 2000


def test_pdf_passa_intacto():
    pdf = b"%PDF-1.4 xyz"
    assert imagens.normalizar(pdf, "application/pdf") == (pdf, "application/pdf")


def test_lixo_e_imagem_invalida():
    with pytest.raises(imagens.ImagemInvalida):
        imagens.normalizar(b"nao e imagem" * 10, "image/jpeg")
