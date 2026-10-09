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
#
# 06/10/2026: o teto de 252 deixou de valer. Medido no Gemini real (gemini-3.1-flash-lite,
# method="json_schema", o que o langchain-google-genai 4.3.7 usa; o de agosto era outro método de
# envio) — passaram: 24 propriedades opcionais (anyOf null) x enum 14 = 336; 24 x 14 com
# type:[t,null]; 30 e 36 propriedades sem null; 36 propriedades anyOf x enum 20 = 720 (soma 56).
# O FinanceAction tem 22 x 14 = 308 (soma 36), com forma de pagamento, fixo/variável, essencial e
# detalhe. O gemini-3.7-flash (RESERVA do `structured()`) ainda NÃO foi medido com este schema:
# crescer além do produto exato abaixo exige medir nos DOIS modelos antes.
FINANCE_TETO_MEDIDO = 720
FINANCE_SOMA_TETO_MEDIDA = 56
FINANCE_PRODUTO_ATUAL = 308
FINANCE_SOMA_ATUAL = 36
MAX_SOMA = 31

MODELOS = [
    ("FinanceAction", FinanceAction, FinanceActionType),
    ("FinanceQuery", FinanceQuery, FinanceQueryType),
    ("NotesAction", NotesAction, NotesActionType),
]


@pytest.mark.parametrize("nome,modelo,enum", MODELOS)
def test_dentro_do_orcamento(nome, modelo, enum):
    props, valores = len(modelo.model_fields), len(list(enum))
    limite = FINANCE_TETO_MEDIDO if modelo is FinanceAction else MAX_PRODUTO
    assert props * valores <= limite, (
        f"{nome}: {props}×{valores}={props * valores} passa de {limite}. "
        "Tire um campo, tire um tipo do enum, ou divida o domínio."
    )
    teto_soma = FINANCE_SOMA_TETO_MEDIDA if modelo is FinanceAction else MAX_SOMA
    assert props + valores <= teto_soma, f"{nome}: soma {props + valores} passa de {teto_soma}"


def test_finance_action_no_tamanho_documentado():
    """O produto exato é o que a reserva (3.7-flash) vai ter de aceitar: crescer exige medir de novo."""
    props, valores = len(FinanceAction.model_fields), len(list(FinanceActionType))
    assert (props * valores, props + valores) == (FINANCE_PRODUTO_ATUAL, FINANCE_SOMA_ATUAL)


def test_atributos_do_lancamento_estao_no_parse_principal():
    # a 2ª chamada (AtributosLote) deixou de existir: os quatro campos moram no FinanceAction
    assert {"payment_method", "expense_pattern", "expense_necessity", "detalhe"} <= set(FinanceAction.model_fields)


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

    assert gemini.MODELOS[gemini.GEMINI_ROUTER] == "claude-haiku-5-5"
    assert gemini.MODELOS[gemini.GEMINI_PARSE] == "claude-haiku-5-5"
    assert gemini.MODELOS[gemini.GEMINI_BATCH] == "claude-haiku-5-5"
    assert gemini.MODELOS[gemini.GEMINI_GATE] == "claude-sonnet-5-5"
    assert gemini.MODELOS["embedding"] == "gemini-embedding-2"
    # a tabela antiga, intacta: é a das suítes (IA_PROVEDOR=gemini) e a RESERVA entre provedores
    assert gemini.MODELOS_GEMINI == {
        "router": "gemini-3.1-flash-lite", "parse": "gemini-3.1-flash-lite",
        "batch": "gemini-3.1-flash-lite", "gate": "gemini-3.7-flash",
        "embedding": "gemini-embedding-2",
    }


def test_sem_variavel_de_ambiente_o_modelo_nao_muda(monkeypatch):
    from app.services import gemini

    monkeypatch.delenv("GEMINI_MODEL", raising=False)
    monkeypatch.delenv("GEMINI_MODEL_GATE", raising=False)
    assert gemini.modelo("gate") == "claude-sonnet-5-5"
    monkeypatch.setenv("GEMINI_MODEL_GATE", "gemini-3.1-flash-lite")
    assert gemini.modelo("gate") == "gemini-3.1-flash-lite"
    monkeypatch.setenv("GEMINI_MODEL_GATE", "  ")  # vazia = não definida
    assert gemini.modelo("gate") == "claude-sonnet-5-5"


def test_gemini_model_global_nao_existe_mais(monkeypatch):
    """`GEMINI_MODEL` era a arma carregada: voltou em `2c849a4` e saiu de novo.

    Só `GEMINI_MODEL_<PAPEL>` troca modelo — o global não é mais lido em lugar
    nenhum, nem pelo ambiente, nem por `settings.gemini_model` (que não existe
    mais). O valor injetado não pode coincidir com NENHUM padrão de `MODELOS`
    (nem Lite nem Flash) — senão as asserções de router/parse/batch passariam
    por coincidência mesmo com o bug de volta (o global sempre bateu com o
    próprio padrão deles).
    """
    from app.services import gemini

    monkeypatch.delenv("GEMINI_MODEL_GATE", raising=False)
    monkeypatch.setenv("GEMINI_MODEL", "modelo-que-nao-pode-aparecer")
    for papel in ("router", "parse", "batch", "gate"):
        assert gemini.modelo(papel) == gemini.MODELOS[papel]  # global NÃO alcança


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
            if re.search(r"""["'](gemini-[0-9]|claude-)""", linha):
                fora.append(f"{arquivo.name}:{n}")
    assert not fora, f"nome de modelo fora da tabela: {fora}"


def test_catalogo_de_notas_cabe_no_prompt_sem_crescer_o_schema():
    """Organizar nota e pasta não custou orçamento de schema, e isso é medível.

    `ResourceAction.resource` é `str` (não enum) e `color`/`icon` viajam como
    VALOR de campo — o produto propriedades × enum do schema não se mexe. O que
    cresce é o texto do prompt, que não tem teto de 15×1.
    """
    from app.graph.schemas import ResourceAction, ResourceActionType
    from app.tools.resources import prompt_catalogue

    props = ResourceAction.model_json_schema()["properties"]
    assert len(props) == 5
    # o único enum do schema continua sendo o tipo da operação
    assert len(ResourceActionType) == 6

    texto = prompt_catalogue()
    for campo in ("pinned", "color", "archived", "tags", "icon"):
        assert campo in texto
    assert "oceano" in texto and "azul -> oceano" in texto


def test_principal_com_reserva_tem_prazo_curto_e_sem_nova_tentativa():
    """O Lite parado segurava 30 s antes de a reserva entrar (voz: 33,7 s no staging)."""
    from app.graph.schemas import FinancePlan
    from app.services import gemini

    gemini._cache.clear()
    gemini.structured(FinancePlan, gemini.GEMINI_PARSE)
    gemini.structured(FinancePlan, gemini.GEMINI_PARSE, prazo=gemini.PRAZO_LONGO)
    haiku, sonnet = gemini.modelo("parse"), gemini.modelo("gate")
    assert (haiku, 0.1, gemini.PRAZO_COM_RESERVA, 0, None) in gemini._cache
    assert (haiku, 0.1, gemini.PRAZO_LONGO, 0, None) in gemini._cache
    assert (sonnet, 0.1, gemini.PRAZO_LONGO, 0, None) in gemini._cache  # reserva do volume e portão
    assert (gemini.MODELOS_GEMINI["parse"], 0.1, gemini.PRAZO_LONGO, 1, None) in gemini._cache  # a reserva final
