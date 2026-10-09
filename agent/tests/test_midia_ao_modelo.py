"""Imagem e PDF chegam ao modelo, e os bytes não vão ao checkpoint (auditoria C1)."""

from __future__ import annotations

import base64

import pytest
from langgraph.checkpoint.base import get_checkpoint_metadata

from app import conversation
from app.graph import nodes
from app.graph.schemas import FinancePlan
from app.graph.state import CHAVE_MIDIA, marca_da_midia

B64 = base64.b64encode(b"%PDF-1.4 fake").decode()
MIDIA = {"mime_type": "application/pdf", "data_b64": B64}


class _Modelo:
    def __init__(self):
        self.mensagens = None

    async def ainvoke(self, mensagens):
        self.mensagens = mensagens
        return FinancePlan(actions=[])


def _estado(media):
    return {"text": "fatura", "timezone": "America/Sao_Paulo", "messages": None, "media": media}


@pytest.mark.asyncio
async def test_a_mensagem_do_modelo_leva_a_parte_de_midia(monkeypatch):
    modelo = _Modelo()
    monkeypatch.setattr(nodes.gemini, "structured", lambda *_a, **_k: modelo)
    config = {"configurable": {CHAVE_MIDIA: MIDIA}}

    await nodes.finance_node(_estado(marca_da_midia(MIDIA)), config)

    partes = modelo.mensagens[1].content
    assert partes[0]["type"] == "text" and "anexou" in partes[0]["text"]
    assert partes[1] == {"type": "file", "base64": B64, "mime_type": "application/pdf"}


@pytest.mark.asyncio
async def test_sem_bytes_segue_so_o_texto(monkeypatch):
    modelo = _Modelo()
    monkeypatch.setattr(nodes.gemini, "structured", lambda *_a, **_k: modelo)

    await nodes.finance_node(_estado(marca_da_midia(MIDIA)))

    assert modelo.mensagens[1][0] == "human"


def test_o_estado_guarda_so_o_tipo_e_o_config_nao_vai_ao_checkpoint():
    estado = conversation._estado_base(
        {"id": 1, "phone": "1", "user_id": "u", "workspace_id": "w", "timezone": None},
        "m1", {"text": "x", "media": MIDIA}, "t",
    )
    assert estado["media"] == {"mime_type": "application/pdf"}
    assert B64 not in repr(estado)
    meta = get_checkpoint_metadata({"configurable": {"thread_id": "t", CHAVE_MIDIA: MIDIA}}, {})
    assert B64 not in repr(meta)


@pytest.mark.asyncio
async def test_o_langgraph_injeta_o_config_no_no_de_financas(monkeypatch):
    """O nó num grafo de verdade: o LangGraph só injeta `config` com a anotação certa."""
    from langgraph.graph import END, START, StateGraph

    from app.graph.state import AgentState

    modelo = _Modelo()
    monkeypatch.setattr(nodes.gemini, "structured", lambda *_a, **_k: modelo)
    g = StateGraph(AgentState)
    g.add_node("f", nodes.finance_node)
    g.add_edge(START, "f")
    g.add_edge("f", END)

    await g.compile().ainvoke(
        _estado(marca_da_midia(MIDIA)), config={"configurable": {CHAVE_MIDIA: MIDIA}}
    )

    assert modelo.mensagens[1].content[1]["base64"] == B64
