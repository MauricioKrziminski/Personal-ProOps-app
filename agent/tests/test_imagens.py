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


def test_png_que_descreve_imagem_enorme_e_recusado_antes_de_decodificar():
    # 8000×8000 de uma cor só: poucos KB no arquivo, 64 MP (≈ 256 MB em RGBA) se decodificado
    buf = io.BytesIO()
    Image.new("RGB", (8000, 8000), "white").save(buf, "PNG")
    assert len(buf.getvalue()) < 1_000_000
    with pytest.raises(imagens.ImagemInvalida, match="grande demais"):
        imagens.normalizar(buf.getvalue(), "image/png")


def test_heic_corrompido_e_imagem_invalida():
    buf = io.BytesIO()
    Image.new("RGB", (400, 300), "red").save(buf, "HEIF")
    for quebrado in (buf.getvalue()[: len(buf.getvalue()) // 2], buf.getvalue()[:40]):
        with pytest.raises(imagens.ImagemInvalida):
            imagens.normalizar(quebrado, "image/heic")


async def test_no_maximo_duas_decodificacoes_por_vez_e_a_espera_nao_ocupa_thread(monkeypatch):
    import asyncio
    import threading

    ativas, pico, solta = 0, 0, threading.Event()
    trava = threading.Lock()

    def lenta(dados, mime):
        nonlocal ativas, pico
        with trava:
            ativas += 1
            pico = max(pico, ativas)
        solta.wait(2)
        with trava:
            ativas -= 1
        return dados, "image/jpeg"

    monkeypatch.setattr(imagens, "normalizar", lenta)
    tarefas = [asyncio.create_task(imagens.normalizar_em_fila(b"x", "image/heic")) for _ in range(5)]
    await asyncio.sleep(0.2)
    assert pico == 2
    # com duas presas, o pool de threads continua livre para o resto (ex.: verificar o JWT)
    assert await asyncio.wait_for(asyncio.to_thread(lambda: "ok"), 1) == "ok"
    solta.set()
    await asyncio.gather(*tarefas)
    assert pico == 2
