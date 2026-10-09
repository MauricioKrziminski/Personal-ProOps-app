"""O filtro de forma de pagamento da CONSULTA só vale se a frase o diz (Claude Haiku, 09/10/2026)."""

import pytest

from app.graph import nodes
from app.graph.schemas import FinanceQuery, FinanceQueryPlan, FinanceQueryType


class _Fake:
    def __init__(self, plano):
        self._plano = plano

    async def ainvoke(self, _m):
        return self._plano


async def _forma(monkeypatch, texto, proposta):
    plano = FinanceQueryPlan(actions=[FinanceQuery(type=FinanceQueryType.QUERY_TRANSACTIONS,
                                                   payment_method=proposta)])
    monkeypatch.setattr(nodes.ia, "structured", lambda *_a, **_k: _Fake(plano))

    async def _sem_contas(_s):
        return []

    monkeypatch.setattr(nodes, "_contas_do_turno", _sem_contas)
    saida = await nodes.finance_query_node({"text": texto, "timezone": "America/Sao_Paulo", "messages": None})
    return saida["finance_queries"][0]["payment_method"]


@pytest.mark.asyncio
@pytest.mark.parametrize("texto, proposta, esperado", [
    ("quanto gastei no cartão nubank?", "credit", None),
    ("quanto gastei no cartão de crédito?", "credit", "credit"),
    ("quanto gastei no pix esse mês?", "pix", "pix"),
    ("o que ficou sem forma de pagamento?", "not_informed", "not_informed"),
])
async def test_forma_so_com_a_frase(monkeypatch, texto, proposta, esperado):
    assert await _forma(monkeypatch, texto, proposta) == esperado
