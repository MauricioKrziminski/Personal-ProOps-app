"""Taxa mensal: a pessoa fala em porcento, a coluna guarda fração.

`debts.interest_rate_monthly` e `accounts.rotativo_rate_monthly` são NUMERIC de
0 a 1 (1,99% a.m. = 0.0199). O validador só fazia `replace(",", ".")` e depois
exigia `0 <= n <= 1`, então "1,99" — a taxa como ela vem impressa no contrato —
era recusada com "Taxa mensal inválida". Ninguém tinha reparado porque o prompt
nunca disse qual formato usar e os testes existentes passavam "0.0199" cru.
"""

import pytest

from app.graph.schemas import ResourceAction, ResourceActionType, ResourceField
from app.tools import resources
from app.tools.guards import Level1Error


def _valida(campo, valor, resource="debts"):
    """UPDATE, não CREATE: o CREATE exige os obrigatórios do recurso e o que
    está sob teste aqui é só a conversão do número."""
    acao = ResourceAction(
        type=ResourceActionType.UPDATE,
        resource=resource,
        name="contrato do carro",
        fields=[ResourceField(name=campo, value=valor)],
    )
    return resources.validate_fields(acao)[campo]


@pytest.mark.parametrize(
    "entrada,esperado",
    [
        ("1,99", "0.0199"),    # a do contrato de financiamento — era RECUSADA
        ("1.99", "0.0199"),
        ("1,99%", "0.0199"),
        ("15,5", "0.155"),     # rotativo típico
        ("12,876", "0.12876"), # a taxa real medida pelo dono do produto
        ("0.0199", "0.0199"),  # fração crua continua intocada
        ("0,155", "0.155"),
        ("0", "0"),            # sem juros
    ],
)
def test_porcento_vira_fracao(entrada, esperado):
    assert _valida("interest_rate_monthly", entrada) == esperado


def test_a_regressao_do_financiamento():
    """O caso que já estava quebrado em produção, antes de qualquer feature nova."""
    assert _valida("interest_rate_monthly", "1,99") == "0.0199"


def test_taxa_negativa_ou_absurda_e_recusada():
    with pytest.raises(Level1Error):
        _valida("interest_rate_monthly", "-1")
    with pytest.raises(Level1Error):
        _valida("interest_rate_monthly", "banana")
    # 200% ao mês: vira 2.0 depois da conversão, continua fora da coluna.
    with pytest.raises(Level1Error):
        _valida("interest_rate_monthly", "200")
