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
    # A invariante é "nenhum domínio chega em `executar` sem passar pelo gate",
    # não a aresta direta: desde 31/08/2026 o caminho passa por `alvos` (a Fase
    # Cognitiva, que resolve e congela o alvo ANTES da pergunta). Prender a
    # aresta literal transformaria essa correção numa falha vermelha.
    desenho = build(InMemorySaver()).get_graph()
    arestas = {(e.source, e.target) for e in desenho.edges}

    def alcanca(origem, destino, visto=None):
        visto = visto or set()
        if origem in visto:
            return False
        visto.add(origem)
        for s, t in arestas:
            if s == origem and (t == destino or alcanca(t, destino, visto)):
                return True
        return False

    for dominio in ("financas", "financas_consulta", "notas", "geral"):
        assert alcanca(dominio, "gate"), dominio
        # e não existe atalho: `executar` só é alcançável DEPOIS do gate
        assert (dominio, "executar") not in arestas, dominio
