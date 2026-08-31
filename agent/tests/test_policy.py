"""A regra que decide o que precisa de um SIM. Errar para menos apaga dado sem
perguntar; errar para muito faz o usuário confirmar cada café."""

import pytest

from app.config import get_settings
from app.graph.policy import describe_for_confirmation, needs_confirmation
from app.graph.schemas import (
    FinanceAction,
    FinanceActionType,
    FinanceQuery,
    FinanceQueryType,
    NotesAction,
    NotesActionType,
)


@pytest.fixture(autouse=True)
def _config(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://x/y")
    monkeypatch.setenv("HITL_AMOUNT_THRESHOLD_CENTS", "100000")  # R$ 1.000
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_destrutiva_sempre_pergunta():
    assert needs_confirmation(FinanceAction(type=FinanceActionType.UNDO_LAST), 1.0) == "destrutiva"
    assert needs_confirmation(
        FinanceAction(type=FinanceActionType.DELETE_TRANSACTION), 1.0
    ) == "destrutiva"
    assert needs_confirmation(
        NotesAction(type=NotesActionType.DELETE_NOTE, search_term="mercado"), 1.0
    ) == "destrutiva"


def test_gasto_comum_nao_pergunta():
    acao = FinanceAction(type=FinanceActionType.CREATE_EXPENSE, amount_cents=4500)
    assert needs_confirmation(acao, 1.0) is None


def test_valor_acima_do_teto_pergunta():
    assert needs_confirmation(
        FinanceAction(type=FinanceActionType.CREATE_EXPENSE, amount_cents=100_001), 1.0
    ) == "valor alto"
    # exatamente no teto ainda passa
    assert needs_confirmation(
        FinanceAction(type=FinanceActionType.CREATE_EXPENSE, amount_cents=100_000), 1.0
    ) is None


def test_baixa_confianca_pergunta_em_vez_de_escalar():
    # escalar gastaria a cota de 20/dia do modelo maior; perguntar é grátis
    acao = FinanceAction(type=FinanceActionType.CREATE_EXPENSE, amount_cents=4500)
    assert needs_confirmation(acao, 0.4) == "baixa confiança"


def test_consulta_nunca_pergunta():
    for tipo in (FinanceQueryType.QUERY_BALANCE, FinanceQueryType.SIMULATE_PURCHASE):
        assert needs_confirmation(FinanceQuery(type=tipo, amount_cents=999_999_00), 0.1) is None


def test_frase_de_confirmacao_descreve_o_efeito():
    # ninguém confirma "delete_transaction", mas todo mundo entende a frase
    frase = describe_for_confirmation(
        FinanceAction(type=FinanceActionType.DELETE_TRANSACTION, amount_cents=4500)
    )
    assert "apagar" in frase and "45,00" in frase
    assert "delete_transaction" not in frase


def test_frase_de_empate_nao_ecoa_o_modelo():
    """Com empate, a frase diz o EFEITO; as opções reais vão na lista.

    Caindo no texto do modelo aqui, o usuário voltava a ler "apagar a nota sobre
    esse item" — o eco que originou todo este trabalho.
    """
    from app.graph.policy import describe_for_confirmation
    from app.graph.schemas import NotesAction, NotesActionType

    acao = NotesAction(type=NotesActionType.DELETE_NOTE)
    alvo = {"status": "ambiguous", "candidates": [{"id": "a", "label": "x"}, {"id": "b", "label": "y"}]}

    frase = describe_for_confirmation(acao, alvo)

    assert "apagar" in frase
    assert "esse item" not in frase


# ---------------------------------------------------------------------------
# roteador inseguro pergunta o DOMÍNIO, antes de extrair
# ---------------------------------------------------------------------------


def test_confianca_baixa_do_roteador_pergunta_o_dominio():
    """Abaixo de 0,8 o agente não adivinha se é despesa ou nota.

    É uma pergunta DIFERENTE da confirmação de ação (0,6): esta acontece antes
    de extrair, e evita que "paguei o dentista" vire nota quando era gasto.
    """
    from app.graph.policy import dominio_incerto

    assert dominio_incerto(["financas"], 0.7)
    assert not dominio_incerto(["financas"], 0.95)
    # multi-intent explícito não é incerteza: o router disse que são os dois
    assert not dominio_incerto(["financas", "notas"], 0.7)
    # domínio sem ambiguidade de registro não pergunta
    assert not dominio_incerto(["geral"], 0.5)
    assert not dominio_incerto(["financas_consulta"], 0.5)
