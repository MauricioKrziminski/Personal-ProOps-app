"""Pergunta com botões/lista: forma do payload, truncamento e fallback.

O formato é escolhido pelo NÚMERO de candidatos, e o limite é físico da Meta:
3 botões, 10 linhas de lista. Estourar não dá erro bonito — vira 400 que o
`try_send` engole, e a pergunta simplesmente não chega ao usuário.
"""

import httpx
import pytest

from app import conversation
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


@pytest.mark.asyncio
async def test_menu_de_cartoes_sai_como_lista_de_verdade(cliente):
    """A Lista Interativa do rascunho passa pelo MESMO envio das confirmações.

    Ela nasceu depois (31/08/2026), e o risco era montar uma spec que o
    `try_send_interactive` não reconhecesse e caísse em texto sem ninguém notar —
    que é justamente a queixa que o menu existe para resolver.
    """
    from app import worker

    cartoes = [{"id": f"c{i}", "name": f"Cartão {i}"} for i in range(4)]
    spec = conversation._pergunta_cartao("d1", cartoes, "Qual cartão?")
    await whatsapp.try_send_interactive("5511", spec)

    inter = cliente.enviados[0]["interactive"]
    assert inter["type"] == "list"
    linhas = inter["action"]["sections"][0]["rows"]
    assert [l["id"] for l in linhas][:2] == ["ds:d1:c:c0", "ds:d1:c:c1"]
    assert linhas[-1]["id"] == "ds:d1:no"
    assert all(len(l["title"]) <= whatsapp.ROW_TITLE_MAX for l in linhas)


@pytest.mark.asyncio
async def test_menu_de_cartoes_cai_para_texto_com_os_nomes(cliente, monkeypatch):
    from app import worker

    async def falha(*a, **k):
        raise RuntimeError("400")

    monkeypatch.setattr(whatsapp, "send_list", falha)
    cartoes = [{"id": f"c{i}", "name": f"Cartão {i}"} for i in range(4)]
    await whatsapp.try_send_interactive(
        "5511", conversation._pergunta_cartao("d1", cartoes, "Qual cartão?")
    )

    corpo = cliente.enviados[0]["text"]["body"]
    assert "Cartão 0" in corpo and "nome" in corpo.lower()


@pytest.mark.asyncio
async def test_corpo_longo_divide_em_texto_e_botoes(cliente):
    """Corpo > 800 bytes envia o texto completo primeiro e depois os botões com prompt conciso."""
    corpo_gigante = "📊 Extrato Detalhado:\n" + ("• Gasto em restaurante: R$ 150,00\n" * 25)
    assert len(corpo_gigante.encode("utf-8")) > 800

    await whatsapp.send_buttons("5511", corpo_gigante, [("qpage:3", "Ver mais")])

    assert len(cliente.enviados) == 2
    # 1ª mensagem: Texto completo sem corte
    assert cliente.enviados[0]["type"] == "text"
    assert cliente.enviados[0]["text"]["body"] == corpo_gigante.strip()
    # 2ª mensagem: Botão interativo com prompt curto
    assert cliente.enviados[1]["type"] == "interactive"
    inter = cliente.enviados[1]["interactive"]
    assert inter["type"] == "button"
    assert inter["body"]["text"] == "Deseja ver mais detalhes ou opções?"
    assert inter["action"]["buttons"][0]["reply"]["title"] == "Ver mais"



@pytest.mark.asyncio
async def test_a_lista_do_whatsapp_leva_as_opcoes_no_CORPO_tambem(cliente):
    """A lista do WhatsApp esconde as linhas atrás de "Escolher".

    Com 3+ candidatos a pergunta vira `ui: "list"`, e ali as opções só aparecem
    depois de um toque. O corpo que não as repete deixa na tela uma pergunta
    sem nenhuma resposta possível — em 09/09/2026 o usuário recebeu só
    "🤔 apagar qual?" com NOVE lançamentos abertos, não viu nenhum, e tentou
    responder por escrito três vezes.

    ⚠️ **A repetição mora no ENVIO, não no motor** (11/09/2026). Ela estava no
    `body` que `_pergunta` devolve, e esse mesmo `body` é o que o chat do app
    mostra — onde as opções JÁ são controles na tela. Resultado: a lista
    aparecia duas vezes, uma como texto e outra como botão, e a queixa foi
    literal ("que poluição visual é essa do agente?"). Aqui a asserção é sobre
    o que chega no aparelho, que é o que o defeito original quebrava.
    """
    candidatos = [
        {"id": f"t{i}", "label": f"R$ {i}0,00 café", "when": "09/09"} for i in range(1, 10)
    ]
    saida = conversation._pergunta(
        {"kind": "choice", "summary": "apagar qual?"}, candidatos, {"id": "p1"}
    )
    assert saida["ui"] == "list"
    # O motor devolve só a pergunta: é o que o app desenha acima dos controles.
    for c in candidatos:
        assert c["label"] not in saida["body"]

    await whatsapp.send_list("5511", saida["body"], saida["label"], saida["rows"])

    corpo = cliente.enviados[-1]["interactive"]["body"]["text"]
    for i, c in enumerate(candidatos, 1):
        assert f"{i}) {c['label']}" in corpo


def test_resumo_que_ja_e_pergunta_nao_ganha_outra():
    """"apagar qual?" + "— qual deles?" era a mesma pergunta duas vezes."""
    um = conversation._pergunta(
        {"kind": "choice", "summary": "apagar qual?"},
        [{"id": "t1", "label": "R$ 20,00 café"}],
        {"id": "p1"},
    )
    assert "qual deles" not in um["body"]

    # e o resumo que NÃO é pergunta continua ganhando a dela
    dois = conversation._pergunta(
        {"kind": "choice", "summary": "apagar o gasto"},
        [{"id": "t1", "label": "R$ 20,00 café"}],
        {"id": "p1"},
    )
    assert dois["body"].startswith("🤔 apagar o gasto — qual deles?")
