"""O script de comparação v1 × v2 roda de ponta a ponta com dublês (o Gemini real é com o Gabriel)."""

import pytest

from app.config import get_settings
from app.graph import nodes
from app.graph.schemas import (
    FinanceAction,
    FinanceActionType,
    FinancePlan,
    FinanceQueryPlan,
    RouterDecision,
    RouterDecisionV2,
)
from scripts import comparar_prompts


def test_modo_offline_imprime_a_tabela(capsys):
    comparar_prompts.so_prompts()
    saida = capsys.readouterr().out
    assert "router" in saida and "[criar]" in saida and "[TODOS]" in saida


@pytest.mark.asyncio
async def test_um_caminho_nos_dois_modos(monkeypatch):
    acao = FinanceAction(type=FinanceActionType.CREATE_EXPENSE, amount_cents=1000)
    respostas = {
        RouterDecision: RouterDecision(domains=["financas"], confidence=0.9),
        RouterDecisionV2: RouterDecisionV2(domains=["financas"], confidence=0.9,
                                           finance_subintents=["criar"]),
        FinancePlan: FinancePlan(actions=[acao]),
        FinanceQueryPlan: FinanceQueryPlan(actions=[]),
    }

    def structured(schema, *_a, **_k):
        class _M:
            async def ainvoke(self, _m):
                return respostas[schema]

        return _M()

    monkeypatch.setattr(nodes.gemini, "structured", structured)
    monkeypatch.setattr(get_settings(), "agent_prompt_v2", False)

    v1 = await comparar_prompts._um_caminho(False, "gastei 10 no café", [])
    v2 = await comparar_prompts._um_caminho(True, "gastei 10 no café", [])
    assert v1["subintents"] == [] and v2["subintents"] == ["criar"]
    assert v1["acoes"] == v2["acoes"] == [{"type": "create_expense", "amount_cents": 1000}]
    assert v1["erro"] is None and v2["erro"] is None
