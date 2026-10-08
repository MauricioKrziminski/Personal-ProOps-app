""""Em 1x no crédito" é gasto no cartão, e parcela inválida é recusada ANTES do SIM.

Produção, 08/10/2026: "gastei 24,49 no cartão nubank comprando paleta para o carro em 1x no
crédito" virou `create_installment_purchase` com `installments=1`. O SIM dizia "em 1x… 0 parcelas
iniciais pagas e 1 pendentes", a pessoa confirmava, e só então ouvia "Parcelamento precisa de 2 ou
mais parcelas".
"""

from __future__ import annotations

import uuid

import pytest

from app.domain import matching
from app.graph import nodes
from app.graph.schemas import FinanceAction, FinanceActionType, FinancePlan
from app.services import gemini
from app.tools import finance


class _ModeloFake:
    def __init__(self, plano: FinancePlan) -> None:
        self._plano = plano

    async def ainvoke(self, _mensagens):
        return self._plano


def _parse(monkeypatch, texto: str, **campos) -> dict:
    plano = FinancePlan(actions=[FinanceAction(
        type=FinanceActionType.CREATE_INSTALLMENT_PURCHASE, amount_cents=2449, installments=1, **campos)])
    monkeypatch.setattr(nodes.gemini, "structured", lambda *_a, **_k: _ModeloFake(plano))
    monkeypatch.setattr(gemini, "structured", lambda *_a, **_k: _ModeloFake(plano))
    return {"text": texto, "timezone": "America/Sao_Paulo", "messages": None}


@pytest.mark.asyncio
async def test_1x_vira_gasto_no_cartao(monkeypatch):
    estado = _parse(monkeypatch, "gastei 24,49 no cartão nubank comprando paleta para o carro em 1x no crédito",
                    description="paleta para o carro", account="Nubank", payment_method="credit")
    (acao,) = (await nodes.finance_node(estado))["finance_actions"]
    assert acao["type"] == FinanceActionType.CREATE_EXPENSE.value
    assert acao["installments"] is None and acao["already_paid_count"] is None
    assert acao["amount_cents"] == 2449
    assert matching.infer_account_type(acao["account"]) == "credit_card"


@pytest.mark.asyncio
async def test_1x_sem_conta_tira_o_cartao_do_texto(monkeypatch):
    estado = _parse(monkeypatch, "comprei um fone de 200 em 1x no cartão do inter", description="fone")
    (acao,) = (await nodes.finance_node(estado))["finance_actions"]
    assert acao["type"] == FinanceActionType.CREATE_EXPENSE.value
    assert acao["account"] == "cartão inter"


@pytest.mark.asyncio
async def test_cartao_nubank_resolve_o_cartao_e_nao_a_conta(monkeypatch):
    conta, cartao = uuid.uuid4(), uuid.uuid4()

    async def accounts(_ws, only_cards=False):
        linhas = [{"id": conta, "name": "Nubank", "type": "checking"},
                  {"id": cartao, "name": "Nubank Cartão", "type": "credit_card"}]
        return [l for l in linhas if not only_cards or l["type"] == "credit_card"]

    monkeypatch.setattr(finance.db, "accounts", accounts)
    assert await finance.conta_citada(uuid.uuid4(), "cartão Nubank") == cartao


@pytest.mark.asyncio
@pytest.mark.parametrize("parcelas", [None, 0, 150])
async def test_parcela_invalida_para_antes_do_sim(monkeypatch, parcelas):
    async def alvos_de(_ws, _acoes, alvos, **_k):
        return alvos

    async def congelar(*a, **_k):
        return a[-1]

    monkeypatch.setattr(nodes.resolve, "contas_citadas", alvos_de)
    monkeypatch.setattr(nodes.resolve, "conta_padrao", alvos_de)
    monkeypatch.setattr(nodes.movimentos, "congelar", congelar)
    monkeypatch.setattr(nodes.lote_d, "congelar", congelar)
    monkeypatch.setattr(nodes.atributos, "congelar", congelar)
    acao = FinanceAction(type=FinanceActionType.CREATE_INSTALLMENT_PURCHASE, amount_cents=30000,
                         installments=parcelas, description="tv", account="cartão nubank")
    saida = await nodes.resolve_node({
        "text": "comprei uma tv", "timezone": "America/Sao_Paulo", "user_id": "u", "workspace_id": "w",
        "finance_actions": [acao.model_dump(mode="json")], "results": [],
    })
    erro = saida["targets"][0]["correction_error"]
    assert "2 ou mais" in erro or "99" in erro
