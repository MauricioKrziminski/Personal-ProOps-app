"""A recusa de um TRIGGER chega à pessoa escrita, não como "deu erro, tenta de novo".

Mudar o pagamento de uma fatura adiada (`20260926180000`) é recusado dentro do banco, por
trigger, num UPDATE/DELETE comum — não numa RPC com `except` próprio. `registry.execute` é o
ponto único por onde toda escrita do agente passa.
"""

import psycopg
import pytest

from app.graph.schemas import FinanceAction, FinanceActionType
from app.tools import registry
from app.tools.base import ExecContext


@pytest.mark.asyncio
async def test_p0001_de_trigger_vira_a_frase_do_banco(monkeypatch):
    liberadas = []

    async def reserve(*a, **k):
        return True

    async def release(msg, indice):
        liberadas.append(indice)

    async def dono(*a, **k):
        return None

    async def apagar(ctx, acao):
        raise psycopg.errors.RaiseException(
            "Essa fatura já foi para a próxima: desfaça o adiamento dela antes de mudar o pagamento."
        )

    monkeypatch.setattr(registry.db, "reserve_execution", reserve)
    monkeypatch.setattr(registry.db, "release_execution", release)
    monkeypatch.setattr(registry, "ensure_owned", dono)
    monkeypatch.setitem(registry.FINANCE_TOOLS, FinanceActionType.DELETE_TRANSACTION, apagar)
    ctx = ExecContext("u", "w", None, "America/Sao_Paulo", "apaga o pagamento", "wamid.1",
                      target={"table": "transactions", "status": "found",
                              "candidates": [{"id": "tx-1", "label": "pagamento"}]})

    r = await registry.execute(ctx, FinanceAction(type=FinanceActionType.DELETE_TRANSACTION))

    assert r.read_only
    assert "desfaça o adiamento dela antes de mudar o pagamento" in r.message
    assert "Ainda não mudei nada" in r.message
    assert liberadas, "a vaga de idempotência volta: a pessoa pode tentar de novo depois"
