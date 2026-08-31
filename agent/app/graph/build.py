"""Montagem do StateGraph.

O grafo é compilado UMA vez no startup e reusado: recompilar por mensagem
custaria CPU no cold start do Cloud Run sem ganho nenhum.

Persistência: AsyncPostgresSaver no schema `langgraph` (ver 0040). É ele que faz
o interrupt() do HITL sobreviver ao container morrer entre a pergunta e o "sim" —
que, num canal assíncrono como WhatsApp, é o caso NORMAL, não a exceção.
"""

from __future__ import annotations

import logging

from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.graph import END, START, StateGraph

from app import db
from app.graph.nodes import (
    domain_gate,
    after_gate,
    compose,
    execute_node,
    finance_node,
    finance_query_node,
    gate,
    general_node,
    notes_node,
    pick_domains,
    resolve_node,
    route,
    safe_node,
)
from app.graph.state import AgentState

log = logging.getLogger(__name__)

_graph = None
_checkpointer: AsyncPostgresSaver | None = None


def build(checkpointer: AsyncPostgresSaver):
    builder = StateGraph(AgentState)

    builder.add_node("router", route)
    # pergunta o domínio ANTES de extrair, quando o router hesitou
    builder.add_node("dominio", domain_gate)
    builder.add_node("financas", finance_node)
    builder.add_node("financas_consulta", finance_query_node)
    builder.add_node("notas", notes_node)
    builder.add_node("geral", general_node)
    # Fase Cognitiva: resolve e CONGELA os alvos antes de qualquer decisão
    builder.add_node("alvos", resolve_node)
    # fase segura: o que não precisa de confirmação grava ANTES da pergunta
    builder.add_node("seguras", safe_node)
    builder.add_node("gate", gate)
    builder.add_node("executar", execute_node)
    builder.add_node("compor", compose)

    builder.add_edge(START, "router")
    builder.add_edge("router", "dominio")
    # fan-out: a aresta condicional devolve uma LISTA, e o LangGraph roda os nós
    # escolhidos em paralelo. Eles escrevem chaves diferentes do estado, então
    # não há conflito de escrita concorrente.
    builder.add_conditional_edges(
        "dominio", pick_domains, ["financas", "financas_consulta", "notas", "geral"]
    )
    # fan-in dos domínios no `alvos`: ele precisa ver o lote INTEIRO (finanças e
    # notas juntas) para decidir com todas as ações na mesa, igual ao gate.
    for dominio in ("financas", "financas_consulta", "notas", "geral"):
        builder.add_edge(dominio, "alvos")
    builder.add_edge("alvos", "seguras")
    builder.add_edge("seguras", "gate")
    builder.add_conditional_edges("gate", after_gate, ["executar", "compor"])
    builder.add_edge("executar", "compor")
    builder.add_edge("compor", END)

    return builder.compile(checkpointer=checkpointer)


async def setup() -> None:
    """Cria as tabelas de checkpoint e compila o grafo. Chamado no lifespan."""
    global _graph, _checkpointer
    _checkpointer = AsyncPostgresSaver(db.graph_pool())
    await _checkpointer.setup()
    _graph = build(_checkpointer)
    log.info("grafo compilado; checkpointer pronto no schema langgraph")


def graph():
    if _graph is None:
        raise RuntimeError("grafo não compilado — falta o lifespan do FastAPI")
    return _graph
