"""15/10/2026 — "gastei 200 no mercado com pix no crédito" e o modelo diz `credit` (~1 em 5): as duas leituras
existem (Pix no cartão ou compra no crédito), então o portão PERGUNTA antes do SIM; nunca reescreve por regex."""

from __future__ import annotations

import pytest
from langgraph.types import Command

from app.domain import atributos as dom
from app.domain import confirm
from app.tools import atributos
from tests.test_hitl_flow import _config, _estado, _pausa, grafo  # noqa: F401 (fixtures)
from tests.test_lote_c_atributos import banco, congela, gasto  # noqa: F401 (fixtures e helpers)

CARTAO_CITADO = {"cited_account": {"name": "Nubank Cartão", "type": "credit_card"}}


# --- a regra pura ------------------------------------------------------------------------------


@pytest.mark.parametrize("forma,texto,duvida", [
    ("credit", "gastei 200 no mercado com pix no crédito", True),
    ("credit", "paguei 80 no cred e fiz um pix depois", True),
    ("credit", "gastei 45 no crédito", False),          # sem pista de Pix: crédito é crédito
    ("pix", "gastei 200 com pix no crédito", False),    # Pix no cartão: o caminho de sempre (pergunta o cartão)
    ("pix", "gastei 45 no pix", False),
    (None, "gastei 200 com pix no crédito", False),
    ("debit", "pix ou débito, não lembro", False),
])
def test_so_credito_com_pista_de_pix_gera_duvida(forma, texto, duvida):
    assert dom.forma_em_duvida(forma, texto) is duvida


# --- o congelamento marca a dúvida e não grava a forma ---------------------------------------


async def test_credito_com_pix_na_frase_em_cartao_marca_a_duvida(banco):
    alvo = await congela("gastei 200 no mercado com pix no crédito",
                         gasto(account="Nubank Cartão", payment_method="credit"), CARTAO_CITADO)
    assert alvo["forma_em_duvida"] is True
    assert "correction_error" not in alvo
    assert not (alvo.get("atributos") or {}).get("payment_method")  # nada provisório


async def test_credito_sem_pix_na_frase_segue_sem_duvida(banco):
    alvo = await congela("gastei 200 no crédito", gasto(account="Nubank Cartão", payment_method="credit"),
                         CARTAO_CITADO)
    assert not alvo.get("forma_em_duvida") and alvo["atributos"]["payment_method"] == "credit"


async def test_sem_cartao_a_pergunta_do_cartao_vem_antes_da_da_forma(banco):
    alvo = await congela("gastei 200 no mercado com pix no crédito", gasto(payment_method="credit"))
    assert "cartão" in alvo["correction_error"] and not alvo.get("forma_em_duvida")


# --- o portão: pergunta, congela a resposta e a frase do SIM a diz ---------------------------


def _acao():
    return {"type": "create_expense", "amount_cents": 20000, "description": "mercado", "category": "mercado",
            "payment_method": "credit"}


@pytest.fixture
def com_duvida(monkeypatch):
    from app.graph import nodes

    async def congelar(_ws, _texto, acoes, alvos, pular=None):
        alvos = [*alvos] + [{}] * (len(acoes) - len(alvos))
        return [{**alvos[0], "forma_em_duvida": True,
                 "atributos": {"payment_method": None, "frase": "essencial"}}, *alvos[1:]]

    monkeypatch.setattr(nodes.atributos, "congelar", congelar)


@pytest.mark.asyncio
@pytest.mark.parametrize("opcao,forma,frase", [
    ("forma:pix", "pix", "no Pix · essencial"),
    ("forma:credit", "credit", "no crédito · essencial"),
])
async def test_portao_pergunta_e_a_resposta_vai_para_a_frase_e_para_a_tool(grafo, com_duvida, opcao, forma, frase):
    cfg = {"configurable": {"thread_id": f"forma-{forma}"}}
    estado = await grafo.ainvoke(_estado([_acao()]), config=cfg)
    pausa = _pausa(estado)
    assert pausa["kind"] == "choice" and pausa["purpose"] == "forma_pix_credito"
    assert pausa["summary"] == "Foi Pix no crédito ou compra no cartão de crédito?"
    assert [o["id"] for o in pausa["options"]] == ["forma:pix", "forma:credit"]

    estado = await grafo.ainvoke(Command(resume={"approved": True, "candidate_id": opcao}), config=cfg)
    sim = _pausa(estado)
    assert sim["kind"] == "confirmation" and frase in sim["summary"]

    final = await grafo.ainvoke(Command(resume=True), config=cfg)
    atributos_finais = final["targets"][0]["atributos"]
    assert atributos_finais["payment_method"] == forma and not final["targets"][0]["forma_em_duvida"]


@pytest.mark.asyncio
async def test_resposta_fora_das_opcoes_nao_registra(grafo, com_duvida):
    cfg = {"configurable": {"thread_id": "forma-recusa"}}
    await grafo.ainvoke(_estado([_acao()]), config=cfg)
    final = await grafo.ainvoke(Command(resume=False), config=cfg)
    assert final["approved"] is False and "EXECUTOU" not in final["results"]


@pytest.mark.asyncio
async def test_sim_solto_nao_escolhe_a_forma(grafo, com_duvida):
    cfg = {"configurable": {"thread_id": "forma-sim"}}
    await grafo.ainvoke(_estado([_acao()]), config=cfg)
    final = await grafo.ainvoke(Command(resume=True), config=cfg)  # "sim" não é uma das opções
    assert final["approved"] is False and "EXECUTOU" not in final["results"]


# --- a conversa: botões e o lembrete da pergunta ---------------------------------------------


def test_conversa_desenha_os_botoes_da_pergunta():
    from app.conversation import _pergunta

    pausa = {"kind": "choice", "purpose": "forma_pix_credito", "summary": "Foi Pix no crédito ou compra no cartão de crédito?"}
    opcoes = [{"id": "forma:pix", "label": "Pix no crédito"}, {"id": "forma:credit", "label": "Compra no cartão de crédito"}]
    r = _pergunta(pausa, opcoes, {"id": "p1"})
    assert r["ui"] == "buttons"
    assert [b[0] for b in r["buttons"]] == ["pa:p1:c:forma:pix", "pa:p1:c:forma:credit", "pa:p1:no"]
    assert "1) Pix no crédito" in r["text"] and "NÃO* para cancelar" in r["text"]


def test_resposta_que_nao_escolhe_repete_as_opcoes_da_forma():
    texto = confirm._relembrar_opcoes({"action": {"purpose": "forma_pix_credito", "candidates": [
        {"id": "forma:pix", "label": "Pix no crédito"}, {"id": "forma:credit", "label": "Compra no cartão de crédito"}]}})
    assert "Pix no crédito ou uma compra no cartão" in texto and "2) Compra no cartão de crédito" in texto
