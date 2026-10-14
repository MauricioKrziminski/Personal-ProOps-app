"""14/10/2026 — o tipo da conta só vale se a pessoa o disse ("Crie uma conta Reserva" virava poupança
pelo nome). Sem pista o campo sai e o cadastro pergunta o tipo."""

import pytest

from app.graph.nodes import _tipo_de_conta_ancorado
from app.graph.schemas import ResourceAction, ResourceActionType, ResourceField


def _conta(tipo, nome="Reserva"):
    return ResourceAction(type=ResourceActionType.CREATE, resource="accounts", name=nome,
                          fields=[ResourceField(name="type", value=tipo)])


def _tipo(acao):
    return next((f.value for f in acao.fields if f.name == "type"), None)


@pytest.mark.parametrize("texto, tipo", [
    ("cria uma conta corrente no itau", "checking"),
    ("abre uma poupança chamada Reserva", "savings"),
    ("é poupança, começa com trezentos reais", "savings"),
    ("cadastra a carteira de dinheiro", "cash"),
    ("cria a conta de investimento da XP", "investment"),
    ("minha caixinha do nubank", "investment"),
])
def test_tipo_dito_fica(texto, tipo):
    assert _tipo(_tipo_de_conta_ancorado(_conta(tipo), texto)) == tipo


@pytest.mark.parametrize("texto, tipo", [
    ("Crie uma conta Reserva", "savings"),      # deduzido do nome
    ("cria a conta nubank", "checking"),
    ("cadastra a conta do itau", "investment"),
])
def test_tipo_deduzido_sai_e_vira_pergunta(texto, tipo):
    assert _tipo(_tipo_de_conta_ancorado(_conta(tipo), texto)) is None


def test_outros_cadastros_nao_passam_pela_ancora():
    cartao = ResourceAction(type=ResourceActionType.CREATE, resource="cards", name="Inter",
                            fields=[ResourceField(name="type", value="credit_card")])
    assert _tipo(_tipo_de_conta_ancorado(cartao, "cria o cartão inter")) == "credit_card"
