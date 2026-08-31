"""Pergunta com botões/lista: forma do payload, truncamento e fallback.

O formato é escolhido pelo NÚMERO de candidatos, e o limite é físico da Meta:
3 botões, 10 linhas de lista. Estourar não dá erro bonito — vira 400 que o
`try_send` engole, e a pergunta simplesmente não chega ao usuário.
"""

import httpx
import pytest

from app.services import whatsapp


class _ClienteFalso:
    def __init__(self, status=200):
        self.status = status
        self.enviados: list[dict] = []

    async def post(self, url, headers=None, json=None):
        self.enviados.append(json)
        return httpx.Response(
            self.status,
            json={"messages": [{"id": "wamid.X"}]} if self.status < 400 else {"error": {}},
            request=httpx.Request("POST", url),
        )


@pytest.fixture
def cliente(monkeypatch):
    from app.config import get_settings

    get_settings.cache_clear()
    monkeypatch.setenv("WHATSAPP_TOKEN", "tok")
    monkeypatch.setenv("WHATSAPP_PHONE_NUMBER_ID", "123")
    c = _ClienteFalso()
    monkeypatch.setattr(whatsapp, "client", lambda: c)
    yield c
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_botoes_tem_a_forma_que_a_meta_espera(cliente):
    await whatsapp.send_buttons("5511", "Confirma?", [("ok", "Confirmar"), ("no", "Cancelar")])

    inter = cliente.enviados[0]["interactive"]
    assert cliente.enviados[0]["type"] == "interactive"
    assert inter["type"] == "button"
    assert [b["reply"]["id"] for b in inter["action"]["buttons"]] == ["ok", "no"]


@pytest.mark.asyncio
async def test_lista_poe_valor_e_data_na_descricao(cliente):
    # título tem 24 chars; a informação que distingue as opções vive na
    # descrição (72), senão ela seria a primeira coisa a ser truncada
    await whatsapp.send_list("5511", "Qual?", "Escolher",
                             [("c:1", "1) mercado", "R$ 45,00 · 30/08")])

    linha = cliente.enviados[0]["interactive"]["action"]["sections"][0]["rows"][0]
    assert linha["id"] == "c:1"
    assert linha["description"] == "R$ 45,00 · 30/08"


@pytest.mark.asyncio
async def test_truncamento_preserva_o_numero_da_opcao(cliente):
    # duas opções longas não podem virar o mesmo texto na tela: o prefixo
    # numérico é o que garante que continuam distinguíveis
    longo1 = "1) " + "supermercado extra pinheiros " * 3
    longo2 = "2) " + "supermercado extra pinheiros " * 3
    await whatsapp.send_buttons("5511", "Qual?", [("a", longo1), ("b", longo2)])

    t1, t2 = [b["reply"]["title"] for b in cliente.enviados[0]["interactive"]["action"]["buttons"]]
    assert len(t1) <= whatsapp.BTN_TITLE_MAX and len(t2) <= whatsapp.BTN_TITLE_MAX
    assert t1.startswith("1)") and t2.startswith("2)")
    assert t1 != t2


@pytest.mark.asyncio
async def test_estourar_o_limite_e_erro_de_programacao(cliente):
    with pytest.raises(ValueError, match="3 botões"):
        await whatsapp.send_buttons("5511", "x", [("a", "1"), ("b", "2"), ("c", "3"), ("d", "4")])
    with pytest.raises(ValueError, match="10 linhas"):
        await whatsapp.send_list("5511", "x", "y", [(str(i), str(i), "") for i in range(11)])


@pytest.mark.asyncio
async def test_falha_no_interativo_cai_para_texto_com_a_lista(monkeypatch):
    from app.config import get_settings

    get_settings.cache_clear()
    monkeypatch.setenv("WHATSAPP_TOKEN", "tok")
    monkeypatch.setenv("WHATSAPP_PHONE_NUMBER_ID", "123")
    c = _ClienteFalso(status=400)
    monkeypatch.setattr(whatsapp, "client", lambda: c)

    await whatsapp.try_send_interactive(
        "5511",
        {"ui": "buttons", "body": "Qual?", "buttons": [("a", "1) x")],
         "text": "Qual?\n1) x\nResponde com o número."},
    )

    # a última tentativa tem que ser texto puro, com a lista numerada dentro
    ultimo = c.enviados[-1]
    assert ultimo["type"] == "text"
    assert "1) x" in ultimo["text"]["body"]
    get_settings.cache_clear()
