"""15/10/2026 — "Tenho um financiamento do carro em 48x de 1470, estou na nona": o roteador às vezes manda finanças
junto dos cadastros. Contrato descrito é dívida (um dono só); sem dívida na frase, a compra sem cartão pergunta o
cartão e oferece "É financiamento"."""

from __future__ import annotations

import pytest

from app import conversation
from app.domain.required import faltando
from app.graph import nodes
from app.graph.schemas import FinanceAction

TZ = "America/Sao_Paulo"
COMPRA = {"type": "create_installment_purchase", "description": "carro", "amount_cents": 7056000, "installments": 48}
DIVIDA = {"type": "resource_create", "resource": "debts", "name": "Carro", "fields": []}


def estado(**kw):
    return {"workspace_id": "w", "user_id": "u", "timezone": TZ, "text": "financiamento do carro em 48x de 1470",
            "finance_actions": [], "resource_actions": [], "resource_draft": [], "results": [], **kw}


def test_compra_sem_cartao_com_divida_pronta_sai():
    financas, aviso = nodes._contrato_e_divida(estado(finance_actions=[COMPRA], resource_actions=[DIVIDA]))
    assert financas == [] and "financiamento" in aviso and "*carro*" in aviso


def test_compra_sem_cartao_com_divida_incompleta_no_rascunho_sai():
    rascunho = [{**DIVIDA, "_pergunta": "Qual o saldo?"}]
    financas, aviso = nodes._contrato_e_divida(estado(finance_actions=[COMPRA], resource_draft=rascunho))
    assert financas == [] and aviso


def test_compra_com_cartao_citado_fica():
    com_cartao = {**COMPRA, "account": "Nubank"}
    financas, aviso = nodes._contrato_e_divida(estado(finance_actions=[com_cartao], resource_actions=[DIVIDA]))
    assert financas == [com_cartao] and aviso is None


def test_so_a_compra_sem_cartao_e_removida_o_resto_do_lote_fica():
    gasto = {"type": "create_expense", "amount_cents": 4500, "category": "mercado"}
    financas, _ = nodes._contrato_e_divida(estado(finance_actions=[gasto, COMPRA], resource_actions=[DIVIDA]))
    assert financas == [gasto]


@pytest.mark.parametrize("cadastros", [
    [],                                                                        # sem cadastro nenhum
    [{"type": "resource_update", "resource": "debts", "name": "Carro", "fields": []}],   # editar dívida não é criar
    [{"type": "resource_create", "resource": "cards", "name": "Inter", "fields": []}],   # outro recurso
])
def test_sem_dividas_a_criar_nada_muda(cadastros):
    financas, aviso = nodes._contrato_e_divida(estado(finance_actions=[COMPRA], resource_actions=cadastros))
    assert financas == [COMPRA] and aviso is None


@pytest.mark.asyncio
async def test_fan_in_devolve_as_financas_sem_a_compra_e_o_aviso_antes_da_pergunta():
    saida = await nodes.resolve_node(estado(
        finance_actions=[COMPRA], resource_draft=[{**DIVIDA, "_pergunta": "Qual o saldo?"}]))
    assert saida["finance_actions"] == []
    assert any("financiamento" in a for a in saida["avisos"])
    assert any("financiamento" in r for r in saida["results"])


def test_so_a_compra_sem_cartao_pergunta_o_cartao_e_oferece_financiamento():
    acao = FinanceAction(**COMPRA)
    slot, pergunta = faltando(acao, "tenho um financiamento do carro em 48x de 1470", TZ)
    assert slot == "account" and "cartão" in pergunta
    cartoes = [{"id": "c1", "name": "Nubank", "type": "credit_card", "closing_day": 3}]
    spec = conversation._pergunta_cartao("d1", cartoes, pergunta, so_cartoes=conversation._so_cartoes(COMPRA))
    rotulos = [b[1] for b in spec.get("buttons") or []] + [r[1] for r in spec.get("rows") or []]
    assert "É financiamento" in rotulos
