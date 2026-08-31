"""O grafo compila e as arestas ligam onde deveriam.

Sem rede: usa checkpointer em memória e não chama modelo nenhum. Pega o erro que
mais dói — grafo que só falha ao subir em produção.
"""

import pytest
from langgraph.checkpoint.memory import InMemorySaver

from app.config import get_settings
from app.graph.build import build


@pytest.fixture(autouse=True)
def _config(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://x/y")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_grafo_compila_e_tem_os_nos_esperados():
    grafo = build(InMemorySaver())
    desenho = grafo.get_graph()
    nos = set(desenho.nodes)
    assert {
        "router", "financas", "financas_consulta", "notas", "geral",
        "gate", "executar", "compor",
    } <= nos


def test_todo_dominio_desemboca_no_gate():
    # se um domínio pulasse o gate, a confirmação humana deixaria de existir
    # para aquele caminho — e ninguém perceberia até apagar algo sem perguntar
    desenho = build(InMemorySaver()).get_graph()
    arestas = {(e.source, e.target) for e in desenho.edges}
    for dominio in ("financas", "financas_consulta", "notas", "geral"):
        assert (dominio, "gate") in arestas, dominio
