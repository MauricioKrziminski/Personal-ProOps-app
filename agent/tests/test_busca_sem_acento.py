"""Nome dito sem acento acha o registro com acento (25/09/2026).

Medido no app: *"paguei a zz conta de gas, foi 230"* respondeu "Não achei nada com conta de gas"
para a conta prevista "ZZ conta de gás". No celular se digita sem acento o tempo todo, e o
`ilike` do Postgres não ignora acento. A extensão `unaccent` existe nos dois bancos desde a
`0038` (a busca de notas já a usava); toda busca por nome passa por ela.
"""

import re
from pathlib import Path

import pytest

from app.graph.schemas import FinanceAction, FinanceActionType
from app.tools import finance, resolve

TOOLS = Path(__file__).resolve().parents[1] / "app" / "tools"


def test_nenhuma_busca_por_nome_compara_com_acento():
    fora = []
    for arquivo in sorted(TOOLS.glob("*.py")):
        for n, linha in enumerate(arquivo.read_text().splitlines(), 1):
            codigo = linha.split("#", 1)[0]
            if re.search(r"\bilike\b", codigo) and "`" not in codigo and "unaccent" not in codigo:
                fora.append(f"{arquivo.name}:{n}: {linha.strip()}")
    assert fora == []


@pytest.mark.asyncio
async def test_janela_de_lancamentos_casa_o_termo_sem_acento(monkeypatch):
    async def janela(workspace_id, action):
        return [{"id": "g", "kind": "expense", "amount_cents": 21000, "category": "contas",
                 "description": "ZZ conta de gás", "merchant": None, "occurred_at": "2026-09-25"}]

    monkeypatch.setattr(finance, "reference_window", janela)
    acao = FinanceAction(type=FinanceActionType.DELETE_TRANSACTION, description="conta de gas")
    estado, cands = await resolve.por_transacao("ws", acao, False)
    assert estado == "found" and cands[0]["id"] == "g"
