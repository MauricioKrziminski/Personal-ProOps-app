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

# 08/09/2026: scripts/probe_transaction_account_schema.py accepted the exact
# FinancePlan with 15 properties x 14 enum values on gemini-3.7-flash.
MAX_PRODUTO = 198
# 08/09/2026: probe_bounded_installments.py accepted 17 flat fields with compact
# string scope (decoded to typed object) and max10 enforced by a local validator.
# 09/09/2026: probe_rename_schema.py accepted 18 x 14 = 252 (sum 32) on
# gemini-3.7-flash, adding new_description. Measured, never estimated: the API
# refuses with a bare 400 INVALID_ARGUMENT and it already broke production once.
FINANCE_PRODUTO_MEDIDO = 252
MAX_SOMA = 31
FINANCE_SOMA_MEDIDA = 32

MODELOS = [
    ("FinanceAction", FinanceAction, FinanceActionType),
    ("FinanceQuery", FinanceQuery, FinanceQueryType),
    ("NotesAction", NotesAction, NotesActionType),
]


@pytest.mark.parametrize("nome,modelo,enum", MODELOS)
def test_dentro_do_orcamento(nome, modelo, enum):
    props, valores = len(modelo.model_fields), len(list(enum))
    limite = FINANCE_PRODUTO_MEDIDO if modelo is FinanceAction else MAX_PRODUTO
    assert props * valores <= limite, (
        f"{nome}: {props}×{valores}={props * valores} passa de {limite}. "
        "Tire um campo, tire um tipo do enum, ou divida o domínio."
    )
    teto_soma = FINANCE_SOMA_MEDIDA if modelo is FinanceAction else MAX_SOMA
    assert props + valores <= teto_soma, f"{nome}: soma {props + valores} passa de {teto_soma}"


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


def test_schemas_de_decisao_constroem_de_verdade():
    """Os schemas dos classificadores precisam gerar JSON Schema.

    Eles quebraram em produção com `class-not-fully-defined` (faltava importar
    `Literal` num módulo com `from __future__ import annotations`) e a suíte
    passou mesmo assim, porque os testes dublavam justamente a função que os
    constrói. Teste que dubla a peça quebrada não testa a peça.
    """
    from app.graph.schemas import ConfirmDecision, DraftDecision

    for modelo, valores in (
        (ConfirmDecision, {"approve", "reject", "unclear"}),
        (DraftDecision, {"answer", "discard", "unrelated", "financing"}),
    ):
        esquema = modelo.model_json_schema()          # levantava PydanticUserError
        campo = esquema["properties"]["decision"]
        assert set(campo.get("enum", [])) == valores, modelo.__name__


def test_os_modelos_de_producao_sao_os_documentados():
    """A troca de modelo por variável de ambiente é para TESTE, não para produção.

    `GEMINI_MODEL_LITE`/`GEMINI_MODEL_GATE` existem para uma execução de
    iteração caber no nível gratuito (Flash-Lite: 500/dia; Flash: 20/dia). As
    constantes são o que vale quando ninguém pediu troca — e a divisão entre
    elas veio de medição: o gate no Lite reprova 8 dos 94 casos, e uma das
    quedas é "apaga todos" voltando `approved: True`.
    """
    from app.services import gemini

    assert gemini.GEMINI_ROUTER == "gemini-3.1-flash-lite"
    assert gemini.GEMINI_PARSE == "gemini-3.1-flash-lite"
    assert gemini.GEMINI_BATCH == "gemini-3.1-flash-lite"
    assert gemini.GEMINI_GATE == "gemini-3.7-flash"


def test_sem_variavel_de_ambiente_o_modelo_nao_muda(monkeypatch):
    from app.services import gemini

    monkeypatch.delenv("GEMINI_MODEL_GATE", raising=False)
    assert gemini.modelo("gate") == "gemini-3.7-flash"
    monkeypatch.setenv("GEMINI_MODEL_GATE", "gemini-3.1-flash-lite")
    assert gemini.modelo("gate") == "gemini-3.1-flash-lite"


def test_papel_desconhecido_levanta_em_vez_de_cair_num_default():
    """Era assim que `settings.gemini_model` trocava o modelo do sistema inteiro.

    Ele era lido em `llm()` ANTES do padrão do papel e vinha com default
    `gemini-3.7-flash`: bastava uma chamada sem argumento para router e parse
    saírem do Lite (500/dia grátis) para o Flash (20/dia), em silêncio.
    """
    import pytest

    from app.services import gemini

    with pytest.raises(ValueError, match="papel de modelo desconhecido"):
        gemini.modelo("inventado")


def test_existe_UM_lugar_que_escolhe_modelo():
    """Nenhum nome de modelo cru fora da tabela.

    Três mecanismos coexistiam (as constantes, `settings.gemini_model` e as
    variáveis de troca). Uma tabela, uma função: `gemini.MODELOS` + `modelo()`.
    """
    import pathlib
    import re

    raiz = pathlib.Path(__file__).resolve().parent.parent / "app"
    fora = []
    for arquivo in raiz.rglob("*.py"):
        if arquivo.name == "gemini.py":
            continue
        for n, linha in enumerate(arquivo.read_text().splitlines(), 1):
            if re.search(r'"gemini-[0-9]', linha) or re.search(r"'gemini-[0-9]", linha):
                fora.append(f"{arquivo.name}:{n}")
    assert not fora, f"nome de modelo fora da tabela: {fora}"
