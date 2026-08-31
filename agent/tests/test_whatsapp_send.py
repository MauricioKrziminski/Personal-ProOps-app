"""O envio tem que tentar as DUAS formas do telefone brasileiro.

A Meta entrega o `from` sem o 9º dígito e casa a allowed list pela forma COM o 9
(medido em 31/08/2026, erro 131030). Responder só ao número como veio deixava a
conversa muda, porque `try_send` engole a falha de propósito.
"""

import httpx
import pytest

from app.services import whatsapp


class _ClienteFalso:
    def __init__(self, aceita: set[str], status_recusa: int = 400):
        self.aceita = aceita
        self.status_recusa = status_recusa
        self.tentativas: list[str] = []

    async def post(self, url, headers=None, json=None):
        destino = json["to"]
        self.tentativas.append(destino)
        ok = destino in self.aceita
        return httpx.Response(
            200 if ok else self.status_recusa,
            json={"messages": [{"id": "wamid.X"}]} if ok else {"error": {"code": 131030}},
            request=httpx.Request("POST", url),
        )


@pytest.fixture
def env(monkeypatch):
    from app.config import get_settings

    get_settings.cache_clear()
    monkeypatch.setenv("WHATSAPP_TOKEN", "tok")
    monkeypatch.setenv("WHATSAPP_PHONE_NUMBER_ID", "123")
    yield
    get_settings.cache_clear()


def _instalar(monkeypatch, cliente):
    monkeypatch.setattr(whatsapp, "client", lambda: cliente)


@pytest.mark.asyncio
async def test_cai_para_a_forma_com_o_nono_digito(env, monkeypatch):
    # a Meta entregou sem o 9; só a forma com o 9 está na allowed list
    cliente = _ClienteFalso(aceita={"5535998744200"})
    _instalar(monkeypatch, cliente)

    await whatsapp.send_text("553598744200", "oi")

    assert cliente.tentativas == ["553598744200", "5535998744200"]


@pytest.mark.asyncio
async def test_nao_tenta_de_novo_quando_o_primeiro_da_certo(env, monkeypatch):
    # sem isso, um sucesso seguido de retry mandaria a mensagem DUAS vezes
    cliente = _ClienteFalso(aceita={"553598744200", "5535998744200"})
    _instalar(monkeypatch, cliente)

    await whatsapp.send_text("553598744200", "oi")

    assert cliente.tentativas == ["553598744200"]


@pytest.mark.asyncio
async def test_erro_5xx_nao_troca_de_numero(env, monkeypatch):
    # 5xx é problema do servidor: trocar o destino não ajuda e gastaria uma
    # chamada a mais em cada falha transitória da Graph API
    cliente = _ClienteFalso(aceita=set(), status_recusa=503)
    _instalar(monkeypatch, cliente)

    with pytest.raises(RuntimeError, match="503"):
        await whatsapp.send_text("553598744200", "oi")

    assert cliente.tentativas == ["553598744200"]


@pytest.mark.asyncio
async def test_numero_nao_brasileiro_tenta_uma_vez_so(env, monkeypatch):
    cliente = _ClienteFalso(aceita=set())
    _instalar(monkeypatch, cliente)

    with pytest.raises(RuntimeError):
        await whatsapp.send_text("14155552671", "oi")

    assert cliente.tentativas == ["14155552671"]
