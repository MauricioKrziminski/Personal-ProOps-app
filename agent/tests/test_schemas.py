"""O orçamento de tamanho do schema do Gemini, medido contra a API real.

Não é "15 propriedades", como se acreditou por muito tempo. É o PRODUTO
propriedades × valores de enum. Medido em 30/08/2026 por
`scripts/diagnose_finance_schema.py`, mudando uma variável por vez:

    15 props × enum 22 = 330  ✗ recusado
     9 props × enum 22 = 198  ✓
    15 props × enum 10 = 150  ✓
    15 props × enum  7 = 105  ✓
    campos INTEGER              inocentes (recusa igual com tudo STRING)

O teto está entre 198 e 330. Este teste trava os schemas abaixo de 198 e de
soma 31 — os dois maiores pontos que comprovadamente PASSARAM, então não é
extrapolação. Somar campo ou valor de enum quebra o build antes de quebrar o
parse em produção, que foi como isto foi descoberto das duas vezes.
"""

import pytest

from app.graph.schemas import (
    READ_ONLY,
    FinanceAction,
    FinanceActionType,
    FinanceQuery,
    FinanceQueryType,
    NotesAction,
    NotesActionType,
    RouterDecision,
)

MAX_PRODUTO = 198
MAX_SOMA = 31

MODELOS = [
    ("FinanceAction", FinanceAction, FinanceActionType),
    ("FinanceQuery", FinanceQuery, FinanceQueryType),
    ("NotesAction", NotesAction, NotesActionType),
]


@pytest.mark.parametrize("nome,modelo,enum", MODELOS)
def test_dentro_do_orcamento(nome, modelo, enum):
    props, valores = len(modelo.model_fields), len(list(enum))
    assert props * valores <= MAX_PRODUTO, (
        f"{nome}: {props}×{valores}={props * valores} passa de {MAX_PRODUTO}. "
        "Tire um campo, tire um tipo do enum, ou divida o domínio."
    )
    assert props + valores <= MAX_SOMA, f"{nome}: soma {props + valores} passa de {MAX_SOMA}"


def test_router_e_minusculo():
    # ele roda em TODA mensagem; engordar aqui custa em toda conversa
    assert len(RouterDecision.model_fields) <= 5


def test_um_enum_por_schema():
    # o segundo enum derruba a chamada mesmo com poucos campos
    for _, modelo, _ in MODELOS:
        schema = modelo.model_json_schema()
        enums = [d for d in schema.get("$defs", {}).values() if "enum" in d]
        assert len(enums) <= 1, f"{modelo.__name__} tem {len(enums)} enums"


def test_todo_tipo_tem_funcao():
    # o dispatcher é um mapa fechado: tipo sem função vira mensagem de ajuda,
    # nunca uma escrita inesperada
    from app.tools.registry import FINANCE_TOOLS, NOTES_TOOLS, QUERY_TOOLS

    assert {t for t in FinanceActionType if t not in FINANCE_TOOLS} == {FinanceActionType.UNKNOWN}
    assert {t for t in FinanceQueryType if t not in QUERY_TOOLS} == {FinanceQueryType.UNKNOWN}
    assert {t for t in NotesActionType if t not in NOTES_TOOLS} == {NotesActionType.UNKNOWN}


def test_consulta_nunca_escreve():
    """Todo tipo de consulta em READ_ONLY. É o que impede uma pergunta de
    reservar linha em executed_actions ou de pedir confirmação ao usuário."""
    for tipo in FinanceQueryType:
        assert tipo in READ_ONLY, f"{tipo} não está em READ_ONLY"


def test_escrita_e_consulta_nao_se_sobrepoem():
    """Um tipo em dois domínios faria o router escolher e o dispatcher decidir
    diferente — a ação sumiria dependendo de quem roteou."""
    escrita = {t.value for t in FinanceActionType} - {"unknown"}
    consulta = {t.value for t in FinanceQueryType} - {"unknown"}
    assert not (escrita & consulta), f"tipos em ambos: {escrita & consulta}"
