"""Entrada do LangGraph Studio (SÓ desenvolvimento): o grafo de produção, inalterado, como subgrafo.

O grafo real começa com o estado já montado pela borda (`conversation._estado_base`), e o Studio só
tem uma caixa de texto. O nó `sessao` faz o papel da borda: acha o usuário de demonstração, cria
(uma vez por thread) a sessão de chat de verdade — `pending_actions.session_id` tem FK — e monta o
estado com a MESMA função. Aprovar o SIM aqui executa e GRAVA no banco apontado pelo `.env`.
"""

from __future__ import annotations

import os

# Antes de qualquer import do LangChain: o Studio local não manda nada ao LangSmith.
os.environ.setdefault("LANGSMITH_TRACING", "false")
os.environ.setdefault("LANGCHAIN_TRACING_V2", "false")

import uuid
from contextlib import asynccontextmanager

from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, START, StateGraph
from typing_extensions import NotRequired, TypedDict

from app import conversation, db
from app.config import get_settings
from app.graph.build import build
from app.graph.state import AgentState

REF_PRODUCAO = "kwriuifcwyvdrxtspjiz"
_ESPACO = uuid.UUID("5c1a5e57-0d10-4a00-9a5e-570d10000001")  # namespace fixo: thread -> sessão


class Entrada(TypedDict):
    texto: str
    email: NotRequired[str]


def recusa_producao(database_url: str) -> None:
    if REF_PRODUCAO in database_url:
        raise RuntimeError(
            "Studio recusado: DATABASE_URL aponta para PRODUÇÃO. Use o staging (agent/.env)."
        )


async def sessao(state: dict, config: RunnableConfig) -> dict:
    thread = config["configurable"]["thread_id"]
    email = state.get("email") or "dev@proops.local"
    linha = await db.fetch_one("select id from auth.users where email = %s", email)
    if not linha:
        raise RuntimeError(f"usuário {email} não existe no banco do .env")
    perfil = await db.chat_profile(linha["id"])
    tz = perfil.get("timezone") or "America/Sao_Paulo"
    texto = state["texto"]
    # mesma chave por thread: a segunda mensagem do Studio reusa a sessão da primeira
    row, _ = await db.create_chat_session(
        user_id=linha["id"], workspace_id=perfil["workspace_id"], title=texto[:60],
        first_client_message_id=uuid.uuid5(_ESPACO, str(thread)), thread_id=f"studio-{thread}",
        timezone_=tz,
    )
    s = {**row, "phone": None, "channel": "app", "user_id": linha["id"],
         "workspace_id": perfil["workspace_id"], "timezone": tz}
    return conversation._estado_base(
        s, f"studio:{uuid.uuid4()}", {"text": texto}, str(thread))


def montar():
    b = StateGraph(AgentState, input_schema=Entrada)
    b.add_node("sessao", sessao, input_schema=Entrada)
    b.add_node("agente", build(None))  # o grafo REAL; checkpoint é o do servidor do Studio
    b.add_edge(START, "sessao")
    b.add_edge("sessao", "agente")
    b.add_edge("agente", END)
    return b.compile()


_abertos = 0


@asynccontextmanager
async def agente():
    """Fábrica do langgraph.json: abre os pools do `.env` (recusa produção) e os fecha ao sair."""
    global _abertos
    recusa_producao(get_settings().database_url)
    if _abertos == 0:
        await db.open_pools()
    _abertos += 1
    try:
        yield montar()
    finally:
        _abertos -= 1
        if _abertos == 0:
            await db.close_pools()
