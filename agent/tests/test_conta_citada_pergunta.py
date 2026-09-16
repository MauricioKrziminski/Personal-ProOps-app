"""Conta citada que não resolve VIRA PERGUNTA, nunca a conta padrão.

A regra é do dono do produto e vale para o agente inteiro: *"ele tem que
perguntar sempre que tiver dúvida, nunca deduzir"*. Aqui ela tem dente:
`resolve_account` devolvia `None` em três situações diferentes — não citou,
citou e não existe, citou e casa com duas — e as três caíam no mesmo
`or await default_account(...)`.
"""

from uuid import UUID, uuid4

import pytest

from app import db
from app.graph.schemas import FinanceAction, FinanceActionType
from app.tools import finance
from app.tools.base import ExecContext
from app.tools.guards import Level1Error

WS = UUID("22222222-2222-2222-2222-222222222222")
USER = UUID("11111111-1111-1111-1111-111111111111")
PADRAO = uuid4()


def _ctx() -> ExecContext:
    return ExecContext(
        user_id=USER, workspace_id=WS, phone="5551999999999",
        timezone="America/Sao_Paulo", texto="", source_message_id="w1",
    )


@pytest.fixture
def contas(monkeypatch):
    linhas = [
        {"id": uuid4(), "name": "Itaú Corrente", "type": "checking"},
        {"id": uuid4(), "name": "Nubank Cartão", "type": "credit_card"},
        {"id": uuid4(), "name": "Nubank Conta", "type": "checking"},
    ]

    async def accounts(workspace_id, only_cards=False):
        return [c for c in linhas if not only_cards or c["type"] == "credit_card"]

    async def default(workspace_id):
        return PADRAO

    monkeypatch.setattr(db, "accounts", accounts)
    monkeypatch.setattr(finance, "default_account", default)
    return linhas


@pytest.mark.asyncio
async def test_nome_que_nao_existe_pergunta_em_vez_de_usar_a_padrao(contas, monkeypatch):
    escritas = []

    async def fetch_one(sql, *args):
        escritas.append(args)
        return {"id": uuid4()}

    monkeypatch.setattr(db, "fetch_one", fetch_one)

    with pytest.raises(Level1Error) as erro:
        await finance.create_transaction(
            _ctx(),
            FinanceAction(
                type=FinanceActionType.CREATE_EXPENSE, amount_cents=4500,
                description="mercado", account="bradesco",
            ),
        )

    assert "não achei conta" in str(erro.value).lower()
    assert "Itaú Corrente" in str(erro.value), "a pergunta lista o que existe"
    assert escritas == [], "nada foi gravado"


@pytest.mark.asyncio
async def test_nome_ambiguo_pergunta_qual(contas, monkeypatch):
    """"nubank" casa com a conta E com o cartão — e são coisas diferentes.

    É o caso que já lançou um salário de R$ 4.000 dentro da fatura pelo app
    ("aparece só nubank e eu achei que era a conta corrente"), e pelo agente ele
    era pior: nem aparecia, caía na conta padrão.
    """
    monkeypatch.setattr(db, "fetch_one", lambda *a, **k: None)

    with pytest.raises(Level1Error) as erro:
        await finance.conta_citada(WS, "nubank")

    texto = str(erro.value)
    assert "mais de uma" in texto
    assert "Nubank Cartão" in texto and "Nubank Conta" in texto


@pytest.mark.asyncio
async def test_sem_citar_conta_continua_caindo_na_padrao(contas, monkeypatch):
    """Quem não citou nada não tem dúvida a resolver.

    A conta padrão é preferência gravada pelo usuário, não palpite nosso — e
    perguntar a conta em todo "gastei 45 no mercado" é o atrito que o produto
    existe para não ter.
    """
    escritas = []

    async def fetch_one(sql, *args):
        escritas.append(args)
        return {"id": uuid4()}

    monkeypatch.setattr(db, "fetch_one", fetch_one)

    await finance.create_transaction(
        _ctx(),
        FinanceAction(
            type=FinanceActionType.CREATE_EXPENSE, amount_cents=4500, description="mercado"
        ),
    )
    assert PADRAO in escritas[0], "gravou na conta padrão"


@pytest.mark.asyncio
async def test_cartao_que_nao_existe_pergunta_com_a_lista_de_cartoes(contas, monkeypatch):
    monkeypatch.setattr(db, "fetch_one", lambda *a, **k: None)

    with pytest.raises(Level1Error) as erro:
        await finance.conta_citada(WS, "santander", only_cards=True, papel="o cartão")

    texto = str(erro.value)
    assert "cartão" in texto
    assert "Nubank Cartão" in texto
    assert "Itaú Corrente" not in texto, "só cartões entram na lista de cartões"


@pytest.mark.parametrize("texto,espera_pergunta", [
    ("gastei 45 no mercado dia 45", True),
    ("gastei 45 no mercado dia 32", True),
    ("gastei 45 no mercado dia 5", False),
    ("gastei 45 no mercado dia 31", False),
    ("comprei 45 no mercado", False),
])
def test_dia_que_nao_existe_pergunta_em_vez_de_virar_hoje(texto, espera_pergunta):
    """O modelo DESCARTA a data impossível e o default era hoje, calado.

    Medido em 11/09/2026: "dia 45" devolve `occurred_at=None` do Gemini, e o
    lançamento nascia com a data de hoje — uma data que a pessoa não disse e
    acha que disse.
    """
    from app.domain.required import faltando

    acao = FinanceAction(
        type=FinanceActionType.CREATE_EXPENSE, amount_cents=4500, description="mercado"
    )
    resultado = faltando(acao, texto)
    if espera_pergunta:
        assert resultado and "não existe" in resultado[1]
    else:
        assert resultado is None


# ---------------------------------------------------------------------------
# a pergunta tem que ter RESPOSTA: ela vira rascunho de slot `account`
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_conta_citada_que_nao_bate_marca_account_error(contas):
    """`correction_error` faz o gate parar; `account_error` diz que a parada tem
    saída — é o marcador que vira rascunho e, com ele, botões.

    Sem isso a pergunta era um beco, medido em 15/09/2026: *"paguei 45 no
    mercado com o cartao"* → "qual delas?" → "nubank" respondia sobre editar
    parcela no app, e os R$ 45 nunca eram registrados.
    """
    from app.tools import resolve

    acao = FinanceAction(
        type=FinanceActionType.CREATE_EXPENSE, amount_cents=4500,
        description="mercado", account="bradesco",
    )
    alvos = await resolve.contas_citadas(WS, [acao], [{}])
    assert alvos[0]["account_error"] == alvos[0]["correction_error"]
    assert "bradesco" in alvos[0]["account_error"]


@pytest.mark.asyncio
async def test_acao_a_que_ja_falta_valor_nao_ganha_a_segunda_pergunta(contas):
    """Uma pergunta por turno. "comprei uma tv em 10x no itau" respondia
    "faltou o valor" E "não achei o cartão itau" no mesmo balão, e a pessoa não
    sabe qual das duas responder — `faltando` já declara a ordem."""
    from app.tools import resolve

    acao = FinanceAction(
        type=FinanceActionType.CREATE_INSTALLMENT_PURCHASE,
        installments=10, description="tv", account="itau",
    )
    alvos = await resolve.contas_citadas(WS, [acao], [{}], pular={0})
    assert "account_error" not in alvos[0]


def test_a_regua_de_cartao_ou_conta_sai_de_uma_tabela_so():
    """Perguntar por uma lista diferente da que validou seria oferecer opções
    que a validação recusa."""
    from app.tools import resolve

    assert resolve.conta_e_cartao(FinanceActionType.CREATE_INSTALLMENT_PURCHASE) is True
    assert resolve.conta_e_cartao(FinanceActionType.CREATE_EXPENSE) is False
    assert resolve.conta_e_cartao("create_expense") is False
    # ação que não pede conta nenhuma, e lixo, não podem virar "cartão" por acaso
    assert resolve.conta_e_cartao(FinanceActionType.DELETE_TRANSACTION) is None
    assert resolve.conta_e_cartao("coisa_que_nao_existe") is None


def test_o_erro_de_conta_vira_rascunho_com_a_lista_de_contas():
    """O rascunho é o que dá onde encaixar a resposta — sem ele o turno seguinte
    é uma mensagem nova, sem o lançamento."""
    from app.graph import nodes

    acao = FinanceAction(
        type=FinanceActionType.CREATE_EXPENSE, amount_cents=4500,
        description="mercado", account="bradesco",
    )
    estado = {"text": "gastei 45 no mercado no bradesco", "timezone": "America/Sao_Paulo"}
    rascunho = nodes._rascunho(estado, [acao], [{"account_error": "🤔 Não achei..."}])
    assert rascunho["slot"] == "account"
    assert rascunho["action"]["account"] == "bradesco"
    assert rascunho["raw_text"] == estado["text"]


# ---------------------------------------------------------------------------
# a linha diz se é cartão ou conta
# ---------------------------------------------------------------------------


def test_lista_mista_escreve_o_tipo_de_cada_conta():
    """Numa lista, um cartão e uma conta corrente têm a MESMA cara.

    Foi assim que um salário de R$ 4.000 foi lançado dentro da fatura pelo app
    em 09/09/2026 (*"aparece só nubank e eu achei que era a conta corrente
    nubank e nao cartao nubank"*). A resposta de lá foi separar os dois por
    PALAVRA, além do nome; aqui a linha já tem onde escrever isso.
    """
    from app import conversation

    linhas = [
        {"id": "a1", "name": "Nubank", "type": "credit_card", "closing_day": 3},
        {"id": "a2", "name": "Nubank", "type": "checking"},
    ]
    spec = conversation._pergunta_cartao("d1", linhas, "Qual é a conta?", so_cartoes=False)
    assert [r[2] for r in spec["rows"][:2]] == [
        "Cartão de crédito · fecha dia 3",
        "Conta corrente",
    ]


def test_lista_so_de_cartoes_nao_repete_a_palavra_cartao():
    """O tipo em toda linha de uma pergunta que já diz "em qual cartão" é a
    mesma palavra três vezes; o que distingue um cartão do outro é o
    fechamento, que é o dado que decide em qual fatura a compra cai."""
    from app import conversation

    linhas = [
        {"id": "a1", "name": "Nubank", "type": "credit_card", "closing_day": 3},
        {"id": "a2", "name": "BB", "type": "credit_card", "closing_day": 31},
    ]
    spec = conversation._pergunta_cartao("d1", linhas, "Em qual cartão?", so_cartoes=True)
    assert [r[2] for r in spec["rows"][:2]] == ["fecha dia 3", "fecha dia 31"]
    # "É financiamento" só existe na pergunta de CARTÃO
    assert any("financiamento" in r[1] for r in spec["rows"])
    sem_cartao = conversation._pergunta_cartao("d1", linhas, "Qual conta?", so_cartoes=False)
    assert not any("financiamento" in r[1] for r in sem_cartao["rows"])
